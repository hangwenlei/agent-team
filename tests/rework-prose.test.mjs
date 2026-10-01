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
  // 复核改的：带过来的条目沿用更早那次快照，「上一次回退那一刻」对它们不成立。
  assert.match(s44, /`rework_base` 记回退快照里各份产物的 sha/)
  assert.doesNotMatch(s44, /记上一次回退那一刻/)
  const h6 = spec.split('\n').find((l) => l.startsWith('| H6 |'))
  assert.ok(h6 && h6.includes('`rework_base`'), h6)
})

test('M3y：stages.README 的 H6 一节写到 rework_base', () => {
  const sec = section(read('stages.README.md'), '## H6 返工预算写时强制', '## ')
  assert.match(sec, /`rework_base`/)
  assert.match(sec, /decideReworkBase/)
})

// ---------------------------------------------------------------- 复核补的（M3y 对抗验证）

// 返工轮里推进进 history 里已有的一段，rework 那一段也要照派生量加 1——H6 只认派生量。原来正文只在回退那一次写入里提 rework，
// 照第 3 条记账会被 H6 拒一次（docs/15 那一趟真撞上过）。
test('M3y：/at 第 3 条写明返工轮里再进走过的段时 rework 那一段加 1；「回退之后」也说；at-pm 与 at-resume 跟上', () => {
  const s3 = section(AT, '## 3. 逐段推进', '### 回退')
  const ledger = s3.slice(s3.indexOf('3. **记账**'), s3.indexOf('4. 把这一段'))
  assert.match(ledger, /返工轮里推进进一段已经走过的[^。]*`rework` 里那一段加 1/)
  assert.match(REWIND, /返工轮里推进进一段已经走过的[^。]*`rework` 里那一段加 1/)
  assert.ok(read('agents/at-pm.md').split('\n').some((l) => l.includes('`rework_base`') && l.includes('`rework` 那一段也加 1')))
  assert.match(read('commands/at-resume.md'), /下一段在 `history` 里已经出现过时还有 `rework`/)
})

// 「原样带着」只到下一次回退为止：再次回退时 H6 要求回到的那一段及之后各段按磁盘重拍，照「不改值」写会被拒。
test('M3y：「原样带着」写明到下一次回退为止、再次回退照第三条重拍；回退那一次只记 sha', () => {
  assert.match(REWIND, /原样带着 `rework_base`\*\*（到下一次回退为止）/)
  assert.match(REWIND, /再次回退时照上面第三条重记/)
  assert.match(REWIND, /这一次只记 sha，`"accepted"` 在之后的写入里标/)
  const s3 = section(AT, '## 3. 逐段推进', '### 回退')
  assert.match(s3, /再次回退时照「回退」重记/)
})

// 阶段链最后一段没有「推进出去」这次写入，收口不经 H6——正文不能把兜底交给 H6。
test('M3y：最后一段收口不经 H6——/at「回退」、第 6 节收尾、/at-resume 都写明先重写或标 accepted 再收口', () => {
  assert.match(REWIND, /最后一段没有「推进出去」这次写入，收口不经 H6/)
  // 按行首定位：第 3 节正文里有一句「见「## 6. 收尾」」。
  assert.match(section(AT, '\n## 6. 收尾', '## '), /收口不经任何门禁/)
  assert.match(read('commands/at-resume.md'), /最后一段没有「推进出去」这次写入，收口不经 H6/)
})

// 一段没走完就回退：那一段还没派到的产者不写 trimmed（产者交代对链上晚于当前段的段不查，coverage.mjs）。
test('M3y：「回退」写明一段没走完就回退时，还没派到的产者不写进 trimmed', () => {
  assert.match(REWIND, /一段没走完就回退[^。]*还没派到的产者不写进 `trimmed`/)
})

// 【返工】只发给 PM；S1、S4、S8 的产物是它自己的。
test('M3y：「回退」里照【返工】重写时，PM 自己那几段的产物自己写', () => {
  assert.match(REWIND, /你自己那几段的产物自己写/)
})
