// M4d（docs/38，全量审查第 17、19 条）：正文与两道新判据对上。
//
// 第 17 条：推进那一次 H6 核离开的那一段交齐了没有、一次只推进一段（hooks/lib/advance.mjs）。PM 照 /agent-team:at 第 3 节记账，
// 正文不说，PM 就只能从拒绝理由里倒推规则；正文说错了（例：把 01-prd.md 列成能靠 trimmed 免掉的），PM 照做就撞 H6。
// 第 19 条：后台派发启动那一刻门禁不判产物，完成时由完成核验回传；协调者返回时的「进度」不是报缺；架构师用前台派。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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
  const anchor = '这一趟确实不要它这几份的（只限 `S2`、`S5` 这类按叫到的人展开产物的段里、不在任何前置里的：'
  const globs = ticked(between(AT, anchor, '）').slice(anchor.length))
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

// ---------------------------------------------------------------- 复核修订（docs/38 §3）

// 正文里点名的【…】标签，PM 会拿它去认回传——门禁不发的标签，PM 就等一条永远不来的回传（复核：原来写过一个【交付物校验】，门禁发的是
// 「⚠️ 交付物校验：」）。只认中括号里的名字在 hooks/ 源码里出现过。
test('M4d 正文里的每一个【…】标签都是门禁真会发的（在 hooks/ 源码里出现）', () => {
  const prose = ['commands/at.md', 'commands/at-resume.md', 'commands/at-status.md', 'commands/at-init.md', 'agents/at-pm.md', 'README.md', 'stages.README.md']
  const hooks = [readdirSync(new URL('../hooks/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `hooks/${f}`), readdirSync(new URL('../hooks/lib/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `hooks/lib/${f}`)].flat()
  const src = hooks.map(read).join('\n')
  const labels = new Set(prose.flatMap((p) => [...read(p).matchAll(/【([^】\n]{1,20})】/g)].map((m) => m[0])))
  assert.ok(labels.size > 0)
  for (const l of labels) assert.ok(src.includes(l), `正文里的 ${l} 门禁不发`)
})

test('M4d at-qa 的开工自查：trimmed 里记着它、值是 S5 的，不等它那一份；at-status 标「已裁」、续跑不算缺（只限能免的那几份）', () => {
  const qa = flat(read('agents/at-qa.md'))
  assert.ok(qa.includes('`trimmed` 里记着它、值是 `S5` 的（叫到之后又不要了，PM 记的），也不要等它那一份'), '自查没扣掉裁掉的人')
  const status = flat(read('commands/at-status.md'))
  assert.ok(status.includes('叫到之后又不要了') && status.includes('标「已裁」'), 'at-status 没写裁掉的怎么报')
  const resume = flat(read('commands/at-resume.md'))
  assert.ok(resume.includes('叫到之后又不要了）不算缺'), '续跑没写裁掉的不算缺')
  for (const t of [status, resume]) assert.ok(t.includes('`02-*`、`05-impl/*`'), '没说只限能免的那几份')
})

test('M4d at-product：派 at-ui 也用前台派（run_in_background: false），等它返回再回报', () => {
  const p = flat(read('agents/at-product.md'))
  assert.ok(p.includes('`run_in_background: false`'), p.slice(0, 80))
  assert.ok(p.includes('等它返回、读过它的回报再回报 PM'), p.slice(0, 80))
})

test('M4d /at：trimmed 一个角色只记一段；整段裁掉一段，后面要它当前置的段跟着裁；协调者派的人完成通知不一定到 PM', () => {
  assert.ok(AT.includes('`trimmed` 一个角色只记一段'), '没写 trimmed 只记一段')
  assert.ok(AT.includes('只能跟着整段裁掉，交付文档里写明少了哪几段'), '没写整段裁掉的后果')
  assert.ok(AT.includes('完成通知不一定到你这里'), '没写协调者派的人的通知不一定到 PM')
  assert.ok(!AT.includes('【交付物校验】'), '门禁不发【交付物校验】')
})

test('M4d at-pm：交付物核验只在没交齐时到达（交齐了不出声）', () => {
  const pm = flat(read('agents/at-pm.md'))
  assert.ok(pm.includes('它没交齐时，同一刻门禁的交付物核验也作为 hook 回传到达（同样以那个开头；交齐了不出声）'), pm.slice(0, 80))
})
