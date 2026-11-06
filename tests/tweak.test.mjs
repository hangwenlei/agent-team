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

test('implStageOf：正常链与短链都是 S5', () => {
  assert.equal(implStageOf(STAGES), 'S5')
  assert.equal(implStageOf(TWEAK), 'S5')
  assert.equal(implStageOf(null), null)
})
