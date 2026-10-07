// M4g（docs/42）：docs/39 §5 第三轮前一半「账」的正文——第 28 条（产物的 sha 怎么记、reach.json 写完门禁会核）、第 41 条（at-status 几处
// 报错了的、问用户之前先记 escalation）、第 37 条后半（用户主动改需求怎么记）、产者交代与「叫到」的口径。门禁那一半在
// tests/artifact-drift.test.mjs、tests/gate-deliverable.test.mjs、tests/ledger.test.mjs、tests/gate-ledger-project.test.mjs、
// tests/coverage.test.mjs、tests/gate-ledger.test.mjs。承重的句子整句钉（空白不计）。
//
// M4g 复核（docs/42 §8）：门禁另外几处文字（写契约时【契约】的漂移那一句、返工预算那一支）、契约的格式与模板、at-resume 照账本比对改账
// 那一句，原来没跟上「问之前先记」「用户主动改需求不记 escalation」「不照着磁盘改账」；返工预算那几条 bullet 没钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compareContractSha } from '../hooks/lib/contract-hash.mjs'
import { askUserText } from '../hooks/lib/budget.mjs'
import { buildLedgerNotices } from '../hooks/lib/ledger.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const AT = read('commands/at.md')
const STATUS = read('commands/at-status.md')
const INIT = read('commands/at-init.md')
const RESUME = read('commands/at-resume.md')
const bodyOf = (role) => read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---')

// 第 4 节（问用户）从标题到下一个二级标题。
const section4 = AT.slice(AT.indexOf('## 4. 什么时候必须停下来问用户'), AT.indexOf('\n## 5.'))

// ---- 第 28 条 ----

const AT_PRODUCE =
  '产物的 sha256 记进 `state.json` 的 `artifacts`（键是产物名，值是那个哈希）：你自己写的，写完会收到一条【产物】回传，里面就有它；' +
  '下级写的，【产物】回传发给写它的那个角色，它在回报里把值报上来，经协调者派出去的由协调者转报。**原样写进去，不要自己算、不要自己拼**——' +
  '门禁先剥 BOM、把 CRLF 折成 LF 再算，自己算的会对不上。回报里没带的：之后还有派发的，派发返回时的【账本比对】会报它「没记」、带着门禁算出来的值，' +
  '照那一条的收尾记；最后一次派发交的（例如验收结论），之后没有派发了，只能靠回报——派的时候在完成定义里写上「回报里带上【产物】给的 sha」。'

test('M4g 第 28 条：/agent-team:at 不再说「写完一段产物你会收到【产物】」——下级写的回传发给写它的人、协调者转报；值照抄，不自己算；最后一次派发的只能靠回报', () => {
  assert.ok(has(AT, AT_PRODUCE), 'commands/at.md 第 3 节记 artifacts 那一句变了')
  assert.ok(!AT.includes('写完一段产物之后，你会收到一条【产物】回传'), '旧说法还在：对下级写的产物不成立')
})

// M4g 复核（中-2）：嵌套派发的写者把值报给协调者，协调者原来一句都没说要转报——PM 拿不到值，「没记」那一行的收尾又只认回报里的值。
const ARCH_RELAY = '执行角色回报里带的 sha（它写实现记录时【产物】回传给的），原样转报给 PM——PM 照它记账，不用自己算。'
const PRODUCT_RELAY = '`at-ui` 回报里带的 sha（它写产物时【产物】回传给的），原样转报给 PM——PM 照它记账，不用自己算。'
test('M4g 复核：协调者把下级报上来的 sha 原样转报给 PM', () => {
  assert.ok(has(bodyOf('at-architect'), ARCH_RELAY), 'agents/at-architect.md')
  assert.ok(has(bodyOf('at-product'), PRODUCT_RELAY), 'agents/at-product.md')
})

const INIT_REACH =
  '写完之后门禁会按当前 `project.json` 与花名册重算核一遍：对不上就在写 `reach.json` 的这一次回传里再给你一段【触达表】，照它给的那一份原样重写；' +
  '这一次没再收到【触达表】，就是对上了（写 `project.json` 那一次没收到【触达表】的，照下面那一条停下）。'
test('M4g 第 28 条：at-init 写完 reach.json——门禁会重算核对，对不上照回传给的重写；与「写 project.json 没收到就停下」分开说', () => {
  assert.ok(has(INIT, INIT_REACH))
})

// M4g 复核（中-3）：续跑时 artifacts 对不上磁盘，原来叫 PM「照账本比对给出的 sha 改」——正是这一轮要堵的「照着磁盘改账」。
const RESUME_SHA = '下一次派发时的【账本比对】会带着门禁算出来的值报它，照那一条的收尾做——不要为了消掉它照着磁盘改账。'
test('M4g 复核：at-resume 里 artifacts 对不上磁盘的，照账本比对的收尾做，不照着磁盘改账', () => {
  assert.ok(has(RESUME, RESUME_SHA), 'commands/at-resume.md 那一句变了')
  assert.ok(!RESUME.includes('会给出磁盘上算出来的 sha，照它改'), '旧说法还在：照着磁盘改账')
})

// ---- 产者交代与「叫到」的口径（docs/11 §5.24 说它配机械判据、至今没写）----

const AT_CALLED = '`roster` 记的是**这一趟真正干过活的每一个角色，包括你的下级派出去的那些**——**不是「你亲手派的那些」**。'
const AT_CALLED_EXAMPLE = '举例：S2 的 `at-ui` 由 `at-product` 派（你自己派不动它，花名册里没有你到它的那条边），**它照样要进 `roster`**。'
const AT_LOGGED =
  '门禁记着经过它的每一次派发：派发记录里有它的，产者交代那条回传单列成「漏记」，照它补记、不用重派；派发记录里没有的（派发没经过门禁、' +
  '记录读不出），那条误报和真漏派长得一模一样。'
const AT_WHY_SAME =
  '分两次写，推进的那一次会把刚走完那一段的产者点名报出来：门禁记过那次派发的报成「漏记」，没记过的报成漏派。`S2`、`S5` 推进那一次 `stage_roles` ' +
  '里必须有这一段的键（见下一段），不能先推进、后补键；推进之后再往这一段补人（产者交代报「漏记」时）照常写得进。'
test('M4g：第 4 条「叫到」含下级派出去的那些，at-ui 那个例子在；不再说「今天没有任何判据钉着这一句」；派发记录里有的会单列成漏记', () => {
  const step4 = AT.slice(AT.indexOf('4. 把这一段真正叫到的角色累加进 `roster`'), AT.indexOf('**`never_invoked` 不要在这里逐段累加**'))
  assert.ok(step4.length > 0, 'commands/at.md 第 3 节第 4 条找不到')
  for (const s of [AT_CALLED, AT_CALLED_EXAMPLE, AT_LOGGED]) assert.ok(has(step4, s), s)
  assert.ok(!AT.includes('今天没有任何判据钉着这一句'), '那一句现在是假话：这条判据钉着它')
  assert.ok(!AT.includes('`S2`、`S5` 先推进、后补记 `stage_roles` 已经写不进去'), '旧说法容易读成「漏记」的出路会被拒')
  assert.ok(has(AT, AT_WHY_SAME), '第 3 条「为什么必须是同一次」那一句')
})

test('M4g 复核：【阶段】说「分两次写」时分清漏记与漏派', () => {
  const STAGES = {
    S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
    S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  }
  const out = buildLedgerNotices({
    kind: 'other', contractSha: null, state: { stage: 'S1', contract_sha: 'PENDING' }, reach: null, stages: STAGES, stageDone: true,
    stateProblems: [], produceName: null, produceSha: null, writerIsPm: true,
  }).join('\n')
  assert.ok(out.includes('【阶段】S1'), out)
  assert.ok(out.includes('分两次写，推进那一次产者交代会把刚走完那一段的产者点名报出来（门禁记过派发的报成漏记，没记过的报成漏派）。'), out)
})

// ---- 第 41 条与「问之前先记」----

const AT_ASK_FIRST =
  '**问之前先记**：往 `state.json` 的 `escalations` 追加一条 `{ stage, kind, question, answer, at }`，`kind` 用上表里的取值，' +
  '`answer` 先写空串——会话断在等答复的时候，续跑与 `/agent-team:at-status`（「待办升级」）靠它看得见这一问还没答。'
const AT_AFTER = '1. 把那一条的 `answer` 补成用户的答复（用户原话）；问之前没记的，照上面补一条完整的。'
const BUDGET_YES =
  '- 用户选了「再返工一轮」：门禁自己记下这条批准，回传里说记下了哪一段、覆盖哪几段——批准由门禁记，`state.json` 里不用为它多写任何字段。' +
  '先给契约追加修订块（回传给你新的 `contract_sha`），再把那次被拒的写入连同这条 escalation（问之前记的那一条，`answer` 补上）与新的 `contract_sha` ' +
  '一起重写——同一次 Write，别让重写把记着的 escalation 覆盖掉。没有被拒的写入、是回传叫你问的，就把 escalation 的 `answer` 与 `contract_sha` 记上，' +
  '照常往下走这一轮，不要为它再记一次回退。回传说没记下，照它说的原因重问。'
const BUDGET_STOP =
  '- 用户选了「停在这里」：不回退也不推进。问之前记的那一条，`answer` 写用户原话；把现状、run id 与续跑的办法（`/agent-team:at-resume`）' +
  '告诉用户，停下等用户。'
test('M4g 第 41 条：/agent-team:at 第 4 节——问之前先记一条 answer 为空串的 escalation，答复之后补上；返工预算那两条照这个口径', () => {
  assert.ok(has(section4, AT_ASK_FIRST), '第 4 节缺「问之前先记」')
  assert.ok(has(section4, AT_AFTER), '第 4 节「答复之后」第 1 件事变了')
  assert.ok(section4.indexOf('**问之前先记**') < section4.indexOf('用户答复之后**两件事都要做**'), '「问之前先记」要排在「答复之后」之前')
  assert.ok(has(section4, BUDGET_YES), '「再返工一轮」那一条变了')
  assert.ok(has(section4, BUDGET_STOP), '「停在这里」那一条变了')
})

// M4g 复核（低-1）：返工预算那一支的门禁文字（H6 的拒绝理由、【阶段】、【返工预算】共用）原来是「先问、停在这里时再记一条」。
test('M4g 复核：门禁的返工预算文字也是问之前先记、停在这里时把那一条的 answer 写上', () => {
  const t = askUserText('S5', [], '再回退。')
  assert.ok(t.includes('先往 escalations 记一条 budget-exhausted（answer 先写空串），再用 AskUserQuestion 问用户：'), t)
  assert.ok(t.includes('用户选「停在这里」：不回退也不推进，把那一条的 answer 写成用户原话，'), t)
  assert.ok(!t.includes('用户原话照记'), t)
})

const AT_USER_CHANGE =
  '**用户主动改需求**（不是你问出来的答复，是用户在对话里自己提出要改、要加的事）：不是升级，`escalations` 不记；照样把它作为一个带日期' +
  '的修订块追加进「修订记录」，标「用户主动提出」，把写契约那一次回传给的新值记进 `contract_sha`。改动要回到更早一段重做的，照第 3 节' +
  '「回退」记；已经收口的，照第 6 节另起一趟。'
test('M4g 第 37 条后半：用户主动改需求不是升级——修订块标「用户主动提出」、记新 contract_sha，要重做的照回退', () => {
  assert.ok(has(section4, AT_USER_CHANGE))
})

// M4g 复核（中-1）：写契约那一刻【契约】的漂移文案、契约的格式与模板原来都说「每次改动都要在 escalations 里留一条」——用户主动改需求时
// 与第 4 节的「不记」正面冲突，照回传记只能错记一类，或者写成 answer 空串、让「待办升级」一直挂着。
const DRIFT_LEGAL =
  '合法的改动有两种：第 4 节升级的答复（escalations 里问之前记的那一条，把它的 answer 补上）；用户在对话里主动提出的（修订块标「用户主动提出」，' +
  '不记 escalation）。是这两种之一，把新值写进 contract_sha；都不是，把契约恢复原样。'
const SKILL_REVISION =
  '用户的每一次改动，作为一个**带日期的修订块**追加进第 4 节——升级问题的答复是一种，用户在对话里主动提出的是另一种（修订块标「用户主动提出」）。' +
  '每追加一块，契约的 sha256 就变了：把写契约那一次回传（【契约】）给你的新哈希写进 `state.json` 的 `contract_sha`。升级问题那一种还有一件：' +
  '`escalations[]` 里那一条——问之前记、`answer` 先写空串，答复之后补上；用户主动提出的不记 escalation。'
const TEMPLATE_REVISION =
  '用户的每一次改动都作为一个带日期的修订块追加在这里——升级问题的答复，或者用户在对话里主动提出的（标「用户主动提出」）。'
test('M4g 复核：写契约时的漂移回传、契约的格式与模板都分清两种合法修订，用户主动提出的不记 escalation', () => {
  const r = compareContractSha({ recorded: 'sha256:' + 'a'.repeat(64), actual: 'sha256:' + 'b'.repeat(64) })
  assert.equal(r.kind, 'drift')
  assert.ok(r.problem.includes(DRIFT_LEGAL), r.problem)
  assert.ok(!r.problem.includes('补上 escalations 记录'), r.problem)
  const skill = read('skills/at-contract-format/SKILL.md')
  assert.ok(has(skill, SKILL_REVISION), 'skills/at-contract-format/SKILL.md')
  assert.ok(!skill.includes('2. 在 `escalations[]` 里留一条对应记录'), '契约的格式还在说每一块都留一条 escalation')
  const tpl = read('templates/00-contract.md')
  assert.ok(has(tpl, TEMPLATE_REVISION), 'templates/00-contract.md 第 4 节')
  assert.ok(tpl.includes('### 2026-09-18 · 用户主动提出'), '模板的修订块格式缺「用户主动提出」那一种')
})

const STATUS_LINES = [
  '当前阶段:    <stage>（<这一段谁在干：有 producers 的段（S2、S5）推进出去之前 stage_roles 里还没有这一段、返工轮里记的是上一轮的人——S5 照 04-dispatch.md ' +
    '的分工写，S2 写 at-product 与磁盘上已有产物的 at-ui，都标「本段未记账」；没有 stage_roles 的旧 run 看 roster；其余写那一段的 role>）',
  '契约:        <contract_sha 里 `sha256:` 之后的前 12 位；是 PENDING 就写 PENDING>，磁盘上<在/不在>',
  '产物:        逐阶段列，每个后面标 ✓ / ✗（按磁盘）；当前段之后、还没走到的段整段写「未到」，不标 ✗',
  '返工基线:    <rework_base 逐条「<产物>：<sha256: 之后的前 12 位> 或 accepted」；没有这个字段或为空就写「无」>',
  '待办升级:    <escalations 里 answer 是空串的（问了、用户还没答）；没有就写「无」>',
]
const STATUS_IMPL =
  '`S5` 的实现记录在磁盘上不等于交齐：逐份读，有「被写路径隔离拒绝」一节、里面还有没标「已解决」的条目的，只写了冒泡原因、没写做了什么的，' +
  '或者「测试」一节缺了、有新行为没有测试又不属于那两种情形的（做法见 `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 3 节 `S5` 那一条），' +
  '标「未交齐」并写一句原因，不标 ✓。'
test('M4g 第 41 条：at-status 的报法——当前阶段照分工报、sha 取 sha256: 之后的 12 位、没走到的段写「未到」、S5 读记录、待办升级是空串', () => {
  for (const l of STATUS_LINES) assert.ok(has(STATUS, l), l)
  assert.ok(has(STATUS, STATUS_IMPL), 'S5 读记录那一段')
  // 旧说法：照字面「前 12 位」只剩 5 位十六进制；「该阶段的执行角色」在 S5 报成 at-backend。
  for (const old of ['<contract_sha 的前 12 位>', '<sha 前 12 位>', '（<该阶段的执行角色>）']) assert.ok(!STATUS.includes(old), old)
})

test('M4g 第 41 条：at-status 引插件里的文件都带 ${CLAUDE_PLUGIN_ROOT}——裸的相对路径按会话工作目录解析，读不到', () => {
  assert.ok(STATUS.includes('`${CLAUDE_PLUGIN_ROOT}/hooks/lib/stages.mjs`'), 'stages.mjs 那一处')
  const bare = [...STATUS.matchAll(/`((?:hooks|agents|commands|templates|skills)\/[^`]+|stages\.json|roster\.json|stages\.README\.md)`/g)].map((m) => m[1])
  assert.deepEqual(bare, [], `还有裸路径：${bare.join('、')}`)
})

// M4g 复核（低-2）：重问时不要再追加一条（第 4 节第一句是「问之前先记：追加一条」）；门禁已经记下批准的那一条不用重问。
const RESUME_PENDING =
  '**问了没答的**（`escalations` 里有 `answer` 是空串的：上一个会话问了用户、还没等到答复）：先照 `${CLAUDE_PLUGIN_ROOT}/commands/at.md` ' +
  '第 4 节把那一问重新问一遍——不要再追加一条，答复补进那一条的 `answer`，再往下走。`budget-exhausted` 那一条、门禁已经记下了批准的' +
  '（`/agent-team:at-status` 的「返工批准」一行列得出），不用重问：把批准的那个规范标签补进 `answer`。'
test('M4g 第 41 条：at-resume 认得出问了没答的 escalation——重问时不再追加一条；门禁已记下批准的不用重问', () => {
  assert.ok(has(RESUME, RESUME_PENDING))
})
