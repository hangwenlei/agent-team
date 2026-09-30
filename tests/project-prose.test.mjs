// project.json 形状校验的正文一半（M3u，docs/29，全量审查第 10 条）：/agent-team:at-init 怎么写、怎么处理
// 【project.json】回传，/agent-team:at 的第 0、1 节，README 已知边界那一句。门禁那一半在
// tests/writepath-shape.test.mjs、tests/gate-ledger-project.test.mjs。
//
// 上限（docs/16 §3）：钉的是关键句与位置，认不出「说反话」的改写；要答案改变，得能在 CI 里用真实会话核 PM
// 的行为。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NO_PATHS_ROLES } from '../hooks/lib/project.mjs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const flat = (s) => s.split('\n').map((l) => l.trim()).join('')

function sectionOf(md, heading) {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.startsWith(heading))
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^## /.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

const INIT = read('commands/at-init.md')
const AT = read('commands/at.md')

test('at-init §2：早退放行在执行角色里只对按设计不认领路径的那几个，并逐个点名；at-pm 另行放行，不被说成「没键就拒」', () => {
  const s = flat(sectionOf(INIT, '## 2.'))
  assert.match(s, /执行角色里只对它们/)
  assert.match(s, /`at-pm` 不参与路径认领，另行放行/)
  assert.ok(!s.includes('（且只对它们）'), '孤立的「且只对它们」会被读成 at-pm 没有键也会被拒')
  for (const role of NO_PATHS_ROLES) assert.ok(s.includes(role), role)
})

test('at-init §2：其余会被派到的角色都要有键；[] 是「只写 run 目录」的正式写法；前缀嵌套时外层也能写内层', () => {
  const s = flat(sectionOf(INIT, '## 2.'))
  for (const k of ['其余每个会被派到的角色都要有键', '`[]`', '「只写 run 目录」的正式写法', '外层角色也能写内层']) {
    assert.ok(s.includes(k), k)
  }
})

test('at-init §2：前缀留在项目里、按字面比较，可以是单个文件；出根的删掉、不换成项目里的同名目录', () => {
  const s = flat(sectionOf(INIT, '## 2.'))
  // 前三项对应 validateProject 阻断档里的出根、认领整个根、冒号（含盘符），第四项对应要改档里的通配符。
  for (const k of ['不许 `..` 出根', '不许认领整个根', '不许带冒号（含盘符）', '不是通配符', '**单个文件**', '**删掉**，不要换成项目里的同名目录']) {
    assert.ok(s.includes(k), k)
  }
})

test('at-init §2：重跑时缺键的角色逐个判，不一刀切地删角色', () => {
  const s = flat(sectionOf(INIT, '## 2.'))
  for (const k of ['键名拼错就改名', '只写 run 目录就补 `[]`', '重新勘察后确实用不上，才从 `available_roles` 删']) assert.ok(s.includes(k), k)
})

test('at-init §1：重跑先读用户项目里的旧 project.json，排在读模板之前，并说清两者不是一个文件', () => {
  const s = flat(sectionOf(INIT, '## 1.'))
  const old = s.indexOf('先用 `Read` 读用户项目里的 `.agent-team/project.json`')
  const tpl = s.indexOf('templates/project.json')
  assert.ok(old >= 0, s.slice(0, 200))
  assert.ok(tpl >= 0 && s.indexOf('templates/project.json', tpl + 1) < 0, '§1 只在「之前」那一句提模板')
  assert.ok(s.includes('**不是用户的旧文件**') && s.includes('只能照这次 `Read` 的结果说'), s.slice(0, 400))
})

test('at-init §4：重跑时逐条说和旧文件比改了哪些键；请确认的留下了哪几条', () => {
  const s = flat(sectionOf(INIT, '## 4.'))
  assert.ok(s.includes('改了哪些键、为什么'), s)
  assert.ok(s.includes('请确认的留下了哪几条'), s)
})

test('at-init §3：先处理【project.json】——阻断与要改改到没有为止；请确认的确认、保留、告诉用户，不编前缀、不删 available_roles', () => {
  const s = flat(sectionOf(INIT, '## 3.'))
  assert.ok(s.indexOf('【project.json】') < s.indexOf('reach.json'), '【project.json】要排在落盘触达表之前')
  for (const k of [
    '**阻断**与**要改**：逐条改到没有为止',
    '**请确认**：逐条读一遍，是有意的就留着',
    '收尾时告诉用户',
    '不要为了消一条',
    '不要把角色从 `available_roles` 里删掉',
    // 阻断按角色生效：一条坏前缀让这个角色其余合法的前缀也写不了（实测：只说「这条前缀会被拒」时 PM 会留着它）。
    '阻断**按角色生效**',
    // roster.json 读坏归阻断档，但改 project.json 修不好它。
    '**不要改 `project.json`**，停下告诉用户',
  ]) {
    assert.ok(s.includes(k), k)
  }
})

test('/agent-team:at §0：不再说「每个执行角色都会被拒」——按设计不认领路径的那几个不会', () => {
  const s = flat(sectionOf(AT, '## 0.'))
  assert.ok(!s.includes('每个执行角色都会被拒'))
  for (const role of NO_PATHS_ROLES) assert.ok(s.includes(role), role)
})

test('/agent-team:at §1：写完 current-run 收到【project.json】就先改完阻断与要改，再进 S2；「会被拒」只挂在阻断上', () => {
  const s = flat(sectionOf(AT, '## 1.'))
  assert.ok(s.includes('【project.json】') && s.includes('再进 S2'), s.slice(0, 200))
  // 「要改」里有一半不拒任何人（available_roles 的问题、给 at-pm 建的键……），不能拿「会被拒」当它的理由。
  assert.ok(s.includes('阻断会让执行角色在 run 目录之外的写入被拒'), s)
  assert.ok(!s.includes('那些问题会让执行角色'), s)
  assert.ok(s.includes('**先改好它再写契约**'), s)
})

test('/agent-team:at §2：没收到契约回传时，先排除 project.json 读不出来这一种，再判门禁没在跑', () => {
  const s = flat(sectionOf(AT, '## 2.'))
  const cfg = s.indexOf('不是门禁掉线')
  const down = s.indexOf('那说明门禁没在跑')
  assert.ok(cfg >= 0 && down > cfg, s)
  assert.ok(s.includes('再原样重写一次 `00-contract.md`'), s)
})

test('README 两半的已知边界：项目经理以外的角色在 run 目录之外只能写自己的前缀、没有条目哪都写不了，at-qa 与 at-acceptance 是例外', () => {
  const text = read('README.md')
  const [zh, en] = text.split('<a id="english"></a>')
  for (const k of ['管项目经理以外的各个角色', '没有条目就哪都写不了', '例外是 `at-qa` 与 `at-acceptance`']) assert.ok(zh.includes(k), k)
  for (const k of ['every team role except the project manager', 'nothing at all without an entry', 'the exception is `at-qa` and `at-acceptance`']) assert.ok(en.includes(k), k)
  // 英文 README 里 implementation roles 指 S5 那几个，at-product、at-architect 同样受 paths 管。
  assert.ok(!en.includes("governs the team's implementation roles"))
  assert.ok(!zh.includes('只约束在 `project.json` 里认领了目录的角色'))
  assert.ok(!en.includes('only constrains roles that claim directories'))
})
