// project.json 的形状校验（M3u，docs/29，全量审查第 10 条）。
//
// 此前 project.json 只要是个合法对象，H3 就照单全收：paths 缺失、键名拼错、带插件前缀、被删掉，调用者
// 在 paths 里「没有键」，一律静默放行；前缀 '../' 认领到项目根之外，'' 与 '.' 认领整个项目根。
// validateProject 把问题分三档：阻断（H3 据此拒持有它的那个角色）、要改（/agent-team:at-init 明令禁止的
// 写法）、请确认（可能是有意的，PM 读一遍）。外部值一律过 quote（docs/27）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NO_PATHS_ROLES, entryProblems, prefixProblems, validateProject } from '../hooks/lib/project.mjs'
import { ROLES_WITHOUT_PATHS } from './helpers/roles-without-paths.mjs'

const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
const WIN = process.platform === 'win32'
const BS = String.fromCharCode(92)

const v = (project, roster = ROSTER) => validateProject(project, { roster })
const all = (r) => [...r.block, ...r.fix, ...r.confirm].join('\n')

// ---- 单一真源 ----

test('按设计不认领路径的角色（NO_PATHS_ROLES）等于模板派生的那一组——一份常量、一份模板，判据对账', () => {
  assert.deepEqual([...NO_PATHS_ROLES].sort(), [...ROLES_WITHOUT_PATHS].sort())
})

test('模板本身：没有阻断、没有要改、没有请确认', () => {
  const r = v(TEMPLATE)
  assert.deepEqual([r.block, r.fix, r.confirm], [[], [], []], all(r))
})

// ---- 阻断 ----

test('阻断：paths 缺失、不是普通对象', () => {
  for (const paths of [undefined, null, [], 'src/', 0, true]) {
    const project = { ...TEMPLATE, paths }
    if (paths === undefined) delete project.paths
    assert.ok(v(project).block.length > 0, JSON.stringify(paths))
  }
})

test('阻断：值不是数组、元素不是字符串', () => {
  for (const value of ['src/', null, 5, {}, ['src/', 5], ['src/', null], [['src/']], [[]], [{ toString: 1 }]]) {
    const r = entryProblems('at-backend', value)
    assert.ok(r.block.length > 0, JSON.stringify(value))
  }
})

test('阻断：前缀出了项目根、认领整个项目根、带冒号', () => {
  const bad = ['../', '../shared/', 'src/../../x', './../x', '', '.', './', './.', './/', 'src/..', 'C:x', 'src/a:b']
  if (WIN) bad.push(`..${BS}x`, `src${BS}..${BS}..`, `.${BS}`)
  for (const p of bad) assert.ok(prefixProblems(p).block.length > 0, JSON.stringify(p))
})

test('不阻断：留在项目根里的正常写法，包括中间走回来的 ..、以 / 开头（门禁把它当相对项目根）', () => {
  for (const p of ['src/server/', 'src/server', 'src/../lib/', 'app/[id]/', 'app/(group)/', 'package.json', '/src/server/']) {
    assert.deepEqual(prefixProblems(p).block, [], JSON.stringify(p))
  }
  // POSIX 上反斜杠是文件名字符，'..\x' 是一个字面名字，不出根。
  if (!WIN) assert.deepEqual(prefixProblems(`..${BS}x`).block, [])
})

// ---- 要改 ----

test('要改：键不是花名册角色（拼错、带插件前缀、别的插件的角色）', () => {
  for (const key of ['at-fronted', 'agent-team:at-frontend', 'At-Backend', ' at-backend', 'shared', '_comment']) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, [key]: ['x/'] } })
    assert.ok(r.fix.some((s) => s.includes(JSON.stringify(key))), `${key}：${all(r)}`)
    assert.deepEqual(r.block, [], `${key} 不该阻断——它只让持有它的那个「角色」不存在`)
  }
})

test('要改：给 at-init 明令不许建键的角色建了键——名单是 at-pm 加上按设计不认领路径的那几个', () => {
  for (const role of ['at-pm', ...NO_PATHS_ROLES]) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, [role]: ['x/'] } })
    assert.ok(r.fix.some((s) => s.includes(role)), `${role}：${all(r)}`)
  }
})

test('要改：前缀落在 .agent-team 下；写法按字面比较会落空（反斜杠、通配符、首尾空白、段尾的点或空格）', () => {
  const fix = ['.agent-team/', './.agent-team/x/', 'src/*', 'src/?', ' src/', 'src/ ', 'src./x/', `src${BS}server${BS}`]
  if (WIN || process.platform === 'darwin') fix.push('.AGENT-TEAM/')
  for (const p of fix) assert.ok(prefixProblems(p).fix.length > 0, JSON.stringify(p))
  assert.deepEqual(prefixProblems('.agent-teamwork/').fix, [])
  assert.deepEqual(prefixProblems('app/[id]/').fix, [])
})

test('要改：available_roles 缺失、不是数组、有非花名册名字或 at-pm', () => {
  for (const available_roles of [undefined, 'at-backend', ['at-backend', 'at-fronted'], ['at-pm', 'at-backend'], ['at-backend', 5]]) {
    const project = { ...TEMPLATE, available_roles }
    if (available_roles === undefined) delete project.available_roles
    assert.ok(v(project).fix.length > 0, JSON.stringify(available_roles))
  }
})

// ---- 请确认 ----

test('请确认：available_roles 里的角色在 paths 里没有键——写成 [] 表示有意只写 run 目录，就不再提', () => {
  const paths = { ...TEMPLATE.paths }
  delete paths['at-product']
  assert.ok(v({ ...TEMPLATE, paths }).confirm.some((s) => s.includes('at-product')))
  const r = v({ ...TEMPLATE, paths: { ...paths, 'at-product': [] } })
  assert.deepEqual([r.block, r.fix, r.confirm], [[], [], []], all(r))
})

test('请确认：一个角色的前缀严格包含另一个角色的——外层也能写进内层', () => {
  const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-product': ['docs/'] } })
  assert.ok(r.confirm.some((s) => s.includes('at-product') && s.includes('at-ui')), all(r))
  // 相同前缀（共享目录）与同一角色内部的嵌套不提。
  assert.deepEqual(v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['src/server/', 'src/server/api/'] } }).confirm, [])
})

test('请确认：前缀以 / 开头——门禁把它当相对项目根，写成相对的更清楚', () => {
  assert.ok(prefixProblems('/src/server/').confirm.length > 0)
})

test('请确认：__main__、at-outsider 的键门禁读不到', () => {
  for (const key of ['__main__', 'at-outsider']) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, [key]: ['x/'] } })
    assert.ok(r.confirm.some((s) => s.includes(key)), all(r))
  }
})

// ---- 花名册读坏时 ----

test('花名册读坏时：不做「键是不是花名册角色」这一条，只报一句这不是 project.json 的问题', () => {
  for (const roster of [{}, [], null]) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-fronted': ['x/'] } }, roster)
    assert.ok(!all(r).includes('at-fronted'), JSON.stringify(roster))
    assert.ok(r.confirm.some((s) => s.includes('roster.json')), JSON.stringify(roster))
  }
})

// ---- 外部值不另起一行（docs/27）----

test('键、前缀、available_roles 里的值带换行字符，也不会让任何一条另起一行', () => {
  const breaks = [10, 13, 0x85, 0x2028, 0x2029].map((c) => String.fromCharCode(c))
  for (const b of breaks) {
    const r = v({
      ...TEMPLATE,
      available_roles: [...TEMPLATE.available_roles, `x${b}伪造`],
      paths: { ...TEMPLATE.paths, [`k${b}伪造`]: [`p${b}伪造/`], 'at-backend': [`../${b}伪造`] },
    })
    for (const s of [...r.block, ...r.fix, ...r.confirm]) {
      assert.ok(!breaks.some((c) => s.includes(c)), JSON.stringify(s))
    }
    assert.ok(all(r).includes('伪造'), '载荷没进任何一条——这条判据什么都没测')
  }
})
