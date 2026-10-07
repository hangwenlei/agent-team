// 第 46 条（docs/48，M4m）：运行时正文只写现行规则——模型在运行时读得到的文字（角色正文、命令、skill、模板、stages.produces.md、插件的几份配置，
// 以及门禁回传与拒绝理由的字符串）里不写开发史：docs 编号、里程碑编号、章节号、设计决策号、审查条目号、「上一版写的是」这类叙述，也不指向给维护者
// 的 stages.README.md。这些给维护者看的东西写在 docs/、代码注释与 stages.README.md 里。「上一版契约」是现行规则里的说法（契约基线），不算开发史。
// 复核（docs/48 §8）：逐行认不出折在两行的一句（正文按显示宽度折行、门禁的字符串用 ' +' 接起来），整份接成一行再扫一遍；遍历的集合有身份锚。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HISTORY = [
  [/docs\/\d/, 'docs 编号'],
  [/(?<![A-Za-z0-9_])M\d+[a-z]?(?![A-Za-z0-9_])/, '里程碑编号'],
  [/规格\s*§|§\s*\d/, '章节号'],
  [/决策\s*D\d/, '设计决策号'],
  [/审查第\s*\d+\s*条|全量\s*审查/, '审查条目号'],
  [/上一版\s*(写的是|举的是|这句|这张表|这一段|这里)/, '「上一版写的是」这类叙述'],
  // stages.README.md 是给维护者的（理由与开发史）；运行时要模型读的那一份是 stages.produces.md。
  [/stages\.README/, '指向给维护者的 stages.README.md'],
]

function files(dir, pick) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...files(rel, pick))
    else if (pick(name)) out.push(rel)
  }
  return out
}
const norm = (p) => p.split(sep).join('/')

const RUNTIME_PROSE = () => [
  ...files('agents', (n) => n.endsWith('.md')),
  ...files('commands', (n) => n.endsWith('.md')),
  ...files('skills', (n) => n === 'SKILL.md'),
  ...files('templates', () => true),
  'stages.produces.md',
]
// 每轮提醒（UserPromptSubmit 上那条 echo）与 statusMessage 也进模型或用户看得到的地方；另外三份是模型照着读的配置。
const CONFIGS = ['hooks/hooks.json', 'stages.json', 'roster.json', 'settings.json']
const HOOK_CODE = () => files('hooks', (n) => n.endsWith('.mjs'))

// 门禁回传、拒绝理由、留痕都是代码里的字符串：只看代码行（整行注释跳过，行尾「 // 」之后的注释也跳过）。
const codeLines = (text) => text.split(/\r?\n/).map((l) => (/^\s*(\/\/|\/?\*)/.test(l) ? '' : l.split(' // ')[0]))
// 接成一行：去掉每行首尾的空白、用一个空格接（patterns 里的 \s* 跨得过去）；代码再去掉字符串的接缝（'…' + '…'）。
const joinProse = (lines) => lines.map((l) => l.trim()).join(' ')
const joinCode = (lines) => joinProse(lines).replace(/['"`]\s*\+\s*['"`]/g, '')

function violations(rel, lines, joined) {
  const out = []
  lines.forEach((line, i) => {
    for (const [re, what] of HISTORY) if (re.test(line)) out.push(`${rel}:${i + 1}（${what}）  ${line.trim().slice(0, 80)}`)
  })
  // 逐行干净时再看接起来的：一句折在两行，只有这一遍认得出。
  if (!out.length) for (const [re, what] of HISTORY) if (re.test(joined)) out.push(`${rel}（${what}，折在两行里）  …${joined.match(re)[0]}…`)
  return out
}

// 遍历的集合要有身份锚（docs/16 §3.2）：遍历坏了（一份都不收、后缀写错），下面几条在空集合上照绿。
const MUST_PROSE = ['agents/at-pm.md', 'agents/at-qa.md', 'commands/at.md', 'commands/at-resume.md', 'skills/at-api-contract/SKILL.md', 'skills/at-handoff-package/SKILL.md', 'templates/04-dispatch.md', 'stages.produces.md']
const MUST_CODE = ['hooks/gate.mjs', 'hooks/lib/ledger.mjs', 'hooks/lib/rework-guard.mjs', 'hooks/lib/state.mjs']

test('锚：扫描集合里有该扫的那几份——否则下面几条在空集合或半个集合上空转', () => {
  const prose = RUNTIME_PROSE().map(norm)
  for (const f of MUST_PROSE) assert.ok(prose.includes(f), `运行时正文的扫描集合里没有 ${f}`)
  const code = HOOK_CODE().map(norm)
  for (const f of MUST_CODE) assert.ok(code.includes(f), `门禁代码的扫描集合里没有 ${f}`)
})

test('自检：violations() 认得出逐行的与折在两行的，不把「上一版契约」与普通的数算进来', () => {
  const lines = ['照规格 §5.1 问用户']
  assert.equal(violations('x', lines, joinProse(lines)).length, 1)
  const folded = ['这一条（全量', '审查那一回加的）']
  assert.deepEqual(violations('x', folded, joinProse(folded)).map((v) => v.includes('折在两行')), [true])
  const code = ["'…（规格' +", "  '§4.2 ③）…'"]
  assert.equal(violations('x', code, joinCode(code)).length, 1)
  assert.equal(violations('x', ['M10 里撞上过'], 'M10 里撞上过').length, 1)
  assert.equal(violations('x', ['按需组队（决策 D2）'], '').length, 1)
  const clean = ['对着上一版契约重出', '第 3 轮终局之后要批准', 'S5 的 05-impl/*']
  assert.deepEqual(violations('x', clean, joinProse(clean)), [])
})

test('第 46 条：角色正文、命令、skill、模板、stages.produces.md 与插件的几份配置里没有开发史', () => {
  const bad = [...RUNTIME_PROSE(), ...CONFIGS].flatMap((rel) => {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/)
    return violations(norm(rel), lines, joinProse(lines))
  })
  assert.deepEqual(bad, [])
})

test('第 46 条：门禁写给模型的文字（hooks 里的代码行）没有开发史', () => {
  const bad = HOOK_CODE().flatMap((rel) => {
    const lines = codeLines(readFileSync(join(ROOT, rel), 'utf8'))
    return violations(norm(rel), lines, joinCode(lines))
  })
  assert.deepEqual(bad, [])
})

// docs/39 §3（随第 46 条）：插件根不在用户的项目里，正文写裸相对路径，模型按会话的工作目录去找、读不到——原来只有 commands/ 有这条判据、
// 只认四种路径。运行时正文里点名插件自带的文件，一律带 ${CLAUDE_PLUGIN_ROOT}/（只看反引号里以这些路径开头的；settings.json 不在里面：
// 正文里说的多半是用户项目的 .claude/settings.json）。漏了花括号的 $CLAUDE_PLUGIN_ROOT/ 也算没带。
const PLUGIN_PATH = /^(\.\/|\$CLAUDE_PLUGIN_ROOT\/)?(agents\/|commands\/|hooks\/|skills\/|templates\/|stages\.json|roster\.json|stages\.produces\.md|stages\.README\.md|\.claude-plugin\/)/
const barePluginPaths = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((span) => PLUGIN_PATH.test(span))

test('自检：barePluginPaths() 认得出裸路径与漏了花括号的，带前缀的与用户项目里的路径不算', () => {
  const sample = '读 `stages.json`、`hooks/lib/stages.mjs`、`${CLAUDE_PLUGIN_ROOT}/roster.json`、`.agent-team/project.json`、`./agents/at-qa.md`、`$CLAUDE_PLUGIN_ROOT/roster.json`'
  assert.deepEqual(barePluginPaths(sample), ['stages.json', 'hooks/lib/stages.mjs', './agents/at-qa.md', '$CLAUDE_PLUGIN_ROOT/roster.json'])
})

test('第 46 条（docs/39 §3）：运行时正文点名插件自带的文件，一律带 ${CLAUDE_PLUGIN_ROOT}/', () => {
  const prose = RUNTIME_PROSE()
  const all = prose.flatMap((rel) => [...readFileSync(join(ROOT, rel), 'utf8').matchAll(/`\$\{CLAUDE_PLUGIN_ROOT\}\/[^`\n]+`/g)])
  assert.ok(all.length > 0, '前置：正文里一个带前缀的插件路径都没有——这条判据的口径可能坏了')
  const bad = prose.flatMap((rel) =>
    readFileSync(join(ROOT, rel), 'utf8')
      .split(/\r?\n/)
      .flatMap((line, i) => barePluginPaths(line).map((span) => `${norm(rel)}:${i + 1}  \`${span}\``)),
  )
  assert.deepEqual(bad, [])
})
