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
  '读不出来的，你停下时门禁就拦回来，叫你把这一行改好再停。'
test('M4k：验收角色——第一行写总的结论（三句之一与判法），门禁推进出 S7 与收口时读它；写在「你判什么」那一节', () => {
  const body = bodyOf('at-acceptance')
  const s = body.slice(body.indexOf('## 你判什么'), body.indexOf('## 你没有 `Bash`'))
  assert.ok(has(s, ACC_FIRST), s)
})

const AT_S7 =
  `- **S7 验收结论的第一行**：门禁推进出 \`S7\` 时读 \`07-acceptance.md\` 的第一行（${VERDICT_LINES.map((l) => `「${l}」`).join('')}之一）：` +
  `不是「结论：通过」、又没有用户经「${DELIVER_LABEL}」批准过的（第 4 节），推进被拒；第一行读不出来的，在 \`S7\` 里同段重派 \`at-acceptance\`` +
  '照格式重写（同一段里重派不计返工）。'
// docs/66 §8：照现状交付也盖测试报告——停在 S6 时绑在测试报告上。
const AT_DELIVER =
  '**照现状交付是用户的决定，经规范标签批**：测试报告判不通过、或者验收结论没过（判不通过、判不了）而这一趟要照现状交付的——项目里本来就挂着的用例、' +
  '不稳定的用例、环境跑不起来（`env-blocked`）、返工预算耗尽（`budget-exhausted`，结论已经写成的，那一问可以加它当第三个选项）、或者用户自己这么说——' +
  `问的时候，交付那一项的标签逐字写「${DELIVER_LABEL}」（推荐写在问题正文或选项说明里，不写进标签）。用户选了它、或者在对话里单独发了这一句，门禁记下这条` +
  // docs/71：验收那一段整段裁掉之后，批准也绑在测试报告上（收口读它，跑不起来也要批准）。
  '批准：停在 `S6` 时、或者验收那一段整段裁掉之后，它绑在那一刻的 `06-test.md` 上，别的时候绑在那一刻的 `07-acceptance.md` 上（那份结论再改一个字就' +
  '不算了），所以在那份结论写成、你读过之后再问。`06-test.md` 写「结论：跑不起来」的推进出 `S6` 不用批准：`S6` 里 `env-blocked` 那一问照常问（往下走' +
  '还是停），照现状交付到验收结论写成之后再问；验收那一段整段裁掉的，收口时跑不起来也要批准。答复照上面写进修订块（kind 照问的那一类）：门禁记着' +
  '这条批准，它之后的第一次改契约算记这条答复（测试报告那一条只在停在 `S6`、或者验收整段裁掉之后算），' +
  '不算改需求、验证段的结论不用重出（一份结论只批一次、只盖一次修订；之后再往这一块里补写不算修订，改别处、加新块照常算）。交付文档里写明哪些没过、' +
  '哪些没验证。'
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

test('M4k：README 两半——测试或验收没过时只有「照现状交付」被记成批准，单独发这一句也算，只对那一刻的测试报告或验收结论有效（docs/66）', () => {
  const r = read('README.md')
  const half = r.indexOf('<a id="english"></a>')
  assert.ok(has(r.slice(0, half), `测试或验收没过时，只有选项「${DELIVER_LABEL}」会被门禁记成照现状交付的批准，在对话里单独发一条只写这一句的消息也算；批准只对那一刻的测试报告或验收结论有效。`))
  assert.ok(
    has(
      r.slice(half),
      `When tests or acceptance did not pass, only the option 「${DELIVER_LABEL}」 is recorded by the gates as approval to deliver as is, and a message containing just that line counts too; the approval only covers the test report or acceptance conclusion as it was at that moment.`,
    ),
  )
})

test('M4k：at-status——返工批准那一行列照现状交付的写法，并说清它绑在那一刻的验收结论上', () => {
  const s = read('commands/at-status.md')
  assert.ok(has(s, `照现状交付写「${DELIVER_LABEL}：<product>（<at>）」`))
  assert.ok(has(s, '门禁记的是那一刻那份结论的 sha（`product` 写着是测试报告还是验收结论）——那份结论之后改过，它就不算了，这里不判。'))
})

test('M4k 评审 F12：at-resume——门禁记下了照现状交付批准、验收结论之后没改过的，不用重问；README 两半目录树里批准记录的说明', () => {
  assert.ok(
    has(
      read('commands/at-resume.md'),
      `照现状交付那一问同样：门禁记下了批准的不用重问，把「${DELIVER_LABEL}」补进 \`answer\`——批准绑着那一刻的那份结论（测试报告或验收结论），之后它改过的，推进或收口时门禁会拒，照它的出路重问。`,
    ),
  )
  const r = read('README.md')
  assert.ok(r.includes('    ├── approvals.jsonl  你批准过的额外返工轮与照现状交付（门禁自己记）'), '中文半')
  assert.ok(r.includes('    ├── approvals.jsonl  extra rework rounds and deliveries as is you approved (recorded by the gates)'), '英文半')
})

// 复核（低 5）：boot.mjs 加载失败、Node 太旧时给记录器的那两句——说它是批准记录器，返工与照现状交付都要再批一次。
test('M4k 复核：boot.mjs 给记录器的那两句跟上照现状交付', () => {
  const boot = read('hooks/boot.mjs')
  assert.ok(!boot.includes('返工批准的记录器不拦任何东西'), 'boot.mjs 还写着返工批准的记录器')
  assert.equal(boot.split('（批准记录器不拦任何东西）').length - 1, 2)
  assert.equal(boot.split('用户若是在批准再返工一轮或照现状交付').length - 1, 2)
})

// docs/68：验收那一侧也只认用户自己的话（docs/67 §4「验收那一侧没收」）。真实会话 M16 里项目经理把「挂着的不算」写进契约第 2 节、叫产品经理写进产品定义，
// 验收照着认；M16b 的验收逐条写了「部分过」。逐条的结论只有三种；挂着的用例与 at-qa 用同一句（整段钉）；「挂着」「部分过」只许出现在钉住的那几处。
const KNOWN_FAIL =
  '只有契约第 1 节用户原话或第 4 节修订记录里用户说了不算的那几条挂着的用例，不因它们判不通过；派发提示里的判定口径、契约第 2 节与第 3 节、' +
  '产品定义、架构方案说它们不算的，都不算数。第 4 节只认修订块里用户的原话或裁决——「对契约的影响」是项目经理写的，不算；用户答复「照现状交付」的' +
  '那几块也不算，那条批准只管批准那一刻的那份结论。'
const ACC_KNOWN =
  '**这一趟之前就挂着的用例，也只认用户自己的话。** 契约或完成定义要求测试都过、而有这一趟之前就挂着的用例没过的（哪些是这一趟之前就挂着的，' +
  '照 `06-test.md` 里 `at-qa` 的逐条注明认）：' +
  KNOWN_FAIL +
  '把测试的范围收窄到不含它们，也是说它们不算。用户没说的，那一条照没过判，要不要带着它们交付由项目经理问用户；不因它们判不通过的，逐条注明它们挂着、引用户那一句。'
const ACC_THREE = '逐条给结论：过、没过、判不了，每一条都指出依据的是契约的哪一句。没有第四种：一条里有一部分没过就是没过，不写「部分过」。'
test('docs/68：验收角色——逐条只有三种结论（不写「部分过」）；挂着的用例只认用户自己的话，与 at-qa 同一句，整段钉', () => {
  const raw = readFileSync(new URL('../agents/at-acceptance.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
  const body = bodyOf('at-acceptance')
  // 复核（docs/68 §8）：切到「你判什么」之后的下一个二级标题（中间插一个标题把那一段挪出去也红）。
  const from0 = body.indexOf('## 你判什么')
  const next0 = body.indexOf('\n## ', from0 + 1)
  const s = body.slice(from0, next0 < 0 ? body.length : next0)
  assert.ok(has(s, ACC_THREE), '「你判什么」那一节：逐条只有三种')
  const start = '**这一趟之前就挂着的用例，也只认用户自己的话。**'
  assert.equal(raw.split(start).length - 1, 1, start)
  const from = raw.indexOf(start)
  const m = /\n\s*\n/.exec(raw.slice(from))
  const to = from + (m ? m.index : raw.length - from)
  assert.equal(stripWs(raw.slice(from, to)), stripWs(ACC_KNOWN), 'agents/at-acceptance.md 挂着的用例那一段变了')
  assert.ok(s.includes(start), '那一段写在「你判什么」那一节里')
  // 反向：「挂着」只在那一段里；「部分过」只出现在「不写『部分过』」那一句里；「判定口径」只出现一次。
  for (let i = raw.indexOf('挂着'); i >= 0; i = raw.indexOf('挂着', i + 1)) assert.ok(i >= from && i < to, `在那一段之外提了挂着的用例：${raw.slice(i - 30, i + 30)}`)
  assert.equal(raw.split('部分过').length - 1, 1, '「部分过」只许出现在不写它的那一句里')
  assert.equal(raw.split('判定口径').length - 1, 1, '「判定口径」只许出现在那一段里')
})

// 复核（docs/68 §8）：在钉住的那几处之外用同义说法放宽（「原本就失败的测试不计」「开工之前就失败的」「已有失败」「既有失败」），「挂着」的反向判据
// 认不出——这几种说法在三份正文里一律不许出现（钉住的那几处也不用它们）。同义词列不全，没列到的登在 docs/68 §4。
test('docs/68 §8：挂着的用例的几种同义说法，at-qa、at-acceptance、/agent-team:at 里都不出现；「以后都不算」只在 /agent-team:at 的 S6 那一条里', () => {
  for (const p of ['agents/at-qa.md', 'agents/at-acceptance.md', 'commands/at.md']) {
    const t = read(p)
    for (const w of ['原本就失败', '之前就失败', '已有失败', '既有失败', '原本就挂着', '原来就挂着']) assert.ok(!t.includes(w), `${p} 里出现了「${w}」`)
  }
  const at = read('commands/at.md')
  const from = at.indexOf('- **S6 测试报告的第一行**')
  const m = /\n(?=- |\s*\n)/.exec(at.slice(from + 1))
  const to = from + 1 + (m ? m.index : at.length)
  assert.ok(from >= 0)
  for (let i = at.indexOf('以后都不算'); i >= 0; i = at.indexOf('以后都不算', i + 1)) assert.ok(i > from && i < to, `「以后都不算」出现在 S6 那一条之外：${at.slice(i - 30, i + 30)}`)
  for (const p of ['agents/at-qa.md', 'agents/at-acceptance.md']) assert.ok(!read(p).includes('以后都不算'), p)
})

// docs/70：真实会话 M17 里验收把契约第 1 节的「走到收口」列成一条、写「流程项……不在业务验收范围」——三种结论之外的第四种。管流程的话不是做出来的东西，
// 归项目经理照着走，不列进逐条。写在「你判什么」那一节、紧跟在「逐条只有三种」那一句后面。
// 复核（docs/70 §8）：范围是契约与产品定义（第 4 节修订块里也常有「走到收口」）；不静默——在逐条之后单列一行、引原话（认错了看得见）。
const ACC_PROCESS =
  '契约与产品定义里管流程的话（走到哪一段停、要不要收口、先别派谁）不是做出来的东西，归项目经理照着走，不列进逐条；' +
  '在逐条之后单列一行「没判的（管流程的话）：」，引那几句原话。'
test('docs/70：验收角色——契约第 1 节里管流程的话不列进逐条，紧跟在「逐条只有三种」那一句后面', () => {
  const body = bodyOf('at-acceptance')
  const from0 = body.indexOf('## 你判什么')
  const next0 = body.indexOf('\n## ', from0 + 1)
  const s = body.slice(from0, next0 < 0 ? body.length : next0)
  assert.ok(has(s, ACC_THREE + ACC_PROCESS), '「你判什么」那一节：管流程的话那一句不在、或者没紧跟在「逐条只有三种」后面')
  // 复核（docs/70 §8）：「流程」只许出现在那一句里；M17 写过的几种说法（「不在业务验收范围」「不在范围」「流程项」）整份里不许出现。
  const flat = stripWs(read('agents/at-acceptance.md'))
  const at = flat.indexOf(stripWs(ACC_PROCESS))
  for (let i = flat.indexOf('流程'); i >= 0; i = flat.indexOf('流程', i + 1)) assert.ok(i >= at && i < at + stripWs(ACC_PROCESS).length, `「流程」出现在那一句之外：${flat.slice(i - 20, i + 20)}`)
  for (const w of ['不在业务验收范围', '不在范围', '流程项']) assert.ok(!flat.includes(w), `出现了「${w}」`)
})

// 复核（docs/70 §8）：项目经理那一侧——/agent-team:at 第 3 节开头写明管流程的话由它照着走、停下等用户不算打断；第 1 节替上一趟收口之前看契约有没有说先别收口；
// at-pm 的「什么时候打断用户」那一节点到它。括号里的例子与验收那一句同一份。
const PM_FLOW =
  '**契约与产品定义里管流程的话（走到哪一段停、要不要收口、先别派谁）由你照着走**：走到用户说的那一段就停下，告诉用户现在停在哪、怎么接着走' +
  '（`/agent-team:at-resume`）；用户说先别派谁的，停在派它之前，等用户下一句；用户说先别收口的，不收口。停下等用户不算打断用户。验收不判这些话。'
test('docs/70 §8：项目经理那一侧——第 3 节开头照着走管流程的话；第 1 节替上一趟收口看先别收口；at-pm 的打断用户那一节点到它', () => {
  const at = read('commands/at.md')
  const s3 = at.slice(at.indexOf('## 3. 逐段推进'), at.indexOf('## 4.'))
  assert.ok(stripWs(s3).startsWith(stripWs('## 3. 逐段推进' + PM_FLOW)), '第 3 节开头那一段')
  const s1 = at.slice(at.indexOf('## 1. 建 run'), at.indexOf('## 2.'))
  assert.ok(has(s1, '交付文档也在、那一趟的契约里没说先别收口：照第 6 节第二、四步'), '第 1 节替上一趟收口的条件')
  assert.ok(has(s1, '验收没过或判不了、交付文档不在、契约里说了先别收口、收口被 H6 拒——都是收不了口'), '第 1 节收不了口的几种')
  const pm = bodyOf('at-pm')
  const sec = pm.slice(pm.indexOf('## 什么时候打断用户'))
  assert.ok(has(sec.slice(0, sec.indexOf('\n## ', 1) < 0 ? sec.length : sec.indexOf('\n## ', 1)), '契约里管流程的话（走到哪一段停、要不要收口、先别派谁）照着停下等用户，不算打断用户（`/agent-team:at` 第 3 节开头）。'), 'at-pm 打断用户那一节')
})
