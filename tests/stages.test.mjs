import { test } from 'node:test'
import assert from 'node:assert/strict'
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
