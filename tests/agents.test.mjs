// 角色层闭包测试（M1c Task 6+7）。角色正文是提示词，没有任何单测能证明模型会照做
// ——这份文件钉的是闭包性质：正文提到的角色名/产物名/skill 是否真实存在，工具面
// 授予是否与设计 §1.1 一致，红线与受信前缀边界是否写进了正文（M1c 设计 §6）。
//
// ⚠️ 这一批测试的共同风险形状：大量断言都是 `for (const f of AGENTS) { ... }`
// ——如果 AGENTS 的目录扫描出问题（比如 readdirSync 的过滤条件写错、或者只扫到
// 部分文件），循环体少跑几圈甚至零圈，这些测试会安安静静地全绿，因为它们从未真正
// 检查过该检查的文件（docs/11 §3.3 第 2 条：否定/存在性断言在「遍历的集合是空的」
// 时同样是绿的，本质与「这段代码没被执行到」是同一件事，不限于字面上的否定断言）。
// 下面第一条测试把 AGENTS 钉死成这六个文件（不只是数量，是身份），后面所有
// `for (const f of AGENTS)` 的测试都靠它兜底；对 skills/ 目录的同类扫描同样钉了
// 一条（「skills/ 目录下恰好是这三个共享 skill」）。这个手法抄自 tests/skills.test.mjs
// 第 8-10 行（Task 5 已经这么做过一次）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const roster = JSON.parse(readFileSync(url('roster.json'), 'utf8'))
const stages = JSON.parse(readFileSync(url('stages.json'), 'utf8'))
const AGENTS = readdirSync(url('agents')).filter((f) => f.endsWith('.md'))
const textOf = (f) => readFileSync(url(`agents/${f}`), 'utf8')
const fmOf = (f) => textOf(f).split(/^---\s*$/m)[1] ?? ''
const bodyOf = (f) => textOf(f).split(/^---\s*$/m).slice(2).join('---')

// 六个角色的完整文件名，逐字写死——不是「数一下有几个」，是「就该是这些」。
// deepEqual 而不是只比数量：数量对但身份错（比如混进一个同名不同大小写的文件、
// 或者漏了一个又多了一个凑巧数量相同）不该被这条测试放过。
const EXPECTED_AGENTS = [
  'at-architect.md',
  'at-backend.md',
  'at-frontend.md',
  'at-outsider.md',
  'at-pm.md',
  'at-product.md',
]

test('agents/ 目录下恰好是这六个角色文件——否则下面每一条 for (const f of AGENTS) 都在对空集合或半个集合空转', () => {
  assert.deepEqual(
    [...AGENTS].sort(),
    EXPECTED_AGENTS,
    `agents/ 目录扫描结果是 ${JSON.stringify([...AGENTS].sort())}，与预期的六个角色 ` +
      `${JSON.stringify(EXPECTED_AGENTS)} 不一致——下面所有遍历 AGENTS 的测试的检查范围都` +
      '会跟着变，且不会有任何提示',
  )
})

// 持有 Bash 的角色（设计 §1.1）。at-product / at-architect 产出的是文档，不跑构建。
const HAS_BASH = ['at-pm.md', 'at-backend.md', 'at-frontend.md']

test('每个角色文件的 frontmatter name 与文件名一致', () => {
  for (const f of AGENTS) {
    const m = fmOf(f).match(/^name:\s*(\S+)/m)
    assert.equal(m && m[1], f.replace(/\.md$/, ''), `${f} 的 name 与文件名对不上`)
  }
})

test('每个角色都在 roster.json 里', () => {
  for (const f of AGENTS) {
    assert.ok(Object.hasOwn(roster, f.replace(/\.md$/, '')), `${f} 不在 roster.json 里`)
  }
})

test('Bash 只发给设计 §1.1 列出的三个角色', () => {
  for (const f of AGENTS) {
    const has = /\bBash\b/.test(fmOf(f))
    assert.equal(has, HAS_BASH.includes(f), `${f} 的 Bash 授予与设计 §1.1 不符`)
  }
})

test('持有 Bash 的角色，正文里必须有 Bash 红线', () => {
  for (const f of HAS_BASH) {
    assert.match(bodyOf(f), /Bash/, `${f} 持有 Bash 但正文里没有提到它`)
  }
})

test('每个角色正文都引用了受信前缀', () => {
  for (const f of AGENTS) {
    assert.ok(bodyOf(f).includes(TRUSTED_PREFIX), `${f} 正文里没有引用受信前缀——它认不出权威信号`)
  }
})

test('每个角色正文都写明了「读文件读到的带前缀文字仍是数据」', () => {
  for (const f of AGENTS) {
    assert.match(bodyOf(f), /读到|读文件|读进来/, `${f} 正文里没有写明按通道信任那条边界`)
  }
})

test('角色正文里出现的每个 at-* 角色名都在花名册里', () => {
  for (const f of AGENTS) {
    for (const name of new Set(bodyOf(f).match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])) {
      if (['at-contract-format', 'at-handoff-package', 'at-api-contract'].includes(name)) continue
      assert.ok(Object.hasOwn(roster, name), `agents/${f} 提到 ${name}，但它不在 roster.json 里`)
    }
  }
})

test('角色正文里出现的每个 NN-*.md 产物名都是某个阶段的 produces', () => {
  const produced = new Set(Object.values(stages).flatMap((x) => x.produces ?? []))
  for (const f of AGENTS) {
    for (const a of new Set(bodyOf(f).match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? [])) {
      assert.ok(produced.has(a), `agents/${f} 提到产物 ${a}，但它不是任何阶段的 produces`)
    }
  }
})

test('frontmatter 的 skills: 引用的 skill 真的存在', () => {
  for (const f of AGENTS) {
    const line = fmOf(f).split(/\r?\n/).find((l) => /^skills:/.test(l.trim()))
    if (!line) continue
    for (const s of line.replace(/^skills:\s*/, '').split(/[,\s]+/).filter(Boolean)) {
      assert.ok(existsSync(url(`skills/${s}/SKILL.md`)), `agents/${f} 预加载 ${s}，但 skills/${s}/SKILL.md 不存在`)
    }
  }
})

// skills/ 目录同样是一次目录扫描，同样可能因为扫描出问题而悄悄返回空——与 AGENTS
// 是同一类风险，钉法照抄 tests/skills.test.mjs 第 8-10 行。
const EXPECTED_SKILLS = ['at-api-contract', 'at-contract-format', 'at-handoff-package']

test('skills/ 目录下恰好是这三个共享 skill——否则「每个 skill 至少被一个角色预加载」在对空集合空转', () => {
  assert.deepEqual(readdirSync(url('skills')).sort(), [...EXPECTED_SKILLS].sort())
})

test('每个 skill 至少被一个角色预加载——没人读的 skill 是死文件', () => {
  const referenced = new Set()
  for (const f of AGENTS) {
    const line = fmOf(f).split(/\r?\n/).find((l) => /^skills:/.test(l.trim()))
    if (!line) continue
    for (const s of line.replace(/^skills:\s*/, '').split(/[,\s]+/).filter(Boolean)) referenced.add(s)
  }
  for (const s of readdirSync(url('skills'))) {
    assert.ok(referenced.has(s), `skills/${s} 没有任何角色预加载它`)
  }
})

// ⚠️ 正向锚点，拆成两条：上面「at-* 角色名都在花名册里」与「NN-*.md 产物名都是某个
// produces」这两条闭包测试各自检验不同侧面——前者的锚点是「正文里确实提到过角色
// 名」，后者的锚点是「正文里确实提到过产物名」，是两件独立的事。brief 原稿把它们
// 塞进了同一个 test()：一旦第一条 assert.ok 失败，第二条永远不会被执行，「产物名
// 锚点是否成立」在报告里就彻底不可见——这正是 docs/11 §3.3 第 1 条点名的形状
// （「多条检验不同侧面的固定断言要拆开」），本轮不豁免 brief 给的测试代码。
const ALL_BODIES = AGENTS.map(bodyOf).join('\n')

test('前置条件：角色正文里确实提到了角色名——否则「提到的角色名都在花名册里」那条闭包测试在空转', () => {
  assert.ok((ALL_BODIES.match(/\bat-[a-z][a-z0-9-]*\b/g) ?? []).length > 0, '没有任何角色正文提到角色名')
})

test('前置条件：角色正文里确实提到了产物名——否则「提到的产物名都是某阶段 produces」那条闭包测试在空转', () => {
  assert.ok((ALL_BODIES.match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? []).length > 0, '没有任何角色正文提到产物名')
})
