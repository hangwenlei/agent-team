import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ESCALATION_KINDS, REJECTION_KINDS, REWORK_LIMIT, isStageDone, nextStage, rejectTo, reworkFromHistory, validateState } from '../hooks/lib/state.mjs'
import { participantsOf } from '../hooks/lib/stages.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  S3: { role: 'at-architect', requires: ['01-prd.md'], produces: ['03-arch.md'] },
}
const SHA = 'sha256:' + 'a'.repeat(64)

function good(over = {}) {
  return {
    run_id: '20260917-1430-login-sso',
    stage: 'S2',
    contract_sha: SHA,
    roster: ['at-product'],
    artifacts: { '00-contract.md': SHA },
    rework: {},
    never_invoked: ['at-frontend'],
    escalations: [],
    history: [
      { stage: 'S1', at: '2026-09-17T14:30:00Z' },
      { stage: 'S2', at: '2026-09-17T14:52:00Z' },
    ],
    ...over,
  }
}

test('合法的 state 通过', () => {
  assert.deepEqual(validateState(good(), { stages: STAGES }), { ok: true, problems: [], budget: [], legacy: [] })
})

test('rework 由 history 推导：某阶段出现 n 次就是 n-1 次返工', () => {
  assert.deepEqual(reworkFromHistory([
    { stage: 'S1' }, { stage: 'S2' }, { stage: 'S2' }, { stage: 'S2' },
  ]), { S2: 2 })
})

test('reworkFromHistory 对空/坏输入返回空对象，不抛', () => {
  assert.deepEqual(reworkFromHistory([]), {})
  assert.deepEqual(reworkFromHistory(null), {})
  assert.deepEqual(reworkFromHistory([{ stage: 'S1' }, 'x', null]), {})
})

// 这是本任务存在的理由：把返工计数改小，必须有东西会红。
test('把 rework 改小会被抓住', () => {
  const s = good({
    stage: 'S2',
    rework: {},
    history: [{ stage: 'S1', at: 'x' }, { stage: 'S2', at: 'x' }, { stage: 'S2', at: 'x' }],
  })
  const r = validateState(s, { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /rework/.test(p) && /history/.test(p)))
})

test('把 rework 改大同样被抓住——两个方向都不许分叉', () => {
  const r = validateState(good({ rework: { S2: 1 } }), { stages: STAGES })
  assert.equal(r.ok, false)
})

test('history 最后一条必须等于 stage 字段', () => {
  const r = validateState(good({ stage: 'S3' }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /history/.test(p) && /stage/.test(p)))
})

test('history 不能为空——一个 run 至少进入过一个阶段', () => {
  assert.equal(validateState(good({ history: [], stage: 'S1' }), { stages: STAGES }).ok, false)
})

test('stage 必须是 stages.json 里存在的阶段', () => {
  const r = validateState(good({ stage: 'S9', history: [{ stage: 'S9', at: 'x' }] }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /S9/.test(p)))
})

test('contract_sha 要么是 PENDING 要么是 sha256:<64 hex>', () => {
  assert.equal(validateState(good({ contract_sha: 'PENDING' }), { stages: STAGES }).ok, true)
  assert.equal(validateState(good({ contract_sha: 'sha256:abc' }), { stages: STAGES }).ok, false)
  assert.equal(validateState(good({ contract_sha: 'a'.repeat(64) }), { stages: STAGES }).ok, false)
})

// M3z（docs/34，全量审查第 16 条）：上限按 history 的派生值与门禁记下的返工批准判（hooks/lib/budget.mjs 的 limitOf），单列在
// budget 里、不进 problems——problems 那一块的抬头是「改完再继续」，而越限的唯一出路是问用户：把计数改小会被 H6 以「不可重置」拒
// （O6）。写着的值与派生值对不上照旧在 problems 里报。
test('返工轮数超过上限（按 history 的派生值）单列在 budget 里，不进 problems', () => {
  const history = [{ stage: 'S1', at: 'x' }]
  for (let i = 0; i <= REWORK_LIMIT + 1; i++) history.push({ stage: 'S2', at: 'x' })
  const s = good({ stage: 'S2', history, rework: reworkFromHistory(history) })
  const r = validateState(s, { stages: STAGES })
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, [])
  assert.deepEqual(r.budget, [{ stage: 'S2', rounds: REWORK_LIMIT + 1, limit: REWORK_LIMIT }])
})

test('门禁记下的返工批准覆盖这一段时不越限', () => {
  const history = [{ stage: 'S1', at: 'x' }]
  for (let i = 0; i <= REWORK_LIMIT + 1; i++) history.push({ stage: 'S2', at: 'x' })
  const s = good({ stage: 'S2', history, rework: reworkFromHistory(history) })
  const r = validateState(s, { stages: STAGES, grants: [{ reworkTo: 'S2', covers: ['S2'] }] })
  assert.deepEqual(r, { ok: true, problems: [], budget: [], legacy: [] })
  // 覆盖的是别的段：照样越限。
  assert.equal(validateState(s, { stages: STAGES, grants: [{ reworkTo: 'S3', covers: ['S3'] }] }).budget.length, 1)
})

test('写着的值超过上限、派生值没超：只报「对不上派生值」，不报越限', () => {
  const history = [{ stage: 'S1', at: 'x' }, { stage: 'S2', at: 'x' }, { stage: 'S2', at: 'x' }]
  const r = validateState(good({ stage: 'S2', history, rework: { S2: REWORK_LIMIT + 1 } }), { stages: STAGES })
  assert.deepEqual(r.budget, [])
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /应当是 1/)
})

test('escalations 的 kind 必须是规格 §5.1 列的那几类之一（报错文案逐个列出、不报总数）', () => {
  const esc = { stage: 'S2', kind: 'whatever', question: 'q', answer: 'a', at: 'x' }
  const r = validateState(good({ escalations: [esc] }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => ESCALATION_KINDS.every((k) => p.includes(k))))
  assert.ok(r.problems.every((p) => !/[一二三四五六七八九十]类/.test(p)), '列举，不报总数（docs/16 §3.1）：加一类时这句话不该跟着变假')
})

// M4c（docs/37，审查第 37 条后半）：加 env-blocked（环境挡住了：缺工具、服务或权限，构建或测试跑不起来，交不出来或验证不了）。
// 收口门禁自己就把「测试跑不起来」指向第 4 节，原来照做如实记 env-blocked 会被报成状态不合法、记成 contract-hole 反倒一声不响。
// user-change（用户主动改需求）没加：它记不记回退、吃不吃返工额度还没定（docs/37 §5）。
test('升级条件与规格 §5.1 一一对应（M4c 加了 env-blocked）', () => {
  assert.deepEqual(ESCALATION_KINDS, [
    'sensitive', 'contract-conflict', 'tradeoff', 'contract-hole', 'budget-exhausted', 'env-blocked',
  ])
})

test('M4c 记一条 env-blocked 的 escalation 不报问题', () => {
  const esc = { stage: 'S6', kind: 'env-blocked', question: '测试要连的数据库起不来，怎么办？', answer: '先跳过集成测试', at: 'x' }
  const r = validateState(good({ escalations: [esc] }), { stages: STAGES })
  assert.ok(!r.problems.some((p) => p.includes('escalations[0].kind')), JSON.stringify(r.problems))
})

test('缺字段逐条报出来，一次报全不要只报第一条', () => {
  const r = validateState({}, { stages: STAGES })
  assert.equal(r.ok, false)
  for (const k of ['run_id', 'stage', 'contract_sha', 'roster', 'artifacts', 'rework', 'never_invoked', 'escalations', 'history']) {
    assert.ok(r.problems.some((p) => p.includes(k)), `没有报出缺 ${k}`)
  }
})

test('state 本身不是对象时也不抛', () => {
  for (const bad of [null, [], 'x', 3, undefined]) {
    const r = validateState(bad, { stages: STAGES })
    assert.equal(r.ok, false)
    assert.ok(r.problems.length > 0)
  }
})

test('不给 stages 时跳过与阶段链有关的检查，其余照查', () => {
  assert.equal(validateState(good({ stage: 'S9', history: [{ stage: 'S9', at: 'x' }] }), {}).ok, true)
  assert.equal(validateState(good({ rework: { S2: 5 } }), {}).ok, false)
})

test('artifacts 的键必须是某个阶段的 produces', () => {
  const r = validateState(good({ artifacts: { '不是产物.md': SHA } }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((x) => /不是任何阶段的 produces/.test(x)))
})

test('不给 stages 时跳过这条键名校验', () => {
  assert.equal(validateState(good({ artifacts: { '不是产物.md': SHA } }), {}).ok, true)
})

// ——— trimmed：M3a 新加的字段 ———
//
// 它记「这一趟主动裁掉了谁、在哪一段」。背景与为什么不要求写理由，见
// hooks/lib/state.mjs 里 validateState 的 trimmed 那一段注释。
//
// ⚠️ validateState 里 trimmed 的那几条形状判据，**今天在真实数据上一次也不迭代**：
// templates/state.json 的 trimmed 是 {}，Object.entries 零次，「不是对象」那一条也走不到。
// 按本仓库那条「零覆盖不等于有缺口，但零有三种」——这属于「今天零次迭代、将来会有
// 输入」那一种，锚**不能**用「派生集合非空」那一款（今天那个集合就是空的），要用
// **已知违规样本**那一款。所以下面每一条都自带一个已知违规样本，样本就是锚本身：
// 不是对象（`['at-ui']`）、值不是阶段 id（`'S9'`）、值不是字符串（`3`）、
// 键不是任何阶段的产者（`'at-outsider'`）。
//
// 这几条同时是「trimmed 缺失时不报错」那条空集合断言的正向自检锚：那一条断的是
// problems 为空，光有它时，把整段校验删掉它照样绿；有了这几条，删掉其中任何一条
// 都有东西会红（变异验证逐条跑过）。

test('trimmed 合法时通过——键是某阶段的产者，值是 stages 里存在的阶段', () => {
  const r = validateState(good({ trimmed: { 'at-architect': 'S3' } }), { stages: STAGES })
  assert.deepEqual(r.problems, [], r.problems.join('\n'))
})

// 向后兼容：M3a 之前落盘的 state.json 里根本没有这个字段，而 /agent-team:at-resume
// 会去读它们。缺失必须**不**报错——这一条红了就意味着老 run 一打开就被判成状态不合法。
test('trimmed 缺失时不报错——M3a 之前落盘的 state.json 没有这个字段', () => {
  assert.ok(!Object.hasOwn(good(), 'trimmed'), 'good() 夹具里不该有 trimmed，否则下面那句断的不是「缺失」')
  assert.deepEqual(validateState(good(), { stages: STAGES }).problems, [])
})

test('trimmed 不是对象时报出来', () => {
  const r = validateState(good({ trimmed: ['at-ui'] }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed 不是对象/.test(x)), r.problems.join('\n'))
})

test('trimmed 的值不是 stages 里的阶段时报出来', () => {
  const r = validateState(good({ trimmed: { 'at-architect': 'S9' } }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed\["at-architect"\]/.test(x) && /S9/.test(x)), r.problems.join('\n'))
})

test('trimmed 的值不是字符串时报出来——阶段 id 不能写成数字或 true', () => {
  const r = validateState(good({ trimmed: { 'at-architect': 3 } }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed\["at-architect"\] 不是字符串/.test(x)), r.problems.join('\n'))
})

// 键的合法集合是「stages 里全部阶段 stageRoles 的并集」，不是 roster.json 的键集合。
// at-outsider 在 roster.json 里真实存在，却不是任何阶段的产者——按 roster.json 校验
// 会放它过去，而裁掉一个本来就什么都不产出的角色不构成任何交代。理由见
// hooks/lib/state.mjs 那一段注释。
test('trimmed 的键不是任何阶段的产者时报出来——at-outsider 在花名册里，但它不产出任何东西', () => {
  const r = validateState(good({ trimmed: { 'at-outsider': 'S2' } }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed 里有 "at-outsider"/.test(x)), r.problems.join('\n'))
})

// 与上面 artifacts 键名校验那一条同一个口径：stages 缺省时，凡是要拿 stages 当判据的
// 归属检查一律不表态。下面两条拆开，因为它们守的是两件相反的事（跳过 / 照查）。
test('不给 stages 时跳过 trimmed 的两条归属校验——键与值的归属都拿 stages 当判据', () => {
  assert.equal(validateState(good({ trimmed: { 'at-outsider': 'S9' } }), {}).ok, true)
})

// 上一条是「不表态」，光有它时把整段 trimmed 校验删掉它照样绿。这条钉住不表态的边界：
// **形状检查不在此列**——trimmed 不是对象，与有没有给 stages 无关。
test('不给 stages 时 trimmed 的形状校验照查——不是对象仍然报', () => {
  assert.equal(validateState(good({ trimmed: ['at-ui'] }), {}).ok, false)
})

test('nextStage 按 stages 的书写顺序走，不按 id 字符串排序', () => {
  assert.equal(nextStage(STAGES, 'S1'), 'S2')
  assert.equal(nextStage(STAGES, 'S3'), null)
  assert.equal(nextStage(STAGES, 'S9'), null)
  assert.equal(nextStage(null, 'S1'), null)
})

// readiness.mjs 与 deliverable.mjs 都栽过 "S10".localeCompare("S2") < 0 那一坑
// （Task 3 评审 Minor 2）。nextStage 是第三处按顺序走阶段链的地方，一起钉住。
test('nextStage 对 S9 → S10 也对——插入序不取决于数值宽度', () => {
  const wide = { S9: { role: 'r' }, S10: { role: 'r' } }
  assert.equal(nextStage(wide, 'S9'), 'S10')
})

// isStageDone：Task 6 变异验证第 4 项发现的缺口，补在这里而不是只留在
// hooks/gate.mjs 内联——那处代码只经子进程级测试跑到，而仓库根真实 stages.json
// 里每个阶段的 produces 都只有一个元素，.every 与 .some 在单元素数组上永远同值，
// 子进程级测试判不出两者的差异（完整背景见本函数在 hooks/lib/state.mjs 里的
// 头部注释）。下面用一份合成的多产物阶段夹具，真正把 .every 的「全部」语义
// （不是 .some 的「任一」）钉住。
const have = (...names) => (rel) => names.includes(rel)
const MULTI = { S2: { role: 'at-product', requires: [], produces: ['a.md', 'b.md'] } }

test('isStageDone：produces 全部存在时为 true', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('a.md', 'b.md') }), true)
})

// 这条是全部意义所在：只有一个产物存在时，.every 必须是 false——如果这里误用
// .some，任何一个产物一到位就会误报「这个阶段齐了」，提前催 PM 推进阶段、
// 在 history 里记一条它压根没做完的记录。
test('isStageDone：只有部分 produces 存在时为 false（.every 不是 .some）', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('a.md') }), false)
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('b.md') }), false)
})

test('isStageDone：一个产物都没有时为 false', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have() }), false)
})

test('isStageDone：produces 为空数组时为 false——没有产物义务不算"齐了"', () => {
  const stages = { S1: { role: 'at-pm', requires: [], produces: [] } }
  assert.equal(isStageDone({ stage: 'S1', stages, artifactExists: have() }), false)
})

test('isStageDone：stage 在 stages 里查不到、或 stages 本身不是对象时为 false，不抛', () => {
  assert.equal(isStageDone({ stage: 'S9', stages: MULTI, artifactExists: have() }), false)
  assert.equal(isStageDone({ stage: 'S2', stages: null, artifactExists: have() }), false)
  assert.equal(isStageDone({ stage: undefined, stages: MULTI, artifactExists: have() }), false)
})

// M2a：roster 可选参数。S5 这种多产者阶段，「齐了」取决于这一趟实际派了谁——
// 上面五条都不传 roster，走的是「退回全部 producers」那条兼容路径，不受这里影响。
const S5_MULTI = {
  S5: { role: 'at-backend', producers: ['at-backend', 'at-frontend'], produces: ['05-impl/<role>.md'] },
}

test('isStageDone：S5 只按 roster 里的执行角色判——没派到的角色不拖住推进', () => {
  const done = isStageDone({
    stage: 'S5', stages: S5_MULTI, roster: ['at-backend'],
    artifactExists: have('05-impl/at-backend.md'),
  })
  assert.equal(done, true)
})

test('isStageDone：roster 里有两个执行角色而只交了一个时为 false', () => {
  const done = isStageDone({
    stage: 'S5', stages: S5_MULTI, roster: ['at-backend', 'at-frontend'],
    artifactExists: have('05-impl/at-backend.md'),
  })
  assert.equal(done, false)
})

test('isStageDone：roster 缺省时按全部 producers 判——不传 roster 不等于不判', () => {
  const done = isStageDone({
    stage: 'S5', stages: S5_MULTI,
    artifactExists: have('05-impl/at-backend.md'),
  })
  assert.equal(done, false)
})

// ---------------------------------------------------------------------------
// M3x：isStageDone 按段取参与者（全量审查第 14 条，docs/32）
// ---------------------------------------------------------------------------
//
// 门禁的两处调用把 participantsOf(state, state.stage) 交给 isStageDone 的 roster 形参（形参名不改）。这一组用
// 真实 stages.json 钉这个组合在 at-ui 两段身份上的答案：at-ui 是 S2 与 S5 的产者，整趟的 roster 分不出它在哪一段干的活。
// 成对写：同一个开局，只差这一段记没记账或记了谁。
const REAL_STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const doneByStage = (state, ...disk) =>
  isStageDone({ stage: state.stage, stages: REAL_STAGES, artifactExists: have(...disk), roster: participantsOf(state, state.stage) })
const S5_BF = ['05-impl/at-backend.md', '05-impl/at-frontend.md']
// at-ui 在 S2 干过活、S5 记了账（叫到 at-architect 分发、at-backend 与 at-frontend 实现）、还没推进。
const S5_ACCOUNTED = {
  stage: 'S5',
  roster: ['at-product', 'at-ui', 'at-architect', 'at-backend', 'at-frontend'],
  stage_roles: { S2: ['at-product', 'at-ui'], S3: ['at-architect'], S5: ['at-architect', 'at-backend', 'at-frontend'] },
}

test('M3x isStageDone：at-ui 只在 S2 干过、S5 记了账没派它——backend 与 frontend 交齐就是齐（整趟 roster 下永远不齐）', () => {
  assert.equal(doneByStage(S5_ACCOUNTED, ...S5_BF), true)
  // 对照：同一份 state 按整趟 roster 判，S5 会去等 05-impl/at-ui.md——第 14 条报的就是这一格。
  assert.equal(isStageDone({ stage: 'S5', stages: REAL_STAGES, artifactExists: have(...S5_BF), roster: S5_ACCOUNTED.roster }), false)
})

test('M3x isStageDone：S5 还没记账、at-ui 在 S2 进过 roster、它的实现记录先落盘——不齐（整趟 roster 下会提前判齐）', () => {
  const state = { stage: 'S5', roster: ['at-product', 'at-ui', 'at-architect'], stage_roles: { S2: ['at-product', 'at-ui'], S3: ['at-architect'] } }
  assert.equal(doneByStage(state, '05-impl/at-ui.md'), false)
  assert.equal(isStageDone({ stage: 'S5', stages: REAL_STAGES, artifactExists: have('05-impl/at-ui.md'), roster: state.roster }), true)
})

test('M3x isStageDone：S5 记着叫到 at-ui 与 at-backend、只有 at-ui 交了——不齐', () => {
  const state = { ...S5_ACCOUNTED, stage_roles: { ...S5_ACCOUNTED.stage_roles, S5: ['at-ui', 'at-backend'] } }
  assert.equal(doneByStage(state, '05-impl/at-ui.md'), false)
})

// 产物固定的段（produces 里没有一条随参与者展开）与这一段记没记账无关：参与者是空集也照磁盘判。
// 防的是「当前段没记账一律判不齐」那种读法——那会让这些段的【阶段】与 H5a 在记账之前全部哑掉。
test('M3x isStageDone：产物固定的段没记账（参与者是空集）也照磁盘判', () => {
  for (const stage of ['S1', 'S3', 'S4', 'S6', 'S7', 'S8']) {
    const state = { stage, roster: ['at-product'], stage_roles: { S2: ['at-product'] } }
    assert.deepEqual(participantsOf(state, stage), [], `前置：${stage} 没有键，参与者应是空集`)
    assert.equal(isStageDone({ stage, stages: REAL_STAGES, artifactExists: () => true, roster: participantsOf(state, stage) }), true, stage)
  }
})

test('M3x isStageDone：没有 stage_roles 的旧 run 照旧按整趟 roster 判', () => {
  assert.equal(doneByStage({ stage: 'S5', roster: ['at-architect', 'at-backend'] }, '05-impl/at-backend.md'), true)
  assert.equal(doneByStage({ stage: 'S5', roster: ['at-architect', 'at-backend', 'at-frontend'] }, '05-impl/at-backend.md'), false)
})

// S2 的镜像：at-ui 只在 S5 干过活。这一格只在返工轮里到得了（S5 之后驳回 S2），返工轮的「一回退就判齐」归第 15 条
// ——这里只钉期望集合：S2 不再去等 at-ui 的两份。
// M3y（docs/33）收口：调用点经 freshness 之后，上一轮的 01-prd.md 不再让 S2 判齐（hook 层的判据在
// tests/gate-rework-freshness.test.mjs）；这一格仍只钉期望集合，isStageDone 本身不知道新旧。
test('M3x isStageDone：at-ui 只在 S5 干过，S2 按段只等 01-prd.md', () => {
  const state = { stage: 'S2', roster: ['at-product', 'at-architect', 'at-ui'], stage_roles: { S2: ['at-product'], S3: ['at-architect'], S5: ['at-ui'] } }
  assert.equal(doneByStage(state, '01-prd.md'), true)
})

// ---------------------------------------------------------------------------
// M3x：validateState 的 stage_roles 校验
// ---------------------------------------------------------------------------
//
// stage_roles 是 roster 按段拆开：值里的每个角色都要在 roster 里，roster 里的每个角色都要在某一段里。不要求是那一段的
// 产者——架构师在 S5 被叫去分发、PM 在 S3 叫 at-product 澄清需求，都是首轮走得到的「叫到」。缺失不报：更早落盘的旧 run
// 没有它，门禁按 roster 判。
const SR_OK = () => ({
  run_id: '20260917-1430-login-sso',
  stage: 'S6',
  contract_sha: SHA,
  roster: ['at-product', 'at-ui', 'at-architect', 'at-backend', 'at-frontend', 'at-qa'],
  stage_roles: {
    S2: ['at-product', 'at-ui'],
    S3: ['at-architect', 'at-product'],
    S5: ['at-architect', 'at-backend', 'at-frontend'],
    S6: ['at-qa'],
  },
  trimmed: { 'at-ios': 'S5' },
  artifacts: {},
  rework: {},
  never_invoked: [],
  escalations: [],
  history: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((stage) => ({ stage, at: '2026-09-17T14:30:00Z' })),
})
const srProblems = (over) => validateState({ ...SR_OK(), ...over }, { stages: REAL_STAGES }).problems

test('M3x validateState：合法的 stage_roles 通过——非产者的叫到（S5 的架构师、S3 叫来澄清需求的 at-product）也合法', () => {
  assert.deepEqual(srProblems({}), [])
})

test('M3x validateState：没有 stage_roles 不报——旧 run', () => {
  const s = SR_OK()
  delete s.stage_roles
  assert.deepEqual(validateState(s, { stages: REAL_STAGES }).problems, [])
})

test('M3x validateState：stage_roles 不是对象时报出来', () => {
  assert.ok(srProblems({ stage_roles: ['S2'] }).some((x) => /stage_roles 不是对象/.test(x)))
  assert.ok(srProblems({ stage_roles: null }).some((x) => /stage_roles 不是对象/.test(x)))
})

test('M3x validateState：stage_roles 的键不在阶段链里时报出来', () => {
  const r = srProblems({ stage_roles: { ...SR_OK().stage_roles, S9: [] } })
  assert.ok(r.some((x) => /stage_roles 里有 "S9"，但 stages\.json 里没有这个阶段/.test(x)), r.join('\n'))
  // 继承来的键名也不在阶段链里（hasOwn，不是 in）。
  for (const k of ['constructor', 'toString']) {
    const rk = srProblems({ stage_roles: { ...SR_OK().stage_roles, [k]: [] } })
    assert.ok(rk.some((x) => x.includes(`stage_roles 里有 "${k}"，但 stages.json 里没有这个阶段`)), `${k}：${rk.join('\n')}`)
  }
})

// 每一种坏值都恰好报一条、不抛：报完不再往下核这个值（字符串会被逐字当成角色、null 迭代会抛，ledger 整条崩掉）。
test('M3x validateState：stage_roles 的值不是字符串数组时恰好报一条，不抛', () => {
  for (const bad of [null, 5, { a: 1 }, true, [1], 'at-acceptance']) {
    const r = srProblems({ stage_roles: { ...SR_OK().stage_roles, S7: bad } })
    assert.deepEqual(r.filter((x) => x.includes('stage_roles["S7"]')), ['stage_roles["S7"] 不是字符串数组'], JSON.stringify(bad))
  }
})

test('M3x validateState：stage_roles 里记着、roster 里没有的角色报出来', () => {
  const r = srProblems({ stage_roles: { ...SR_OK().stage_roles, S5: ['at-architect', 'at-backend', 'at-frontend', 'at-android'] } })
  assert.ok(r.some((x) => /stage_roles\["S5"\] 里有 "at-android"，roster 里却没有它/.test(x)), r.join('\n'))
})

test('M3x validateState：roster 里有、stage_roles 哪一段都没记的角色报出来', () => {
  const r = srProblems({ stage_roles: { S2: ['at-product', 'at-ui'], S3: ['at-architect', 'at-ios'], S6: ['at-qa'] } })
  assert.ok(r.some((x) => /roster 里有 "at-backend"，但 stage_roles 没有任何一段记着它/.test(x)), r.join('\n'))
  assert.ok(r.some((x) => /roster 里有 "at-frontend"，但 stage_roles 没有任何一段记着它/.test(x)), r.join('\n'))
})

// 叫到之后又裁掉（预算耗尽之类）：stage_roles 与 trimmed 同一段同时记着它，两样都是真事，不报。
test('M3x validateState：同一段既在 stage_roles 又在 trimmed 不报——叫到之后又裁掉', () => {
  assert.deepEqual(srProblems({ trimmed: { 'at-frontend': 'S5' } }), [])
})

test('M3x validateState：不给 stages 时跳过键的归属校验，其余照查', () => {
  const s = { ...SR_OK(), stage_roles: { ...SR_OK().stage_roles, S9: ['at-nobody'] } }
  const r = validateState(s, {}).problems
  assert.ok(!r.some((x) => /stages\.json 里没有这个阶段/.test(x)), r.join('\n'))
  assert.ok(r.some((x) => /stage_roles\["S9"\] 里有 "at-nobody"，roster 里却没有它/.test(x)), r.join('\n'))
})

// Task 7：驳回路由。规格 §4.3 那张表此前没有任何代码消费它，nextStage 只会前进一格。
// rejectTo(kind) 把那张表搬进代码，成为单一真源。
test('rejectTo：需求理解错回到 S2', () => {
  assert.equal(rejectTo('requirement'), 'S2')
})

test('rejectTo：设计错回到 S3', () => {
  assert.equal(rejectTo('design'), 'S3')
})

test('rejectTo：实现错回到 S5', () => {
  assert.equal(rejectTo('implementation'), 'S5')
})

test('rejectTo：契约内在矛盾不由代码决定回哪，返回 null 走升级', () => {
  assert.equal(rejectTo('contract-conflict'), null)
})

test('rejectTo：不认识的 kind 返回 null，不抛', () => {
  assert.equal(rejectTo('nonsense'), null)
})

test('前置条件：REJECTION_KINDS 恰好是规格 §4.3 的四类', () => {
  assert.deepEqual([...REJECTION_KINDS], ['requirement', 'design', 'implementation', 'contract-conflict'])
})

test('contract-conflict 同时也是 ESCALATION_KINDS 的一类——它走升级不走路由', () => {
  assert.ok(ESCALATION_KINDS.includes('contract-conflict'))
})

// 这条防的是将来有人顺手给 validateState 加一条「stage 只能前进」的校验，把
// rejectTo 刚搬进代码的回退路径静默掐断。validateState 现在不校验阶段前后关系，
// 所以这条测试今天就该是绿的——它的价值在未来，不在今天。
//
// 不能复用顶部的 STAGES：那份只到 S3，而且下面「nextStage 按 stages 的书写顺序走」
// 那条测试依赖 STAGES 恰好在 S3 处到头（nextStage(STAGES, 'S3') === null）。把
// STAGES 扩到 S5/S6 会让那条测试从绿变红——单独建一份只给这条测试用的 stages 夹具。
const STAGES_WITH_REWORK = {
  S5: { role: 'at-backend', requires: [], produces: ['05-impl/at-backend.md'] },
  S6: { role: 'at-qa', requires: ['05-impl/at-backend.md'], produces: ['06-test-report.md'] },
}

test('回退后的 state 仍然合法：stage 指向更早的阶段、history 追加一条、rework 跟着涨', () => {
  const state = {
    run_id: '20260919-0421-x', stage: 'S5', contract_sha: SHA,
    roster: ['at-backend'], artifacts: {}, never_invoked: [], escalations: [],
    rework: { S5: 1 },
    history: [{ stage: 'S5', at: 'x' }, { stage: 'S6', at: 'x' }, { stage: 'S5', at: 'x' }],
  }
  assert.deepEqual(validateState(state, { stages: STAGES_WITH_REWORK }).problems, [])
})

// 规格 §4.3 ↔ 代码的闭包：那张表的单一真源现在是 rejectTo(kind)，这两条测试把
// 规格正文与代码钉在一起。**必须成对**——下面这条从规格正则解析出三行、逐行核对
// rejectTo；正则一旦因为规格改排版而匹配不到，循环零次，那条测试会全绿而不是报错。
// 紧跟着的前置条件测试就是防这个：钉住「真的解析出了 3 行」。
//
// ⚠️ 用 Write 工具落的这两条，没有走 Bash heredoc——heredoc 会吞掉正则里 \| 与 \d
// 的反斜杠，导致测试假绿（M1c 终审复评踩过这个坑）。
test('规格 §4.3 表里的每一行都能在 rejectTo 里命中', () => {
  const spec = readFileSync(new URL('../docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md', import.meta.url), 'utf8')
  const rows = [...spec.matchAll(/^\| (需求理解错|设计错|实现错) \| .*? \| (S\d) → S8 \|$/gm)]
  const byLabel = { 需求理解错: 'requirement', 设计错: 'design', 实现错: 'implementation' }
  for (const m of rows) {
    assert.equal(rejectTo(byLabel[m[1]]), m[2], `规格 §4.3 的「${m[1]}」写的是回到 ${m[2]}，rejectTo 答的是 ${rejectTo(byLabel[m[1]])}`)
  }
})

test('前置条件：上一条真的从规格里解析出了 3 行——否则它是空转', () => {
  const spec = readFileSync(new URL('../docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md', import.meta.url), 'utf8')
  const rows = [...spec.matchAll(/^\| (需求理解错|设计错|实现错) \| .*? \| (S\d) → S8 \|$/gm)]
  assert.equal(rows.length, 3)
})

// ---------------------------------------------------------------------------
// M3y：validateState 的 rework_base 校验（docs/33）
// ---------------------------------------------------------------------------
//
// rework_base 记着上一次回退那一刻各份产物的 sha（{ 产物名: sha | "accepted" }）。写时的规则在 H6（tests/rework-base.test.mjs）；
// 这里只核形状，缺失不报——更早落盘的 run 没有它。值不回显：一个 sha 写错了，回显 64 位十六进制只是噪声。
const rbProblems = (rework_base) => validateState({ ...SR_OK(), rework_base }, { stages: REAL_STAGES }).problems

test('M3y validateState：合法的 rework_base（sha 与 "accepted"）、{} 都通过；没有 rework_base 不报', () => {
  assert.deepEqual(rbProblems({ '05-impl/at-backend.md': SHA, '05-impl/at-ui.md': 'accepted', '06-test.md': SHA }), [])
  assert.deepEqual(rbProblems({}), [])
  assert.deepEqual(validateState(SR_OK(), { stages: REAL_STAGES }).problems, [])
})

test('M3y validateState：rework_base 不是对象时报出来', () => {
  for (const bad of [null, [], 'x', 3]) {
    assert.ok(rbProblems(bad).some((x) => /rework_base 不是对象/.test(x)), JSON.stringify(bad))
  }
})

test('M3y validateState：rework_base 的键不是任何阶段的产物时报出来（继承来的键名也报）', () => {
  for (const k of ['09-extra.md', 'constructor']) {
    const r = rbProblems({ [k]: SHA })
    assert.ok(r.some((x) => x.includes(`rework_base 里有 "${k}"，但它不是任何阶段的 produces`)), `${k}：${r.join('\n')}`)
  }
})

test('M3y validateState：rework_base 的值既不是 sha 也不是 "accepted" 时报出来，值不回显', () => {
  for (const bad of ['sha256:xyz', 'ACCEPTED', 'deleted-content-marker', 1, null, {}]) {
    const r = rbProblems({ '06-test.md': bad })
    assert.deepEqual(r, ['rework_base["06-test.md"] 既不是 sha256:<64 位十六进制> 也不是 "accepted"'], JSON.stringify(bad))
  }
})

test('M3y validateState：不给 stages 时跳过键的归属校验，值照查', () => {
  const r = validateState({ ...SR_OK(), rework_base: { '09-extra.md': SHA, '06-test.md': 'x' } }, {}).problems
  assert.deepEqual(r, ['rework_base["06-test.md"] 既不是 sha256:<64 位十六进制> 也不是 "accepted"'])
})

// 复核（docs/34 §3，budget-3）：history 里链外的条目（v1.7.0 及更早写进去的收口标记 DONE）现在改不了也删不掉（H6：已有条目的段名
// 不许改、条目不许删）。报进 problems 会让【state.json】每次都叫「改完再继续」——单列成 legacy，ledger 说明不用管。
test('复核：history 里不在阶段链上的条目单列在 legacy，不进 problems', () => {
  const history = [{ stage: 'S1', at: 'x' }, { stage: 'S2', at: 'x' }, { stage: 'DONE', at: 'x' }, { stage: 'S2', at: 'x' }]
  const r = validateState(good({ stage: 'S2', history, rework: { S2: 1 } }), { stages: STAGES })
  assert.deepEqual(r.problems, [])
  assert.equal(r.legacy.length, 1)
  assert.match(r.legacy[0], /history\[2\]/)
  assert.match(r.legacy[0], /"DONE"/)
})

// M4a（docs/35）：收口标记 closed_at——形状与「只在最后一段」。H6 写时就拒（hooks/lib/closing.mjs）；这里是事后那一道，
// 经修复路（写入前读不出来）或 Bash 落盘的才走得到。
test('M4a closed_at：空串、空白、不是字符串 → 报形状；null（模板的初值）不报', () => {
  assert.deepEqual(validateState(good({ closed_at: null }), { stages: STAGES }).problems.filter((m) => /closed_at/.test(m)), [])
  for (const v of ['', '  ', true, 1, []]) {
    const r = validateState(good({ closed_at: v }), { stages: STAGES })
    assert.ok(r.problems.some((m) => /closed_at/.test(m) && /ISO 时间/.test(m)), JSON.stringify(v))
  }
})

test('M4a closed_at：写了、stage 却不是阶段链最后一段 → 报', () => {
  const r = validateState(good({ closed_at: '2026-10-01T15:00:00Z' }), { stages: STAGES })
  assert.ok(r.problems.some((m) => /closed_at/.test(m) && /最后一段（S3）/.test(m)), r.problems.join('\n'))
})

test('M4a closed_at：在最后一段、形状对 → 不报；没写 → 不报', () => {
  const hist = [...good().history, { stage: 'S3', at: '2026-09-17T15:00:00Z' }]
  const closed = validateState(good({ stage: 'S3', history: hist, closed_at: '2026-10-01T15:00:00Z' }), { stages: STAGES })
  assert.deepEqual(closed.problems.filter((m) => /closed_at/.test(m)), [])
  assert.deepEqual(validateState(good(), { stages: STAGES }).problems.filter((m) => /closed_at/.test(m)), [])
})

// M4a 复核（ST03）：阶段链读不出来时，不报「收口只在最后一段（null）」。
test('M4a 复核 closed_at：阶段链读不出来时不报「最后一段」那一条', () => {
  const r = validateState(good({ closed_at: '2026-10-01T15:00:00Z' }), { stages: null })
  assert.deepEqual(r.problems.filter((m) => /最后一段/.test(m)), [])
})

// M4a 复核二（G8）：validateState 引出 closed_at 的原值，不说「空串或者别的类型」。
test('M4a 复核二 closed_at：形状不对时引出原值', () => {
  const r = validateState(good({ closed_at: '2026-10-01 15:00:00' }), { stages: STAGES })
  assert.ok(r.problems.some((m) => m.includes('"2026-10-01 15:00:00"')), r.problems.join('\n'))
})

// M4i（docs/44，审查第 36 条）：state.json 里的角色名写裸名。带插件前缀的（agent-team:at-backend）对不上 stages.json 的产者名——按段的判据
// 认不出它，没有派发记录时缺产物的推进会被放过、【阶段】哑掉。roster、stage_roles、trimmed 的键、never_invoked 里的都报，同一个名字只报一次。
test('M4i 第 36 条：state.json 里带插件前缀的角色名——四处都报、同一个名字只报一次，说写裸名', () => {
  const r = validateState(
    good({ roster: ['agent-team:at-product'], stage_roles: { S2: ['agent-team:at-product'] }, trimmed: { 'agent-team:at-architect': 'S3' }, never_invoked: ['agent-team:at-qa'] }),
    { stages: STAGES },
  )
  const pre = (n) => r.problems.filter((x) => x.startsWith(`"${n}" 带着插件前缀`))
  for (const n of ['agent-team:at-product', 'agent-team:at-architect', 'agent-team:at-qa']) assert.equal(pre(n).length, 1, r.problems.join(' / '))
  assert.ok(pre('agent-team:at-product')[0].includes('写裸名 "at-product"'), pre('agent-team:at-product')[0])
  assert.ok(!r.problems.some((x) => x.includes('trimmed 里有 "agent-team:at-architect"')), '前缀那一条说清了，不再说它不是任何阶段的产者')
  assert.ok(!validateState(good(), { stages: STAGES }).problems.some((x) => x.includes('插件前缀')))
})

// M4i（docs/44，审查第 36 条）：roster 与 never_invoked 的交集——同一个角色不能既算叫到了、又算没被叫过；/agent-team:at 第 6 节叫 PM 写完自查，
// 门禁此前不核。
test('M4i 第 36 条：roster 与 never_invoked 有交集——报出来，说 never_invoked 收口时才算', () => {
  const r = validateState(good({ roster: ['at-product'], never_invoked: ['at-product', 'at-frontend'] }), { stages: STAGES })
  assert.ok(
    r.problems.includes('roster 与 never_invoked 都有 "at-product"：同一个角色不能既算叫到了、又算没被叫过——never_invoked 收口时才算（/agent-team:at 第 6 节）'),
    r.problems.join(' / '),
  )
  assert.ok(!validateState(good(), { stages: STAGES }).problems.some((x) => x.includes('never_invoked 都有')))
})

// M4i 复核变异：四处各用不同的名字——同一个名字只报一次，四处共用一个名字时，少看哪一处都测不出来。
test('M4i 第 36 条：带前缀的名字只出现在某一处也报（roster、stage_roles、trimmed、never_invoked 各自一个）', () => {
  const r = validateState(
    good({
      roster: ['agent-team:at-product', 'at-architect'],
      stage_roles: { S2: ['agent-team:at-product'], S3: ['at-architect', 'agent-team:at-frontend'] },
      trimmed: { 'agent-team:at-ui': 'S2' },
      never_invoked: ['agent-team:at-ios'],
    }),
    { stages: STAGES },
  )
  for (const n of ['agent-team:at-product', 'agent-team:at-frontend', 'agent-team:at-ui', 'agent-team:at-ios']) {
    assert.ok(r.problems.some((x) => x.startsWith(`"${n}" 带着插件前缀`)), `${n}：${r.problems.join(' / ')}`)
  }
})

// M4i 复核（docs/44 §8）：交集里重复的名字只列一次（M05）；trimmed 的键带前缀、裸名也不是产者的，照旧说它不是产者（M10）；项目经理被记进
// roster 或 stage_roles 报出来（低-9：M5f 里 haiku 版 PM 这样记过）；只剩插件前缀的退化名不说「写裸名 "agent-team:"」。
test('M4i 复核：交集去重；trimmed 带前缀的非产者照旧报；at-pm 进了 roster 或 stage_roles 报；退化名不自相矛盾', () => {
  const dup = validateState(good({ roster: ['at-product'], never_invoked: ['at-product', 'at-product'] }), { stages: STAGES })
  assert.ok(dup.problems.includes('roster 与 never_invoked 都有 "at-product"：同一个角色不能既算叫到了、又算没被叫过——never_invoked 收口时才算（/agent-team:at 第 6 节）'), dup.problems.join(' / '))
  const nr = validateState(good({ trimmed: { 'agent-team:not-a-role': 'S2' } }), { stages: STAGES })
  assert.ok(nr.problems.some((x) => x.startsWith('trimmed 里有 "agent-team:not-a-role"，但它不是任何阶段的产者')), nr.problems.join(' / '))
  const pm = validateState(good({ roster: ['at-product', 'at-pm'], stage_roles: { S2: ['at-product'], S1: ['at-pm'] } }), { stages: STAGES })
  assert.ok(pm.problems.includes('项目经理（"at-pm"）不进 roster 与 stage_roles：它们记的是叫到的角色，你自己做的那几段不写'), pm.problems.join(' / '))
  assert.equal(pm.problems.filter((x) => x.startsWith('项目经理（')).length, 1, pm.problems.join(' / '))
  const onlyStage = validateState(good({ roster: ['at-product'], stage_roles: { S2: ['at-product'], S1: ['agent-team:at-pm'] } }), { stages: STAGES })
  assert.ok(onlyStage.problems.includes('项目经理（"agent-team:at-pm"）不进 roster 与 stage_roles：它们记的是叫到的角色，你自己做的那几段不写'), onlyStage.problems.join(' / '))
  const degenerate = validateState(good({ roster: ['at-product', 'agent-team:'] }), { stages: STAGES })
  assert.ok(!degenerate.problems.some((x) => x.includes('写裸名 "agent-team:"')), degenerate.problems.join(' / '))
})
