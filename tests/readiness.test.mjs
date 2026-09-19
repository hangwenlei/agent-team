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

// M2a Task 4 之后的穷举 grep 找出的第三处 <role> 消费方（前两处 writepath.mjs 的
// producesOf 与 deliverable.mjs 的 decideDeliverable 由 Task 4 实现者抓到并修了）。
// 这里的两条判据原来直接读字面量 stage.produces：
//   - producerOf：查不到 05-impl/at-backend.md 的归属，错误文案丢掉「（S5 的产物）」
//   - done：artifactExists('05-impl/<role>.md') 恒假 → S5 永远判未完成
const M2A_STAGES = {
  S4: { role: 'at-pm', requires: [], produces: ['04-dispatch.md'] },
  S5: {
    role: 'at-backend',
    producers: ['at-backend', 'at-frontend'],
    requires: ['04-dispatch.md'],
    produces: ['05-impl/<role>.md'],
  },
}

test('H2：<role> 阶段的 done 判据按 roster 展开——这一趟只派了后端且它交了，S5 算完成', () => {
  const r = decideReadiness({
    targetRole: 'at-backend',
    stages: M2A_STAGES,
    roster: ['at-backend'],
    artifactExists: (p) => ['04-dispatch.md', '05-impl/at-backend.md'].includes(p),
  })
  assert.equal(r.decision, 'allow')
})

test('H2：<role> 阶段 done 判据不再拿字面量去查磁盘——artifactExists 收到的名字里不含 <role>', () => {
  const seen = []
  decideReadiness({
    targetRole: 'at-backend',
    stages: M2A_STAGES,
    roster: ['at-backend'],
    artifactExists: (p) => { seen.push(p); return true },
  })
  assert.equal(seen.some((p) => p.includes('<role>')), false, `artifactExists 收到了含占位符的名字：${JSON.stringify(seen)}`)
})

test('前置条件：上一条的 artifactExists 真的被调用过——否则「没收到占位符」是空转', () => {
  const seen = []
  decideReadiness({
    targetRole: 'at-backend',
    stages: M2A_STAGES,
    roster: ['at-backend'],
    artifactExists: (p) => { seen.push(p); return true },
  })
  assert.ok(seen.length > 0)
})

test('H2：producerOf 认得出 <role> 展开后的产物归属——缺失项的错误文案要点名它是哪一段的产物', () => {
  const r = decideReadiness({
    targetRole: 'at-qa',
    stages: {
      ...M2A_STAGES,
      S6: { role: 'at-qa', requires: ['05-impl/at-backend.md'], produces: ['06-test.md'] },
    },
    roster: ['at-backend', 'at-qa'],
    artifactExists: (p) => p === '04-dispatch.md',
  })
  assert.match(r.reason, /05-impl\/at-backend\.md（S5 的产物）/)
})
