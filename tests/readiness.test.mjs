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
  // Task 3 评审 Minor 1：S3 的 requires 有两项，00-contract.md 已经满足、
  // 只有 01-prd.md 缺。只断言缺的那项出现，抓不住「missing 没过滤、把已满足
  // 的也一起报出来」这种改法——那样改了上面三条 assert 照样全绿。
  assert.doesNotMatch(r.reason, /00-contract/, '00-contract.md 已经齐了，不该出现在缺失清单里')
})

test('无前置的阶段一律放行', () => {
  const r = decideReadiness({ targetRole: 'at-pm', stages: STAGES, artifactExists: have() })
  assert.equal(r.decision, 'allow')
})

test('不在阶段链里的角色不归本门禁管，放行', () => {
  // Task 3 评审 Important 2：at-worker-a 是 c3dc888 已经改名清掉的占位角色名，
  // 不该在新测试里复活。这条用例的语义是"一个真实存在、但不在阶段链里的
  // 角色"，用 at-outsider（roster.json 里真实存在，stages.json 里确实没有
  // 它的阶段）才是这个语义，用一个不存在的名字反而测的是另一件事。
  const r = decideReadiness({ targetRole: 'at-outsider', stages: STAGES, artifactExists: have() })
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

// Task 3 评审 Minor 2："S10".localeCompare("S2") < 0——字典序会把 S10 排到
// S2 前面。stages.json 的书写顺序（Object.entries 的插入序）本来就是流水线
// 顺序，不该重新按字典序排。这条钉住"按书写顺序判定"这个真实的实现选择：
// 旧的 localeCompare 实现会先查到 requires 为空的 S10、判它已完成，
// 于是漏过 S2 真正缺失的前置，整条错判成 allow。
test('多阶段同角色按 stages 的书写顺序判定，不按阶段 id 的字典序', () => {
  const stages = {
    S2: { role: 'at-pm', requires: ['x'], produces: ['02.md'] },
    S10: { role: 'at-pm', requires: [], produces: ['10.md'] },
  }
  const r = decideReadiness({ targetRole: 'at-pm', stages, artifactExists: have() })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /S2/, '应当按书写顺序先判定 S2，不能被字典序排到 S10 后面')
})
