import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideReadiness } from '../hooks/lib/readiness.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  S3: { role: 'at-architect', requires: ['00-contract.md', '01-prd.md'], produces: ['03-arch.md'] },
}

const have = (...names) => (rel) => names.includes(rel)

test('前置产物齐全时放行', () => {
  const r = decideReadiness({ targetRole: 'at-product', stages: STAGES, artifactExists: have('00-contract.md') })
  assert.equal(r.decision, 'allow')
})

test('前置产物缺失时拒绝', () => {
  const r = decideReadiness({ targetRole: 'at-product', stages: STAGES, artifactExists: have() })
  assert.equal(r.decision, 'deny')
})

test('拒绝理由点名缺的是哪个产物', () => {
  const r = decideReadiness({ targetRole: 'at-product', stages: STAGES, artifactExists: have() })
  assert.match(r.reason, /00-contract\.md/)
})

test('拒绝理由指明该先跑哪一阶段', () => {
  const r = decideReadiness({ targetRole: 'at-architect', stages: STAGES, artifactExists: have('00-contract.md') })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /01-prd\.md/)
  assert.match(r.reason, /S2/, '应当告诉调用者 01-prd.md 是 S2 的产物')
})

test('无前置的阶段一律放行', () => {
  const r = decideReadiness({ targetRole: 'at-pm', stages: STAGES, artifactExists: have() })
  assert.equal(r.decision, 'allow')
})

test('不在阶段链里的角色不归本门禁管，放行', () => {
  const r = decideReadiness({ targetRole: 'at-worker-a', stages: STAGES, artifactExists: have() })
  assert.equal(r.decision, 'allow')
})

test('一个角色出现在多个阶段时，取尚未完成的最早那个', () => {
  // at-pm 同时是 S1 与 S4 的执行角色。S1 的产物已在、S4 的前置未齐时，
  // 应当按 S4 判定而不是按 S1 放行。
  const stages = {
    S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
    S4: { role: 'at-pm', requires: ['01-prd.md'], produces: ['04-dispatch.md'] },
  }
  const r = decideReadiness({ targetRole: 'at-pm', stages, artifactExists: have('00-contract.md') })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /01-prd\.md/)
})
