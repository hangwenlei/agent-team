// 需求稿（docs/95）的正文这一层：/agent-team:at 第 1 节「先把需求问清楚」（建 run 之前；什么时候做、问什么不问什么、需求稿的样子、怎么问批准）、
// 第 2 节第 1 节照抄需求稿与门禁记下它、第 6 节另起一趟；项目经理的角色正文、续跑、契约格式与模板各一句；README 两半一段；门禁出错时的那一段点名这个标签。
// 规范标签只从 user-words.mjs 的 BRIEF_LABEL 取：正文写的与门禁认的不是同一个字，就是用户点了、门禁不记。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIEF_LABEL } from '../hooks/lib/user-words.mjs'
import { numberedHeading } from '../hooks/lib/contract-base.mjs'
import { crashContext } from '../hooks/lib/fail-open.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const squash = (s) => s.replace(/\s+/g, '')
const has = (text, k) => squash(text).includes(squash(k))

const at = read('commands/at.md')
const section = (from, to) => at.slice(at.indexOf(from), at.indexOf(to))

test('/agent-team:at 第 1 节：「先把需求问清楚」在上一趟那一问之后、建 run 之前', () => {
  const s1 = section('## 1. 建 run', '## 2.')
  const i = s1.indexOf('**先把需求问清楚**')
  assert.ok(i > s1.indexOf('先看 `.agent-team/current-run` 指着的那一趟') && i < s1.indexOf('- run id：'), '位置不对')
  const block = s1.slice(i, s1.indexOf('- run id：'))
  for (const k of [
    '**先把需求问清楚**（建 run 之前做；上面那一问里用户选了续跑的，不做）',
    '命令没带参数的，先问用户这次要做什么，再照这一段问清',
    '先用 `AskUserQuestion` 单选问一次「先把需求问清楚」还是「照原话直接开始」，题面列出没说清的那几处',
    '话已经够清楚的、用户选了照原话直接开始的，不做这一段，契约第 1 节照抄原话',
    '问不了用户（工具面里没有 `AskUserQuestion`）也不做：命令带了参数的照抄原话；没带的，停下，请用户把需求写在 `/agent-team:at` 后面重发',
    '代码里答得出的不问。这时还没有 run，不往 `.agent-team/` 下写任何东西',
    '这几问发生在建 run 之前：不记 escalation、不动契约，也不受第 4 节「禁止开放式提问」的限制',
    '架构、模块怎么拆、文件怎么放、技术选型，用户没有要求的不问——那是后面各段的事',
    '需求稿里只写用户说过或认可过的：你自己的推断，要么问过用户，要么不写；「不要自动化测试」「本来就没过的测试不算」这类话，只有用户自己这么说过才写',
    '题面就是整份需求稿，逐字，不夹别的话；这一次只问这一道题',
    `两个选项，标签逐字写「${BRIEF_LABEL}」与「再改改」（推荐不写进标签）`,
    `用户选了「${BRIEF_LABEL}」，门禁记下这份需求稿、回传【需求稿】：照本节往下建 run，契约第 1 节逐字照抄这份需求稿（第 2 节）`,
    '回传说没有记成、没有记下的，照它说的办，不要往下建 run',
    `用户在对话里单独发「${BRIEF_LABEL}」不算——门禁不知道批的是哪一份——再用这道题问一次`,
  ]) assert.ok(has(block, k), `缺「${k}」`)
})

test('/agent-team:at 第 1 节：需求稿的样子里没有编号节标题（契约按它认自己的节），列着做完的样子', () => {
  const s1 = section('**先把需求问清楚**', '- run id：')
  const fence = s1.slice(s1.indexOf('```text') + 7, s1.indexOf('```', s1.indexOf('```text') + 7))
  const lines = fence.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  assert.ok(lines.length >= 5, fence)
  for (const l of lines) assert.equal(numberedHeading(l), null, l)
  for (const k of ['要做什么、为什么：', '给谁用：', '做完的样子：', '不做：', '约束：']) assert.ok(lines.some((l) => l.startsWith(k)), k)
})

test('/agent-team:at 第 2 节与第 6 节：第 1 节照抄批准的需求稿、门禁在批准那一刻记下它、几种不核的情形里批准过的除外；另起一趟同样', () => {
  const s2 = section('## 2. S1 录入', '## 3.')
  for (const k of [
    `照第 1 节问过需求、用户选了「${BRIEF_LABEL}」的，照抄那份需求稿（那道题的题面）：它就是这一趟的原话`,
    `用户批准了需求稿的，门禁在用户选「${BRIEF_LABEL}」那一刻记下的是那份需求稿（同一份文件，换掉命令那一次记下的），之后一样核`,
    '门禁没有记下这一趟的原话，不核——这几种里问过需求、用户批准了需求稿的除外（门禁记下了那份需求稿）',
  ]) assert.ok(has(s2, k), `第 2 节缺「${k}」`)
  assert.ok(has(at.slice(at.indexOf('## 6. 收尾')), '（按时间顺序整条照抄，不删不改；照第 1 节问过需求、用户批准了需求稿的，照抄需求稿）'), '第 6 节')
})

test('项目经理的角色正文、续跑、契约格式与契约模板各一句：批准的需求稿就是原话；那几问不记 escalation、可以直接问', () => {
  const pm = read('agents/at-pm.md')
  assert.ok(has(pm, `建 run 之前问过需求、用户选了「${BRIEF_LABEL}」的，用户原话就是那份需求稿（门禁同样记下、同样核）`), 'at-pm 第 1 节那一句')
  assert.ok(has(pm, '`/agent-team:at` 第 1 节「先把需求问清楚」那几问也另算：发生在新 run 建出来之前，不记 escalation、不动契约，给不出选项的可以直接问'), 'at-pm 打断用户')
  assert.ok(has(read('commands/at-resume.md'), '拒绝理由说的是「对不上用户批准的需求稿」的，同一个办法：那份需求稿就是 args 那一项'), 'at-resume')
  assert.ok(has(read('skills/at-contract-format/SKILL.md'), `建 run 之前问过需求、用户选了「${BRIEF_LABEL}」的，第 1 节照抄那份需求稿：门禁在那一刻记下的是它，同样核`), '契约格式')
  const tpl = read('templates/00-contract.md')
  assert.ok(has(tpl.slice(tpl.indexOf('## 1. 用户原话'), tpl.indexOf('## 2.')), `建 run 之前问过需求、用户选了「${BRIEF_LABEL}」的，这里照抄那份需求稿（门禁同样记下、同样核）`), '模板')
})

test('README 两半：命令表之后一段说没想清楚也可以直接发、选规范标签就照需求稿起这一趟', () => {
  const readme = read('README.md')
  const cut = readme.indexOf('<a id="english"></a>')
  const zh = readme.slice(0, cut)
  const en = readme.slice(cut)
  assert.ok(
    has(zh, `需求还没想清楚也可以直接发。\`/agent-team:at\` 不带需求，或者话里还有几处没说清时，项目经理先问你几个问题（一次一个），整理成一份需求稿给你过目；你选「${BRIEF_LABEL}」，就照它起这一趟，契约里记的是这份需求稿。话已经说清楚的，直接开始。`),
    '中文',
  )
  assert.ok(
    has(en, `When \`/agent-team:at\` comes without a request, or the request leaves things open, the project manager first asks you a few questions (one at a time) and writes up the request for you to review; pick 「${BRIEF_LABEL}」 (start with this request) and the run starts from it, with that write-up recorded in the contract.`),
    'English',
  )
  for (const [half, text, next] of [['中文', zh, '### 一趟 run 怎么走'], ['English', en, '### How a run flows']]) {
    const i = text.indexOf(BRIEF_LABEL)
    assert.ok(i > text.indexOf('/agent-team:at-resume') && i < text.indexOf(next), `${half}：那一段在命令表之后、流程图之前`)
  }
})

test('门禁出错时给项目经理的那一段：点名需求稿的标签（重新问一次）', () => {
  const t = crashContext('approval-ask', new Error('boom'), true)
  assert.ok(t.includes(`「${BRIEF_LABEL}」`) && t.includes('重新问一次'), t)
})
