// M4j（docs/45，审查第 20 条与「契约修订之后，验证段的结论不要求重出」）：正文——/agent-team:at 第 4 节写修订块那一段之后、契约格式的
// skill、契约模板的修订块格式、项目经理红线里第 1 节那一条、README 两半的 run 目录树。门禁那一半在 tests/contract-base.test.mjs、
// tests/gate-contract-base.test.mjs。承重的句子整句钉（空白不计）。复核（docs/45 §8）之后改了 at.md 那一段、加了模板与 skill 的标题那一句。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const bodyOf = (role) => read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---')

const AT_AFTER_REVISION =
  '**改需求的修订之后，验证段的结论对着的是上一版**：修订块的标题照模板写（`### <日期> · 升级 #<n>（kind: <类别>）`、`### <日期> · 用户主动提出`），' +
  '门禁按它分——这次新加的修订块全是 sensitive、env-blocked、budget-exhausted 这几类答复的，不改需求，验证段的结论不用重出；别的修订（用户主动' +
  '提出的、取舍与契约冲突、缺口的答复、改了第 2、3 节的），门禁记下那一刻已经写成的测试报告、验收结论、交付文档与还在跑的验证段角色（写契约' +
  '那一次的【契约】会列出来、给出出路）：推进与收口之前它们要对着这一版重出——在当前段之前的照第 3 节「回退」记回到最早那一段，在当前段的同段' +
  '重派（交付文档是你自己的，重写），在后面的段走到时照常重出。第 1 节推进出 S1 之后门禁也记下了：之后改了它，推进与收口都会被拒——用户改需求' +
  '写修订块，第 1 节原样留着。'
test('M4j：/agent-team:at 第 4 节——改需求的修订之后验证段的结论要重出（按标题分、出路看当前段），第 1 节推进出 S1 之后就定了', () => {
  const at = read('commands/at.md')
  const s = at.slice(at.indexOf('**用户主动改需求**'), at.indexOf('**返工预算耗尽（`budget-exhausted`）不靠你自己数**'))
  assert.ok(has(s, AT_AFTER_REVISION), s)
})

const SKILL_LOCK =
  '**推进出 S1 之后，门禁记下第 1 节**（这一趟 run 目录里的 `contract-base.json`）：之后改了它，写契约那一次的回传（【契约】）就说，' +
  '推进与收口都会被拒，改回去才放行。'
const SKILL_HEADING = '修订块的标题照模板写（带 `kind: <类别>`，或标「用户主动提出」）：门禁按它分哪些修订要测试与验收的结论重出。'
test('M4j：契约格式的 skill——推进出 S1 之后门禁记下第 1 节；修订块的标题照模板写', () => {
  const skill = read('skills/at-contract-format/SKILL.md')
  assert.ok(has(skill.slice(skill.indexOf('## 唯一不可让步的一条'), skill.indexOf('## 其余各节')), SKILL_LOCK))
  assert.ok(has(skill.slice(skill.indexOf('## 修订只有一条合法路径'), skill.indexOf('## 如果你认为契约本身有问题')), SKILL_HEADING))
})

const TEMPLATE_HEADING = '标题照这个格式写：门禁按 kind 分哪些修订要验证段的结论重出——sensitive、env-blocked、budget-exhausted 的答复不用，别的（含用户主动提出）要。'
test('M4j：契约模板的修订块格式——写明门禁按标题里的 kind 分', () => {
  const t = read('templates/00-contract.md')
  assert.ok(has(t.slice(t.indexOf('<!-- 修订块格式：'), t.indexOf('-->', t.indexOf('<!-- 修订块格式：'))), TEMPLATE_HEADING))
})

const PM_LOCK = '推进出 S1 之后它就定了：门禁记下了它，之后改了它，推进与收口都会被拒。'
test('M4j：项目经理的红线——第 1 节那一条写明推进出 S1 之后就定了', () => {
  const pm = bodyOf('at-pm')
  const s = pm.slice(pm.indexOf('- **契约的第 1 节逐字照抄用户原话。**'), pm.indexOf('- **不得声称做完了没做的事。**'))
  assert.ok(has(s, PM_LOCK), s)
})

test('M4j（复核 F10）：README 两半的 run 目录树列上 contract-base.json', () => {
  const r = read('README.md')
  assert.ok(r.includes('    ├── contract-base.json 门禁记下的契约基线：你的原话，每次改需求时验证段结论的样子'), '中文半')
  assert.ok(r.includes("    ├── contract-base.json the gates' contract baseline: your words, and the verification conclusions at each requirement change"), '英文半')
})
