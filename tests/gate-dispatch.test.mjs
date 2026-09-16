// 按 event/toolNames 真正分派的测试。delegation 本身的判定细节（未知检查项、
// tool_name 校验、fail-closed 边界）已经被 tests/gate-io.test.mjs 覆盖过，
// 不在这里重复——两份曾经并行存在的 harness 已经开始漂移（Task 1 评审
// Important 4），现在共用 tests/helpers/gate-runner.mjs。这份文件只留一件事：
// 换了 event（SubagentStop）或 toolNames（Edit/Write/NotebookEdit）之后，
// 入口是否按新检查项的契约正确分派。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECKS } from '../hooks/lib/checks.mjs'
import { run, decisionOf } from './helpers/gate-runner.mjs'

// 这是本任务存在的理由：SubagentStop 不带 tool_name，
// 若沿用 PreToolUse 那套「非字符串就 deny」的前置校验，
// 每个角色每次收尾都会被无故顶回去约九次（U5 实测平台重试上限）。
// SubagentStop 的拒绝走 exit 2（denyAndExit），不是 stdout 上的
// permissionDecision JSON，所以这里断言的是退出码，不是 decisionOf(stdout)。
test('stop-gate：输入里没有 tool_name 也不能因此 deny', () => {
  const { status } = run('stop-gate', {
    hook_event_name: 'SubagentStop',
    agent_type: 'agent-team:at-worker-a',
  })
  assert.notEqual(status, 2)
})

// 本任务只做分派，stop-gate 的判定逻辑在 Task 6；这里只钉「万一它拒绝，
// 必须走 SubagentStop 的输出契约」，不断言它这一刻就会拒绝（现在确实不会）。
// 旧版本这里断言的是 hookSpecificOutput.hookEventName === 'SubagentStop'——
// 那是 PreToolUse 专有的 JSON 形状，在 SubagentStop 上发它等于 exit 0 + 平台
// 不认的 blob，H5b 会变成一个看起来健康的空操作（Task 1 评审 Important 1/2）。
test('stop-gate 若拒绝，必须走 SubagentStop 契约：exit 2 + stderr，不是 PreToolUse 的 JSON', () => {
  const { stdout, stderr, status } = run('stop-gate', {
    hook_event_name: 'SubagentStop',
    agent_type: 'agent-team:at-worker-a',
  })
  assert.ok(status === 0 || status === 2, `stop-gate 不该以其它退出码结束，实际是 ${status}`)
  // 这个 if 分支在 Task 6 之前恒假——stop-gate 还没有判定逻辑，status 恒为 0，
  // 所以这里从没真正执行到 exit 2 的那两条断言。denyAndExit 的 SubagentStop
  // 输出契约（exit 2 + stderr）不靠这条分支覆盖，由 tests/deny.test.mjs 直接
  // 单测 hooks/lib/deny.mjs 的 denyOutput 执行验证过，不要以为这里已经测过
  // 了（Task 1 二轮评审）。
  if (status === 2) {
    assert.equal(stdout, '', 'SubagentStop 的拒绝不该往 stdout 写 PreToolUse 那套 JSON')
    assert.ok(stderr.length > 0, 'exit 2 时理由必须写在 stderr 里')
  }
})

test('writepath：已注册、按 Edit/Write/NotebookEdit 分流、不相关工具静默、且是 fail closed', () => {
  assert.deepEqual(CHECKS.writepath.toolNames, ['Edit', 'Write', 'NotebookEdit'])

  const bash = run('writepath', { tool_name: 'Bash', tool_input: {} })
  assert.equal(bash.stdout.trim(), '', 'Bash 不该进入写路径判定')

  // Task 4 之前 writepath 没有判定逻辑，此刻能观测到的唯一真实分派证据是
  // fail-closed 前置校验：不带 tool_name 时必须 deny（H3，checks.mjs 里
  // failClosed: true）。旧版本这里断言 typeof edit === 'string'，对 run()
  // 的两条返回路径恒真，测试名承诺的「进入判定」其实一件没验（评审 Important 5）。
  const { stdout } = run('writepath', { tool_input: {} })
  const d = decisionOf(stdout)
  assert.equal(d.permissionDecision, 'deny')
})

// contract（H4）和 writepath（H3）注册在同一组 matcher 上、fail-closed 策略
// 也相同，但此前只有 writepath 侧补了分派测试——全仓检索过，contract 在
// tests/ 下此前只在一句注释里出现过，从没有任何测试调用过
// run('contract', ...)（Task 1 二轮评审 Finding 6 未关闭的一半）。
test('contract：已注册、按 Edit/Write/NotebookEdit 分流、不相关工具静默、且是 fail closed', () => {
  assert.deepEqual(CHECKS.contract.toolNames, ['Edit', 'Write', 'NotebookEdit'])

  const bash = run('contract', { tool_name: 'Bash', tool_input: {} })
  assert.equal(bash.stdout.trim(), '', 'Bash 不该进入契约保护判定')

  // Task 5 之前 contract 没有判定逻辑，此刻能观测到的唯一真实分派证据是
  // fail-closed 前置校验：不带 tool_name 时必须 deny（H4，checks.mjs 里
  // failClosed: true）。
  const { stdout } = run('contract', { tool_input: {} })
  const d = decisionOf(stdout)
  assert.equal(d.permissionDecision, 'deny')
})
