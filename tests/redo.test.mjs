// 第 16 条（M3z，docs/34）：不记回退就重派、重做——纯函数。
//
// 回退不记账，第 15 条的快照与重走把关、返工预算整条失效（它们都挂在「回退被记下」这一前提上）。派发那一刻分不出咨询、补派、
// 重做，所以只在分得出的两处拦：
//   - H2，只管叶子角色（花名册里派不出任何人：执行角色、at-ui、at-qa、at-acceptance）：按派发者选出的候选段全都早于 state.stage，
//     而且它在这些段自己的产物都「交过」→ 再派它就是重做，拒；
//   - H3：非 PM 写 run 目录里自己名下、早于 state.stage 那一段的产物，它在当前段又没有活（不是当前段的 role 或产者、也派不到
//     当前段的 role），而且那份「交过」→ 拒。
// 「交过」= 交付快照（runs/<id>/delivered.json，PM 每次写 state.json 之后由门禁照磁盘拍）里有它、磁盘内容与快照相同、而且不是
// 上一轮的（第 15 条的 freshness）。快照之后才落盘的（补派、【返工】出口）写几次都放行，直到 PM 下一次记账（O4）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  deliveredSnapshot,
  readSnapshot,
  makeDelivered,
  isLeafRole,
  hasWorkIn,
  decideRedispatch,
  decideRedoWrite,
} from '../hooks/lib/redo.mjs'
import { candidateStages } from '../hooks/lib/readiness.mjs'
import { computeReach } from '../hooks/lib/reach.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const REACH = computeReach({ roster: ROSTER, paths: {} })
const reachOf = (role) => (Object.hasOwn(REACH, role) ? REACH[role].reachableRoles : null)
const SHA = (c) => 'sha256:' + c.repeat(64)

// ============================================================================ 交付快照

test('deliveredSnapshot：早于当前段的每一段、按全部产者展开的产物，磁盘上在、读得出的记 sha', () => {
  const disk = {
    '00-contract.md': SHA('0'),
    '01-prd.md': SHA('1'),
    '02-ui-spec.md': SHA('2'),
    '03-arch.md': SHA('3'),
    '04-dispatch.md': SHA('4'),
    '05-impl/at-backend.md': SHA('5'),
  }
  const diskSha = (n) => (Object.hasOwn(disk, n) ? { exists: true, sha: disk[n] } : { exists: false, sha: null })
  assert.deepEqual(deliveredSnapshot({ stages: STAGES, stageId: 'S3', diskSha }), {
    '00-contract.md': SHA('0'),
    '01-prd.md': SHA('1'),
    '02-ui-spec.md': SHA('2'),
  })
  // 当前段及之后的不记：S5 的实现记录在 S5 时不进快照。
  assert.equal(Object.hasOwn(deliveredSnapshot({ stages: STAGES, stageId: 'S5', diskSha }), '05-impl/at-backend.md'), false)
  assert.equal(deliveredSnapshot({ stages: STAGES, stageId: 'S6', diskSha })['05-impl/at-backend.md'], SHA('5'))
})

test('deliveredSnapshot：在、但读不出来的不记（少拦一侧）；stage 不在链上、阶段链读不出来 → null（快照不动）', () => {
  const diskSha = (n) => (n === '00-contract.md' ? { exists: true, sha: null } : { exists: false, sha: null })
  assert.deepEqual(deliveredSnapshot({ stages: STAGES, stageId: 'S2', diskSha }), {})
  assert.equal(deliveredSnapshot({ stages: STAGES, stageId: 'S9', diskSha }), null)
  assert.equal(deliveredSnapshot({ stages: STAGES, stageId: { toString: 1 }, diskSha }), null)
  assert.equal(deliveredSnapshot({ stages: null, stageId: 'S2', diskSha }), null)
})

test('readSnapshot：只留值是合法 sha 的条目；坏文件、不是对象 → 空', () => {
  const wrap = (products) => JSON.stringify({ stage: 'S5', products })
  assert.deepEqual(readSnapshot(wrap({ a: SHA('a'), b: 'x', c: 1 })).products, { a: SHA('a') })
  assert.deepEqual(readSnapshot(String.fromCharCode(0xfeff) + wrap({ a: SHA('a') })).products, { a: SHA('a') })
  for (const t of [null, undefined, '{坏', '[]', '"x"', '']) assert.deepEqual(readSnapshot(t), { stage: null, products: {} }, String(t))
})

test('makeDelivered：快照里有、磁盘与快照相同、不是上一轮的，才算交过；读不出来一律不算', () => {
  const snapshot = { a: SHA('a'), b: SHA('b'), c: SHA('c') }
  const disk = { a: SHA('a'), b: SHA('x'), c: SHA('c'), d: SHA('d') }
  const delivered = makeDelivered({
    snapshot,
    artifactSha: (n) => (n === 'boom' ? (() => { throw new Error('x') })() : disk[n] ?? null),
    isStale: (n) => n === 'c',
  })
  assert.equal(delivered('a'), true)
  assert.equal(delivered('b'), false, '快照之后改过（补派、【返工】出口写过一次）')
  assert.equal(delivered('c'), false, '还是上一轮的')
  assert.equal(delivered('d'), false, '快照里没有（快照之后才落盘）')
  assert.equal(delivered('boom'), false)
  assert.equal(delivered('toString'), false)
})

// ============================================================================ 谁算叶子、谁在当前段有活

test('isLeafRole：花名册里派不出任何人的才是叶子；协调者、主线程、花名册外、花名册读坏都不是', () => {
  for (const r of ['at-backend', 'at-frontend', 'at-ui', 'at-ios', 'at-android', 'at-qa', 'at-acceptance']) assert.equal(isLeafRole(ROSTER, r), true, r)
  for (const r of ['at-architect', 'at-product', 'at-pm', '__main__', 'someone-else', 'toString']) assert.equal(isLeafRole(ROSTER, r), false, r)
  assert.equal(isLeafRole({}, 'at-backend'), false)
  assert.equal(isLeafRole(null, 'at-backend'), false)
})

test('hasWorkIn：是当前段的 role 或产者、或能（传递地）派到当前段的 role', () => {
  assert.equal(hasWorkIn({ stages: STAGES, stageId: 'S5', role: 'at-architect', reachableRoles: reachOf('at-architect') }), true)
  assert.equal(hasWorkIn({ stages: STAGES, stageId: 'S5', role: 'at-ui', reachableRoles: reachOf('at-ui') }), true)
  assert.equal(hasWorkIn({ stages: STAGES, stageId: 'S5', role: 'at-product', reachableRoles: reachOf('at-product') }), false)
  assert.equal(hasWorkIn({ stages: STAGES, stageId: 'S6', role: 'at-architect', reachableRoles: reachOf('at-architect') }), false)
  assert.equal(hasWorkIn({ stages: STAGES, stageId: 'S3', role: 'at-architect', reachableRoles: null }), true)
})

// ============================================================================ H2：叶子角色的重派

const allDelivered = () => true
const redispatch = ({ target, caller, stageId, isDelivered = allDelivered, callerCanWriteState = true }) =>
  decideRedispatch({
    stages: STAGES,
    stageId,
    target,
    roster: ROSTER,
    candidates: candidateStages(STAGES, target, caller, reachOf(caller)),
    isDelivered,
    callerCanWriteState,
  })

test('H2 B2：S6 里架构师再派 at-backend、它在 S5 的实现记录交过 → 拒（不记回退就重做 S5）', () => {
  const r = redispatch({ target: 'at-backend', caller: 'at-architect', stageId: 'S6', callerCanWriteState: false })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /05-impl\/at-backend\.md/)
  assert.match(r.reason, /state\.stage 是 S6/)
  assert.match(r.reason, /冒泡给派你的人/)
  assert.match(r.reason, /自己 Read\/Glob/)
})

test('H2 L7：S7 里 PM 派 at-qa 补测、06-test.md 交过 → 拒；PM 的出路是先记一次回退（回到 S6）再派，咨询就读产物或问用户', () => {
  const r = redispatch({ target: 'at-qa', caller: 'at-pm', stageId: 'S7' })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /回到 S6/)
  assert.match(r.reason, /「回退」/)
  assert.match(r.reason, /问用户/)
  assert.doesNotMatch(r.reason, /冒泡/)
  // 文档核对：上一份写的根因在更早一段的（06-test.md 首行写着没开跑），照回退表回到更早那一段——不是门禁算出来的这一段。
  assert.match(r.reason, /根因在更早一段[^。]*回到更早那一段/)
  assert.match(r.reason, /没开跑[^。]*核过实现记录/)
})

test('H2 P10：S5 里 at-product 派 at-ui 重做 S2、at-ui 的 S2 产物交过 → 拒（不因为 at-ui 在 S5 有活就放过）', () => {
  const r = redispatch({ target: 'at-ui', caller: 'at-product', stageId: 'S5', callerCanWriteState: false })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /02-ui-spec\.md/)
})

test('H2：同段派发（S5 里架构师派 at-ui、at-backend）放行', () => {
  assert.equal(redispatch({ target: 'at-ui', caller: 'at-architect', stageId: 'S5' }).decision, 'allow')
  assert.equal(redispatch({ target: 'at-backend', caller: 'at-architect', stageId: 'S5' }).decision, 'allow')
})

test('H2：候选段不早于当前段（stage 落后：S5 齐了还没推进就派 at-qa）放行', () => {
  assert.equal(redispatch({ target: 'at-qa', caller: 'at-pm', stageId: 'S5' }).decision, 'allow')
})

test('H2 L5：补派（产物不在快照里）、【返工】出口（上一轮的）、交了一半——都放行', () => {
  assert.equal(redispatch({ target: 'at-frontend', caller: 'at-architect', stageId: 'S6', isDelivered: () => false }).decision, 'allow')
  assert.equal(redispatch({ target: 'at-ui', caller: 'at-product', stageId: 'S5', isDelivered: (n) => n === '02-ui-spec.md' }).decision, 'allow')
})

test('H2：协调者（at-architect、at-product）派发时不判——分不出咨询、补派、重做', () => {
  assert.equal(redispatch({ target: 'at-architect', caller: 'at-pm', stageId: 'S6' }).decision, 'allow')
  assert.equal(redispatch({ target: 'at-product', caller: 'at-pm', stageId: 'S5' }).decision, 'allow')
})

test('H2：stage 不在链上、阶段链读不出来、花名册读坏 → 不判', () => {
  assert.equal(redispatch({ target: 'at-backend', caller: 'at-architect', stageId: 'S9' }).decision, 'allow')
  const args = { stageId: 'S6', target: 'at-backend', candidates: candidateStages(STAGES, 'at-backend', 'at-architect', reachOf('at-architect')), isDelivered: allDelivered, callerCanWriteState: true }
  assert.equal(decideRedispatch({ ...args, stages: null, roster: ROSTER }).decision, 'allow')
  assert.equal(decideRedispatch({ ...args, stages: STAGES, roster: {} }).decision, 'allow')
})

// ============================================================================ H3：写早段产物

const redo = ({ role, stageId, produces, isDelivered = allDelivered }) => {
  const ownerStage = Object.keys(STAGES).find((id) => {
    const s = STAGES[id]
    const list = Array.isArray(s.produces) ? s.produces.map((p) => p.split('<role>').join(role)) : s.produces[role] ?? []
    return list.includes(produces)
  })
  return decideRedoWrite({
    stages: STAGES,
    stageId,
    role,
    owner: { stageId: ownerStage, produces },
    filePath: `/p/.agent-team/runs/r1/${produces}`,
    isDelivered,
    reachableRoles: reachOf(role),
  })
}

test('H3 B4：S6 里 at-backend 改自己 S5 的实现记录（交过）→ 拒，叫它冒泡由 PM 先记回退', () => {
  const r = redo({ role: 'at-backend', stageId: 'S6', produces: '05-impl/at-backend.md' })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /回到 S5/)
  assert.match(r.reason, /冒泡给派你的人/)
})

test('H3 L8：S5 里 at-product 改 01-prd.md（交过）→ 拒（PRD 要改就回退到 S2）', () => {
  assert.equal(redo({ role: 'at-product', stageId: 'S5', produces: '01-prd.md' }).decision, 'deny')
})

test('H3 L2/L9：在当前段有活的写者改早段自己的产物放行——架构师在 S5 改 03-arch.md，at-ui 在 S5 改 02-ui-spec.md', () => {
  assert.equal(redo({ role: 'at-architect', stageId: 'S5', produces: '03-arch.md' }).decision, 'allow')
  assert.equal(redo({ role: 'at-ui', stageId: 'S5', produces: '02-ui-spec.md' }).decision, 'allow')
})

test('H3：同一个写者到了它没有活的段就拦——架构师在 S6 改 03-arch.md、at-ui 在 S6 改 02-ui-spec.md', () => {
  assert.equal(redo({ role: 'at-architect', stageId: 'S6', produces: '03-arch.md' }).decision, 'deny')
  assert.equal(redo({ role: 'at-ui', stageId: 'S6', produces: '02-ui-spec.md' }).decision, 'deny')
})

test('H3 O4：快照之后才落盘、快照之后改过、还是上一轮的 → 放行（补派与【返工】出口写几次都行）', () => {
  assert.equal(redo({ role: 'at-backend', stageId: 'S6', produces: '05-impl/at-backend.md', isDelivered: () => false }).decision, 'allow')
})

test('H3：当前段与更晚的段不判；stage 不在链上不判', () => {
  assert.equal(redo({ role: 'at-backend', stageId: 'S5', produces: '05-impl/at-backend.md' }).decision, 'allow')
  assert.equal(redo({ role: 'at-qa', stageId: 'S5', produces: '06-test.md' }).decision, 'allow')
  assert.equal(redo({ role: 'at-backend', stageId: 'S9', produces: '05-impl/at-backend.md' }).decision, 'allow')
})

// 复核（docs/34 §3，redo-3）：交了一半的补派——H2 因为「没全交过」放行，H3 却按单份产物拦下已交的那一半。H3 的口径见下面「兄弟产物」
// 那一条：兄弟产物这一窗口刚补上才当补派（「整段都交过才算重做」会让一份从没写过的兄弟产物把这一段永久放开）。
test('复核 H3：写者在那一段自己的产物全交过 → 拦（交了一半的情形见下面「兄弟产物」那一条）', () => {
  assert.equal(redo({ role: 'at-ui', stageId: 'S6', produces: '02-ui-spec.md' }).decision, 'deny')
})

// 复核（redo-4）：快照只在 stage 变了的那次 state.json 写入之后重拍——PM 补记 stage_roles、记 escalation、标 accepted 不关补派的窗口。
test('复核 readSnapshot：delivered.json 是 { stage, products }；读出 stage 与产物', () => {
  const text = JSON.stringify({ stage: 'S6', products: { a: SHA('a'), b: 'x' } })
  assert.deepEqual(readSnapshot(text), { stage: 'S6', products: { a: SHA('a') } })
  assert.deepEqual(readSnapshot('{坏'), { stage: null, products: {} })
  assert.deepEqual(readSnapshot(JSON.stringify({ a: SHA('a') })), { stage: null, products: {} })
})

// ============================================================================ 变异补的判据（docs/34 §3）

// R05：makeDelivered 的 catch 改成「算交过」时全绿——上面那条抛异常的产物不在快照里，走不到 try。
test('变异 R05：快照里有、读的时候抛异常 → 不算交过', () => {
  const delivered = makeDelivered({ snapshot: { boom: SHA('b') }, artifactSha: () => { throw new Error('x') }, isStale: () => false })
  assert.equal(delivered('boom'), false)
  const stale = makeDelivered({ snapshot: { a: SHA('a') }, artifactSha: () => SHA('a'), isStale: () => { throw new Error('x') } })
  assert.equal(stale('a'), false)
})

// R07：「候选段全都早于当前段」改成「有一段早于」时全绿。派发者认不出（不在花名册里）时候选段退回全部：at-ui 的 S2 与 S5。
test('变异 R07：候选段里有一段不早于当前段（派发者认不出、at-ui 退回两段）→ 不判', () => {
  const r = decideRedispatch({
    stages: STAGES, stageId: 'S5', target: 'at-ui', roster: ROSTER,
    candidates: candidateStages(STAGES, 'at-ui', 'someone-else', null),
    isDelivered: allDelivered, callerCanWriteState: true,
  })
  assert.equal(r.decision, 'allow')
})

// R10：去掉「自己的产物非空」时全绿。叶子角色在候选段里一份自己的产物都没有（对象形式的 produces 里没有它）→ 不判。
test('变异 R10：叶子角色在候选段里没有自己的产物 → 不判', () => {
  const stages = {
    S1: { role: 'at-pm', produces: ['00-contract.md'] },
    S2: { role: 'at-qa', producers: ['at-qa'], produces: { other: ['x.md'] } },
    S3: { role: 'at-pm', produces: ['y.md'] },
  }
  const r = decideRedispatch({ stages, stageId: 'S3', target: 'at-qa', roster: ROSTER, candidates: [['S2', stages.S2]], isDelivered: allDelivered, callerCanWriteState: true })
  assert.equal(r.decision, 'allow')
})

// 复核（redo-3 的核验）：「整段」口径会让一份从没写过的兄弟产物（常年缺席的 03-alignment.md）把 H3 对那一段永久放开。收窄成：兄弟产物
// 在磁盘上、却不算交过（这一窗口刚补的）才当补派放行；兄弟产物根本不在，照拦。
test('复核 H3：兄弟产物这一窗口刚补（在磁盘上、不在快照里）→ 当补派放行；兄弟产物从没写过 → 照拦', () => {
  const base = { stages: STAGES, stageId: 'S6', role: 'at-ui', owner: { stageId: 'S2', produces: '02-ui-spec.md' }, filePath: '/p/x', reachableRoles: null }
  const isDelivered = (n) => n === '02-ui-spec.md'
  assert.equal(decideRedoWrite({ ...base, isDelivered, artifactExists: (n) => n === '02-wireframe.html' || n === '02-ui-spec.md' }).decision, 'allow')
  assert.equal(decideRedoWrite({ ...base, isDelivered, artifactExists: (n) => n === '02-ui-spec.md' }).decision, 'deny')
})

// M4a 复核（RE03）：最后一段的重派拒绝理由先给「收口、另起一趟」——只说给改得了 state.json 的 PM；不在最后一段时不说。
test('M4a 复核 H2：最后一段重派 at-qa——PM 收到「交付之后的新改动先收口再另起一趟」；非 PM 不收到；S7 上不说', () => {
  const pm = redispatch({ target: 'at-qa', caller: 'at-pm', stageId: 'S8' })
  assert.equal(pm.decision, 'deny')
  assert.match(pm.reason, /交付之后的新改动/)
  const other = redispatch({ target: 'at-qa', caller: 'at-pm', stageId: 'S8', callerCanWriteState: false })
  assert.doesNotMatch(other.reason, /交付之后的新改动/)
  const s7 = redispatch({ target: 'at-qa', caller: 'at-pm', stageId: 'S7' })
  assert.doesNotMatch(s7.reason, /最后一段/)
})
