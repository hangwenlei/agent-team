import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESCALATION_KINDS, REWORK_LIMIT, isStageDone, nextStage, reworkFromHistory, validateState } from '../hooks/lib/state.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  S3: { role: 'at-architect', requires: ['01-prd.md'], produces: ['03-arch.md'] },
}
const SHA = 'sha256:' + 'a'.repeat(64)

function good(over = {}) {
  return {
    run_id: '20260917-1430-login-sso',
    stage: 'S2',
    contract_sha: SHA,
    roster: ['at-product'],
    artifacts: { '00-contract.md': SHA },
    rework: {},
    never_invoked: ['at-frontend'],
    escalations: [],
    history: [
      { stage: 'S1', at: '2026-09-17T14:30:00Z' },
      { stage: 'S2', at: '2026-09-17T14:52:00Z' },
    ],
    ...over,
  }
}

test('合法的 state 通过', () => {
  assert.deepEqual(validateState(good(), { stages: STAGES }), { ok: true, problems: [] })
})

test('rework 由 history 推导：某阶段出现 n 次就是 n-1 次返工', () => {
  assert.deepEqual(reworkFromHistory([
    { stage: 'S1' }, { stage: 'S2' }, { stage: 'S2' }, { stage: 'S2' },
  ]), { S2: 2 })
})

test('reworkFromHistory 对空/坏输入返回空对象，不抛', () => {
  assert.deepEqual(reworkFromHistory([]), {})
  assert.deepEqual(reworkFromHistory(null), {})
  assert.deepEqual(reworkFromHistory([{ stage: 'S1' }, 'x', null]), {})
})

// 这是本任务存在的理由：把返工计数改小，必须有东西会红。
test('把 rework 改小会被抓住', () => {
  const s = good({
    stage: 'S2',
    rework: {},
    history: [{ stage: 'S1', at: 'x' }, { stage: 'S2', at: 'x' }, { stage: 'S2', at: 'x' }],
  })
  const r = validateState(s, { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /rework/.test(p) && /history/.test(p)))
})

test('把 rework 改大同样被抓住——两个方向都不许分叉', () => {
  const r = validateState(good({ rework: { S2: 1 } }), { stages: STAGES })
  assert.equal(r.ok, false)
})

test('history 最后一条必须等于 stage 字段', () => {
  const r = validateState(good({ stage: 'S3' }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /history/.test(p) && /stage/.test(p)))
})

test('history 不能为空——一个 run 至少进入过一个阶段', () => {
  assert.equal(validateState(good({ history: [], stage: 'S1' }), { stages: STAGES }).ok, false)
})

test('stage 必须是 stages.json 里存在的阶段', () => {
  const r = validateState(good({ stage: 'S9', history: [{ stage: 'S9', at: 'x' }] }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /S9/.test(p)))
})

test('contract_sha 要么是 PENDING 要么是 sha256:<64 hex>', () => {
  assert.equal(validateState(good({ contract_sha: 'PENDING' }), { stages: STAGES }).ok, true)
  assert.equal(validateState(good({ contract_sha: 'sha256:abc' }), { stages: STAGES }).ok, false)
  assert.equal(validateState(good({ contract_sha: 'a'.repeat(64) }), { stages: STAGES }).ok, false)
})

test('返工计数不得超过硬上限', () => {
  const history = [{ stage: 'S1', at: 'x' }]
  for (let i = 0; i <= REWORK_LIMIT + 1; i++) history.push({ stage: 'S2', at: 'x' })
  const s = good({ stage: 'S2', history, rework: reworkFromHistory(history) })
  const r = validateState(s, { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => new RegExp(String(REWORK_LIMIT)).test(p)))
})

test('escalations 的 kind 必须是五类之一', () => {
  const esc = { stage: 'S2', kind: 'whatever', question: 'q', answer: 'a', at: 'x' }
  const r = validateState(good({ escalations: [esc] }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => ESCALATION_KINDS.every((k) => p.includes(k))))
})

test('五类升级条件与规格 §5.1 一一对应', () => {
  assert.deepEqual(ESCALATION_KINDS, [
    'sensitive', 'contract-conflict', 'tradeoff', 'contract-hole', 'budget-exhausted',
  ])
})

test('缺字段逐条报出来，一次报全不要只报第一条', () => {
  const r = validateState({}, { stages: STAGES })
  assert.equal(r.ok, false)
  for (const k of ['run_id', 'stage', 'contract_sha', 'roster', 'artifacts', 'rework', 'never_invoked', 'escalations', 'history']) {
    assert.ok(r.problems.some((p) => p.includes(k)), `没有报出缺 ${k}`)
  }
})

test('state 本身不是对象时也不抛', () => {
  for (const bad of [null, [], 'x', 3, undefined]) {
    const r = validateState(bad, { stages: STAGES })
    assert.equal(r.ok, false)
    assert.ok(r.problems.length > 0)
  }
})

test('不给 stages 时跳过与阶段链有关的检查，其余照查', () => {
  assert.equal(validateState(good({ stage: 'S9', history: [{ stage: 'S9', at: 'x' }] }), {}).ok, true)
  assert.equal(validateState(good({ rework: { S2: 5 } }), {}).ok, false)
})

test('nextStage 按 stages 的书写顺序走，不按 id 字符串排序', () => {
  assert.equal(nextStage(STAGES, 'S1'), 'S2')
  assert.equal(nextStage(STAGES, 'S3'), null)
  assert.equal(nextStage(STAGES, 'S9'), null)
  assert.equal(nextStage(null, 'S1'), null)
})

// readiness.mjs 与 deliverable.mjs 都栽过 "S10".localeCompare("S2") < 0 那一坑
// （Task 3 评审 Minor 2）。nextStage 是第三处按顺序走阶段链的地方，一起钉住。
test('nextStage 对 S9 → S10 也对——插入序不取决于数值宽度', () => {
  const wide = { S9: { role: 'r' }, S10: { role: 'r' } }
  assert.equal(nextStage(wide, 'S9'), 'S10')
})

// isStageDone：Task 6 变异验证第 4 项发现的缺口，补在这里而不是只留在
// hooks/gate.mjs 内联——那处代码只经子进程级测试跑到，而仓库根真实 stages.json
// 里每个阶段的 produces 都只有一个元素，.every 与 .some 在单元素数组上永远同值，
// 子进程级测试判不出两者的差异（完整背景见本函数在 hooks/lib/state.mjs 里的
// 头部注释）。下面用一份合成的多产物阶段夹具，真正把 .every 的「全部」语义
// （不是 .some 的「任一」）钉住。
const have = (...names) => (rel) => names.includes(rel)
const MULTI = { S2: { role: 'at-product', requires: [], produces: ['a.md', 'b.md'] } }

test('isStageDone：produces 全部存在时为 true', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('a.md', 'b.md') }), true)
})

// 这条是全部意义所在：只有一个产物存在时，.every 必须是 false——如果这里误用
// .some，任何一个产物一到位就会误报「这个阶段齐了」，提前催 PM 推进阶段、
// 在 history 里记一条它压根没做完的记录。
test('isStageDone：只有部分 produces 存在时为 false（.every 不是 .some）', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('a.md') }), false)
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('b.md') }), false)
})

test('isStageDone：一个产物都没有时为 false', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have() }), false)
})

test('isStageDone：produces 为空数组时为 false——没有产物义务不算"齐了"', () => {
  const stages = { S1: { role: 'at-pm', requires: [], produces: [] } }
  assert.equal(isStageDone({ stage: 'S1', stages, artifactExists: have() }), false)
})

test('isStageDone：stage 在 stages 里查不到、或 stages 本身不是对象时为 false，不抛', () => {
  assert.equal(isStageDone({ stage: 'S9', stages: MULTI, artifactExists: have() }), false)
  assert.equal(isStageDone({ stage: 'S2', stages: null, artifactExists: have() }), false)
  assert.equal(isStageDone({ stage: undefined, stages: MULTI, artifactExists: have() }), false)
})
