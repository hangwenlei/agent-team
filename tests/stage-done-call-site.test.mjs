// `isStageDone` 的**调用点**：`hooks/gate.mjs` 里每一处都必须按 `roster` 收窄
//
// 来历（`docs/11` §5.33）：M2a §1.1 裁定（`docs/11` §5.7）让 `isStageDone` 与
// `compareArtifacts` 按 **`roster ∩ producers`** 展开——「这一趟实际派到的执行角色都交了
// 才算 done」。那条裁定写下的时候，`isStageDone` 在 `hooks/gate.mjs` 里**只有一处调用**，
// 就是 ledger 分支那处（【阶段】提示用）。后来 M2a Task 6 在 deliverable 分支**新增**了
// 第二处并且传了 `roster`，**而裁定原本点名的那一处一直没传**。
//
// 后果不是误报，**是哑掉**：`stageRolesInRun(stage, undefined)` 退回**全部 producers**，
// 于是任何有产者被裁剪的阶段**结构上永远不 `done`**，【阶段】那条提示对那些阶段一次也不发。
// 实测在 `docs/20` §7.8（S1→S8 整链那一趟：`roster` 六个、`at-ui` 被裁、
// `at-ios`/`at-android` 不在 `available_roles` → S2 与 S5 整趟【阶段】零条，
// PM 把 S2→S3、S5→S6 两次推进完全无提示地做掉了）。
//
// ⚠️ **这条判据为什么必须存在，而不是「把那个参数补上就完了」**：
// 上一轮守这件事的东西**已经在场**，而且逐字点对了名——deliverable 分支那处调用上方写着
//
// > 同一轮一起改的——两处都改，是因为本仓库最稳定的那个失败模式就是
// > 「更正只作用到它逐字点名的那一句上」。**改一处的时候去看另一处。**
//
// **而它点名的那一处（ledger 分支）正是没改的那一处。** 一条注释不是一条判据——
// 这句话此前在本仓库是一条论断，现在有实物了。**所以这一轮补的不是参数，是判据。**
//
// ⚠️ **改动前这个缺陷对整套测试完全不可观测**（实跑核过：把 `roster` 补上去，
// 799 条全绿、一条没红）。行为那一侧的补法在 `tests/gate-ledger.test.mjs` 的两条
// 「M3k：……」用例里（成对：该发的时候发 / 不该发的时候不发）。
// **本文件钉的是另一层：每一处调用都收窄**，它不看行为，看源码派生出来的调用点清单。
// 两层缺一不可——行为那两条只覆盖 ledger 这一处，deliverable 那一处将来被谁改回去，
// 它们一个字都不会说。
//
// 写法仿 `tests/drift-call-site.test.mjs`（同一族：钉 `hooks/` 下某个函数的调用点），
// 抽取器写成本文件内的具名函数，**主判据与锚共用同一份**
// （`docs/16` §3.2：锚要钉在判据真正进入 assert 的那一层）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const HOOKS = new URL('../hooks/', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, HOOKS), 'utf8')

// `hooks/` 下的全部 .mjs —— **从目录读出来，不硬编码文件名**。硬编码的话，将来新增一个
// 模块时这份清单会停在旧值，而「停在旧值」在这里的表现是**静默放宽**：新模块里多出来的
// 一处调用不在扫描面内，这条判据对它永远沉默（与 `tests/drift-call-site.test.mjs`
// 同一条理由，不在这里抄第二份论证）。
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

// 一行算不算**调用**。排掉三类同样含 `isStageDone(` 字样的行：
//   · 定义行（`export function isStageDone(`）——`hooks/lib/state.mjs` 那一处；
//   · 整行注释（`//` 或 ` * ` 开头）——本仓库的注释里到处提这个名字，
//     `hooks/lib/coverage.mjs` 头部甚至写着 `isStageDone(S2) = true` 这种带括号的例子；
//   · `import { … isStageDone } from …` 天然不匹配（名字后面没有左括号），不需要另排。
//
// ⚠️ **已知的不精确，方向是有意的**：一行代码**尾部**的注释里出现 `isStageDone(` 会被
// 算成一次调用（只排整行注释，不排行尾注释——那要真的分词）。**多报的方向是安全的**
// ——它让人来看一眼，而漏报会让这条判据静默失效。这一条是
// `tests/drift-call-site.test.mjs` 做变异时撞出来的，照抄它的裁定。
function isCallLine(line) {
  const t = line.trim()
  if (t.startsWith('//') || t.startsWith('*')) return false
  if (/function\s+isStageDone\s*\(/.test(t)) return false
  return /\bisStageDone\s*\(/.test(t)
}

// `hooks/gate.mjs` 的 `main()` 里，每个检查项分支是一条**顶层（两空格缩进）**的
// `if (CHECK === …) {`。把源码按这些行切成若干「分支区」：一条调用落在哪个区里，
// 就是它被哪个 CHECK 守着。
//
// ⚠️ 为什么不用「往前找最近的一处 `CHECK === '…'`」那种更省事的写法：那种写法认的是
// **调用自己那一行的守卫**，整个表达式被搬进另一个分支时它照样绿——而「搬到别的分支」
// 正是这类判据要拦的头号变异。按区切才钉得住「它在哪个分支里」这一层。
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

// ⭐ 这条判据比 `drift-call-site` 多出来的那一层：**这一处调用的实参里有没有 `roster`**。
//
// 做法是**括号配平**：从 `isStageDone` 后面那个 `(` 开始往后数括号，数到配平为止，
// 中间那一段就是实参原文（`isStageDone({…})` 是多行写的，所以不能按行判）。
//
// ⚠️ **为什么必须按括号配平、不能按「附近几行里有没有 roster」**：后者会把调用**外面**
// 的一个 `roster:`（比如紧接着那次 `buildLedgerNotices({ … })` 的实参）算进来，
// 于是把 `roster` 从 `isStageDone` 上删掉这个**唯一要拦的变异**照样全绿。
// 下面「锚：`roster` 出现在调用括号外面不算」那一条钉的就是这一层。
//
// ⚠️ **已知的不精确**：配平不认字符串字面量与注释，所以实参里出现一个落单的 `)`
// （写在字符串或注释里）会让它数错。今天两处调用的实参里都没有，**而且数不出来时它回
// `'unparsed'`，不回 `false`** ——两种都会让下面的 deepEqual 变红，但红的理由不同，
// 所以不压成同一个值（数错被当成「没传 roster」是最坏的结果：修的人会去补一个已经在的参数）。
function argTextOf(text, fromIdx) {
  const open = text.indexOf('(', fromIdx)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return null
}

// 实参里有没有把 `roster` 作为一个键传进去。认两种合法写法：
//   · `roster: <表达式>`（今天两处都是这种）
//   · `{ …, roster }`（简写；将来有人这么重构，判据不该因此变红）
// **不认** `ctx.state.roster` 这种出现在**值**里面的——前面是 `.`，正则要求 `roster`
// 前面是行首、`{`、`,` 或空白。
function passesRoster(argText) {
  if (typeof argText !== 'string') return 'unparsed'
  return /(?:^|[{,\s])roster\s*(?::|,|\}|$)/.test(argText)
}

// 主判据与全部锚**共用这一份**：返回 `hooks/` 下每一处调用的 `{ file, checks, roster }`。
// `checks` 是守着它的那个分支声明的检查项名字数组，不在任何分支区里时为 `null`。
// ⚠️ **行号是从 `text` 自己数出来的，不靠 `line.length` 累加。** 初稿正是那么写的
// （`offset += line.length + 1`），而 `hooks/gate.mjs` 的行尾是 **CRLF**：
// `split(/\r?\n/)` 把 `\r` 一起吃掉了，累加因此每行少算一个字节，两处调用的起点各漂了
// 几十上百字节，`argTextOf` 抠出来的是**别处**的实参（实测抠到的是
// `stageRolesInRun(stage, undefined)` 与 `...`），于是两处都被判成「没传 roster」
// ——**一条本该全绿的判据在正确的源码上报了两条违规**。
// `docs/11` §5.28（本仓库的换行符是混的，而锚串匹配是主要手段）在这里是**字面**咬上的。
function callSites(sources) {
  const out = []
  for (const { file, text } of sources) {
    const { lines, regions } = branchRegions(text)
    const re = /\bisStageDone\s*\(/g
    let m
    while ((m = re.exec(text)) !== null) {
      const lineIdx = text.slice(0, m.index).split(/\r?\n/).length - 1
      if (!isCallLine(lines[lineIdx] ?? '')) continue
      const region = regions.find((r) => lineIdx >= r.start && lineIdx < r.end)
      out.push({ file, checks: region ? region.checks : null, roster: passesRoster(argTextOf(text, m.index)) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// ⭐ 主判据一：调用点清单 —— **列举，不报总数**（`docs/16` §3.1）
// ---------------------------------------------------------------------------
//
// deepEqual 一份清单：多一处调用、少一处调用、换个文件、搬到别的分支区，全都红。
// `roster` 一起钉在同一个 deepEqual 里，**不拆成「先数调用点、再另写一条数参数」**
// ——拆开的话「新增一处不传 roster 的调用」会只红一条，而它同时违反了两件事。
test('docs/11 §5.33：hooks/ 下 isStageDone 只有两处调用，都在 hooks/gate.mjs，且两处都按 roster 收窄', () => {
  assert.deepEqual(
    callSites(hookSources()),
    [
      { file: 'hooks/gate.mjs', checks: ['ledger'], roster: true },
      { file: 'hooks/gate.mjs', checks: ['stop-gate', 'deliverable'], roster: true },
    ],
    'isStageDone 的每一处调用都必须按 roster 收窄（M2a §1.1 裁定，docs/11 §5.7）。\n' +
      '  不传它的后果不是误报，**是哑掉**：stageRolesInRun(stage, undefined) 退回全部\n' +
      '  producers，任何有产者被裁剪的阶段结构上永远不 done——ledger 分支那条【阶段】\n' +
      '  提示（「H5 哑掉」的两条对策之一）对那些阶段一次也不发。实测 docs/20 §7.8。\n' +
      '  ⚠️ roster 是 "unparsed" 说明括号配平没数出实参，不是「没传」——先看抽取器，\n' +
      '  不要去补一个已经在的参数。\n' +
      '  要新增一处调用、或者判定某一处**有意不收窄**，去 docs/11 §5.33 把理由写下来，\n' +
      '  再改这份清单。',
  )
})

// ---------------------------------------------------------------------------
// ⭐ 已知违规样本锚：判据必须认得出它存在的理由
// ---------------------------------------------------------------------------
//
// 光证明它在今天的源码上是绿的，证不了它认得出违规。这里用的是**改动前 BASE
// (`21ea786`) 上那段源码的逐字原文**——真正那个缺陷，不是一个想象出来的变异。
test('锚：BASE 上 ledger 分支那次调用的逐字原文，判据报 roster: false', () => {
  const mutated = [
    'function main() {',
    "  if (CHECK === 'ledger') {",
    '    const stageDone = isStageDone({',
    '      stage: ctx.state?.stage,',
    '      stages: ctx.stages,',
    '      artifactExists: ctx.artifactExists,',
    '    })',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/gate.mjs', text: mutated }]), [
    { file: 'hooks/gate.mjs', checks: ['ledger'], roster: false },
  ])
})

// ⭐ 锚：**CRLF 与 LF 两种行尾必须给出同一个答案。**
//
// 这一条不是凑数的：`hooks/gate.mjs` 的行尾就是 CRLF，而本文件初稿的抽取器靠
// `line.length + 1` 累加行首偏移，在 CRLF 下每行少算一个字节，于是它在**正确的源码上
// 报了两条违规**。`docs/11` §5.28 那条（本仓库换行符是混的）在这里是字面咬上的。
//
// ⚠️ **这条锚的第一版是装饰性的，是做变异时当场发现的。** 第一版拿一份八行的合成样本
// 比 LF 与 CRLF，而把抽取器换回累加写法之后它**照样绿**：样本太短，漂掉的那几个字节
// 还落在同一个 `(` 之前，`indexOf('(')` 找到的仍然是那一个。
// **一条锚在它唯一要拦的那个变异下全绿 = 它什么也没守住**（`docs/16` §3.2）。
// 现在改成拿**真实 `hooks/gate.mjs`** 比：同一份内容、只换行尾，答案必须一样。
// 真实文件足够长，漂移一定跨过别的括号——累加写法下 LF 那一侧对、CRLF 那一侧错，
// 两边不等，**当场红**（重跑那个变异核过了）。
test('锚：真实 gate.mjs 只换行尾，抽取器给出同一个答案（docs/11 §5.28）', () => {
  const lfText = read('gate.mjs').replace(/\r\n/g, '\n')
  const crlfText = lfText.replace(/\n/g, '\r\n')
  const lf = callSites([{ file: 'hooks/gate.mjs', text: lfText }])
  const crlf = callSites([{ file: 'hooks/gate.mjs', text: crlfText }])
  // 先钉非空：两边都空时 deepEqual 同样成立（`docs/16` §3.2 那条「零次断言」）。
  assert.ok(lf.length > 0, '在 LF 版的真实 gate.mjs 上一处调用都没抠出来——先看抽取器')
  assert.deepEqual(
    crlf,
    lf,
    '同一份源码换个行尾就给出不同答案——抽取器多半在按 line.length 累加行首偏移，' +
      '而 CRLF 下 split(/\\r?\\n/) 把 \\r 吃掉了，每行少算一个字节。docs/11 §5.28。',
  )
})

// ⭐ 锚：`roster` 出现在调用**括号外面**不算。
// 少了这条，`argTextOf` 退化成「往后看几行」时上面那条已知违规样本会变绿——因为真实
// 的 gate.mjs 里，那次 isStageDone 调用后面紧跟的就是一次带 roster 的
// buildLedgerNotices/compareArtifacts 实参。**这是这条判据唯一的真正难点所在。**
test('锚：紧跟在调用后面的另一次 roster 传参，不算这一处传了', () => {
  const sample = [
    'function main() {',
    "  if (CHECK === 'ledger') {",
    '    const stageDone = isStageDone({',
    '      stage: ctx.state?.stage,',
    '      artifactExists: ctx.artifactExists,',
    '    })',
    '    const notices = buildLedgerNotices({',
    '      roster: Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined,',
    '    })',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/gate.mjs', text: sample }])[0].roster, false)
})

// ⭐ 锚：`ctx.state.roster` 只出现在**值**里、没有 `roster` 这个键时，不算传了。
// 这一条钉 `passesRoster` 的正则里「前面不能是 `.`」那一半。少了它，把
// `roster: …` 改成 `artifactExists: (p) => f(ctx.state.roster, p)` 这种（参数没了、
// 字样还在）会被判成传了。
test('锚：roster 只出现在值里（ctx.state.roster）而没有这个键时，判据报 false', () => {
  assert.equal(passesRoster('{ stage: s, artifactExists: (p) => g(ctx.state.roster, p) }'), false)
})

// ⭐ 锚：简写 `{ roster }` 算传了 —— 判据不该因为一次无害的重构变红。
test('锚：对象简写 { roster } 算按 roster 收窄', () => {
  assert.equal(passesRoster('{ stage, stages, artifactExists, roster }'), true)
  assert.equal(passesRoster('{ stage, roster, stages }'), true)
})

// ⭐ 抽取器锚：定义行、整行注释、import 行都不算调用点。
// 少了这条，`isCallLine` 退化成「含这个名字就算」时，上面那条主判据会因为
// `hooks/lib/state.mjs` 的定义行、`hooks/lib/coverage.mjs` 头部那行
// `isStageDone(S2) = true` 的注释、以及满仓库的注释而恒红——那种红指不到任何真问题。
test('锚：定义行、整行注释、import 行都不算调用点', () => {
  const sample = [
    '// 注释里写 isStageDone(S2) = true 不算',
    ' * docstring 里写 isStageDone({stage, stages}) 也不算',
    "import { validateState, isStageDone } from './lib/state.mjs'",
    'export function isStageDone({ stage, stages, artifactExists, roster }) {',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/lib/state.mjs', text: sample }]), [])
})

// ⭐ 抽取器锚：`branchRegions` 在**真实** gate.mjs 上确实切出了不止一个区，
// 而且 `ledger` 与 H5 那个区都在。
// 少了这条，主判据里那两个 `checks` 值可能只是因为**整份文件只有一个区**——那时它
// 什么也没守住（`docs/16` §3.2：把判据换成零次迭代，看锚还绿不绿）。
test('锚：branchRegions() 在真实 gate.mjs 上切出多个分支区，其中有 ledger 与 deliverable', () => {
  const names = branchRegions(read('gate.mjs')).regions.map((r) => r.checks.join('|'))
  assert.ok(names.length > 1, `切出来的分支区只有 ${names.length} 个：${names.join('、')}`)
  assert.ok(names.includes('ledger'), `切出来的分支区里没有 ledger：${names.join('、')}`)
  assert.ok(
    names.some((n) => n.split('|').includes('deliverable')),
    `切出来的分支区里没有 deliverable：${names.join('、')}`,
  )
})
