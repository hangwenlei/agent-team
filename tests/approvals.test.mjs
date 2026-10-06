// 第 16 条（M3z，docs/34）：门禁记返工批准——纯函数部分（hooks/lib/approvals.mjs）。
//
// 两个来源：PostToolUse:AskUserQuestion 的 tool_response（宿主的真实答案；模型在 tool_input 里预填的被覆盖）、UserPromptSubmit
// 的整条 prompt。这里钉三件事：
//   - 只认 CLI 判为「answered」的回答：带 afkTimeoutMs（离开键盘、自动提交）、followUp（要追问）、response（另写了话）的一律不记
//     ——那三种情况下模型收到的分别是「用户离开了，自行判断」「先别动手」「用户回复了一段话」，门禁不能比模型看到的更宽（P6）；
//     多选题、数组与逗号串形状的答案不记（P2）；
//   - 逐条判需不需要，前一条记下之后再判下一条（同一次两题都选了，只记一条，O1）；
//   - prompt 只认整条规范化之后等于标签（task-notification 里模型写的文字、带说明的话都不算，P1、O7）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askAnswers, promptAnswer, promptDeliver, planApprovals, approvalLine, approvalNotices } from '../hooks/lib/approvals.mjs'
import { approvalLabel } from '../hooks/lib/budget.mjs'

const STAGES = {
  S1: { role: 'at-pm', produces: ['00-contract.md'] },
  S2: { role: 'at-product', produces: ['01-prd.md'] },
  S3: { role: 'at-architect', produces: ['03-arch.md'] },
  S4: { role: 'at-pm', produces: ['04-dispatch.md'] },
  S5: { role: 'at-backend', produces: ['05-impl/<role>.md'] },
  S6: { role: 'at-qa', produces: ['06-test.md'] },
  S7: { role: 'at-acceptance', produces: ['07-acceptance.md'] },
}
const L5 = approvalLabel('S5')
const Q = (question, multiSelect = false) => ({ question, header: 'h', multiSelect, options: [{ label: L5, description: '' }, { label: '停在这里', description: '' }] })
const resp = (answers, extra = {}, questions = Object.keys(answers).map((q) => Q(q))) => ({ questions, answers, ...extra })

// ============================================================================ 认回答

test('askAnswers：单选题选了规范标签（含平台加的推荐后缀）→ 候选', () => {
  assert.deepEqual(askAnswers(resp({ 'S5 第 4 轮？': L5 })), { excluded: null, items: [{ stage: 'S5' }] })
  assert.deepEqual(askAnswers(resp({ 'S5 第 4 轮？': `${L5} (Recommended)` })).items, [{ stage: 'S5' }])
})

test('askAnswers：不相干的回答 → 什么都没有（门禁不出声）', () => {
  assert.deepEqual(askAnswers(resp({ q: '停在这里' })), { excluded: null, items: [] })
  assert.deepEqual(askAnswers(resp({ q: '先别继续，我想看看 06-test.md 再说' })), { excluded: null, items: [] })
})

test('askAnswers：带 afkTimeoutMs、followUp、非空 response → 整次不记，给出原因；纯空白 response 照记', () => {
  assert.equal(askAnswers(resp({ q: L5 }, { afkTimeoutMs: 60000 })).excluded, 'afk')
  assert.equal(askAnswers(resp({ q: L5 }, { followUp: true })).excluded, 'follow-up')
  assert.equal(askAnswers(resp({ q: L5 }, { response: '等等，先别继续' })).excluded, 'response')
  assert.deepEqual(askAnswers(resp({ q: L5 }, { response: '  ' })), { excluded: null, items: [{ stage: 'S5' }] })
  assert.deepEqual(askAnswers(resp({ q: L5 }, { followUp: false })), { excluded: null, items: [{ stage: 'S5' }] })
})

test('askAnswers：被排除的回答里没有像批准的，就不出声', () => {
  assert.deepEqual(askAnswers(resp({ q: '停在这里' }, { afkTimeoutMs: 60000 })), { excluded: null, items: [] })
})

test('askAnswers：多选题、数组、逗号串、带别的后缀 → 不记，各给原因', () => {
  assert.deepEqual(askAnswers(resp({ q: L5 }, {}, [Q('q', true)])).items, [{ why: 'multi' }])
  assert.deepEqual(askAnswers(resp({ q: [L5] })).items, [{ why: 'array' }])
  assert.deepEqual(askAnswers(resp({ q: `${L5}, 停在这里` })).items, [{ why: 'malformed' }])
  assert.deepEqual(askAnswers(resp({ q: `${L5}（不推荐）` })).items, [{ why: 'malformed' }])
})

test('askAnswers：一次两题都选了规范标签 → 两条候选（是否都记由 planApprovals 逐条判）', () => {
  assert.deepEqual(askAnswers(resp({ a: L5, b: L5 })).items, [{ stage: 'S5' }, { stage: 'S5' }])
})

test('askAnswers：形状不对的 tool_response（不是对象、answers 不是对象）→ 什么都没有', () => {
  for (const tr of [null, 'x', [], { answers: [L5] }, { questions: [], answers: null }]) {
    assert.deepEqual(askAnswers(tr), { excluded: null, items: [] }, JSON.stringify(tr))
  }
})

test('promptAnswer：整条 prompt 规范化之后等于标签才算；带说明的话、多行、task-notification 都不算', () => {
  assert.equal(promptAnswer(L5), 'S5')
  assert.equal(promptAnswer(`  ${L5}\n`), 'S5')
  assert.equal(promptAnswer('再返工一轮:回到 S5'), 'S5')
  assert.equal(promptAnswer(`好的，${L5}`), null)
  assert.equal(promptAnswer(`${L5}\n另外把日志也看一下`), null)
  assert.equal(promptAnswer(`<task-notification>\n<summary>${L5}</summary>\n</task-notification>`), null)
  assert.equal(promptAnswer(42), null)
})

// ============================================================================ 逐条判需不需要

const H = (...ids) => ids.map((stage) => ({ stage, at: 'x' }))
const FOUR = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5', 'S6', 'S5', 'S6', 'S5', 'S6')
const STATE = { stage: 'S6', history: FOUR }

test('planApprovals：需要的记下 covers；同一次第二条判成不需要（前一条已经盖住）', () => {
  assert.deepEqual(planApprovals({ items: [{ stage: 'S5' }, { stage: 'S5' }], state: STATE, stages: STAGES, grants: [] }), [
    { stage: 'S5', covers: ['S5', 'S6'] },
    { stage: 'S5', why: 'not-needed' },
  ])
})

test('planApprovals：上限内、不是回退、段不在链上 → 各给原因；带原因的候选原样带过去', () => {
  const inBudget = { stage: 'S6', history: H('S1', 'S2', 'S3', 'S4', 'S5', 'S6') }
  assert.deepEqual(planApprovals({ items: [{ stage: 'S5' }], state: inBudget, stages: STAGES, grants: [] }), [{ stage: 'S5', why: 'not-needed' }])
  assert.deepEqual(planApprovals({ items: [{ stage: 'S7' }], state: STATE, stages: STAGES, grants: [] }), [{ stage: 'S7', why: 'not-needed' }])
  assert.deepEqual(planApprovals({ items: [{ stage: 'S9' }], state: STATE, stages: STAGES, grants: [] }), [{ stage: 'S9', why: 'off-chain' }])
  assert.deepEqual(planApprovals({ items: [{ why: 'multi' }], state: STATE, stages: STAGES, grants: [] }), [{ why: 'multi' }])
})

test('planApprovals：已有批准盖住时不需要', () => {
  const grants = [{ reworkTo: 'S5', covers: ['S5', 'S6'] }]
  assert.deepEqual(planApprovals({ items: [{ stage: 'S5' }], state: STATE, stages: STAGES, grants }), [{ stage: 'S5', why: 'not-needed' }])
})

test('approvalLine：一行 JSON，带 at、source、rework_to、covers', () => {
  const v = JSON.parse(approvalLine({ at: '2026-10-01T00:00:00.000Z', source: 'ask', stage: 'S5', covers: ['S5', 'S6'] }))
  assert.deepEqual(v, { at: '2026-10-01T00:00:00.000Z', source: 'ask', rework_to: 'S5', covers: ['S5', 'S6'] })
  assert.ok(!approvalLine({ at: 't', source: 'prompt', stage: 'S5', covers: ['S5'] }).includes('\n'))
})

// ============================================================================ 回传

test('approvalNotices：记下了 → 说记下了哪一段、覆盖哪几段、这一趟共几条，下一步写回退', () => {
  const s = approvalNotices({ results: [{ stage: 'S5', covers: ['S5', 'S6'] }], total: 1 }).join('\n')
  assert.match(s, /^【门禁】已记下返工批准：回到 S5（覆盖 S5、S6；这一趟共 1 条）/)
  assert.match(s, /escalation/)
})

test('approvalNotices：没记下 → 每种原因各有一句，并说怎么重问', () => {
  const cases = {
    afk: /离开/,
    'follow-up': /追问/,
    response: /另写了一段话/,
    multi: /多选/,
    array: /多选/,
    malformed: /认不出/,
    'off-chain': /不在阶段链上/,
    'not-needed': /不需要/,
    'no-run': /没有进行中的 run/,
    unreadable: /读不到/,
    'write-failed': /写不进/,
  }
  for (const [why, re] of Object.entries(cases)) {
    const s = approvalNotices({ results: [{ stage: 'S5', why }], total: 0, cause: 'state' }).join('\n')
    assert.match(s, /^【门禁】这次的回答没有记成返工批准/, why)
    assert.match(s, re, why)
  }
  const form = approvalNotices({ results: [{ why: 'multi' }], total: 0 }).join('\n')
  assert.match(form, /multiSelect 设 false/)
})

test('approvalNotices：读不到运行状态时带上按原因的修法', () => {
  const s = approvalNotices({ results: [{ stage: 'S5', why: 'unreadable' }], total: 0, cause: 'pointer' }).join('\n')
  assert.match(s, /current-run/)
})

test('approvalNotices：段名只在是链上的段时原样出现，别的不回显', () => {
  const s = approvalNotices({ results: [{ stage: 'S9', why: 'off-chain' }], total: 0 }).join('\n')
  assert.match(s, /"S9"/)
})

// ============================================================================ 复核（docs/34 §3）

// prose-1、prose-4：记下批准之后的下一步。不是每一次都有一次被拒的回退在等着（【阶段】、【返工预算】叫 PM 问的那两条路上没有）；
// 照「原样重写那次被拒的写入」做还会把刚记的 escalation 与新的 contract_sha 一起覆盖掉。
test('复核 approvalNotices：记下了之后，被拒的那次写入要补进 escalation 与新的 contract_sha 再写；没有被拒的写入就照常往下走', () => {
  const s = approvalNotices({ results: [{ stage: 'S5', covers: ['S5'] }], total: 1 }).join('\n')
  assert.match(s, /补进这条 escalation 与新的 contract_sha/)
  assert.match(s, /没有被拒的写入/)
  assert.match(s, /不要为它再记一次回退/)
  assert.doesNotMatch(s, /原样重写/)
})

// platform-7：用户选了标签，又在选项旁的备注里写了保留意见——模型看得到备注，门禁不能比模型看到的更宽。
test('复核 askAnswers：批准那道题带非空备注（annotations[题].notes）→ 整次不记，原因是 notes；空白备注照记', () => {
  const tr = (notes) => ({ questions: [Q('q')], answers: { q: L5 }, annotations: { q: { notes } } })
  assert.equal(askAnswers(tr('先别动，我再想想')).excluded, 'notes')
  assert.deepEqual(askAnswers(tr('  ')).items, [{ stage: 'S5' }])
  assert.deepEqual(askAnswers({ questions: [Q('q')], answers: { q: L5 }, annotations: { other: { notes: 'x' } } }).items, [{ stage: 'S5' }])
  const s = approvalNotices({ results: [{ why: 'notes' }], total: 0 }).join('\n')
  assert.match(s, /备注/)
})

// platform-6：写不进批准记录时，「单独发一条消息再试」写的是同一个文件，同样会失败——而那一路一个字都回传不了。
test('复核 approvalNotices：写不进批准记录时，叫用户检查那个文件，不把「单独发一条」当绕开的办法', () => {
  const s = approvalNotices({ results: [{ stage: 'S5', why: 'write-failed' }], total: 0 }).join('\n')
  assert.match(s, /approvals\.jsonl/)
  assert.match(s, /检查/)
  assert.doesNotMatch(s, /单独发一条/)
})

// ============================================================================ M4k：照现状交付的批准（docs/46）

const NL = String.fromCharCode(10)
const D = '照现状交付'
const QD = (question, multiSelect = false) => ({ question, header: 'h', multiSelect, options: [{ label: D, description: '' }, { label: '回退重做', description: '' }] })
const respD = (answers, extra = {}) => ({ questions: Object.keys(answers).map((q) => QD(q)), answers, ...extra })

test('M4k askAnswers：单选题选了「照现状交付」（含推荐后缀）→ 候选；多选、数组、夹了别的话 → 不记，各给原因', () => {
  assert.deepEqual(askAnswers(respD({ q: D })), { excluded: null, items: [{ deliver: true }] })
  assert.deepEqual(askAnswers(respD({ q: `${D} (Recommended)` })).items, [{ deliver: true }])
  assert.deepEqual(askAnswers({ questions: [QD('q', true)], answers: { q: D } }).items, [{ deliver: true, why: 'multi' }])
  assert.deepEqual(askAnswers(respD({ q: [D] })).items, [{ deliver: true, why: 'array' }])
  assert.deepEqual(askAnswers(respD({ q: `${D}吧` })).items, [{ deliver: true, why: 'malformed' }])
  assert.deepEqual(askAnswers(respD({ q: '回退重做' })), { excluded: null, items: [] })
})

test('M4k askAnswers：带 afkTimeoutMs、追问、另写了话、备注 → 整次不记，标明是照现状交付那一种；返工批准被排除时形状照旧', () => {
  assert.deepEqual(askAnswers(respD({ q: D }, { afkTimeoutMs: 60000 })), { excluded: 'afk', items: [], deliver: true })
  assert.equal(askAnswers(respD({ q: D }, { followUp: true })).excluded, 'follow-up')
  assert.equal(askAnswers(respD({ q: D }, { response: '再想想' })).excluded, 'response')
  assert.equal(askAnswers({ questions: [QD('q')], answers: { q: D }, annotations: { q: { notes: '先别' } } }).excluded, 'notes')
  assert.deepEqual(askAnswers(resp({ q: L5 }, { afkTimeoutMs: 60000 })), { excluded: 'afk', items: [] })
})

test('M4k promptDeliver：整条 prompt 规范化之后等于「照现状交付」才算', () => {
  assert.equal(promptDeliver(D), true)
  assert.equal(promptDeliver(`  ${D}` + NL), true)
  assert.equal(promptDeliver(`好的，${D}`), false)
  assert.equal(promptDeliver('<task-notification>' + NL + `<summary>${D}</summary>` + NL + '</task-notification>'), false)
  assert.equal(promptDeliver(42), false)
})

const ACC = (over = {}) => ({ name: '07-acceptance.md', exists: true, blank: false, sha: 'sha256:' + 'a'.repeat(64), verdict: 'fail', ...over })
const AT_S8 = { stage: 'S8', history: H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'), closed_at: null }

test('M4k planApprovals：照现状交付——验收结论没过（不通过、判不了、读不出）就记，带产物名与 sha；已收口、没有结论、还是上一轮的、通过的不记，各给原因', () => {
  const p = (state, acceptance) => planApprovals({ items: [{ deliver: true }], state, stages: STAGES, grants: [], acceptance })
  const rec = [{ deliver: true, name: '07-acceptance.md', sha: ACC().sha }]
  assert.deepEqual(p(AT_S8, ACC()), rec)
  assert.deepEqual(p(AT_S8, ACC({ verdict: 'unknown' })), rec)
  assert.deepEqual(p(AT_S8, ACC({ verdict: null })), rec)
  assert.deepEqual(p({ ...AT_S8, closed_at: '2026-10-06T12:00:00Z' }, ACC()), [{ deliver: true, why: 'closed' }])
  assert.deepEqual(p(AT_S8, null), [{ deliver: true, why: 'no-acceptance' }])
  assert.deepEqual(p(AT_S8, ACC({ exists: false, sha: null })), [{ deliver: true, why: 'no-acceptance' }])
  assert.deepEqual(p(AT_S8, ACC({ blank: true })), [{ deliver: true, why: 'no-acceptance' }])
  assert.deepEqual(p({ ...AT_S8, rework_base: { '07-acceptance.md': ACC().sha } }, ACC()), [{ deliver: true, why: 'stale-acceptance' }])
  assert.deepEqual(p(AT_S8, ACC({ verdict: 'pass' })), [{ deliver: true, why: 'deliver-not-needed' }])
  // 评审 F3：验收结论对着上一版契约（契约基线记着）——不记，先重出；排在「通过」之前（对着上一版契约的通过同样不算数）。
  assert.deepEqual(p(AT_S8, ACC({ outdated: true })), [{ deliver: true, why: 'outdated-acceptance' }])
  assert.deepEqual(p(AT_S8, ACC({ outdated: true, verdict: 'pass' })), [{ deliver: true, why: 'outdated-acceptance' }])
  assert.deepEqual(planApprovals({ items: [{ deliver: true, why: 'multi' }], state: AT_S8, stages: STAGES, grants: [], acceptance: ACC() }), [{ deliver: true, why: 'multi' }])
  // 返工批准与照现状交付混在一次里：各判各的。
  assert.deepEqual(planApprovals({ items: [{ stage: 'S9' }, { deliver: true }], state: AT_S8, stages: STAGES, grants: [], acceptance: ACC() }), [{ stage: 'S9', why: 'off-chain' }, ...rec])
})

test('M4k approvalNotices：照现状交付记下了——只对现在这份验收结论有效、修订块标题带标记；没记下的各给原因，重问说的是照现状交付的标签', () => {
  const s = approvalNotices({ results: [{ deliver: true, name: '07-acceptance.md', sha: ACC().sha }], total: 1 }).join(NL)
  assert.match(s, /^【门禁】已记下照现状交付的批准/)
  assert.match(s, /只对现在这份 07-acceptance\.md 有效/)
  assert.match(s, /一条批准只盖一次修订/)
  assert.doesNotMatch(s, /· 照现状交付/)
  const cases = { closed: /已经收口/, 'no-acceptance': /还没有验收结论/, 'stale-acceptance': /上一轮/, 'outdated-acceptance': /对着上一版契约/, 'deliver-not-needed': /结论：通过/, malformed: /认不出/, multi: /多选/, array: /多选/, afk: /离开/, 'follow-up': /追问/, response: /另写了一段话/, notes: /备注/, 'no-run': /没有进行中的 run/, unreadable: /读不到/, 'write-failed': /写不进/ }
  for (const [why, re] of Object.entries(cases)) {
    const t = approvalNotices({ results: [{ deliver: true, why }], total: 0, cause: 'state' }).join(NL)
    assert.match(t, /^【门禁】这次的回答没有记成照现状交付的批准/, why)
    assert.match(t, re, why)
  }
  const again = approvalNotices({ results: [{ deliver: true, why: 'malformed' }], total: 0 }).join(NL)
  assert.match(again, /「照现状交付」/)
  assert.doesNotMatch(again, /再返工一轮/)
})
