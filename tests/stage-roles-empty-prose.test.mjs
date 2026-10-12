// docs/81（docs/48 §4「stage_roles 里一段的值是 [] 时 at-status、at-resume 怎么报那一段，正文没写」）：产物随参与者展开的段（S2、S5）里，这一段的记录里
// 一个产者都没有（记成 `[]`、或者只记了不是这一段产者的协调者——S5 里被叫去分发的 at-architect）时，按段展开是空集，isStageDone 答「没齐」、不并派发记录
// （docs/77）。两条命令照同一个口径说——
//   - at-resume：空集要么还没记账，要么记了账、一个产者都没叫，两种都不说明没人干过活，照磁盘核；要从这一段继续派的人在 trimmed 里记着这一段的，先拿掉。
//   - at-status：还停在这一段的照「本段未记账」那样标、那样报；已经推进出去的先看 trimmed——整段裁掉的照那一节最后一句标「整段裁掉」、不报 ✗；没裁的标
//     「记了账、没叫人也没裁」，后面某一段要它当前置的那几份（S2 at-product 的 01-prd.md）照磁盘报 ✓ / ✗，其余不报 ✗。只管产物随参与者展开的段——产物固定的段
//     记成 `[]` 展开不是空集，照常按展开结果报。
// 复核（docs/81 §8）两轮：第一版不限段、漏了只记协调者、停在这一段时自相矛盾、S2 没裁的前置缺了也不报 ✗；第二轮修订让整段裁掉也报前置，与同一节最后一句
// 「整段裁掉的不报 ✗」相反，只记协调者在 S2 上不成立（at-product 本身是产者）。判据钉承重短语，范围限定也算。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')

test('at-resume（docs/81）：展开出来是空集——还没记账、或者记了账一个产者都没叫，两种都照磁盘核；整段裁掉了又要派人的先从 trimmed 拿掉', () => {
  const s = read('commands/at-resume.md')
  const i = s.indexOf('- **展开出来是空集 → 不算齐了。**')
  const item = s.slice(i, s.indexOf('\n- **', i + 1))
  assert.ok(
    item.includes(
      '空集要么是这一段还没记账（`stage_roles` 里还没有这一段；旧 run 是\n  `roster` 里还没有这一段的产者——PM 在推进出一段时才记它），要么是记了账、一个产者都没叫（这一段记的是 `[]`、或者只记了不是这一段产者的协调者），' +
        '两种都不说明没人干过活。',
    ),
    item,
  )
  assert.ok(item.includes('要从这一段继续派的人在 `trimmed` 里记着这一段的（叫到之后又裁掉、或者整段裁掉），派之前先把他从 `trimmed` 里拿掉'), item)
})

test('at-status（docs/81）：只管产物随参与者展开的段；记录里一个产者都没有时，停在这一段的照「本段未记账」报，推进出去的按 trimmed 分两种、前置照磁盘报', () => {
  const s = read('commands/at-status.md')
  const i = s.indexOf('产物随参与者展开的段（`S2`、`S5`）里')
  assert.ok(i >= 0, '找不到那一段')
  // 正文按宽度折行，比之前把折行去掉。
  const para = s.slice(i, s.indexOf('\n\n', i)).split('\n').join('')
  for (const phrase of [
    '这一段的记录里一个产者都没有（记的是 `[]`、或者只记了不是这一段产者的协调者，例：`S5` 只记了 `at-architect`）时，展开同样是空集',
    '还停在这一段的，照「本段未记账」那样标、那样报；已经推进出去的先看 `trimmed`',
    '这一段的产者都在 `trimmed` 里、值就是这一段的，照下面整段裁掉那一句标「整段裁掉」、不报 ✗；不是的话标「记了账、没叫人也没裁」，这一段的产者交的、后面某一段要它当前置的那几份（例：`S2` 里`at-product` 的 `01-prd.md`）照磁盘报 ✓ / ✗，其余不报 ✗',
    '推进出去的这两种都不报成「这一段没有产物该在」',
    '产物固定的段记成 `[]` 展开不是空集，照上一段按展开结果报',
    // docs/89 §8：展开不是空集、却没叫被当前置的那个产者的（S2 只记了 at-ui），那几份同样照磁盘报。
    '记了产者、却没叫后面要当前置的那个产者、也没在这一段裁掉它的（例：`S2` 只记了 `at-ui`），它的那几份（`01-prd.md`）同样照磁盘报 ✓ / ✗',
  ]) assert.ok(para.includes(phrase), `${phrase}：${para}`)
  // 排在「本段未记账」那一段之后、S5 实现记录那一段之前。
  assert.ok(i > s.indexOf('本段未记账') && i < s.indexOf('`S5` 的实现记录在磁盘上不等于交齐'), '位置不对')
  // 「当前阶段」那一格也认这一种。
  const cur = s.slice(s.indexOf('当前阶段:'), s.indexOf('\n', s.indexOf('当前阶段:')))
  assert.ok(cur.includes('记的是 `[]` 或者只记了不是这一段产者的协调者'), cur)
})
