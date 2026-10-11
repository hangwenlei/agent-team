// docs/72：整段裁掉测试那一段不算项目经理自决的班底裁剪。不叫 at-qa（验收跟着整段裁掉），这一趟一样都不验证、门禁收口时没有一份结论可读——它跟
// 「不写自动化测试」同一个口径（只有两种情形算数，docs/41），别的要问用户。门禁不读内容，这一层在正文里：/agent-team:at 第 4 节紧跟在「明确不用问的」后面
// 那一段整段钉，at-pm「什么时候打断用户」那一节的「其余一律自决」点到它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const flat = (s) => s.replace(/\s+/g, '')

const AT_UNDECIDED =
  '**明确不用问的**（你自决）：技术选型（契约不关心的范围内）、班底裁剪、驳回路由、代码风格与目录命名、同一段里重派一个角色（不计返工）。'
const AT_TRIM_QA =
  '**整段裁掉测试那一段不在其内**：不叫 `at-qa`（验收跟着整段裁掉），这一趟就一样都不验证，门禁收口时也没有一份结论可读。它跟不写自动化测试同一个口径，' +
  '只有两种情形算数：这一次没有新行为（只动了文档、设计稿或纯视觉样式，或者重构没有改变对外的表现）；契约第 1 节用户原话或第 4 节修订记录里，用户说了不要测试。' +
  '别的照本节问用户（kind 写 `tradeoff`），答复写成修订块。'

test('docs/72：/agent-team:at 第 4 节——整段裁掉测试那一段不算自决的班底裁剪，紧跟在「明确不用问的」后面，整段钉', () => {
  const at = read('commands/at.md')
  const s4 = at.slice(at.indexOf('## 4.'), at.indexOf('## 5.'))
  assert.ok(flat(s4).includes(flat(AT_UNDECIDED + AT_TRIM_QA)), '第 4 节「明确不用问的」后面那一段')
  const start = '**整段裁掉测试那一段不在其内**'
  assert.equal(at.split(start).length - 1, 1, start)
  const from = at.indexOf(start)
  const m = /\n\s*\n/.exec(at.slice(from))
  assert.equal(flat(at.slice(from, from + (m ? m.index : at.length))), flat(AT_TRIM_QA), '那一段整段相等')
})

test('docs/72：at-pm「什么时候打断用户」——其余一律自决里的班底裁剪点到整段裁掉测试那一段的例外', () => {
  const pm = read('agents/at-pm.md')
  const sec = pm.slice(pm.indexOf('## 什么时候打断用户'))
  const end = sec.indexOf('\n## ', 1)
  assert.ok(
    flat(end < 0 ? sec : sec.slice(0, end)).includes(
      flat('其余一律自决：技术选型、班底裁剪（整段裁掉测试那一段除外，见 `/agent-team:at` 第 4 节）、驳回路由、代码风格与目录命名、同一段里重派一个角色（不计返工）。'),
    ),
    'at-pm 那一句',
  )
})
