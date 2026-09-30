// project.json 的形状校验（M3u，docs/29，全量审查第 10 条）。
//
// 此前 project.json 只要是个合法对象，H3 就照单全收：paths 缺失、键名拼错、带插件前缀、被删掉，调用者
// 在 paths 里「没有键」，一律静默放行；前缀 '../' 认领到项目根之外，'' 与 '.' 认领整个项目根。
// validateProject 把问题分三档：阻断（H3 据此拒持有它的那个角色——只算 H3 会拿键去判的；roster.json 读坏也归
// 这一档）、要改（/agent-team:at-init 明令禁止、或者按字面比较一定落空的写法）、请确认（可能是有意的，PM 读一遍）。
// 外部值一律过 quote（docs/27）。
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

test('阻断：paths 缺失、不是普通对象——理由点名不受影响的 NO_PATHS_ROLES，不说成「执行角色都会被拒」', () => {
  for (const paths of [undefined, null, [], 'src/', 0, true]) {
    const project = { ...TEMPLATE, paths }
    if (paths === undefined) delete project.paths
    const r = v(project)
    assert.ok(r.block.length > 0, JSON.stringify(paths))
    // H3 的第 2 步排在「paths 缺失」之前：没有键的 at-qa、at-acceptance 照样放行（commands/at.md §0 同一口径）。
    for (const role of NO_PATHS_ROLES) assert.ok(r.block.join('\n').includes(role), `${role}：${all(r)}`)
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

test('阻断的理由给得出改法：出根的删掉、别换成项目里的同名目录；认领根的逐个列文件；冒号的理由不假装 POSIX 上也是盘符', () => {
  // 实测：只说「前缀要留在项目里」时，PM 会把 '../shared/' 换成项目里并不存在的 'shared/'——那是另一个地方。
  const out = prefixProblems('../shared/').block.join('\n')
  assert.ok(out.includes('删掉') && out.includes('不要换成项目里') && out.includes('收尾时告诉用户删了哪一条'), out)
  // 理由不说「这个角色写不到项目外」：PM、没有键的 at-qa、at-acceptance 写得到，这句还会随降档出现在 at-pm 的键上。
  assert.ok(!out.includes('写不到项目外') && out.includes('门禁不会按这条前缀放行任何写入'), out)
  const onPm = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-pm': ['../x/'] } })
  assert.ok(!all(onPm).includes('写不到项目外'), all(onPm))
  // 平铺在项目根的文件没有目录可写：前缀也可以是单个文件。
  for (const p of ['', '.', './']) {
    const root = prefixProblems(p).block.join('\n')
    assert.ok(root.includes('单个文件') && root.includes('逐个列出'), root)
  }
  // 冒号在 POSIX 上是普通文件名字符。阻断照旧不分平台（同一份 project.json 各平台意思一样），理由说清是 Windows 的事。
  for (const platform of ['linux', 'darwin', 'win32']) {
    const colon = prefixProblems('src/a:b/', { platform }).block.join('\n')
    assert.ok(colon.includes('Windows') && colon.includes('所有平台上都不接受') && colon.includes('换一个不带冒号的名字'), `${platform}：${colon}`)
  }
})

test('给执行角色看的措辞（audience: role）：阻断只说问题本身，不带说给 PM 的改法——执行角色改不了 project.json、见不到用户', () => {
  for (const p of ['../shared/', '', 'src/a:b/']) {
    const pm = prefixProblems(p).block.join('\n')
    const role = prefixProblems(p, { audience: 'role' }).block.join('\n')
    assert.ok(role.length > 0 && role.length < pm.length, `${JSON.stringify(p)}：${role}`)
    for (const k of ['删掉这一条', '收尾时告诉用户', '逐个列出', '换一个不带冒号的名字']) assert.ok(!role.includes(k), `${k}：${role}`)
  }
  const e = entryProblems('at-backend', ['src/', '../x/'], { audience: 'role' }).block.join('\n')
  assert.ok(e.includes('出了项目根') && !e.includes('删掉这一条'), e)
})

test('不阻断、也不报要改：./ 开头、中间走回来的 ..、以 .. 开头的名字——H3 解析后都落在项目根里', () => {
  for (const platform of ['linux', 'win32']) {
    for (const p of ['./src/', 'src/../lib/', '..foo/']) {
      const r = prefixProblems(p, { platform })
      assert.deepEqual([r.block, r.fix, r.confirm], [[], [], []], `${platform} ${JSON.stringify(p)}：${[...r.block, ...r.fix].join('；')}`)
    }
  }
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

test('H3 不拿来判人的键（at-pm、__main__、认不出的键）上的坏前缀不进阻断——阻断档只放真会让某个角色被拒的', () => {
  // 阻断档的标题说「这些角色写 run 目录之外会被拒」，写 state.json 时还只报这一档：挂在不判人的键上就是假话。
  for (const [key, value, what] of [
    ['at-pm', ['../'], '出了项目根'],
    ['__main__', [''], '整个项目根'],
    ['at-fronted', ['../'], '出了项目根'],
    ['agent-team:at-backend', 'src/', '不是数组'],
  ]) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, [key]: value } })
    assert.deepEqual(r.block, [], `${key}：${all(r)}`)
    // 断言那条前缀级的问题本身降进了要改——只断言含键名的话，键级那一句（「不要给 at-pm 建键」）就满足了。
    assert.ok(r.fix.some((s) => s.includes(JSON.stringify(key)) && s.includes(what)), `${key} 的问题要降成要改：${all(r)}`)
  }
  // 三档各自的去向：阻断与要改进要改，请确认留在请确认，不升不丢。
  for (const key of ['at-pm', '__main__', 'at-fronted']) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, [key]: ['../', 'lib/*', '/lib2/'] } })
    assert.deepEqual(r.block, [], `${key}：${all(r)}`)
    assert.ok(r.fix.some((s) => s.includes('"../"') && s.includes('出了项目根')), `${key}：${all(r)}`)
    assert.ok(r.fix.some((s) => s.includes('"lib/*"')), `${key}：${all(r)}`)
    assert.ok(r.confirm.some((s) => s.includes('"/lib2/"')), `${key}：${all(r)}`)
    assert.ok(!r.fix.some((s) => s.includes('"/lib2/"')), `${key}：${all(r)}`)
  }
  // H3 会拿键去判的，照旧阻断——包括建了键的 at-qa、at-acceptance（建了键就不再早退放行）与 at-outsider。
  for (const key of [...NO_PATHS_ROLES, 'at-outsider', 'at-backend']) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, [key]: ['../'] } })
    assert.ok(r.block.length > 0, `${key}：${all(r)}`)
  }
})

test('前缀级的要改与请确认经 validateProject 汇进整份报告——ledger 的【project.json】靠这一份', () => {
  const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['src/server/*', '.agent-team/x/', '/src/server/'] } })
  assert.ok(r.fix.some((s) => s.includes('"src/server/*"')), all(r))
  assert.ok(r.fix.some((s) => s.includes('".agent-team/x/"')), all(r))
  assert.ok(r.confirm.some((s) => s.includes('"/src/server/"')), all(r))
})

test('要改：给 at-init 明令不许建键的角色建了键——名单是 at-pm 加上按设计不认领路径的那几个', () => {
  for (const role of ['at-pm', ...NO_PATHS_ROLES]) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, [role]: ['x/'] } })
    assert.ok(r.fix.some((s) => s.includes(role)), `${role}：${all(r)}`)
  }
})

test('要改：前缀落在 .agent-team 下；写法按字面比较会落空（反斜杠、通配符、首尾空白、段尾的点或空格）', () => {
  const fix = ['.agent-team/', './.agent-team/x/', 'x/../.agent-team/', 'src/*', 'src/?', ' src/', 'src/ ', 'src /x/', 'src./x/', `src${BS}server${BS}`]
  if (WIN || process.platform === 'darwin') fix.push('.AGENT-TEAM/')
  for (const p of fix) assert.ok(prefixProblems(p).fix.length > 0, JSON.stringify(p))
  assert.deepEqual(prefixProblems('.agent-teamwork/').fix, [])
  assert.deepEqual(prefixProblems('app/[id]/').fix, [])
})

test('要改：前缀里有不可见的格式字符（零宽空格之类）——trim 剥不掉，按字面比较认领的是另一个名字；理由写出码点', () => {
  const ZW = String.fromCharCode(0x200b)
  const WJ = String.fromCharCode(0x2060)
  for (const [p, cp] of [[`src/server/${ZW}`, 'U+200B'], [`${ZW}src/server/`, 'U+200B'], [`src/server${WJ}/`, 'U+2060']]) {
    const r = prefixProblems(p)
    assert.ok(r.fix.some((s) => s.includes(cp)), `${JSON.stringify(p)}：${r.fix.join('；')}`)
  }
  // 码点写全四位、去重、全部列出、按码点（不是 UTF-16 代理项）。
  const SHY = String.fromCharCode(0xad)
  const s = prefixProblems(`src/${ZW}a${ZW}b${SHY}${WJ}/`).fix.find((x) => x.includes('不可见'))
  assert.ok(s && s.includes('（U+200B、U+00AD、U+2060）'), s)
  const t = prefixProblems(`src/a${String.fromCodePoint(0xe0001)}/`).fix.find((x) => x.includes('不可见'))
  assert.ok(t && t.includes('（U+E0001）'), t)
})

test('要改：U+FEFF 在前缀首尾只报一条「不可见的格式字符」——它也算空白，但不能再让人去找一个并不存在的空格', () => {
  const BOM = String.fromCharCode(0xfeff)
  for (const p of [`${BOM}src/`, `src/${BOM}`]) {
    const r = prefixProblems(p)
    assert.equal(r.fix.length, 1, r.fix.join('；'))
    assert.ok(r.fix[0].includes('U+FEFF') && !r.fix[0].includes('首尾有空白'), r.fix[0])
  }
  assert.ok(prefixProblems(' src/').fix.some((x) => x.includes('首尾有空白')))
})

test('要改：available_roles 缺失、不是数组、有非花名册名字', () => {
  for (const available_roles of [undefined, 'at-backend', ['at-backend', 'at-fronted'], ['at-backend', 5]]) {
    const project = { ...TEMPLATE, available_roles }
    if (available_roles === undefined) delete project.available_roles
    assert.ok(v(project).fix.length > 0, JSON.stringify(available_roles))
  }
})

test('要改：available_roles 里写了不是执行角色的 at-pm、__main__、at-outsider——逐个报要改，不降成请确认', () => {
  for (const name of ['at-pm', '__main__', 'at-outsider']) {
    const r = v({ ...TEMPLATE, available_roles: [...TEMPLATE.available_roles, name] })
    assert.ok(r.fix.some((s) => s.includes(JSON.stringify(name))), `${name}：${all(r)}`)
    assert.ok(!r.confirm.some((s) => s.includes(JSON.stringify(name))), `${name} 不该降成请确认：${all(r)}`)
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

test('请确认：嵌套按段不分大小写比——Windows / macOS 上 Docs/ 实际盖住 docs/ui/', () => {
  const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-product': ['Docs/'] } })
  assert.ok(r.confirm.some((s) => s.startsWith('paths["at-product"]') && s.includes('"at-ui"')), all(r))
  const back = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-product': ['docs/UI/sub/'] } })
  assert.ok(back.confirm.some((s) => s.startsWith('paths["at-ui"]') && s.includes('"at-product"')), all(back))
})

test('请确认：嵌套按 H3 解析后的落点比——前缀里的 .. 先折叠，字面上窄、实际宽的写法照样报，方向不反', () => {
  // H3 的 underAny 用 norm 解析 '..'：'src/server/..' 实际认领整个 src/。
  const wide = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['src/server/..'] } })
  assert.ok(wide.confirm.some((s) => s.startsWith('paths["at-backend"]') && s.includes('"src/server/.."') && s.includes('"at-ios"')), all(wide))
  const web = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['src/web/..'] } })
  assert.ok(web.confirm.some((s) => s.startsWith('paths["at-backend"]') && s.includes('"at-frontend"')), all(web))
  assert.ok(!web.confirm.some((s) => s.startsWith('paths["at-frontend"]') && s.includes('"at-backend"')), `方向反了：${all(web)}`)
  // 'src/ios/../server/' 落在 src/server/，at-ios 的 src/ios/ 并不包含它。
  const back = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['src/ios/../server/'] } })
  assert.ok(!back.confirm.some((s) => s.includes('"at-ios"')), all(back))
})

test('请确认：阻断的前缀不参与嵌套——认领整个根的 at-ios 只报阻断，不再冒出一串「包含」', () => {
  const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-ios': [''] } })
  assert.ok(r.block.some((s) => s.includes('整个项目根')), all(r))
  assert.ok(!r.confirm.some((s) => s.includes('包含')), all(r))
})

test('请确认：嵌套只在 H3 会判、而且整条没作废的条目之间比——at-pm、__main__、拼错的键、整条作废的角色不说「也能写进这一块」', () => {
  for (const extra of [{ 'at-pm': ['docs/'] }, { __main__: ['src/'] }, { 'at-fronted': ['src/'] }, { 'at-frontend': ['src/', '../'] }]) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, ...extra } })
    assert.ok(!r.confirm.some((s) => s.includes('也能写进这一块')), `${JSON.stringify(extra)}：${all(r)}`)
  }
})

test('请确认：前缀落在 Claude Code 会自动加载或执行的地方（.claude/、.git/、根下的 CLAUDE.md 之类）', () => {
  const hit = ['.claude/', '.claude/commands/', '.git/', '.git', 'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', 'x/../.claude/']
  if (WIN || process.platform === 'darwin') hit.push('.CLAUDE/', 'claude.md')
  for (const p of hit) {
    const r = prefixProblems(p)
    assert.ok(r.confirm.length > 0, JSON.stringify(p))
    assert.deepEqual(r.block, [], `${JSON.stringify(p)} 不阻断：可能是有意的`)
  }
  // 文件只认项目根下那几个：子目录里的同名文件、名叫 CLAUDE.md 的目录都不报（理由在 project.mjs 的 AUTOLOADED 注释）。
  for (const p of ['.github/', '.gitignore', '.claude-plugin/', 'docs/.claude-notes/', 'src/CLAUDE.md.bak', 'packages/app/.mcp.json', 'CLAUDE.md/notes/']) {
    assert.deepEqual(prefixProblems(p).confirm, [], JSON.stringify(p))
  }
  // POSIX 上 '.claude\x' 是项目根下一个名字带反斜杠的文件，不在 .claude/ 下。
  for (const platform of ['linux', 'darwin']) assert.deepEqual(prefixProblems(`.claude${BS}x`, { platform }).confirm, [], platform)
})

test('请确认：前缀以 / 开头——门禁把它当相对项目根，写成相对的更清楚', () => {
  assert.ok(prefixProblems('/src/server/').confirm.length > 0)
})

test('__main__ 的键：请确认，门禁在进 H3 之前豁免主线程；at-outsider 的键：要改，它是测试替身——两句说的机制不同', () => {
  const main = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, __main__: ['x/'] } })
  assert.ok(main.confirm.some((s) => s.includes('"__main__"') && s.includes('主线程')), all(main))
  const outsider = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-outsider': ['x/'] } })
  assert.ok(outsider.fix.some((s) => s.includes('"at-outsider"') && s.includes('测试替身')), all(outsider))
  // 门禁会拿 at-outsider 的键判它（挡住它的是工具面），不能再说「门禁不会拿这个键去判」。
  assert.ok(!all(outsider).includes('门禁不会拿这个键去判'), all(outsider))
})

// ---- 花名册读坏时 ----

test('花名册读坏时：单列一条插件问题——不是 project.json 的问题、改它修不好，停下让用户重装；不核对角色名，不混进三档', () => {
  for (const roster of [{}, [], null, ['at-backend']]) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-fronted': ['x/'] } }, roster)
    assert.ok(!all(r).includes('at-fronted'), JSON.stringify(roster))
    // H1 拒一切派发、H3 拒 PM 与没有键的 at-qa、at-acceptance 以外的角色：不可能是「有意的」；改 project.json
    // 又修不好它，所以不进三档（【project.json】那一段的首句叫人整份重写、结尾叫人改到没有为止）。
    assert.equal(r.plugin.length, 1, JSON.stringify(r))
    const p = r.plugin[0]
    for (const k of ['roster.json', '这不是 project.json 的问题', '改它修不好', '没有键的']) assert.ok(p.includes(k), `${k}：${p}`)
    assert.match(p, /重装|更新/)
    // H3 的第 2 步排在第 3 步之前：没有键的 at-qa、at-acceptance 在花名册读坏时照样放行。
    for (const role of NO_PATHS_ROLES) assert.ok(p.includes(role), `${role}：${p}`)
    assert.ok(!all(r).includes('roster.json'), all(r))
    // 花名册读坏时 available_roles 里的名字没法核对，也不该被报成「不是花名册里的角色名」。
    assert.deepEqual([r.block, r.fix, r.confirm], [[], [], []], all(r))
  }
  // 执行角色键上的阻断照报：读坏是暂时的，重装之后这些键照常被判，不先降成要改。
  for (const roster of [{}, null]) {
    const r = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['../'] } }, roster)
    assert.ok(r.block.some((s) => s.includes('"../"')), all(r))
  }
  assert.deepEqual(v(TEMPLATE).plugin, [])
})

// ---- 外部值不另起一行（docs/27）----

test('键、前缀、available_roles 里的值带换行字符，也不会让任何一条另起一行', () => {
  const breaks = [10, 13, 0x85, 0x2028, 0x2029].map((c) => String.fromCharCode(c))
  for (const b of breaks) {
    const cases = [
      [{
        ...TEMPLATE,
        available_roles: [...TEMPLATE.available_roles, `x${b}伪造`],
        paths: { ...TEMPLATE.paths, [`k${b}伪造`]: [`p${b}伪造/`], 'at-backend': [`../${b}伪造`] },
      }, ROSTER],
      // paths、available_roles 本身是带换行的字符串。
      [{ ...TEMPLATE, paths: `p${b}伪造`, available_roles: `a${b}伪造` }, ROSTER],
      // 嵌套提醒：两条前缀带载荷。嵌套只在 H3 会判的键之间比，键是花名册里的角色名，没有载荷可带。
      [{ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-product': [`n${b}伪造/`], 'at-architect': [`n${b}伪造/y/`] } }, ROSTER],
      // 花名册读坏时 available_roles 的名字只进「paths 里却没有它的键」那一句。
      [{ ...TEMPLATE, available_roles: [...TEMPLATE.available_roles, `x${b}伪造`] }, {}],
    ]
    for (const [project, roster] of cases) {
      const r = v(project, roster)
      for (const s of [...r.block, ...r.fix, ...r.confirm, ...r.plugin]) {
        assert.ok(!breaks.some((c) => s.includes(c)), JSON.stringify(s))
      }
      assert.ok(all(r).includes('伪造'), `载荷没进任何一条——这条判据什么都没测：${JSON.stringify(project).slice(0, 80)}`)
    }
  }
  // 嵌套那一格要真的出了嵌套提醒，不然它没测到嵌套那几处 quote。
  const n = v({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-product': ['n伪造/'], 'at-architect': ['n伪造/y/'] } })
  assert.ok(n.confirm.some((s) => s.includes('包含')), all(n))
})
