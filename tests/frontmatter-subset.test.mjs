// M4e（docs/39 §2.4，审查第 30 条后半）：插件自带的每一份 frontmatter（agents/、commands/、skills/*/SKILL.md）只用一个受限写法——
// 每个非空行恰好一行「key: 值」，键不重复，值不以 YAML 指示符开头、不含「: 」与「 #」、首尾没有空白。
//
// 为什么要它：别的判据（tool-surface、agents 的顶层键白名单）都按行读 frontmatter，平台却用 YAML 解析器读。两边读出来的东西
// 可以不一样，而且两个方向都是静默的：
//   · 解析失败——平台把整份 frontmatter 当空（tools、model 全丢，角色照常加载、拿到全部工具），判据照绿。平台失败时有一条退路
//     （给带「: 」的值补引号再解析一次），但它按行匹配时不认 CR，而 Windows 上经市场装下来的插件副本是 CRLF（git 的
//     core.autocrlf，仓库没有 .gitattributes），退路在那里一行都匹配不上。
//   · 合法的折行——`tools:` 行末加一个逗号、下一行缩进接一个工具名，YAML 把它接成同一个值，平台照授；按行读的判据只看见第一行。
//     这样能把规格 §6.1 禁授的 Skill 授出去，禁授判据看不见。
// 在这个受限写法里 YAML 既不会解析失败、也不会折行，按行读出来的就是平台读到的值——上面两条都不需要再去模拟平台的解析器。
// 代价：值里不能写半角「: 」（写全角「：」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8')

function frontmatterFiles() {
  const out = []
  for (const f of readdirSync(url('agents'))) if (f.endsWith('.md')) out.push(`agents/${f}`)
  for (const f of readdirSync(url('commands'))) if (f.endsWith('.md')) out.push(`commands/${f}`)
  for (const d of readdirSync(url('skills'))) if (existsSync(url(`skills/${d}/SKILL.md`))) out.push(`skills/${d}/SKILL.md`)
  return out
}

// 朴素标量不许以 YAML 指示符开头。
const BAD_START = /^[-?:,[\]{}#&*!|>'"%@`]/

/** 逐条返回这份文件的 frontmatter 不在受限写法里的地方；空数组 = 合规。行尾的 CR 先剥掉（CRLF 的签出照样判）。 */
function frontmatterProblems(text) {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  if (lines[0] !== '---') return ['第一行不是 ---']
  const end = lines.indexOf('---', 1)
  if (end === -1) return ['没有收尾的 ---']
  const problems = []
  const seen = new Set()
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue
    const m = /^([a-z][a-z-]*): (.+)$/.exec(line)
    if (!m) {
      problems.push(`不是「key: 值」一行：${JSON.stringify(line)}`)
      continue
    }
    const [, key, value] = m
    if (seen.has(key)) problems.push(`键重复：${key}`)
    seen.add(key)
    if (value !== value.trim()) problems.push(`${key} 的值首尾有空白`)
    if (BAD_START.test(value)) problems.push(`${key} 的值以 YAML 指示符开头：${JSON.stringify(value.slice(0, 20))}`)
    if (value.includes(': ')) problems.push(`${key} 的值含「: 」（写全角「：」）`)
    if (value.includes(' #')) problems.push(`${key} 的值含「 #」（YAML 把它后面当注释截掉）`)
  }
  return problems
}

const GOOD = ['---', 'name: at-x', 'description: 一个角色：做某件事', 'tools: Agent(agent-team:at-y), Read', 'model: sonnet', '---', '正文'].join('\n')

test('自检：受限写法的判据认得出合规的样本（含全角冒号与 agent-team: 前缀），CRLF 的签出照样判', () => {
  assert.deepEqual(frontmatterProblems(GOOD), [])
  assert.deepEqual(frontmatterProblems(GOOD.split('\n').join('\r\n')), [])
})

test('自检：受限写法的判据认得出三种已知违规——值里的「: 」、以引号开头、折行续上的工具名；CRLF 上一样', () => {
  const colon = GOOD.replace('description: 一个角色：做某件事', 'description: 项目经理: 主会话角色')
  const quote = GOOD.replace('description: 一个角色：做某件事', "description: '项目经理'。主会话角色")
  const fold = GOOD.replace('tools: Agent(agent-team:at-y), Read', 'tools: Agent(agent-team:at-y), Read,\n  Skill')
  for (const bad of [colon, quote, fold]) {
    assert.ok(frontmatterProblems(bad).length > 0, bad)
    assert.ok(frontmatterProblems(bad.split('\n').join('\r\n')).length > 0, bad)
  }
  assert.ok(frontmatterProblems(GOOD.replace('model: sonnet', 'model: sonnet\nmodel: opus')).some((p) => p.startsWith('键重复')))
})

test('前置：扫到的 frontmatter 文件里有主会话的角色、每条命令、每个 skill——否则下一条在半个清单上空转', () => {
  const files = frontmatterFiles()
  assert.ok(files.includes('agents/at-pm.md'), files.join('、'))
  assert.ok(files.some((f) => f.startsWith('commands/')), files.join('、'))
  assert.ok(files.some((f) => f.startsWith('skills/')), files.join('、'))
})

test('M4e 第 30 条：插件自带的每一份 frontmatter 都在受限写法里——平台的 YAML 解析器与按行读的判据读到同一个值', () => {
  for (const f of frontmatterFiles()) assert.deepEqual(frontmatterProblems(read(f)), [], f)
})
