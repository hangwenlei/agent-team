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

test('callerOf 剥掉本插件前缀', () => {
  assert.equal(callerOf({ agent_type: 'agent-team:at-architect' }), 'at-architect')
})

test('callerOf 不剥别的插件的前缀', () => {
  assert.equal(callerOf({ agent_type: 'other:at-architect' }), 'other:at-architect')
})

test('带插件前缀的目标按裸名查花名册——合法派发必须放行', () => {
  const r = decideDelegation(
    {
      agent_type: 'agent-team:at-architect',
      tool_input: { subagent_type: 'agent-team:at-worker-a' },
    },
    ROSTER,
  )
  assert.equal(r.decision, 'allow')
})

test('别的插件的同名 agent 不被当作自己人', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'other:at-worker-a' } },
    ROSTER,
  )
  assert.equal(r.decision, 'deny')
})

// 这一条是本次修复的真正回归保护。上一条（caller 与 target 都带前缀）
// 在修复前的代码上照样通过——带前缀的 caller 查不到花名册，直接从
// 「未登记调用者放行」岔路走掉，根本没走到 target 归一化。
// 而下面这个形态（主线程 + 带前缀目标）正是线上真实炸掉的那一个。
test('主线程派发带前缀的合法目标——真实复现形态，必须放行', () => {
  const r = decideDelegation(
    { tool_input: { subagent_type: 'agent-team:at-product' } },
    ROSTER,
  )
  assert.equal(r.decision, 'allow')
})

test('退化输入 agent-team: 不被剥成空串', () => {
  assert.equal(callerOf({ agent_type: 'agent-team:' }), 'agent-team:')
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'agent-team:' } },
    ROSTER,
  )
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /不得派发给/)
})

test('主线程按 __main__ 判定', () => {
  const ok = decideDelegation({ tool_input: { subagent_type: 'at-product' } }, ROSTER)
  const no = decideDelegation({ tool_input: { subagent_type: 'at-worker-a' } }, ROSTER)
  assert.equal(ok.decision, 'allow')
  assert.equal(no.decision, 'deny')
})

// 复审实测：花名册形状退化时，旧实现把「查不到条目」统一当成「未登记调用者」
// 放行——{}、[]、null、单条目为 null 都会让 gate.mjs 零输出、exit 0，等价于
// 对所有派发全放行。下面这组测试覆盖每一种退化形态，且都要求拒绝理由指名
// roster.json，把责任指向花名册本身而不是这次调用。

test('roster 为空对象 {} 时门禁 fail closed 并指名 roster.json', () => {
  const r = decideDelegation({ tool_input: { subagent_type: 'at-product' } }, {})
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /roster\.json/)
})

test('roster 为空数组 [] 时门禁 fail closed 并指名 roster.json', () => {
  const r = decideDelegation({ tool_input: { subagent_type: 'at-product' } }, [])
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /roster\.json/)
})

test('roster 为 null 时门禁 fail closed 并指名 roster.json', () => {
  const r = decideDelegation({ tool_input: { subagent_type: 'at-product' } }, null)
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /roster\.json/)
})

test('roster 为非对象（字符串）时门禁 fail closed 并指名 roster.json', () => {
  const r = decideDelegation(
    { tool_input: { subagent_type: 'at-product' } },
    'not-a-roster',
  )
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /roster\.json/)
})

test('roster 中调用者条目为 null 时拒绝，不当成未登记调用者放行', () => {
  const r = decideDelegation(
    { agent_type: 'at-broken', tool_input: { subagent_type: 'at-worker-a' } },
    { ...ROSTER, 'at-broken': null },
  )
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /at-broken/)
})

// 原型链上的键（constructor、toString、valueOf……）不是花名册的 own key。
// 用 Object.hasOwn 而不是下标访问，这类键必须走「未登记调用者」放行分支，
// 不能被误判成一个真实存在、但形状不对的花名册条目。
test('原型链键不被当成花名册条目——走未登记调用者放行', () => {
  const r = decideDelegation(
    { agent_type: 'constructor', tool_input: { subagent_type: 'at-worker-a' } },
    ROSTER,
  )
  assert.equal(r.decision, 'allow')
})
