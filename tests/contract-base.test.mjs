// M4j（docs/45，审查第 20 条与 docs/39 §3「契约修订之后，验证段的结论不要求重出」）：门禁专属的契约基线 runs/<id>/contract-base.json 的
// 纯函数——切第 1 节、修订指纹（去掉第 1 节、不计行尾空白）、修订块标题的类别、读基线、初始化与修订、第 1 节变没变、对着上一版契约的结论、
// 出路（看当前段）、H6 的推进与收口判据。门禁子进程那一层在 tests/gate-contract-base.test.mjs。复核（docs/45 §8）之后整份重写。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ADMIN_KINDS,
  CONTRACT_BASE_FILE,
  bodyShaOf,
  decideContractBase,
  headingKind,
  initialBase,
  outdatedFix,
  outdatedProducts,
  readContractBase,
  revisedBase,
  revisionHeadingsOf,
  section1Drift,
  section1Of,
  verificationProducts,
  verifyShasOf,
} from '../hooks/lib/contract-base.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { ESCALATION_KINDS } from '../hooks/lib/state.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const NL = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + NL
const BOM = String.fromCharCode(0xfeff)
const buf = (s) => Buffer.from(s, 'utf8')
const sha = (s) => sha256OfContract(buf(s))
const NOW = '2026-10-06T12:00:00.000Z'

const CONTRACT = [
  '# 00 契约',
  '',
  '## 1. 用户原话',
  '',
  '> 做一个待办清单，能加一条、列出全部。  ',
  '> 要有自动化测试。',
  '',
  '### 补充（用户第二条消息）',
  '',
  '> 数据存在 todos.json。',
  '',
  '## 2. PM 的理解（可改）',
  '',
  '- 命令行工具。',
  '',
  '## 4. 修订记录',
  '',
].join(NL)
const SECTION1 = ['> 做一个待办清单，能加一条、列出全部。', '> 要有自动化测试。', '', '### 补充（用户第二条消息）', '', '> 数据存在 todos.json。'].join(NL)
const withBlock = (text, heading, body = '**改动**：加一条：能删。') => text + heading + NL + body + NL + NL

test('M4j：基线文件名；不改需求的答复类别都是升级类别', () => {
  assert.equal(CONTRACT_BASE_FILE, 'contract-base.json')
  assert.deepEqual([...ADMIN_KINDS].sort(), ['budget-exhausted', 'env-blocked', 'sensitive'])
  for (const k of ADMIN_KINDS) assert.ok(ESCALATION_KINDS.includes(k), k)
})

test('M4j：section1Of——「## 1.」到下一个编号节标题之间；剥 BOM、折 CRLF、去行尾空白与首尾空行；原话里的「## 」行与 ### 小标题都留着', () => {
  assert.equal(section1Of(CONTRACT), SECTION1)
  assert.equal(section1Of(BOM + CONTRACT.split(NL).join(CRLF)), SECTION1)
  assert.equal(section1Of(BOM + '## 1. 用户原话' + NL + NL + '> 原话'), '> 原话')
  assert.equal(section1Of('## 1. 用户原话' + NL + NL + '> 原话' + NL), '> 原话')
  // 复核（F8）：原话里自带「## 」开头的行——只在下一个编号节标题处结束。
  const raw = ['## 1. 用户原话', '', 'README 要有这两节：', '## 安装', '## 使用', '数据存在 todos.json，不要用数据库', '', '## 2. PM 的理解', '- x'].join(NL)
  assert.equal(section1Of(raw), ['README 要有这两节：', '## 安装', '## 使用', '数据存在 todos.json，不要用数据库'].join(NL))
  assert.equal(section1Of('# 契约' + NL + NL + '## 2. 理解' + NL + 'x'), null)
  assert.equal(section1Of(null), null)
})

test('M4j：bodyShaOf——修订指纹去掉第 1 节、不计行尾空白与换行写法；第 4 节加修订块、改第 2 节都算', () => {
  const base = bodyShaOf(CONTRACT)
  assert.equal(bodyShaOf(CONTRACT.replace('能加一条', '能加一条、删一条')), base, '只改第 1 节不算修订')
  assert.equal(bodyShaOf(BOM + CONTRACT.split(NL).join(CRLF)), base)
  assert.equal(bodyShaOf(CONTRACT.replace('- 命令行工具。', '- 命令行工具。   ')), base, '行尾空白不算')
  assert.notEqual(bodyShaOf(withBlock(CONTRACT, '### 2026-10-06 · 用户主动提出')), base)
  assert.notEqual(bodyShaOf(CONTRACT.replace('- 命令行工具。', '- 网页。')), base)
})

test('M4j：revisionHeadingsOf 与 headingKind——第 4 节里的 ### 标题；kind 照模板读，「用户主动提出」单列，认不出的回 null', () => {
  const text = withBlock(withBlock(CONTRACT, '### 2026-10-06 · 升级 #1（kind: env-blocked）'), '### 2026-10-06 · 用户主动提出')
  assert.deepEqual(revisionHeadingsOf(text), ['### 2026-10-06 · 升级 #1（kind: env-blocked）', '### 2026-10-06 · 用户主动提出'])
  assert.equal(headingKind('### 2026-10-06 · 升级 #1（kind: env-blocked）'), 'env-blocked')
  assert.equal(headingKind('### 2026-10-06 · 升级 #2 (kind：Sensitive)'), 'sensitive')
  assert.equal(headingKind('### 2026-10-06 · 用户主动提出'), 'user-change')
  assert.equal(headingKind('### 2026-10-06 · 补充说明'), null)
  assert.deepEqual(revisionHeadingsOf('## 1. 用户原话' + NL + '### 小标题'), [], '没有第 4 节')
})

test('M4j：readContractBase——带 BOM 也读得出；读不出、形状不对当没有；不合法的字段丢掉', () => {
  assert.equal(readContractBase(null), null)
  assert.equal(readContractBase(buf('{坏')), null)
  assert.equal(readContractBase(buf('[]')), null)
  const ok = sha('x')
  const full = { section1: 'a', body_sha: ok, revisions: ['### h', 7], verify_base: { '06-test.md': ok, '07-acceptance.md': 'nope' }, revised_at: NOW }
  const want = { section1: 'a', body_sha: ok, revisions: ['### h'], verify_base: { '06-test.md': ok }, revised_at: NOW, deliver_used: [], deliver_blocks: [] }
  assert.deepEqual(readContractBase(buf(JSON.stringify(full))), want)
  assert.deepEqual(readContractBase(buf(BOM + JSON.stringify(full))), want, '复核（F7）：带 BOM')
  assert.deepEqual(readContractBase(buf(JSON.stringify({ section1: 7, body_sha: 'x', revised_at: 'yes' }))), { section1: null, body_sha: null, revisions: [], verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [] })
  // M4k（docs/46）：用过的照现状交付批准（按验收结论的 sha 记，只留合法的 sha）与用掉它们的修订块标题（只留字符串）。
  const got = readContractBase(buf(JSON.stringify({ ...full, deliver_used: [ok, 'nope', 7], deliver_blocks: ['### h', 7] })))
  assert.deepEqual([got.deliver_used, got.deliver_blocks], [[ok], ['### h']])
})

test('M4j：verificationProducts 与 verifyShasOf——验证段的固定产物；在、不是空白的才记', () => {
  assert.deepEqual(verificationProducts(STAGES), ['06-test.md', '07-acceptance.md', '08-delivery.md'])
  assert.deepEqual(verificationProducts(null), [])
  const files = { '06-test.md': '  ' + NL, '07-acceptance.md': 'acc' + NL }
  assert.deepEqual(verifyShasOf({ stages: STAGES, artifactExists: (n) => Object.hasOwn(files, n), artifactBytes: (n) => buf(files[n]) }), { '07-acceptance.md': sha('acc' + NL) })
})

test('M4j：initialBase 与 revisedBase——只改第 1 节、只改空白不算修订；新加的修订块全是不改需求的答复：只换指纹；别的修订：重拍快照、记下时刻', () => {
  const base = initialBase(buf(CONTRACT))
  assert.deepEqual(base, { section1: SECTION1, body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [] })
  assert.equal(initialBase(null), null)
  const shas = { '06-test.md': sha('t'), '07-acceptance.md': sha('a') }
  assert.equal(revisedBase(base, buf(CONTRACT), shas, NOW), null, '契约没变')
  assert.equal(revisedBase(base, buf(CONTRACT.replace('能加一条', '能加一条、删一条')), shas, NOW), null, '复核（F2）：只改第 1 节不算修订')
  const admin = withBlock(CONTRACT, '### 2026-10-06 · 升级 #1（kind: env-blocked）', '**用户裁决**：照现状交付。')
  assert.deepEqual(revisedBase(base, buf(admin), shas, NOW), {
    base: { section1: SECTION1, body_sha: bodyShaOf(admin), revisions: ['### 2026-10-06 · 升级 #1（kind: env-blocked）'], verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [] },
    requirement: false,
  })
  const user = withBlock(admin, '### 2026-10-07 · 用户主动提出')
  const afterAdmin = revisedBase(base, buf(admin), shas, NOW).base
  assert.deepEqual(revisedBase(afterAdmin, buf(user), shas, NOW), {
    base: { section1: SECTION1, body_sha: bodyShaOf(user), revisions: ['### 2026-10-06 · 升级 #1（kind: env-blocked）', '### 2026-10-07 · 用户主动提出'], verify_base: shas, revised_at: NOW, deliver_used: [], deliver_blocks: [] },
    requirement: true,
  })
  // 没有新的修订块、改了第 2 节：算改需求。认不出类别的新块：算改需求。
  assert.equal(revisedBase(base, buf(CONTRACT.replace('- 命令行工具。', '- 网页。')), shas, NOW).requirement, true)
  assert.equal(revisedBase(base, buf(withBlock(CONTRACT, '### 2026-10-06 · 补充说明')), shas, NOW).requirement, true)
  // 一次写入同时加了答复与改需求的修订块：算改需求（不是「有一块是答复就不重出」）。
  const both = withBlock(withBlock(CONTRACT, '### 2026-10-06 · 升级 #1（kind: sensitive）'), '### 2026-10-06 · 用户主动提出')
  assert.equal(revisedBase(base, buf(both), shas, NOW).requirement, true)
})

test('M4j：section1Drift——记下的是字符串、磁盘上的第 1 节不同（或者切不出来了）才算变了', () => {
  const base = initialBase(buf(CONTRACT))
  assert.equal(section1Drift(base, buf(withBlock(CONTRACT, '### 修订 1'))), false)
  assert.equal(section1Drift(base, buf(CONTRACT.split(NL).join(CRLF))), false)
  assert.equal(section1Drift(base, buf(CONTRACT.replace('能加一条', '能加一条、删一条'))), true)
  assert.equal(section1Drift(base, buf(CONTRACT.replace('## 1. 用户原话', '## 1 用户原话改'))), true, '标题被改得切不出来也算')
  assert.equal(section1Drift({ ...base, section1: null }, buf(CONTRACT)), false, '首记时切不出第 1 节：不核')
  assert.equal(section1Drift(null, buf(CONTRACT)), false)
  assert.equal(section1Drift(base, null), false, '契约读不出来：不误拦')
})

// ---- 对着上一版契约的结论、出路 ----

const disk = (files) => (name) => (Object.hasOwn(files, name) ? { exists: true, sha: sha(files[name]) } : { exists: false, sha: null })
const BEFORE_REV = '2026-10-06T11:00:00.000Z'
const AFTER_REV = '2026-10-06T13:00:00.000Z'

test('M4j：outdatedProducts——内容跟修订那一刻一样的；修订之前派出去、之后才交的（复核 F4）；修订之后重派过的不算；不在磁盘上的不算', () => {
  const base = { section1: null, body_sha: null, revisions: [], verify_base: { '06-test.md': sha('t1'), '08-delivery.md': sha('d1') }, revised_at: NOW }
  const files = { '06-test.md': 't1', '07-acceptance.md': 'a2', '08-delivery.md': 'd1' }
  const at = { '07-acceptance.md': BEFORE_REV }
  assert.deepEqual(outdatedProducts({ stages: STAGES, base, diskSha: disk(files), lastDispatchAt: (n) => at[n] ?? null }), ['06-test.md', '07-acceptance.md', '08-delivery.md'])
  assert.deepEqual(outdatedProducts({ stages: STAGES, base, diskSha: disk({ ...files, '06-test.md': 't2' }), lastDispatchAt: (n) => ({ '07-acceptance.md': AFTER_REV })[n] ?? null }), ['08-delivery.md'])
  assert.deepEqual(outdatedProducts({ stages: STAGES, base, diskSha: disk({}), lastDispatchAt: () => BEFORE_REV }), [])
  assert.deepEqual(outdatedProducts({ stages: STAGES, base: null, diskSha: disk(files), lastDispatchAt: () => null }), [])
})

test('M4j：outdatedFix（复核 F1）——早于当前段的回退到最早那一段；在当前段的同段重派（自己的产物重写）；只在后面的段走到时照常重出', () => {
  assert.deepEqual(outdatedFix(STAGES, ['06-test.md', '07-acceptance.md', '08-delivery.md'], 'S8'), { kind: 'rollback', sid: 'S6', text: '照 /agent-team:at 第 3 节的「回退」记回到 S6，让产者对着这一版重出' })
  assert.deepEqual(outdatedFix(STAGES, ['06-test.md'], 'S6'), { kind: 'redo', sid: 'S6', text: '在 S6 里同段重派它的产者重出（同一段里重派不计返工）' })
  assert.deepEqual(outdatedFix(STAGES, ['08-delivery.md'], 'S8'), { kind: 'own', sid: 'S8', text: '08-delivery.md 是你自己的产物，对着这一版重写' })
  assert.deepEqual(outdatedFix(STAGES, ['06-test.md', '07-acceptance.md'], 'S5'), { kind: 'later', sid: null, text: '06-test.md、07-acceptance.md 在后面的段，这一轮走到那一段时照常重出，现在不用回退' })
})

// ---- H6：推进与收口 ----

const H = (...ids) => ids.map((stage) => ({ stage, at: 't' }))
const CHAIN = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const state = (stage, extra = {}) => ({ stage, history: H(...CHAIN.slice(0, CHAIN.indexOf(stage) + 1)), closed_at: null, ...extra })
const BASE = (verify = {}, revised_at = verify && Object.keys(verify).length ? NOW : null) => ({ section1: SECTION1, body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: verify, revised_at })
const CLOSED = '2026-10-06T14:00:00Z'

test('M4j H6：第 1 节变了——推进与收口拒；回退、原地补记、已收口之后补记不判；没有基线、契约读不出来不判', () => {
  const drifted = buf(CONTRACT.replace('能加一条', '能加一条、删一条'))
  const args = { stages: STAGES, base: BASE(), contractBytes: drifted, diskSha: disk({}), lastDispatchAt: () => null }
  const fwd = decideContractBase({ ...args, before: state('S3'), after: state('S4') })
  assert.equal(fwd.ok, false)
  assert.ok(fwd.reason.includes('契约第 1 节是用户原话，推进出 S1 之后门禁记下了它'), fwd.reason)
  assert.equal(decideContractBase({ ...args, before: state('S8'), after: state('S8', { closed_at: CLOSED }) }).ok, false)
  assert.equal(decideContractBase({ ...args, before: state('S5'), after: state('S3', { history: [...H('S1', 'S2', 'S3', 'S4', 'S5'), ...H('S3')] }) }).ok, true, '回退不判')
  assert.equal(decideContractBase({ ...args, before: state('S4'), after: state('S4', { roster: ['x'] }) }).ok, true, '原地补记不判')
  assert.equal(decideContractBase({ ...args, before: state('S8', { closed_at: CLOSED }), after: state('S8', { closed_at: CLOSED, escalations: [] }) }).ok, true, '复核（K02）：已收口之后补记不是收口')
  assert.equal(decideContractBase({ ...args, base: null, before: state('S3'), after: state('S4') }).ok, true, '没有基线')
  assert.equal(decideContractBase({ ...args, contractBytes: null, before: state('S3'), after: state('S4') }).ok, true, '复核（K05）：契约读不出来')
})

test('M4j H6：对着上一版契约的结论——推进核到达段之前的全部验证段（复核 F5），出路看当前段（F1）；收口时任何一份；重出过的放行', () => {
  const files = { '06-test.md': 't1', '07-acceptance.md': 'a1', '08-delivery.md': 'd1' }
  const vb = { '06-test.md': sha('t1'), '07-acceptance.md': sha('a1'), '08-delivery.md': sha('d1') }
  const args = { stages: STAGES, base: BASE(vb), contractBytes: buf(CONTRACT), diskSha: disk(files), lastDispatchAt: () => null }
  // S7 → S8：06 在 S7 之前、07 在当前段——回退到最早那一段 S6。
  const s7 = decideContractBase({ ...args, before: state('S7'), after: state('S8') })
  assert.equal(s7.ok, false)
  assert.ok(s7.reason.includes('契约在 06-test.md、07-acceptance.md 写成之后改过') && s7.reason.includes('「回退」记回到 S6'), s7.reason)
  // S6 → S7：06 在当前段——同段重派，不回退。
  const s6 = decideContractBase({ ...args, before: state('S6'), after: state('S7') })
  assert.equal(s6.ok, false)
  assert.ok(s6.reason.includes('在 S6 里同段重派它的产者重出') && !s6.reason.includes('「回退」'), s6.reason)
  // 收口：三份都对着上一版——回退到 S6；只剩自己的交付文档——重写。
  const close = decideContractBase({ ...args, before: state('S8'), after: state('S8', { closed_at: CLOSED }) })
  assert.ok(!close.ok && close.reason.includes('06-test.md、07-acceptance.md、08-delivery.md') && close.reason.includes('回到 S6'), close.reason)
  const own = decideContractBase({ ...args, diskSha: disk({ '06-test.md': 't2', '07-acceptance.md': 'a2', '08-delivery.md': 'd1' }), before: state('S8'), after: state('S8', { closed_at: CLOSED }) })
  assert.ok(!own.ok && own.reason.includes('08-delivery.md 是你自己的产物，对着这一版重写') && !own.reason.includes('「回退」'), own.reason)
  assert.equal(decideContractBase({ ...args, diskSha: disk({ '06-test.md': 't2', '07-acceptance.md': 'a2', '08-delivery.md': 'd2' }), before: state('S8'), after: state('S8', { closed_at: CLOSED }) }).ok, true)
  // 返工轮里还在 S5：后面段的结论不挡推进出 S5（走到那一段时照常重出）；推进出不是验证段、前面也没有验证段的段不判。
  assert.equal(decideContractBase({ ...args, before: state('S5'), after: state('S6') }).ok, true)
  assert.equal(decideContractBase({ ...args, before: state('S4'), after: state('S5') }).ok, true)
})

test('M4k（docs/46，评审 F1、F2；复核中 2）：revisedBase 的照现状交付批准——有一条没用过的（按验收结论的 sha），这次修订不算改需求、sha 记进 deliver_used、这次加的修订块记进 deliver_blocks；没有就照标题分；标题里的「照现状交付」不特殊', () => {
  const base = initialBase(buf(CONTRACT))
  const shas = { '06-test.md': sha('t'), '07-acceptance.md': sha('a') }
  const S = sha('结论：不通过' + NL)
  const H1 = '### 2026-10-06 · 升级 #1（kind: contract-conflict）'
  const conflict = withBlock(CONTRACT, H1, '**用户裁决**：照现状交付。')
  assert.deepEqual(revisedBase(base, buf(conflict), shas, NOW, S), {
    base: { ...base, body_sha: bodyShaOf(conflict, [H1]), revisions: [H1], deliver_used: [S], deliver_blocks: [H1] },
    requirement: false,
    deliver: S,
  })
  assert.equal(revisedBase(base, buf(conflict), shas, NOW).requirement, true, '没有批准：照标题分')
  assert.equal(revisedBase(base, buf(CONTRACT), shas, NOW, S), null, '契约没变：不消耗')
  const marked = withBlock(CONTRACT, H1 + '· 照现状交付')
  assert.equal(revisedBase(base, buf(marked), shas, NOW).requirement, true, '标记不特殊')
  // 用过之后：deliver_used 跟着带；下一次修订没有新批准，照标题分。
  const used = revisedBase(base, buf(conflict), shas, NOW, S).base
  const next = withBlock(conflict, '### 2026-10-07 · 用户主动提出')
  const r = revisedBase(used, buf(next), shas, NOW)
  assert.equal(r.requirement, true)
  assert.deepEqual(r.base.deliver_used, [S])
})

test('M4k 复核（中 1）：用掉批准的那几块修订块，之后只改它们不算修订；改别处、加新块、改了那一块的标题照常判；bodyShaOf 不计这几块', () => {
  const base = initialBase(buf(CONTRACT))
  const shas = { '06-test.md': sha('t'), '07-acceptance.md': sha('a') }
  const S = sha('结论：不通过' + NL)
  const H1 = '### 2026-10-06 · 升级 #1（kind: contract-conflict）'
  const answered = withBlock(CONTRACT, H1, '**用户裁决**：照现状交付。')
  const used = revisedBase(base, buf(answered), shas, NOW, S).base
  const more = answered + '**对契约的影响**：AC7 不修。' + NL
  assert.notEqual(bodyShaOf(answered), bodyShaOf(more))
  assert.equal(bodyShaOf(answered, [H1]), bodyShaOf(more, [H1]))
  assert.equal(revisedBase(used, buf(more), shas, NOW), null, '只改那一块：不算修订')
  assert.equal(revisedBase(used, buf(more.replace('- 命令行工具。', '- 网页。')), shas, NOW).requirement, true, '改第 2 节照算')
  assert.equal(revisedBase(used, buf(withBlock(more, '### 2026-10-07 · 用户主动提出')), shas, NOW).requirement, true, '加新块照算')
  assert.equal(revisedBase(used, buf(more.split(H1).join('### 2026-10-06 · 升级 #1（kind: tradeoff）')), shas, NOW).requirement, true, '改了那一块的标题：不再认它')
})
