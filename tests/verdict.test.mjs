// M4k（docs/46，docs/35 §5 与 docs/39 §3「收口不读验收结论」）：验收结论的固定首行、验收那一段与它的产物、「照现状交付」的规范标签——
// 纯函数。H6 的判据（decideAcceptance）与记录器在别的判据文件里。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACCEPTANCE_ROLE, DELIVER_KIND, DELIVER_LABEL, VERDICT_LINES, acceptanceOf, acceptanceVerdict, decideAcceptance, deliverIntent, deliverLine, readDeliverApprovalEntries, readDeliverApprovals } from '../hooks/lib/verdict.mjs'
import { readGrants } from '../hooks/lib/budget.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const NL = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + NL
const BOM = String.fromCharCode(0xfeff)
const buf = (s) => Buffer.from(s, 'utf8')
const v = (s) => acceptanceVerdict(buf(s))

test('M4k：验收结论首行——三种结论；BOM、CRLF、首行之前的空行；字符串照读', () => {
  assert.deepEqual(VERDICT_LINES, ['结论：通过', '结论：不通过', '结论：判不了'])
  assert.equal(v('结论：通过' + NL + NL + '- 第 1 条：过'), 'pass')
  assert.equal(v('结论：不通过' + NL), 'fail')
  assert.equal(v('结论：判不了'), 'unknown')
  assert.equal(v(BOM + '结论：通过' + CRLF + '- 第 1 条：过' + CRLF), 'pass')
  assert.equal(v(NL + '   ' + NL + '结论：不通过' + NL), 'fail')
  assert.equal(acceptanceVerdict('结论：判不了' + NL), 'unknown')
})

test('M4k：首行容许的包装——Markdown 装饰、「验收结论」、强调、半角冒号与空白、句末标点、引号括号', () => {
  const ok = ['# 结论：通过', '## 验收结论：通过', '**结论**：通过', '**结论：通过**', '> 结论: 通过', '- 结论：通过。', '结论 ： 通过', '结论：**通过**', '`结论：通过`', '结论：通过！', '「结论：通过」', '【结论：通过】', '结论：通过 ']
  for (const s of ok) assert.equal(v(s + NL), 'pass', s)
  assert.equal(v('**验收结论：不通过**' + NL), 'fail')
  assert.equal(v('### 结论：判不了' + NL), 'unknown')
  // 评审 F9：「不通过」「判不了」按前缀认（夹了别的话拦的效果一样），「通过」保持严格。
  assert.equal(v('结论：不通过（第 2、3 条没过）' + NL), 'fail')
  assert.equal(v('**结论：不通过**，见下' + NL), 'fail')
  assert.equal(v('结论：判不了：测试跑不起来' + NL), 'unknown')
})

test('M4k：首行认不出就是 null——夹了别的话、结论不在第一行、标题行、逐条的写法、空文件、只有空白、不是文字', () => {
  const bad = [
    '结论：通过（第 3 条判不了）',
    '结论：基本通过',
    '结论：通过，但有两条判不了',
    '# 验收报告' + NL + '结论：通过',
    '本轮结论：通过',
    '结论：过',
    '结论：不过',
    '通过',
    '结论通过',
    '- 第 1 条：结论：不通过',
    '',
  ]
  for (const s of bad) assert.equal(v(s), null, JSON.stringify(s))
  assert.equal(v(BOM + NL + '  ' + NL), null)
  assert.equal(acceptanceVerdict(null), null)
  assert.equal(acceptanceVerdict(undefined), null)
  assert.equal(acceptanceVerdict(42), null)
})

test('M4k：acceptanceOf——产者里有 at-acceptance 的验证段与它的产物；阶段链读不出、没有这一段、不是验证段回 null', () => {
  assert.equal(ACCEPTANCE_ROLE, 'at-acceptance')
  assert.deepEqual(acceptanceOf(STAGES), { stageId: 'S7', name: '07-acceptance.md' })
  assert.equal(acceptanceOf(null), null)
  assert.equal(acceptanceOf({ S1: STAGES.S1, S8: STAGES.S8 }), null)
  assert.equal(acceptanceOf({ S1: STAGES.S1, X: { role: 'at-acceptance', requires: [], produces: ['x.md'] } }), null)
})

test('M4k：照现状交付的规范标签——归一化之后整条等于它（带推荐后缀照认）；夹了别的话算认不出；不相干的回 null', () => {
  assert.equal(DELIVER_LABEL, '照现状交付')
  for (const s of ['照现状交付', ' 照现状交付 ', '照现状交付 (Recommended)', '照现状交付(推荐)', '照 现状 交付', '照现状交付（推荐）']) {
    assert.deepEqual(deliverIntent(s), { deliver: true }, s)
  }
  for (const s of ['照现状交付吧', '不要照现状交付', '照现状交付（不推荐）', '照现状交付：先别']) {
    assert.deepEqual(deliverIntent(s), { malformed: true }, s)
  }
  for (const s of ['停在这里', '再返工一轮：回到 S5', '', null, 42]) assert.equal(deliverIntent(s), null, String(s))
})

// ============================================================================ H6：收口时读验收结论（decideAcceptance）

const sha = (s) => sha256OfContract(buf(s))
const CHAIN = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-06T10:00:00Z' }))
const AT_S8 = { stage: 'S8', history: H(...CHAIN), roster: ['at-qa', 'at-acceptance'], stage_roles: { S6: ['at-qa'], S7: ['at-acceptance'] }, closed_at: null }
const closing = (state = AT_S8) => ({ before: state, after: { ...state, never_invoked: [], closed_at: '2026-10-06T12:00:00Z' } })
const disk = (acc) => (name) => (name === '07-acceptance.md' ? (acc === null ? null : buf(acc)) : buf('x' + NL))

test('M4k H6：收口时验收结论首行不是「结论：通过」——拒，按首行给三种理由，都附照现状交付的出路；是通过放行', () => {
  const { before, after } = closing()
  const d = (acc) => decideAcceptance({ before, after, stages: STAGES, bytesOf: disk(acc), approvedShas: [] })
  assert.deepEqual(d('结论：通过' + NL), { ok: true })
  const fail = d('结论：不通过' + NL + '- 第 2 条：没过' + NL)
  assert.equal(fail.ok, false)
  assert.ok(fail.reason.includes('「结论：不通过」') && fail.reason.includes('验收没过不收口') && fail.reason.includes('「回退」'), fail.reason)
  const unknown = d('结论：判不了' + NL)
  assert.ok(!unknown.ok && unknown.reason.includes('「结论：判不了」') && unknown.reason.includes('env-blocked'), unknown.reason)
  const none = d('# 验收报告' + NL + NL + '结论：通过' + NL)
  assert.ok(!none.ok && none.reason.includes('读不出') && none.reason.includes('回到 S7'), none.reason)
  for (const r of [fail, unknown, none]) assert.ok(r.reason.includes('「照现状交付」') && r.reason.includes('07-acceptance.md'), r.reason)
})

test('M4k H6：门禁记下的照现状交付批准——sha 等于验收结论现在的 sha 才放行；结论改过一个字就不算', () => {
  const { before, after } = closing()
  const acc = '结论：不通过' + NL + '- 第 2 条：没过' + NL
  const d = (text, approvedShas) => decideAcceptance({ before, after, stages: STAGES, bytesOf: disk(text), approvedShas })
  assert.deepEqual(d(acc, [sha(acc)]), { ok: true })
  assert.equal(d(acc + '- 补一句' + NL, [sha(acc)]).ok, false)
  assert.equal(d(acc, ['sha256:' + '0'.repeat(64)]).ok, false)
})

test('M4k：照现状交付的批准记录——一行 JSON（kind、产物名、sha）；只读那份产物的、sha 合法的；返工批准的行与坏行不算；readGrants 不把它算进返工上限', () => {
  const S = 'sha256:' + 'b'.repeat(64)
  const line = deliverLine({ at: '2026-10-06T12:00:00.000Z', source: 'ask', product: '07-acceptance.md', sha: S })
  assert.deepEqual(JSON.parse(line), { at: '2026-10-06T12:00:00.000Z', source: 'ask', kind: DELIVER_KIND, product: '07-acceptance.md', sha: S })
  assert.ok(!line.includes(NL))
  const rework = JSON.stringify({ at: 't', source: 'ask', rework_to: 'S5', covers: ['S5'] })
  const text = [rework, line, '{bad', JSON.stringify({ kind: DELIVER_KIND, product: 'x.md', sha: S }), JSON.stringify({ kind: DELIVER_KIND, product: '07-acceptance.md', sha: 'nope' })].join(CRLF) + CRLF
  assert.deepEqual(readDeliverApprovals(text, '07-acceptance.md'), [S])
  assert.deepEqual(readDeliverApprovals(BOM + line, '07-acceptance.md'), [S])
  assert.deepEqual(readDeliverApprovals(null, '07-acceptance.md'), [])
  assert.deepEqual(readGrants(text, STAGES), [{ reworkTo: 'S5', covers: ['S5'] }])
})

// ============================================================================ 评审修订（F6–F9、F11）

test('M4k 评审 F6、F7：判不了的出路有 contract-hole；照现状交付的出路按首行分情形、写明记哪一类 kind', () => {
  const { before, after } = closing()
  const fail = decideAcceptance({ before, after, stages: STAGES, bytesOf: disk('结论：不通过' + NL), approvedShas: [] }).reason
  assert.ok(fail.includes('budget-exhausted') && fail.includes('contract-conflict') && fail.includes('「照现状交付」'), fail)
  const unknown = decideAcceptance({ before, after, stages: STAGES, bytesOf: disk('结论：判不了' + NL), approvedShas: [] }).reason
  assert.ok(unknown.includes('contract-hole') && unknown.includes('env-blocked') && unknown.includes('「照现状交付」'), unknown)
})

test('M4k 评审 F8、F9：首行读不出——还在验收那一段：只给同段重派，不附照现状交付；收口时：回退到验收那一段（写明代价）或者问用户照现状交付', () => {
  const s7 = { ...AT_S8, stage: 'S7', history: H(...CHAIN.slice(0, 7)) }
  const adv = decideAcceptance({ before: s7, after: { ...s7, stage: 'S8', history: [...s7.history, ...H('S8')] }, stages: STAGES, bytesOf: disk('# 验收报告' + NL), approvedShas: [] })
  assert.equal(adv.ok, false)
  assert.ok(adv.reason.includes('在 S7 里同段重派 at-acceptance') && !adv.reason.includes('照现状交付'), adv.reason)
  const { before, after } = closing()
  const close = decideAcceptance({ before, after, stages: STAGES, bytesOf: disk('# 验收报告' + NL), approvedShas: [] }).reason
  assert.ok(close.includes('回到 S7（S7、S8 各记一轮返工）') && close.includes('「照现状交付」'), close)
})

test('M4k 评审 F11：写入前的 state.json 读不出、写入后收口——照收口判（与 decideClosing 同一个口径）', () => {
  const { after } = closing()
  const d = decideAcceptance({ before: null, after, stages: STAGES, bytesOf: disk('结论：不通过' + NL), approvedShas: [] })
  assert.equal(d.ok, false)
  assert.ok(d.reason.includes('验收没过不收口'), d.reason)
  assert.deepEqual(decideAcceptance({ before: null, after: { ...AT_S8 }, stages: STAGES, bytesOf: disk('结论：不通过' + NL), approvedShas: [] }), { ok: true })
})

test('M4k 评审 F1、F2：readDeliverApprovalEntries——带 at 的照现状交付批准（at 不是字符串的给 null）；与 readDeliverApprovals 同一套过滤', () => {
  const S = 'sha256:' + 'c'.repeat(64)
  const a = deliverLine({ at: '2026-10-06T12:00:00.000Z', source: 'prompt', product: '07-acceptance.md', sha: S })
  const b = JSON.stringify({ at: 7, kind: DELIVER_KIND, product: '07-acceptance.md', sha: S })
  const other = deliverLine({ at: 't', source: 'ask', product: 'x.md', sha: S })
  assert.deepEqual(readDeliverApprovalEntries([a, b, other, '{bad'].join(NL), '07-acceptance.md'), [
    { at: '2026-10-06T12:00:00.000Z', sha: S },
    { at: null, sha: S },
  ])
  assert.deepEqual(readDeliverApprovalEntries(null, '07-acceptance.md'), [])
})

test('M4k H6：不判的写入——回退、推进进验收那一段、原地补记、已收口之后补记；跳过的结论——还是上一轮的、验收那一段整段裁掉谁都没叫过的', () => {
  const acc = disk('结论：不通过' + NL)
  const d = (before, after, bytesOf = acc) => decideAcceptance({ before, after, stages: STAGES, bytesOf, approvedShas: [] })
  const s5 = { ...AT_S8, stage: 'S5', history: [...AT_S8.history, ...H('S5')] }
  assert.deepEqual(d(AT_S8, s5), { ok: true }, '回退')
  const s6 = { ...AT_S8, stage: 'S6', history: H(...CHAIN.slice(0, 6)) }
  assert.deepEqual(d(s6, { ...s6, stage: 'S7', history: [...s6.history, ...H('S7')] }), { ok: true }, '推进进 S7：验收那一段还没走完')
  assert.deepEqual(d(AT_S8, { ...AT_S8, escalations: [] }), { ok: true }, '原地补记')
  const closed = { ...AT_S8, closed_at: '2026-10-06T12:00:00Z' }
  assert.deepEqual(d(closed, { ...closed, never_invoked: ['at-ui'] }), { ok: true }, '已收口之后补记')
  const { before, after } = closing()
  const stale = { ...after, rework_base: { '07-acceptance.md': sha('结论：不通过' + NL) } }
  assert.deepEqual(d(before, stale), { ok: true }, '还是上一轮的：交给别的判据')
  const trimmedBefore = { ...AT_S8, roster: ['at-qa'], stage_roles: { S6: ['at-qa'], S7: [] }, trimmed: { 'at-acceptance': 'S7' } }
  assert.deepEqual(d(trimmedBefore, { ...trimmedBefore, closed_at: '2026-10-06T12:00:00Z' }), { ok: true }, '整段裁掉、谁都没叫过')
  assert.deepEqual(d(before, after, disk(null)), { ok: true }, '不在：交给别的判据')
  assert.deepEqual(d(before, after, disk('  ' + NL)), { ok: true }, '空白：交给别的判据')
})

test('M4k H6（变异补）：验收段之后还有两段的链上，从后一段回退到前一段——回退不判（只有推进与收口判）', () => {
  const LONG = { ...STAGES, S9: { role: 'at-pm', requires: [], produces: ['09-extra.md'] } }
  const s9 = { ...AT_S8, stage: 'S9', history: H(...CHAIN, 'S9') }
  const back = { ...s9, stage: 'S8', history: [...s9.history, ...H('S8')] }
  assert.deepEqual(decideAcceptance({ before: s9, after: back, stages: LONG, bytesOf: disk('结论：不通过' + String.fromCharCode(10)), approvedShas: [] }), { ok: true })
  const fwd = { ...AT_S8, stage: 'S9', history: H(...CHAIN, 'S9') }
  assert.equal(decideAcceptance({ before: AT_S8, after: fwd, stages: LONG, bytesOf: disk('结论：不通过' + String.fromCharCode(10)), approvedShas: [] }).ok, false, '推进照判')
})
