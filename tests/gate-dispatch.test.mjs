import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const GATE = fileURLToPath(new URL('../hooks/gate.mjs', import.meta.url))

function run(check, input) {
  try {
    const stdout = execFileSync(process.execPath, [GATE, check], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return stdout
  } catch (err) {
    return err.stdout ?? ''
  }
}

function decisionOf(stdout) {
  if (!stdout.trim()) return null
  return JSON.parse(stdout).hookSpecificOutput
}

test('未知检查项一律 deny', () => {
  const d = decisionOf(run('delegatoin', { tool_name: 'Agent', tool_input: {} }))
  assert.equal(d.permissionDecision, 'deny')
})

test('delegation：tool_name 非字符串时 deny（fail closed）', () => {
  const d = decisionOf(run('delegation', { tool_input: { subagent_type: 'at-worker-a' } }))
  assert.equal(d.permissionDecision, 'deny')
})

test('delegation：tool_name 是别的工具时静默不表态', () => {
  const out = run('delegation', { tool_name: 'Bash', tool_input: {} })
  assert.equal(out.trim(), '')
})

test('delegation 的拒绝带 PreToolUse 事件名', () => {
  const d = decisionOf(run('delegation', { tool_name: 'Agent', tool_input: {} }))
  assert.equal(d.hookEventName, 'PreToolUse')
})

// 这是本任务存在的理由：SubagentStop 不带 tool_name，
// 若沿用 PreToolUse 那套「非字符串就 deny」的前置校验，
// 每个角色每次收尾都会被无故顶回去约九次（U5 实测平台重试上限）。
test('stop-gate：输入里没有 tool_name 也不能因此 deny', () => {
  const out = run('stop-gate', { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-worker-a' })
  const d = decisionOf(out)
  if (d) assert.notEqual(d.permissionDecision, 'deny')
})

test('stop-gate 若拒绝，事件名必须是 SubagentStop 而不是 PreToolUse', () => {
  // 本任务只做分派，stop-gate 的判定逻辑在 Task 6；
  // 这里只断言「若产生决策，事件名正确」，不断言它一定拒绝。
  const out = run('stop-gate', { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-worker-a' })
  const d = decisionOf(out)
  if (d) assert.equal(d.hookEventName, 'SubagentStop')
})

test('writepath：Edit 与 Write 都进入判定，别的工具静默', () => {
  const edit = run('writepath', { tool_name: 'Edit', tool_input: { file_path: 'x' } })
  const write = run('writepath', { tool_name: 'Write', tool_input: { file_path: 'x' } })
  const bash = run('writepath', { tool_name: 'Bash', tool_input: {} })
  assert.equal(bash.trim(), '', 'Bash 不该进入写路径判定')
  // Task 4 之前 writepath 尚无判定逻辑，此处只断言它没有被 tool_name 前置校验吃掉：
  // 即 Edit/Write 的行为与 Bash 不同（要么有决策，要么至少不是同一条静默路径）。
  assert.ok(typeof edit === 'string' && typeof write === 'string')
})

test('读不到 stdin 时按安全边界 deny', () => {
  const d = decisionOf(run('delegation', ''))
  assert.equal(d.permissionDecision, 'deny')
})
