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
//
// 评审三轮 Minor 4：下面每条测试都用 makeRun() 造出 { projectDir, pluginDir }
// 并在 finally 里清理两者，但 pluginDir 从未被真正用到——gate.mjs 的
// ROOT = join(HERE, '..') 是硬编码的真实仓库根，读的是仓库根那份真实
// stages.json（Task 2 的设计，测试帮手改不了它，跟 tests/gate-readiness.
// test.mjs 的既有取舍一致）。继续调用 makeRun 并清理 pluginDir 只是为了
// 不在系统临时目录里留垃圾，不代表这些测试真的控制了 stages.json 的内容；
// 涉及 run 目录内产物归属判定的用例（"00-contract.md"/"state.json"那几条）
// 全部依赖仓库根真实 stages.json 里 S1 是 at-pm、S5 是 at-backend 这两条
// 事实，不是夹具决定的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

// Task 4 复审（顾虑 1 的真正解法）：这条原来用"干净临时目录、没有
// .agent-team"来代表"ctx.ok 为 false"，断言 deny。评审指出这个场景其实是
// readRunContext 新分类里的 kind:'no-run'（压根没有进行中的 run，门禁没有
// 东西要管），不该再 deny——见下面"没有 run 时"那几条。为了不丢失"H3 对
// 真实失败仍然 fail closed"这条覆盖，这里改成一个 run 真实存在、但
// project.json 被写坏的场景（kind:'unreadable'）：这正是评审点名的边界，
// "一个坏掉的 project.json 必须继续拒，否则把 project.json 写坏就成了
// 绕过 H3 的办法"。
test('writepath：run 存在但 project.json 坏了——仍然 fail closed，不能被"没有 run"那条放宽', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    // makeRun 已经造出 current-run + runs/r1/state.json，run 是真实存在的；
    // 只手动把 project.json 写成坏 JSON——不是"没有 run"，是"run 读不出来"。
    writeFileSync(join(dirs.projectDir, '.agent-team', 'project.json'), '{ not json', 'utf8')
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'server', 'api.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(
      out,
      'project.json 损坏时必须仍然 deny——如果这里放行了，说明 no-run 的判定被错误地' +
        '放宽到了"run 存在但读不出来"这一类，写坏 project.json 就变成了绕过 H3 的办法',
    )
    assert.equal(out.permissionDecision, 'deny')
    // 评审三轮 Minor 5：只断言 deny 抓不住"因为别的原因凑巧也 deny"这类
    // 问题（比如 kind 分类错了、走到了别的 deny 分支）——理由必须真的
    // 指向"读不到运行上下文"，不是巧合撞上了同一个决定。
    assert.match(out.permissionDecisionReason, /运行上下文/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// Task 4 复审：current-run 内容含路径穿越字符同样必须继续 fail closed——
// 这是路径可信边界问题，不是"没有 run"。
test('writepath：current-run 内容含路径穿越字符——仍然 fail closed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-traversal-cwd-'))
  try {
    mkdirSync(join(cwd, '.agent-team'), { recursive: true })
    writeFileSync(join(cwd, '.agent-team', 'current-run'), '../../evil', 'utf8')
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(cwd, 'src', 'server', 'api.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, 'current-run 含路径穿越字符时必须 deny，不能被当成"没有 run"放行')
    assert.equal(out.permissionDecision, 'deny')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// MAIN（无 agent_type）豁免必须排在 ctx.ok 判定之前——理由（规格 §6 表格
// H1/H3 的措辞差异、不排前面会怎样自举死锁）见 hooks/gate.mjs 里这段判定
// 上方的注释，不在这里重复。
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

// kind:'no-run' 的判定不区分调用者带不带 agent_type——定义与理由见
// hooks/lib/runctx.mjs 头部注释。这条验证"有名有姓的角色"这一般情形，
// 下面那条验证死锁场景本身（at-pm 写 project.json）。
test('writepath：没有 run 时，有名有姓的角色（非 MAIN）也放行——按 no-run 处理，不因为不是 MAIN 就被收紧', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-norun-named-cwd-'))
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(cwd, 'src', 'server', 'api.ts') },
    }
    const { stdout, stderr, status } = run('writepath', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '没有 run 不该走 deny JSON，即使调用者带着 agent_type')
    assert.ok(
      stderr.trim().length > 0,
      '必须往 stderr 留痕；静默的放行和门禁坏掉长得一模一样（H2 立下的先例）',
    )
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /(H3|写路径)/)
    assert.match(stderr, /current-run/, 'stderr 里应带上 readRunContext 给出的具体原因')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// 死锁场景本身：settings.json 的 agent 键把 at-pm 钉成主线程 agent 时，
// 主线程的 hook 输入带 agent_type（docs/05-M0-结论.md「次要事实」），不
// 享受上一条"无 agent_type"的豁免，走的是这条"kind:'no-run' 一般性放行"。
test('writepath：没有 run 时，被 settings.json 钉成主线程的 at-pm 写 project.json 不受阻——这正是死锁场景本身', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-bootstrap-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(cwd, '.agent-team', 'project.json') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      '/at-init 从被钉成主线程的 at-pm 写 .agent-team/project.json 这个自举动作' +
        '不该被拒绝，否则第一个 run 永远建不出来',
    )
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

// at-pm 不是 callerOf 判定的 MAIN（settings.json 钉住主线程时 hook 输入带
// agent_type，见上面的死锁场景测试），会作为有名有姓的角色走到 run 目录
// 内的产物归属判定。这条钉住：at-pm 写它自己在 S1 产出的 00-contract.md
// 放行——依据是仓库根真实 stages.json 里 S1.role === 'at-pm'、
// S1.produces 含 '00-contract.md'（评审三轮 Important 2 收紧之后，run
// 目录下的合法写入集是"自己阶段的 produces"，不再是"目录下任何东西"，
// 见 hooks/lib/writepath.mjs 里 decideWritePath 的用法注释）。
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

// 评审三轮 Important 2 的子进程级证据：run 目录下的写入现在按 ctx.stages
// 收紧到"自己阶段的 produces"。00-contract.md 是 S1 的产物、归 at-pm——
// at-backend 写它必须 deny，且理由要点名真正的阶段与角色，不能只断言
// deny（那样抓不住"stages 传错/传漏"这类问题）。
test('writepath：run 目录下写别人阶段的产物——仍然 deny，理由点名哪个阶段、归谁', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, '00-contract.md 是 S1 的产物、归 at-pm，at-backend 写它必须 deny')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /at-pm/)
    assert.match(out.permissionDecisionReason, /S1/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// state.json 不是任何阶段的 produces——它是运行状态文件，H2 就绪门禁的
// artifactExists 就是在 run 目录下解析的，H4/H5 也要读它。如果角色能在
// run 目录下随便写，state.json 首当其冲：改写它就能伪造后续门禁的判据。
test('writepath：run 目录下写 state.json——仍然 deny，它不是任何阶段的产物', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(
      out,
      'state.json 落在 run 目录下但不是任何阶段的产物——如果这里放行了，说明 run 目录' +
        '豁免又退回了"目录下任何东西都放行"的旧行为',
    )
    assert.equal(out.permissionDecision, 'deny')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
