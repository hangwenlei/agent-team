// M4d（docs/38，全量审查第 17 条，推进判据）：H6 在推进那一次写入里核离开的那一段交齐了没有、一次只推进一段。纯函数在 hooks/lib/advance.mjs，
// 接线在 hooks/lib/rework-guard.mjs 的 decideAdvance / decideReworkBase。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideSingleStep, departureNeeds, departureBlockers, mayWaive } from '../hooks/lib/advance.mjs'
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
