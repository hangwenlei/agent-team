// 第 46 条（docs/48，M4m）：运行时正文只写现行规则——模型在运行时读得到的文字（角色正文、命令、skill、模板、stages.produces.md，以及门禁回传与
// 拒绝理由的字符串）里不写开发史：docs 编号、里程碑编号、规格章节号、审查条目号、「上一版写的是」这类叙述。这些给维护者看的东西写在 docs/、
// 代码注释与 stages.README.md 里。「上一版契约」是现行规则里的说法（M4j 的契约基线），不算开发史。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HISTORY = [
  [/docs\/\d/, 'docs 编号'],
  [/(?<![A-Za-z0-9_])M\d[a-z]?(?![A-Za-z0-9_])/, '里程碑编号'],
  [/规格\s*§/, '规格章节号'],
  [/审查第\s*\d+\s*条|全量审查/, '审查条目号'],
  [/上一版(写的是|举的是|这句|这张表|这一段|这里)/, '「上一版写的是」这类叙述'],
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

function violations(rel, lines) {
  const out = []
  lines.forEach((line, i) => {
    for (const [re, what] of HISTORY) if (re.test(line)) out.push(`${rel}:${i + 1}（${what}）  ${line.trim().slice(0, 80)}`)
  })
  return out
}

test('第 46 条：角色正文、命令、skill、模板、stages.produces.md 与插件的几份配置里没有开发史', () => {
  const prose = [
    ...files('agents', (n) => n.endsWith('.md')),
    ...files('commands', (n) => n.endsWith('.md')),
    ...files('skills', (n) => n === 'SKILL.md'),
    ...files('templates', () => true),
    'stages.produces.md',
    // 每轮提醒（UserPromptSubmit 上那条 echo）与 statusMessage 也进模型或用户看得到的地方；另外三份是模型照着读的配置。
    'hooks/hooks.json',
    'stages.json',
    'roster.json',
    'settings.json',
  ]
  const bad = prose.flatMap((rel) => violations(rel, readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/)))
  assert.deepEqual(bad, [])
})

// docs/39 §3（随第 46 条）：插件根不在用户的项目里，正文写裸相对路径，模型按会话的工作目录去找、读不到——原来只有 commands/ 有这条判据、
// 只认四种路径。运行时正文里点名插件自带的文件，一律带 ${CLAUDE_PLUGIN_ROOT}/（只看反引号里以这些路径开头的；settings.json 不在里面：
// 正文里说的多半是用户项目的 .claude/settings.json）。
const PLUGIN_PATH = /^(\.\/)?(agents\/|commands\/|hooks\/|skills\/|templates\/|stages\.json|roster\.json|stages\.produces\.md|stages\.README\.md|\.claude-plugin\/)/
const RUNTIME_PROSE = () => [
  ...files('agents', (n) => n.endsWith('.md')),
  ...files('commands', (n) => n.endsWith('.md')),
  ...files('skills', (n) => n === 'SKILL.md'),
  ...files('templates', () => true),
  'stages.produces.md',
]
const barePluginPaths = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((span) => PLUGIN_PATH.test(span))

test('自检：barePluginPaths() 认得出裸路径，带前缀的与用户项目里的路径不算', () => {
  const sample = '读 `stages.json`、`hooks/lib/stages.mjs`、`${CLAUDE_PLUGIN_ROOT}/roster.json`、`.agent-team/project.json`、`./agents/at-qa.md`'
  assert.deepEqual(barePluginPaths(sample), ['stages.json', 'hooks/lib/stages.mjs', './agents/at-qa.md'])
})

test('第 46 条（docs/39 §3）：运行时正文点名插件自带的文件，一律带 ${CLAUDE_PLUGIN_ROOT}/', () => {
  const prose = RUNTIME_PROSE()
  const all = prose.flatMap((rel) => [...readFileSync(join(ROOT, rel), 'utf8').matchAll(/`\$\{CLAUDE_PLUGIN_ROOT\}\/[^`\n]+`/g)])
  assert.ok(all.length > 0, '前置：正文里一个带前缀的插件路径都没有——这条判据的口径可能坏了')
  const bad = prose.flatMap((rel) =>
    readFileSync(join(ROOT, rel), 'utf8')
      .split(/\r?\n/)
      .flatMap((line, i) => barePluginPaths(line).map((span) => `${rel}:${i + 1}  \`${span}\``)),
  )
  assert.deepEqual(bad, [])
})

// 门禁回传、拒绝理由、留痕都是代码里的字符串：只看代码行（整行注释跳过，行尾「 // 」之后的注释也跳过）。
test('第 46 条：门禁写给模型的文字（hooks 里的代码行）没有开发史', () => {
  const code = files('hooks', (n) => n.endsWith('.mjs'))
  const bad = code.flatMap((rel) => {
    const lines = readFileSync(join(ROOT, rel), 'utf8')
      .split(/\r?\n/)
      .map((l) => (/^\s*(\/\/|\/?\*)/.test(l) ? '' : l.split(' // ')[0]))
    return violations(rel, lines)
  })
  assert.deepEqual(bad, [])
})
