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
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

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
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('deliverable：目标角色已经写出产物——stdout 为空，不记 warning', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['00-contract.md', '01-prd.md'] })
  try {
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

test('deliverable：tool_input.subagent_type 缺失时放行——不能退而求其次读成调用者自己', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    const input = { tool_name: 'Agent', agent_type: 'at-pm', tool_input: {} }
    const { stdout, status } = run('deliverable', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout, '')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('deliverable：tool_name 不是 Agent 时不表态', () => {
  const { stdout, status } = run('deliverable', { tool_name: 'Bash', tool_input: {} })
  assert.equal(status, 0)
  assert.equal(stdout, '')
})
