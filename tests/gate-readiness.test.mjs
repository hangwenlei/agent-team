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
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

// ——— M3b「坏指针的窗口」：H2 是四个消费方里**行为一个字没变**的那一个 ———
//
// H2 不按 ctx.kind 分派**行为**（两种 kind 都 fail open），只分派**措辞**。本轮把
// 「current-run 指向的 run 目录不存在」从 no-run 挪去 unreadable 之后，H2 在这个
// 输入状态下仍然放行、仍然留痕，变的只有那半句话：从「当前没有进行中的 run」
// 变成「读不到运行上下文」。**而那两句对读到它的人不是同一件事**——前者是门禁做出
// 了一个有依据的判定（本次调用不归它管），后者是门禁自己判不出来，说明有东西坏了。
// 坏指针属于后者，所以这次措辞变化本身就是修复的一部分，不是副作用。
// 锚到「检查项名：措辞（」这个位置才有判别力（手法与 tests/gate-writepath.test.mjs
// 里 no-run 措辞那一条同一份）：ctx.reason 自己不含这两句中的任何一句，单查几个字
// 会让 failOpenNotice 的三元塌成任一支都照样绿。
// ——— M3c「丢指针」：这一格在 H2 上与坏指针同一个出口，措辞也一起变 ———
//
// 沿着**输入状态**横着走一遍消费方（docs/16 §3.12）时补的那一格。H2 仍然 fail open、
// 仍然留痕，变的只有那半句话：这一格从「当前没有进行中的 run」变成「读不到运行上下文」
// ——而 runs/r1/ 就在那里、state.json 完好，说「没有进行中的 run」会把人指向一个
// 不存在的问题。锚到「检查项名：措辞（」这个位置才有判别力，手法与下面那条同一份。
test('readiness：丢指针时仍然 fail open，措辞同样说「读不到运行上下文」', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } }
    const { stdout, stderr, status } = run('readiness', input, undefined, dirs.projectDir)

    assert.equal(status, 0, 'H2 是 fail open：收窄改的是 H3/H4，不该把 H2 也变成拦截')
    assert.equal(stdout.trim(), '', 'H2 在这里不该 deny')
    assert.match(
      stderr,
      /H2 就绪门禁：读不到运行上下文（/,
      '指针没了而 runs/ 下的 run 完好，这是「门禁自己判不出来」，不是「没有进行中的 run」',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
test('readiness：坏指针时仍然 fail open，但措辞说「读不到运行上下文」——H2 的行为不随 kind 变，措辞随', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } }
    const { stdout, stderr, status } = run('readiness', input, undefined, dirs.projectDir)

    assert.equal(status, 0, 'H2 是 fail open：收窄改的是 H3/H4，不该把 H2 也变成拦截')
    assert.equal(stdout.trim(), '', 'H2 在这里不该 deny')
    assert.match(
      stderr,
      /H2 就绪门禁：读不到运行上下文（/,
      '坏指针是「门禁自己判不出来」，不是「没有进行中的 run」——run 是有人开过的，' +
        '指针还在那里，坏的是它指向的东西',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// ——— M3w（docs/31，全量审查第 13 条）：at-ui 按派发者选段 ———
//
// 纯函数那一层在 tests/readiness.test.mjs。这里钉的是门禁把派发者（hook 输入的 agent_type）与花名册的触达接进去了：
// 忘了传派发者或触达时，第一格会退回老规则、按 S5 拒。
const dispatchUi = (caller) => ({
  hook_event_name: 'PreToolUse', tool_name: 'Agent', agent_type: caller, tool_input: { subagent_type: 'agent-team:at-ui', prompt: 'x' },
})
const S2_DONE = ['00-contract.md', '01-prd.md', '02-ui-spec.md', '02-wireframe.html']
const withRun = (opts, body) => {
  const dirs = makeRun({ runId: 'r1', ...opts })
  try {
    return body(dirs)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('readiness（M3w）：S2 已齐之后 at-product 让 at-ui 返修——放行（此前按 S5 的前置拒）', () => {
  withRun({ stage: 'S2', roster: ['at-product', 'at-ui'], artifacts: S2_DONE }, (dirs) => {
    const { stdout } = run('readiness', dispatchUi('agent-team:at-product'), undefined, dirs.projectDir)
    assert.equal(stdout, '', stdout)
  })
})

test('readiness（M3w）：S2 被裁、stage 是 S5、04-dispatch.md 缺，架构师派 at-ui——拒，理由点名 04-dispatch.md（此前放行）', () => {
  withRun({ stage: 'S5', roster: ['at-product', 'at-architect'], trimmed: { 'at-ui': 'S2' }, artifacts: ['00-contract.md', '01-prd.md', '03-arch.md', '03-alignment.md'] }, (dirs) => {
    const out = decisionOf(run('readiness', dispatchUi('agent-team:at-architect'), undefined, dirs.projectDir).stdout)
    assert.equal(out?.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /04-dispatch\.md/)
  })
})

test('readiness（M3w）：S2 只交了一半、stage 是 S3——架构师派 at-ui 拒（S5 的前置），at-product 派它补 S2 放行', () => {
  withRun({ stage: 'S3', roster: ['at-product'], artifacts: ['00-contract.md', '01-prd.md', '02-ui-spec.md'] }, (dirs) => {
    const arch = decisionOf(run('readiness', dispatchUi('agent-team:at-architect'), undefined, dirs.projectDir).stdout)
    assert.equal(arch?.permissionDecision, 'deny')
    assert.match(arch.permissionDecisionReason, /S5/)
    assert.equal(run('readiness', dispatchUi('agent-team:at-product'), undefined, dirs.projectDir).stdout, '')
  })
})

// 派发者不在花名册里（别的插件的代理、用户自己的 subagent）：H1 对它放行，前置只有 H2 在查。不剪、也不因此放行或崩溃——
// 两格：前置缺照样拒；派多段角色时退回老规则，那一段前置齐了就放行（R3 那一行在门禁层就是这里走得到），stderr 为空。
test('readiness（M3w）：派发者不在花名册里——前置缺照样拒；派 at-ui、只有契约时按老规则放行，不崩', () => {
  withRun({ stage: 'S5', artifacts: ['00-contract.md', '01-prd.md', '03-arch.md'] }, (dirs) => {
    const be = { ...dispatchUi('other-plugin:helper'), tool_input: { subagent_type: 'agent-team:at-backend', prompt: 'x' } }
    const out = decisionOf(run('readiness', be, undefined, dirs.projectDir).stdout)
    assert.equal(out?.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /04-dispatch\.md/)
  })
  withRun({ stage: 'S2', artifacts: ['00-contract.md'] }, (dirs) => {
    const r = run('readiness', dispatchUi('other-plugin:helper'), undefined, dirs.projectDir)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '')
  })
})

// 花名册里某条派发边的元素不是字符串（{"toString":1} 这种）：M3w 起 H2 每次派发都要算触达，computeReach 在这个形状上抛过
// 异常、H2 对所有派发 fail open（H1 照常放行合法的边）。reach.mjs 现在跳过不是字符串的元素。插件副本里改 roster.json。
test('readiness（M3w）：花名册的派发边里混进一个不是字符串的元素——H2 照常判，不崩', () => {
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-h2-roster-')))
  try {
    const repo = new URL('../', import.meta.url)
    cpSync(new URL('hooks', repo), join(plugin, 'hooks'), { recursive: true })
    cpSync(new URL('stages.json', repo), join(plugin, 'stages.json'))
    const roster = JSON.parse(readFileSync(new URL('roster.json', repo), 'utf8'))
    roster['at-pm'].can_delegate_to.push({ toString: 1 })
    writeFileSync(join(plugin, 'roster.json'), JSON.stringify(roster), 'utf8')
    withRun({ stage: 'S4', artifacts: ['00-contract.md', '01-prd.md'] }, (dirs) => {
      const be = { ...dispatchUi('agent-team:at-architect'), tool_input: { subagent_type: 'agent-team:at-backend', prompt: 'x' } }
      const r = run('readiness', be, join(plugin, 'hooks', 'boot.mjs'), dirs.projectDir)
      assert.equal(decisionOf(r.stdout)?.permissionDecision, 'deny', r.stderr)
      assert.doesNotMatch(r.stderr, /异常崩溃/)
    })
  } finally {
    rmSync(plugin, { recursive: true, force: true })
  }
})

test('readiness（M3w）：stage 没推进（停在 S2）、S2 已齐、03/04 缺——架构师派 at-ui 拒，与 at-backend 一致', () => {
  withRun({ stage: 'S2', roster: ['at-product', 'at-ui'], artifacts: S2_DONE }, (dirs) => {
    for (const target of ['agent-team:at-ui', 'agent-team:at-backend']) {
      const input = { ...dispatchUi('agent-team:at-architect'), tool_input: { subagent_type: target, prompt: 'x' } }
      assert.equal(decisionOf(run('readiness', input, undefined, dirs.projectDir).stdout)?.permissionDecision, 'deny', target)
    }
  })
})
