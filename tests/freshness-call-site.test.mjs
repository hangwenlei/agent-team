// 交没交、齐没齐的三个纯函数（isStageDone、decideDeliverable、decideReadiness）的**调用点**：hooks/ 下每一处都必须经 freshness
// （M3y，docs/33，全量审查第 15 条）。
//
// 返工轮里上一轮的产物都还在磁盘上。三个函数只问调用方注入的 artifactExists；调用点传 ctx.artifactExists（只问文件在不在），
// 上一轮的产物就被算成这一轮交的、这一段齐了。每一处调用的 artifactExists 实参都必须是 fresh.artifactCurrent，decideDeliverable
// 与 decideReadiness 还要传 artifactStale: fresh.isStale（「缺」与「还是上一轮的」分开说）；fresh 在同一个分支里由
// makeFreshness 造、reworkBase 取 ctx.state?.rework_base。
//
// 行为那一层在 tests/gate-rework-freshness.test.mjs（每一处调用各有一格）。这里钉另一层：**将来新增一处调用**时，它照旧传
// ctx.artifactExists，行为判据一个字都不会说——那一处根本没有夹具。写法仿 tests/stage-done-call-site.test.mjs（同一族：
// 按源码派生调用点清单，主判据与锚共用同一份抽取器）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const HOOKS = new URL('../hooks/', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, HOOKS), 'utf8')
const FNS = ['isStageDone', 'decideDeliverable', 'decideReadiness']

// hooks/ 下的全部 .mjs——从目录读，不硬编码文件名（新模块里多出来的一处调用要落进扫描面）。
function hookSources() {
  const out = []
  for (const f of readdirSync(HOOKS).sort()) if (f.endsWith('.mjs')) out.push({ file: `hooks/${f}`, text: read(f) })
  for (const f of readdirSync(new URL('lib/', HOOKS)).sort()) {
    if (f.endsWith('.mjs')) out.push({ file: `hooks/lib/${f}`, text: read(`lib/${f}`) })
  }
  return out
}

// 一行算不算调用：排掉整行注释与定义行。行尾注释里出现函数名加括号会被多算——多报让人来看一眼，方向是安全的。
function isCallLine(line, fn) {
  const t = line.trim()
  if (t.startsWith('//') || t.startsWith('*')) return false
  if (new RegExp(`function\\s+${fn}\\s*\\(`).test(t)) return false
  return new RegExp(`\\b${fn}\\s*\\(`).test(t)
}

// hooks/gate.mjs 的 main() 里每个检查项分支是一条顶层（两空格缩进）的 `if (CHECK === …) {`；按这些行切区，
// 一处调用落在哪个区里就是被哪个检查项守着，fresh 也要在同一个区里造。
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

// 从函数名后面那个 `(` 起数括号到配平，中间是实参原文。数不出来回 null（下面判成 'unparsed'，不压成 false）。
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

const CURRENT_RE = /(?:^|[{,\s])artifactExists\s*:\s*fresh\.artifactCurrent\b/
const STALE_RE = /(?:^|[{,\s])artifactStale\s*:\s*fresh\.isStale\b/
const MAKE_RE = /const fresh = makeFreshness\(\{[^}]*\bartifactExists:\s*ctx\.artifactExists\b[^}]*\bartifactBytes:\s*ctx\.artifactBytes\b[^}]*\breworkBase:\s*ctx\.state\?\.rework_base\b[^}]*\}\)/

// 每一处调用：{ file, fn, checks, current, stale, made }。stale 只对后两个函数有意义，isStageDone 记 null。
function callSites(sources) {
  const out = []
  for (const { file, text } of sources) {
    const { lines, regions } = branchRegions(text)
    for (const fn of FNS) {
      const re = new RegExp(`\\b${fn}\\s*\\(`, 'g')
      let m
      while ((m = re.exec(text)) !== null) {
        const lineIdx = text.slice(0, m.index).split(/\r?\n/).length - 1
        if (!isCallLine(lines[lineIdx] ?? '', fn)) continue
        const region = regions.find((r) => lineIdx >= r.start && lineIdx < r.end)
        const args = argTextOf(text, m.index)
        const before = region ? lines.slice(region.start, lineIdx).join('\n') : ''
        out.push({
          file,
          fn,
          checks: region ? region.checks : null,
          current: typeof args === 'string' ? CURRENT_RE.test(args) : 'unparsed',
          stale: fn === 'isStageDone' ? null : typeof args === 'string' ? STALE_RE.test(args) : 'unparsed',
          made: MAKE_RE.test(before),
        })
      }
    }
  }
  return out
}

// ⭐ 主判据：调用点清单——列举，不报总数（docs/16 §3.1）。多一处、少一处、换个分支、实参不经 freshness，都红。
test('M3y：hooks/ 下交没交、齐没齐的每一处调用都经 freshness（artifactCurrent，decideDeliverable/decideReadiness 另传 isStale）', () => {
  const got = callSites(hookSources())
  const want = [
    { file: 'hooks/gate.mjs', fn: 'isStageDone', checks: ['ledger'], current: true, stale: null, made: true },
    { file: 'hooks/gate.mjs', fn: 'isStageDone', checks: ['stop-gate', 'deliverable'], current: true, stale: null, made: true },
    { file: 'hooks/gate.mjs', fn: 'decideDeliverable', checks: ['stop-gate', 'deliverable'], current: true, stale: true, made: true },
    { file: 'hooks/gate.mjs', fn: 'decideReadiness', checks: ['readiness'], current: true, stale: true, made: true },
  ]
  const key = (s) => `${s.fn}|${s.checks}`
  assert.deepEqual(
    [...got].sort((a, b) => key(a).localeCompare(key(b))),
    [...want].sort((a, b) => key(a).localeCompare(key(b))),
    '交没交、齐没齐的判据在返工轮里要分得出上一轮的产物（docs/33）：artifactExists 传 fresh.artifactCurrent，\n' +
      '  decideDeliverable 与 decideReadiness 另传 artifactStale: fresh.isStale，fresh 在同一个分支里由\n' +
      '  makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base }) 造。\n' +
      '  "unparsed" 是括号配平没数出实参，先看抽取器。要新增一处调用，先在 docs/33 写下它为什么（不）经 freshness，再改这份清单。',
  )
})

// ⭐ 锚：v1.6.0 上 ledger 那次调用的逐字原文——只问文件在不在。第 15 条的缺陷就是这一行，判据必须认得出它。
test('锚：v1.6.0 的逐字原文（artifactExists: ctx.artifactExists），判据报 current: false、made: false', () => {
  const v160 = [
    'function main() {',
    "  if (CHECK === 'ledger') {",
    '    const stageDone = isStageDone({',
    '      stage: ctx.state?.stage,',
    '      stages: ctx.stages,',
    '      artifactExists: ctx.artifactExists,',
    '      roster: participantsOf(ctx.state, ctx.state?.stage),',
    '    })',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/gate.mjs', text: v160 }]), [
    { file: 'hooks/gate.mjs', fn: 'isStageDone', checks: ['ledger'], current: false, stale: null, made: false },
  ])
})

// 锚：实参在调用括号外面不算；fresh 造在别的分支里不算；reworkBase 没取 rework_base 不算；decideDeliverable 漏了 isStale 报 false。
test('锚：括号外的 artifactExists、别的分支里造的 fresh、不读 rework_base 的 fresh、漏传 isStale——各自报出来', () => {
  const src = [
    'function main() {',
    "  if (CHECK === 'readiness') {",
    '    const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base })',
    '  }',
    "  if (CHECK === 'stop-gate' || CHECK === 'deliverable') {",
    '    const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: undefined })',
    '    const r = decideDeliverable({ role, artifactExists: fresh.artifactCurrent })',
    '    const x = foo({ artifactExists: fresh.artifactCurrent })',
    '  }',
    "  if (CHECK === 'ledger') {",
    '    const stageDone = isStageDone({ stage })',
    '    bar({ artifactExists: fresh.artifactCurrent })',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/gate.mjs', text: src }]), [
    { file: 'hooks/gate.mjs', fn: 'isStageDone', checks: ['ledger'], current: false, stale: null, made: false },
    { file: 'hooks/gate.mjs', fn: 'decideDeliverable', checks: ['stop-gate', 'deliverable'], current: true, stale: false, made: false },
  ])
})

// 正向锚：同一段源码改对之后，判据报全真——上一条的 false 不是抽取器永远答 false。
test('锚：改对之后报全真', () => {
  const src = [
    'function main() {',
    "  if (CHECK === 'stop-gate' || CHECK === 'deliverable') {",
    '    const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base })',
    '    const r = decideDeliverable({',
    '      role,',
    '      artifactExists: fresh.artifactCurrent,',
    '      artifactStale: fresh.isStale,',
    '    })',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(callSites([{ file: 'hooks/gate.mjs', text: src }]), [
    { file: 'hooks/gate.mjs', fn: 'decideDeliverable', checks: ['stop-gate', 'deliverable'], current: true, stale: true, made: true },
  ])
})
