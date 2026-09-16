// H3（writepath）在 gate.mjs 里 tests/writepath.test.mjs 覆盖不到的逻辑：
// decideWritePath 是纯函数，从不知道 ctx.ok 是什么、从不知道 tool_input 的
// 字段到底叫 file_path 还是 notebook_path、也从不经过 denyAndExit——这些全部
// 活在 gate.mjs 自己的 CHECK === 'writepath' 分支里。
//
// Task 3 评审的教训（Important 1）：ctx.ok === true → 判定 → denyAndExit
// 这条链此前只有手工烟雾测试验证过。H3 是 fail closed（跟 H2 的 fail open
// 相反），这里补对称的覆盖：ctx 不可读、role 判定、deny 传导、以及
// NotebookEdit 的路径字段名（这条是本任务实现时发现的真实分支，见下方
// 具体测试的注释）都要经真实子进程走一遍，不能只信纯函数测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const PROJECT = {
  paths: {
    'at-backend': ['src/server/', 'src/shared/'],
    'at-frontend': ['src/web/', 'src/shared/'],
    // 故意给 __main__（callerOf 对主线程的判定值）也认领一段窄路径。
    // 如果没有这条，"主线程不受隔离约束" 那条测试即使 gate.mjs 里的
    // MAIN 豁免分支被删掉也会碰巧通过——decideWritePath 对不在
    // project.paths 里的角色本来就会直接放行（见 tests/writepath.test.mjs
    // 「不在 project.paths 里的角色不归本门禁管」），那条测试会在错误的
    // 理由下变绿。加了这条，__main__ 变成一个「已登记但没认领这条目标
    // 路径」的角色，唯一能让它仍然放行的就是 gate.mjs 里显式的 MAIN 豁免。
    __main__: ['docs/'],
  },
}

test('writepath：ctx.ok 为 false 时 fail closed（deny，走 stdout JSON，不是静默放行）', () => {
  // 干净的临时目录当 cwd：必然没有 .agent-team，readRunContext 必然
  // 返回 ok:false。跟 H2 不同，H3 是安全边界，这里不该是 stderr 警告 + 放行，
  // 而是 PreToolUse 的 deny JSON。
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-cwd-'))
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(cwd, 'src', 'server', 'api.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(out, 'ctx.ok 为 false 时必须有 deny 判定，stdout 不该是空的')
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(
      out.permissionDecisionReason,
      /current-run/,
      'stderr/reason 里应带上 readRunContext 给出的具体原因，而不是一句写死的固定文案',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('writepath：ctx.ok 为 false 时，即使是主线程（无 agent_type）调用也被拒', () => {
  // 主线程豁免的是「per-role 隔离」，不是「读不到上下文这件事本身」——
  // 上下文都读不到时，谁都判不出任何路径的归属，包括主线程自己。这条
  // 专门钉住检查顺序：ctx.ok 校验必须先于「是不是主线程」的豁免判断。
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-main-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: join(cwd, 'anything.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, '主线程在 ctx.ok 为 false 时也必须被 deny，不是静默放行')
    assert.equal(out.permissionDecision, 'deny')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('writepath：ctx.ok 为 true，写自己名下的路径——deny 判定链没有被误触发，stdout 为空', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'server', 'api.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '写自己认领的路径不该被 deny')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('writepath：ctx.ok 为 true，写别人名下的路径——deny 判定真的经 denyAndExit 传到 stdout，理由点名归属', () => {
  // project.json 从磁盘真实读出（makeRun 写的临时文件），agent_type 带插件
  // 前缀（顺带验证 callerOf 的剥前缀真的在这条路径上跑了），file_path 落在
  // at-frontend 的地盘里。
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'web', 'App.tsx') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(out, 'ctx.ok 为 true 且路径归属别人时必须有 deny 判定，stdout 不该是空的')
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(
      out.permissionDecisionReason,
      /at-frontend/,
      '理由里必须点名真正的归属方——只断言 deny 抓不住 ctx.project/role 传错这类问题',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('writepath：主线程（无 agent_type）不受 per-role 隔离约束，即使路径归别人也放行', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      // 故意不带 agent_type：模拟主线程直接调用 Edit。目标路径落在
      // at-frontend 的地盘，且 PROJECT.paths 里 __main__ 自己认领的是
      // docs/，两者都不含这条路径——唯一能让这里放行的就是 gate.mjs 里
      // 显式的 MAIN 豁免分支，不是"这个角色恰好没在花名册里"这种巧合。
      tool_input: { file_path: join(dirs.projectDir, 'src', 'web', 'App.tsx') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '主线程调用不该被 per-role 隔离拦住')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 本任务实现时发现的真实分支：NotebookEdit 的工具 schema 里路径字段叫
// notebook_path，不叫 file_path（Edit/Write 才是 file_path）。如果 gate.mjs
// 只读 tool_input.file_path，每一次 NotebookEdit 调用都会拿到 undefined，
// 命中 decideWritePath「没有可判定路径」那条分支而无条件放行——
// checks.mjs 把 NotebookEdit 列进 H3 的 toolNames 就白列了，这道闸对它
// 会静默失效，且不会被 tests/writepath.test.mjs 那份纯函数测试抓到（它
// 测的是 decideWritePath 本身，不测 gate.mjs 从 tool_input 里挖哪个字段）。
test('writepath：NotebookEdit 用 notebook_path 而不是 file_path 也能被正确判定', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'NotebookEdit',
      agent_type: 'agent-team:at-backend',
      tool_input: { notebook_path: join(dirs.projectDir, 'src', 'web', 'analysis.ipynb') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(
      out,
      'notebook_path 落在别人地盘时必须 deny——如果这里 stdout 是空的，说明字段名读错了（读成了 file_path），H3 对 NotebookEdit 完全失效',
    )
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /at-frontend/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
