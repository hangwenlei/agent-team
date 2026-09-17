import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CONTROL_FILES } from '../hooks/lib/control-files.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const readJson = (p) => JSON.parse(readFileSync(url(p), 'utf8'))
const roster = readJson('roster.json')
const stages = readJson('stages.json')
const stateTemplate = readJson('templates/state.json')
const FILES = ['at.md', 'at-init.md', 'at-resume.md', 'at-status.md']
const textOf = (f) => readFileSync(url(`commands/${f}`), 'utf8')

test('四条命令都在，没有多余的', () => {
  assert.deepEqual(readdirSync(url('commands')).sort(), [...FILES].sort())
})

// 拆成两条：brief 原稿是一个 for 循环里连着两句检验不同事情的 assert（有没有
// frontmatter、frontmatter 里有没有 description）。两句形状不同，不是同一个不变量
// 按数据遍历——同一文件的第一句先炸，这一文件的第二句、以及循环里排在它后面的其它
// 三个文件（两句都）会在这一轮里完全没机会跑。四条命令彼此独立，一条的 frontmatter
// 坏掉不该连带盖住另一条缺 description 这种不相关的事——这正是本仓库栽过两次的
// 归因遮蔽形状（见 403dccb），拆开让每句只守自己的不变量。
test('每条命令都有 frontmatter', () => {
  for (const f of FILES) {
    assert.match(textOf(f), /^---\r?\n/, `${f} 没有 frontmatter`)
  }
})

test('每条命令的 frontmatter 都有 description', () => {
  for (const f of FILES) {
    assert.match(textOf(f), /^description:/m, `${f} 的 frontmatter 缺 description`)
  }
})

// 规格 §6.1：这三个工具一律不授予。命令不该自己另开一条口子。
test('命令的 frontmatter 不得声明 Skill / SendMessage / ListAgents', () => {
  for (const f of FILES) {
    for (const bad of ['Skill', 'SendMessage', 'ListAgents']) {
      assert.doesNotMatch(
        textOf(f).split(/^---\s*$/m)[1] ?? '',
        new RegExp(`\\b${bad}\\b`),
        `${f} 的 frontmatter 提到了 ${bad}（规格 §6.1：一律不授予）`,
      )
    }
  }
})

// M1a ② 的形状：stages.json 第一天就把 S5 的 role 写成花名册里不存在的角色，
// 直到有真实派发撞上 H1 才会被发现。命令正文是第三个引用角色名的地方。
//
// ⚠️ Task 9 实现时发现：/\bat-[a-z][a-z0-9-]*\b/ 这个形状同时匹配得到命令自己的名字
// （at-init/at-resume/at-status——FILES 去掉 .md 后缀就是它们）。四条命令的正文会
// 互相提「跑 /at-init」「回到 /at 的第 3 节」这类合法的命令间引用，那不是角色名，
// 是命令名——两个命名空间形状恰好相同，但花名册只收角色。命令自己的名字不该被当成
// 角色名去对花名册查——排除掉这个集合。
const COMMAND_NAMES = new Set(FILES.map((f) => f.replace(/\.md$/, '')))
test('命令正文里出现的每个 at-* 角色名都在花名册里', () => {
  for (const f of FILES) {
    for (const name of new Set(textOf(f).match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])) {
      if (COMMAND_NAMES.has(name)) continue
      assert.ok(Object.hasOwn(roster, name), `commands/${f} 提到 ${name}，但它不在 roster.json 里`)
    }
  }
})

// M1a ⑦：at-pm 只能派 at-product / at-architect，at-backend 在第三层。
// 清单写「PM 派 at-backend」会被 H1 正确地拒掉，而那次拒绝很容易被记成别的问题。
test('/at 不得指示 PM 直接派 at-pm 派不动的角色', () => {
  const t = textOf('at.md')
  const reachable = new Set(roster['at-pm'].can_delegate_to)
  for (const name of new Set(t.match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])) {
    if (name === 'at-pm' || reachable.has(name)) continue
    const line = t.split(/\r?\n/).find((l) => l.includes(name) && /派|dispatch|Agent/.test(l)) ?? ''
    assert.ok(
      !line || /at-architect|at-product|经|转/.test(line),
      `commands/at.md 有一行像是让 PM 直接派 ${name}：「${line.trim()}」——` +
        `at-pm 的 can_delegate_to 只有 ${[...reachable].join('、')}，H1 会拒`,
    )
  }
})

test('命令正文里出现的每个 NN-*.md 产物名都是 stages.json 的 produces', () => {
  const produced = new Set(Object.values(stages).flatMap((s) => s.produces ?? []))
  for (const f of FILES) {
    for (const a of new Set(textOf(f).match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? [])) {
      assert.ok(produced.has(a), `commands/${f} 提到产物 ${a}，但它不是 stages.json 里任何阶段的 produces`)
    }
  }
})

test('命令正文里出现的每个 .agent-team 路径都是控制文件或 run 目录下的产物', () => {
  const produced = new Set(Object.values(stages).flatMap((s) => s.produces ?? []))
  const ok = (rel) =>
    CONTROL_FILES.some((c) => new RegExp(`^${c.replace('*', '[^/]+')}$`).test(rel)) ||
    /^runs\/[^/]+\/?$/.test(rel) ||
    [...produced].some((p) => rel.endsWith(p))
  for (const f of FILES) {
    for (const m of new Set(textOf(f).match(/\.agent-team\/[A-Za-z0-9_./<>-]+/g) ?? [])) {
      const rel = m.replace('.agent-team/', '').replace(/[.]$/, '')
      assert.ok(
        ok(rel.replace(/<run[_-]?id>/g, 'RID')),
        `commands/${f} 提到 ${m}，它既不是控制文件（hooks/lib/control-files.mjs）` +
          `也不是 stages.json 的 produces`,
      )
    }
  }
})

// ⚠️ Task 9 实现时发现：原正则 /state\.json\s*的\s*`([a-z_]+)`/ 在四条命令的正文里
// 一次都不会匹配——正文一律把 state.json 自己也包在反引号里（`` `state.json` 的
// `stage` ``），紧跟在「json」后面的是反引号而不是空白，\s* 跳不过那个反引号，
// 匹配在「的」之前就断了。逐一实测过三份文件：加一个可选的反引号之后，at.md 能测到
// contract_sha/stage/escalations 三处、at-resume.md 能测到 stage 一处、at-status.md
// 能测到 artifacts 一处，全部是模板里真实存在的字段——这条测试原先是 0 匹配的假通过，
// 不是钉住了什么。
test('/at 与 /at-resume 提到的 state.json 字段都在模板里', () => {
  const known = new Set(Object.keys(stateTemplate))
  for (const f of ['at.md', 'at-resume.md', 'at-status.md']) {
    for (const m of textOf(f).matchAll(/state\.json`?\s*的\s*`([a-z_]+)`/g)) {
      assert.ok(known.has(m[1]), `commands/${f} 提到 state.json 的 ${m[1]}，但模板里没有这个字段`)
    }
  }
})

// docs/04 §9 ②：H3/H4/H5b 的拒绝父级只有转述，没有硬证据。PM 判断「这一段完成
// 没完成」必须 stat 磁盘，不能靠对话记忆或子代理回报。四条命令都要写明这一条。
test('每条命令都写明「核实磁盘，不信子代理自述」', () => {
  for (const f of FILES) {
    assert.match(textOf(f), /磁盘/, `commands/${f} 没有提到要核实磁盘`)
  }
})

test('/at 写明了五类升级条件的 kind 取值', () => {
  const t = textOf('at.md')
  for (const k of ['sensitive', 'contract-conflict', 'tradeoff', 'contract-hole', 'budget-exhausted']) {
    assert.ok(t.includes(k), `commands/at.md 没有写 escalations 的 kind 取值 ${k}`)
  }
})
