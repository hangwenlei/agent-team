import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLedgerNotices } from '../hooks/lib/ledger.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
}
const SHA = 'sha256:' + 'b'.repeat(64)
const base = {
  kind: 'other', contractSha: null, state: { stage: 'S1', contract_sha: 'PENDING' },
  reach: null, stages: STAGES, stageDone: false, stateProblems: [],
}
const joined = (over) => buildLedgerNotices({ ...base, ...over }).join('\n')

test('无事可报时返回空数组——不要每次写文件都刷一屏', () => {
  assert.deepEqual(buildLedgerNotices(base), [])
})

test('写了契约：把哈希交回去，并说明要原样写进 contract_sha', () => {
  const s = joined({ kind: 'contract', contractSha: SHA })
  assert.ok(s.includes(SHA))
  assert.match(s, /contract_sha/)
  assert.match(s, /不要自己拼/)
})

test('写了契约且已记过同一个哈希：不报', () => {
  const notices = buildLedgerNotices({
    ...base, kind: 'contract', contractSha: SHA,
    state: { stage: 'S1', contract_sha: SHA },
  })
  assert.deepEqual(notices, [])
})

test('契约漂移：报出来，并点名 escalations', () => {
  const s = joined({
    kind: 'contract', contractSha: SHA,
    state: { stage: 'S1', contract_sha: 'sha256:' + 'c'.repeat(64) },
  })
  assert.match(s, /漂移/)
  assert.match(s, /escalations/)
})

test('写了 project.json：交回触达表，并标出被放大的角色与那条派发链', () => {
  const reach = {
    'at-product': {
      own: ['docs/'], reachableRoles: ['at-backend'],
      reach: ['docs/', 'src/server/'],
      widenedBy: { 'src/server/': 'at-product → at-backend' }, widened: true,
    },
    'at-backend': { own: ['src/server/'], reachableRoles: [], reach: ['src/server/'], widenedBy: {}, widened: false },
  }
  const s = joined({ kind: 'project', reach })
  assert.match(s, /reach\.json/)
  assert.ok(s.includes('at-product → at-backend'))
  assert.ok(s.includes('src/server/'))
  // docs/09 账二实现约束 1：它是审计产物，措辞不得说成「限制」。
  assert.doesNotMatch(s, /限制/)
})

test('触达表里没有任何角色被放大时，也要说一句「没有」而不是沉默', () => {
  const reach = { a: { own: ['p/'], reachableRoles: [], reach: ['p/'], widenedBy: {}, widened: false } }
  const s = joined({ kind: 'project', reach })
  assert.match(s, /reach\.json/)
  assert.match(s, /没有角色的触达超出/)
})

test('state.json 有问题：逐条交回', () => {
  const s = joined({ kind: 'state', stateProblems: ['rework["S2"] 是 0，但 history 里 S2 出现了 3 次'] })
  assert.match(s, /rework/)
  assert.match(s, /state\.json/)
})

test('当前阶段产物已齐：提示推进，并说明不推进会让 H5 哑掉', () => {
  const s = joined({ stageDone: true })
  assert.match(s, /S2/)          // nextStage(STAGES, 'S1')
  assert.match(s, /history/)
  assert.match(s, /H5/)
})

test('最后一个阶段产物齐了：提示收口，不瞎报下一阶段', () => {
  const s = joined({ stageDone: true, state: { stage: 'S2', contract_sha: 'PENDING' } })
  assert.doesNotMatch(s, /推进到 S3/)
})

test('退化输入一律不抛', () => {
  for (const bad of [null, undefined, {}, { kind: 'contract' }]) {
    assert.doesNotThrow(() => buildLedgerNotices(bad ?? {}))
  }
})
