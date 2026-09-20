import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { producedNames } from '../hooks/lib/stages.mjs'
import { COMMAND_NAMES } from './helpers/command-names.mjs'

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

// 判据：把 skill 正文里**当成角色名用**的那些 `at-*` 抠出来。两层豁免：
//
// 1. **skill 自己的名字**——三个 skill 全都叫 `at-*`（at-contract-format /
//    at-handoff-package / at-api-contract），与角色名形状相同。
// 2. **命令名**——at-init / at-resume / at-status 同样撞形状。这一层原先没有：
//    tests/commands.test.mjs 在 M2a Task 9 解决过，tests/agents.test.mjs 在 M2b
//    Task 4 补轮抽成了 tests/helpers/command-names.mjs，**skill 侧是最后一处**。
//    不在这里自己 readdirSync 一遍——那会是第三份派生（Ruling 16 命名的形状：先解决
//    问题的那一侧，最容易在问题的第二半上留缺口）。
//
// ⚠️ **今天这条判据真正执行 0 次断言**：三份 SKILL.md 里 at-* 形状总共命中 3 个，
// 全是 skill 自己的名字，第一层豁免之后就没有了——一个角色名都没提。这是**事实，不是
// 缺陷**：本分支已定的界是「零覆盖不等于有缺口」。这条是 fail-open 的**前瞻守卫**，
// 防的是将来哪份 skill 正文写进一个角色名。所以下面那条锚**不能**用「派生集合非空」
// 那一款——今天那个集合就是空的，那种锚一上线就红。用的是**已知违规样本**那一款，
// 与 tests/commands.test.mjs 的「自检：pathKeyBans() 从一条已知的禁令子句里抠得出被
// 点名的角色」同一手法。把一个看不见的零，变成一个有人守着的零。
//
// **不要为了喂饱这条判据去改 skill 正文**，也不要因为它今天是零就删掉它。
function skillRoleMentions(text) {
  const out = new Set()
  for (const name of new Set(text.match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])) {
    if (SKILLS.includes(name)) continue // skill 自己的名字也是 at- 开头
    if (COMMAND_NAMES.has(name)) continue // 命令名与角色名是两个命名空间，恰好同形
    out.add(name)
  }
  return out
}

// ⭐ 正向自检锚（docs/11 §3.3 第 2 条）。钉的是**判据函数本身**，不是它今天算出来的
// 集合——那个集合就是空的。判据被放宽成「豁免一切」时这条会红；主判据今天不会红，
// 因为它今天一次都不跑。
test('自检：skillRoleMentions() 让一个既不是 skill 名也不是命令名的 at-* 活过两层豁免', () => {
  assert.deepEqual([...skillRoleMentions('照 `at-nosuchrole` 那一段的口径写。')], ['at-nosuchrole'])
})

test('skill 正文里出现的每个 at-* 角色名都在花名册里', () => {
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    for (const name of skillRoleMentions(t)) {
      assert.ok(Object.hasOwn(roster, name), `skills/${s} 提到 ${name}，但它不在 roster.json 里`)
    }
  }
})

test('skill 正文里出现的每个 NN-*.md 产物名都是某个阶段的 produces', () => {
  // M2b Task 2：produces 现在有数组/对象两种形式（S2 是对象），flatMap 对对象值
  // 不展平，原地重算会静默产出一个混进对象的 Set，导致 has() 恒为 false。改用
  // producedNames(stages)（单一真源，已经走 expandProduces 认两种形式）。
  const produced = producedNames(stages)
  for (const s of SKILLS) {
    const t = readFileSync(url(`skills/${s}/SKILL.md`), 'utf8')
    for (const a of new Set(t.match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? [])) {
      assert.ok(produced.has(a), `skills/${s} 提到产物 ${a}，但它不是任何阶段的 produces`)
    }
  }
})
