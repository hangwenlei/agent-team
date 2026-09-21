// 账本比对的**调用点位置** —— `docs/11` §5.23 四欠下的那条判据
//
// 来历：§5.23 记的是「账本比对的采样点是**下一次派发**那一刻，而它回传给的是**派发者**，
// 不是 PM」。那一节第四小节自己写着这条判据**配**机械判据、**写得出来而且便宜**：
//
// > 钉「`compareArtifacts` 在 `hooks/` 下只有一处调用，且那一处在 `CHECK === 'deliverable'`
// > 分支里」。它从源码派生（不抄第二份清单），今天就红得起来——把那一处挪进 ledger 分支、
// > 或者再加一处调用，它当场变红并指到这一节。
//
// 当时没写的理由是「这一轮的裁定是只记录、不加测试——**写出来是下一轮的事，不是永远
// 不做**」。**这里就是那一轮**（M3b 修复轮 1）。
//
// ⚠️ **它钉不住的那一半，§5.23 四写清楚了，不在这里重复第二遍**：这条判据钉的是
// **调用点的位置**，钉不住「那个事件什么时候触发」——`PostToolUse:Agent` 在派发**启动**
// 那一帧触发是**平台行为**，仓库里没有任何东西能断言它。平台哪天改成「返回时触发」，
// 这条判据**全绿**，而 §5.23 的全部内容当场作废。所以那一节的 CLI 版本号是承重的。
//
// 为什么这条判据值得存在（它不是「数一数调用点」这种整洁题）：**调用点的位置同时决定了
// 这条回传的触发频率与收件人**。挪进 ledger 的 `kind === 'state'` 分支，收件人从「派发者」
// 变成「刚写完 state.json 的那个人」；挪去 `SubagentStop`，`additionalContext` 这条通道
// 根本不存在（`hooks/gate.mjs` 自己的注释写着它走 stderr 契约）。三处各有已经写下来的
// 理由，改动任何一处都得把那些理由重新论证一遍——这条判据就是那个「停一下」的闸。
//
// 写法仿 `tests/docs-exemption-format.test.mjs`：**抽取器写成本文件内的具名函数，
// 主判据与锚共用同一份**（`docs/16` §3.2：锚要钉在判据真正进入 assert 的那一层）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const HOOKS = new URL('../hooks/', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, HOOKS), 'utf8')

// `hooks/` 下的全部 .mjs —— **从目录读出来，不硬编码文件名**。硬编码的话，将来新增一个
// 模块时这份清单会停在旧值，而「停在旧值」在这里的表现是**静默放宽**：新模块里多出来的
// 一处调用不在扫描面内，这条判据对它永远沉默（`tests/helpers/command-names.mjs` 记过
// 同一条，`tests/helpers/expected-agents.mjs` 记的是它的另一面「没有身份锚点」）。
function hookSources() {
  const out = []
  for (const f of readdirSync(HOOKS).sort()) {
    if (f.endsWith('.mjs')) out.push({ file: `hooks/${f}`, text: read(f) })
  }
  for (const f of readdirSync(new URL('lib/', HOOKS)).sort()) {
    if (f.endsWith('.mjs')) out.push({ file: `hooks/lib/${f}`, text: read(`lib/${f}`) })
  }
  return out
}

// 一行算不算**调用**。排除两类同样含 `compareArtifacts(` 字样的行：
//   · 定义行（`export function compareArtifacts(`）——`hooks/lib/artifact-drift.mjs` 那一处；
//   · 注释行（`//` 开头）——本仓库的注释里到处提这个名字，把它们数进来这条判据会恒红。
// ⚠️ `import { compareArtifacts } from …` 天然不匹配（名字后面没有左括号），不需要另排。
//
// ⚠️ **已知的不精确，方向是有意的**：一行代码**尾部**的注释里出现 `compareArtifacts(`
// 会被算成一次调用（只排掉整行注释，不排行尾注释——那要真的分词）。这是做这条判据的
// 变异时撞出来的：一条写着 `const driftNotice = null // MUTANT：原来这里是
// compareArtifacts(...)` 的变异行把自己数成了第二处调用。**多报的方向是安全的**
// ——它让人来看一眼，而漏报会让这条判据静默失效。
function isCallLine(line) {
  const t = line.trim()
  if (t.startsWith('//') || t.startsWith('*')) return false
  if (/function\s+compareArtifacts\s*\(/.test(t)) return false
  return /\bcompareArtifacts\s*\(/.test(t)
}

// `hooks/gate.mjs` 的 `main()` 里，每个检查项分支是一条**顶层（两空格缩进）**的
// `if (CHECK === …) {`。把源码按这些行切成若干「分支区」：一条调用落在哪个区里，
// 就是它被哪个 CHECK 守着。
//
// ⚠️ 为什么不用「往前找最近的一处 `CHECK === '…'`」那种更省事的写法：那种写法认的是
// **调用自己那一行的守卫**，`const x = CHECK === 'deliverable' ? f(...) : null` 这个
// 表达式整体被搬进 ledger 分支时它**照样绿**——而「搬进 ledger 分支」正是这条判据要拦的
// 头号变异。按区切才钉得住「它在哪个分支里」这一层。
function branchRegions(text) {
  const lines = text.split(/\r?\n/)
  const regions = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}if \(CHECK === (.+)\) \{$/)
    if (!m) continue
    regions.push({ checks: m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)), start: i, end: lines.length })
    if (regions.length > 1) regions[regions.length - 2].end = i
  }
  return { lines, regions }
}

// 主判据与三条锚**共用这一份**：返回 `hooks/` 下每一处调用的 { file, checks }。
// `checks` 是守着它的那个分支声明的检查项名字数组；不在任何分支区里（或者不在 gate.mjs
// 里）时为 `null`——两者都该让下面的断言变红，但红的理由不同，所以不压成同一个值。
function callSites(sources) {
  const out = []
  for (const { file, text } of sources) {
    const { lines, regions } = branchRegions(text)
    lines.forEach((line, i) => {
      if (!isCallLine(line)) return
      const region = regions.find((r) => i >= r.start && i < r.end)
      out.push({ file, checks: region ? region.checks : null })
    })
  }
  return out
}

// ⭐ 主判据一：**列举，不报总数**（`docs/16` §3.1）——deepEqual 一份清单，
// 多一处调用、少一处调用、换个文件，三种改动都红。
test('docs/11 §5.23 四：compareArtifacts 在 hooks/ 下只有一处调用，就在 hooks/gate.mjs', () => {
  assert.deepEqual(
    callSites(hookSources()).map((c) => c.file),
    ['hooks/gate.mjs'],
    'compareArtifacts 的调用点位置决定了账本回传的触发频率与收件人（docs/11 §5.23）——' +
      '新增或搬动调用点要先把 §5.23 三那几条理由重新论证一遍',
  )
})

// ⭐ 主判据二：那一处落在哪个分支区里。
// ⚠️ 期望值是 ['stop-gate', 'deliverable'] 而不是 ['deliverable']：两道 H5 共用同一个
// 分支头，而调用本身另有一层 `CHECK === 'deliverable'` 三元把 stop-gate 排掉（H5b 走
// SubagentStop 的 stderr 契约，没有 additionalContext 这条通道，算了也没地方发）。
// **这条钉的是分支区，不是那层三元**——三元那一层由 tests/gate-deliverable.test.mjs 的
// 子进程级用例钉着。写成 ['deliverable'] 会是一条从第一天起就红的假判据。
test('docs/11 §5.23 四：那一处调用在 H5 那个分支区里（CHECK === deliverable 与 stop-gate 共用的那个）', () => {
  assert.deepEqual(callSites(hookSources())[0].checks, ['stop-gate', 'deliverable'])
})

// ⭐ 已知违规样本锚：判据必须认得出「调用被搬进 ledger 分支」。
// 光证明它在今天的源码上是绿的，证不了它认得出违规。这是 §5.23 四自己点名的那个变异
// （「把那一处挪进 ledger 分支」）。
test('锚：把那一处挪进 ledger 分支时，判据报的是 ledger——这条判据认得出它要拦的那个变异', () => {
  const mutated = [
    'function main() {',
    "  if (CHECK === 'ledger') {",
    '    const x = compareArtifacts({})',
    '  }',
    '',
    "  if (CHECK === 'stop-gate' || CHECK === 'deliverable') {",
    '    const y = 1',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/gate.mjs', text: mutated }]), [
    { file: 'hooks/gate.mjs', checks: ['ledger'] },
  ])
})

// ⭐ 抽取器锚二：定义行与注释行不算调用。少了这条，`isCallLine` 退化成「含这个名字就算」
// 时，上面两条会因为 `hooks/lib/artifact-drift.mjs` 的定义行与满仓库的注释而恒红——
// 那种红指不到任何真问题。
test('锚：定义行与注释行不算调用点', () => {
  const sample = [
    '// 注释里提到 compareArtifacts({...}) 不算',
    'import { compareArtifacts } from ./lib/artifact-drift.mjs',
    'export function compareArtifacts({ artifacts }) {',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/lib/artifact-drift.mjs', text: sample }]), [])
})

// ⭐ 抽取器锚三：`branchRegions` 在**真实** gate.mjs 上确实切出了不止一个区。
// 少了这条，「那一处落在 deliverable 区」可能只是因为**整份文件只有一个区**——那时它
// 什么也没守住（`docs/16` §3.2：把判据换成零次迭代，看锚还绿不绿）。
// 这里同时钉住「ledger 区真的存在」：它正是上面那条已知违规样本要搬进去的地方，
// 它不在了，那条锚守的就是一个不存在的搬动。
test('锚：branchRegions() 在真实 gate.mjs 上切出多个分支区，其中有 ledger', () => {
  const names = branchRegions(read('gate.mjs')).regions.map((r) => r.checks.join('|'))
  assert.ok(names.length > 1, `切出来的分支区只有 ${names.length} 个：${names.join('、')}`)
  assert.ok(names.includes('ledger'), `切出来的分支区里没有 ledger：${names.join('、')}`)
})
