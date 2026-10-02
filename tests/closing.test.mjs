// M4a（docs/35）：收口标记 closed_at——纯函数部分（hooks/lib/closing.mjs）。子进程级在 tests/gate-m4a.test.mjs。
//
// 问题 A（2026-10-01 核验）：一趟走完之后，同一会话里用户要求改一处，门禁把它当成旧 run 的重做：派人被拒、理由只给「记回退」，
// 不提「这一趟已经走完，新改动另起一趟」；最省事的路成了 PM 自己写代码。另外没有收口标记，【阶段】对走完的 run 反复说「该收口了」，
// 收口本身不经任何门禁（交付文档缺了也没人发现）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { closedAt, lastStageId, closeBlockers, decideClosing, decideClosedDispatch, EMPTY_SHA as CLOSING_EMPTY_SHA } from '../hooks/lib/closing.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const H = (...stages) => stages.map((s) => ({ stage: s, at: '2026-10-01T00:00:00Z' }))
const FULL = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8')
const CLOSED = '2026-10-01T15:00:00Z'
const st = (stage, history, extra = {}) => ({ stage, history, rework: {}, ...extra })

// probe：{ 名字: 'ok' | 'missing' | 'stale' | 'unreadable' }，没列的算 ok。
const probeOf = (map = {}) => (name) => map[name] ?? 'ok'
// diskSha 形状（H6 里那一份）：files 里有的在、sha 是给定值；unreadable 里的在、读不出来。
const diskOf = (files, unreadable = []) => (name) => {
  if (unreadable.includes(name)) return { exists: true, sha: null }
  if (!Object.hasOwn(files, name)) return { exists: false, sha: null }
  return { exists: true, sha: files[name] }
}
const SHA = (c) => `sha256:${c.repeat(64)}`
const ALL_FILES = { '06-test.md': SHA('a'), '07-acceptance.md': SHA('b'), '08-delivery.md': SHA('c') }
// 空内容（0 字节、只有 BOM）归一化之后的 sha。
const EMPTY_SHA = sha256OfContract(Buffer.from('', 'utf8'))

test('M4a 复核 EMPTY_SHA：写死的常量等于空内容现算的 sha（含只有 BOM 的）', () => {
  assert.equal(CLOSING_EMPTY_SHA, EMPTY_SHA)
  assert.equal(sha256OfContract(Buffer.from([0xef, 0xbb, 0xbf])), EMPTY_SHA)
})

// ---------------------------------------------------------------- closedAt / lastStageId

test('M4a closedAt：非空字符串才算收口；空串、空白、别的类型、缺键都不算', () => {
  assert.equal(closedAt({ closed_at: CLOSED }), CLOSED)
  for (const v of ['', '   ', true, 1, null, [], {}]) assert.equal(closedAt({ closed_at: v }), null, JSON.stringify(v))
  assert.equal(closedAt({}), null)
  assert.equal(closedAt(null), null)
  assert.equal(closedAt('x'), null)
})

test('M4a lastStageId：阶段链书写顺序的最后一段；读不出来是 null', () => {
  assert.equal(lastStageId(STAGES), 'S8')
  assert.equal(lastStageId(null), null)
  assert.equal(lastStageId({}), null)
})

test('M4a 前提：真实阶段链最后一段的 produces 不含 <role>——收口按字面名字核它；改成模式时这几条判据要回来重判', () => {
  const last = STAGES[lastStageId(STAGES)]
  assert.ok(Array.isArray(last.produces) && last.produces.every((p) => !p.includes('<role>')))
})

// ---------------------------------------------------------------- closeBlockers

test('M4a closeBlockers：最后一段的前置与产物都在、都是这一轮的 → 没有阻碍', () => {
  assert.deepEqual(closeBlockers({ stages: STAGES, state: st('S8', FULL), probe: probeOf() }), [])
})

test('M4a closeBlockers：缺、还旧、读不出来，逐份点名；前置在前、产物在后', () => {
  const b = closeBlockers({
    stages: STAGES,
    state: st('S8', FULL),
    probe: probeOf({ '06-test.md': 'stale', '07-acceptance.md': 'missing', '08-delivery.md': 'unreadable' }),
  })
  assert.deepEqual(b.map((x) => [x.name, x.why]), [
    ['06-test.md', 'stale'],
    ['07-acceptance.md', 'missing'],
    ['08-delivery.md', 'unreadable'],
  ])
})

test('M4a closeBlockers：前置由整段裁掉的段产出（那一段的产者都在 trimmed 里记成那一段）→ 不要求；记成别的段不算', () => {
  const trimmed = { 'at-qa': 'S6', 'at-acceptance': 'S7' }
  const probe = probeOf({ '06-test.md': 'missing', '07-acceptance.md': 'missing' })
  assert.deepEqual(closeBlockers({ stages: STAGES, state: st('S8', FULL, { trimmed }), probe }), [])
  const wrong = closeBlockers({ stages: STAGES, state: st('S8', FULL, { trimmed: { 'at-qa': 'S5', 'at-acceptance': 'S7' } }), probe })
  assert.deepEqual(wrong.map((x) => x.name), ['06-test.md'])
})

test('M4a closeBlockers：最后一段自己的产物不因 trimmed 豁免（PM 裁不掉自己）', () => {
  const b = closeBlockers({ stages: STAGES, state: st('S8', FULL, { trimmed: { 'at-pm': 'S8' } }), probe: probeOf({ '08-delivery.md': 'missing' }) })
  assert.deepEqual(b.map((x) => x.name), ['08-delivery.md'])
})

// ---------------------------------------------------------------- decideClosing：关上

const close = ({ before, after, files = ALL_FILES, unreadable = [], stages = STAGES }) =>
  decideClosing({ before, after, stages, diskSha: diskOf(files, unreadable) })
const OPEN_S8 = st('S8', FULL)
const CLOSING = st('S8', FULL, { closed_at: CLOSED })

test('M4a 关上：不收口的写入不管', () => {
  assert.equal(close({ before: OPEN_S8, after: { ...OPEN_S8, never_invoked: [] } }).ok, true)
  assert.equal(close({ before: st('S5', H('S1', 'S5')), after: st('S6', H('S1', 'S5', 'S6')) }).ok, true)
})

test('M4a 关上：最后一段、不追加 history、前置与产物都在 → 放行', () => {
  const r = close({ before: OPEN_S8, after: CLOSING })
  assert.equal(r.ok, true, r.reason)
})

test('M4a 关上：stage 不是最后一段 → 拒，叫它先推进', () => {
  const before = st('S7', FULL.slice(0, 7))
  const r = close({ before, after: st('S7', FULL.slice(0, 7), { closed_at: CLOSED }) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /最后一段（S8）/)
  assert.match(r.reason, /推进/)
})

test('M4a 关上：推进进最后一段与收口放在同一次写入 → 拒，叫它拆成两次', () => {
  const before = st('S7', FULL.slice(0, 7))
  const r = close({ before, after: st('S8', FULL, { closed_at: CLOSED }) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /不往 history 追加/)
  assert.match(r.reason, /单独一次 Write/)
})

test('M4a 关上：原地追加一条最后一段再收口 → 拒（只有「不追加 history」这一条打得红它）', () => {
  const r = close({ before: OPEN_S8, after: st('S8', [...FULL, ...H('S8')], { closed_at: CLOSED }) })
  assert.equal(r.ok, false)
  // 复核（F4）：已经在最后一段时改说「原样带着」，不叫它推进进去。
  assert.match(r.reason, /照写入前原样带着/)
})

test('M4a 关上：写入前读不出来（第一次写、修坏文件）也核——stage 不是最后一段拒；是最后一段、东西都在放行', () => {
  const bad = close({ before: null, after: st('S1', H('S1'), { closed_at: CLOSED }) })
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /最后一段/)
  assert.equal(close({ before: null, after: CLOSING }).ok, true)
})

test('M4a 关上：缺、还旧、读不出来 → 拒，逐份按情形给出路', () => {
  const r = close({
    before: OPEN_S8,
    after: { ...CLOSING, rework_base: { '06-test.md': SHA('a') } },
    files: { '06-test.md': SHA('a'), '08-delivery.md': SHA('c') },
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /06-test\.md[^\n]*重跑之后重写/)
  assert.match(r.reason, /07-acceptance\.md[^\n]*at-acceptance[^\n]*不用记回退/)
  const own = close({ before: OPEN_S8, after: CLOSING, files: { '06-test.md': SHA('a'), '07-acceptance.md': SHA('b') } })
  assert.match(own.reason, /08-delivery\.md[^\n]*你自己写/)
  const un = close({ before: OPEN_S8, after: CLOSING, unreadable: ['08-delivery.md'] })
  assert.equal(un.ok, false)
  assert.match(un.reason, /08-delivery\.md[^\n]*读不出来/)
})

test('M4a 关上：rework_base 里标过 "accepted" 的不算还旧（收口按写入后的 rework_base 判）', () => {
  const after = { ...CLOSING, rework_base: { '05-impl/at-backend.md': 'accepted', '06-test.md': SHA('z') } }
  assert.equal(close({ before: OPEN_S8, after }).ok, true)
})

test('M4a 关上：阶段链读不出来 → 拒（单向门：判不了就不放）', () => {
  const r = close({ before: OPEN_S8, after: CLOSING, stages: null })
  assert.equal(r.ok, false)
  assert.match(r.reason, /插件/)
})

test('M4a 形状：closed_at 写成空串、true、数字 → 拒；null（模板的初值，没收口）放行', () => {
  assert.equal(close({ before: OPEN_S8, after: { ...OPEN_S8, closed_at: null } }).ok, true)
  for (const v of ['', '  ', true, 123, []]) {
    const r = close({ before: OPEN_S8, after: { ...OPEN_S8, closed_at: v } })
    assert.equal(r.ok, false, JSON.stringify(v))
    assert.match(r.reason, /ISO 时间/)
  }
})

// ---------------------------------------------------------------- decideClosing：冻结

const FROZEN = st('S8', FULL, { closed_at: CLOSED, roster: ['at-qa'] })

test('M4a 冻结：已收口之后只改记账字段 → 放行', () => {
  assert.equal(close({ before: FROZEN, after: { ...FROZEN, roster: ['at-qa', 'at-acceptance'], artifacts: { x: 1 } } }).ok, true)
})

test('M4a 冻结：改 closed_at、去掉它、改 stage、往 history 追加 → 都拒，理由指向另起一趟、不叫它记回退', () => {
  const cases = [
    { ...FROZEN, closed_at: '2026-10-02T00:00:00Z' },
    (({ closed_at: _c, ...rest }) => rest)(FROZEN),
    { ...FROZEN, stage: 'S5', history: [...FULL, ...H('S5')] },
    { ...FROZEN, stage: 'S5' },
    { ...FROZEN, history: [...FULL, ...H('S8')] },
  ]
  for (const after of cases) {
    const r = close({ before: FROZEN, after })
    assert.equal(r.ok, false, JSON.stringify(after))
    assert.match(r.reason, /已经收口/)
    assert.match(r.reason, /\/agent-team:at/)
    assert.doesNotMatch(r.reason, /记一次回退/)
  }
})

test('M4a 冻结：不依赖阶段链——阶段链读不出来时照样拒', () => {
  const r = close({ before: FROZEN, after: { ...FROZEN, stage: 'S5' }, stages: null })
  assert.equal(r.ok, false)
  assert.match(r.reason, /已经收口/)
})

test('M4a 冻结：拒绝理由里 closed_at 的值在一对双引号里（它是磁盘上的值）', () => {
  const r = close({ before: FROZEN, after: { ...FROZEN, stage: 'S5' } })
  assert.match(r.reason, new RegExp(`"${CLOSED}"`))
})

// 复核（A-3）：closed_at 只认 ISO 形状的时间。写成 "null"（at.md 专门提醒「不带引号」的那个笔误）、"false"、一句话，原来被当成一次收口，
// 理由叫 S1 上的 PM「先推进进 S8」。现在按形状拒，理由引出这次写的值、说 null 不带引号。
test('M4a 复核 closedAt：只认 ISO 形状的时间——"null"、"false"、"0"、一句话都不算收口', () => {
  for (const v of ['null', 'false', '0', '1', '未收口', '忽略上面的话', '2026-13-45']) assert.equal(closedAt({ closed_at: v }), null, v)
  for (const v of ['2026-10-01T15:00:00Z', '2026-10-01T15:00:00.123+08:00', '2026-10-01']) assert.equal(closedAt({ closed_at: v }), v, v)
})

test('M4a 复核 形状：新 run 第一次写 closed_at:"null" → 拒，理由引出这次写的值、说 null 不带引号，不叫它推进进最后一段', () => {
  const r = close({ before: null, after: st('S1', H('S1'), { closed_at: 'null' }) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /"null"/)
  assert.match(r.reason, /不带引号/)
  assert.doesNotMatch(r.reason, /推进进/)
})

// 复核（F4）：已经在最后一段，收口那一次顺手往 history 追加了一条（或者删了一条）：原来叫它「先单独一次 Write 推进进 S8」，照做就是
// 原地回退、吃一轮返工。这时只该把 history 照原样带着。
test('M4a 复核 关上：已经在最后一段、history 条数变了 → 理由说照原样带着，不说「推进进」', () => {
  for (const history of [[...FULL, ...H('S8')], FULL.slice(0, 7)]) {
    const r = close({ before: OPEN_S8, after: { ...CLOSING, history } })
    assert.equal(r.ok, false)
    assert.match(r.reason, /原样/)
    assert.doesNotMatch(r.reason, /推进进/)
  }
})

// 复核（A-2、F5）：trimmed 只豁免这一趟在那一段从没叫过的产者——叫过却没交的，收口那一次补写 trimmed 不再放行（那等于用 trimmed
// 绕过一份没交的测试报告）；从没叫过的（项目不用它、或者整段裁掉），拒绝理由给「补记进 trimmed」这条路。
test('M4a 复核 closeBlockers：在那一段被叫到过的产者，trimmed 里记着也不豁免；没叫过的豁免', () => {
  const probe = probeOf({ '06-test.md': 'missing', '07-acceptance.md': 'missing' })
  const trimmed = { 'at-qa': 'S6', 'at-acceptance': 'S7' }
  const called = st('S8', FULL, { trimmed, stage_roles: { S6: ['at-qa'] }, roster: ['at-qa'] })
  assert.deepEqual(closeBlockers({ stages: STAGES, state: called, probe }).map((b) => b.name), ['06-test.md'])
  // 旧 run（没有 stage_roles）看 roster。
  const old = st('S8', FULL, { trimmed, roster: ['at-qa', 'at-acceptance'] })
  assert.deepEqual(closeBlockers({ stages: STAGES, state: old, probe }).map((b) => b.name), ['06-test.md', '07-acceptance.md'])
})

test('M4a 复核 关上：缺的前置——从没叫过的给「补记进 trimmed」；叫过没交的只给「派它补交」、点明 trimmed 不是出路', () => {
  const files = { '08-delivery.md': SHA('c') }
  const never = close({ before: OPEN_S8, after: { ...CLOSING, stage_roles: {} }, files })
  assert.match(never.reason, /06-test\.md[^\n]*补记进 trimmed/)
  const called = close({ before: OPEN_S8, after: { ...CLOSING, stage_roles: { S6: ['at-qa'] }, roster: ['at-qa'] }, files })
  assert.match(called.reason, /06-test\.md[^\n]*被叫到过[^\n]*trimmed 不是出路/)
  assert.doesNotMatch(called.reason, /06-test\.md[^\n]*补记进 trimmed/)
})

// 复核（A-6）：收口是单向门，空文件（0 字节、只有 BOM）不算交了。
test('M4a 复核 关上：最后一段的产物或前置是空文件 → 拒，点名「空文件」', () => {
  const r = close({ before: OPEN_S8, after: CLOSING, files: { ...ALL_FILES, '08-delivery.md': EMPTY_SHA } })
  assert.equal(r.ok, false)
  assert.match(r.reason, /08-delivery\.md[^\n]*空文件/)
})

// 复核（A-8）：冻结的拒绝理由与 H2 同一条出路，同样给出 at.md 的路径（压缩之后上下文里不一定还有 /agent-team:at 的正文）。
test('M4a 复核 冻结：拒绝理由给出 at.md 的路径', () => {
  const r = decideClosing({ before: FROZEN, after: { ...FROZEN, stage: 'S5' }, stages: STAGES, diskSha: diskOf(ALL_FILES), atPath: '/plugin/commands/at.md' })
  assert.match(r.reason, /Read \/plugin\/commands\/at\.md/)
})

// ---------------------------------------------------------------- decideClosedDispatch

const dispatchOf = (over) =>
  decideClosedDispatch({
    stages: STAGES,
    state: FROZEN,
    target: 'at-architect',
    roster: ROSTER,
    callerCanWriteState: true,
    runId: '20261001-0900-x',
    atPath: '/plugin/commands/at.md',
    ...over,
  })

test('M4a 收口之后派团队角色 → 拒，PM 拿到另起一趟的两条路；run id 与 closed_at 在引号里', () => {
  for (const target of ['at-architect', 'at-product', 'at-qa', 'at-acceptance', 'at-backend']) {
    const r = dispatchOf({ target })
    assert.equal(r.decision, 'deny', target)
    assert.match(r.reason, /已经收口/)
    assert.match(r.reason, /\/agent-team:at/)
    assert.match(r.reason, /"20261001-0900-x"/)
    assert.match(r.reason, new RegExp(`"${CLOSED}"`))
    assert.doesNotMatch(r.reason, /记一次回退/)
  }
})

test('M4a 收口之后：派花名册外的（general-purpose）不管——那归 H1', () => {
  assert.equal(dispatchOf({ target: 'general-purpose' }).decision, 'allow')
})

test('M4a 收口之后：派发者不是 PM → 拒，叫它回报上级，不给另起一趟', () => {
  const r = dispatchOf({ target: 'at-backend', callerCanWriteState: false })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /回报给派你的人/)
  assert.doesNotMatch(r.reason, /\/agent-team:at /)
})

test('M4a 最后一段、没收口：派协调者 → 拒，给收口、记回退、自己读三条路', () => {
  for (const target of ['at-architect', 'at-product']) {
    const r = dispatchOf({ target, state: st('S8', FULL) })
    assert.equal(r.decision, 'deny', target)
    assert.match(r.reason, /最后一段（S8）/)
    assert.match(r.reason, /第 6 节收口/)
    assert.match(r.reason, /记一次回退/)
  }
})

test('M4a 最后一段、没收口：派叶子角色（补收口缺的前置）→ 这里不管，交给 H2 的重做判据', () => {
  for (const target of ['at-acceptance', 'at-qa']) assert.equal(dispatchOf({ target, state: st('S8', FULL) }).decision, 'allow', target)
})

test('M4a 不在最后一段、没收口：派协调者 → 不管', () => {
  assert.equal(dispatchOf({ target: 'at-architect', state: st('S5', H('S1', 'S5')) }).decision, 'allow')
})

test('M4a 花名册读不出来 → 不管（H1 那边会拒）', () => {
  assert.equal(dispatchOf({ roster: null }).decision, 'allow')
  assert.equal(dispatchOf({ roster: null, state: st('S8', FULL) }).decision, 'allow')
})

// M4a 复核（C34、C20）：最后一段派协调者，非 PM 收到的是「回报给派你的人」；冻结里 history 截短也拒。
test('M4a 复核 最后一段、没收口：非 PM 派协调者 → 拒，回报上级，不给收口与回退的做法', () => {
  const r = dispatchOf({ target: 'at-architect', state: st('S8', FULL), callerCanWriteState: false })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /回报给派你的人/)
  assert.doesNotMatch(r.reason, /第 6 节收口|记一次回退/)
})

test('M4a 复核 冻结：history 截短一条 → 拒', () => {
  const r = close({ before: FROZEN, after: { ...FROZEN, history: FULL.slice(0, 7) } })
  assert.equal(r.ok, false)
  assert.match(r.reason, /history 的条数/)
})
