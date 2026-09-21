// M3a Task 2：阶段推进后的产者交代判据（hooks/lib/coverage.mjs 的 decideCoverage）。
//
// 这条判据答的是 docs/15 §5.1 记下的那个洞：一个阶段的 producer 从来没被派，
// 于是它从来不被期待，它的缺席因此不可见——八道判据一条都没响。
//
// 夹具用**仓库根真实的 stages.json**，不用合成的：这条判据的全部理由来自一趟
// 真实 run，换成合成阶段表就测不到真实 producers 集合的形状（S2 两个产者、
// S5 五个产者）。
//
// ⚠️ Ruling 2（收窄轮）：判据的宇宙是 `stageRoles(S) ∩ available_roles`。
// 本文件里凡是传了 availableRoles 的，走的就是真实生产路径；没传的那几条钉的是
// 「收窄不成时不静默」那一半。两种口径在同一份 state 上的差，由「收窄前 / 收窄后」
// 那一组逐条钉着。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideCoverage } from '../hooks/lib/coverage.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const stages = JSON.parse(readFileSync(url('stages.json'), 'utf8'))

// docs/15 §3.8 验证项 6 逐字记的那一趟的 available_roles（/at-init 写的，记录级）。
// 注意它**不含** at-pm（commands/at-init.md 明令不写它），也**不含** at-ios / at-android
// （那个项目用不上移动端）——这两件事正是 Ruling 2 要用的。
const M2B_AVAILABLE = [
  'at-product', 'at-architect', 'at-backend', 'at-frontend', 'at-ui', 'at-qa', 'at-acceptance',
]

// 「一个用得上全部角色的项目」——从模板派生，不在这里另抄一份名单。
const FULL_AVAILABLE = JSON.parse(readFileSync(url('templates/project.json'), 'utf8')).available_roles

// history 的条目形状是 { stage, at }（hooks/lib/state.mjs 的 validateState 钉着它）。
const h = (...ids) => ids.map((stage) => ({ stage, at: '2026-09-20T00:00:00Z' }))

// docs/15 §5.1 那一趟的形状：S2 走过了，班底把 at-ui 裁掉了。
// roster 逐字用 task-2 brief 给的那一份。
const m2bShapeA = (o = {}) => ({
  stage: 'S3',
  history: h('S1', 'S2', 'S3'),
  roster: ['at-product', 'at-architect'],
  trimmed: {},
  ...o,
})

// docs/15 §3.8 的终局 state（记录级：stage S8、那一趟真实的 roster、带两轮返工的 history）。
const m2bFinal = (o = {}) => ({
  stage: 'S8',
  history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5', 'S6', 'S7', 'S8'),
  roster: ['at-product', 'at-architect', 'at-pm', 'at-backend', 'at-frontend', 'at-qa', 'at-acceptance'],
  trimmed: {},
  ...o,
})

// ——— 前置条件锚 ———
//
// 下面几条「收窄不是恒沉默」的锚，靠的是 at-ios / at-android 在 FULL_AVAILABLE 里**在**。
// 模板哪天把它们拿掉，那几条会以一堆看不懂的 deepEqual 差异变红；这一条先红，并说清原因。
test('前置条件：模板的 available_roles 含 at-ios 与 at-android——下面几条收窄锚靠它们在宇宙里', () => {
  assert.deepEqual(FULL_AVAILABLE.filter((r) => r === 'at-ios' || r === 'at-android'), ['at-ios', 'at-android'])
})

// ——— 收窄后的主路径（availableRoles 传真实那一份）———

// 这一条既是形状 A 的回归，也是紧接着几条「gaps 为空」断言的**正向自检锚**：
// 它们共用 m2bShapeA，锚要证明的是「同一组夹具在该报的时候真的报」。
//
// ⚠️ 这里的 roster 是 task-2 brief 逐字给的那一份（不含 at-pm）。**收窄之前**这份夹具
// 算出来是两条（多一条 {S1, at-pm}）；Ruling 2 把宇宙收窄到 available_roles 之后
// at-pm 自动退出，brief 那句断言变成真的。差在哪、为什么，见下面「收窄前 / 收窄后」那一组。
test('形状 A 回归：S2 走过了而 at-ui 既不在 roster 也不在 trimmed —— 报一条 gap', () => {
  const out = decideCoverage({ stages, state: m2bShapeA(), availableRoles: M2B_AVAILABLE })
  assert.deepEqual(out.gaps, [{ stage: 'S2', role: 'at-ui' }])
})

// docs/15 §5.1 第 3 点逐字：state.stage 从 S2 推到 S3 那一刻，roster 就是 ["at-product"]
// ——比 brief 那份还少一个名字。收窄之后两者算出同一条，因为少的那个正是 at-pm。
test('实测记录：docs/15 §5.1 那一刻（roster 逐字只有 at-product）收窄后只报 S2 的 at-ui', () => {
  const out = decideCoverage({ stages, state: m2bShapeA({ roster: ['at-product'] }), availableRoles: M2B_AVAILABLE })
  assert.deepEqual(out.gaps, [{ stage: 'S2', role: 'at-ui' }])
})

test('at-ui 写进 trimmed（声明过的裁剪就是交代）→ 同一组夹具不再报', () => {
  const state = m2bShapeA({ trimmed: { 'at-ui': 'S2' } })
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: M2B_AVAILABLE }).gaps, [])
})

test('at-ui 写进 roster（这一趟真的叫到过它）→ 同一组夹具不再报', () => {
  const state = m2bShapeA({ roster: ['at-product', 'at-architect', 'at-ui'] })
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: M2B_AVAILABLE }).gaps, [])
})

// ——— 当前阶段不算走过 ———

test('当前阶段不算走过：stage 停在 S2 时，S2 的 at-ui 不报', () => {
  const state = { stage: 'S2', history: h('S1', 'S2'), roster: ['at-product'], trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: M2B_AVAILABLE }).gaps, [])
})

// 正向自检锚：**roster 与 trimmed 逐字不变**，只把 stage 从 S2 推到 S3（history 跟着
// 追加对应的一条）。唯一变的是「S2 还是不是当前阶段」这一位，所以这条锚钉的正是
// 「当前阶段不算走过」那一支真正迭代的那一层——把那一支删掉，上一条会红。
test('正向自检锚（当前阶段不算走过）：同一份 roster，S2 一旦被推过去就报', () => {
  const state = { stage: 'S3', history: h('S1', 'S2', 'S3'), roster: ['at-product'], trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: M2B_AVAILABLE }).gaps, [{ stage: 'S2', role: 'at-ui' }])
})

// ——— 返工 ———
//
// 返工的真实形状来自 docs/15 §3.8：那一趟的 history 是
// S1→S2→S3→S4→S5→S6→S5→S6→S7→S8，**S5 与 S6 各出现两次**，rework 是 {"S5":1,"S6":1}。
// 下面两条用的是这条链被截到「第二次进 S5」与「第二次进 S6」的那两个时刻，不是合成的。
//
// 这一组的 availableRoles 用 FULL_AVAILABLE（一个用得上全部角色的项目），不是那一趟的
// 那份：要让 S5 那一段在宇宙里真的有人缺席，at-ios / at-android 得**在**宇宙里——
// 否则这两条锚会因为收窄而恒空，证明不了「当前阶段不算走过」那一支在做事。
const reworkRoster = ['at-pm', 'at-product', 'at-ui', 'at-architect', 'at-backend', 'at-frontend', 'at-qa']

test('返工：S5 在 history 里出现两次、且正是当前阶段 → S5 不产生 gap', () => {
  const state = {
    stage: 'S5',
    history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5'),
    roster: reworkRoster,
    trimmed: {},
  }
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: FULL_AVAILABLE }).gaps, [])
})

// 正向自检锚：同一份 roster 与 trimmed，返工做完、stage 推到 S6 —— S5 这才算走过。
// 这条同时钉住**去重**：S5 在 history 里出现了两次，而 at-ios / at-android 各只上榜
// 一次。去掉 seen 那一层，同样的输入会把这两条各报两遍。
//
// ⚠️ **它还顺带钉住了一条已知边界，而那不是它的名字说的那件事**（M3a Task 4 定向复评
// 抓出来的，加这段指路而已，断言一个字没动）：reworkRoster **含 at-ui**、S2 与 S5 都走过、
// trimmed 是 {}，而下面 deepEqual 到的数组里**没有** {S5, at-ui}。
// 也就是说这条锚同时断言了：**一个在早段被派过的角色（因此进了 roster），
// 在后段被裁掉时不产生 gap** —— roster 与 trimmed 都按角色名判、不按段。
// 那是一条**有意记录下来的已知边界，不是想要的行为**：完整论证、它与
// 「整趟被裁只能记一段」为什么是同一枚硬币的两面、以及什么会让它从「已知边界」变成
// 「该做」，见 docs/11 的「roster 与 trimmed 都按角色名判、不按段」那一节（§5.22）。
// **这条哪天因为有人改成按段判而变红，先去读那一节，不要直接改这里的期望值。**
// （实测：模拟那个修法——roster 里的名字只对它遇到的第一个产者阶段算交代——
// 708 → 705 / 3，第一条红的就是这一条。）
test('正向自检锚（返工）：同一份 roster，返工做完推到 S6 之后 S5 才报，且每条只报一次', () => {
  const state = {
    stage: 'S6',
    history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5', 'S6'),
    roster: reworkRoster,
    trimmed: {},
  }
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: FULL_AVAILABLE }).gaps, [
    { stage: 'S5', role: 'at-ios' },
    { stage: 'S5', role: 'at-android' },
  ])
})

// ——— Ruling 2：宇宙收窄到 available_roles ———
//
// at-ios / at-android **从来没上过队**（不在那一趟的 available_roles 里），
// 不存在一个关于它们的「裁剪」决定——要求 PM 为它们写一条 trimmed，等于要求把一个
// 不存在的决定写下来，而设计 §3.1 的立论恰恰是「把已经存在的决定变成可机器读的」。

test('Ruling 2：不在 available_roles 里的角色不进宇宙——终局 state 上 at-ios/at-android 不报', () => {
  const out = decideCoverage({ stages, state: m2bFinal(), availableRoles: M2B_AVAILABLE })
  assert.deepEqual(out.gaps, [{ stage: 'S2', role: 'at-ui' }, { stage: 'S5', role: 'at-ui' }])
})

// 正向自检锚：**同一份 state 逐字不变**，只把 available_roles 换成含 at-ios/at-android
// 的那份 —— 它们真的会被报。没有这条，上一条在「收窄退化成恒沉默」时照样绿。
test('正向自检锚（Ruling 2）：同一份 state，at-ios/at-android 一旦在 available_roles 里就报', () => {
  const out = decideCoverage({ stages, state: m2bFinal(), availableRoles: FULL_AVAILABLE })
  assert.deepEqual(out.gaps, [
    { stage: 'S2', role: 'at-ui' },
    { stage: 'S5', role: 'at-ui' },
    { stage: 'S5', role: 'at-ios' },
    { stage: 'S5', role: 'at-android' },
  ])
})

// at-pm 不需要特例：commands/at-init.md 明令「不要写 at-pm：它是每一趟的驱动者，
// 不参与『有没有被叫到』的统计」，tests/templates.test.mjs 从模板那一侧钉着同一句话。
// 收窄之后它自动退出宇宙，S1/S4/S8 不再产生 gap。
//
// 上面「docs/15 §5.1 那一刻」那条（roster 里没有 at-pm、S1 走过了、结果只有一条）
// 就是这件事的主判据；这里配它的**已知违规样本锚**：把 at-pm 塞进 available_roles
// （正是 /at-init 禁的那件事）→ S1 真的会报出来。
test('正向自检锚（at-pm 退出宇宙）：把 at-pm 塞进 available_roles，S1 立刻报出来', () => {
  const out = decideCoverage({
    stages,
    state: m2bShapeA({ roster: ['at-product'] }),
    availableRoles: [...M2B_AVAILABLE, 'at-pm'],
  })
  assert.deepEqual(out.gaps, [{ stage: 'S1', role: 'at-pm' }, { stage: 'S2', role: 'at-ui' }])
})

// ——— 收窄前 / 收窄后：把那个差钉成机器可读的 ———
//
// 这四条是 Task 5「误报率」那一项的第一份数据：不需要真实 run，拿 docs/15 §3.8 的终局
// state 跑一遍就有。控制方要再调判据的话，这四条会红——那正是它们该干的事。

test('收窄前：终局 state 上报四条（S5 那三条是这个项目根本用不上的角色）', () => {
  const out = decideCoverage({ stages, state: m2bFinal() })
  assert.deepEqual(out.gaps, [
    { stage: 'S2', role: 'at-ui' },
    { stage: 'S5', role: 'at-ui' },
    { stage: 'S5', role: 'at-ios' },
    { stage: 'S5', role: 'at-android' },
  ])
})

test('收窄后：同一份终局 state 只剩两条，而且是同一个角色（at-ui）的同一个决定', () => {
  const out = decideCoverage({ stages, state: m2bFinal(), availableRoles: M2B_AVAILABLE })
  assert.equal(out.gaps.length, 2)
})

test('收窄后：PM 写一行 trimmed，那两条一起消失', () => {
  const out = decideCoverage({ stages, state: m2bFinal({ trimmed: { 'at-ui': 'S2' } }), availableRoles: M2B_AVAILABLE })
  assert.deepEqual(out.gaps, [])
})

// 反面：收窄**之前**，同一行 trimmed 消不掉那两条噪声——要消掉得为两个这个项目根本
// 没有的角色各写一条 trimmed。这条是「为什么必须收窄」的机械证据。
test('收窄前：同一行 trimmed 消不掉 at-ios/at-android 那两条', () => {
  const out = decideCoverage({ stages, state: m2bFinal({ trimmed: { 'at-ui': 'S2' } }) })
  assert.deepEqual(out.gaps, [{ stage: 'S5', role: 'at-ios' }, { stage: 'S5', role: 'at-android' }])
})

// ——— 收窄不成时不静默 ———
//
// available_roles 读不到 / 写坏了 / 是空数组时**不收窄**，不是「收窄成空集合于是永不报」
// ——后者会让「把 available_roles 删掉」成为一条静默通道。调用方靠 narrowed 决定留不留痕、
// 文案里说不说口径变宽了（hooks/gate.mjs 两半都做了）。

test('收窄不成：availableRoles 缺省时 narrowed 为假', () => {
  assert.equal(decideCoverage({ stages, state: m2bShapeA() }).narrowed, false)
})

test('收窄不成：availableRoles 不是数组时 narrowed 为假', () => {
  assert.equal(decideCoverage({ stages, state: m2bShapeA(), availableRoles: 'at-ui' }).narrowed, false)
})

// 空数组是**合法的 JSON 数组**，所以它不会被 Array.isArray 挡下来——单独钉一条。
// 「没告诉我这个项目有谁可用」不等于「这个项目一个角色都没有」。
test('收窄不成：availableRoles 是空数组时 narrowed 为假，不是「宇宙为空所以永不报」', () => {
  assert.equal(decideCoverage({ stages, state: m2bShapeA(), availableRoles: [] }).narrowed, false)
})

test('收窄不成：availableRoles 是空数组时照样报（口径退回全部 stageRoles）', () => {
  const out = decideCoverage({ stages, state: m2bShapeA(), availableRoles: [] })
  assert.deepEqual(out.gaps, [{ stage: 'S1', role: 'at-pm' }, { stage: 'S2', role: 'at-ui' }])
})

// 正向自检锚：上面三条断的都是 narrowed 为假，光有它们时「narrowed 恒假」照样全绿。
test('正向自检锚（narrowed）：传了可用的一份 available_roles 时 narrowed 为真', () => {
  assert.equal(decideCoverage({ stages, state: m2bShapeA(), availableRoles: M2B_AVAILABLE }).narrowed, true)
})

// ——— 退化输入：一律不抛 ———
//
// 这一组一律不传 availableRoles（走不收窄那条路），顺带覆盖「收窄不成时判据仍然工作」。

test('退化输入：state 不是对象时返回空 gaps，不抛', () => {
  assert.deepEqual(decideCoverage({ stages, state: null }).gaps, [])
})

test('退化输入：stages 不是对象时返回空 gaps，不抛', () => {
  assert.deepEqual(decideCoverage({ stages: null, state: m2bShapeA() }).gaps, [])
})

test('退化输入：整个入参缺省时返回空 gaps，不抛', () => {
  assert.deepEqual(decideCoverage().gaps, [])
})

// ⚠️ **修复轮 F2**：这两条原来是**一条**，而且夹具值是字符串 `'S1,S2,S3'`
// ——那条测试今天什么也守不住：删掉 `Array.isArray(state.history) ? … : []` 这个守卫，
// 裸 `node --test` 仍然全绿。**因为字符串本身可迭代**：`for…of` 逐字符走一遍，
// 每个字符都被下一行的形状守卫 `continue` 掉，结果同样是空 gaps。
// 它测到的是「形状守卫在工作」，不是「history 守卫在工作」，而后者才是它名字里写的那个。
// 这是 docs/16 那条「锚要钉在判据**真正迭代**的那一层」的同族第五次。
//
// 换成**不可迭代**的值（对象 / null；数字也同族）：守卫一删，`for…of` 立刻 TypeError。
// 而这三种**都能从磁盘上的 state.json 读出来**——validateState 只把它报成一条 problem，
// 不阻止 ledger 继续往下调这个判据。所以这个守卫是承重的，不是防御性装饰。
test('退化输入：history 是对象（不可迭代）时返回空 gaps，不抛', () => {
  const state = { stage: 'S3', history: {}, roster: [], trimmed: {} }
  assert.deepEqual(decideCoverage({ stages, state }).gaps, [])
})

test('退化输入：history 是 null 时返回空 gaps，不抛', () => {
  const state = { stage: 'S3', history: null, roster: [], trimmed: {} }
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
  const state = { stage: 'S3', history: h('S1', 'S2', 'S3'), roster: ['at-product', 'at-architect'] }
  const out = decideCoverage({ stages, state, availableRoles: M2B_AVAILABLE })
  assert.deepEqual(out.gaps, [{ stage: 'S2', role: 'at-ui' }])
})

// roster 不是数组 → 按空集合算，不是「判不了就闭嘴」。反过来会给出一条静默通道：
// 把 roster 写成一个非数组就能让这条判据对整趟失声。理由写在 coverage.mjs 里。
test('退化输入：roster 不是数组时按空集合算（走过的每个产者都报），不抛', () => {
  const state = m2bShapeA({ roster: null })
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: M2B_AVAILABLE }).gaps, [
    { stage: 'S2', role: 'at-product' },
    { stage: 'S2', role: 'at-ui' },
  ])
})

test('退化输入：trimmed 不是对象时按空集合算（不当成交代），不抛', () => {
  const state = m2bShapeA({ trimmed: ['at-ui'] })
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: M2B_AVAILABLE }).gaps, [{ stage: 'S2', role: 'at-ui' }])
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
  assert.deepEqual(decideCoverage({ stages, state, availableRoles: FULL_AVAILABLE }).gaps, [])
})
