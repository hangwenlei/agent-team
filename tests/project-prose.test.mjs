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

test('at-init §2：早退放行只对按设计不认领路径的那几个角色，并逐个点名', () => {
  const s = flat(sectionOf(INIT, '## 2.'))
  assert.match(s, /且只对它们/)
  for (const role of NO_PATHS_ROLES) assert.ok(s.includes(role), role)
})

test('at-init §2：其余会被派到的角色都要有键；[] 是「只写 run 目录」的正式写法；前缀嵌套时外层也能写内层', () => {
  const s = flat(sectionOf(INIT, '## 2.'))
  for (const k of ['其余每个会被派到的角色都要有键', '`[]`', '「只写 run 目录」的正式写法', '外层角色也能写内层']) {
    assert.ok(s.includes(k), k)
  }
})

test('at-init §3：先处理【project.json】——阻断与要改改到没有为止；请确认的确认、保留、告诉用户，不编前缀、不删 available_roles', () => {
  const s = flat(sectionOf(INIT, '## 3.'))
  assert.ok(s.indexOf('【project.json】') < s.indexOf('reach.json'), '【project.json】要排在落盘触达表之前')
  for (const k of ['**阻断**与**要改**：逐条改到没有为止', '**请确认**：逐条读一遍，是有意的就留着', '不要为了消一条', '不要把角色从 `available_roles` 里删掉']) {
    assert.ok(s.includes(k), k)
  }
})

test('/agent-team:at §0：不再说「每个执行角色都会被拒」——按设计不认领路径的那几个不会', () => {
  const s = flat(sectionOf(AT, '## 0.'))
  assert.ok(!s.includes('每个执行角色都会被拒'))
  for (const role of NO_PATHS_ROLES) assert.ok(s.includes(role), role)
})

test('/agent-team:at §1：写完 current-run 收到【project.json】就先改完阻断与要改，再进 S2', () => {
  const s = flat(sectionOf(AT, '## 1.'))
  assert.ok(s.includes('【project.json】') && s.includes('再进 S2'), s.slice(0, 200))
})

test('README 两半的已知边界：没有条目的角色在 run 目录之外写不了——不再说「只约束认领了目录的角色」', () => {
  const text = read('README.md')
  const [zh, en] = text.split('<a id="english"></a>')
  assert.ok(zh.includes('没有条目的角色在 run 目录之外哪都写不了'))
  assert.ok(en.includes('a role with no entry can write nothing outside the run directory'))
  assert.ok(!zh.includes('只约束在 `project.json` 里认领了目录的角色'))
  assert.ok(!en.includes('only constrains roles that claim directories'))
})
