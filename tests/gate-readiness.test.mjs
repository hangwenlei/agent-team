// H2（readiness）在 gate.mjs 里 tests/readiness.test.mjs 覆盖不到的逻辑：
// decideReadiness 是纯函数，从不知道 ctx.ok 是什么、也从不经过 denyAndExit——
// 「读不到运行上下文时到底做了什么」「deny 判定是否真的传到了 stdout」
// 完全活在 gate.mjs 自己的 CHECK === 'readiness' 分支里。
//
// 规格 §6：H2 的失败策略是 allow + warning，不是静默放行。Task 1 评审记录
// 过这条遗留项：早期草稿在 ctx.ok === false 时只 process.exit(0)，一声不吭——
// 如果退回那个写法，下面第一条测试必须变红，不能因为只断言了 exit code
// 就继续绿着（那是本任务自审明确要求排除的恒真断言）。
//
// Task 3 评审 Important 1：ctx.ok === true → 剥前缀 → decideReadiness →
// denyAndExit 这条链此前只有手工烟雾测试验证过，仓库里没有留任何自动化
// 报警——把 ctx.stages 误写成 ctx、把 spec.event 传错，测试依旧全绿。
// 第二条测试补上；跟手工烟雾测试一样接受耦合到仓库根真实 stages.json 的
// 代价（gate.mjs 的 pluginDir 是硬编码的 ROOT，测试帮手改不了它），但只
// 断言结构性的东西（deny + 阶段 id 出现在 reason 里），不钉死具体文案。
//
// Task 3 评审 Minor 5：!target 分支也是 fail open，同样要留痕，第三条测试钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

test('readiness：ctx.ok 为 false 时 fail open 且在 stderr 留痕说明（不是静默放行）', () => {
  // 干净的临时目录当 cwd：这里必然没有 .agent-team，readRunContext 必然
  // 返回 ok:false——不依赖仓库根此刻是否恰好有/没有进行中的 run，那是
  // 环境状态，不该决定这条分支的测试结果。
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h2-cwd-'))
  try {
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'at-product' } }
    const { stdout, stderr, status } = run('readiness', input, undefined, cwd)

    assert.equal(status, 0, 'H2 fail open：读不到运行上下文不能拦住这次调用')
    assert.equal(stdout.trim(), '', '不该往 stdout 写 PreToolUse 的 deny JSON——这次判定是放行')
    assert.ok(
      stderr.trim().length > 0,
      '必须往 stderr 留痕；只断言 exit code 是 0 抓不住"退回静默放行"这个真实发生过的回归',
    )
    assert.match(stderr, /agent-team/, 'stderr 里应表明这是 agent-team 发出的')
    assert.match(stderr, /(H2|就绪)/, 'stderr 里应指明是就绪门禁本身，不能是一句认不出出处的泛泛之词')
    assert.match(
      stderr,
      /current-run/,
      'stderr 里应带上 readRunContext 给出的具体原因（这里必然提到 current-run），' +
        '而不是一句与实际失败原因无关、写死的固定文案',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('readiness：ctx.ok 为 true 时，deny 判定真的经 denyAndExit 传到 stdout', () => {
  // at-product 是仓库根真实 stages.json 里 S2 的角色，S2 requires
  // ['00-contract.md']——不造这个产物（artifacts 默认空），前置必然缺失。
  // subagent_type 带插件前缀，顺带验证 stripPluginPrefix 真的在这条路径上跑了。
  //
  // M2b Task 2：S2 从单产者阶段改成对象形式的多产者阶段之后，stageRolesInRun 的
  // roster ∩ producers 口径第一次对 S2 生效——makeRun 默认的空 roster 曾经会让这一趟
  // 在 S2 的产出角色算成空集合，expandProduces 对象分支对任何角色都返回 []，H2 的
  // done 判定在空数组上 .every() 恒真，把 S2 直接判成"已完成"、requires 检查被跳过，
  // deny 判定从未发生，stdout 变成空——这条测试原本要验证的"前置缺失应当 deny"场景
  // 曾经无从触发，只能靠显式声明 at-product 在场绕开。
  //
  // Task 2 修复轮 1 · 修复 1：hooks/lib/readiness.mjs 的 decideReadiness 已经改为把
  // targetRole 并入判定用的角色集合——roster 是否已经记上它，不再影响这里的判定，
  // 上面那条"空数组恒真"的问题不再存在。这里继续显式传 roster: ['at-product']，
  // 不是因为还需要靠它绕开 bug，是因为这条测试真正要盯的是另一件事（ctx.ok 为
  // true 之后 denyAndExit 这条传导链本身有没有接对），不该被 roster 取值的巧合
  // 决定它红不红。"makeRun() 缺省 roster（与 templates/state.json 逐字相同的
  // 形状）在子进程门禁层端到端过一遍 deny"这件事由下面新增的兄弟测试覆盖。
  const dirs = makeRun({ runId: 'r1', roster: ['at-product'] })
  try {
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } }
    const { stdout, status } = run('readiness', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(out, 'ctx.ok 为 true 且前置缺失时必须有 deny 判定，stdout 不该是空的')
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(
      out.permissionDecisionReason,
      /S\d/,
      '理由里必须出现阶段 id——只断言 deny 抓不住 ctx.stages/spec.event 这类传错',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// Task 2 修复轮 1 · 修复 1（F1 点名"唯一照到它的覆盖被挪走了"的那条）：上面那条
// 测试为了避开 M2b Task 2 引入的 S2 对象形式回归，改用了显式 roster: ['at-product']，
// 于是"makeRun() 缺省 roster"——与 templates/state.json 的初始值逐字相同的真实
// 起点——在子进程门禁层一度失去了任何端到端覆盖。这条把它补回来：不传 roster
// （走 makeRun 的默认值 []），派 at-product 时 S2 的前置 00-contract.md 缺失，
// 必须 deny。这是上面那条的新增兄弟条，不是替换——上面那条测的是 ctx.ok →
// denyAndExit 这条传导链，这条测的是"真实初始 roster 不会让 H2 静默放行"。
test('readiness：makeRun() 缺省 roster（与 templates/state.json 逐字相同的形状）时，S2 前置缺失仍然 deny——修复 1 的端到端覆盖', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } }
    const { stdout, status } = run('readiness', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(out, '缺省 roster（[]）不该让 H2 在真实初始状态下静默放行，stdout 不该是空的')
    assert.equal(out.permissionDecision, 'deny')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('readiness：ctx.ok 为 true 但没有可判定的目标角色时，同样带 warning 放行', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = { tool_name: 'Agent', tool_input: {} }
    const { stdout, stderr, status } = run('readiness', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '没有目标角色不该 deny')
    assert.ok(stderr.trim().length > 0, '这也是一次 fail open，必须留痕，不能悄悄退出')
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /(H2|就绪)/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
