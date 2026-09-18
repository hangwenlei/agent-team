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
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

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
// ⚠️ **下面第一条用 at-architect，但被静默的不止它。** 当前花名册下 at-product 在
// state.stage === 'S5' 时同样静默（它的 can_delegate_to 含 at-backend，落在协调者
// 一侧）。那是这条判定的固有代价而不是漏网——按规格 §6.4 的触达语义 at-product 确实
// 有能力让 at-backend 交付——但读这两条测试的人很容易以为静默面只有 at-architect
// 一个，所以在这里点明。判据是「能传递派到 stages[state.stage].role」，扩链到
// S6–S8 时要回来重算这个集合（stages.README.md 记了）。
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
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'] })
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
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'] })
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
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'] })
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
