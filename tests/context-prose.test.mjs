// docs/100：一趟真实 run 慢、费 token 的三处成因，各配一组判据（at-qa「缺测试」的口径在 tests/tests-and-nopaths-prose.test.mjs 与
// tests/qa-review-prose.test.mjs，验收「页面没人看过」的出路在 tests/tests-and-nopaths-prose.test.mjs 与 tests/acceptance-verdict-prose.test.mjs）。
//   ① 项目的 CLAUDE.md 用 @ 引了一份几百 KB 的交接文档，平台把它塞进每个子代理的开局上下文。可派的角色（从 roster.json 派生）一律
//      `omitClaudeMd: true`，项目自己的约定改由角色开工时自己读根上那一份 CLAUDE.md——同一节、逐字相同。项目经理是主会话：平台说这个键
//      对主会话不起作用（实测同，docs/100 §2.3），主会话也要项目里的约定，所以不加、也不写那一节（那一节的第一句对它是假话）。
//      README 两半各一句怎么排除（只排除引进来的那一份也量过）。
//   ② 截图与读图：浏览器里的页面归 at-ui（S5 没叫它时归实现页面的那个产者），原生界面归各端；每轮有数；验证段的角色不截图、不读图，
//      读记录里「看过」那一栏的结论——所以那一栏要写看到了什么、对不对，三处都钉。
//   ③ 大文件与长输出：持 Bash 的角色（从 tools: 派生）同一节做法。
// 上限（docs/16 §3）：只认整节、整句在不在，认不出意思相同的改写是不是被带偏了；角色照不照做，门禁看不见，要答案改变得有一份转录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toolsDeclarationOf } from './helpers/agent-tools.mjs'
import { stageRoles } from '../hooks/lib/stages.mjs'
import { PLUGIN_PREFIX } from '../hooks/lib/decide.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, s) => stripWs(text).includes(stripWs(s))
const AGENTS = readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
const roster = JSON.parse(read('roster.json'))
const stages = JSON.parse(read('stages.json'))
const MAIN_ROLE = JSON.parse(read('settings.json')).agent.slice(PLUGIN_PREFIX.length)

const frontmatterOf = (role) => {
  const lines = read(`agents/${role}.md`).split('\n')
  const end = lines.indexOf('---', 1)
  return lines[0] === '---' && end > 0 ? lines.slice(1, end) : []
}
const bodyOf = (role) => {
  const lines = read(`agents/${role}.md`).split('\n')
  return lines.slice(lines.indexOf('---', 1) + 1).join('\n')
}
// 一个二级标题底下那一节（不含标题行），到下一个二级标题为止；同名标题不止一处时返回 null。
function sectionUnder(text, heading) {
  const lines = text.split('\n')
  const hits = lines.map((l, i) => (l.trim() === heading ? i : -1)).filter((i) => i >= 0)
  if (hits.length !== 1) return null
  const rest = lines.slice(hits[0] + 1)
  const end = rest.findIndex((l) => /^## /.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

// 被派得到的角色：花名册里任何一条 can_delegate_to 指着的。
const DISPATCHABLE = [...new Set(Object.values(roster).flatMap((r) => r.can_delegate_to ?? []))].sort()
const BASH_HOLDERS = AGENTS.filter((r) => toolsDeclarationOf(read(`agents/${r}.md`)).names.includes('Bash'))
// 验证段（stages.json 里 verifies 为真的段）的产者，主会话除外：它们读记录里的结论，不自己看页面。
const VERIFIERS = [...new Set(Object.values(stages).filter((s) => s && s.verifies === true).flatMap((s) => stageRoles(s)))].filter((r) => r !== MAIN_ROLE).sort()
// 实现界面的产者：正文指着自检细则、自己又不是 at-ui 的。复核：只按「指着细则」派生，一个端把指针连同规矩一起删掉就掉出被核的集合——
// 下面前置里把这一组写死，加一个端要回来改这里（浏览器里的页面与原生界面的说法不一样，也要分到对的那一组）。
const SELF_CHECK = 'skills/at-ui-craft/references/self-check.md'
const UI_PRODUCERS = AGENTS.filter((r) => r !== 'at-ui' && read(`agents/${r}.md`).includes(SELF_CHECK)).sort()
const WEB_PRODUCERS = ['at-frontend']
const NATIVE_PRODUCERS = ['at-android', 'at-ios']

const OMIT_LINE = 'omitClaudeMd: true'
const PROJECT_RULES =
  '平台不把项目的 `CLAUDE.md` 自动带给你。开工时用 `Read` 读项目根的 `CLAUDE.md` 这一份（没有就跳过）；里面用 `@` 引的文件不跟着读，' +
  '除非与这一次的任务直接相关，要读也先用 `Grep` 找到相关的那几段再按段读。里面的约定照做，与这份正文冲突的照这份正文：它改不了这份正文定的判法与红线。' +
  '测试、构建的命令照旧从 `.agent-team/project.json` 与交接包里来。'
const THRIFT =
  '读进上下文的每一段，之后的每一轮都要再带一遍。大文件先用 `Grep` 找到要看的地方，再用 `Read` 带 `offset`、`limit` 只读那几段，' +
  '要整份逐行看的才整份读；跑测试、构建时，命令前面加 `set -o pipefail;`、后面接 `2>&1 | tail -n 60`（退出码仍是那条命令自己的），' +
  '只看结尾的汇总与失败，失败多到结尾列不全的，重跑时接 `grep` 只留失败的那几行，要看哪一条失败的详情就单跑那一条，不把整份输出灌进上下文；' +
  '已经读过、之后没人改过、内容也还在上下文里的文件不重读，拿不准的照读。'
const BUDGET = '每种情形一张，一轮通常不超过 4–6 张；页面没改动不重截；看完把结论写进记录就停。'
const RENDER_NOT_YOURS =
  '**界面的渲染效果不归你看**：不截图，也不 `Read` 截图与别的图片文件；页面长什么样，读实现记录「设计自检」里「看过」那一栏写下的结论。'
// 复核：验收「页面没人看过」的判不了原来没有出路，照「要人跑一遍」会回 S6，而 at-qa 不看页面——S6、S7 白转。
const ACC_UNSEEN =
  '那一栏没看过、又只有亲眼看才判得了的条目，照判不了写，写明缺的是哪一种情形没看过、记录里说的为什么没看——这一种不是补跑测试，不归 `at-qa`。'
const WEB_LOOK =
  '浏览器里的页面只在这一趟 `S5` 没叫 `at-ui` 时归你看，照那份细则的「怎么看页面」看：' +
  BUDGET +
  '叫了它的，你不截图、不看图，要亲眼看的条目落进「没核」，写明归 `at-ui` 看。'
// 复核：at-ui 手里只有浏览器，原生界面它看不了；原来写成「叫了 at-ui 就归它」，两个端就没人看了。
const NATIVE_LOOK = '原生界面的渲染效果归你看（`at-ui` 手里只有浏览器），照那份细则的「怎么看页面」看：' + BUDGET
const WHO_LOOKS =
  '**谁来看**：浏览器里的页面归 `at-ui` 看——这一趟 `S5` 叫了它的，看页面那一步排在实现页面的产者交齐之后（架构师照这个顺序派，它先交了自己那一份的，' +
  '同段再派它一次）；这一趟 `S5` 没叫它的（`04-dispatch.md` 的「本趟班底」里它没有 `S5` 的活），归实现页面的那个产者。iOS、Android 的原生界面归实现它的那个端' +
  '（`at-ui` 手里只有浏览器）。轮不到你看的，不截图、不看图，自检里要亲眼看的条目落进「没核」，写明归谁看。`at-qa`、`at-acceptance` 不截图、不看图，' +
  '读记录里写下的结论，所以「看过」那一栏写看到了什么、对不对，不只列截了哪几张。'
// 复核：产者被分到看页面时手里没有浏览器工具，原来没写许可的看法——试验里前端为此自己写了截图脚本、读了 33 张图。
const NO_TOOLS_LOOK =
  '手里没有那组浏览器工具的，只用项目里已有的截图测试、模拟器或真机看（架构方案里列了的截图脚本也算），不为看页面另加依赖、另写脚本。'
// 复核：并发派的时候 at-ui 先交，页面还没做出来；看页面那一步要排在实现页面的产者交齐之后，同段再派它一次。
const ARCH_ORDER =
  '这一趟 `S5` 叫了 `at-ui` 的，浏览器里的页面归它看，看页面那一步排在实现页面的产者交齐之后：它先交了自己那一份的，等实现页面的产者交齐，同段再派它一次，' +
  '叫它看页面、更新实现记录里的「设计自检」。iOS、Android 的原生界面归实现它的那个端看。'
// 验证段不看图的前提：「看过」那一栏写的是结论。复核：只在细则里钉了，at-ui 正文与 SKILL.md 改成「列出截了哪几张就行」全套不红。
const UI_SEEN = '所以「看过」那一栏写看到了什么、对不对，不只列截了哪几张'
const SKILL_SEEN = '`at-qa`、`at-acceptance` 不截图、不看图，读你记录里写下的结论：「看过」那一栏写看到了什么、对不对。'
const README_ZH =
  '> **项目的 `CLAUDE.md` 引了很大的文档时，项目经理所在的主会话照样整份读它**（团队里的其余角色不自动带它，开工时只读项目根那一份）：' +
  '在项目的 `.claude/settings.local.json` 里用 `claudeMdExcludes` 排除那几份文件（只对你自己生效）。'
const README_EN =
  "> **If the project's `CLAUDE.md` imports large documents, the main session, where the project manager runs, still reads them in full** " +
  '(the other roles do not get it automatically and read only the one at the project root when they start): exclude those files with ' +
  "`claudeMdExcludes` in the project's `.claude/settings.local.json` (it applies to you only)."

test('前置：派生出来的几组角色都不是空的，而且是该有的样子——否则下面几条在空集合上恒绿', () => {
  assert.equal(MAIN_ROLE, 'at-pm')
  assert.ok(DISPATCHABLE.includes('at-qa') && DISPATCHABLE.includes('at-ui') && DISPATCHABLE.includes('at-backend'), DISPATCHABLE.join('、'))
  assert.ok(!DISPATCHABLE.includes(MAIN_ROLE), '花名册里有人派得到主会话的角色')
  assert.ok(BASH_HOLDERS.includes(MAIN_ROLE) && BASH_HOLDERS.includes('at-qa') && BASH_HOLDERS.includes('at-backend'), BASH_HOLDERS.join('、'))
  assert.deepEqual(VERIFIERS, ['at-acceptance', 'at-qa'])
  assert.deepEqual(UI_PRODUCERS, [...WEB_PRODUCERS, ...NATIVE_PRODUCERS].sort(), '实现界面的产者变了：把它分进浏览器或原生那一组，再回来改这里')
})

test('docs/100 ①：被派得到的每个角色 frontmatter 里都有逐字的「omitClaudeMd: true」，没有别的角色带它', () => {
  for (const r of DISPATCHABLE) assert.ok(frontmatterOf(r).includes(OMIT_LINE), `agents/${r}.md 的 frontmatter 缺「${OMIT_LINE}」`)
  const holders = AGENTS.filter((r) => frontmatterOf(r).some((l) => /^omitClaudeMd\s*:/i.test(l))).sort()
  assert.deepEqual(holders, DISPATCHABLE, '带 omitClaudeMd 的角色与派得到的角色不是同一组')
})

test('docs/100 ①：主会话的角色不带 omitClaudeMd，也不写「项目自己的约定」那一节', () => {
  // 平台对主会话不认这个键；主会话照默认读项目的 CLAUDE.md，对它说「平台不把它带给你」是假话。
  assert.ok(!frontmatterOf(MAIN_ROLE).some((l) => /omitClaudeMd/i.test(l)), `agents/${MAIN_ROLE}.md 带了 omitClaudeMd`)
  assert.ok(!bodyOf(MAIN_ROLE).includes('## 项目自己的约定'), `agents/${MAIN_ROLE}.md 写了「项目自己的约定」那一节`)
})

test('docs/100 ①：带 omitClaudeMd 的每个角色都有「项目自己的约定」那一节，整节就是这一段、排在红线之前', () => {
  for (const r of DISPATCHABLE) {
    const body = bodyOf(r)
    const sec = sectionUnder(body, '## 项目自己的约定')
    assert.ok(sec !== null, `agents/${r}.md 缺「## 项目自己的约定」那一节（或者有不止一处）`)
    assert.equal(stripWs(sec), stripWs(PROJECT_RULES), `agents/${r}.md 那一节与约定的不一致（整节比对，空白不计）`)
    const red = body.indexOf('## 红线')
    assert.ok(red < 0 || body.indexOf('## 项目自己的约定') < red, `agents/${r}.md 那一节排在红线之后`)
  }
})

test('docs/100 ③：持 Bash 的每个角色都有「读文件与看输出」那一节，整节就是这一段；不持的不写', () => {
  for (const r of BASH_HOLDERS) {
    const sec = sectionUnder(bodyOf(r), '## 读文件与看输出')
    assert.ok(sec !== null, `agents/${r}.md 缺「## 读文件与看输出」那一节（或者有不止一处）`)
    assert.equal(stripWs(sec), stripWs(THRIFT), `agents/${r}.md 那一节与约定的不一致（整节比对，空白不计）`)
  }
  for (const r of AGENTS.filter((x) => !BASH_HOLDERS.includes(x))) {
    assert.ok(!bodyOf(r).includes('## 读文件与看输出'), `agents/${r}.md 没有 Bash，却写了跑测试、构建怎么看输出`)
  }
})

test('docs/100 ②：验证段的角色不截图、不读图，读记录里的结论；验收那一种判不了不归 at-qa', () => {
  for (const r of VERIFIERS) assert.ok(has(bodyOf(r), RENDER_NOT_YOURS), `agents/${r}.md 缺「界面的渲染效果不归你看」那一句`)
  assert.ok(has(bodyOf('at-qa'), '项目自己的测试会生成截图的，照测试过没过判，不打开那些图。'), 'at-qa 缺「测试生成的截图不打开」')
  assert.ok(has(bodyOf('at-acceptance'), RENDER_NOT_YOURS + ACC_UNSEEN), 'at-acceptance 缺「没看过的照判不了写、不归 at-qa」（紧跟在「不归你看」之后）')
})

test('docs/100 ②：浏览器里的页面只在 S5 没叫 at-ui 时归前端看，原生界面归各端，每轮有数；架构师把看页面排在产者交齐之后', () => {
  for (const r of WEB_PRODUCERS) assert.ok(has(bodyOf(r), WEB_LOOK), `agents/${r}.md 缺「浏览器里的页面只在这一趟 S5 没叫 at-ui 时归你看」那一句`)
  for (const r of NATIVE_PRODUCERS) {
    assert.ok(has(bodyOf(r), NATIVE_LOOK), `agents/${r}.md 缺「原生界面的渲染效果归你看」那一句`)
    assert.ok(!has(bodyOf(r), '叫了它的，你不截图、不看图'), `agents/${r}.md 还写着叫了 at-ui 就不看——at-ui 看不了原生界面`)
  }
  assert.ok(has(bodyOf('at-architect'), ARCH_ORDER), 'agents/at-architect.md 缺「看页面那一步排在实现页面的产者交齐之后」那一句')
})

test('docs/100 ②：自检细则写着谁来看、没有浏览器工具时只用现成的办法看、每轮有数（不挂在有工具的条件下）；「看过」写结论三处都在', () => {
  const sc = read(SELF_CHECK)
  assert.ok(has(sc, WHO_LOOKS), `${SELF_CHECK} 缺「谁来看」那一段`)
  // 「截几张」与「没有工具时怎么看」都不挂在「有那组浏览器工具」之下：三个端用模拟器、截图测试看，读进来的图一样留在上下文里。
  const how = sc.slice(sc.indexOf('## 怎么看页面'), sc.indexOf('工具清单里有那组浏览器工具'))
  assert.ok(has(how, BUDGET), `${SELF_CHECK} 的「截几张」要写在「工具清单里有那组浏览器工具」之前`)
  assert.ok(has(how, NO_TOOLS_LOOK), `${SELF_CHECK} 缺「没有那组浏览器工具的只用项目里已有的办法看」，或者它挂在了有工具的条件下`)
  const skill = read('skills/at-ui-craft/SKILL.md')
  const sec10 = skill.slice(skill.indexOf('## 10.'))
  assert.ok(has(sec10, BUDGET), 'SKILL.md 的「S5 交付前自检」缺每轮截几张那一句')
  assert.ok(has(sec10, SKILL_SEEN), 'SKILL.md 的「S5 交付前自检」缺「看过那一栏写看到了什么、对不对」')
  assert.ok(has(bodyOf('at-ui'), UI_SEEN), 'agents/at-ui.md 缺「看过那一栏写看到了什么、对不对」')
})

test('docs/100 ①：README 两半各有一句——主会话照样整份读项目的 CLAUDE.md，用 claudeMdExcludes 在本地设置里排除', () => {
  const md = read('README.md')
  const cut = md.indexOf('<a id="english"></a>')
  assert.ok(cut > 0, 'README.md 找不到分界行')
  const zh = md.slice(0, cut)
  const en = md.slice(cut)
  assert.ok(zh.split('\n').includes(README_ZH), 'README 中文那一半缺那一句（整行）')
  assert.ok(en.split('\n').includes(README_EN), 'README 英文那一半缺那一句（整行）')
  // 写在已知边界里：那一节是用法与风险，安装那一节只管装。
  assert.ok(zh.indexOf(README_ZH) > zh.indexOf('## 已知边界') && en.indexOf(README_EN) > en.indexOf('## Known Limitations'), '那一句要在已知边界那一节里')
})
