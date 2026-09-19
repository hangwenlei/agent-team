import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stageRoles, expandProduces, producedNames, expectedArtifacts } from '../hooks/lib/stages.mjs'

const S5 = { role: 'at-backend', producers: ['at-backend', 'at-frontend', 'at-ui'], produces: ['05-impl/<role>.md'] }
const S1 = { role: 'at-pm', produces: ['00-contract.md'] }
const STAGES = { S1, S5 }

test('stageRoles：有 producers 时返回 producers，不是 role', () => {
  assert.deepEqual(stageRoles(S5), ['at-backend', 'at-frontend', 'at-ui'])
})

test('stageRoles：没有 producers 时退回 [role]', () => {
  assert.deepEqual(stageRoles(S1), ['at-pm'])
})

test('stageRoles：形状不对时返回空数组，不抛', () => {
  assert.deepEqual(stageRoles(null), [])
})

test('expandProduces：<role> 按给定角色逐个展开', () => {
  assert.deepEqual(expandProduces(S5, ['at-frontend', 'at-ui']), ['05-impl/at-frontend.md', '05-impl/at-ui.md'])
})

test('expandProduces：不含 <role> 的条目原样保留一次，不随角色数量翻倍', () => {
  assert.deepEqual(expandProduces(S1, ['at-pm', 'at-product']), ['00-contract.md'])
})

test('expandProduces：角色集合为空时，带 <role> 的条目一个都不产出', () => {
  assert.deepEqual(expandProduces(S5, []), [])
})

test('producedNames：<role> 按全部 producers 展开——validateState 要接受任何合法产者的文件', () => {
  assert.deepEqual(
    [...producedNames(STAGES)].sort(),
    ['00-contract.md', '05-impl/at-backend.md', '05-impl/at-frontend.md', '05-impl/at-ui.md'],
  )
})

test('expectedArtifacts：<role> 只按 roster ∩ producers 展开', () => {
  assert.deepEqual(
    [...expectedArtifacts(STAGES, ['at-frontend'])].sort(),
    ['00-contract.md', '05-impl/at-frontend.md'],
  )
})

test('expectedArtifacts：roster 里的角色不是这一阶段的 producer 时不产出它的名字', () => {
  assert.deepEqual([...expectedArtifacts({ S5 }, ['at-product'])], [])
})

test('expectedArtifacts：不含 <role> 的条目不受 roster 影响——S1 的产物与谁被派了无关', () => {
  assert.deepEqual([...expectedArtifacts({ S1 }, [])], ['00-contract.md'])
})

test('expectedArtifacts：roster 缺省时退回全部 producers，与 producedNames 一致', () => {
  assert.deepEqual([...expectedArtifacts(STAGES, undefined)].sort(), [...producedNames(STAGES)].sort())
})

// Task 4 Step 2：带 producers 的阶段，produces 每一条都必须含 <role>。否则
// stageOwnerOfRunPath 会把一个静态产物名归给 producers[0]，归属就错了——这条钉的是
// 仓库根真实 stages.json 本身的形状，不是 stages.mjs 的行为。
test('不变量：带 producers 的阶段，produces 每一条都必须含 <role>', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const bad = []
  for (const [id, s] of Object.entries(stages)) {
    if (!Array.isArray(s.producers)) continue
    for (const p of s.produces) if (!p.includes('<role>')) bad.push(`${id}:${p}`)
  }
  assert.deepEqual(bad, [])
})

// 正向自检锚：上一条在「stages.json 里没有任何带 producers 的阶段」时会零次迭代、
// 空转恒绿——这条证明真的有这样的阶段（S5），上一条不是在空集合上通过。
test('前置条件：stages.json 里确实有带 producers 的阶段——上一条不是空转', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const withProducers = Object.keys(stages).filter((id) => Array.isArray(stages[id].producers))
  assert.deepEqual(withProducers, ['S5'])
})
