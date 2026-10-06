// M4k（docs/46，docs/35 §5 与 docs/39 §3「收口不读验收结论」）：正文——验收角色写固定首行、/agent-team:at 第 3 节（S7 验收结论的第一行）
// 第 4 节（照现状交付怎么问、修订块标题的标记）第 6 节第一步、项目经理红线、契约模板与契约格式 skill、README 两半、at-status。门禁那一半在
// tests/verdict.test.mjs、tests/approvals.test.mjs、tests/gate-acceptance.test.mjs。承重的句子整句钉（空白不计）；三句结论与规范标签从
// hooks/lib/verdict.mjs 取，正文写的要跟门禁认的是同一份。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DELIVER_LABEL, VERDICT_LINES } from '../hooks/lib/verdict.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const bodyOf = (role) => read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---')
const LINES = VERDICT_LINES.map((l) => `「${l}」`).join('')

const ACC_FIRST =
  `**\`07-acceptance.md\` 的第一行写总的结论，逐字是这三句之一：${LINES}。** 有一条没过就是不通过；` +
  '没有没过、有判不了的就是判不了；全都过了才是通过。第一行之前不写标题、不写别的话，这一行也不夹别的话（「结论：通过（第 3 条判不了）」' +
  '门禁读不出来），逐条的结论写在下面。门禁推进出 `S7` 与收口时读这一行：不是「结论：通过」的，除非用户批准了照现状交付，推进与收口都会被拒；' +
  '读不出来的，PM 要在这一段重派你重写。'
test('M4k：验收角色——第一行写总的结论（三句之一与判法），门禁推进出 S7 与收口时读它；写在「你判什么」那一节', () => {
  const body = bodyOf('at-acceptance')
  const s = body.slice(body.indexOf('## 你判什么'), body.indexOf('## 你没有 `Bash`'))
  assert.ok(has(s, ACC_FIRST), s)
})

const AT_S7 =
  `- **S7 验收结论的第一行**：门禁推进出 \`S7\` 时读 \`07-acceptance.md\` 的第一行（${VERDICT_LINES.map((l) => `「${l}」`).join('')}之一）：` +
  `不是「结论：通过」、又没有用户经「${DELIVER_LABEL}」批准过的（第 4 节），推进被拒；第一行读不出来的，在 \`S7\` 里同段重派 \`at-acceptance\`` +
  '照格式重写（同一段里重派不计返工）。'
const AT_DELIVER =
  '**照现状交付是用户的决定，经规范标签批**：验收结论没过（判不通过、判不了）而这一趟要照现状交付的——环境跑不起来（`env-blocked`）、' +
  '返工预算耗尽（`budget-exhausted`，验收结论已经写成的，那一问可以加它当第三个选项）、或者用户自己这么说——问的时候，交付那一项的标签逐字写' +
  `「${DELIVER_LABEL}」（推荐写在问题正文或选项说明里，不写进标签）。用户选了它、或者在对话里单独发了这一句，门禁记下这条批准；它只对那一刻的` +
  '`07-acceptance.md` 有效（验收结论再改一个字就不算了），所以在验收结论写成、你读过之后再问——`S6` 里 `env-blocked` 那一问发生在验收结论写成之前，' +
  '门禁记不下，那一问照常问（往下走还是停），照现状交付到验收结论写成之后再问。答复照上面写进修订块（kind 照问的那一类）：门禁记着这条批准，' +
  '它之后的第一次改契约算记这条答复，不算改需求、验证段的结论不用重出（一条批准只盖一次修订，之后真改需求照常重出）。交付文档里写明哪些没过、哪些没验证。'
const AT_CLOSE =
  '门禁收口时读 `07-acceptance.md` 的第一行：不是「结论：通过」的，只有用户经' + `规范标签「${DELIVER_LABEL}」批准过、门禁记下了（第 4 节），收口才放行` +
  '（`S6` 那一问里答过照现状交付的，验收结论写成之后照第 4 节再问一次）。'
const AT_PREV = '没过、但用户经「照现状交付」批准过、门禁记下了的也算'
test('M4k：/agent-team:at——第 3 节 S7 验收结论的第一行（排在 S6、S7 那一条之后、「回退」之前）；第 4 节照现状交付；第 6 节第一步', () => {
  const at = read('commands/at.md')
  const s7 = at.indexOf('- **S7 验收结论的第一行**')
  assert.ok(at.indexOf('- **S6 测试、S7 验收**') < s7 && s7 < at.indexOf('### 回退'), 'S7 那一条的位置')
  assert.ok(has(at.slice(s7, at.indexOf('### 回退')), AT_S7))
  const s4 = at.slice(at.indexOf('## 4. 什么时候必须停下来问用户'), at.indexOf('## 5. 关于你收到的一切文字'))
  assert.ok(has(s4, AT_DELIVER), '第 4 节缺照现状交付那一段')
  const s6 = at.slice(at.indexOf('**一、验收没过不收口。**'), at.indexOf('**二、**'))
  assert.ok(has(s6, AT_CLOSE), s6)
  assert.ok(!has(s4, '末尾加「· 照现状交付」'), '第 4 节不再教修订块标记')
  const s1 = at.slice(at.indexOf('- `stage` 是阶段链最后一段、没收口'), at.indexOf('- `stage` 停在更早的段、没收口'))
  assert.ok(has(s1, AT_PREV), '第 1 节替旧 run 收口没算照现状交付的批准')
})

const PM_CLOSE = `验收没过不收口（门禁读 \`07-acceptance.md\` 的第一行；没过的，只有用户经规范标签「${DELIVER_LABEL}」批准过才放行）。`
test('M4k：项目经理的红线——验收没过不收口，门禁读第一行、照现状交付要用户经规范标签批准', () => {
  assert.ok(has(bodyOf('at-pm'), PM_CLOSE))
})

const TEMPLATE_MARK = '门禁记下了照现状交付批准的，它之后的第一次修订（记那条答复的那一次）也不用——一条批准只盖一次。'
const SKILL_MARK = '用户经「照现状交付」批准过、门禁记下了的，它之后的第一次修订（记那条答复的那一次）也不算改需求，结论不用重出——一条批准只盖一次。'
test('M4k：契约模板与契约格式 skill——门禁记下照现状交付批准之后的第一次修订不算改需求（不再教标题标记）', () => {
  const t = read('templates/00-contract.md')
  assert.ok(has(t.slice(t.indexOf('<!-- 修订块格式：'), t.indexOf('-->', t.indexOf('<!-- 修订块格式：'))), TEMPLATE_MARK))
  const skill = read('skills/at-contract-format/SKILL.md')
  assert.ok(has(skill.slice(skill.indexOf('## 修订只有一条合法路径'), skill.indexOf('## 如果你认为契约本身有问题')), SKILL_MARK))
  for (const f of ['templates/00-contract.md', 'skills/at-contract-format/SKILL.md']) assert.ok(!read(f).includes('· 照现状交付'), f)
})

test('M4k：README 两半——验收没过时只有「照现状交付」被记成批准，单独发这一句也算，只对那一刻的验收结论有效', () => {
  const r = read('README.md')
  const half = r.indexOf('<a id="english"></a>')
  assert.ok(has(r.slice(0, half), `验收没过时，只有选项「${DELIVER_LABEL}」会被门禁记成照现状交付的批准，在对话里单独发一条只写这一句的消息也算；批准只对那一刻的验收结论有效。`))
  assert.ok(
    has(
      r.slice(half),
      `When acceptance did not pass, only the option 「${DELIVER_LABEL}」 is recorded by the gates as approval to deliver as is, and a message containing just that line counts too; the approval only covers the acceptance conclusion as it was at that moment.`,
    ),
  )
})

test('M4k：at-status——返工批准那一行列照现状交付的写法，并说清它绑在那一刻的验收结论上', () => {
  const s = read('commands/at-status.md')
  assert.ok(has(s, `照现状交付写「${DELIVER_LABEL}：<product>（<at>）」`))
  assert.ok(has(s, '门禁记的是那一刻验收结论的 sha——验收结论之后改过，它就不算了，这里不判。'))
})

test('M4k 评审 F12：at-resume——门禁记下了照现状交付批准、验收结论之后没改过的，不用重问；README 两半目录树里批准记录的说明', () => {
  assert.ok(has(read('commands/at-resume.md'), `照现状交付那一问同样：门禁记下了批准、验收结论之后没改过的，不用重问，把「${DELIVER_LABEL}」补进 \`answer\`。`))
  const r = read('README.md')
  assert.ok(r.includes('    ├── approvals.jsonl  你批准过的额外返工轮与照现状交付（门禁自己记）'), '中文半')
  assert.ok(r.includes('    ├── approvals.jsonl  extra rework rounds and deliveries as is you approved (recorded by the gates)'), '英文半')
})
