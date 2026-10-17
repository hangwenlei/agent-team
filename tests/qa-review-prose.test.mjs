// docs/96：全队原来没人审代码写得好不好——at-acceptance 说那是 at-qa 与架构师的事，两份正文都没接。at-qa 加「审这一趟的改动（只读）」
// 一节：照代码基线取改动、对照产品定义与架构方案分漏做/多做/做歪、按对使用者的影响定级、原话之外的新增单列，写进 06-test.md 的「## 审查」，
// 不改第一行、门禁不读。项目经理在 S6 推进之前读它；README 两半写清主会话拿不到 Skill、别处想好的需求只贴要点。判据钉承重的句子。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const squash = (s) => s.replace(/\s+/g, '')
const has = (text, k) => squash(text).includes(squash(k))

function section(text, head) {
  const lines = text.split(/\r?\n/)
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return null
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

const QA = [
  '照 `04-dispatch.md`「代码基线」那一节记的，在项目根只用只读的 git 命令',
  "`git --no-optional-locks -c core.quotepath=off diff <基线> -- . ':(exclude).agent-team'`",
  '整份 `Read`',
  '基线写着「还没有提交」的，没有可比的提交',
  '基线写着「不是 git 仓库」或「没记」的，照各份实现记录列出的文件读，并写明这一次没有 diff',
  '对着 `01-prd.md` 的完成定义（没有这一份的，对着契约）、`03-arch.md` 的接口契约与落盘清单',
  '漏做', '多做', '做歪',
  '实现记录是产者对自己的说法，不当证据',
  '只断言替身（mock、stub）被调用过、或者什么都不断言的测试，测到的是替身，不是代码',
  '分「必须修」「应当修」「可不修」',
  '契约没提到那个输入也照样算',
  '每一条写 `文件:行`',
  '在后面单列「契约没说到的」',
  '写进 `06-test.md` 的「## 审查」一节',
  '**这一节不改第一行**',
  '照上面「新行为有没有自动化测试」那一段算它没有测试',
  // docs/100：测试本身的毛病最多「应当修」——项目经理只对「必须修」回退，定成「必须修」就又绕回返工。
  '测试本身的毛病（断言偏弱、用户没点名的边界与分支没测全、变异没杀死）不直接让使用者拿到错的结果，最多定「应当修」',
  // docs/100 复核：新文件整份读那一句管不到图片——不读、只列路径。
  '改动里的图片文件（截图、PNG 这类）不读，只列路径。',
  '顺着它读出代码真有错的（某个输入上结果不对），那是代码的问题，照上面定级',
]
test('at-qa 有「审这一趟的改动（只读）」一节：取改动、对照、定级、单列契约没说到的、不改第一行', () => {
  const qa = read('agents/at-qa.md')
  const sec = section(qa, '## 审这一趟的改动（只读）')
  assert.ok(sec, 'agents/at-qa.md 缺「## 审这一趟的改动（只读）」')
  for (const k of QA) assert.ok(has(sec, k), `审查那一节缺「${k}」`)
  // 在红线之前：红线里那几条 git 命令的禁令在后面照旧管着。
  assert.ok(qa.indexOf('## 审这一趟的改动') < qa.indexOf('## 红线'))
  assert.ok(has(qa, '下面「审这一趟的改动」那一节的只读 git 命令也在此列。'), '「Bash 只用来……」没把只读 git 命令算进去')
})

test('at-qa 的审查一节只用只读的 git 子命令', () => {
  const sec = section(read('agents/at-qa.md'), '## 审这一趟的改动（只读）')
  for (const m of sec.matchAll(/git (?:--no-optional-locks )?(?:-c \S+ )?([a-z-]+)/g)) {
    assert.ok(['diff', 'status', 'show', 'log'].includes(m[1]), `审查那一节用了 git ${m[1]}`)
  }
})

test('at-acceptance 不再把代码好不好推给没接这个活的人，指向 at-qa 的审查', () => {
  const acc = read('agents/at-acceptance.md')
  assert.ok(!acc.includes('与架构师的事'), '还说是架构师的事')
  assert.ok(has(acc, '代码对不对、好不好，是 `at-qa` 的事：它在 `06-test.md` 的「审查」一节里报'), acc.slice(0, 200))
})

test('/agent-team:at 的 S6 有一条读「审查」：排在测试报告第一行那一条之后、「回退」之前；必须修的先核实再回退', () => {
  const at = read('commands/at.md')
  const pos = at.indexOf('- **S6 测试报告的审查**')
  assert.ok(pos > at.indexOf('- **S6 测试报告的第一行**') && pos < at.indexOf('### 回退'), '位置不对')
  const b = at.slice(pos, at.indexOf('\n- ', pos + 1))
  for (const k of ['不进第一行，门禁不读', '先读它指的那几行核实', '收尾时原样告诉用户', '`budget-exhausted`', '「契约没说到的」由你裁', '那是扩出原话，照第 4 节问（`tradeoff`）']) assert.ok(has(b, k), `缺「${k}」`)
  // docs/100：项目经理那一侧也不为测试本身的毛病回退——at-qa 定错了级，这一句兜着。
  assert.ok(has(b, '报的是测试本身的毛病（断言偏弱、覆盖不全、变异没杀死）的，定的哪一级都不回退'), '缺「测试本身的毛病定的哪一级都不回退」')
})

test('运行时正文不提别的插件：superpowers 只出现在 README', () => {
  for (const f of ['agents/at-qa.md', 'agents/at-acceptance.md', 'agents/at-pm.md', 'commands/at.md']) {
    assert.ok(!/superpowers/i.test(read(f)), f)
  }
})

test('README 两半：主会话拿不到 Skill 工具；别处想好的需求只贴要点、每一句都算原话', () => {
  const md = read('README.md')
  const cut = md.indexOf('<a id="english"></a>')
  const zh = md.slice(0, cut)
  const en = md.slice(cut)
  assert.ok(zh.includes('它也拿不到 Skill 工具，别的插件带的 skill 它调不起来。'), 'zh Skill')
  assert.ok(en.includes('It does not get the Skill tool either'), 'en Skill')
  assert.ok(has(zh, '只贴要做什么、给谁用、做完是什么样子、不做什么，不要整份贴') && has(zh, '后面的每一句都会被当成你的原话'), 'zh 贴需求')
  assert.ok(en.includes('paste only what to build') && en.includes('is taken as your own words'), 'en 贴需求')
  // 两半各一处，且都紧跟在「先把需求问清楚」那一段之后。
  assert.ok(zh.indexOf('在别处想好的需求') > zh.indexOf('需求还没想清楚也可以直接发'))
  assert.ok(en.indexOf('If you worked the request out elsewhere') > en.indexOf('You can start before the request is worked out'))
})
