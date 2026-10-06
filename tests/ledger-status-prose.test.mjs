// M4g（docs/42）：docs/39 §5 第三轮前一半「账」的正文——第 28 条（产物的 sha 怎么记、reach.json 写完门禁会核）、第 41 条（at-status 几处
// 报错了的、问用户之前先记 escalation）、第 37 条后半（用户主动改需求怎么记）、产者交代与「叫到」的口径。门禁那一半在
// tests/artifact-drift.test.mjs、tests/gate-deliverable.test.mjs、tests/ledger.test.mjs、tests/gate-ledger-project.test.mjs、
// tests/coverage.test.mjs、tests/gate-ledger.test.mjs。承重的句子整句钉（空白不计）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const AT = read('commands/at.md')
const STATUS = read('commands/at-status.md')
const INIT = read('commands/at-init.md')

// 第 4 节（问用户）从标题到下一个二级标题。
const section4 = AT.slice(AT.indexOf('## 4. 什么时候必须停下来问用户'), AT.indexOf('\n## 5.'))

// ---- 第 28 条 ----

const AT_PRODUCE =
  '产物的 sha256 记进 `state.json` 的 `artifacts`（键是产物名，值是那个哈希）：你自己写的，写完会收到一条【产物】回传，里面就有它；' +
  '下级写的，【产物】回传发给写它的那个角色，它在回报里把值报上来。**原样写进去，不要自己算、不要自己拼**——门禁先剥 BOM、' +
  '把 CRLF 折成 LF 再算，自己算的会对不上。回报里没带的，之后派发返回时的【账本比对】会报它「没记」、带着门禁算出来的值：照那一条的收尾记。'

test('M4g 第 28 条：/agent-team:at 不再说「写完一段产物你会收到【产物】」——下级写的回传发给写它的人；值照抄，不自己算', () => {
  assert.ok(has(AT, AT_PRODUCE), 'commands/at.md 第 3 节记 artifacts 那一句变了')
  assert.ok(!AT.includes('写完一段产物之后，你会收到一条【产物】回传'), '旧说法还在：对下级写的产物不成立')
})

const INIT_REACH = '写完之后门禁会按当前 `project.json` 与花名册重算核一遍：回传里没有【触达表】就是对上了；有的话，照它给的那一份原样重写。'
test('M4g 第 28 条：at-init 写完 reach.json——门禁会重算核对，对不上照回传给的重写', () => {
  assert.ok(has(INIT, INIT_REACH))
})

// ---- 产者交代与「叫到」的口径（docs/11 §5.24 说它配机械判据、至今没写）----

const AT_CALLED = '`roster` 记的是**这一趟真正干过活的每一个角色，包括你的下级派出去的那些**——**不是「你亲手派的那些」**。'
const AT_CALLED_EXAMPLE = '举例：S2 的 `at-ui` 由 `at-product` 派（你自己派不动它，花名册里没有你到它的那条边），**它照样要进 `roster`**。'
const AT_LOGGED = '门禁记着每一次派发：推进之后，派发记录里有、`stage_roles` 里没记的，产者交代那条回传会单列成「漏记」——照它补记，不用重派。'
test('M4g：第 4 条「叫到」含下级派出去的那些，at-ui 那个例子在；不再说「今天没有任何判据钉着这一句」；派发记录里有的会单列成漏记', () => {
  const step4 = AT.slice(AT.indexOf('4. 把这一段真正叫到的角色累加进 `roster`'), AT.indexOf('**`never_invoked` 不要在这里逐段累加**'))
  assert.ok(step4.length > 0, 'commands/at.md 第 3 节第 4 条找不到')
  for (const s of [AT_CALLED, AT_CALLED_EXAMPLE, AT_LOGGED]) assert.ok(has(step4, s), s)
  assert.ok(!AT.includes('今天没有任何判据钉着这一句'), '那一句现在是假话：这条判据钉着它')
})

// ---- 第 41 条与「问之前先记」----

const AT_ASK_FIRST =
  '**问之前先记**：往 `state.json` 的 `escalations` 追加一条 `{ stage, kind, question, answer, at }`，`kind` 用上表里的取值，' +
  '`answer` 先写空串——会话断在等答复的时候，续跑与 `/agent-team:at-status`（「待办升级」）靠它看得见这一问还没答。'
const AT_AFTER = '1. 把那一条的 `answer` 补成用户的答复（用户原话）；问之前没记的，照上面补一条完整的。'
test('M4g 第 41 条：/agent-team:at 第 4 节——问之前先记一条 answer 为空串的 escalation，答复之后补上', () => {
  assert.ok(has(section4, AT_ASK_FIRST), '第 4 节缺「问之前先记」')
  assert.ok(has(section4, AT_AFTER), '第 4 节「答复之后」第 1 件事变了')
  assert.ok(section4.indexOf('**问之前先记**') < section4.indexOf('用户答复之后**两件事都要做**'), '「问之前先记」要排在「答复之后」之前')
  assert.ok(has(section4, '再把那次被拒的写入连同这条 escalation（问之前记的那一条，`answer` 补上）与新的 `contract_sha` 一起重写'))
})

const AT_USER_CHANGE =
  '**用户主动改需求**（不是你问出来的答复，是用户在对话里自己提出要改、要加的事）：不是升级，`escalations` 不记；照样把它作为一个带日期' +
  '的修订块追加进「修订记录」，标「用户主动提出」，把写契约那一次回传给的新值记进 `contract_sha`。改动要回到更早一段重做的，照第 3 节' +
  '「回退」记；已经收口的，照第 6 节另起一趟。'
test('M4g 第 37 条后半：用户主动改需求不是升级——修订块标「用户主动提出」、记新 contract_sha，要重做的照回退', () => {
  assert.ok(has(section4, AT_USER_CHANGE))
})

const STATUS_LINES = [
  '当前阶段:    <stage>（<这一段谁在干：stages.json 里那一段有 producers 的，列 stage_roles 里这一段记着的人，还没记账写「本段未记账」；其余写那一段的 role>）',
  '契约:        <contract_sha 里 `sha256:` 之后的前 12 位；是 PENDING 就写 PENDING>，磁盘上<在/不在>',
  '产物:        逐阶段列，每个后面标 ✓ / ✗（按磁盘）；当前段之后、还没走到的段整段写「未到」，不标 ✗',
  '返工基线:    <rework_base 逐条「<产物>：<sha256: 之后的前 12 位> 或 accepted」；没有这个字段或为空就写「无」>',
  '待办升级:    <escalations 里 answer 是空串的（问了、用户还没答）；没有就写「无」>',
]
const STATUS_IMPL =
  '`S5` 的实现记录在磁盘上不等于交齐：逐份读，有「被写路径隔离拒绝」一节、里面还有没标「已解决」的条目的，只写了冒泡原因、没写做了什么的，' +
  '或者「测试」一节缺了、有新行为没有测试又不属于那两种情形的（做法见 `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 3 节 `S5` 那一条），' +
  '标「未交齐」并写一句原因，不标 ✓。'
test('M4g 第 41 条：at-status 的报法——当前阶段报这一段谁在干、sha 取 sha256: 之后的 12 位、没走到的段写「未到」、S5 读记录、待办升级是空串', () => {
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

const RESUME_PENDING =
  '**问了没答的**（`escalations` 里有 `answer` 是空串的：上一个会话问了用户、还没等到答复）：先照 `${CLAUDE_PLUGIN_ROOT}/commands/at.md` ' +
  '第 4 节把那一问重新问一遍，答复补进那一条的 `answer`，再往下走。'
test('M4g 第 41 条：at-resume 认得出问了没答的 escalation——先重问、答复补进那一条', () => {
  assert.ok(has(read('commands/at-resume.md'), RESUME_PENDING))
})
