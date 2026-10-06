// 第 16 条（M3z，docs/34）：返工预算的批准——标签、批准记录、上限、回退预判。纯函数。
//
// 第 3 轮终局之后，用户经规范标签批准才续一轮，门禁自己记下批准（approvals.jsonl），H6、validateState、【阶段】按它放宽上限。
// 这里钉单一真源 hooks/lib/budget.mjs：标签怎么写、怎么认（平台会给推荐项加「(Recommended)」、模型会把冒号写成半角）、
// 批准怎么读（只数 covers）、回退预判按哪一种计数（O5：写入后 history 里、最后那条回退条目之前的出现次数）、
// 一条批准什么时候才算需要（O1：只在预判越限时记，covers 是越限的段）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_PREFIX,
  STOP_LABEL,
  approvalLabel,
  approvalIntent,
  parseApprovalLabel,
  readGrants,
  limitOf,
  grantsSummary,
  lastRestart,
  overLimit,
  needOf,
  approvalTargetFor,
} from '../hooks/lib/budget.mjs'
import { REWORK_LIMIT } from '../hooks/lib/state.mjs'

const STAGES = {
  S1: { role: 'at-pm', produces: ['00-contract.md'] },
  S2: { role: 'at-product', produces: ['01-prd.md'] },
  S3: { role: 'at-architect', produces: ['03-arch.md'] },
  S4: { role: 'at-pm', produces: ['04-dispatch.md'] },
  S5: { role: 'at-backend', produces: ['05-impl/<role>.md'] },
  S6: { role: 'at-qa', produces: ['06-test.md'] },
  S7: { role: 'at-acceptance', produces: ['07-acceptance.md'] },
  S8: { role: 'at-pm', produces: ['08-delivery.md'] },
}
const H = (...ids) => ids.map((stage) => ({ stage, at: 'x' }))
const FIRST = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']
// S6 → S5 回退 n 次之后的 history（每一轮都重进 S6）。
const rounds = (n) => {
  const out = [...FIRST]
  for (let i = 0; i < n; i++) out.push('S5', 'S6')
  return H(...out)
}
const line = (o) => JSON.stringify(o)

// ============================================================================ 标签

test('规范标签：全角冒号、段 id 原样；停在这里那一项是固定文字', () => {
  assert.equal(approvalLabel('S5'), '再返工一轮：回到 S5')
  assert.equal(STOP_LABEL, '停在这里')
  assert.ok(approvalLabel('S5').startsWith(APPROVAL_PREFIX))
})

test('标签往返：链上每一段 parse(label(id)) === id', () => {
  for (const id of Object.keys(STAGES)) assert.equal(parseApprovalLabel(approvalLabel(id)), id)
})

test('应收：平台加的推荐后缀、半角冒号、全角字母数字、空白不同', () => {
  for (const s of [
    '再返工一轮：回到 S5 (Recommended)',
    '再返工一轮：回到 S5 (recommended)',
    '再返工一轮：回到 S5（推荐）',
    '再返工一轮：回到 S5(推荐)',
    '再返工一轮:回到 S5',
    '再返工一轮：回到 Ｓ５',
    '再返工一轮：回到S5',
    '  再返工一轮：回到 S5\n',
    '再返工一轮： 回到　S5',
  ]) {
    assert.equal(parseApprovalLabel(s), 'S5', s)
  }
})

test('应拒：别的后缀、两个后缀、别的话、停在这里、非字符串', () => {
  for (const s of [
    '再返工一轮：回到 S5（不推荐）',
    '再返工一轮：回到 S5（最快，推荐）',
    '再返工一轮：回到 S5 (Recommended) (Recommended)',
    '再返工一轮：回到 S5，先修后端',
    '好的，再返工一轮：回到 S5',
    '再返工一轮',
    '再返工一轮：回到',
    '停在这里 (Recommended)',
    '停在这里',
    'Continue one more round',
    '',
  ]) {
    assert.equal(parseApprovalLabel(s), null, s)
  }
  for (const v of [null, undefined, 5, ['再返工一轮：回到 S5'], { a: 1 }]) assert.equal(parseApprovalLabel(v), null)
})

test('approvalIntent：认得出的给段；像批准却认不出的标 malformed（回传说原因）；不相干的给 null', () => {
  assert.deepEqual(approvalIntent('再返工一轮：回到 S5 (Recommended)'), { stage: 'S5' })
  assert.deepEqual(approvalIntent('再返工一轮：回到 S5（不推荐）'), { malformed: true })
  assert.deepEqual(approvalIntent('再 返工一轮，回到 S5 吧'), { malformed: true })
  assert.equal(approvalIntent('停在这里'), null)
  assert.equal(approvalIntent('先别继续，我想看看 06-test.md 再说'), null)
  assert.equal(approvalIntent(42), null)
})

// ============================================================================ 批准记录

test('readGrants：只认 covers 是链上段 id 组成的非空数组的行；坏行、坏元素整行不算', () => {
  const text = [
    line({ at: 't', source: 'ask', rework_to: 'S5', covers: ['S5', 'S6'] }),
    '{坏行',
    line({ rework_to: 'S5' }),
    line({ rework_to: 'S5', covers: [] }),
    line({ rework_to: 'S5', covers: ['S5', 'S9'] }),
    line({ rework_to: 'S5', covers: ['S5', 5] }),
    line({ rework_to: 'S5', covers: 'S5' }),
    line(['S5']),
    '',
    line({ rework_to: 'S9', covers: ['S2'] }),
    line({ rework_to: 'S2', covers: ['toString'] }),
  ].join('\n')
  assert.deepEqual(readGrants(text, STAGES), [
    { reworkTo: 'S5', covers: ['S5', 'S6'] },
    { reworkTo: null, covers: ['S2'] },
  ])
})

test('readGrants：没有文件、阶段链读不出来 → 一条都不算（更严的一侧）', () => {
  assert.deepEqual(readGrants(null, STAGES), [])
  assert.deepEqual(readGrants(undefined, STAGES), [])
  assert.deepEqual(readGrants(line({ rework_to: 'S5', covers: ['S5'] }), null), [])
  assert.deepEqual(readGrants(line({ rework_to: 'S5', covers: ['S5'] }), []), [])
})

test('readGrants：带 BOM、CRLF 照样读', () => {
  const text = String.fromCharCode(0xfeff) + line({ rework_to: 'S5', covers: ['S5'] }) + '\r\n' + line({ rework_to: 'S2', covers: ['S2'] }) + '\r\n'
  assert.equal(readGrants(text, STAGES).length, 2)
})

test('limitOf：上限 = REWORK_LIMIT + 覆盖这一段的批准条数；只数 covers，不数 rework_to', () => {
  const grants = [
    { reworkTo: 'S5', covers: ['S5', 'S6'] },
    { reworkTo: 'S2', covers: ['S2', 'S3'] },
    { reworkTo: 'S5', covers: ['S5'] },
  ]
  assert.equal(limitOf('S5', grants), REWORK_LIMIT + 2)
  assert.equal(limitOf('S6', grants), REWORK_LIMIT + 1)
  assert.equal(limitOf('S2', grants), REWORK_LIMIT + 1)
  assert.equal(limitOf('S4', grants), REWORK_LIMIT)
  assert.equal(limitOf('S7', []), REWORK_LIMIT)
  assert.equal(limitOf('S7', undefined), REWORK_LIMIT)
})

test('grantsSummary：条数与每条回到哪、覆盖哪几段；没有就说 0 条', () => {
  assert.equal(grantsSummary([]), '0 条')
  assert.equal(
    grantsSummary([{ reworkTo: 'S5', covers: ['S5', 'S6'] }, { reworkTo: null, covers: ['S2'] }]),
    '2 条（回到 S5，覆盖 S5、S6；覆盖 S2）',
  )
})

// ============================================================================ 回退预判

test('lastRestart：最后一条「在链上不晚于前一条」的条目下标；链外条目两头都不比', () => {
  assert.equal(lastRestart(H(...FIRST), STAGES), -1)
  assert.equal(lastRestart(rounds(2), STAGES), FIRST.length + 2)
  assert.equal(lastRestart(H('S1', 'S2', 'S2'), STAGES), 2)
  // 复核（budget-2）：链外条目跳过，与最近一条在链上的条目比——DONE 之后的 S1 早于 S2，是回退。
  assert.equal(lastRestart(H('S1', 'S2', 'DONE', 'S1'), STAGES), 3)
  assert.equal(lastRestart(H('S1', 'S2', 'DONE', 'S3'), STAGES), -1)
  assert.equal(lastRestart([], STAGES), -1)
  assert.equal(lastRestart(H('S1', 'S2', 'S1'), null), -1)
})

test('overLimit：在链上不早于回到的那一段、回退条目之前出现次数 > 上限的段', () => {
  // 三轮之后再回 S5：S5、S6 在回退条目之前各出现 4 次（第 4 轮）。
  const h = [...rounds(3), ...H('S5')]
  const at = h.length - 1
  assert.deepEqual(overLimit({ history: h, restartIndex: at, stages: STAGES, grants: [] }), [
    { stage: 'S5', rounds: 4, limit: 3 },
    { stage: 'S6', rounds: 4, limit: 3 },
  ])
  // 批准覆盖 S5、S6 之后不越限。
  assert.deepEqual(overLimit({ history: h, restartIndex: at, stages: STAGES, grants: [{ reworkTo: 'S5', covers: ['S5', 'S6'] }] }), [])
  // 第 3 轮不越限。
  const h3 = [...rounds(2), ...H('S5')]
  assert.deepEqual(overLimit({ history: h3, restartIndex: h3.length - 1, stages: STAGES, grants: [] }), [])
})

test('O5：补记（回退之后同一次写入又往前记了几段）按回退条目之前的出现次数算，预算内的补记不越限', () => {
  // S5、S6 各返工 2 轮（各出现 3 次），这一次补记 [S5, S6]：回退条目是 S5，S6 那一条在它之后，不算。
  const h = [...rounds(2), ...H('S5', 'S6')]
  const restartIndex = h.length - 2
  assert.deepEqual(overLimit({ history: h, restartIndex, stages: STAGES, grants: [] }), [])
})

test('O5：一次写入记两轮，按最后那条回退条目之前的出现次数算，在这一次就越限', () => {
  // S6、S7 各返工 2 轮（各出现 3 次）、S5 出现 1 次；一次写入追加 [S5, S6, S7, S5]：最后那条回退条目是末尾的 S5，
  // 它之前 S6、S7 各出现 4 次——第 4 轮。按写入前计数（各 3 次）会放行，三段之后推进才撞墙。
  const h = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S6', 'S7', 'S6', 'S7', 'S5', 'S6', 'S7', 'S5')
  const over = overLimit({ history: h, restartIndex: h.length - 1, stages: STAGES, grants: [] })
  assert.deepEqual(over.map((o) => o.stage), ['S6', 'S7'])
})

test('overLimit：回到的那一段之前的段不算；链外条目不算', () => {
  const h = [...H('S1', 'S2', 'S2', 'S2', 'S2', 'S3', 'S4', 'S5', 'S6', 'DONE'), ...H('S5')]
  // S2 出现 4 次，但它早于回到的 S5，这一轮不重进它。
  assert.deepEqual(overLimit({ history: h, restartIndex: h.length - 1, stages: STAGES, grants: [] }), [])
})

// ============================================================================ needOf：这条批准需不需要

const state = (history) => ({ stage: history[history.length - 1].stage, history })

test('needOf：上限内回到 T 不需要批准', () => {
  assert.deepEqual(needOf({ state: state(rounds(2)), stages: STAGES, grants: [], target: 'S5' }), [])
})

test('needOf：第 4 轮回到 S5 需要，covers 是越限的段', () => {
  assert.deepEqual(needOf({ state: state(rounds(3)), stages: STAGES, grants: [], target: 'S5' }), ['S5', 'S6'])
})

test('needOf：已有批准覆盖时不需要（同一次回答说两遍、又在对话里发一遍，只记一条）', () => {
  const grants = [{ reworkTo: 'S5', covers: ['S5', 'S6'] }]
  assert.deepEqual(needOf({ state: state(rounds(3)), stages: STAGES, grants, target: 'S5' }), [])
})

test('needOf：T 晚于 history 末条（不是回退）、T 不在链上、history 末条在链外、读不出 → 不需要', () => {
  const s = state(rounds(3))
  assert.deepEqual(needOf({ state: s, stages: STAGES, grants: [], target: 'S7' }), [])
  assert.deepEqual(needOf({ state: s, stages: STAGES, grants: [], target: 'S9' }), [])
  assert.deepEqual(needOf({ state: s, stages: STAGES, grants: [], target: 'toString' }), [])
  // 复核（budget-2）：末条是链外的 DONE 时，与最近一条在链上的条目（S6）比——回到 S5 是回退，照样算。
  assert.deepEqual(needOf({ state: { stage: 'DONE', history: [...rounds(3), ...H('DONE')] }, stages: STAGES, grants: [], target: 'S5' }), ['S5', 'S6'])
  assert.deepEqual(needOf({ state: { stage: 'DONE', history: H('DONE') }, stages: STAGES, grants: [], target: 'S5' }), [])
  assert.deepEqual(needOf({ state: null, stages: STAGES, grants: [], target: 'S5' }), [])
  assert.deepEqual(needOf({ state: s, stages: null, grants: [], target: 'S5' }), [])
  assert.deepEqual(needOf({ state: { stage: 'S6', history: 'x' }, stages: STAGES, grants: [], target: 'S5' }), [])
})

test('needOf：O2——批准回到 S2 只覆盖那一刻越限的段，还没走到的 S5、S6 不多给额度', () => {
  // 在 S3 发现需求错，第 4 次回 S2：S2、S3 各出现 4 次，S5、S6 还没进过。
  const h = H('S1', 'S2', 'S3', 'S2', 'S3', 'S2', 'S3', 'S2', 'S3')
  assert.deepEqual(needOf({ state: state(h), stages: STAGES, grants: [], target: 'S2' }), ['S2', 'S3'])
})

test('needOf：提前批准只盖当时越限的段——上限内问了不记', () => {
  assert.deepEqual(needOf({ state: state(rounds(1)), stages: STAGES, grants: [], target: 'S5' }), [])
})

// ============================================================================ 标签取哪一段

test('approvalTargetFor：取 history 里最后一次回退回到的那一段（不晚于越限的段）；没有回退就取越限的段本身', () => {
  assert.equal(approvalTargetFor({ history: rounds(3), stages: STAGES, stage: 'S6' }), 'S5')
  assert.equal(approvalTargetFor({ history: rounds(3), stages: STAGES, stage: 'S5' }), 'S5')
  assert.equal(approvalTargetFor({ history: H(...FIRST), stages: STAGES, stage: 'S6' }), 'S6')
  // 最后一次回退回到 S5，越限的却是更早的 S3（history 被别处改过）：取 S3 本身。
  assert.equal(approvalTargetFor({ history: rounds(3), stages: STAGES, stage: 'S3' }), 'S3')
})

test('approvalTargetFor 给的段，needOf 照它算出来的 covers 盖得住越限的那一段（批准丢了之后的补批准）', () => {
  // 第 4 轮已经记好（S5 出现 5 次），approvals.jsonl 丢了；现在要推进进 S6（第 4 轮）。
  const h = [...rounds(3), ...H('S5')]
  const target = approvalTargetFor({ history: h, stages: STAGES, stage: 'S6' })
  assert.equal(target, 'S5')
  const covers = needOf({ state: state(h), stages: STAGES, grants: [], target })
  assert.ok(covers.includes('S6'), JSON.stringify(covers))
  assert.ok(covers.includes('S5'), JSON.stringify(covers))
})

// ============================================================================ 变异补的判据（docs/34 §3）

// B11：limitOf 也数 rework_to 时，上面那条全绿——那几条批准的 rework_to 都恰好在 covers 里。
test('变异 B11：rework_to 不在 covers 里的批准，不给 rework_to 那一段额度', () => {
  assert.equal(limitOf('S5', [{ reworkTo: 'S5', covers: ['S6'] }]), REWORK_LIMIT)
})

// B16：needOf 去掉「T 晚于末条就不是回退」时，上面那条全绿——那份 history 里晚于末条的段从没进过、算不出越限。
test('变异 B16：往前走一段（不是回退）不需要批准，哪怕那一段之前已经进过很多次', () => {
  const h = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S6', 'S7', 'S6', 'S7', 'S6', 'S7', 'S6')
  assert.deepEqual(needOf({ state: state(h), stages: STAGES, grants: [], target: 'S7' }), [])
})

// 变异 X01：先剥推荐后缀、再删空白时全绿——「应收」里带后缀的几格都没有尾随空白、括号里也没有空格。
test('变异 X01：推荐后缀后面跟换行、括号里带空格，照样认得出', () => {
  assert.equal(parseApprovalLabel('再返工一轮：回到 S5 (Recommended)\n'), 'S5')
  assert.equal(parseApprovalLabel('再返工一轮：回到 S5 ( Recommended )'), 'S5')
})

// M4k（docs/46，评审 F4）：返工预算那一问（H6 的拒绝理由、【阶段】、【返工预算】共用 askUserText）——验收结论已经写成又没过的，可以加第三个选项「照现状交付」；
// 标签的单一真源在这里（verdict.mjs 原样再导出）。
test('M4k askUserText：带上第三个选项「照现状交付」的条件与标签；标签从 budget.mjs 来', async () => {
  const { askUserText: ask, DELIVER_LABEL: L } = await import('../hooks/lib/budget.mjs')
  const v = await import('../hooks/lib/verdict.mjs')
  assert.equal(L, '照现状交付')
  assert.equal(v.DELIVER_LABEL, L)
  const t = ask('S5', [], '再回退。')
  assert.ok(t.includes('这一轮的验收结论已经写成、第一行不是「结论：通过」的') && t.includes(`第三个选项，标签逐字写「${L}」`), t)
  // 复核（低 6）：问不了用户时，照现状交付的那一句也给。
  assert.ok(t.includes(`要照现状交付的，整条只写「${L}」`), t)
})
