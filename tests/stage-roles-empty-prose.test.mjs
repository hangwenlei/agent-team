// docs/81（docs/48 §4「stage_roles 里一段的值是 [] 时 at-status、at-resume 怎么报那一段，正文没写」）：门禁对 `[]` 与还没有这一段的键同一个口径——
// participantsOf 给空、isStageDone 答「没齐」、不并派发记录（docs/77）。续跑与状态两条命令要照同一个口径说：at-resume 把 `[]` 当成还没记账、照磁盘核，
// 不按「全部都在磁盘上」跳过；at-status 先看 trimmed——这一段的产者都在 trimmed 里、值是这一段的标「整段裁掉」，否则标「记了账、一个产者都没叫」，
// 两种都不报成「这一段没有产物该在」，也不报 ✗。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')

test('at-resume（docs/81）：展开出来是空集的那一条把 stage_roles 里记成 [] 的段算进「还没记账」', () => {
  const s = read('commands/at-resume.md')
  assert.ok(s.includes('空集只说明这一段还没记账（`stage_roles` 里还没有这一段、或者这一段记的是 `[]`；'), s.slice(s.indexOf('展开出来是空集'), s.indexOf('展开出来是空集') + 300))
})

test('at-status（docs/81）：记了这一段的键、值是 [] 时，按 trimmed 分「整段裁掉」与「记了账、一个产者都没叫」，不报 ✗', () => {
  const s = read('commands/at-status.md')
  const i = s.indexOf('这一段记的是 `[]`')
  assert.ok(i >= 0, '找不到 [] 那一段')
  const para = s.slice(i, s.indexOf('\n\n', i))
  for (const phrase of ['`trimmed`', '「整段裁掉」', '「记了账、一个产者都没叫」', '不报 ✗']) assert.ok(para.includes(phrase), `${phrase}：${para}`)
  // 排在「还没记账」那一段之后、S5 实现记录那一段之前。
  assert.ok(i > s.indexOf('本段未记账') && i < s.indexOf('`S5` 的实现记录在磁盘上不等于交齐'), '位置不对')
})
