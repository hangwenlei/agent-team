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

test('M4j：section1Of——「## 1.」到契约自己的下一节之间；剥 BOM、折 CRLF、去行尾空白与首尾空行；原话里的「## 」行与 ### 小标题都留着', () => {
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

// docs/90：用户常贴一份带编号节标题的需求（「## 1. 背景」「## 2. 需求」「## 4. 验收标准」），项目经理照抄进第 1 节。只按编号认节时，第 1 节在原话里第一个编号节
// 标题处切断（成了空串：推进出 S1 之后改原话门禁认不出），第 4 节认成原话里的那一节（真的修订块一条都读不到，改需求的判据整条失效）。现在按结构认契约
// 自己的节：第 2 节是第 1 节之后标题带「理解」的那一个，之后各节从它往下找（带「不做」「修订」的优先），找不到带关键词的退回第一个同编号的；第 4 节
// 一直到下一个编号大于 4 的标题或末尾（修订块里贴进来的编号节标题不切断它）。
test('docs/90：原话里自带编号节标题——第 1 节到契约自己的第 2 节为止，第 4 节认契约自己的那一节、贴进修订块的编号节标题不切断它', () => {
  const PASTED = ['## 1. 背景', '做一个待办应用。', '', '## 2. 需求', '能加、能删。', '', '## 4. 验收标准', '- 加了能看到', '### 4.1 细节']
  const text = ['# 契约', '', '## 1. 用户原话', '', ...PASTED, '', '## 2. PM 的理解（可改）', '- 理解', '', '## 3. 明确不做的事', '- 无', '', '## 4. 修订记录', '',
    '### 2026-10-12 · 用户主动提出', '**改动**：加一条：能导出。', ''].join(NL)
  assert.equal(section1Of(text), PASTED.join(NL))
  assert.deepEqual(revisionHeadingsOf(text), ['### 2026-10-12 · 用户主动提出'])
  // 改原话是第 1 节变了，不进修订指纹；改第 2 节照旧进。
  const edited = text.replace('能加、能删。', '能加、能删、能改。')
  assert.notEqual(section1Of(edited), section1Of(text))
  assert.equal(bodyShaOf(edited), bodyShaOf(text))
  assert.notEqual(bodyShaOf(text.replace('- 理解', '- 理解变了')), bodyShaOf(text))
  // 修订块里贴进来的编号节标题（用户原话那一栏）不切断第 4 节：后面的修订块照样认；用掉批准的那几块照样能整块去掉。
  const more = text + '### 2026-10-13 · 用户主动提出' + NL + '**用户原话**：' + NL + '## 1. 新背景' + NL + '要能导入。' + NL + NL +
    '### 2026-10-14 · 升级 #1（kind: tradeoff）' + NL + '**用户裁决**：x' + NL
  assert.deepEqual(revisionHeadingsOf(more), ['### 2026-10-12 · 用户主动提出', '### 2026-10-13 · 用户主动提出', '### 2026-10-14 · 升级 #1（kind: tradeoff）'])
  assert.equal(bodyShaOf(more.replace('要能导入。', '要能导入导出。'), ['### 2026-10-13 · 用户主动提出']), bodyShaOf(more, ['### 2026-10-13 · 用户主动提出']))
  // 契约自己的第 2 节标题不带「理解」的，退回第一个「## 2.」（与原来一样）。
  assert.equal(section1Of(['## 1. 用户原话', '', '原话', '', '## 2. 其他', 'x', '', '## 4. 修订记录', ''].join(NL)), '原话')
  // 复核（docs/90 §8，低 7）：契约没有第 5 节——第 4 节一直到末尾，修订块里贴进来的「## 5. 导出」不切断它、后面的修订块照样认。
  const five = text + '### 2026-10-13 · 用户主动提出' + NL + '**用户原话**：' + NL + '## 5. 导出' + NL + NL + '### 2026-10-14 · 升级 #1（kind: env-blocked）' + NL + '**用户裁决**：x' + NL
  assert.deepEqual(revisionHeadingsOf(five), ['### 2026-10-12 · 用户主动提出', '### 2026-10-13 · 用户主动提出', '### 2026-10-14 · 升级 #1（kind: env-blocked）'])
  // 升级兼容（docs/90）：新记的基线带 slicing: 2、按新切法算；这一版之前记下的（没有 slicing）照旧切法算——同一份契约不判第 1 节变了、不判修订，
  // 进行中的 run 升级之后不会被「照它改回去」卡住（旧切法记下的第 1 节是空串，改不回去）。
  const fresh = initialBase(buf(text))
  assert.equal(fresh.slicing, 2)
  assert.equal(fresh.section1, PASTED.join(NL))
  const legacy = { section1: section1Of(text, true), body_sha: bodyShaOf(text, [], true), revisions: revisionHeadingsOf(text, true), verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [] }
  assert.equal(legacy.section1, '', '旧切法：第 1 节切成空串（这一版之前的样子）')
  assert.equal(section1Drift(legacy, buf(text)), false)
  assert.equal(revisedBase(legacy, buf(text), {}, NOW), null)
  assert.equal(section1Drift(fresh, buf(text)), false)
  assert.equal(revisedBase(fresh, buf(text), {}, NOW), null)
  // 新基线改了原话照样认出来；旧基线照旧切法（认不出，与这一版之前一样）。
  assert.equal(section1Drift(fresh, buf(edited)), true)
  // readContractBase 留着 slicing: 2，别的值丢掉。
  assert.equal(readContractBase(buf(JSON.stringify({ ...fresh }))).slicing, 2)
  assert.equal(readContractBase(buf(JSON.stringify({ ...fresh, section1_next: '## 2. x' }))).section1_next, '## 2. x')
  assert.equal('section1_next' in readContractBase(buf(JSON.stringify({ ...fresh, section1_next: 7 }))), false)
  assert.equal('slicing' in readContractBase(buf(JSON.stringify({ ...fresh, slicing: 'x' }))), false)
})

// 复核（docs/90 §8，中 2、低 6）：几种原话与修订块的组合——
//   ① 实测清单场景 A 那段需求原样照抄（原话里的「## 3. 不做的」带着第 3 节的关键词）：第 1 节是整段（后一节从前一节往下找）；
//   ② 修订块里贴「## 4. 修订后的验收」：前面的修订块照样认（取第一个带关键词的，不取最后一个）；
//   ③ 契约缺第 2 节、原话里有「## 3. 范围」「## 4. 验收」：第 3、4 节认带关键词的那一个；
//   ④ 契约缺第 3 节、修订块里贴「## 3. 不做的」：第 4 节照样认出来（第 2、3 节只在第 4 节之前找）；
//   ⑤ 契约第 2 节标题不带「理解」、修订块里贴「## 2. 对需求的理解」：第 1 节不把后面几节吞进去。
test('docs/90 复核：原话与修订块里的几种编号节标题组合——第 1 节是整段原话、第 4 节的修订块一条不丢', () => {
  const tail = (s2 = '## 2. PM 的理解（可改）', s3 = '## 3. 明确不做的事') =>
    [...(s2 ? [s2, '- 理解', ''] : []), ...(s3 ? [s3, '- 无', ''] : []), '## 4. 修订记录', '', '### 2026-10-12 · 用户主动提出', '**改动**：x', '']
  const doc = (words, ...rest) => ['# 契约', '', '## 1. 用户原话', '', ...words, '', ...tail(...rest)].join(NL)
  const A = ['## 1. 背景', '我想要一个命令行记账小工具，用 Node.js 写，不引入第三方依赖。', '', '## 2. 功能', '- add <金额> <备注>：记一笔支出', '- list：列出全部记录，带序号与日期',
    '- total：输出总金额', '- 数据存在当前目录的 ledger.json', '', '## 3. 不做的', '- 不做图形界面，不做多用户', '', '## 4. 验收标准', '- 新记的一笔 list 能看到',
    '- 金额不是数字时报错，退出码不是 0', '- 有自动化测试，node --test 能跑通']
  assert.equal(section1Of(doc(A)), A.join(NL), '①')
  assert.deepEqual(revisionHeadingsOf(doc(A)), ['### 2026-10-12 · 用户主动提出'], '①')
  const two = doc(['做一个待办清单。']) + '### 2026-10-13 · 用户主动提出' + NL + '## 4. 修订后的验收' + NL + '- 能导出' + NL
  assert.deepEqual(revisionHeadingsOf(two), ['### 2026-10-12 · 用户主动提出', '### 2026-10-13 · 用户主动提出'], '②')
  const W3 = ['## 3. 范围', '只做命令行', '## 4. 验收', '- 能用']
  assert.equal(section1Of(doc(W3, null)), W3.join(NL), '③')
  assert.deepEqual(revisionHeadingsOf(doc(W3, null)), ['### 2026-10-12 · 用户主动提出'], '③')
  const four = doc(['做一个待办清单。'], '## 2. PM 的理解（可改）', null) + '### 2026-10-13 · 用户主动提出' + NL + '## 3. 不做的' + NL + '- 不做多用户' + NL + NL +
    '### 2026-10-14 · 升级 #1（kind: env-blocked）' + NL + '**用户裁决**：x' + NL
  assert.deepEqual(revisionHeadingsOf(four), ['### 2026-10-12 · 用户主动提出', '### 2026-10-13 · 用户主动提出', '### 2026-10-14 · 升级 #1（kind: env-blocked）'], '④')
  const five = doc(['做一个待办清单。'], '## 2. 其他') + '### 2026-10-13 · 用户主动提出' + NL + '## 2. 对需求的理解' + NL + '- 变了' + NL
  assert.equal(section1Of(five), '做一个待办清单。', '⑤')
  assert.deepEqual(revisionHeadingsOf(five), ['### 2026-10-12 · 用户主动提出', '### 2026-10-13 · 用户主动提出'], '⑤')
  // ⑥ 原话里有标题带「理解」「不做」的「## 2.」「## 3.」：契约自己的第 2、3 节在原话之后、第 4 节之前，取最后一个带关键词的——第 1 节照样是整段。
  const W6 = ['## 2. 对需求的理解', '要简单', '## 3. 不做的', '- 不做图形界面']
  assert.equal(section1Of(doc(W6)), W6.join(NL), '⑥')
  // ⑦ 契约缺第 3 节、原话里有「## 3. 不做的」：第 3 节只在第 2 节之后找，原话里的那一个不算。
  const W7 = ['做一个待办清单。', '## 3. 不做的', '- 不做多用户']
  assert.equal(section1Of(doc(W7, '## 2. PM 的理解（可改）', null)), W7.join(NL), '⑦')
  // ⑧ 第 4 节标题不带「修订」：退回从前一节往下找、带关键词的优先——原话里的「## 2. 需求」「## 4. 验收」不切断第 1 节，第 4 节认契约自己的那一节。
  const W8 = ['## 2. 需求', '能加', '## 4. 验收', '- 能看到']
  const d8 = ['## 1. 用户原话', '', ...W8, '', '## 2. PM 的理解（可改）', '- x', '', '## 3. 明确不做的事', '- 无', '', '## 4. 变更记录', '', '### 2026-10-12 · 用户主动提出', ''].join(NL)
  assert.equal(section1Of(d8), W8.join(NL), '⑧')
  assert.deepEqual(revisionHeadingsOf(d8), ['### 2026-10-12 · 用户主动提出'], '⑧')
})

// docs/90 第二次复核（高 1）：项目经理在可改的第 2 节里加子节（「## 2.1 对「删」的理解」）、补一个带「理解」的「## 2.」——第 1 节不跟着变。只认顶层编号节
// 标题（「## 2.1」不算）；记下基线之后以记下的第 1 节为锚（前缀匹配），后面几节怎么写都不影响；有原话记录时，记基线照原话匹配出来的那一段（initialBase 的 known）。
test('docs/90 第二次复核：第 2 节里加子节、补带「理解」的「## 2.」——第 1 节不变；基线以记下的第 1 节为锚；有原话记录时照原话记', () => {
  const words = ['## 1. 背景', '做一个待办清单。']
  const b0 = ['# 契约', '', '## 1. 用户原话', '', ...words, '', '## 2. PM 的理解（可改）', '- 理解', '', '## 3. 明确不做的事', '- 无', '', '## 4. 修订记录', ''].join(NL)
  const sub = b0.replace('- 理解' + NL, '- 理解' + NL + NL + '## 2.1 对「删」的理解' + NL + '- 删要确认' + NL)
  assert.equal(section1Of(sub), words.join(NL), '只认顶层编号节标题')
  const base = initialBase(buf(b0))
  assert.equal(base.section1, words.join(NL))
  const more = b0.replace('- 理解' + NL, '- 理解' + NL + NL + '## 2. 补充理解（修订后）' + NL + '- 再理解' + NL)
  for (const t of [sub, more]) {
    assert.equal(section1Drift(base, buf(t)), false, t)
    assert.equal(revisedBase(base, buf(t), {}, NOW).requirement, true, '改第 2 节照旧算改需求')
    assert.deepEqual(revisionHeadingsOf(t + '### 2026-10-12 · 用户主动提出' + NL, false, base.section1), ['### 2026-10-12 · 用户主动提出'])
  }
  assert.equal(section1Drift(base, buf(b0.replace('做一个待办清单。', '做一个待办清单，还要能删。'))), true)
  // 第 2 节标题不带「理解」、又有子节：同样以记下的为锚。
  const plain = b0.replace('## 2. PM 的理解（可改）', '## 2. 其他')
  const b2 = initialBase(buf(plain))
  assert.equal(section1Drift(b2, buf(plain.replace('- 理解' + NL, '- 理解' + NL + NL + '## 2.3 子节' + NL + '- x' + NL))), false)
  // 有原话记录：照原话记——第 3 节写在第 2 节前面也不锁进第 1 节，改它不算第 1 节变了。
  const mis = ['# 契约', '', '## 1. 用户原话', '', '做一个待办清单。', '', '## 3. 明确不做的事', '- 无', '', '## 2. PM 的理解（可改）', '- x', '', '## 4. 修订记录', ''].join(NL)
  const b3 = initialBase(buf(mis), '做一个待办清单。')
  assert.equal(b3.section1, '做一个待办清单。')
  assert.equal(section1Drift(b3, buf(mis.replace('- 无', '- 不做多用户'))), false)
  // 按锚认与按结构猜在这份契约上不一样（猜会把写在前面的第 3 节算进第 1 节）：记下的指纹以记下的第 1 节为锚，原样不动不算修订；原话后面多一行算第 1 节变了。
  assert.equal(b3.body_sha, bodyShaOf(mis, [], false, '做一个待办清单。'))
  assert.notEqual(b3.body_sha, bodyShaOf(mis))
  assert.equal(revisedBase(b3, buf(mis), {}, NOW), null)
  assert.equal(section1Drift(b3, buf(mis.replace('做一个待办清单。', '做一个待办清单。' + NL + '还要能删。'))), true)
  assert.equal(revisedBase(b3, buf(mis.replace('- 无', '- 不做多用户')), {}, NOW).requirement, true)
  assert.deepEqual(revisionHeadingsOf(mis + '### 2026-10-12 · 用户主动提出' + NL, false, b3.section1), ['### 2026-10-12 · 用户主动提出'])
})

// docs/90 第三次复核（中 1）：第 1 节被改、锚认不上时，第 1 节切在记基线时它之后的那一行标题（section1_next），不从头猜——改了又照提示改回去，两次都
// 不算修订（复核 F2：只改第 1 节不算修订）。第 2 节补过带「理解」的「## 2.」、原话里有带「修订」的「## 4.」两种形状下，猜的切点与记的不一样。
test('docs/90 第三次复核：第 1 节改了又改回去——锚认不上时切在记基线时那一行标题，两次都不算修订', () => {
  const b0 = ['# 契约', '', '## 1. 用户原话', '', '做一个待办清单。', '', '## 2. PM 的理解（可改）', '- 理解', '', '## 3. 明确不做的事', '- 无', '', '## 4. 修订记录', ''].join(NL)
  const base = initialBase(buf(b0))
  assert.equal(base.section1_next, '## 2. PM 的理解（可改）')
  const t1 = b0.replace('- 理解' + NL, '- 理解' + NL + NL + '## 2. 补充理解（修订后）' + NL + '- 再理解' + NL)
  const base1 = revisedBase(base, buf(t1), {}, NOW).base
  const t2 = t1.replace('做一个待办清单。', '做一个待办清单，还要能删。')
  assert.equal(section1Drift(base1, buf(t2)), true)
  assert.equal(revisedBase(base1, buf(t2), {}, NOW), null, '改第 1 节不算修订')
  assert.equal(revisedBase(base1, buf(t1), {}, NOW), null, '改回去也不算')
  // 原话里有带「修订」的「## 4.」（有原话记录，照原话记）：改第 1 节同样不算修订。
  const W = ['## 1. 背景', '做一个待办清单。', '## 4. 修订计划', '- 先做加'].join(NL)
  const n0 = ['# 契约', '', '## 1. 用户原话', '', W, '', '## 2. PM 的理解（可改）', '- x', '', '## 4. 修订记录', ''].join(NL)
  const nb = initialBase(buf(n0), W)
  assert.equal(nb.section1, W)
  assert.equal(revisedBase(nb, buf(n0.replace('- 先做加', '- 先做删')), {}, NOW), null)
})

// docs/90 第三次复核（中 3）：有原话记录、原话里带「## 4. 修订计划」与 ### 小标题——第 4 节从锚定的第 1 节之后找：环境阻塞的答复不算改需求；照现状交付用掉的
// 那一块之后往里补一句也不算。
test('docs/90 第三次复核：原话里带「## 4. 修订计划」与 ### 小标题——第 4 节从锚定的第 1 节之后找', () => {
  const W = ['## 1. 背景', '做一个待办清单。', '## 4. 修订计划', '### 4.1 先做加', '- 加'].join(NL)
  const T = ['# 契约', '', '## 1. 用户原话', '', W, '', '## 2. PM 的理解（可改）', '- x', '', '## 3. 明确不做的事', '- 无', '', '## 4. 修订记录', ''].join(NL)
  const base = initialBase(buf(T), W)
  assert.deepEqual(base.revisions, [])
  const A = T + '### 2026-10-12 · 升级 #1（kind: env-blocked）' + NL + '**用户裁决**：x' + NL
  assert.equal(revisedBase(base, buf(A), { '06-test.md': sha('t') }, NOW).requirement, false)
  const U = T + '### 2026-10-12 · 用户主动提出' + NL + '**用户原话**：照现状交付' + NL
  const r = revisedBase(base, buf(U), { '06-test.md': sha('t') }, NOW, 'sha256:' + 'a'.repeat(64))
  assert.deepEqual(r.base.deliver_blocks, ['### 2026-10-12 · 用户主动提出'])
  assert.equal(revisedBase(r.base, buf(U + '补一句。' + NL), {}, NOW), null, '往用掉批准的那一块里补一句不算修订')
})

// docs/90 第三次复核（中 2）：契约里切不出第 1 节时，第 4 节照样从头找——不让环境阻塞的答复被当成改需求。
test('docs/90 第三次复核：切不出第 1 节时第 4 节照样认得出', () => {
  for (const h of ['## 1 用户原话', '### 1. 用户原话', '## 用户原话']) {
    const T = ['# 契约', '', h, '', '做一个待办清单。', '', '## 2. PM 的理解（可改）', '- x', '', '## 4. 修订记录', ''].join(NL)
    const A = T + '### 2026-10-12 · 升级 #1（kind: env-blocked）' + NL + '**用户裁决**：x' + NL
    assert.deepEqual(revisionHeadingsOf(A), ['### 2026-10-12 · 升级 #1（kind: env-blocked）'], h)
    assert.equal(revisedBase(initialBase(buf(T)), buf(A), { '06-test.md': sha('t') }, NOW).requirement, false, h)
  }
  // 原话里带「## 4. 验收标准」与 ### 小标题：第 4 节认标题带「修订」的那一个。
  const T = ['# 契约', '', '## 用户原话', '', '## 4. 验收标准', '### 4.1 能加', '', '## 2. PM 的理解（可改）', '- x', '', '## 4. 修订记录', ''].join(NL)
  const A = T + '### 2026-10-12 · 升级 #1（kind: env-blocked）' + NL + '**用户裁决**：x' + NL
  assert.deepEqual(revisionHeadingsOf(A), ['### 2026-10-12 · 升级 #1（kind: env-blocked）'])
  // 第 4 节标题不带「修订」：退回第一个顶层「## 4.」。
  const V = ['# 契约', '', '## 用户原话', '', '做一个待办清单。', '', '## 2. PM 的理解（可改）', '- x', '', '## 4. 变更记录', ''].join(NL)
  assert.deepEqual(revisionHeadingsOf(V + '### 2026-10-12 · 用户主动提出' + NL), ['### 2026-10-12 · 用户主动提出'])
})

// docs/90 第二次复核（中 2）：旧基线（这一版之前记的、没有 slicing）的修订块标题、照现状交付那一路、用掉批准的那几块，都照旧切法算。
test('docs/90 第二次复核：旧基线的修订块标题、照现状交付那一路、用掉批准的那几块都照旧切法', () => {
  const N = ['# 契约', '', '## 1. 用户原话', '', '## 1. 背景', '做一个待办清单。', '', '## 4. 验收标准', '- 能看到', '### 4.1 细节', '', '## 2. PM 的理解（可改）', '', '- 命令行。', '', '## 4. 修订记录', ''].join(NL)
  const legacy = { section1: section1Of(N, true), body_sha: bodyShaOf(N, [], true), revisions: revisionHeadingsOf(N, true), verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [] }
  assert.deepEqual(legacy.revisions, ['### 4.1 细节'], '旧切法：第 4 节认成原话里那一节（这一版之前的样子）')
  const A = N + '### 2026-10-12 · 升级 #1（kind: env-blocked）' + NL + '**用户裁决**：x' + NL
  const shas = { '06-test.md': sha('t') }
  assert.equal(revisedBase(legacy, buf(A), shas, NOW).requirement, true, '旧切法读不到真修订块：照旧算改需求（这一版之前的行为）')
  const D = 'sha256:' + 'a'.repeat(64)
  const r = revisedBase(legacy, buf(A), shas, NOW, D)
  assert.equal(r.deliver, D)
  assert.equal(revisedBase(r.base, buf(A), shas, NOW), null, '记过照现状交付之后原样重写：不算修订')
  assert.notEqual(bodyShaOf(N, ['### 4.1 细节'], true), bodyShaOf(N, [], true), '用掉批准的那几块按旧切法的第 4 节去掉')
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
  assert.deepEqual(base, { section1: SECTION1, body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [], slicing: 2, section1_next: '## 2. PM 的理解（可改）' })
  assert.equal(initialBase(null), null)
  const shas = { '06-test.md': sha('t'), '07-acceptance.md': sha('a') }
  assert.equal(revisedBase(base, buf(CONTRACT), shas, NOW), null, '契约没变')
  assert.equal(revisedBase(base, buf(CONTRACT.replace('能加一条', '能加一条、删一条')), shas, NOW), null, '复核（F2）：只改第 1 节不算修订')
  const admin = withBlock(CONTRACT, '### 2026-10-06 · 升级 #1（kind: env-blocked）', '**用户裁决**：照现状交付。')
  assert.deepEqual(revisedBase(base, buf(admin), shas, NOW), {
    base: { section1: SECTION1, body_sha: bodyShaOf(admin), revisions: ['### 2026-10-06 · 升级 #1（kind: env-blocked）'], verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [], slicing: 2, section1_next: '## 2. PM 的理解（可改）' },
    requirement: false,
  })
  const user = withBlock(admin, '### 2026-10-07 · 用户主动提出')
  const afterAdmin = revisedBase(base, buf(admin), shas, NOW).base
  assert.deepEqual(revisedBase(afterAdmin, buf(user), shas, NOW), {
    base: { section1: SECTION1, body_sha: bodyShaOf(user), revisions: ['### 2026-10-06 · 升级 #1（kind: env-blocked）', '### 2026-10-07 · 用户主动提出'], verify_base: shas, revised_at: NOW, deliver_used: [], deliver_blocks: [], slicing: 2, section1_next: '## 2. PM 的理解（可改）' },
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
