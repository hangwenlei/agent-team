import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const SKILLS = ['at-contract-format', 'at-handoff-package', 'at-api-contract']

test('三个 skill 都在，没有多余的', () => {
  assert.deepEqual(readdirSync(url('skills')).sort(), [...SKILLS].sort())
})

test('每个 skill 都有 SKILL.md', () => {
  for (const s of SKILLS) {
    assert.ok(existsSync(url(`skills/${s}/SKILL.md`)), `skills/${s}/SKILL.md 不存在`)
  }
})

// task-5-brief.md 原稿这里是一个 test() 塞三条断言（frontmatter 分隔符 / name /
// description），钉的是三个不同侧面——按 docs/11 §3.3 第 1 条，前一条断言一失败
// 就抛，后两条"有没有被真正检查过"完全不可见，与 415866b（artifact-drift 测试
// 卫生修复轮 1）拆 r.drifted / r.missing 是同一形状。按字段拆成三个 test()，每个
// 内部仍是同一断言形状遍历 SKILLS（互不耦合的数据点），符合那条例外，失败消息
// 继续点名具体是哪个 skill。
test('每个 SKILL.md 都有 frontmatter 分隔符', () => {
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    assert.match(t, /^---\r?\n/, `${s} 没有 frontmatter`)
  }
})

test('每个 SKILL.md 的 frontmatter 都有 name 字段', () => {
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    assert.match(t, /^name:/m, `${s} 缺 name`)
  }
})

test('每个 SKILL.md 的 frontmatter 都有 description 字段', () => {
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    assert.match(t, /^description:/m, `${s} 缺 description`)
  }
})

test('frontmatter 的 name 与目录名一致', () => {
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    const m = t.match(/^name:\s*(\S+)/m)
    assert.equal(m && m[1], s, `${s} 的 frontmatter name 与目录名对不上`)
  }
})

// 规格 §6.1 / U7 实测：context: fork 的 skill 能带 agent: 参数绕过 Agent 工具直接起
// subagent，H1 派发门禁看不见。本插件自带的 skill 一律不得声明它。
test('本插件自带的 skill 一律不得声明 context: fork', () => {
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    assert.doesNotMatch(t, /^context:\s*fork/m, `${s} 声明了 context: fork —— 那是绕过 H1 的旁路`)
  }
})

// ⚠️ 正向锚点：上一条是否定断言，文件为空时天然满足。
test('前置条件：每个 SKILL.md 都有实质正文（≥ 20 行）', () => {
  for (const s of SKILLS) {
    const n = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8').split(/\r?\n/).length
    assert.ok(n >= 20, `skills/${s}/SKILL.md 只有 ${n} 行，像是没写完`)
  }
})

// 闭包：skill 正文里提到的角色名与产物名必须真实存在。
const roster = JSON.parse(readFileSync(url('roster.json'), 'utf8'))
const stages = JSON.parse(readFileSync(url('stages.json'), 'utf8'))

test('skill 正文里出现的每个 at-* 角色名都在花名册里', () => {
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    for (const name of new Set(t.match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])) {
      if (SKILLS.includes(name)) continue // skill 自己的名字也是 at- 开头
      assert.ok(Object.hasOwn(roster, name), `skills/${s} 提到 ${name}，但它不在 roster.json 里`)
    }
  }
})

test('skill 正文里出现的每个 NN-*.md 产物名都是某个阶段的 produces', () => {
  const produced = new Set(Object.values(stages).flatMap((x) => x.produces ?? []))
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    for (const a of new Set(t.match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? [])) {
      assert.ok(produced.has(a), `skills/${s} 提到产物 ${a}，但它不是任何阶段的 produces`)
    }
  }
})
