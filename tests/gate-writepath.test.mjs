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

// 评审顾虑 1（Task 4 复审）：这条原来断言的是相反的结果（deny），依据是
// "ctx.ok 校验必须先于主线程豁免"。评审指出那个顺序会自己把自己锁死：
// 规格 §6 表格里 H1 明写"派发白名单（全部层级，含主线程）"，H3 只写
// "per-role 写路径隔离"，没有"含主线程"——两行是刻意写得不一样的。
// 且建第一个 run 之前 .agent-team 还不存在，ctx.ok 必然是 false；如果
// fail-closed 判在前面，从主线程（无 agent_type）写 .agent-team/project.json
// 这类自举动作会被永久拒绝，第一个 run 永远建不出来，门禁把自己锁在门外。
// 现在改成"没有 agent_type 就放行"排在 ctx.ok 判定之前。
test('writepath：没有 agent_type（真·主线程）时放行，即使 ctx.ok 为 false——不会自己把自己锁死', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-main-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: join(cwd, '.agent-team', 'project.json') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      '无 agent_type 的调用不受 per-role 隔离约束，且不能被"读不到上下文"卡住——' +
        '否则 /at-init 从主线程写 .agent-team/project.json 这类自举动作会被永久拒绝，' +
        '第一个 run 永远建不出来',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// 有 agent_type 的调用（哪怕值恰好是 at-pm）走的是完全不同的分支——它不是
// callerOf 判定的 MAIN，必须继续接受 ctx.ok 的 fail-closed 校验。这条钉住
// "MAIN 豁免"没有被错误地放宽成"agent_type 缺失或角色名恰好是 at-pm 都豁免"。
test('writepath：有 agent_type 时（即使是 at-pm）ctx.ok 为 false 仍然 fail closed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-named-pm-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(cwd, '.agent-team', 'project.json') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(
      out,
      '带 agent_type 的调用不享有主线程豁免，ctx.ok 为 false 时必须 deny——' +
        '如果这里被放行，说明 MAIN 豁免被错误地放宽了',
    )
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

// 评审顾虑 1 的"相关情形"：settings.json 的 agent 键把 at-pm 钉成主线程 agent
// 时，主线程的 hook 输入带 agent_type（值为 at-pm，docs/05-M0-结论.md
// 「次要事实」——归一化前后是否带插件前缀未直接观测到，但 callerOf 两种
// 形态都能处理，见 hooks/lib/decide.mjs 的 stripPluginPrefix）。这种配置下
// at-pm 不是 callerOf 判定的 MAIN，会作为一个有名有姓的角色走到 per-role
// 判定，不享受上面两条"无 agent_type"测试豁免的那条路。这条钉住：只要
// run 已经存在（ctx.ok 为 true），at-pm 写它自己在 S1 产出的 00-contract.md
// 不会被当成"写别人的地盘"拒绝——PROJECT.paths 里根本没有 at-pm 这个键，
// 但 decideWritePath 的 runDir 豁免先于 owners 查找生效（纯函数层面
// tests/writepath.test.mjs「本趟 run 目录下的产物一律放行」已测过，这里
// 补子进程级证据，直接回应评审"请确认这条路径下 at-pm 写
// .../00-contract.md 不会被拒"）。
test('writepath：被 settings.json 钉成主线程的 at-pm（带 agent_type）写 run 目录下的 00-contract.md 不受阻', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      'at-pm 写自己在 run 目录下的产物不该被 H3 拒绝，否则 S1 完不成、整条阶段链起不来',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
