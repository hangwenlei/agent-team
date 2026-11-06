// 单个微调——纯函数与插件文件那一层（hooks/lib/tweak.mjs、stages.tweak.json）。门禁子进程那一层在 tests/gate-tweak.test.mjs，正文在 tests/tweak-prose.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TWEAK_MODE, FULL_MODE, TWEAK_STAGES_FILE, DONE_LABEL, DONE_KIND, TWEAK_COMMAND, modeOf, stagesFileFor, tweakRoster, implStageOf } from '../hooks/lib/tweak.mjs'
import { PLUGIN_PREFIX } from '../hooks/lib/decide.mjs'
import { productsOfStage, isVerifyStage } from '../hooks/lib/stages.mjs'

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'))
const STAGES = readJson('stages.json')
const TWEAK = readJson('stages.tweak.json')
const ROSTER = readJson('roster.json')

test('常量逐字', () => {
  assert.equal(TWEAK_MODE, 'tweak')
  assert.equal(FULL_MODE, 'full')
  assert.equal(TWEAK_STAGES_FILE, 'stages.tweak.json')
  assert.equal(DONE_LABEL, '可以了，收尾')
  assert.equal(DONE_KIND, 'tweak-done')
  assert.equal(TWEAK_COMMAND, `${PLUGIN_PREFIX}at-tweak`)
})

test('modeOf：只有 mode 为 tweak 才是微调，缺、full、坏值都是 full', () => {
  assert.equal(modeOf({ mode: 'tweak' }), 'tweak')
  for (const s of [{}, { mode: 'full' }, { mode: 'Tweak' }, { mode: 1 }, null, undefined, []]) assert.equal(modeOf(s), 'full', JSON.stringify(s))
})

test('stagesFileFor 按 mode 选文件', () => {
  assert.equal(stagesFileFor({ mode: 'tweak' }), 'stages.tweak.json')
  assert.equal(stagesFileFor({ mode: 'full' }), 'stages.json')
  assert.equal(stagesFileFor({}), 'stages.json')
  assert.equal(stagesFileFor(null), 'stages.json')
})

test('tweakRoster：项目经理两行换成短链实现段的五个开发角色，别的行与入参不变', () => {
  const before = JSON.stringify(ROSTER)
  const r = tweakRoster(ROSTER, TWEAK)
  const devs = ['at-android', 'at-backend', 'at-frontend', 'at-ios', 'at-ui']
  assert.deepEqual([...r.__main__.can_delegate_to].sort(), devs)
  assert.deepEqual([...r['at-pm'].can_delegate_to].sort(), devs)
  for (const k of Object.keys(ROSTER)) if (k !== '__main__' && k !== 'at-pm') assert.deepEqual(r[k], ROSTER[k], k)
  assert.equal(JSON.stringify(ROSTER), before, '入参不变')
})

test('stages.tweak.json：段号是正常链的子集、产物名与同名段相同、只有 S6 带 test、S6 与 S8 是验证段', () => {
  const ids = Object.keys(TWEAK)
  assert.deepEqual(ids, ['S1', 'S4', 'S5', 'S6', 'S8'])
  for (const id of ids) {
    assert.ok(Object.hasOwn(STAGES, id), id)
    assert.deepEqual(productsOfStage(TWEAK[id]), productsOfStage(STAGES[id]), id)
  }
  assert.deepEqual(ids.filter((id) => TWEAK[id].test === true), ['S6'])
  assert.deepEqual(ids.filter((id) => isVerifyStage(TWEAK[id])), ['S6', 'S8'])
  assert.equal(TWEAK.S6.role, 'at-pm')
  assert.deepEqual(TWEAK.S5.requires, ['04-dispatch.md'])
  assert.ok(!Object.values(STAGES).some((s) => s.test === true), '正常链不带 test')
})

test('testStageOf：短链的 S6（test: true、角色 at-pm）认得出，正常链照旧认 at-qa 那一段', async () => {
  const { testStageOf } = await import('../hooks/lib/test-verdict.mjs')
  assert.deepEqual(testStageOf(TWEAK), { stageId: 'S6', name: '06-test.md', implStage: 'S5' })
  assert.deepEqual(testStageOf(STAGES), { stageId: 'S6', name: '06-test.md', implStage: 'S5' })
})

test('trimmedCloseBlock：没有验收段的链（短链）与验收整段裁掉同一个判法——通过放行，跑不起来、不通过、读不出拦，批准过的放行', async () => {
  const { trimmedCloseBlock, trimmedCloseText } = await import('../hooks/lib/test-verdict.mjs')
  const { sha256OfContract } = await import('../hooks/lib/contract-hash.mjs')
  const state = { stage: 'S8', roster: [], stage_roles: {}, trimmed: {}, history: [] }
  const of = (text) => trimmedCloseBlock({ stages: TWEAK, state, bytesOf: () => Buffer.from(text) })
  assert.equal(of('结论：通过\n'), null)
  for (const [text, verdict] of [
    ['结论：跑不起来：没有测试命令\n', 'env'],
    ['结论：不通过\n', 'fail'],
    ['大概过了\n', null],
  ]) {
    const b = of(text)
    assert.equal(b?.verdict, verdict, text)
    assert.equal(b.accStageId, null)
    const t = trimmedCloseText(b)
    assert.match(t, /没有验收段/)
    assert.doesNotMatch(t, /把验收派出去/)
    assert.doesNotMatch(t, /null/)
  }
  const env = Buffer.from('结论：跑不起来\n')
  assert.equal(trimmedCloseBlock({ stages: TWEAK, state, bytesOf: () => env, approvedShas: [sha256OfContract(env)] }), null)
})

test('doneAnswer：只认单独一道单选题里干净地选了「可以了，收尾」', async () => {
  const { doneAnswer } = await import('../hooks/lib/tweak.mjs')
  const tr = (answer, extra = {}) => ({ questions: [{ question: 'Q', multiSelect: false }], answers: { Q: answer }, ...extra })
  assert.deepEqual(doneAnswer(tr(DONE_LABEL)), { ok: true })
  assert.deepEqual(doneAnswer(tr(DONE_LABEL + '（推荐）')), { ok: true })
  assert.equal(doneAnswer(tr('再改')), null)
  assert.equal(doneAnswer(null), null)
  assert.deepEqual(doneAnswer(tr(DONE_LABEL + '，不过标题再大点')), { why: 'malformed' })
  assert.deepEqual(doneAnswer(tr(DONE_LABEL, { annotations: { Q: { notes: '颜色再调' } } })), { why: 'notes' })
  assert.deepEqual(doneAnswer({ questions: [{ question: 'Q', multiSelect: true }], answers: { Q: DONE_LABEL } }), { why: 'multi' })
  assert.deepEqual(doneAnswer(tr(DONE_LABEL, { followUp: true })), { why: 'follow-up' })
})

test('promptDone：整条消息（去掉首尾空白、全半角）就是标签才算', async () => {
  const { promptDone } = await import('../hooks/lib/tweak.mjs')
  assert.equal(promptDone('可以了，收尾'), true)
  assert.equal(promptDone('  可以了,收尾  '), true)
  assert.equal(promptDone('可以了，收尾吧'), false)
  assert.equal(promptDone('嗯，可以了，收尾'), false)
  assert.equal(promptDone(null), false)
})

test('readDoneShas 与 doneLine：只认 kind 为 tweak-done、contract 是合法 sha 的行；返工批准的读法不认它', async () => {
  const { readDoneShas, doneLine } = await import('../hooks/lib/tweak.mjs')
  const { readGrants } = await import('../hooks/lib/budget.mjs')
  const sha = 'sha256:' + 'a'.repeat(64)
  const text = [doneLine({ at: 't', source: 'ask', contract: sha }), '{"kind":"tweak-done","contract":"x"}', '{bad', JSON.stringify({ rework_to: 'S5', covers: ['S5'] })].join('\n') + '\n'
  assert.deepEqual(readDoneShas(text), [sha])
  assert.deepEqual(readDoneShas(null), [])
  assert.equal(readGrants(doneLine({ at: 't', source: 'ask', contract: sha }) + '\n', STAGES).length, 0)
})

test('decideTweakDone：微调从 S5 推进出去，要有绑在现在契约上的记录；正常一趟、不是从 S5 推进出去不核', async () => {
  const { decideTweakDone } = await import('../hooks/lib/tweak.mjs')
  const sha = 'sha256:' + 'b'.repeat(64)
  const old = 'sha256:' + 'c'.repeat(64)
  const st = (stage, mode = 'tweak') => ({ mode, stage })
  const d = (before, after, doneShas) => decideTweakDone({ before, after, stages: TWEAK, contractSha: sha, doneShas })
  assert.equal(d(st('S5'), st('S6'), [sha]).ok, true)
  const no = d(st('S5'), st('S6'), [])
  assert.equal(no.ok, false)
  assert.match(no.reason, new RegExp(DONE_LABEL))
  assert.equal(d(st('S5'), st('S6'), [old]).ok, false, '绑在旧契约上的不算')
  assert.equal(d(st('S5'), st('S5'), []).ok, true, '还在 S5')
  assert.equal(d(st('S4'), st('S5'), []).ok, true, '推进进 S5')
  assert.equal(d(st('S6'), st('S5'), []).ok, true, '回退回 S5')
  assert.equal(decideTweakDone({ before: st('S5', 'full'), after: st('S6', 'full'), stages: STAGES, contractSha: sha, doneShas: [] }).ok, true, '正常一趟')
  assert.equal(d(null, st('S6'), []).ok, true, '读不出写入之前的不核')
})

test('implStageOf：正常链与短链都是 S5', () => {
  assert.equal(implStageOf(STAGES), 'S5')
  assert.equal(implStageOf(TWEAK), 'S5')
  assert.equal(implStageOf(null), null)
})
