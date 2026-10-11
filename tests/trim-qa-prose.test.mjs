// docs/72：整段裁掉测试那一段不算项目经理自决的班底裁剪。不叫 at-qa（验收跟着整段裁掉），这一趟一样都不验证、门禁收口时没有一份结论可读——它跟
// 「不写自动化测试」同一个口径（只有两种情形算数，docs/41），别的要问用户。门禁不读内容，这一层在正文里：/agent-team:at 第 4 节紧跟在「明确不用问的」后面
// 那一段整段钉，at-pm「什么时候打断用户」那一节的「其余一律自决」点到它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TRIM_TEST_ASK, TEST_ROLE, isTestStage } from '../hooks/lib/stages.mjs'
import { decideSingleStep, departureLines } from '../hooks/lib/advance.mjs'
import { blockerLine } from '../hooks/lib/closing.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const flat = (s) => s.replace(/\s+/g, '')

const AT_UNDECIDED =
  '**明确不用问的**（你自决）：技术选型（契约不关心的范围内）、班底裁剪、驳回路由、代码风格与目录命名、同一段里重派一个角色（不计返工）。'
// 复核（docs/72 §8，中 2）：照搬「不写测试」的两种情形站不住——at-qa 还跑已有的全部用例，「没有新行为」是被验一方的自述，「不要写测试」不等于不验收。收窄成
// 只动了文档、或者用户说了这一趟不要测试；项目没配 at-qa 的也算（中 3）；问不了用户就不裁（低 3）。
const AT_TRIM_QA =
  '**整段裁掉测试那一段不在其内**：不叫 `at-qa`（项目没配它的也算；验收跟着整段裁掉），这一趟就一样都不验证——已有的用例没人跑，门禁收口时也没有一份' +
  '结论可读。它比不写自动化测试更严，只有两种情形算数：这一次只动了文档、没有改代码；契约第 1 节用户原话或第 4 节修订记录里，用户说了这一趟不要测试' +
  '（只说不要写自动化测试的不算——那不等于不跑已有的用例、不验收）。别的照本节问用户（kind 写 `tradeoff`；契约原话要求测试的是 `contract-conflict`），' +
  '答复写成修订块；问不了用户就不裁，照常派 `at-qa`。'

const AT_WARN =
  '⚠️ **班底裁剪（上面那一种除外）是「不用问用户」，不是「不用交代」。** 自决的是要不要叫这个人，不是要不要' +
  '留痕：裁掉谁，就在当段写进 `state.json` 的 `trimmed`（做法见「## 3. 逐段推进」第 4 步）。' +
  '写了，这条决定就是可机器读的，判据读得到、不会再问；不写，判据分不出「你裁的」和' +
  '「你漏的」，只能按漏的报——**而那条报文点的是你已经想清楚过的那个人。**'

test('docs/72：/agent-team:at 第 4 节——整段裁掉测试那一段不算自决的班底裁剪，紧跟在「明确不用问的」后面，整段钉', () => {
  const at = read('commands/at.md')
  const s4 = at.slice(at.indexOf('## 4.'), at.indexOf('## 5.'))
  // 复核（docs/72 §8）：三段连着钉——「明确不用问的」、这一段、⚠️ 那一段（整段）；中间另起一段放宽、⚠️ 那一段末尾补一句放宽都红。
  assert.ok(flat(s4).endsWith(flat(AT_UNDECIDED + AT_TRIM_QA + AT_WARN)), '第 4 节以「明确不用问的」、这一段、⚠️ 那一段收尾，连着')
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

// ——— 复核（docs/72 §8） ———

const STAGES = JSON.parse(read('stages.json'))

test('门禁（复核高 1）：给出「写进 trimmed」出路的三句在测试那一段补那半句——推进出一段、一次只推一段、收口；别的段不补', () => {
  assert.equal(isTestStage(STAGES, 'S6'), true)
  assert.equal(isTestStage(STAGES, 'S7'), false)
  assert.ok(TRIM_TEST_ASK.includes('/agent-team:at 第 4 节') && TRIM_TEST_ASK.includes('问不了就照常派 ' + TEST_ROLE), TRIM_TEST_ASK)
  const s6 = departureLines(STAGES, [{ name: '06-test.md', sid: 'S6', role: 'at-qa', called: false }], []).join('\n')
  const s2 = departureLines(STAGES, [{ name: '02-ui-spec.md', sid: 'S2', role: 'at-ui', called: false }], []).join('\n')
  assert.ok(s6.includes(TRIM_TEST_ASK), s6)
  assert.ok(!s2.includes(TRIM_TEST_ASK), s2)
  const jump = decideSingleStep({ before: { stage: 'S5' }, after: { stage: 'S8' }, stages: STAGES })
  assert.ok(jump.ok === false && jump.reason.includes(TRIM_TEST_ASK), JSON.stringify(jump))
  const small = decideSingleStep({ before: { stage: 'S1' }, after: { stage: 'S3' }, stages: STAGES })
  assert.ok(small.ok === false && !small.reason.includes(TRIM_TEST_ASK), JSON.stringify(small))
  const close6 = blockerLine(STAGES, { name: '06-test.md', why: 'missing', require: true }, { stage: 'S8', stage_roles: { S6: [] } })
  const close7 = blockerLine(STAGES, { name: '07-acceptance.md', why: 'missing', require: true }, { stage: 'S8', stage_roles: { S7: [] } })
  assert.ok(close6.includes(TRIM_TEST_ASK), close6)
  assert.ok(!close7.includes(TRIM_TEST_ASK), close7)
})

test('正文（复核中 1、低 1、低 3）：第 3 节第 4 步的例子、第 6 节第四步、第 1 节与第 6 节两段都裁掉、⚠️ 那一句都指回第 4 节', () => {
  const at = read('commands/at.md')
  for (const s of [
    '交付文档里写明少了哪几段。整段裁掉测试那一段要用户的话（第 4 节）。',
    '这条前置就不要求（整段裁掉测试那一段要用户的话，第 4 节）；叫过却没交的',
    '门禁记下了（测试那一段也整段裁掉的没有测试报告，这一条不看），再看交付文档；',
    '测试那一段也整段裁掉的没有测试报告，门禁收口什么结论都不读：交付文档里写明这一趟没有测试、也没有验收。',
    '⚠️ **班底裁剪（上面那一种除外）是「不用问用户」，不是「不用交代」。**',
  ]) assert.ok(flat(at).includes(flat(s)), s)
})

test('正文（复核中 1、中 3、低 2）：at-resume 两处、04-dispatch 模板、at-init 的 available_roles、at-status 的整段裁掉', () => {
  const resume = read('commands/at-resume.md')
  assert.equal(flat(resume).split(flat('（整段裁掉测试那一段要用户的话，照')).length - 1, 2, 'at-resume 两处')
  assert.ok(flat(read('templates/04-dispatch.md')).includes(flat('班底裁剪（整段裁掉测试那一段除外：要用户的话，见 /agent-team:at 第 4 节）')), '04-dispatch 模板')
  assert.ok(
    flat(read('commands/at-init.md')).includes(flat('**`at-qa`、`at-acceptance` 照常列**，不因为项目没有测试框架、没有验收标准之类的理由不列——不列它们，这个项目的每一趟都不验证；那要用户的话')),
    'at-init',
  )
  assert.ok(flat(read('commands/at-status.md')).includes(flat('的产物标「整段裁掉」，不报 ✗。')), 'at-status')
})
