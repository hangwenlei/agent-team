// M3a Task 2：阶段推进后的产者交代判据（hooks/lib/coverage.mjs 的 decideCoverage）。
//
// 这条判据答的是 docs/15 §5.1 记下的那个洞：一个阶段的 producer 从来没被派，
// 于是它从来不被期待，它的缺席因此不可见——八道判据一条都没响。
//
// 夹具用**仓库根真实的 stages.json**，不用合成的：这条判据的全部理由来自一趟
// 真实 run，换成合成阶段表就测不到真实 producers 集合的形状（S2 两个产者、
// S5 五个产者）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideCoverage } from '../hooks/lib/coverage.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const stages = JSON.parse(readFileSync(url('stages.json'), 'utf8'))

// history 的条目形状是 { stage, at }（hooks/lib/state.mjs 的 validateState 钉着它）。
const h = (...ids) => ids.map((stage) => ({ stage, at: '2026-09-20T00:00:00Z' }))

// docs/15 §5.1 那一趟的形状：S2 走过了，班底把 at-ui 裁掉了。
//
// ⚠️ 这份夹具的 roster 里有 at-pm，而 task-2 brief 里那份逐字写的是
// ["at-product", "at-architect"]。拿仓库根真实 stages.json 实跑过：brief 那一份
// 算出来是 [{S1,at-pm},{S2,at-ui}]，**不是** brief 断言的单条。原因是 S1 的产者是
// at-pm 自己，而 commands/at.md 第 4 步只说「把这一段真正**叫到**的角色累加进
// roster」——S1/S4/S8 是 PM 自己做的，没有派发这个动作。这不是夹具的毛病：
// docs/15 §5.1 第 3 点逐字记着 S2 推到 S3 那一刻 roster 就是 ["at-product"]。
// 下面「实测记录」那一组把那个形状单独钉了一条。
const m2bShapeA = ({ roster = ['at-pm', 'at-product', 'at-architect'], trimmed = {} } = {}) => ({
  stage: 'S3',
  history: h('S1', 'S2', 'S3'),
  roster,
  trimmed,
})

// 这一条既是形状 A 的回归，也是紧接着两条「gaps 为空」断言的**正向自检锚**：三条
// 共用同一个构造器，锚要证明的是「同一组夹具在该报的时候真的报」，夹具各写一份就
// 证明不了同一组。
test('形状 A 回归：S2 走过了而 at-ui 既不在 roster 也不在 trimmed —— 报一条 gap', () => {
  assert.deepEqual(decideCoverage({ stages, state: m2bShapeA() }).gaps, [{ stage: 'S2', role: 'at-ui' }])
})

test('at-ui 写进 trimmed（声明过的裁剪就是交代）→ 同一组夹具不再报', () => {
  const state = m2bShapeA({ trimmed: { 'at-ui': 'S2' } })
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [])
})

test('at-ui 写进 roster（这一趟真的叫到过它）→ 同一组夹具不再报', () => {
  const state = m2bShapeA({ roster: ['at-pm', 'at-product', 'at-architect', 'at-ui'] })
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [])
})

// ——— 当前阶段不算走过 ———

test('当前阶段不算走过：stage 停在 S2 时，S2 的 at-ui 不报', () => {
  const state = { stage: 'S2', history: h('S1', 'S2'), roster: ['at-pm', 'at-product'], trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [])
})

// 正向自检锚：**roster 与 trimmed 逐字不变**，只把 stage 从 S2 推到 S3（history 跟着
// 追加对应的一条）。唯一变的是「S2 还是不是当前阶段」这一位，所以这条锚钉的正是
// 「当前阶段不算走过」那一支真正迭代的那一层——把那一支删掉，上一条会红。
test('正向自检锚（当前阶段不算走过）：同一份 roster，S2 一旦被推过去就报', () => {
  const state = { stage: 'S3', history: h('S1', 'S2', 'S3'), roster: ['at-pm', 'at-product'], trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [{ stage: 'S2', role: 'at-ui' }])
})

// ——— 返工 ———
//
// 返工的真实形状来自 docs/15 §3.8：那一趟的 history 是
// S1→S2→S3→S4→S5→S6→S5→S6→S7→S8，**S5 与 S6 各出现两次**，rework 是 {"S5":1,"S6":1}。
// 下面两条用的是这条链被截到「第二次进 S5」与「第二次进 S6」的那两个时刻，不是合成的。
const reworkRoster = ['at-pm', 'at-product', 'at-ui', 'at-architect', 'at-backend', 'at-frontend', 'at-qa']

test('返工：S5 在 history 里出现两次、且正是当前阶段 → S5 不产生 gap', () => {
  const state = {
    stage: 'S5',
    history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5'),
    roster: reworkRoster,
    trimmed: {},
  }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [])
})

// 正向自检锚：同一份 roster 与 trimmed，返工做完、stage 推到 S6 —— S5 这才算走过。
// 这条同时钉住**去重**：S5 在 history 里出现了两次，而 at-ios / at-android 各只上榜
// 一次。去掉 seen 那一层，同样的输入会把这两条各报两遍。
test('正向自检锚（返工）：同一份 roster，返工做完推到 S6 之后 S5 才报，且每条只报一次', () => {
  const state = {
    stage: 'S6',
    history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5', 'S6'),
    roster: reworkRoster,
    trimmed: {},
  }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [
    { stage: 'S5', role: 'at-ios' },
    { stage: 'S5', role: 'at-android' },
  ])
})

// ——— 退化输入：一律不抛 ———

test('退化输入：state 不是对象时返回空 gaps，不抛', () => {
  assert.deepEqual(decideCoverage({ stages, state: null }).gaps, [])
})

test('退化输入：stages 不是对象时返回空 gaps，不抛', () => {
  assert.deepEqual(decideCoverage({ stages: null, state: m2bShapeA() }).gaps, [])
})

test('退化输入：整个入参缺省时返回空 gaps，不抛', () => {
  assert.deepEqual(decideCoverage().gaps, [])
})

test('退化输入：history 不是数组时返回空 gaps，不抛', () => {
  const state = { stage: 'S3', history: 'S1,S2,S3', roster: [], trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [])
})

test('退化输入：history 的条目形状不对时跳过那一条，不抛', () => {
  const state = {
    stage: 'S3',
    history: [null, { at: '这一条没有 stage 键' }, { stage: 'S2', at: '2026-09-20T00:00:00Z' }],
    roster: ['at-product'],
    trimmed: {},
  }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [{ stage: 'S2', role: 'at-ui' }])
})

// trimmed 缺失是**合法**的（M3a 之前落盘的 run 没有这个字段，validateState 对它不报错）。
// 这一条要证明的不只是「不抛」，还有「照样判」——缺失 = 没有任何声明过的裁剪，
// 不是「判不了、别报」。退化成后者的话，M3a 之前的所有 run 会对这条判据整趟免疫。
test('退化输入：trimmed 缺失时不抛，而且照样报——缺失是「没有声明过的裁剪」，不是「别报」', () => {
  const state = { stage: 'S3', history: h('S1', 'S2', 'S3'), roster: ['at-pm', 'at-product', 'at-architect'] }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [{ stage: 'S2', role: 'at-ui' }])
})

// roster 不是数组 → 按空集合算，不是「判不了就闭嘴」。反过来会给出一条静默通道：
// 把 roster 写成一个非数组就能让这条判据对整趟失声。理由写在 coverage.mjs 里。
test('退化输入：roster 不是数组时按空集合算（走过的每个产者都报），不抛', () => {
  const state = { stage: 'S3', history: h('S1', 'S2', 'S3'), roster: null, trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [
    { stage: 'S1', role: 'at-pm' },
    { stage: 'S2', role: 'at-product' },
    { stage: 'S2', role: 'at-ui' },
  ])
})

test('退化输入：trimmed 不是对象时按空集合算（不当成交代），不抛', () => {
  const state = m2bShapeA({ trimmed: ['at-ui'] })
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [{ stage: 'S2', role: 'at-ui' }])
})

// ——— trimmed 按键判，不按「值等于这一段」判 ———
//
// at-ui 是 S2 与 S5 两段的产者（去 stages.json 看）。一次「本趟不用它」的裁剪只有
// 一个决定，按值逐段匹配会让它在它出现的每一段各报一次。M3a 设计 §3.2 的原话是
// 「必须在 roster ∪ trimmed 里」——键，不是键值对。
test('trimmed 的值是出处不是匹配键：at-ui 记在 S2，S5 那一段也算交代过', () => {
  const state = {
    stage: 'S6',
    history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6'),
    roster: ['at-pm', 'at-product', 'at-architect', 'at-backend', 'at-frontend'],
    trimmed: { 'at-ui': 'S2', 'at-ios': 'S5', 'at-android': 'S5' },
  }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [])
})

// ——— 实测记录：这条判据在 docs/15 那一趟真实数据上到底报什么 ———
//
// 这两条不是「应该怎样」，是「拿真实形状实跑出来是什么」。写成断言而不是散文，
// 是因为数字与清单里只有清单可核（docs/16 §3.1）。控制方要按这个结果调判据的话，
// 这两条会红——那正是它们该干的事。

// docs/15 §5.1 第 3 点逐字：state.stage 从 S2 推到 S3 那一刻，roster 是 ["at-product"]。
// 判据在那一刻报两条，而要找的洞只有 {S2, at-ui} 这一条。另一条 {S1, at-pm} 是
// **实测出来的误报**：S1 的产者是 at-pm 自己，PM 做自己那几段（S1/S4/S8）时没有
// 「派发」这个动作，commands/at.md 第 4 步的「把这一段真正叫到的角色累加进 roster」
// 因此不覆盖它。同一趟的终局 roster 里 at-pm 是在的（docs/15 §3.8），所以它是
// 一段窗口期的噪声，不是永久的。
test('实测记录：docs/15 §5.1 那一刻（roster 只有 at-product）判据报两条，其中 S1/at-pm 是误报', () => {
  const state = { stage: 'S3', history: h('S1', 'S2', 'S3'), roster: ['at-product'], trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [
    { stage: 'S1', role: 'at-pm' },
    { stage: 'S2', role: 'at-ui' },
  ])
})

// docs/15 §3.8 的终局 state（记录级：stage S8、那一趟真实的 roster、带两轮返工的
// history）。判据报四条：要找的洞是 {S2, at-ui}，另外三条来自 S5 —— 那一段的
// producers 有五个执行角色，这趟只用了两个。那三条不是漏派，是**按需组队**本身，
// 而 M3a 设计 §2 排除 2 正是为了不打死它才没有采用「所有 producers 一律期待」。
// 要它们不报，PM 得把 at-ios / at-android 也写进 trimmed——而那一趟的 project.json
// 的 available_roles 里根本没有这两个角色（docs/15 §3.8 的验证项 6 逐字列了那份名单）。
test('实测记录：docs/15 §3.8 的终局 state 上判据报四条，S5 那三条是按需组队的噪声', () => {
  const state = {
    stage: 'S8',
    history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5', 'S6', 'S7', 'S8'),
    roster: ['at-product', 'at-architect', 'at-pm', 'at-backend', 'at-frontend', 'at-qa', 'at-acceptance'],
    trimmed: {},
  }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [
    { stage: 'S2', role: 'at-ui' },
    { stage: 'S5', role: 'at-ui' },
    { stage: 'S5', role: 'at-ios' },
    { stage: 'S5', role: 'at-android' },
  ])
})
