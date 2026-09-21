// 按 event/toolNames 真正分派的测试。delegation 本身的判定细节（未知检查项、
// tool_name 校验、fail-closed 边界）已经被 tests/gate-io.test.mjs 覆盖过，
// 不在这里重复——两份曾经并行存在的 harness 已经开始漂移（Task 1 评审
// Important 4），现在共用 tests/helpers/gate-runner.mjs。这份文件只留一件事：
// 换了 event（SubagentStop）或 toolNames（Edit/Write/NotebookEdit）之后，
// 入口是否按新检查项的契约正确分派。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHECKS } from '../hooks/lib/checks.mjs'
import { run, decisionOf } from './helpers/gate-runner.mjs'

// 整理项 6：下面两条 stop-gate 用例此前跑在继承来的 cwd（仓库根）上，靠
// "仓库根此刻恰好没有 .agent-team" 这个环境状态才得到它们想要的结果。而
// .agent-team/ 不在 .gitignore 里，一旦有人在本仓库 dogfood agent-team，仓库根
// 就会真的出现一个进行中的 run，H5b 会因为产物缺失而真拦截（exit 2）——这两条
// 会因为"门禁正常工作"而变红。改成传一个 mkdtempSync 出来的干净临时目录（run()
// 的第四个参数，helper 早就支持），把"没有进行中的 run"从环境状态变成夹具的
// 一部分。
function cleanCwd() {
  return mkdtempSync(join(tmpdir(), 'agent-team-dispatch-cwd-'))
}

// 这是本任务存在的理由：SubagentStop 不带 tool_name，
// 若沿用 PreToolUse 那套「非字符串就 deny」的前置校验，
// 每个角色每次收尾都会被无故顶回去，一路顶到平台的重试上限
// （顶多少下不写在这里，单一真源是 hooks/lib/retry-budget.mjs）。
// SubagentStop 的拒绝走 exit 2（denyAndExit），不是 stdout 上的
// permissionDecision JSON，所以这里断言的是退出码，不是 decisionOf(stdout)。
test('stop-gate：输入里没有 tool_name 也不能因此 deny', () => {
  const cwd = cleanCwd()
  try {
    const { status } = run(
      'stop-gate',
      { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-backend' },
      undefined,
      cwd,
    )
    assert.notEqual(status, 2)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// 这里只钉「万一它拒绝，必须走 SubagentStop 的输出契约」这个形状本身。
// 旧版本这里断言的是 hookSpecificOutput.hookEventName === 'SubagentStop'——
// 那是 PreToolUse 专有的 JSON 形状，在 SubagentStop 上发它等于 exit 0 + 平台
// 不认的 blob，H5b 会变成一个看起来健康的空操作（Task 1 评审 Important 1/2）。
test('stop-gate 若拒绝，必须走 SubagentStop 契约：exit 2 + stderr，不是 PreToolUse 的 JSON', () => {
  const cwd = cleanCwd()
  try {
    const { stdout, stderr, status } = run(
      'stop-gate',
      { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-backend' },
      undefined,
      cwd,
    )
    assert.ok(status === 0 || status === 2, `stop-gate 不该以其它退出码结束，实际是 ${status}`)
    // Task 6 已经给 stop-gate 接上了判定逻辑，但这条测试跑在一个干净的临时
    // 目录上（没有 .agent-team）——H5b 对读不到运行上下文是 fail open
    // （见 hooks/gate.mjs），所以这里的 status 恒为 0，下面这个 if 分支依旧是
    // 防御性的，不代表这条测试验证过 exit 2。exit 2 的真实执行路径（造一个
    // 产物真的缺失的 run，逼 H5b 真拦截）由 tests/gate-deliverable.test.mjs
    // 无条件断言覆盖，不是套在 if (status === 2) 里面。denyAndExit 的
    // SubagentStop 输出契约本身（exit 2 + stderr 的具体形状）由
    // tests/deny.test.mjs 直接单测 hooks/lib/deny.mjs 的 denyOutput 验证过；
    // 三者合起来才是完整覆盖，缺一处都不算数（Task 1 二轮评审 / Task 6 简报）。
    if (status === 2) {
      assert.equal(stdout, '', 'SubagentStop 的拒绝不该往 stdout 写 PreToolUse 那套 JSON')
      assert.ok(stderr.length > 0, 'exit 2 时理由必须写在 stderr 里')
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
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
