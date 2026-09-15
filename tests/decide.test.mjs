import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callerOf, decideDelegation } from '../hooks/lib/decide.mjs'

const ROSTER = {
  __main__: { can_delegate_to: ['at-product', 'at-architect'] },
  'at-architect': { can_delegate_to: ['at-worker-a', 'at-worker-b'] },
  'at-worker-a': { can_delegate_to: [] },
}

test('agent_type 缺失时调用者是主线程', () => {
  assert.equal(callerOf({ tool_name: 'Agent' }), '__main__')
})

test('agent_type 存在时调用者是该 subagent', () => {
  assert.equal(callerOf({ agent_type: 'at-architect' }), 'at-architect')
})

test('花名册内的派发放行', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'at-worker-a' } },
    ROSTER,
  )
  assert.equal(r.decision, 'allow')
})

test('花名册外的派发拒绝', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'at-outsider' } },
    ROSTER,
  )
  assert.equal(r.decision, 'deny')
})

test('拒绝理由里列出它实际能派的角色', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'at-outsider' } },
    ROSTER,
  )
  assert.match(r.reason, /at-worker-a/)
  assert.match(r.reason, /at-worker-b/)
})

test('叶子角色不得派发任何人，且理由点明它是叶子', () => {
  const r = decideDelegation(
    { agent_type: 'at-worker-a', tool_input: { subagent_type: 'at-worker-b' } },
    ROSTER,
  )
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /叶子角色/)
})

test('未登记的调用者不归本门禁管，放行', () => {
  const r = decideDelegation(
    { agent_type: 'general-purpose', tool_input: { subagent_type: 'at-worker-a' } },
    ROSTER,
  )
  assert.equal(r.decision, 'allow')
})

test('受管辖角色不写 subagent_type 时拒绝——省略该字段会拿到 general-purpose', () => {
  const r = decideDelegation({ agent_type: 'at-architect', tool_input: {} }, ROSTER)
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /subagent_type/)
})

test('未登记的调用者不写 subagent_type 仍然放行', () => {
  const r = decideDelegation({ agent_type: 'general-purpose', tool_input: {} }, ROSTER)
  assert.equal(r.decision, 'allow')
})

test('条目缺 can_delegate_to 时拒绝，并说明是 roster.json 的配置错误', () => {
  const r = decideDelegation(
    { agent_type: 'at-broken', tool_input: { subagent_type: 'at-worker-a' } },
    { ...ROSTER, 'at-broken': {} },
  )
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /roster\.json/)
})

test('主线程按 __main__ 判定', () => {
  const ok = decideDelegation({ tool_input: { subagent_type: 'at-product' } }, ROSTER)
  const no = decideDelegation({ tool_input: { subagent_type: 'at-worker-a' } }, ROSTER)
  assert.equal(ok.decision, 'allow')
  assert.equal(no.decision, 'deny')
})
