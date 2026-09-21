// H5a/H5b 在 gate.mjs 里，tests/deliverable.test.mjs 覆盖不到的逻辑：
// decideDeliverable 是纯函数，从不知道 ctx.ok 是什么、从不知道 stop-gate
// 该读 input.agent_type 还是 input.tool_input.subagent_type、也从不经过
// denyAndExit 或往 stdout 写 H5a 的 warning JSON——这些全部活在 gate.mjs
// 自己的 CHECK === 'stop-gate' / 'deliverable' 分支里。结构照抄
// tests/gate-contract.test.mjs（Task 3 评审 Important 1 的教训：纯函数
// 测试和"入口传导链"测试要分别覆盖）。
//
// 这份文件存在的第一个理由：stop-gate 真正拒绝（exit 2）这条分支，在
// Task 6 之前从没有被任何测试真正执行到过——tests/gate-dispatch.test.mjs
// 里那条"若拒绝"测试只在干净环境下跑，status 恒为 0，`if (status === 2)`
// 里的断言从没被执行过（Task 1 评审发现的问题，Task 6 简报点名要求补上）。
// 下面第一条测试造一个产物真的缺失的 run，无条件断言 status === 2，不是
// 套在 if 里面。
//
// 这份文件存在的第二个理由：H5a（deliverable）要查的是"刚被派发、已经
// 返回的那个目标角色"，不是"发起这次 Agent 调用的调用者"——两者是
// PostToolUse 输入里两个不同的字段（tool_input.subagent_type vs.
// agent_type）。这是纯函数测试完全看不见的一类错误：decideDeliverable
// 只管"给定一个 role，它的交付物齐不齐"，至于 gate.mjs 从输入里挖出的
// 这个 role 到底是不是"应该被检查的那个角色"，只有跑一次真实的子进程、
// 用一个调用者与目标不同的场景才能验出来。
//
// 夹具的取舍（整理项 11，照 tests/gate-writepath.test.mjs:12-20 那份补齐）：
// 下面每条测试都用 makeRun() 造出 { projectDir, pluginDir } 并在 finally 里
// 清理两者，但 pluginDir 从没有被真正读到过——gate.mjs 的 ROOT = join(HERE,'..')
// 是硬编码的真实仓库根，读的是仓库根那份真实 stages.json，测试帮手改不了它
// （Task 2 的设计）。继续调用 makeRun 并清理 pluginDir 只是为了不在系统临时
// 目录里留垃圾，不代表这些测试控制了 stages.json 的内容。所以这份文件里每一条
// 关于"谁在哪一段该产出什么"的断言，判据都是仓库根真实 stages.json 里的事实：
// S1 是 at-pm/00-contract.md、S2 是 at-product/01-prd.md、S4 是
// at-pm/04-dispatch.md——改 stages.json 会连带影响这些测试，这是有意的耦合，
// 不是夹具漏配。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { REAL_STAGES, whoCanReach } from './helpers/stage-role-reach.mjs'

// ---- H5b（stop-gate，SubagentStop）----

test('stop-gate：产物真的缺失时真拦截——exit 2，stderr 点名阶段与文件（此前从未被任何测试真正执行到的分支）', () => {
  const dirs = makeRun({ runId: 'r1' }) // 不建任何 artifacts，at-product 在 S2 的产物必然缺失
  try {
    const input = { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' }
    const { stdout, stderr, status } = run('stop-gate', input, undefined, dirs.projectDir)

    assert.equal(status, 2, 'H5b 真拦截必须走 exit 2，不是别的退出码')
    assert.equal(stdout, '', 'SubagentStop 的拒绝不该往 stdout 写 PreToolUse 那套 JSON')
    assert.ok(stderr.length > 0, 'exit 2 时理由必须写在 stderr 里')
    assert.match(stderr, /S2/, '理由要点名阶段，角色才知道是哪一段没完成')
    assert.match(stderr, /01-prd\.md/, '理由要点名具体缺的文件，不能只说"有产物缺失"')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('stop-gate：产物已经写到磁盘时放行，不拦截、不留任何告警', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['01-prd.md'] })
  try {
    const input = { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' }
    const { stdout, stderr, status } = run('stop-gate', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout, '')
    assert.equal(stderr, '', '产物齐全时不该有任何告警——告警只在门禁坏了或真拦截时才出现')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('stop-gate：没有 run 时 fail open 并在 stderr 留痕，不是静默放行也不是真拦截', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h5b-norun-cwd-'))
  try {
    const input = { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' }
    const { stdout, stderr, status } = run('stop-gate', input, undefined, cwd)

    assert.equal(status, 0, 'H5b fail open：读不到运行上下文不能真拦截')
    assert.equal(stdout, '')
    assert.ok(stderr.trim().length > 0, '必须往 stderr 留痕；静默的放行和门禁坏掉长得一模一样')
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /(H5b|交付物)/)
    assert.match(stderr, /current-run/, 'stderr 里应带上 readRunContext 给出的具体原因')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('stop-gate：run 存在但 state.json 坏了（kind: unreadable）——同样 fail open + 留痕，不按 kind 区别对待', () => {
  // 跟 H3/H4 不一样：H5 从头到尾没有 fail closed 的那一半，不需要像
  // writepath/contract 那样按 ctx.kind 分派——no-run 与 unreadable 在 H5
  // 这里是同一种处理。这条用一个真实存在但读不出来的 run 证明这一点。
  const dirs = makeRun({ runId: 'r1' })
  try {
    writeFileSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json'), '{ not json', 'utf8')
    const input = { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' }
    const { stdout, stderr, status } = run('stop-gate', input, undefined, dirs.projectDir)

    assert.equal(status, 0, 'H5 没有 fail closed 的一半，unreadable 也要放行')
    assert.equal(stdout, '')
    assert.ok(stderr.trim().length > 0)
    assert.match(stderr, /agent-team/)
    // 复评 Minor 2：这是 failOpenNotice 里那条 kind 三元的另一支。与
    // tests/gate-writepath.test.mjs 里 no-run 那条配对——两条都在，三元塌成
    // 任何一个单一字符串、或者两支调换，必定有一条变红。
    // 这里锚定的是"读不到运行上下文"：run 目录真实存在，坏的是 state.json，
    // 门禁确实判不出来，不能说成"当前没有进行中的 run"（那会让人去查
    // current-run，而真正坏的是别的文件）。
    assert.match(
      stderr,
      /H5b 交付物拦截：读不到运行上下文（/,
      'unreadable 的措辞要说"读不到运行上下文"，不能说成"没有进行中的 run"——run 就在那里',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('stop-gate：agent_type 缺失时放行——没有可判定的目标角色', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = { hook_event_name: 'SubagentStop' }
    const { stdout, stderr, status } = run('stop-gate', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout, '')
    assert.ok(stderr.trim().length > 0, '认不出目标角色也要留痕，不能悄悄放行')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// ---- H5a（deliverable，PostToolUse / Agent）----

test('deliverable：查的是被派发的目标角色（tool_input.subagent_type），不是发起调用的 agent_type', () => {
  // at-pm 派发给 at-product；at-pm 自己在 S1 的产物（00-contract.md）已经
  // 齐全，at-product 在 S2 的产物（01-prd.md）缺失。如果代码读错字段（读成
  // 了 agent_type，也就是这里的调用者 at-pm），会去查 at-pm 自己的阶段：
  // S1 已完成、接着查到 S4（at-pm 也是 S4 的角色），S4 的产物
  // 04-dispatch.md 同样缺失，于是会报出一个完全不相关的阶段（S4），而不是
  // 这次真正应该被检查的角色（at-product/S2/01-prd.md）——两种字段读法都
  // 会产生"非 ok"的结果，唯一能分辨对错的是消息里点名的到底是谁。
  const dirs = makeRun({ runId: 'r1', artifacts: ['00-contract.md'] })
  try {
    const input = {
      tool_name: 'Agent',
      agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-product' },
    }
    const { stdout, status } = run('deliverable', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'H5a 从不拒绝，只记 warning')
    assert.ok(out, '目标角色的产物缺失时必须有 warning，stdout 不该是空的')
    assert.equal(out.hookEventName, 'PostToolUse')
    assert.match(out.additionalContext, /at-product/, '点名的必须是被派发的目标角色，不是发起调用的 at-pm')
    assert.match(out.additionalContext, /S2/)
    assert.match(out.additionalContext, /01-prd\.md/)
    assert.doesNotMatch(
      out.additionalContext,
      /S4|04-dispatch/,
      '不能报成调用者 at-pm 自己在 S4 的阶段——那是读错字段（读了 agent_type 而不是 ' +
        'tool_input.subagent_type）才会出现的症状',
    )

    // 13(c)：这是整条分支上唯一没有测试保护的平台契约。「在 PostToolUse 上发
    // permissionDecision 形状 = exit 0 + 平台不认的 blob = 看起来健康的空操作」
    // 这句话被写进了简报、写进了 hooks/lib/deny.mjs 的头部注释、写进了三个
    // 测试文件的注释，唯独没有一行断言。H5a 按规格 §6 表格只记 warning、从不
    // 拒绝，所以它的 stdout 里出现 permissionDecision 本身就是错的——不管那个
    // 值是 'deny' 还是 'allow'。在整个 stdout 上查，不只在 hookSpecificOutput
    // 里查：放在哪一层都是错的。
    assert.ok(
      !('permissionDecision' in out),
      'H5a 是 PostToolUse，不能发 PreToolUse 专有的 permissionDecision——平台不认，' +
        '等于 exit 0 + 一坨没人读的 JSON，这道闸会变成看起来健康的空操作',
    )
    assert.doesNotMatch(stdout, /permissionDecision/)

    // 这条 warning 存在的全部理由：H5b 到点（约 9 次）会被平台静默放行，父级
    // 看到的是干净的一次通过。文案必须点明"不要仅凭子代理正常返回就判断这一段
    // 完成了"，否则它退化成一句无害的提示，读的人不会去核实产物。
    assert.match(out.additionalContext, /不要仅凭/)
    assert.match(out.additionalContext, /核实/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// Task 2 修复轮 1：单一真源这个交付物要求的不只是「trusted.mjs 自己的单测通过」，
// 还要「gate.mjs 三处真实调用点的真实输出确实以它开头」——否则重构可以被悄悄
// 塌回硬编码字面量（且可能带一个字的漂移）而没有任何测试发现。这条钉的是
// hooks/gate.mjs:586（H5a 真实缺产物告警）。复用上面那条测试的同一份夹具与
// 输入——已经确认过这个场景会走到这条分支（at-product 在 S2 缺 01-prd.md）。
// 用 startsWith，不用 includes。
test('deliverable 的缺产物告警（H5a 真实记录）真实输出以受信前缀开头', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['00-contract.md'] })
  try {
    const input = {
      tool_name: 'Agent',
      agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-product' },
    }
    const { stdout } = run('deliverable', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)
    assert.ok(out.additionalContext.startsWith(TRUSTED_PREFIX))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('deliverable：目标角色已经写出产物——stdout 为空，不记 warning', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['00-contract.md', '01-prd.md'] })
  try {
    // Task 4（账本比对）补丁：makeRun 的 artifacts 参数只把文件写到磁盘，state.json 的
    // artifacts 账本永远是 {}（tests/fixtures/make-run.mjs 里硬编码，与传了哪些
    // artifacts 无关）。这条测试的名字承诺的是"交付且一切正常时沉默"，在 Task 4 之前
    // 这句承诺无法被这份夹具准确代表——没有任何检查项会看账本，磁盘上有没有记录不影响
    // 结果。Task 4 加了账本比对之后，"文件在磁盘、账本没记"这个形状本身就是"对不上账"
    // 的定义（磁盘上有产物但 artifacts 里没记 → unrecorded，见下面 Task 4 那组新测试），
    // 会被如实报出来，不再是沉默的那一支。这条测试要验的是"记账也对得上时沉默"这个更窄
    // 的场景，不是"不管账本记没记都沉默"（后者现在是假的，会被下面新增的测试戳穿）——
    // 所以在这里把账本补成与磁盘内容一致，让夹具真正代表测试名字承诺的场景，而不是
    // 悄悄依赖"没人检查账本"这个已经不再成立的前提。
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.artifacts = {
      '00-contract.md': sha256OfContract('fixture 00-contract.md\n'),
      '01-prd.md': sha256OfContract('fixture 01-prd.md\n'),
    }
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    const input = {
      tool_name: 'Agent',
      agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-product' },
    }
    const { stdout, status } = run('deliverable', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout, '')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('deliverable：没有 run 时 fail open 并在 stderr 留痕，不写 warning JSON', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h5a-norun-cwd-'))
  try {
    const input = {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'agent-team:at-product' },
    }
    const { stdout, stderr, status } = run('deliverable', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(stdout, '', '没有 run 时不该往 stdout 写 warning JSON')
    assert.ok(stderr.trim().length > 0)
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /(H5a|交付物)/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('deliverable：tool_input.subagent_type 缺失时放行、且留痕——不能退而求其次读成调用者自己', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = { tool_name: 'Agent', agent_type: 'at-pm', tool_input: {} }
    const { stdout, stderr, status } = run('deliverable', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout, '')
    // 13(b)：原来只验了"放行"，没验留痕——而它的 stop-gate 孪生用例
    // （上面"agent_type 缺失时放行"那条）验了。这是一次 fail open：这次事件
    // 确实归 H5a 管，只是认不出该查谁，跟"这次调用与本检查项无关"（那种在
    // toolNames 前置校验里就静默退出了）不是一回事，必须留痕。
    assert.ok(stderr.trim().length > 0, '认不出目标角色也要留痕，不能悄悄放行')
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /(H5a|交付物)/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 13(a)：stderr 也要是空的。只断言 status === 0 与 stdout === '' 的话，把
// checks.mjs 的 toolNames 前置校验拿掉后代码会走下面的 !rawTarget 分支
// （stderr 留痕 + exit 0），这两条断言照样绿——测试名承诺的"不表态"其实
// 一件没验。"不表态"是真的什么都不输出：与本检查项无关的调用连一行告警都
// 不该有，否则每次 Bash 调用都在会话里刷一行 H5a 的噪音。
test('deliverable：tool_name 不是 Agent 时不表态——三条流都是空的，不是"换个地方出声"', () => {
  const { stdout, stderr, status } = run('deliverable', { tool_name: 'Bash', tool_input: {} })
  assert.equal(status, 0)
  assert.equal(stdout, '')
  assert.equal(
    stderr,
    '',
    '与本检查项无关的工具调用必须完全沉默——落进 !rawTarget 那条 fail open 分支' +
      '（它会往 stderr 留痕）说明 toolNames 前置校验没有生效',
  )
})

// ---- state.stage 与被派角色对不上（M1b Task 7 的新失效形状）----

test('state.stage 与被派角色对不上时 H5a 发 warning，而不是静默放行', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-architect',
      tool_input: { subagent_type: 'agent-team:at-backend' },
    }, GATE, projectDir)
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /没有意见/)
    assert.match(ctx, /S2/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ---- 合法的层级协调者不该被报成异常（M1b 终审 C4）----
//
// commands/at.md 的 S5 正路是「派 at-architect，由它去分发执行角色」（at-pm 派不动
// at-backend），而 stages.json 的 S5.role 是 at-backend。于是 at-architect 在
// state.stage === 'S5' 时返回，必然落进 skipped:'role-not-in-stage'——原来的 H5a
// 会在这条正路上每次都发 warning，而它给出的两种「可能」在这里都是假的。更糟：
// 最坏的一种「修复」是 PM 把 state.stage 改回 S3 去消警告，那会真的让 H5 对整个 S5
// 全程哑火——这条告警有能力制造它自己警告的那个失效。
//
// 两条各占一个 test()，因为它们验的是这条新判据的两侧（排掉谁、留下谁），
// 不是同一个断言形状遍历互不耦合的数据点。都是子进程级：isCoordinatorFor 活在
// gate.mjs 里，decideDeliverable 这个纯函数从不知道花名册长什么样。
//
// ⚠️ **M2b Task 3 之后，S5 的静默面真的只剩 at-architect 了。** 这段注释上一版写的是
// 「被静默的不止它——当前花名册下 at-product 在 state.stage === 'S5' 时同样静默（它的
// can_delegate_to 含 at-backend，落在协调者一侧）」。那句话现在**整段不成立**：本任务
// 按规格 §4 把 at-product 的 can_delegate_to 从 ["at-backend"] 改成了 ["at-ui"]（S2 是
// 「at-product → at-ui」，S5 的分发是 at-architect 的事），at-product 因此不再传递派得到
// at-backend，也就不再落在协调者一侧。
//
// 这段改动不会让任何测试变红——它是注释。留着它就是留一句假话，而这个仓库里错的注释
// 活得比代码久（docs/11 里好几条教训都是这么来的），所以手动改掉。
//
// 上一版最后一句「扩链到 S6–S8 时要回来重算这个集合（stages.README.md 记了）」——那一天
// 就是 M2b Task 3。重算过了：判据仍然是「能传递派到 stages[state.stage].role」，新的
// 八行静默表在 stages.README.md 的「H5a 的静默集合」一节，tests/gate-deliverable.test.mjs
// 下面那组「静默表逐行」测试逐行钉着它。
test('S5 派 at-architect 去分发（正路）：H5a 不发 warning——它是合法的协调者', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const { stdout, status } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-architect' },
    }, GATE, projectDir)
    assert.equal(status, 0)
    assert.equal(
      stdout,
      '',
      'at-architect 能（传递地）派到 S5 的执行角色 at-backend，这是 commands/at.md ' +
        '规定的 S5 正路，不是异常——在正路上每次都刷一条 warning，最省事的消警告方式' +
        '正好是把 state.stage 改回旧阶段，那会真的让 H5 对整个 S5 哑火',
    )
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('S5 返回的是一个派不到执行角色的角色（at-outsider）：H5a 照发 warning', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const { stdout, status } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-outsider' },
    }, GATE, projectDir)
    assert.equal(status, 0)
    // 正向锚点：上一条是「stdout 为空」这种否定断言，单独立不住——必须有一条
    // 证明同样的夹具下 warning 真的还能发出来，否则把整条 warning 删掉两条都绿。
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /没有意见/)
    assert.match(ctx, /at-outsider/)
    assert.match(ctx, /S5/)
    // roster.json 里 at-outsider 的 can_delegate_to 是空——它派不到任何人，更不是
    // 协调者。文案要点明这一点，否则读到的人会以为它跟 at-architect 是一回事。
    assert.match(ctx, /派不到/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// Task 2 修复轮 1：单一真源这个交付物要求的不只是「trusted.mjs 自己的单测通过」，
// 还要「gate.mjs 三处真实调用点的真实输出确实以它开头」——否则重构可以被悄悄
// 塌回硬编码字面量（且可能带一个字的漂移）而没有任何测试发现。这条钉的是
// hooks/gate.mjs:553（role-not-in-stage 且非协调者的哑火告警）。复用上面那条
// 测试的同一份夹具与输入——已经确认过这个场景会走到这条分支。用 startsWith，
// 不用 includes。
test('deliverable 的哑火告警（role-not-in-stage 非协调者）真实输出以受信前缀开头', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-outsider' },
    }, GATE, projectDir)
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.ok(ctx.startsWith(TRUSTED_PREFIX))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ---- loadRoster() 读坏 roster.json 时的留痕（docs/11 §1.4，M2a Task 8）----
//
// isCoordinatorFor 是 deliverable 分支里第一处、也是这条路径上唯一一处会读
// roster.json 的地方（见 hooks/gate.mjs 里 loadRoster 上方注释）。roster.json
// 读坏时，loadRoster() 现在自己 catch、留一行点名 roster.json 的痕、退回空花名册
// {}——而不是让异常一路抛给 gate.mjs 最外层 try/catch 的通用兜底 crashNotice
// （hooks/lib/deny.mjs）：那条兜底不点名具体是哪个文件读坏，而且会让这次检查项
// 里其它已经算好但还没发出去的信号（比如账本比对）跟着一起报废，不是同一件事。
//
// ⚠️ 不能直接改写仓库根那份真实 roster.json、跑完再 cp 换回来：node --test 默认
// 把不同测试文件各自起一个独立进程、并发执行——实测过两个测试文件的执行窗口
// 确有重叠（每个文件不是排队等前一个跑完才开始）。本仓库另有
// tests/gate-io.test.mjs 用真实 GATE 连续跑 13 次 'delegation'，同样会读这份
// 文件；如果这里真的去改仓库根的 roster.json，会在那份文件的进程里偶发地撞见
// 一份临时损坏的 roster.json——是这条测试自己会制造的新的不稳定，"cp 备份"只能
// 保证事后把内容恢复，不能保证损坏期间没有别的进程正在读它。
//
// 改用 makeRun() 已经准备好、但从没被接上过的 pluginDir：把仓库真实 hooks/
// 整份复制进去（gate.mjs 的 ROOT 由它自己文件的路径反推，复制之后这份拷贝的
// ROOT 就是这个临时目录，不再是仓库根），stages.json 直接照抄仓库根的真实内容
// （结构必须跟 decideDeliverable 等期望的一致，抄真实的最不容易漂移）——只有
// roster.json 是这条测试自己写的坏 JSON。全程不碰仓库根那份真实文件，没有
// 可能泄漏到别的进程的共享状态。
function makeIsolatedRosterFixture(rosterText) {
  const realStages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const dirs = makeRun({ runId: 'r1', stage: 'S5', stages: realStages })
  cpSync(new URL('../hooks', import.meta.url), join(dirs.pluginDir, 'hooks'), { recursive: true })
  writeFileSync(join(dirs.pluginDir, 'roster.json'), rosterText, 'utf8')
  return { ...dirs, gate: join(dirs.pluginDir, 'hooks', 'gate.mjs') }
}

function runDeliverableAgainstIsolatedRoster(rosterText) {
  const dirs = makeIsolatedRosterFixture(rosterText)
  try {
    return run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-outsider' },
    }, dirs.gate, dirs.projectDir)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('loadRoster() 读到坏 JSON 时：deliverable 检查仍然 exit 0——读坏是 fail open，不是新长出来的安全边界', () => {
  const { status } = runDeliverableAgainstIsolatedRoster('{ 这不是合法 JSON ]')
  assert.equal(status, 0)
})

test('loadRoster() 读到坏 JSON 时：stderr 非空——不能是零 stdout、零 stderr 的静默放行', () => {
  const { stderr } = runDeliverableAgainstIsolatedRoster('{ 这不是合法 JSON ]')
  assert.ok(stderr.length > 0)
})

// ⚠️ 判据不能用 /roster\.json/：gate.mjs 最外层 try/catch 的通用兜底 crashNotice
// 文案本身也提到"先检查 roster.json 与 stages.json 能否被 JSON.parse"，那个字面量
// 是两处共有的词汇，抓不住"到底是 loadRoster 自己的 catch 接住的，还是走到了
// 最外层通用兜底"这个区别（下面变异验证会证实：删掉 loadRoster 的 try/catch 之后，
// 这份夹具会改由最外层通用兜底接住，stderr 依然非空、依然提到 roster.json——上面
// 两条测试对这个变异不敏感，必须靠这一条）。改用"读不出来"——这个词只在
// loadRoster 自己的 catch 文案里出现，通用兜底文案里没有。
test('loadRoster() 读到坏 JSON 时：stderr 用 loadRoster 自己的文案（"读不出来"），不是最外层通用崩溃兜底接住的', () => {
  const { stderr } = runDeliverableAgainstIsolatedRoster('{ 这不是合法 JSON ]')
  assert.match(stderr, /读不出来/)
})

// 正向自检锚（docs/11 §3.3 第 2 条）：上面三条证明的是"读坏时有痕"，但没证明这个
// 隔离夹具本身搭对了——如果复制 hooks/ 漏了文件、或者 ROOT 反推的路径不对，上面
// 三条可能是因为"随便什么原因这个子进程都跑不起来"才通过，不是因为 loadRoster
// 真的捕获了这次 JSON.parse 失败。这里换一份仓库根真实的 roster.json 内容喂给
// 同一个隔离夹具，证明它在正常输入下能正常跑完、不落进读坏分支——stderr 应为空。
test('自检：同一个隔离夹具换成仓库根真实的 roster.json 内容后，stderr 是空的——上面三条不是因为夹具本身坏了才非空', () => {
  const realRoster = readFileSync(new URL('../roster.json', import.meta.url), 'utf8')
  const { stderr } = runDeliverableAgainstIsolatedRoster(realRoster)
  assert.equal(stderr, '')
})

// ---- H5a：扩链后「可达性」单独不再充分 —— 必须再看「当前阶段是否已经 done」
// （M2a Task 6，docs/11 §1.1 点名的入口条件）----
//
// 上面那组测试证明了「协调者返回时静默」；但那是 M1 的判据，只到 S5 为止有效——S5 是
// M1 的最后一段，「state.stage 停在 S5」这个形状在 M1 里根本走不到。接上 S6–S8 之后，
// 实际在 S6、state.stage 却还停在 S5 时，任何能传递派到 at-backend 的协调者返回都会
// 被静默——那正是「停在旧阶段」的标准形状，也正是这条告警存在的理由。
// hooks/gate.mjs 的判据因此从 `!coordinator` 改成 `!coordinator || stageDone`：
// 协调者身份只回答「这次返回本身合不合法」，「当前阶段是否已经 done」是第二个独立信号，
// 两者都要问。
//
// 三行真值表各占一个 test()（docs/11 §3.3 第 1 条：变异验证里期望变红的断言必须自己
// 占一个 test()）。三份夹具的关键字段集中声明在这里，测试与下面的锚点读同一份数据，
// 不是锚点自己抄一份可能漂移的描述。
const H5A_STAGE_DONE_FIXTURES = {
  coordinatorNotDone: { stage: 'S5', roster: ['at-backend'], diskArtifacts: [] },
  coordinatorDone: { stage: 'S5', roster: ['at-backend'], diskArtifacts: ['05-impl/at-backend.md'] },
  nonCoordinator: { stage: 'S5', roster: ['at-outsider'], diskArtifacts: [] },
}

test('H5a：协调者返回且当前阶段未 done —— 静默（这是合法的层级协调）', () => {
  const f = H5A_STAGE_DONE_FIXTURES.coordinatorNotDone
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: f.stage, artifacts: f.diskArtifacts })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = f.roster
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    // at-architect 能（传递地）派到 S5 的执行角色 at-backend——合法的层级协调；
    // 05-impl/at-backend.md 磁盘上还没有，当前阶段没有 done。两条真值合起来是
    // 「协调者 + 未 done」，判据的第一行：仍然静默。
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-architect' },
    }, GATE, projectDir)

    assert.equal(stdout, '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('H5a：协调者返回但当前阶段已经 done —— 报（这正是「停在旧阶段」）', () => {
  const f = H5A_STAGE_DONE_FIXTURES.coordinatorDone
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: f.stage, artifacts: f.diskArtifacts })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = f.roster
    // 账本记录与磁盘内容对齐（哈希对得上），让这条测试只钉「stageDone 分支的 h5a
    // 措辞」这一件事，不夹带账本比对（Task 4，独立信号）的 unrecorded 噪音——两者
    // 谁报不报是分开的问题，见下面 emitLedger 调用点与 docs/11 §5.8。
    state.artifacts = { '05-impl/at-backend.md': sha256OfContract('fixture 05-impl/at-backend.md\n') }
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    // 同样是 at-architect 返回，同样能传递派到 at-backend——协调者身份没变。变的是
    // 05-impl/at-backend.md 这次真的在磁盘上：当前阶段（S5）的产物已经全部齐备，
    // isStageDone 为真。「协调者」不再是充分的静默理由，这正是判据新增的那一半要抓的
    // 「停在旧阶段」。断言直接匹配原始 stdout（不先 JSON.parse）：删掉 `|| stageDone`
    // 之后这里会静默、stdout 变成空字符串，match 在空字符串上干净地失败，不会被
    // JSON.parse('') 的异常掩盖真实的失败原因。
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-architect' },
    }, GATE, projectDir)

    // ⚠️ 修复轮 1：这里原来钉的是 /停在旧阶段/——**两支文案都含这四个字**（非协调者那支
    // 写的是「state.stage 停在旧阶段没推进」），所以它证不了走的是协调者那支。改钉
    // 「这正是**停在旧阶段**」这个**协调者独有**的完整说法，同一条测试守的东西没变、
    // 甄别力补上了。两支措辞的完整对照见下面「H5a 告警的两支措辞」那一组。
    assert.match(stdout, /这正是\*\*停在旧阶段\*\*/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('H5a：非协调者返回 —— 报（判据这一半不变）', () => {
  const f = H5A_STAGE_DONE_FIXTURES.nonCoordinator
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: f.stage, artifacts: f.diskArtifacts })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = f.roster
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    // at-outsider 在花名册里 can_delegate_to 是空——派不到任何人，不是协调者。这一半
    // 判据（`!coordinator`）是 M1 就有的老行为，这次改动没有碰它，这条测试证明它还在。
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-outsider' },
    }, GATE, projectDir)
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext

    assert.match(ctx, /派不到/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 前三条的锚：如果三份夹具其实是同一个场景（比如复制粘贴时忘了改 roster），改一处
// 实现可能让三条一起绿而什么都没守住（docs/11 §3.3 第 1 条）。三次比较是同一种断言
// 形状遍历三对互不耦合的数据点，按规矩可以共占一个 test()。
test('前置条件：上面三条的夹具互不相同——否则三条测的是同一个场景', () => {
  const triples = Object.values(H5A_STAGE_DONE_FIXTURES).map((f) => [f.stage, f.roster, f.diskArtifacts])
  assert.notDeepEqual(triples[0], triples[1])
  assert.notDeepEqual(triples[0], triples[2])
  assert.notDeepEqual(triples[1], triples[2])
})

// ---- H5a 静默表第三次重算（M2b Task 3）：逐行钉住 stages.README.md 那八行 ----
//
// 这张表被重算过三次（M1b 终审提出、M2a Task 6 第一次实做、M2b Task 3 本次），每一次
// 都是被扩链或加边逼出来的，而前两次之后**没有任何测试钉着它**——上一版表里 S5 那一行
// 的「谁派得到它」写的是「at-architect、at-product（两个都会，不止 at-architect）」，
// 漏了 at-pm/__main__，还报了一个错的总数，从写下来那天起全绿到本任务。这一组补的就是
// 那个缺口：表的第三列（谁能传递派到该段的 role）逐行对着**真实 roster.json + stages.json**
// 算一遍。
//
// 判据的两个半边（`!coordinator || stageDone`）不在这一组里——它们是行为，由下面
// H5A_TOPOLOGY_BEHAVIOUR 那三条子进程级测试钉。这一组只钉拓扑事实，所以删掉
// `|| stageDone` 不会让这一组里任何一条变红（这是有意的：Step 8 变异 3 要求「只有钉那半
// 的那条红」）。
//
// 期望值是 computeReach 对改完之后的真实数据跑出来的输出，一行对一行；改 roster.json 的
// 任何一条边都会让对应的行变红，改的人必须回到 stages.README.md 的「H5a 的静默集合」
// 那一节把表一起更新——形状照 tests/reach.test.mjs 的拓扑锚。
// M2b 终审 A4：REAL_ROSTER / REAL_STAGES / whoCanReach 搬去
// tests/helpers/stage-role-reach.mjs。理由：这一轮给 stages.README.md 那张表本身也补了
// 守卫（tests/stages-readme.test.mjs），两个测试文件需要同一个推导——在第二个文件里把
// computeReach 那三行再拼一遍就是第二份知识。

// stages.README.md「H5a 的静默集合」那张表的第二、三列，八行。顺序与 computeReach 的
// 输出顺序（Object.keys(roster) 的顺序）一致，deepEqual 连顺序一起钉。
const H5A_SILENCE_TABLE = [
  { stage: 'S1', role: 'at-pm', reachedBy: [] },
  { stage: 'S2', role: 'at-product', reachedBy: ['__main__', 'at-pm'] },
  { stage: 'S3', role: 'at-architect', reachedBy: ['__main__', 'at-pm'] },
  { stage: 'S4', role: 'at-pm', reachedBy: [] },
  { stage: 'S5', role: 'at-backend', reachedBy: ['__main__', 'at-pm', 'at-architect'] },
  { stage: 'S6', role: 'at-qa', reachedBy: ['__main__', 'at-pm'] },
  { stage: 'S7', role: 'at-acceptance', reachedBy: ['__main__', 'at-pm'] },
  { stage: 'S8', role: 'at-pm', reachedBy: [] },
]

const tableFailHint = (stage) =>
  `静默表 ${stage} 行的「谁派得到它」与真实 roster.json/stages.json 算出来的对不上。` +
  '这不是让你改这条断言了事：这一列的变动会改变 H5a 判据第 1 条在这一段成不成立，' +
  '而那正是这张表存在的理由。先用 computeReach 对新花名册重算八行，确认差在哪一段、' +
  '是哪条边造成的，再同步更新 stages.README.md 的「H5a 的静默集合」那一节——' +
  '那里是这张表的单一真源，这组测试只是它的守卫。'

for (const row of H5A_SILENCE_TABLE) {
  test(`静默表 ${row.stage} 行（role = ${row.role}）：谁能传递派到它`, () => {
    assert.deepEqual(whoCanReach(row.stage), row.reachedBy, tableFailHint(row.stage))
  })
}

// ⭐ 锚一（钉在判据真正迭代的那个集合上）：上面八条各自只看自己那一行，**少一行不会有
// 任何人红**——S1/S4/S8 三行的期望值还是空数组，抽取/遍历退化成空集合时它们照样绿。
// 所以单独钉「这张表盖住的阶段集合恰好是 stages.json 的全部阶段」，迭代的是
// Object.keys(REAL_STAGES)（判据取 stages[stageId] 时迭代的正是这个集合），不是表自己。
test('锚：静默表盖住的阶段恰好是 stages.json 的全部阶段——少一段不会有任何一行变红', () => {
  assert.deepEqual(
    H5A_SILENCE_TABLE.map((r) => r.stage),
    Object.keys(REAL_STAGES),
    '静默表的阶段集合与 stages.json 对不上：扩链加了一段而表没跟上时，上面那组' +
      '「每行一条」一条都不会红，新那一段的静默与否于是从没有被算过',
  )
})

// ⭐ 锚二（正向自检）：S1/S4/S8 三行的期望值是空数组——whoCanReach 若因为任何原因恒返回
// 空集合（reach 结构改名、stageRole 取错字段、roster 读成空对象），那三行会空转着变绿。
// 这条证明同一个 whoCanReach 在真实数据上确实算得出非空的东西，并把八行的并集本身钉死。
test('锚：八行 reachedBy 的并集恰好是这三个角色——证明 whoCanReach 不是恒返回空集合', () => {
  const union = [...new Set(H5A_SILENCE_TABLE.flatMap((r) => whoCanReach(r.stage)))].sort()
  assert.deepEqual(union, ['__main__', 'at-architect', 'at-pm'])
})

// ⭐ 锚三：上面八行的 role 列是抄的，抄错了（比如 S6 写成 at-acceptance）上面那组仍然
// 全绿——whoCanReach 自己去 stages.json 取 role，根本不看表里抄的这一列。这条把抄的那
// 一列跟真源对上。
test('锚：静默表每一行抄的 role 与 stages.json 里那一段的 role 一致', () => {
  assert.deepEqual(
    H5A_SILENCE_TABLE.map((r) => [r.stage, r.role]),
    Object.entries(REAL_STAGES).map(([id, s]) => [id, s.role]),
  )
})

// ---- 新拓扑下的三条行为：判据两个半边各自还在不在 ----
//
// 上面那组是拓扑事实，下面这三条是行为，走真实子进程。三份夹具的关键字段集中声明在
// 这里，测试与末尾那条「夹具互不相同」的锚读同一份数据（M2a Task 6 的形状）。
const H5A_TOPOLOGY_BEHAVIOUR = {
  // M2b Task 3 造成的**新行为**：at-product 在 S5 返回，从「静默」变成「报」。
  // 去掉 at-product → at-backend 之后它不再是 S5 的协调者，走 !coordinator 那半。
  // ⚖️ 这条同时钉住裁定「保留 .role 单数」：换成「派得到该段任意一个 producer」那种口径，at-product
  // 会经 at-ui（S5 的 producer 之一）原路走回协调者集合、这个场景重新变静默——而
  // 「PM 停在 S5、at-product 返回」正是 H5a 存在的理由那个形状。裁定「保留 .role 单数」因此保留
  // 单数 .role：at-product → at-ui 是为 S2 存在的边，不是 S5 的实现分发。
  productNoLongerCoordinator: { stage: 'S5', returns: 'at-product', roster: [], diskArtifacts: [] },
  // 裁定「保留 .role 单数」定的口径（stages[stageId].role，单数）在 S2 的答案：at-architect 派得到
  // at-ui（本任务新加的边），而 at-ui 是 S2 的 producer 之一——但 S2.role 是 at-product，
  // 单数口径下它**不是**协调者，照报。另一种口径在这一段会给出相反的答案，被裁定「保留 .role 单数」
  // 否掉了（它有两个假阴性，而单数口径今天一个假阳性都没有：S2 的真协调者 at-product
  // 本身就是 producer，根本走不到 role-not-in-stage 这条分支）。完整裁定见 docs/11 §5.12。
  architectAtS2: { stage: 'S2', returns: 'at-architect', roster: [], diskArtifacts: [] },
  // stageDone 那半：协调者返回、但这一趟的产者（at-ui）已经把 S5 的产物交齐了。
  // 产者用 at-ui 而不是 at-backend，与上面 M2a Task 6 那三份夹具区分开。
  coordinatorDoneViaUi: { stage: 'S5', returns: 'at-architect', roster: ['at-ui'], diskArtifacts: ['05-impl/at-ui.md'] },
}

function runH5a(f, { ledger = null } = {}) {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: f.stage, artifacts: f.diskArtifacts })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = f.roster
    if (ledger) state.artifacts = ledger
    writeFileSync(statePath, JSON.stringify(state), 'utf8')
    return run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm',
      tool_input: { subagent_type: `agent-team:${f.returns}` },
    }, GATE, projectDir).stdout
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
}

// coordinatorDoneViaUi 那份夹具配套的账本：与磁盘内容对齐（哈希对得上），让钉「协调者
// 那支文案」的那几条测试不夹带账本比对的 unrecorded 噪音。三条测试读同一份，不各抄一遍。
const LEDGER_UI = { '05-impl/at-ui.md': sha256OfContract('fixture 05-impl/at-ui.md\n') }

test('H5a：at-product 在 S5 返回——现在照报（M2b Task 3 去掉 at-product → at-backend 之前是静默的）', () => {
  const stdout = runH5a(H5A_TOPOLOGY_BEHAVIOUR.productNoLongerCoordinator)
  assert.match(
    JSON.parse(stdout).hookSpecificOutput.additionalContext,
    /派不到/,
    'at-product 的 can_delegate_to 现在是 ["at-ui"]，它派不到 at-backend，不是 S5 的' +
      '协调者——这条走 !coordinator 那半。上一版花名册里它含 at-backend，同一个场景是静默的，' +
      'hooks/gate.mjs 的 isCoordinatorFor 上方曾经用整整一段解释这笔"固有代价"，那段已随本任务作废',
  )
})

test('H5a：at-architect 在 S2 返回——单数 .role 口径下不是协调者，照报', () => {
  const stdout = runH5a(H5A_TOPOLOGY_BEHAVIOUR.architectAtS2)
  assert.match(
    JSON.parse(stdout).hookSpecificOutput.additionalContext,
    /派不到/,
    'S2.role 是 at-product，at-architect 派不到它（它派得到的是 at-ui）。at-ui 同时也是 ' +
      'S2 的 producer 之一，所以换成"派得到任意一个 producer"那种口径时这条的答案会反过来' +
      '——控制方查过两种口径的逐阶段 diff（docs/11 §5.12）之后裁定保留单数 .role，' +
      '这条钉的就是那条已裁定的判据，不是一个悬而未决的现状',
  )
})

// ---- H5a 告警的**两支措辞**：协调者那支与非协调者那支必须真的不同 ----
//
// ⚠️ 修复轮 1（评审发现）：`hooks/gate.mjs` 里那个 `const notice = coordinator ? A : B`
// 的**两支文案此前零覆盖**。两支都含「停在旧阶段」，而钉它的两条测试（M2a Task 6 那条、
// 以及 M2b Task 3 新加的「产者 at-ui 已把 S5 交齐」那条）都只写 `/停在旧阶段/`——
// 于是把 `const notice = coordinator` 改成 `const notice = false`（后面的 `? A : B` 会被
// JS 接着解析成条件表达式，恒取**非协调者**那支，等价于**让两支共用同一份文案**），
// `node --test` 546 / 546 **全绿**。
//
// 而那段代码上方三行的注释自己写着：「两支措辞不能共用同一份文案：『而且它也派不到那个
// 执行者』在 coordinator 为真时**是假话**」。**写代码的人知道两支必须不同，写测试的人
// 没有钉住它**——docs/11 §3 那个招牌形状的又一例。
//
// 两支各自独有的措辞是跑出来的，不是读代码估的（临时脚本把两支都跑一遍再 diff）：
//   协调者独有  ：合法的层级协调 / 产物已经全部齐备 / 这正是**停在旧阶段** / 推进到正确的阶段
//   非协调者独有：派不到那个执行者 / 没有意见 / 不是它查过了没问题 / 两种可能
//   两支都有    ：停在旧阶段  ← 原来两条测试钉的就是这个，所以区分不了
//
// 下面三条共用同一份夹具（coordinatorDoneViaUi）与同一次子进程调用的输出形状：
// 第一条钉协调者独有的措辞**在**，第二条是它的正向自检锚（换一个协调者独有的措辞，
// 证明这条 notice 真的发出来了），第三条才是否定断言——**没有前两条，「另一支的话没
// 出现」可能只是因为整条 notice 根本没发**。

test('H5a：协调者那支的文案必须含它独有的措辞「产物已经全部齐备」——两支共用一份文案时这条红', () => {
  const f = H5A_TOPOLOGY_BEHAVIOUR.coordinatorDoneViaUi
  // 账本记录与磁盘内容对齐，让这条只钉 stageDone 分支的措辞，不夹带账本比对的
  // unrecorded 噪音（两者谁报不报是分开的问题，见 docs/11 §5.8）。
  // 直接匹配原始 stdout，不先 JSON.parse：删掉 `|| stageDone` 之后这里会静默、
  // stdout 变成空字符串，match 在空字符串上干净地失败，不会被 JSON.parse('') 的
  // 异常掩盖真实的失败原因。
  assert.match(runH5a(f, { ledger: LEDGER_UI }), /产物已经全部齐备/)
})

// ⭐ 正向自检锚：同一份夹具、同一支文案，换一个**协调者独有**的措辞再钉一次。它证明
// 的是「这条 notice 确实发出来了，而且走的确实是协调者那支」——下面那条否定断言全靠
// 它兜底：notice 为空时这条会红，否定断言却会绿。
test('锚：同一条输出里协调者独有的「合法的层级协调」确实出现——否则下面的否定断言可能只是因为 notice 根本没发', () => {
  assert.match(runH5a(H5A_TOPOLOGY_BEHAVIOUR.coordinatorDoneViaUi, { ledger: LEDGER_UI }), /合法的层级协调/)
})

// 非协调者那支独有的措辞。放在模块级常量里，测试与失败文案读同一份，不各抄一遍。
const NON_COORDINATOR_ONLY = ['派不到那个执行者', '没有意见']

test('H5a：协调者那支的文案里不得出现非协调者那支独有的措辞——那几句在 coordinator 为真时是假话', () => {
  const stdout = runH5a(H5A_TOPOLOGY_BEHAVIOUR.coordinatorDoneViaUi, { ledger: LEDGER_UI })
  for (const phrase of NON_COORDINATOR_ONLY) {
    assert.doesNotMatch(
      stdout,
      new RegExp(phrase),
      `协调者那支的 H5a 文案里出现了「${phrase}」——这句只属于非协调者那支，在 coordinator ` +
        '为真时是假话（hooks/gate.mjs 里 notice 三元表达式上方的注释正是这么写的）。' +
        '最可能的原因：两支被改成了共用同一份文案。',
    )
  }
})

// 三份夹具的锚，同上面 M2a Task 6 那条：三条如果其实是同一个场景，改一处实现可能让
// 三条一起绿而什么都没守住。三次比较是同一种断言形状遍历三对互不耦合的数据点。
test('前置条件：上面三条行为测试的夹具互不相同——否则三条测的是同一个场景', () => {
  const quads = Object.values(H5A_TOPOLOGY_BEHAVIOUR).map((f) => [f.stage, f.returns, f.roster, f.diskArtifacts])
  assert.notDeepEqual(quads[0], quads[1])
  assert.notDeepEqual(quads[0], quads[2])
  assert.notDeepEqual(quads[1], quads[2])
})

test('H5b 在角色与当前阶段对不上时不拦——fail open，不发 exit 2', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const { status } = run('stop-gate', { agent_type: 'agent-team:at-backend' }, GATE, projectDir)
    assert.equal(status, 0)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ---- 账本比对（Task 4，规格 §6.2 的内容比对补偿，并入 deliverable/H5a）----

test('磁盘上有产物但 artifacts 里没记：H5a 报出来（Bash 绕过 H3 的表征）', () => {
  // M2b Task 2：S2 从单产者阶段改成对象形式的多产者阶段（producers:
  // ['at-product','at-ui']）之后，stageRolesInRun 的 roster ∩ producers 口径第一次
  // 对 S2 生效——makeRun 默认的空 roster 会让这一趟在 S2 的产出角色算成空集合，
  // expandProduces 对象分支对任何角色都返回 []，账本比对因此看不见 01-prd.md，
  // 这条测试原本要验证的"磁盘有、账本没记"场景无从触发。显式声明 at-product 在场。
  // ⚠️ 这条讲的是账本比对（compareArtifacts/expectedArtifacts），空 roster 在这里
  // 确实是"没人是它的产者"的诚实语义，不受影响，不需要改。它与 H2
  // （hooks/lib/readiness.mjs 的 decideReadiness）是两码事：那边同样的空 roster
  // 曾经也会把这一段误判成"已完成"，但那不是同一条诚实语义的体现，是一个独立的
  // bug，Task 2 修复轮 1 · 修复 1 已经在 readiness.mjs 改掉——别把两者混为一谈
  // （tests/fixtures/make-run.mjs 头部注释有完整对比）。
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'], roster: ['at-product'] })
  try {
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-product' },
    }, GATE, projectDir)
    const c = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.match(c, /01-prd\.md/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('账本比对的措辞不得说成「限制」或「越权」', () => {
  // M2b Task 2：S2 从单产者阶段改成对象形式的多产者阶段（producers:
  // ['at-product','at-ui']）之后，stageRolesInRun 的 roster ∩ producers 口径第一次
  // 对 S2 生效——makeRun 默认的空 roster 会让这一趟在 S2 的产出角色算成空集合，
  // expandProduces 对象分支对任何角色都返回 []，账本比对因此看不见 01-prd.md，
  // 这条测试原本要验证的"磁盘有、账本没记"场景无从触发。显式声明 at-product 在场。
  // ⚠️ 这条讲的是账本比对（compareArtifacts/expectedArtifacts），空 roster 在这里
  // 确实是"没人是它的产者"的诚实语义，不受影响，不需要改。它与 H2
  // （hooks/lib/readiness.mjs 的 decideReadiness）是两码事：那边同样的空 roster
  // 曾经也会把这一段误判成"已完成"，但那不是同一条诚实语义的体现，是一个独立的
  // bug，Task 2 修复轮 1 · 修复 1 已经在 readiness.mjs 改掉——别把两者混为一谈
  // （tests/fixtures/make-run.mjs 头部注释有完整对比）。
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'], roster: ['at-product'] })
  try {
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-product' },
    }, GATE, projectDir)
    const c = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.doesNotMatch(c, /限制|越权/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 正向锚点：上一条是否定断言，additionalContext 为空串时天然满足。
test('前置条件：上一条那个场景确实产出了非空回传', () => {
  // M2b Task 2：S2 从单产者阶段改成对象形式的多产者阶段（producers:
  // ['at-product','at-ui']）之后，stageRolesInRun 的 roster ∩ producers 口径第一次
  // 对 S2 生效——makeRun 默认的空 roster 会让这一趟在 S2 的产出角色算成空集合，
  // expandProduces 对象分支对任何角色都返回 []，账本比对因此看不见 01-prd.md，
  // 这条测试原本要验证的"磁盘有、账本没记"场景无从触发。显式声明 at-product 在场。
  // ⚠️ 这条讲的是账本比对（compareArtifacts/expectedArtifacts），空 roster 在这里
  // 确实是"没人是它的产者"的诚实语义，不受影响，不需要改。它与 H2
  // （hooks/lib/readiness.mjs 的 decideReadiness）是两码事：那边同样的空 roster
  // 曾经也会把这一段误判成"已完成"，但那不是同一条诚实语义的体现，是一个独立的
  // bug，Task 2 修复轮 1 · 修复 1 已经在 readiness.mjs 改掉——别把两者混为一谈
  // （tests/fixtures/make-run.mjs 头部注释有完整对比）。
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'], roster: ['at-product'] })
  try {
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-product' },
    }, GATE, projectDir)
    assert.ok(stdout.trim().length > 0)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ---- Task 4（M2a）Step 10 变异 3：gate.mjs 传给 compareArtifacts 的 roster 必须真的
// 来自 ctx.state.roster，不能是接线时手滑写死的某个值。这条是纯函数测试
// （tests/artifact-drift.test.mjs）覆盖不到的一层——它只能证明 compareArtifacts 本身
// 认 roster 参数，证明不了 gate.mjs 真的把 state.json 里的 roster 字段读出来传了
// 进去。brief 自己点名「若没有测试红，补一条」——实测把 gate.mjs 那一行改成恒
// `roster: undefined` 之后跑全量 node --test，439 条不变、fail 0，没有任何测试变红，
// 印证了 brief 的预判，这里补上。----

// ⚠️ **M3a Task 3 把这一对的信号从 unrecorded 换成了 missing。**
// 它们原来钉的是「at-frontend 磁盘上的文件进不进 unrecorded」——而 unrecorded 现在
// **不看 roster 了**（hooks/lib/artifact-drift.mjs：它是「Bash 绕过 H3 的直接表征」，
// 按 roster 收窄就看不见还没进 roster 的角色写出来的东西，设计 §3.3）。那个信号因此
// 不再分辨得出 gate 到底传没传 roster：两种 roster 下它都会报，这一对会双双恒绿。
// **还跟着 roster 变的只剩 drifted / missing**，所以改钉 missing。夹具跟着换：磁盘上
// 不放文件、账本里记一条——missing 于是成了这一趟回传的唯一可能来源。
// 旧夹具（文件在磁盘上、账本里没有）没有浪费，它现在是下面那组形状 B 的回归。

// 仓库根真实 stages.json 的 S5 现在有五个 producers。roster 只派了 at-backend 一个
// 人的 run 里，at-frontend 的实现记录不该进"这一趟该有的"集合——账本里记着它、磁盘上
// 没有，也不该被报成 missing：那个角色这一趟压根没被派。
test('roster 只派了 at-backend：账本里记着的 at-frontend 产物不被报成 missing（roster 真的传到了 compareArtifacts）', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = ['at-backend']
    state.artifacts = { '05-impl/at-frontend.md': sha256OfContract('fixture 05-impl/at-frontend.md\n') }
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    // at-architect 是 S5 的合法协调者（roster.json：can_delegate_to 含 at-backend），
    // H5a 的「哑火告警」会被静默——stdout 里如果还有内容，只可能来自账本比对。
    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-architect' },
    }, GATE, projectDir)
    assert.equal(stdout.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 上一条的正向自检锚：同一份账本、同一块空磁盘，roster 换成同时包含 at-backend 与
// at-frontend 时，at-frontend 那条确实会被报成 missing——证明上一条的沉默不是因为账本
// 比对对这份夹具恒沉默（比如 stage/artifacts 传错了、gate 走错分支），而是 roster 排除
// 生效。这条也正是 Step 10 变异 3 的红：把 gate.mjs 里的 roster 改成恒 undefined 时，
// undefined 落回"退回全部 producers"，效果等价于 roster 包含了 at-frontend——上一条
// 会变得跟这一条同构，从"沉默"变成"非空回传"，即变红。
test('正向自检锚：roster 同时包含 at-frontend 时，同一份账本会被报成 missing——证明上一条不是账本比对对这份夹具恒沉默', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = ['at-backend', 'at-frontend']
    state.artifacts = { '05-impl/at-frontend.md': sha256OfContract('fixture 05-impl/at-frontend.md\n') }
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-architect' },
    }, GATE, projectDir)
    const c = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.match(c, /05-impl\/at-frontend\.md/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ---- M3a Task 3：形状 B 在 gate 这一层的回归 ----
//
// 纯函数那一侧（tests/artifact-drift.test.mjs）已经钉了 compareArtifacts 自己的口径，
// 钉不到的是**接线**：gate.mjs 仍然把 ctx.state.roster 传进去（drifted/missing 要它），
// 一个只改了纯函数、接线处又把 unrecorded 重新收窄回去的实现，纯函数测试是绿的。
//
// 夹具就是 docs/11 记的那一趟真实形状（「同一条洞在 S5 上的第二种形状」）：实现记录
// 已经落盘，而写它的角色还没进 roster——commands/at.md 第 4 步在派发并核实之后才累加
// roster，所以产物落盘的那一刻 roster 必然还不含它。
test('形状 B（接线）：at-frontend 还不在 roster 里，它写在磁盘上的文件照样被报成 unrecorded', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S5', artifacts: ['05-impl/at-frontend.md'] })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = ['at-backend']
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-architect' },
    }, GATE, projectDir)
    const c = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.match(c, /05-impl\/at-frontend\.md/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 上一条的对照：**同一块磁盘、同一个空账本，只把 at-frontend 加进 roster**，回传一模
// 一样。两条并排才说得清「unrecorded 不跟着 roster 变」——单独看上一条，它与「口径
// 其实没改、只是这份夹具恰好两边都报」区分不开。
test('同一块磁盘，roster 换成含 at-frontend 时回传一模一样——unrecorded 在接线这一层也不跟着 roster 变', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S5', artifacts: ['05-impl/at-frontend.md'] })
  try {
    const statePath = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = ['at-backend', 'at-frontend']
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    const { stdout } = run('deliverable', {
      tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-architect' },
    }, GATE, projectDir)
    const c = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.match(c, /05-impl\/at-frontend\.md/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// Task 6 评审发现（中低）：gate.mjs 里三处同构的
// `Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined` 里，`: undefined`
// 那一支**零覆盖**——把它改成 `: []`（文档反复强调不能去的方向）不会让任何测试变红。
//
// 这一支是承重的，不是风格选择。
//
// ⚠️ **M3a Task 3 让这一对原来用的那个信号失效了，夹具跟着换。** 当初实测记的差别是：
//   roster = undefined → unrecorded: ["05-impl/at-frontend.md"]
//   roster = []        → unrecorded: []
// **上面这两行今天不成立了**——unrecorded 改走 producedNames(stages)、不看 roster 之后，
// 两种取值都会报，这一对会双双恒绿、什么也不分辨（设计 §3.3，理由见
// hooks/lib/artifact-drift.mjs）。重测同一个问题、换成还跟着 roster 变的那个清单
// （账本里记着 05-impl/at-frontend.md、磁盘上没有）：
//   roster = undefined → missing: ["05-impl/at-frontend.md"]
//   roster = []        → missing: []
// 也就是说：`state.roster` 一旦不是数组，`[]` 那个退法会让一份**账本里记着、磁盘上却
// 不存在**的产物**不被报出来**——正好是账本比对存在的理由。`undefined` 退回「全部
// producers」是更宽的集合，宁可多报不要漏报。
//
// 这条测试钉的是**接线**，不是纯函数：stages.mjs 那一层「roster 缺省退回全部 producers」
// 早有单测，缺的是「gate 真的传了 undefined 而不是 []」。
test('账本比对：state.roster 不是数组时退回全部 producers——账本里记着而磁盘上没有的产物仍然被报成 missing', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    // 非数组。validateState 会嫌它，但那是 ledger 检查项的事，deliverable 这条路不跑它。
    state.roster = null
    state.artifacts = { '05-impl/at-frontend.md': sha256OfContract('fixture 05-impl/at-frontend.md\n') }
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    const input = {
      tool_name: 'Agent',
      agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-backend' },
    }
    const { stdout } = run('deliverable', input, undefined, dirs.projectDir)
    assert.match(stdout, /05-impl\/at-frontend\.md/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('前置条件：同一夹具在 state.roster 是合法数组且含 at-frontend 时也报——上一条不是靠别的原因绿的', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.roster = ['at-frontend']
    state.artifacts = { '05-impl/at-frontend.md': sha256OfContract('fixture 05-impl/at-frontend.md\n') }
    writeFileSync(statePath, JSON.stringify(state), 'utf8')

    const input = {
      tool_name: 'Agent',
      agent_type: 'at-pm',
      tool_input: { subagent_type: 'agent-team:at-backend' },
    }
    const { stdout } = run('deliverable', input, undefined, dirs.projectDir)
    assert.match(stdout, /05-impl\/at-frontend\.md/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// ---- M3b：账本回传的路由——收尾按「收件人改不改得了它」分支（docs/11 §5.23 二）----
//
// 夹具就是 M3a Task 5 在活会话里实测到的那一趟（docs/18 §3.6 末尾那条边）：at-product
// 在 S2 里派 at-ui，PostToolUse:Agent 在派发**启动**那一帧触发，additionalContext 落在
// at-product 手里，PM 从头到尾零命中。而上一版的收尾是「需要的话把 artifacts 改成与磁盘
// 一致」——同一条回传的上一句自己就写着 state.json 只对 PM 开。
//
// ⚠️ 这一组的 agent_type 与 tool_input.subagent_type **必须不同**：前者是**收件人**
// （发起这次派发的人），后者是刚被派出去的目标。两个字段在这个事件上含义不同这件事，
// 本文件开头第二段说的是 subagent_type 那一半，这一组测的是 agent_type 那一半——
// 只有跑一次真实子进程、用一个收件人与目标不同的场景才验得出来。
//
// 磁盘上放齐 S2 的三份产物、state.artifacts 为空：at-ui 的两份都在 → r.ok 成立 →
// H5a 那条哑火告警不发，stdout 里剩下的只可能是账本比对（三条 unrecorded）。
// roster 用 makeRun 的缺省空数组，与那一趟实测到的 state.roster 逐字相同——
// unrecorded 本来就不看 roster（hooks/lib/artifact-drift.mjs 的 M3a 注释块）。

// 下面几条只换一个变量：收件人。抽一个本地帮手而不是把 makeRun + try/finally 抄若干遍
// ——本仓库为「同一份知识抄多份会分叉」开过好几轮循环，而这里要分辨的恰恰只有 agent_type
// 一个字段，抄多遍会把「夹具相同」变成读的人要自己逐行核的事。
// agentType 传 null 表示**主线程**：逐字是「没有 agent_type 这个键」，不是
// `agent_type: undefined`——callerOf 两者都归 MAIN，但 JSON.stringify 会把显式的
// undefined 整个键丢掉，留着它等于让这条测试依赖一个它没打算依赖的序列化细节。
function driftAs(agentType) {
  const { projectDir, pluginDir } = makeRun({
    runId: 'r1',
    stage: 'S2',
    artifacts: ['01-prd.md', '02-ui-spec.md', '02-wireframe.html'],
  })
  try {
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-ui' } }
    if (agentType !== null) input.agent_type = agentType
    const { stdout, stderr } = run('deliverable', input, GATE, projectDir)
    const context = stdout.trim() ? JSON.parse(stdout).hookSpecificOutput.additionalContext : ''
    return { context, stderr }
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
}

test('M3b：收件人是 at-product 时，收尾不再出现「把 artifacts 改成与磁盘一致」——不要指挥一个改不了它的人去改', () => {
  assert.doesNotMatch(driftAs('at-product').context, /把 artifacts 改成与磁盘一致/)
})

// ⚠️ 上一条的正向自检锚，钉在**判据真正迭代的那一层**：不是「这份夹具有没有回传」
// （那只证明夹具活着），是「同一份夹具、只把收件人换成 PM，那句收尾就回来」。
// 分支判据被改成恒「改不了」时这一条红；被改成恒「改得了」时上一条红。两条各守一侧。
test('M3b 正向自检锚：同一份夹具、收件人换成 at-pm 时那句收尾照旧出现——上一条守的是分支，不是文案整个没了', () => {
  assert.match(driftAs('at-pm').context, /把 artifacts 改成与磁盘一致/)
})

test('M3b：收件人改不了时，文案要先说清这一条他改不了', () => {
  assert.match(driftAs('at-product').context, /这一条你改不了/)
})

test('M3b：收件人改不了时，文案要他把这一条原样冒泡给派他的人', () => {
  assert.match(driftAs('at-product').context, /原样冒泡给派你的人/)
})

// 三条里最容易被当成客套话省掉的那一条：咽掉之后没有任何人会再看见它——这条回传只走
// additionalContext，没有第二条通道。
test('M3b：收件人改不了时，文案要他别自己把它咽掉', () => {
  assert.match(driftAs('at-product').context, /不要自己把它咽掉/)
})

test('M3b：收件人改不了时往 stderr 留一行痕——这条回传只走 additionalContext，他不转述就没有任何人再看得见', () => {
  assert.ok(driftAs('at-product').stderr.length > 0)
})

// ⚠️ **全分支评审 3.3：上面那条只断言了「非空」，而这行痕的全部价值是它点名了谁。**
// 实测（变异 S5）：把调用点 `misroutedNotice('账本比对', channel, recipient)` 后两个实参
// **对调**，裸 `node --test` **753 / 0 全绿**——变异后 stderr 逐字把通道名说成了收件人、
// 又把收件人说成了通道，**点名了一个不存在的人**，而没有任何东西变红。
//
// ⚠️ **这不是「少写了一条断言」，是这条分支自己的立论在调用点上破了。**
// `misroutedNotice` 上方逐字写着它为什么要抽成一份：两条回传的**路由事实是同一份知识**，
// 分成两份就是 `docs/11` §5.15 那个形状的入口。函数确实只有一份了，
// **而两个调用点只有 ledger 那一侧被钉住**——分叉从函数体挪到了调用点，一模一样的形状
// 换了个地方。而且没守住的恰恰是**活的**那一条：ledger 那一侧的非 PM 收件人在坏指针
// 关上之后已经没有已知的确定性路径（见 `gate.mjs` 的 `buildCoverageNotice` 上方），
// **deliverable 这一侧的收件人今天真的到得了**（`PostToolUse:Agent`，收件人就是发起
// 这次派发的那个子代理，M3a Task 5 在活会话里实测到过）。
//
// 断言逐字照抄 `tests/gate-ledger.test.mjs` 里同族那一条的形状（`<标签>：这次的回传落在
// <收件人> 手里`），**不另写一份措辞**：两处断言的是同一个函数的同一段模板，
// 措辞分叉本身就是这条判据要防的东西。
test('M3b：那行痕要点名是谁收到的——两个调用点都钉，别让分叉从函数体挪到调用点', () => {
  assert.match(driftAs('at-product').stderr, /账本比对：这次的回传落在 at-product 手里/)
})

// ⚠️ 本仓库「fail open 必须留痕」是硬规矩，**但这一条不是 fail open**：运行上下文是好的、
// 判据照常算了、回传照常发了，没有放行任何东西——错的是收件人，不是判定。所以这里钉的是
// 正向的「写清它是什么」，不是「不许出现某个词」：复用 failOpenNotice 那一族的措辞会让
// 这一条红，而一条否定式断言在那种改法下反而可能照样绿。
test('M3b：那行痕要写清它不是 fail open', () => {
  assert.match(driftAs('at-product').stderr, /没有放行任何东西/)
})

// ⚠️ 下面两条是空断言，夹具整个哑掉时天然满足。它们的正向锚是上面那条「收件人是
// at-product 时 stderr 非空」——同一份夹具、同一条代码路径，只差 agent_type 一个字段。
// 删掉 stderr 那一行时它红；把分支判据改成恒「改不了」时下面这两条红。
test('M3b：收件人是 at-pm 时 stderr 为空——那条路径本来就通，留痕只是噪音', () => {
  assert.equal(driftAs('at-pm').stderr, '')
})

test('M3b：收件人是主线程（没有 agent_type 这个键）时，保持旧收尾', () => {
  assert.match(driftAs(null).context, /把 artifacts 改成与磁盘一致/)
})

test('M3b：收件人是主线程时 stderr 为空', () => {
  assert.equal(driftAs(null).stderr, '')
})
