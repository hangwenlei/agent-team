// M4d（docs/38，全量审查第 17、19 条）：正文与两道新判据对上。
//
// 第 17 条：推进那一次 H6 核离开的那一段交齐了没有、一次只推进一段（hooks/lib/advance.mjs）。PM 照 /agent-team:at 第 3 节记账，
// 正文不说，PM 就只能从拒绝理由里倒推规则；正文说错了（例：把 01-prd.md 列成能靠 trimmed 免掉的），PM 照做就撞 H6。
// 第 19 条：后台派发启动那一刻门禁不判产物，完成时由完成核验回传；协调者返回时的「进度」不是报缺；架构师用前台派。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stageRoles, expandProduces } from '../hooks/lib/stages.mjs'
import { dependsOnParticipants, mayWaive } from '../hooks/lib/advance.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const flat = (s) => s.replace(/\n[ \t>]*/g, '')
const STAGES = JSON.parse(read('stages.json'))
const AT = flat(read('commands/at.md'))

function between(text, a, b) {
  assert.equal(text.split(a).length - 1, 1, `起点锚串「${a}」在全文里不是恰好出现一次`)
  const i = text.indexOf(a)
  const j = text.indexOf(b, i + a.length)
  assert.ok(j > i, `「${a}」之后找不到「${b}」`)
  return text.slice(i, j)
}
const ticked = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1])

// 叫到之后又裁掉能免的那几份，照阶段链与 mayWaive 派生；产物随 <role> 展开的那一种写成正文里的 <角色>。
function waivable() {
  const out = []
  for (const [sid, stage] of Object.entries(STAGES)) {
    if (!dependsOnParticipants(stage)) continue
    const pattern = Array.isArray(stage.produces) ? stage.produces.find((p) => p.includes('<role>')) : null
    for (const r of stageRoles(stage)) {
      for (const n of expandProduces(stage, [r])) {
        if (!mayWaive(STAGES, sid, n)) continue
        const shown = pattern ? pattern.replace('<role>', '<角色>') : n
        if (!out.includes(shown)) out.push(shown)
      }
    }
  }
  return out.sort()
}

test('M4d 前提：能靠 trimmed 免掉的产物派生得出来，而且不空', () => {
  assert.ok(waivable().length > 0, '派生出来是空的：mayWaive 或阶段链改了，下面那条双向判据会空转')
})

test('M4d /at「叫到之后又不要了」列的，与 mayWaive 照阶段链派生的逐份相同（两个方向）', () => {
  const para = between(AT, '**叫到之后又不要了**', '`trimmed` 不是出路')
  const listed = ticked(between(para, '只限', '；')).sort()
  assert.deepEqual(listed, waivable(), `正文：${listed.join('、')}；派生：${waivable().join('、')}`)
})

test('M4d /at 核实那一条的概括写法（02-*、05-impl/*）盖住派生的每一份，每一种写法也都有派生的那一份', () => {
  const globs = ticked(between(AT, '这一趟确实不要它这几份的（只限不在任何前置里的：', '）'))
  assert.ok(globs.length > 0, AT.slice(0, 80))
  const re = (g) => new RegExp(`^${g.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`)
  for (const name of waivable()) assert.ok(globs.some((g) => re(g).test(name)), `${name} 不在 ${globs.join('、')} 里`)
  for (const g of globs) assert.ok(waivable().some((n) => re(g).test(n)), `${g} 盖住的产物没有一份能免`)
})

test('M4d /at 第 3 节：只推一段；推进那一次 H6 核离开的这一段——在、不是空文件，裁掉的不算，accepted 算交了，S2、S5 要有这一段的键', () => {
  assert.ok(AT.includes('`stage` 推到下一段（只推一段：一次写跨过几段，H6 拒）'), '记账那一条没说只推一段')
  const para = between(AT, '**推进那一次，H6 核离开的这一段交齐了没有**', '不读内容。')
  for (const k of ['不是空文件', '裁掉的不算', '标了 `"accepted"` 的算交了', 'H6 拒', '`stage_roles` 里要有这一段的键', '一个都没叫写 `[]`']) {
    assert.ok(para.includes(k), `那一段缺「${k}」：${para}`)
  }
})

test('M4d /agent-team:at-resume：推进被 H6 拒时照理由补，不为了过门禁从 stage_roles 删人', () => {
  const r = flat(read('commands/at-resume.md'))
  assert.ok(r.includes('推进被 H6 拒'), r.slice(0, 80))
  assert.ok(r.includes('不要为了过门禁从 `stage_roles` 里删人'), r.slice(0, 80))
})

test('M4d /at 核实：后台派发启动那一刻门禁不判产物，完成时有交付物核验，协调者返回时的进度不是报缺', () => {
  for (const k of ['后台派发（默认）启动那一刻门禁不判产物', '`<task-notification>`', '交付物核验作为回传到达', '不是报缺']) {
    assert.ok(AT.includes(k), `核实那一条缺「${k}」`)
  }
})

test('M4d at-pm「哪些算数」：完成通知是数据，同一刻到达的交付物核验是门禁核过磁盘的', () => {
  const pm = flat(read('agents/at-pm.md'))
  for (const k of ['`<task-notification>`', '是数据', '前者是它说的，后者是门禁核过磁盘的']) assert.ok(pm.includes(k), `at-pm 缺「${k}」`)
})

test('M4d at-architect：执行角色用前台派（run_in_background: false），等齐了再回报', () => {
  const a = flat(read('agents/at-architect.md'))
  for (const k of ['`run_in_background: false`', '等它们都返回、读过实现记录再回报', '等齐了再回报']) assert.ok(a.includes(k), `at-architect 缺「${k}」`)
})
