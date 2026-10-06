// M4j（docs/45，审查第 20 条与 docs/39 §3「契约修订之后，验证段的结论不要求重出」）：门禁专属的契约基线 runs/<id>/contract-base.json 的
// 纯函数——切第 1 节、读基线、初始化、修订、第 1 节变没变、H6 的推进与收口判据。门禁子进程那一层在 tests/gate-contract-base.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CONTRACT_BASE_FILE,
  section1Of,
  readContractBase,
  verificationProducts,
  verifyShasOf,
  initialBase,
  revisedBase,
  section1Drift,
  decideContractBase,
} from '../hooks/lib/contract-base.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const NL = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + NL
const BOM = String.fromCharCode(0xfeff)
const buf = (s) => Buffer.from(s, 'utf8')
const sha = (s) => sha256OfContract(buf(s))

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

test('M4j：基线文件名', () => {
  assert.equal(CONTRACT_BASE_FILE, 'contract-base.json')
})

test('M4j：section1Of——「## 1.」到下一个「## 」之间的正文；剥 BOM、折 CRLF、去行尾空白与首尾空行；### 小标题留在里面；没有这一节回 null', () => {
  assert.equal(section1Of(CONTRACT), SECTION1)
  assert.equal(section1Of(BOM + CONTRACT.split(NL).join(CRLF)), SECTION1)
  assert.equal(section1Of('# 契约' + NL + NL + '## 2. 理解' + NL + 'x'), null)
  assert.equal(section1Of(null), null)
  // 第 1 节是最后一节：到文件末尾。
  assert.equal(section1Of('## 1. 用户原话' + NL + NL + '> 原话' + NL), '> 原话')
  // 复核变异：BOM 紧挨着第 1 节的标题（契约一开头就是第 1 节）。
  assert.equal(section1Of(BOM + '## 1. 用户原话' + NL + NL + '> 原话'), '> 原话')
})

test('M4j：verificationProducts——stages.json 里 verifies: true 的段的固定产物', () => {
  assert.deepEqual(verificationProducts(STAGES), ['06-test.md', '07-acceptance.md', '08-delivery.md'])
  assert.deepEqual(verificationProducts(null), [])
})

test('M4j：readContractBase——读不出、形状不对当没有；不合法的 sha 丢掉', () => {
  assert.equal(readContractBase(null), null)
  assert.equal(readContractBase(buf('{坏')), null)
  assert.equal(readContractBase(buf('[]')), null)
  const ok = sha('x')
  const got = readContractBase(buf(JSON.stringify({ section1: 'a', contract_sha: ok, verify_base: { '06-test.md': ok, '07-acceptance.md': 'nope', 8: 1 } })))
  assert.deepEqual(got, { section1: 'a', contract_sha: ok, verify_base: { '06-test.md': ok } })
  assert.deepEqual(readContractBase(buf(JSON.stringify({ section1: 7, contract_sha: 'x' }))), { section1: null, contract_sha: null, verify_base: {} })
})

test('M4j：initialBase 记第 1 节与整份 sha、verify_base 为空；revisedBase 只在整份 sha 变了时换 verify_base，第 1 节不动', () => {
  const base = initialBase(buf(CONTRACT))
  assert.deepEqual(base, { section1: SECTION1, contract_sha: sha(CONTRACT), verify_base: {} })
  assert.equal(initialBase(null), null)
  assert.equal(revisedBase(base, buf(CONTRACT), { '06-test.md': sha('t') }), null, '契约没变：不重写')
  const revised = CONTRACT + '### 修订 1（用户主动提出）' + NL + '- 加一条：能删。' + NL
  const after = revisedBase(base, buf(revised), { '06-test.md': sha('t'), '07-acceptance.md': sha('a') })
  assert.deepEqual(after, { section1: SECTION1, contract_sha: sha(revised), verify_base: { '06-test.md': sha('t'), '07-acceptance.md': sha('a') } })
})

test('M4j：section1Drift——记下的是字符串、磁盘上的第 1 节不同（或者切不出来了）才算变了', () => {
  const base = initialBase(buf(CONTRACT))
  assert.equal(section1Drift(base, buf(CONTRACT + '### 修订 1' + NL)), false, '第 4 节加修订不算')
  assert.equal(section1Drift(base, buf(CONTRACT.split(CRLF).join(NL).split(NL).join(CRLF))), false, '换行写法不算')
  assert.equal(section1Drift(base, buf(CONTRACT.replace('能加一条', '能加一条、删一条'))), true)
  assert.equal(section1Drift(base, buf(CONTRACT.replace('## 1. 用户原话', '## 1 用户原话改'))), true, '标题被改得切不出来也算')
  assert.equal(section1Drift({ ...base, section1: null }, buf(CONTRACT)), false, '首记时切不出第 1 节：之后切得出也不核')
  assert.equal(section1Drift(null, buf(CONTRACT)), false)
})

// ---- H6：推进与收口 ----

const H = (...ids) => ids.map((stage) => ({ stage, at: 't' }))
const state = (stage, extra = {}) => ({ stage, history: H(...['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].slice(0, Number(stage.slice(1)))), closed_at: null, ...extra })
const disk = (files) => (name) => (Object.hasOwn(files, name) ? { exists: true, sha: sha(files[name]), blank: files[name].trim() === '' } : { exists: false, sha: null })
const BASE = (verify = {}) => ({ section1: SECTION1, contract_sha: sha(CONTRACT), verify_base: verify })

test('M4j H6：第 1 节变了——推进与收口拒，回退、原地补记不拒', () => {
  const drifted = buf(CONTRACT.replace('能加一条', '能加一条、删一条'))
  const args = { stages: STAGES, base: BASE(), contractBytes: drifted, diskSha: disk({}) }
  const fwd = decideContractBase({ ...args, before: state('S3'), after: state('S4') })
  assert.equal(fwd.ok, false)
  assert.ok(fwd.reason.includes('契约第 1 节是用户原话，推进出 S1 之后门禁记下了它'), fwd.reason)
  const close = decideContractBase({ ...args, before: state('S8'), after: state('S8', { closed_at: '2026-10-06T12:00:00Z' }) })
  assert.equal(close.ok, false)
  assert.equal(decideContractBase({ ...args, before: state('S5'), after: state('S3', { history: [...H('S1', 'S2', 'S3', 'S4', 'S5'), ...H('S3')] }) }).ok, true, '回退不判')
  assert.equal(decideContractBase({ ...args, before: state('S4'), after: state('S4', { roster: ['x'] }) }).ok, true, '原地补记不判')
  assert.equal(decideContractBase({ ...args, base: null, before: state('S3'), after: state('S4') }).ok, true, '没有基线：不判')
})

test('M4j H6：对着上一版契约的验证段结论——推进出那一段与收口拒；出路是回退到最早那一段，只剩自己的交付文档就重写', () => {
  const files = { '06-test.md': 'test v1', '07-acceptance.md': 'acc v1', '08-delivery.md': 'del v1' }
  const vb = { '06-test.md': sha('test v1'), '07-acceptance.md': sha('acc v1'), '08-delivery.md': sha('del v1') }
  const args = { stages: STAGES, base: BASE(vb), contractBytes: buf(CONTRACT), diskSha: disk(files) }
  const s7 = decideContractBase({ ...args, before: state('S7'), after: state('S8') })
  assert.equal(s7.ok, false)
  assert.ok(s7.reason.includes('07-acceptance.md'), s7.reason)
  assert.ok(s7.reason.includes('照 /agent-team:at 第 3 节的「回退」记回到 S6'), s7.reason)
  const close = decideContractBase({ ...args, before: state('S8'), after: state('S8', { closed_at: '2026-10-06T12:00:00Z' }) })
  assert.equal(close.ok, false)
  assert.ok(close.reason.includes('06-test.md、07-acceptance.md、08-delivery.md'), close.reason)
  // 重出过的不算（内容变了）。
  const redone = decideContractBase({ ...args, diskSha: disk({ '06-test.md': 'test v2', '07-acceptance.md': 'acc v2', '08-delivery.md': 'del v2' }), before: state('S8'), after: state('S8', { closed_at: '2026-10-06T12:00:00Z' }) })
  assert.equal(redone.ok, true, redone.reason)
  // 只剩项目经理自己的交付文档：重写，不用回退。
  const own = decideContractBase({ ...args, diskSha: disk({ '06-test.md': 'test v2', '07-acceptance.md': 'acc v2', '08-delivery.md': 'del v1' }), before: state('S8'), after: state('S8', { closed_at: '2026-10-06T12:00:00Z' }) })
  assert.equal(own.ok, false)
  assert.ok(own.reason.includes('08-delivery.md 是你自己的产物，对着这一版重写') && !own.reason.includes('「回退」'), own.reason)
  // 推进出不是验证段的段：不判。
  assert.equal(decideContractBase({ ...args, before: state('S4'), after: state('S5') }).ok, true)
})

test('M4j：verifyShasOf——验证段的产物在、不是空白的才记（空白的本来就不算交了）', () => {
  const files = { '06-test.md': '  ' + NL, '07-acceptance.md': 'acc' + NL }
  const got = verifyShasOf({ stages: STAGES, artifactExists: (n) => Object.hasOwn(files, n), artifactBytes: (n) => buf(files[n]) })
  assert.deepEqual(got, { '07-acceptance.md': sha('acc' + NL) })
})
