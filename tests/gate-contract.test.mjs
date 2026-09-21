// H4（contract）在 gate.mjs 里，tests/contract-guard.test.mjs 覆盖不到的逻辑：
// decideContractGuard 是纯函数，从不知道 ctx.ok/ctx.kind 是什么、从不知道
// tool_input 的字段到底叫 file_path 还是 notebook_path、也从不经过
// denyAndExit——这些全部活在 gate.mjs 自己的 CHECK === 'contract' 分支里。
// 结构照抄 tests/gate-writepath.test.mjs（Task 3 评审 Important 1 的教训：
// 纯函数测试和"入口传导链"测试要分别覆盖，只测前者会漏掉 ctx 读取、kind
// 分派、denyAndExit 传导、tool_name 字段分派这几条真实存在的分支）。
//
// 同样的 makeRun()/pluginDir 说明：gate.mjs 的 ROOT = join(HERE, '..') 是
// 硬编码的真实仓库根，读的是仓库根那份真实 stages.json，测试夹具的
// pluginDir 改不了它。但 H4 本身不读 ctx.stages/ctx.project（见
// hooks/lib/contract-guard.mjs 头部注释：判定不依赖 H3 的任何前提），这里
// 唯一要紧的真实事实是 S1.role === 'at-pm'，仅用来解释"契约本来就是 at-pm
// 的产物"这个背景，不是说 H4 的判定借用了它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

test('contract：subagent 写 00-contract.md 拒绝，理由点名用户/PM 且说明为什么', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(out, 'subagent 写契约必须被 deny，stdout 不该是空的')
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /用户|PM/)
    assert.match(
      out.permissionDecisionReason,
      /查不出|验收|假象/,
      '理由要说明为什么契约不能被下游改，不能只是一句"不许"',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('contract：subagent 写别的产物放行，stdout 为空', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '01-prd.md') },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', 'H4 只保护契约文件本身，别的产物不归它管')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('contract：主线程（无 agent_type）写契约放行，stdout 为空', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', 'PM 代用户转写契约是设计允许的')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 被 settings.json 钉成主线程的 at-pm：hook 输入带 agent_type: 'at-pm'（裸名，
// M0 实测「次要事实」），不是真正的"无 agent_type"，但语义上仍是 PM 转写，
// 不是 subagent 执行链上的一环。本仓库自己的 settings.json 就是
// {"agent": "at-pm"}——这不是假设性的配置，是这个仓库的真实运行状态。
test('contract：被 settings.json 钉成主线程的 at-pm（带 agent_type）写契约不受阻', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      '钉住的 at-pm 写自己在 S1 产出的契约不该被拒绝，否则本仓库自己的配置下契约永远写不出来',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// NotebookEdit 的路径字段是 notebook_path，不是 file_path——跟 H3 是同一个
// 真实分支（本插件的工具 schema 差异），不能只信纯函数测试（纯函数根本不
// 知道 gate.mjs 从 tool_input 里挖哪个字段）。
test('contract：NotebookEdit 用 notebook_path 也能正确判定为契约文件', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = {
      tool_name: 'NotebookEdit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        notebook_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md'),
      },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(
      out,
      'notebook_path 指向契约文件时必须 deny——如果 stdout 是空的，说明字段名读错了' +
        '（读成了 file_path），H4 对 NotebookEdit 完全失效',
    )
    assert.equal(out.permissionDecision, 'deny')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 核心独立性证据（Task 5 简报「一个你必须自己想清楚的点」）：H4 不读
// project.json、也不读 stages.json，它的判定不借 H3 的任何前提。
//
// 全分支评审 I1 之后这条对比换了形状。旧版本拿同一个 input（run 目录下的
// 00-contract.md）分别跑 H3 与 H4，靠"project.json 缺失 → H3 整体放行"当
// 对照面。I1 修掉的正是那条缝：run 目录保护只依赖 runDir/stages，跟
// project.json 在不在无关，缺席时 H3 照样按 stages.json 拦住"写别人阶段的
// 产物"，而契约文件（S1 的产物、归 at-pm）恰好就是其中一条。于是"同一条
// 路径上 H3 放行、H4 拒绝"这种单输入 A/B 已经构造不出来了——H4 只在
// runDir/00-contract.md 这一条路径上拒绝，而这条路径现在 H3 也拦。改成共用
// 同一个"没有 project.json"的 run、分三步看：
//   ① 前提核实：run 目录外的普通源码路径——这是 I1 收窄之后
//      `!project.paths → allow` 唯一还管的范围，H3 在这里确实整体没有判据、
//      放行（如果有人把这条早退删了，这里会因为 project.paths 取不到而落进
//      gate.mjs 的兜底 fail closed，assert 会红，不是恒真断言）。
//   ② 独立性本身：同一个 run、同一个子代理写契约——H4 仍然拒，且理由点名
//      契约文件，不是"读不到运行上下文"那种撞上别的 fail-closed 分支的措辞。
//   ③ 顺带钉住 I1 在子进程级也成立：H3 在契约路径上现在也拒，但走的是它
//      自己那条 run 目录归属判定（理由点名 S1 与 at-pm），跟 H4 的理由不是
//      同一件事——两道闸同时触发、判据各自独立，这正是 Task 7 清单第 5 条
//      记下的那个观察。
test('contract：project.json 缺失时 H3 对普通路径整体放行、H4 仍然独立拦住契约——H4 不借 H3 的前提', () => {
  const dirs = makeRun({ runId: 'r1' }) // 不传 project，makeRun 就不会写 project.json
  try {
    const contractPath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md')
    const input = {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: contractPath },
    }

    // ① 前提核实：run 目录外的普通路径，H3 没有判据可用 → 放行。
    const plainWrite = run(
      'writepath',
      {
        tool_name: 'Write',
        agent_type: 'agent-team:at-product',
        tool_input: { file_path: join(dirs.projectDir, 'src', 'server', 'api.ts') },
      },
      undefined,
      dirs.projectDir,
    )
    assert.equal(
      plainWrite.stdout.trim(),
      '',
      '前提核实：project.json 缺失时 H3 的 per-role 隔离那一段确实没有判据、整体放行，' +
        '不然下面 H4 的对比就立不住',
    )

    // ③ I1 的子进程级证据：同样是 project.json 缺席，run 目录内就不放行了。
    const contractWritepath = decisionOf(
      run('writepath', input, undefined, dirs.projectDir).stdout,
    )
    assert.ok(
      contractWritepath,
      'I1：run 目录保护不挂在 project.json 上——project.json 缺席时，子代理写别人阶段的' +
        '产物（契约是 S1 的产物）必须仍然被 H3 拦住',
    )
    assert.match(contractWritepath.permissionDecisionReason, /S1/)
    assert.match(contractWritepath.permissionDecisionReason, /at-pm/)

    // ② 独立性本身。
    const contractResult = run('contract', input, undefined, dirs.projectDir)
    const out = decisionOf(contractResult.stdout)
    assert.ok(out, 'project.json 缺失不能成为 H4 放行契约写入的理由')
    assert.equal(out.permissionDecision, 'deny')
    // 评审 Minor 3：只断言 deny 抓不住"这个 deny 其实来自别处"这类问题——
    // 比如将来有人把 runctx.mjs 里"project.json 缺失"重新归类成
    // unreadable，deny 会照样发生，但理由会变成"读不到运行上下文"，此时
    // 这条测试原本想证明的事（H4 自己独立判定契约保护）已经不成立了，却
    // 会因为同样落在 fail-closed 分支而继续显示绿色。理由必须点名契约
    // 文件本身（decideContractGuard 的 reason 里带 00-contract.md），不能
    // 是 /运行上下文/ 这种通用的"读不到 ctx"措辞，才能真的锁死"这个 deny 是
    // H4 自己判出来的，不是巧合撞上了别的 fail-closed 分支"。
    assert.match(out.permissionDecisionReason, /00-contract\.md/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// ctx.kind 分派——结构照抄 tests/gate-writepath.test.mjs 里同名测试，权威
// 解释见 hooks/lib/runctx.mjs 头部注释，不在这里重复第二遍。
test('contract：project.json 坏了（kind: unreadable），子代理——仍然 fail closed', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    writeFileSync(join(dirs.projectDir, '.agent-team', 'project.json'), '{ not json', 'utf8')
    const input = {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, 'project.json 损坏时子代理必须仍然 deny，不能被误判成"没有 run"')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /运行上下文/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// Task 5 评审顾虑 2：H4 的规则是"任何 subagent 不得写契约"——调用者是 PM
// 时，H4 对这次调用根本没有意见，跟运行上下文读不读得出来无关。如果 PM
// 也被 unreadable 卡住，后果比"多拒一次"更糟：修复一个坏掉的 run 恰恰要
// PM 动手（比如这里 project.json 本身就是坏的），门禁把自己需要的人也
// 锁在门外，跟 H3 已经修过的自举死锁是同一个形状。这两条钉住 PM（真主
// 线程与被钉住的 at-pm 两种形态）在 unreadable 时仍然放行，跟上面"子代理
// 仍然 fail closed"形成直接对照。
test('contract：project.json 坏了（kind: unreadable），PM（无 agent_type）——仍然放行', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    writeFileSync(join(dirs.projectDir, '.agent-team', 'project.json'), '{ not json', 'utf8')
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      'PM 不在 H4 的管辖对象里——修复一个坏掉的 run 恰恰需要 PM 动手，如果这时候' +
        '连 PM 都被拦住，就是门禁把自己需要的人锁在门外',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('contract：project.json 坏了（kind: unreadable），被钉成主线程的 at-pm——仍然放行', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    writeFileSync(join(dirs.projectDir, '.agent-team', 'project.json'), '{ not json', 'utf8')
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }
    const { stdout, status } = run('contract', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '钉住的 at-pm 同样不该被 unreadable 的 ctx 卡住')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('contract：没有 run 时放行、stderr 留痕（kind: no-run），即使目标路径长得像契约', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h4-norun-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(cwd, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }
    const { stdout, stderr, status } = run('contract', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '没有 run 就没有契约文件可保护，不该走 deny JSON')
    assert.ok(stderr.trim().length > 0, '必须往 stderr 留痕；静默的放行和门禁坏掉长得一模一样')
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /H4|契约/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// 死锁场景本身（与 tests/gate-writepath.test.mjs 同名测试对齐）：没有 run
// 时，被钉成主线程的 at-pm 写 project.json 这个自举动作不该被 H4 卡住——
// 它连"契约在哪"都判定不出来（没有 runDir），必须走 no-run 那条放行，不能
// 落到别的分支。
test('contract：没有 run 时，被 settings.json 钉成主线程的 at-pm 写 project.json 不受阻', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h4-bootstrap-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(cwd, '.agent-team', 'project.json') },
    }
    const { stdout, status } = run('contract', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '没有 run 时的自举动作不该被 H4 拒绝')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// ——— M3b「坏指针的窗口」：current-run 在、非空，但它指向的 runs/<id>/ 不存在 ———
//
// H4 与 H3 一起变：这个输入状态此前归 kind:'no-run'，H4 走的是「没有 run 就没有契约
// 文件可保护」那条放行。子进程级实测（改动前）：**at-backend 写得成
// runs/r1/00-contract.md**——一个 subagent 在那个窗口里可以给指针点名的那个 run
// 造一份契约出来，而契约是这趟 run 唯一的需求基线。本轮把这一格挪去 unreadable
// （论证在 hooks/lib/runctx.mjs 头部），H4 在那一支对 subagent 继续 fail closed。
//
// 两条各占一个 test()，与上面 project.json 损坏那一组同构：子代理被拒 / PM 仍然通。
// PM 那一条是前者的正向自检锚——H4 的短路排在读 ctx 之前，收窄不该波及它。
const makeDanglingPointerH4 = () => {
  const dirs = makeRun({ runId: 'r1' })
  rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
  return dirs
}

test('contract：坏指针（run 目录不存在），子代理写契约——本轮起 fail closed，这个窗口曾经对所有角色开着', () => {
  const dirs = makeDanglingPointerH4()
  try {
    const { stdout, status } = run('contract', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }, undefined, dirs.projectDir)
    const out = decisionOf(stdout)
    assert.equal(status, 0)
    assert.ok(out, '坏指针下 subagent 写契约必须 deny——放行就是那个 fail-open 窗口回来了')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /运行上下文/)
    assert.match(out.permissionDecisionReason, /不存在/, '理由要带上「run 目录不存在」这个真实原因')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// ——— M3c「丢指针」：current-run **根本不在**，而 runs/<真实 id>/ 原封不动 ———
//
// 与上面坏指针那一组同构，只是这一格更便宜（rm 比 echo bogus > 少一个参数）。
// 子进程级实测（改动前）：**at-backend 写得成 runs/r1/00-contract.md**——一个 subagent
// 可以在这个窗口里给一个真实存在的 run 覆写掉它唯一的需求基线，而 S7 验收拿契约的
// 哈希对账。本轮把这一格挪去 unreadable（论证在 hooks/lib/runctx.mjs 头部 ③）。
//
// 两条各占一个 test()：子代理被拒 / PM 仍然通。后者是前者的正向自检锚，而且在这一族里
// 它还多担一件事——commands/at.md 第 2 节写 00-contract.md 时 current-run 已经写好了，
// 所以正路不经过它；但 run 丢了指针之后 PM 要重建契约仍然得走这条。
const makeMissingPointerH4 = () => {
  const dirs = makeRun({ runId: 'r1' })
  rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
  return dirs
}

test('contract：丢指针（current-run 不在、runs/ 非空），子代理写契约——本轮起 fail closed', () => {
  const dirs = makeMissingPointerH4()
  try {
    const { stdout, status } = run('contract', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }, undefined, dirs.projectDir)
    const out = decisionOf(stdout)
    assert.equal(status, 0)
    assert.ok(out, '丢指针下 subagent 写契约必须 deny——放行就是那个 fail-open 窗口回来了')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /运行上下文/)
    assert.match(out.permissionDecisionReason, /非空/, '理由要带上「runs/ 下非空」这个真实原因')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('contract：丢指针，被钉成主线程的 at-pm——仍然放行，短路排在读 ctx 之前', () => {
  const dirs = makeMissingPointerH4()
  try {
    const { stdout, status } = run('contract', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }, undefined, dirs.projectDir)
    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      '收窄的全部前提是「丢了指针的 run 还接得回来」：这条一红，说明 H4 把 PM 也锁在了门外',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 自举那条边的正向锚，与 tests/gate-writepath.test.mjs 里同名那条配对：
// 判据被错写成 existsSync(runsDir)（而不是「非空」）时，上面两条照样绿，红的是这一条。
test('contract · 自举边界：runs/ 存在但是空目录——子代理写契约仍然放行，按 no-run 处理', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h4-emptyruns-'))
  try {
    mkdirSync(join(cwd, '.agent-team', 'runs'), { recursive: true })
    const { stdout, stderr, status } = run('contract', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(cwd, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }, undefined, cwd)
    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '空的 runs/ 是「从来没有人建过 run」，没有契约可保护')
    assert.match(stderr, /H4 契约保护：当前没有进行中的 run（/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('contract：坏指针（run 目录不存在），被钉成主线程的 at-pm——仍然放行，短路排在读 ctx 之前', () => {
  const dirs = makeDanglingPointerH4()
  try {
    const { stdout, status } = run('contract', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }, undefined, dirs.projectDir)
    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      '收窄的全部前提是「坏掉的 run 还修得了」：这条一红，说明 H4 把 PM 也锁在了门外',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
