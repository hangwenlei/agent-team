// 第 20 条修法 A（docs/50，M4o）：正文跟上门禁记下的原话——/agent-team:at 第 2 节说清门禁记下了 $ARGUMENTS、哪两刻核、引用块也认、
// 哪几种情形不核；契约格式 skill 与契约模板第 1 节各一句；README 两半的目录树列上两份记录。正文说「行尾空白不计、整段写成引用块也认」，
// 门禁就得真这么认（同一条判据核门禁的 section1Mismatch）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { section1Mismatch, USER_WORDS_FILE } from '../hooks/lib/user-words.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const squash = (s) => s.replace(/\s+/g, '')
const has = (text, k) => squash(text).includes(squash(k))

const AT = [
  '命令带了参数的，门禁在它展开时记下了 `$ARGUMENTS`（`.agent-team/user-words.json`；你用 Write 建这一趟的 `state.json` 那一次，记进它的 run 目录',
  '两份都是门禁专属：Edit/Write 一律被拒，也不要用别的办法改',
  '还在 `S1` 时写契约，第 1 节对不上它，回传里的【契约】当场说是哪一行；推进出 `S1` 那一次 H6 拒',
  '行尾空白、空白的写法不计，整段写成引用块（每行前面一个 `>`）也认',
  '命令没带参数的、收口之后照第 6 节自己另起的一趟、这条命令之后续跑了别的一趟再另起的，门禁没有记下这一趟的原话，不核',
]
test('第 20 条修法 A：/agent-team:at 第 2 节——门禁记下了 $ARGUMENTS、哪两刻核、引用块也认、哪几种不核', () => {
  const at = read('commands/at.md')
  const s1 = at.slice(at.indexOf('## 2. S1 录入'), at.indexOf('## 3.'))
  assert.ok(s1.length > 0, '前置：找不到第 2 节')
  for (const k of AT) assert.ok(has(s1, k), `第 2 节缺「${k}」`)
})

test('第 20 条修法 A：契约格式 skill 与契约模板第 1 节各说一句推进出 S1 时对原话核', () => {
  // 复核（docs/50 §9，正文低 5）：原来只钉加粗的前半句，「对不上就拒」「当场说」改成相反的照样全绿。
  assert.ok(
    has(
      read('skills/at-contract-format/SKILL.md'),
      '**推进出 S1 那一次，门禁拿第 1 节对用户在 `/agent-team:at` 后面写的那段话**（命令带了参数时，展开那一刻它记下的 `user-words.json`）：对不上就拒，' +
        '还在 S1 时写契约，回传（【契约】）当场说是哪一行。',
    ),
    'skill',
  )
  const tpl = read('templates/00-contract.md')
  const sec1 = tpl.slice(tpl.indexOf('## 1. 用户原话'), tpl.indexOf('## 2.'))
  assert.ok(has(sec1, '命令带了参数的，门禁记下了那段话：推进出 S1 时拿这一节对它，对不上推进不出去'), sec1)
})

test('第 20 条修法 A：README 两半的目录树都列上两份原话记录（项目一级与 run 目录里）', () => {
  const readme = read('README.md')
  const cut = readme.indexOf('<a id="english"></a>')
  assert.ok(cut > 0, '前置：找不到中英两半的分界')
  for (const [half, text] of [['中文', readme.slice(0, cut)], ['English', readme.slice(cut)]]) {
    const tree = text.slice(text.indexOf('```text'), text.indexOf('```', text.indexOf('```text') + 7))
    const lines = tree.split(/\r?\n/).filter((l) => l.includes(USER_WORDS_FILE))
    assert.equal(lines.length, 2, `${half}：目录树里 ${USER_WORDS_FILE} 该有两行（项目一级、run 目录里），现在是 ${lines.length}`)
    assert.ok(lines.some((l) => l.startsWith('├── ')) && lines.some((l) => l.startsWith('    ')), `${half}：${lines.join(' | ')}`)
    // 复核（docs/50 §9，正文低 5）：说明也钉住——原来只核行数与缩进，改坏说明照样全绿。
    const want = half === '中文'
      ? ['你最近一次在 /agent-team:at 后面写的原话（门禁自己记）', '这一趟的需求原话（门禁记下，契约第 1 节对着它核）']
      : ['the words you last wrote after /agent-team:at (recorded by the gates)', "this run's request in your words (recorded by the gates; the contract's first section is checked against it)"]
    for (const w of want) assert.ok(lines.some((l) => l.includes(w)), `${half}：缺「${w}」`)
  }
})

test('第 20 条修法 A：正文说的「行尾空白不计、整段写成引用块也认」门禁真这么认', () => {
  const contract = (lines) => ['## 1. 用户原话', '', ...lines, '', '## 2. PM 的理解（可改）', ''].join('\n')
  assert.equal(section1Mismatch(contract(['做一个待办应用   ', '第二行']), '做一个待办应用\n第二行'), null, '行尾空白不计')
  assert.equal(section1Mismatch(contract(['> 做一个待办应用', '> 第二行']), '做一个待办应用\n第二行'), null, '引用块也认')
  assert.notEqual(section1Mismatch(contract(['做一个待办应用。', '第二行']), '做一个待办应用\n第二行'), null, '改了一个字照样对不上')
})

test('第 20 条修法 A（复核 docs/50 §9，正文低 7）：项目经理的角色正文说推进出 S1 那一次要对得上原话；续跑停在 S1 时照拒绝理由改第 1 节、原话在哪', () => {
  assert.ok(has(read('agents/at-pm.md'), '推进出 S1 那一次，它还要对得上用户在 `/agent-team:at` 后面写的原话（命令带了参数时门禁记下的，在这一趟 run 目录的 `user-words.json` 里），对不上推进不出去'), 'at-pm')
  const resume = read('commands/at-resume.md')
  for (const k of [
    '推进出 `S1` 被 H6 以「契约第 1 节对不上用户在 /agent-team:at 后面写的原话」拒的（写契约时的【契约】也这么说），照拒绝理由把第 1 节改成那段原话',
    '原话在这一趟 run 目录的 `user-words.json` 里（args 那一项），这是照抄、不是改契约',
    '还停在 `S1`、契约还没写的：先 `Read` `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 2 节再写，第 1 节照抄这一趟 run 目录 `user-words.json` 里的原话；没有这份文件的，问用户这一趟的需求原话',
  ]) assert.ok(has(resume, k), `at-resume 缺「${k}」`)
})
