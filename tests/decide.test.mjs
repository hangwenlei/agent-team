import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { callerOf, decideDelegation, malformedCaller, malformedCallerReason } from '../hooks/lib/decide.mjs'

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

// 非空数组：Object.keys 给出 '0'、'1'……，只查「非空」会把它当成有效花名册，调用者查不到条目就按「未登记」放行。
// isValidRoster 的「不是数组」那一条只有这一格钉得住（空数组在「非空」那一条就被拦下了）。
test('roster 为非空数组时门禁 fail closed 并指名 roster.json', () => {
  for (const roster of [['at-product'], [{ 'at-pm': { can_delegate_to: ['at-product'] } }]]) {
    const r = decideDelegation({ tool_input: { subagent_type: 'at-product' } }, roster)
    assert.equal(r.decision, 'deny', JSON.stringify(roster))
    assert.match(r.reason, /roster\.json/)
  }
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

// ---- isolation：团队角色不许被隔离出去（M3p，docs/24 §2.1）----
//
// Agent 工具的 isolation 参数（'worktree' / 'remote'）把子代理搬进另一份检出里干活。
// 团队的全部判据都建立在「所有角色共用同一棵工作树、同一个 .agent-team」之上：隔离出去
// 的子代理写的是另一份拷贝，门禁要么在那边找不到 run（整体 fail open），要么把它写回的
// 路径判成无人认领；它交的产物也落不进 run 目录，H5 永远判不齐。所以受管辖的调用者
// 派发时带 isolation 一律拒，理由里写清楚怎么改。
// 删掉 decideDelegation 里 isolation 那一段，下面前三条红。

test('受管辖的调用者带 isolation: worktree 派发，即使目标在白名单里也拒绝', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'at-worker-a', isolation: 'worktree' } },
    ROSTER,
  )
  assert.equal(r.decision, 'deny')
})

test('主线程带 isolation: remote 派发同样拒绝——不只拦 worktree 一种写法', () => {
  const r = decideDelegation(
    { tool_input: { subagent_type: 'agent-team:at-product', isolation: 'remote' } },
    ROSTER,
  )
  assert.equal(r.decision, 'deny')
})

test('isolation 的拒绝理由点名这个参数，并告诉调用者去掉它重派', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'at-worker-a', isolation: 'worktree' } },
    ROSTER,
  )
  assert.match(r.reason, /isolation/)
  assert.match(r.reason, /去掉/)
})

// 后台会话（claude --bg 等）在 git 仓库里默认不许写共享检出，平台给子代理指的出路恰好是
// 带 isolation 重派——那正是上面拒的。拒绝理由要把真正的出路交给用户，而不是让模型在
// 「平台叫它加、门禁叫它去掉」之间来回（docs/24 §4）。
test('isolation 的拒绝理由说清后台会话那种情形要停下来交给用户，并点名那个设置', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'at-worker-a', isolation: 'worktree' } },
    ROSTER,
  )
  assert.match(r.reason, /后台会话/)
  assert.match(r.reason, /bgIsolation/)
  assert.match(r.reason, /用户/)
})

test('花名册外的调用者带 isolation 派发不归本门禁管，照旧放行', () => {
  const r = decideDelegation(
    { agent_type: 'someone-else', tool_input: { subagent_type: 'Explore', isolation: 'worktree' } },
    ROSTER,
  )
  assert.equal(r.decision, 'allow')
})

test('目标不在白名单时仍然报白名单那条理由——isolation 不遮蔽更根本的拒绝', () => {
  const r = decideDelegation(
    { agent_type: 'at-architect', tool_input: { subagent_type: 'at-outsider', isolation: 'worktree' } },
    ROSTER,
  )
  assert.match(r.reason, /不得派发给 at-outsider/)
})

// ---- M4i（docs/44，审查第 35、42、22 条）----

const REAL = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))

// 第 35 条：agent_type 在、却不是非空字符串（空串、数字、对象……）——callerOf 把它原样当名字，花名册里查不到，走「未登记的调用者放行」，
// 一个畸形字段就绕过了整个 H1。认不出调用者就按安全边界拒。缺失与 null 照旧是主线程。
test('M4i 第 35 条：agent_type 在却不是非空字符串时拒——认不出是谁在派', () => {
  for (const bad of ['', 0, 1, {}, [], true, 'agent-team:']) {
    const r = decideDelegation({ agent_type: bad, tool_input: { subagent_type: 'agent-team:at-backend' } }, REAL)
    assert.equal(r.decision, 'deny', JSON.stringify(bad))
    assert.ok(r.reason.includes('门禁认不出发起这次派发的是谁'), r.reason)
  }
  assert.equal(decideDelegation({ tool_input: { subagent_type: 'agent-team:at-product' } }, REAL).decision, 'allow')
  assert.equal(decideDelegation({ agent_type: null, tool_input: { subagent_type: 'agent-team:at-product' } }, REAL).decision, 'allow')
})

// 第 35 条：项目经理（与主线程）被拒时，原来叫它「冒泡给上级」——它没有上级。改成说那个角色由谁派（从花名册现算）。不是项目经理的照旧冒泡。
test('M4i 第 35 条：项目经理派花名册外的角色被拒——说它由谁派，不说冒泡给上级', () => {
  const pm = decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'agent-team:at-backend' } }, REAL)
  assert.equal(pm.decision, 'deny')
  assert.ok(pm.reason.includes('at-backend 由 at-architect 派：要它干活，派 at-architect，在派发提示里写明要 at-backend 做什么；不要绕过花名册。'), pm.reason)
  assert.ok(!pm.reason.includes('冒泡给上级'), pm.reason)
  const ui = decideDelegation({ tool_input: { subagent_type: 'agent-team:at-ui' } }, REAL)
  assert.ok(ui.reason.includes('at-ui 由 at-product、at-architect 派：要它干活，派其中一个，在派发提示里写明要 at-ui 做什么；不要绕过花名册。'), ui.reason)
  const out = decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'agent-team:at-outsider' } }, REAL)
  assert.ok(out.reason.includes('花名册里没有哪个角色能派 at-outsider，它不是这支团队里干活的人。'), out.reason)
  const product = decideDelegation({ agent_type: 'agent-team:at-product', tool_input: { subagent_type: 'agent-team:at-backend' } }, REAL)
  assert.ok(product.reason.includes('冒泡给上级') && !product.reason.includes('由 at-architect 派'), product.reason)
})

// 第 42 条：开了 agent teams 时，带 name 的 Agent 调用起的是 teammate，不是子代理——H5a 把它当旧版 CLI 那一格（派出去那一刻就报缺、不记
// 派发记录），它停下时门禁也看不见。受管辖的派发带非空 name 一律拒，与 isolation 同形：排在白名单之后，花名册外的调用者不管。
test('M4i 第 42 条：受管辖的派发带非空 name 拒——起的是 teammate、不是子代理，去掉 name 重派', () => {
  const r = decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'agent-team:at-product', name: 'prd' } }, REAL)
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('teammate') && r.reason.includes('去掉 name 参数重新派发'), r.reason)
  assert.equal(decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'agent-team:at-product', name: '' } }, REAL).decision, 'allow')
  assert.equal(decideDelegation({ agent_type: 'someone-else', tool_input: { subagent_type: 'Explore', name: 'x' } }, REAL).decision, 'allow')
  assert.ok(decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'agent-team:at-backend', name: 'x' } }, REAL).reason.includes('不得派发给'))
})

// 第 22 条：项目经理只能是主会话。任何调用者派 at-pm 一律拒，花名册外的也拒（主会话被设置里别的 agent 盖住时，它就是花名册外的调用者）：
// 子代理里的 at-pm 带着项目经理的写权限（契约、控制文件），却不是主会话。裸名 at-pm 也拒——门禁按剥前缀的名字认项目经理，起出来的
// 子代理同样会被当成它。别的插件的同名 agent 不归本门禁管。
test('M4i 第 22 条：任何调用者派 at-pm 一律拒，花名册外的也拒', () => {
  for (const caller of [undefined, 'agent-team:at-pm', 'agent-team:at-architect', 'my-main', 'general-purpose']) {
    for (const target of ['agent-team:at-pm', 'at-pm']) {
      const r = decideDelegation({ ...(caller === undefined ? {} : { agent_type: caller }), tool_input: { subagent_type: target } }, REAL)
      assert.equal(r.decision, 'deny', `${caller} → ${target}`)
      // 复核（docs/44 §8，低-2）：项目经理自己（与主线程）派 at-pm——它本来就是主会话，说「at-pm 就是你」，不叫它停下、不报设置问题。
      const want = caller === undefined || caller === 'agent-team:at-pm' ? PM_SELF : caller === 'agent-team:at-architect' ? PM_TEAM : PM_OTHER
      assert.ok(r.reason === want, r.reason)
    }
  }
  assert.equal(decideDelegation({ agent_type: 'my-main', tool_input: { subagent_type: 'other-plugin:at-pm' } }, REAL).decision, 'allow')
})

// M4i 复核变异：「由谁派」从花名册现算，不点名门禁内部的哨兵 __main__，也不点名调用者自己——今天的花名册上这两种不会撞上（主线程与
// 项目经理派得动的一样），换一份主线程多派一个角色的花名册就撞上。
test('M4i 第 35 条：由谁派不点名 __main__ 与调用者自己', () => {
  const roster = { __main__: { can_delegate_to: ['x-role'] }, 'at-pm': { can_delegate_to: ['at-product'] }, 'at-product': { can_delegate_to: [] } }
  const r = decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'x-role' } }, roster)
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('花名册里没有哪个角色能派 x-role') && !r.reason.includes('__main__'), r.reason)
})

// ---- M4i 复核（docs/44 §8）----

const PM_SELF = "at-pm 就是你：项目经理是主会话，不能被派成子代理。你自己那几段的产物你自己写，不派人（/agent-team:at 第 3 节）。"
// 复核第二步：别的团队角色（子代理，或者被 --agent 换成主会话的团队角色）冒泡；花名册外的只说这一句——被换掉的主会话由门禁接在后面的身份
// 那一句给出路（gate-check 那条门禁子进程判据），别的插件的子代理不归我们指路。
const PM_TEAM = "项目经理只能是主会话，at-pm 不能被派成子代理：要项目经理做的事，写进你的回报冒泡给派你的人。"
const PM_OTHER = "项目经理只能是主会话，at-pm 不能被派成子代理：子代理里的项目经理带着写契约与控制文件的权限，却不是主会话。"

// 低-5：主线程（没有 agent_type）被拒时，理由里不出现门禁内部的哨兵 __main__，说「主会话」。
test('M4i 复核：主线程被拒的几种理由都说「主会话」，不出现 __main__', () => {
  const reasons = [
    decideDelegation({ tool_input: { subagent_type: 'agent-team:at-backend' } }, REAL).reason,
    decideDelegation({ tool_input: { subagent_type: 'agent-team:at-product', isolation: 'worktree' } }, REAL).reason,
    decideDelegation({ tool_input: { subagent_type: 'agent-team:at-product', name: 'x' } }, REAL).reason,
    decideDelegation({ tool_input: {} }, REAL).reason,
  ]
  for (const r of reasons) {
    assert.ok(!r.includes('__main__'), r)
    assert.ok(r.startsWith('主会话'), r)
  }
})

// 复核变异：name 为 null 与缺失一样（平台看 name 的真值）；协调者带 name 同样拒（原来只量了项目经理）；花名册里某个条目的
// can_delegate_to 坏了，「由谁派」跳过它、不抛。
test('M4i 复核：name 为 null 放行、协调者带 name 拒；「由谁派」跳过坏条目', () => {
  assert.equal(decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'agent-team:at-product', name: null } }, REAL).decision, 'allow')
  const arch = decideDelegation({ agent_type: 'agent-team:at-architect', tool_input: { subagent_type: 'agent-team:at-backend', name: 'be' } }, REAL)
  assert.equal(arch.decision, 'deny')
  assert.ok(arch.reason.includes('去掉 name 参数重新派发'), arch.reason)
  assert.ok(arch.reason.includes('没开时 name 只是让子代理能被 SendMessage 找到，团队角色用不上它'), arch.reason)
  const roster = { ...REAL, 'at-broken': { can_delegate_to: null } }
  const r = decideDelegation({ agent_type: 'agent-team:at-pm', tool_input: { subagent_type: 'agent-team:at-backend' } }, roster)
  assert.ok(r.reason.includes('at-backend 由 at-architect 派'), r.reason)
})

// 低-7：形状检查是共用的一份——H3 的写入用同一个判断（gate-writepath 那一条核门禁子进程）。
test('M4i 复核：malformedCaller——缺失、null、正常名字不算；空串、非字符串、只剩插件前缀算', () => {
  for (const ok of [{}, { agent_type: null }, { agent_type: 'agent-team:at-pm' }, { agent_type: 'my-main' }]) assert.equal(malformedCaller(ok), false, JSON.stringify(ok))
  for (const bad of [{ agent_type: '' }, { agent_type: 0 }, { agent_type: {} }, { agent_type: 'agent-team:' }]) assert.equal(malformedCaller(bad), true, JSON.stringify(bad))
  assert.ok(malformedCallerReason('写入').startsWith('门禁认不出发起这次写入的是谁'))
})
