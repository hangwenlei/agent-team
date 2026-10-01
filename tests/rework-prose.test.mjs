// M3y（docs/33，全量审查第 15 条）：rework_base 进了 state.json 之后，正文里那几句关键的话。
//
// 门禁按 rework_base 分辨上一轮的产物，而 rework_base 是 PM 照正文写的——回退怎么记、之后怎么带着、什么时候标 "accepted"，
// 正文里没写对，H6 就只剩拒绝这一条路（它的拒绝理由给得出整份值，但给不出「为什么要先记回退再派」）。这里钉的是那几句话
// 在不在、说没说对方向；措辞本身不钉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// from 那一行起、到下一个以 to 开头的行为止（不含）。
function section(text, from, to) {
  const start = text.indexOf(from)
  assert.ok(start >= 0, `找不到「${from}」`)
  const rest = text.slice(start + from.length)
  const end = rest.search(new RegExp(`\\n${to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  return end < 0 ? rest : rest.slice(0, end)
}
const AT = read('commands/at.md')
const REWIND = section(AT, '### 回退', '## ')

test('M3y：/at 第 3 节有「回退」一小节，写明先记回退、再派', () => {
  assert.match(REWIND, /先记回退，再派/)
})

test('M3y：「回退」写明同一次 Write 改 stage、history、rework、rework_base，离开的那一段照常记账', () => {
  assert.match(REWIND, /同一次 Write/)
  for (const k of ['`stage`', '`history`', '`rework`', '`rework_base`', '`roster`', '`stage_roles`']) assert.ok(REWIND.includes(k), `「回退」没提 ${k}`)
})

test('M3y：「回退」写明 rework_base 记什么——回到的那一段及之后各段在磁盘上的产物，更早各段原样带过来', () => {
  assert.match(REWIND, /回到的那一段及之后各段/)
  assert.match(REWIND, /更早各段的条目原样带过来/)
  assert.match(REWIND, /没有 `rework_base` 的旧 run 回退时同样要写/)
})

test('M3y：「回退」写明 H6 拒的时候照拒绝理由给的整份写，不要自己算', () => {
  assert.match(REWIND, /整份 `rework_base`[^。]*照它写，不要自己算/)
})

test('M3y：「回退」写明之后每一次写入原样带着、只许当前段及更早段标 "accepted"、推进时还旧会被拒', () => {
  assert.match(REWIND, /每一次写 `state\.json` 都原样带着 `rework_base`/)
  assert.match(REWIND, /`"accepted"`[^。]*只许当前段及更早段/)
  assert.match(REWIND, /推进出一段时[^。]*H6 拒/)
})

test('M3y：「回退」写明同一段里重派一个角色不是回退、不往 history 里追加', () => {
  assert.match(REWIND, /不是回退[^。]*不要往 `history` 里追加/)
})

test('M3y：「回退」写明 stage_roles 更早各段的名单不清空', () => {
  assert.match(REWIND, /`stage_roles` 里更早各段的名单不清空/)
})

test('M3y：/at 第 3 节的核实与记账两条都指向「回退」', () => {
  const s3 = section(AT, '## 3. 逐段推进', '### 回退')
  const verify = s3.slice(s3.indexOf('2. **核实**'), s3.indexOf('3. **记账**'))
  assert.match(verify, /返工轮[^。]*`rework_base`/)
  const ledger = s3.slice(s3.indexOf('3. **记账**'), s3.indexOf('4. 把这一段'))
  assert.match(ledger, /原样带着 `rework_base`/)
})

test('M3y：/at 建 run 那一段把 rework_base 列进先留空对象的那几个', () => {
  assert.match(section(AT, '## 1. 建 run', '## '), /`rework_base`[^。]*先留空对象/)
})

test('M3y：at-pm 的返工红线旁给出「回退」的可读路径', () => {
  const pm = read('agents/at-pm.md')
  const line = pm.split('\n').find((l) => l.includes('`rework_base`'))
  assert.ok(line, 'agents/at-pm.md 没提 rework_base')
  assert.ok(line.includes('`${CLAUDE_PLUGIN_ROOT}/commands/at.md`') && line.includes('「回退」'), line)
})

test('M3y：/at-resume 写明返工轮里「在磁盘上」不等于这一轮写过，推进被 H6 拒时照理由走，并给出「回退」的可读路径', () => {
  const resume = read('commands/at-resume.md')
  const block = resume.split(/\n\s*\n/).find((b) => b.includes('`rework_base`'))
  assert.ok(block, 'commands/at-resume.md 没提 rework_base')
  assert.match(block, /不等于这一轮写过/)
  assert.match(block, /H6/)
  assert.match(block, /`"accepted"`/)
  assert.ok(block.includes('`${CLAUDE_PLUGIN_ROOT}/commands/at.md`'))
})

test('M3y：/at-status 的报法列出 rework_base，并写明只列不判新旧', () => {
  const status = read('commands/at-status.md')
  assert.match(section(status, '## 3. 报什么', '## '), /返工基线:[^\n]*rework_base/)
  assert.match(status, /只列出来，不判新旧/)
})

test('M3y：at-qa 写明返工轮要在这一轮的实现上重跑，不拿上一轮的 06-test.md 交差', () => {
  const qa = read('agents/at-qa.md')
  assert.match(qa, /返工轮[^\n]*重跑/)
})

test('M3y：规格 §4.4 的示例带 rework_base、说明它的写法；§6 的 H6 那一行提到它', () => {
  const spec = read('docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md')
  const s44 = section(spec, '### 4.4 状态文件', '## 5.')
  assert.match(s44, /"rework_base": \{/)
  assert.match(s44, /`rework_base` 记上一次回退那一刻各份产物的 sha/)
  const h6 = spec.split('\n').find((l) => l.startsWith('| H6 |'))
  assert.ok(h6 && h6.includes('`rework_base`'), h6)
})

test('M3y：stages.README 的 H6 一节写到 rework_base', () => {
  const sec = section(read('stages.README.md'), '## H6 返工预算写时强制', '## ')
  assert.match(sec, /`rework_base`/)
  assert.match(sec, /decideReworkBase/)
})
