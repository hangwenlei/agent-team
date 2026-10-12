// M4d（docs/38，全量审查第 17 条，推进判据）：H6 在推进那一次写入里核离开的那一段交齐了没有、一次只推进一段。纯函数在 hooks/lib/advance.mjs，
// 接线在 hooks/lib/rework-guard.mjs 的 decideAdvance / decideReworkBase。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideSingleStep, departureNeeds, departureBlockers, departureLines, mayWaive, wholeStageTrimmed } from '../hooks/lib/advance.mjs'
import { closeBlockers } from '../hooks/lib/closing.mjs'
import { decideReworkBase } from '../hooks/lib/rework-guard.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-05T00:00:00Z' }))
const st = (stage, extra = {}) => ({ stage, history: H(stage), rework: {}, ...extra })
const names = (r) => r.needs.map((n) => n.name)
const sha = (t) => sha256OfContract(Buffer.from(t, 'utf8'))
const disk = (files) => (name) => (Object.hasOwn(files, name) ? { exists: true, sha: sha(files[name]), blank: files[name].trim() === '' } : { exists: false, sha: null })

// ---------------------------------------------------------------- 一次只推进一段

test('一次只推进一段：S2→S3 放行；S2→S8、S5→S7 拒；回退、原地、写入前后不在链上不管', () => {
  assert.equal(decideSingleStep({ before: st('S2'), after: st('S3'), stages: STAGES }).ok, true)
  const jump = decideSingleStep({ before: st('S2'), after: st('S8'), stages: STAGES })
  assert.equal(jump.ok, false)
  assert.match(jump.reason, /一次只推进一段/)
  assert.match(jump.reason, /跨过了 S3、S4、S5、S6、S7/)
  assert.equal(decideSingleStep({ before: st('S5'), after: st('S7'), stages: STAGES }).ok, false)
  for (const [a, b] of [['S6', 'S5'], ['S5', 'S5'], ['DONE', 'S8'], ['S8', 'DONE']]) {
    assert.equal(decideSingleStep({ before: st(a), after: st(b), stages: STAGES }).ok, true, `${a}→${b}`)
  }
})

// ---------------------------------------------------------------- 离开一段要求在的产物

test('产物固定的段：不论叫没叫谁都要；PM 自己的段裁不掉', () => {
  assert.deepEqual(names(departureNeeds({ stages: STAGES, sid: 'S1', state: st('S2') })), ['00-contract.md'])
  assert.deepEqual(names(departureNeeds({ stages: STAGES, sid: 'S3', state: st('S4', { stage_roles: {} }) })), ['03-arch.md', '03-alignment.md'])
  const pm = departureNeeds({ stages: STAGES, sid: 'S4', state: st('S5', { trimmed: { 'at-pm': 'S4' } }) })
  assert.deepEqual(names(pm), ['04-dispatch.md'])
})

test('产物固定的段整段裁掉（在 trimmed、值是这一段、这一段一个都没叫过）→ 不要求；叫过的不免', () => {
  const never = departureNeeds({ stages: STAGES, sid: 'S6', state: st('S7', { stage_roles: {}, trimmed: { 'at-qa': 'S6' } }) })
  assert.deepEqual(names(never), [])
  assert.deepEqual(never.excused.map((e) => e.name), ['06-test.md'])
  const called = departureNeeds({ stages: STAGES, sid: 'S6', state: st('S7', { stage_roles: { S6: ['at-qa'] }, trimmed: { 'at-qa': 'S6' } }) })
  assert.deepEqual(names(called), ['06-test.md'])
  const arch = departureNeeds({ stages: STAGES, sid: 'S3', state: st('S4', { stage_roles: { S3: ['at-architect'] }, trimmed: { 'at-architect': 'S3' } }) })
  assert.deepEqual(names(arch), ['03-arch.md', '03-alignment.md'])
  // 值不是这一段的不算裁掉。
  const other = departureNeeds({ stages: STAGES, sid: 'S6', state: st('S7', { stage_roles: {}, trimmed: { 'at-qa': 'S7' } }) })
  assert.deepEqual(names(other), ['06-test.md'])
})

test('随参与者展开的段：这一段叫到的产者各自那几份；没叫的不要', () => {
  const s2 = departureNeeds({ stages: STAGES, sid: 'S2', state: st('S3', { stage_roles: { S2: ['at-product', 'at-ui'] } }) })
  assert.deepEqual(names(s2), ['01-prd.md', '02-ui-spec.md', '02-wireframe.html'])
  const s5 = departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { stage_roles: { S5: ['at-architect', 'at-backend'] } }) })
  assert.deepEqual(names(s5), ['05-impl/at-backend.md'])
})

test('叫到之后又裁掉：不在任何前置里的、非验证段的才免（02-*、05-impl/*）；01-prd.md 是 S3 的前置，不免', () => {
  const s2 = departureNeeds({ stages: STAGES, sid: 'S2', state: st('S3', { stage_roles: { S2: ['at-product', 'at-ui'] }, trimmed: { 'at-ui': 'S2', 'at-product': 'S2' } }) })
  assert.deepEqual(names(s2), ['01-prd.md'])
  assert.deepEqual(s2.excused.map((e) => e.name), ['02-ui-spec.md', '02-wireframe.html'])
  const s5 = departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { stage_roles: { S5: ['at-backend', 'at-frontend'] }, trimmed: { 'at-frontend': 'S5' } }) })
  assert.deepEqual(names(s5), ['05-impl/at-backend.md'])
  assert.equal(mayWaive(STAGES, 'S2', '01-prd.md'), false)
  assert.equal(mayWaive(STAGES, 'S6', '06-test.md'), false)
  assert.equal(mayWaive(STAGES, 'S5', '05-impl/at-ui.md'), true)
})

// docs/89（docs/77 §4、docs/81 §4「stage_roles 记成 []、推进照旧放行」）：随参与者展开的段，原来只要叫到的人那几份——S2 记成 []、谁都没裁，01-prd.md 不在也
// 放行推进，到 S3 派人时 H2 才按前置拒。现在没叫过、也没裁掉的产者，它的产物是后面某段的前置的，照样要（出路是派它、或者把它写进 trimmed）；不是前置的
// （02-*、05-impl/*）照旧不要。
test('docs/89：随参与者展开的段，没叫过也没裁掉的产者——它的产物是后面某段的前置时照样要；不是前置的不要；裁掉了的不要', () => {
  const empty = departureNeeds({ stages: STAGES, sid: 'S2', state: st('S3', { stage_roles: { S2: [] } }) })
  assert.deepEqual(empty.needs.map((n) => [n.name, n.role, n.called]), [['01-prd.md', 'at-product', false]])
  const uiOnly = departureNeeds({ stages: STAGES, sid: 'S2', state: st('S3', { stage_roles: { S2: ['at-ui'] } }) })
  assert.deepEqual(names(uiOnly).sort(), ['01-prd.md', '02-ui-spec.md', '02-wireframe.html'])
  const cut = departureNeeds({ stages: STAGES, sid: 'S2', state: st('S3', { stage_roles: { S2: [] }, trimmed: { 'at-product': 'S2' } }) })
  assert.deepEqual(names(cut), [])
  // 记在别的段的 trimmed 不算这一段裁掉。
  const elsewhere = departureNeeds({ stages: STAGES, sid: 'S2', state: st('S3', { stage_roles: { S2: [] }, trimmed: { 'at-product': 'S5' } }) })
  assert.deepEqual(names(elsewhere), ['01-prd.md'])
  // 05-impl/* 不是前置：S5 记成 [] 照旧不要。
  assert.deepEqual(names(departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { stage_roles: { S5: [] } }) })), [])
  // 复核（docs/89 §8，低 5）：没有 stage_roles 的旧 run 同样——按整趟 roster 认叫到，roster 里没有 at-product、也没裁，照样要。
  assert.deepEqual(names(departureNeeds({ stages: STAGES, sid: 'S2', state: { stage: 'S3', history: H('S2', 'S3'), roster: ['at-ui'] } })).sort(), ['01-prd.md', '02-ui-spec.md', '02-wireframe.html'])
  assert.deepEqual(names(departureNeeds({ stages: STAGES, sid: 'S2', state: { stage: 'S3', history: H('S2', 'S3'), roster: ['at-product'] } })), ['01-prd.md'])
  // H6 接线：S2 记成 []、01-prd.md 不在 → 拒；在了 → 放行。复核（docs/89 §8，中 1）：只把 at-product 写进 trimmed，S3 派人时 H2 照前置拒（S2 不算整段
  // 裁掉）——给的出路要接得上下一道门禁：一个产者都没叫的，派它、或者整段裁掉 S2（这一段的产者都写进 trimmed）；叫过别的产者的，只有派它。括号里只列
  // 要派人的段（S4 是项目经理自己的段，不列）。
  const at2 = { stage: 'S2', history: H('S1', 'S2'), rework: {}, roster: [], stage_roles: { S2: [] } }
  const to3 = { ...at2, stage: 'S3', history: [...at2.history, ...H('S3')] }
  const r = decideReworkBase({ before: at2, after: to3, stages: STAGES, diskSha: disk({ '00-contract.md': 'c' }) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /01-prd\.md 缺：S2 这一趟还没叫过 at-product——派它；这一趟整段不做 S2：同一次 Write 把 \{"at-product": "S2", "at-ui": "S2"\} 写进 trimmed，整段裁掉/)
  assert.match(r.reason, /（S3、S7 要它当前置：那几段要派的人就派不出去，只能跟着整段裁掉/)
  assert.ok(!r.reason.includes('{"at-product": "S2"} 写进 trimmed'), r.reason)
  assert.ok(r.reason.includes('没叫过、也没裁掉的产者被后面某段当前置的那几份'), r.reason)
  // 叫过 at-ui 的：只有派它，说清只裁掉它走不下去。
  const ui2 = { ...at2, stage_roles: { S2: ['at-ui'] }, roster: ['at-ui'] }
  const ui3 = { ...ui2, stage: 'S3', history: [...ui2.history, ...H('S3')] }
  const u = decideReworkBase({ before: ui2, after: ui3, stages: STAGES, diskSha: disk({ '00-contract.md': 'c', '02-ui-spec.md': 'u', '02-wireframe.html': 'w' }) })
  assert.equal(u.ok, false)
  assert.match(u.reason, /01-prd\.md 缺：S2 这一趟还没叫过 at-product——派它（S3、S7 要它当前置；S2 已经叫过别的产者，只裁掉 at-product 走不下去）/)
  assert.ok(!u.reason.includes('写进 trimmed'), u.reason)
  assert.equal(decideReworkBase({ before: at2, after: to3, stages: STAGES, diskSha: disk({ '00-contract.md': 'c', '01-prd.md': 'p' }) }).ok, true)
})

test('有 stage_roles 却没有离开的那一段（随参与者展开的段）→ keyMissing；产物固定的段不管', () => {
  assert.equal(departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { stage_roles: { S2: ['at-product'] } }) }).keyMissing, true)
  assert.equal(departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { stage_roles: { S5: [] } }) }).keyMissing, false)
  assert.equal(departureNeeds({ stages: STAGES, sid: 'S3', state: st('S4', { stage_roles: {} }) }).keyMissing, false)
  assert.equal(departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { roster: ['at-backend'] }) }).keyMissing, false, '旧 run 不要求')
})

test('参与者：写入前后取并集（同一次写入挪走名字翻不成没叫过）；旧 run 按整趟 roster；旧 run 半路加 stage_roles 照样并（与收口同一口径）', () => {
  const u = departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { stage_roles: { S5: ['at-backend'] } }), prior: st('S5', { stage_roles: { S5: ['at-frontend'] } }) })
  assert.deepEqual(names(u).sort(), ['05-impl/at-backend.md', '05-impl/at-frontend.md'])
  const legacy = departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { roster: ['at-ui', 'at-backend'] }) })
  assert.deepEqual(names(legacy), ['05-impl/at-backend.md', '05-impl/at-ui.md'])
  const mixed = departureNeeds({ stages: STAGES, sid: 'S5', state: st('S6', { roster: ['at-ui', 'at-backend'], stage_roles: { S5: ['at-backend'] } }), prior: st('S5', { roster: ['at-ui'] }) })
  assert.deepEqual(names(mixed), ['05-impl/at-backend.md', '05-impl/at-ui.md'])
})

test('departureBlockers：缺、空文件进阻碍；读不出来的不拦、单列', () => {
  const probe = (n) => ({ '05-impl/at-backend.md': 'ok', '05-impl/at-frontend.md': 'empty', '05-impl/at-ui.md': 'unreadable' })[n] ?? 'missing'
  const r = departureBlockers({ stages: STAGES, sids: ['S5'], state: st('S6', { stage_roles: { S5: ['at-backend', 'at-frontend', 'at-ui', 'at-ios'] } }), probe })
  assert.deepEqual(r.blockers.map((b) => `${b.name}:${b.why}`), ['05-impl/at-frontend.md:empty', '05-impl/at-ios.md:missing'])
  assert.deepEqual(r.unreadable, ['05-impl/at-ui.md'])
})

// ---------------------------------------------------------------- 接线：decideReworkBase

const ROUND = { '00-contract.md': 'c', '01-prd.md': 'p', '03-arch.md': 'a', '03-alignment.md': 'al', '04-dispatch.md': 'd', '05-impl/at-backend.md': 'b' }
const at5 = (extra = {}) => ({ stage: 'S5', history: H('S1', 'S2', 'S3', 'S4', 'S5'), rework: {}, roster: ['at-architect', 'at-backend', 'at-frontend'], stage_roles: { S5: ['at-architect', 'at-backend', 'at-frontend'] }, ...extra })
const to6 = (s, extra = {}) => ({ ...s, stage: 'S6', history: [...s.history, ...H('S6')], ...extra })

test('H6 推进：叫到的 at-frontend 没交 → 拒，点名、给出路；交了、或照出路写 trimmed → 放行', () => {
  const r = decideReworkBase({ before: at5(), after: to6(at5()), stages: STAGES, diskSha: disk(ROUND) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /at-frontend 在 S5 被叫到过：05-impl\/at-frontend\.md 缺/)
  assert.match(r.reason, /还在跑的/)
  assert.match(r.reason, /\{"at-frontend": "S5"\} 写进 trimmed/)
  assert.match(r.reason, /你派不到的（at-ui、S5 的执行角色），经这一段派得到它的那个协调者去派/)
  assert.equal(decideReworkBase({ before: at5(), after: to6(at5()), stages: STAGES, diskSha: disk({ ...ROUND, '05-impl/at-frontend.md': 'f' }) }).ok, true)
  assert.equal(decideReworkBase({ before: at5(), after: to6(at5(), { trimmed: { 'at-frontend': 'S5' } }), stages: STAGES, diskSha: disk(ROUND) }).ok, true)
})

test('H6 推进：空文件（只有空白）算没交，说「是空文件」', () => {
  const r = decideReworkBase({ before: at5(), after: to6(at5()), stages: STAGES, diskSha: disk({ ...ROUND, '05-impl/at-frontend.md': ' \n' }) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /05-impl\/at-frontend\.md 是空文件/)
})

test('H6 推进：标了 "accepted" 的算交了；只有还旧的时文案与第 17 条之前逐字相同', () => {
  const files = { ...ROUND, '05-impl/at-frontend.md': 'f' }
  const base = { '05-impl/at-backend.md': sha('b'), '05-impl/at-frontend.md': sha('f') }
  const before = at5({ history: H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5'), rework_base: base })
  const stale = decideReworkBase({ before, after: to6(before), stages: STAGES, diskSha: disk(files) })
  assert.equal(stale.ok, false)
  assert.match(stale.reason, /^从 "S5" 推进到 "S6"，但离开的段里还有上一轮的产物（磁盘内容与 rework_base 记的 sha 相同）/)
  const acc = to6(before, { rework_base: { '05-impl/at-backend.md': 'accepted', '05-impl/at-frontend.md': 'accepted' } })
  assert.equal(decideReworkBase({ before, after: acc, stages: STAGES, diskSha: disk(files) }).ok, true)
})

test('H6 推进：有 stage_roles 却没记离开的 S5 → 拒，叫它同一次记上', () => {
  const before = at5({ stage_roles: {} })
  const r = decideReworkBase({ before, after: to6(before), stages: STAGES, diskSha: disk(ROUND) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /没有 S5 这一段/)
})

test('H6：回退、原地重来不核缺', () => {
  const s6 = { ...to6(at5()), stage_roles: { S5: ['at-architect', 'at-backend'] } }
  const back = { ...s6, stage: 'S5', history: [...s6.history, ...H('S5')], rework_base: { '05-impl/at-backend.md': sha('b') } }
  assert.equal(decideReworkBase({ before: s6, after: back, stages: STAGES, diskSha: disk(ROUND) }).ok, true)
})

test('H6 接线：非回退的写入一次跨两段 → 拒（decideReworkBase 里调 decideSingleStep）', () => {
  const before = at5()
  const after = { ...before, stage: 'S7', history: [...before.history, ...H('S7')] }
  const r = decideReworkBase({ before, after, stages: STAGES, diskSha: disk({ ...ROUND, '05-impl/at-frontend.md': 'f', '06-test.md': 't' }) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /一次只推进一段/)
})

test('H6 补记：回到 S3 又记到 S5，离开的 S3、S4 逐段核——S3 缺 03-alignment.md 拦', () => {
  const files = { ...ROUND, '05-impl/at-frontend.md': 'f', '06-test.md': 't' }
  delete files['03-alignment.md']
  const before = { ...to6(at5()), stage_roles: { S3: ['at-architect'], S5: ['at-architect', 'at-backend', 'at-frontend'] } }
  const snap = { '03-arch.md': 'accepted', '04-dispatch.md': 'accepted', '05-impl/at-backend.md': sha('b'), '05-impl/at-frontend.md': sha('f'), '06-test.md': sha('t') }
  const after = { ...before, stage: 'S5', history: [...before.history, ...H('S3', 'S4', 'S5')], rework_base: snap }
  const r = decideReworkBase({ before, after, stages: STAGES, diskSha: disk(files) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /03-alignment\.md 缺/)
})

// 前提：免除只看「随参与者展开的段」，而插件自带的链里验证段都是产物固定的段——哪天有验证段改成随参与者展开，mayWaive 的验证段那一条
// 才开始承重，这条会红，提醒去补它的判据。
test('前提：stages.json 里的验证段都是产物固定的段', () => {
  for (const [id, s] of Object.entries(STAGES)) {
    if (s.verifies === true) assert.equal(Array.isArray(s.produces) && s.produces.every((p) => !p.includes('<role>')), true, id)
  }
})

// ---------------------------------------------------------------- 复核修订（docs/38 §3）

test('复核 H6：先推进、再原地重来写在一次里（[S6, S6]、[S6, S7, S8, S8]）→ 往前那一截照推进核：离开的 S5 没交齐、跳段，都拒', () => {
  const before = at5()
  const twice = { ...before, stage: 'S6', history: [...before.history, ...H('S6', 'S6')], rework: { S6: 1 } }
  const r1 = decideReworkBase({ before, after: twice, stages: STAGES, diskSha: disk(ROUND) })
  assert.equal(r1.ok, false)
  assert.match(r1.reason, /先往前记到了 "S6"/)
  assert.match(r1.reason, /at-frontend 在 S5 被叫到过：05-impl\/at-frontend\.md 缺/)
  const far = { ...before, stage: 'S8', history: [...before.history, ...H('S6', 'S7', 'S8', 'S8')], rework: { S8: 1 } }
  const r2 = decideReworkBase({ before, after: far, stages: STAGES, diskSha: disk({ ...ROUND, '05-impl/at-frontend.md': 'f' }) })
  assert.equal(r2.ok, false)
  assert.match(r2.reason, /一次只推进一段/)
})

test('复核 H6：派发记录里在 S5 派出去过、stage_roles 却没记的执行角色 → 照样要它交，理由说它是从派发记录里认出来的', () => {
  const before = at5({ stage_roles: { S5: ['at-architect'] } })
  const files = { ...ROUND, '05-impl/at-backend.md': ' ' }
  const r = decideReworkBase({ before, after: to6(before), stages: STAGES, diskSha: disk(files), dispatched: { S5: ['at-architect', 'at-backend'] } })
  assert.equal(r.ok, false)
  assert.match(r.reason, /at-backend 在 S5 被派出去过（stage_roles 里没记它，门禁的派发记录里有）：05-impl\/at-backend\.md 是空文件/)
  assert.equal(decideReworkBase({ before, after: to6(before), stages: STAGES, diskSha: disk(files) }).ok, true, '没有派发记录时只看 stage_roles')
})

test('复核：派出去过人的那一段，补写 trimmed 也不算整段裁掉（推进与收口同一个口径）', () => {
  const s7 = st('S7', { stage_roles: { S6: [] }, trimmed: { 'at-qa': 'S6' } })
  assert.equal(wholeStageTrimmed(STAGES, 'S6', s7, undefined, null), true)
  assert.equal(wholeStageTrimmed(STAGES, 'S6', s7, undefined, { S6: ['at-qa'] }), false)
  const s8 = st('S8', { stage_roles: { S6: [], S7: [] }, trimmed: { 'at-qa': 'S6', 'at-acceptance': 'S7' } })
  const probe = (n) => (n === '08-delivery.md' ? 'ok' : 'missing')
  assert.deepEqual(closeBlockers({ stages: STAGES, state: s8, probe }).map((b) => b.name), [])
  assert.ok(closeBlockers({ stages: STAGES, state: s8, probe, dispatched: { S6: ['at-qa'] } }).some((b) => b.name === '06-test.md'))
})

test('复核 H6：S5 这一段的 stage_roles 值不是数组（字符串、对象、null）→ 算没记账，拒', () => {
  for (const v of ['at-architect, at-backend', { 'at-backend': true }, null]) {
    const before = at5({ stage_roles: { S5: v } })
    const r = decideReworkBase({ before, after: to6(before), stages: STAGES, diskSha: disk(ROUND) })
    assert.equal(r.ok, false, JSON.stringify(v))
    assert.match(r.reason, /没有 S5 这一段（或者它的值不是角色名的数组）/)
  }
})

test('复核 H6：旧 run（没有 stage_roles）按整趟 roster 算参与者——理由说「这一趟被叫到过（旧 run……）」，不说「在 S5 被叫到过」', () => {
  const before = { stage: 'S5', history: H('S1', 'S2', 'S3', 'S4', 'S5'), rework: {}, roster: ['at-product', 'at-ui', 'at-backend'] }
  const r = decideReworkBase({ before, after: to6(before), stages: STAGES, diskSha: disk(ROUND) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /at-ui 这一趟被叫到过（旧 run 没有 stage_roles，门禁按整趟 roster 算 S5 的参与者）/)
  assert.doesNotMatch(r.reason, /at-ui 在 S5 被叫到过/)
})

test('复核 H6：写入前记着的参与者，同一次写入从 stage_roles 删掉 → 照样要它交', () => {
  const before = at5()
  const after = to6(before, { stage_roles: { S5: ['at-architect', 'at-backend'] } })
  const r = decideReworkBase({ before, after, stages: STAGES, diskSha: disk(ROUND) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /at-frontend 在 S5 被叫到过：05-impl\/at-frontend\.md 缺/)
})

test('复核 H6：读不出来的产物不拦、留痕；缺的不重复列进还旧；缺的与还旧的并在同一条理由里', () => {
  const unread = (name) => (name === '05-impl/at-frontend.md' ? { exists: true, sha: null } : disk(ROUND)(name))
  const u = decideReworkBase({ before: at5(), after: to6(at5()), stages: STAGES, diskSha: unread })
  assert.equal(u.ok, true, u.reason)
  assert.ok(u.notes.some((n) => n.includes('05-impl/at-frontend.md') && n.includes('读不出来')), u.notes.join('\n'))
  const base = { '05-impl/at-backend.md': sha('b'), '05-impl/at-frontend.md': sha('gone') }
  const before = at5({ history: H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5'), rework_base: base })
  const r = decideReworkBase({ before, after: to6(before), stages: STAGES, diskSha: disk(ROUND) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /at-frontend 在 S5 被叫到过：05-impl\/at-frontend\.md 缺/)
  assert.match(r.reason, /上一轮的产物（磁盘内容与 rework_base 记的 sha 相同）：05-impl\/at-backend\.md/)
  assert.doesNotMatch(r.reason, /上一轮的产物[^\n]*05-impl\/at-frontend\.md/)
})

test('复核 拒绝理由的出路：PM 自己的产物自己写；没叫过的产者派它或整段裁掉，后面要它当前置的说清裁掉的后果', () => {
  const text = departureLines(STAGES, [
    { sid: 'S4', name: '04-dispatch.md', role: 'at-pm', called: false, why: 'missing' },
    { sid: 'S3', name: '03-alignment.md', role: 'at-architect', called: false, why: 'missing' },
    { sid: 'S6', name: '06-test.md', role: 'at-qa', called: false, why: 'missing' },
  ], []).join('\n')
  assert.match(text, /04-dispatch\.md 缺：这是你自己的产物，你自己写/)
  assert.match(text, /S3 这一趟还没叫过 at-architect——派它/)
  assert.match(text, /S7、S8 要它当前置：整段裁掉它，那几段要派的人就派不出去，只能跟着整段裁掉/)
})

// 验证段的产物（06、07）今天都被后面的段当前置，「要它当前置」先判——「验证段的产物」那一支在插件自带的链上走不到，是纵深防御。
test('复核 拒绝理由的出路：叫过却没交，trimmed 不是出路的原因（要它当前置、这一段只有它一个产者）；能免的给写法与 04-dispatch 的时机', () => {
  const fixed = departureLines(STAGES, [
    { sid: 'S2', name: '01-prd.md', role: 'at-product', called: true, via: 'roles', why: 'missing' },
    { sid: 'S6', name: '06-test.md', role: 'at-qa', called: true, via: 'roles', why: 'empty' },
    { sid: 'S3', name: '03-alignment.md', role: 'at-architect', called: true, via: 'roles', why: 'missing' },
  ], []).join('\n')
  assert.match(fixed, /at-product（S3、S4、S7 要它当前置）/)
  assert.match(fixed, /at-qa（S7、S8 要它当前置）/)
  assert.match(fixed, /at-architect（S3 只有它一个产者）/)
  assert.match(fixed, /trimmed 不是出路/)
  const waive = departureLines(STAGES, [{ sid: 'S2', name: '02-ui-spec.md', role: 'at-ui', called: true, via: 'roles', why: 'missing' }], []).join('\n')
  assert.match(waive, /\{"at-ui": "S2"\} 写进 trimmed（理由记进 04-dispatch\.md；S4 之前的段，S4 写它时补上）/)
})

test('复核 一次只推进一段的理由：跨过去的段确实不做时，后面要它产物当前置的段跟着也派不出人', () => {
  const r = decideSingleStep({ before: st('S5'), after: st('S7'), stages: STAGES })
  assert.match(r.reason, /只能一起整段裁掉/)
})
