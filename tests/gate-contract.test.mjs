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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

// 核心独立性证据（Task 5 简报「一个你必须自己想清楚的点」）：project.json
// 缺失时 decideWritePath 第一行就整体放行，H3 对这次调用完全不拦；H4 不读
// project.json，不能借这个前提。用同一个 input 分别跑 writepath 和 contract
// 两个检查项，把对比做成看得见的证据，不只断言"H4 deny"（那样抓不住"H4
// 也悄悄依赖了 project.json、只是这次恰好没触发"这类问题）。
test('contract：project.json 缺失时 H3 整体放行、H4 仍然独立拦住——H4 不借 H3 的前提', () => {
  const dirs = makeRun({ runId: 'r1' }) // 不传 project，makeRun 就不会写 project.json
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'agent-team:at-product',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }

    const writepathResult = run('writepath', input, undefined, dirs.projectDir)
    assert.equal(
      writepathResult.stdout.trim(),
      '',
      '前提核实：project.json 缺失时 H3 确实整体放行（decideWritePath 第一行），' +
        '不然下面 H4 的对比就立不住',
    )

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
