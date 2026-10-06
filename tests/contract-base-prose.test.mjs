// M4j（docs/45，审查第 20 条与「契约修订之后，验证段的结论不要求重出」）：正文——/agent-team:at 第 4 节写修订块那一段之后、契约格式的
// skill、项目经理红线里第 1 节那一条。门禁那一半在 tests/contract-base.test.mjs、tests/gate-contract-base.test.mjs。承重的句子整句钉（空白不计）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const bodyOf = (role) => read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---')

const AT_AFTER_REVISION =
  '**契约修订之后，验证段的结论对着的是上一版**：修订一次契约，门禁就记下那一刻已经写成的测试报告、验收结论、交付文档（写契约那一次的' +
  '【契约】会列出来）；推进出验证段与收口之前，它们要对着这一版重出——测试报告、验收结论照第 3 节「回退」记回到最早那一段再派人，交付文档' +
  '是你自己的，重写就行。第 1 节推进出 S1 之后门禁也记下了：之后改了它，推进与收口都会被拒——用户改需求写修订块，第 1 节原样留着。'
test('M4j：/agent-team:at 第 4 节——契约修订之后验证段的结论要重出，第 1 节推进出 S1 之后就定了', () => {
  const at = read('commands/at.md')
  const s = at.slice(at.indexOf('**用户主动改需求**'), at.indexOf('**返工预算耗尽（`budget-exhausted`）不靠你自己数**'))
  assert.ok(has(s, AT_AFTER_REVISION), s)
})

const SKILL_LOCK =
  '**推进出 S1 之后，门禁记下第 1 节**（这一趟 run 目录里的 `contract-base.json`）：之后改了它，写契约那一次的回传（【契约】）就说，' +
  '推进与收口都会被拒，改回去才放行。'
test('M4j：契约格式的 skill——「唯一不可让步的一条」里写明推进出 S1 之后门禁记下第 1 节', () => {
  const skill = read('skills/at-contract-format/SKILL.md')
  const s = skill.slice(skill.indexOf('## 唯一不可让步的一条'), skill.indexOf('## 其余各节'))
  assert.ok(has(s, SKILL_LOCK), s)
})

const PM_LOCK = '推进出 S1 之后它就定了：门禁记下了它，之后改了它，推进与收口都会被拒。'
test('M4j：项目经理的红线——第 1 节那一条写明推进出 S1 之后就定了', () => {
  const pm = bodyOf('at-pm')
  const s = pm.slice(pm.indexOf('- **契约的第 1 节逐字照抄用户原话。**'), pm.indexOf('- **不得声称做完了没做的事。**'))
  assert.ok(has(s, PM_LOCK), s)
})
