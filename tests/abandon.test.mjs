// 放弃收尾（hooks/lib/abandon.mjs）：用户经规范标签「放弃这一趟」批准、门禁记下，一次写入记 closed_at 与 abandoned: true，不核产物，之后照收口冻结。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ABANDON_LABEL, ABANDON_KIND, abandonAnswer, abandonLine, readAbandoned, isAbandoning, decideAbandon, abandonNotice } from '../hooks/lib/abandon.mjs'
import { takeoverAnswer, TAKEOVER_LABEL } from '../hooks/lib/owner.mjs'
import { STATE_KEYS } from '../hooks/lib/state.mjs'

const T = '2026-11-06T10:00:00Z'
const S = (over = {}) => ({ stage: 'S5', history: [{ stage: 'S1', at: T }, { stage: 'S5', at: T }], closed_at: null, ...over })

test('常量逐字；abandoned 是 state.json 的已知键', () => {
  assert.equal(ABANDON_LABEL, '放弃这一趟')
  assert.equal(ABANDON_KIND, 'abandon')
  assert.ok(STATE_KEYS.includes('abandoned'))
})

test('isAbandoning：写入前没收口、写入后收口、带 abandoned: true 才是', () => {
  assert.equal(isAbandoning(S(), S({ closed_at: T, abandoned: true })), true)
  assert.equal(isAbandoning(S(), S({ closed_at: T })), false, '普通收口')
  assert.equal(isAbandoning(S({ closed_at: T, abandoned: true }), S({ closed_at: T, abandoned: true })), false, '已经放弃了')
  assert.equal(isAbandoning(null, S({ closed_at: T, abandoned: true })), true, '写入前读不出也算')
})

test('decideAbandon：abandoned 不是布尔、单独写 abandoned: true、放弃时改了 stage 或 history、没有批准——拒；批准过放行；普通收口不归它管', () => {
  const bad = (before, after, approved, re) => {
    const r = decideAbandon({ before, after, approved })
    assert.equal(r.ok, false, JSON.stringify(after))
    if (re) assert.match(r.reason, re)
  }
  bad(S(), S({ abandoned: 'yes' }), true, /abandoned/)
  bad(S(), S({ abandoned: true }), true, /closed_at/)
  bad(S(), S({ closed_at: T, abandoned: true, stage: 'S6' }), true, /stage/)
  bad(S(), S({ closed_at: T, abandoned: true, history: [{ stage: 'S1', at: T }] }), true, /history/)
  bad(S(), S({ closed_at: T, abandoned: true }), false, new RegExp(ABANDON_LABEL))
  assert.equal(decideAbandon({ before: S(), after: S({ closed_at: T, abandoned: true }), approved: true }).ok, true)
  assert.equal(decideAbandon({ before: S(), after: S({ closed_at: T }), approved: false }).ok, true)
  assert.equal(decideAbandon({ before: S(), after: S({ abandoned: false }), approved: false }).ok, true)
})

test('abandonAnswer：单独一道单选题里干净地选了「放弃这一趟」才认，带备注、多选、夹了别的话不认；takeoverAnswer 照旧', () => {
  const tr = (answer, extra = {}, multi = false) => ({ questions: [{ question: '放弃 20261106-1000-x 吗？', multiSelect: multi }], answers: { '放弃 20261106-1000-x 吗？': answer }, ...extra })
  assert.deepEqual(abandonAnswer(tr(ABANDON_LABEL)), { question: '放弃 20261106-1000-x 吗？' })
  assert.equal(abandonAnswer(tr('不放弃')), null)
  assert.deepEqual(abandonAnswer(tr(ABANDON_LABEL, { annotations: { '放弃 20261106-1000-x 吗？': { notes: '先留着' } } })), { why: 'notes' })
  assert.deepEqual(abandonAnswer(tr(ABANDON_LABEL, {}, true)), { why: 'multi' })
  assert.deepEqual(abandonAnswer(tr(ABANDON_LABEL + '吧，算了')), { why: 'malformed' })
  assert.deepEqual(takeoverAnswer({ questions: [{ question: 'Q', multiSelect: false }], answers: { Q: TAKEOVER_LABEL } }), { label: TAKEOVER_LABEL, question: 'Q' })
})

test('abandonLine 与 readAbandoned：只认 kind 为 abandon 的行', () => {
  assert.equal(readAbandoned(abandonLine({ at: T, runId: 'r1' }) + '\n'), true)
  assert.equal(readAbandoned('{"kind":"tweak-done","contract":"x"}\n{bad\n'), false)
  assert.equal(readAbandoned(null), false)
})

test('abandonNotice：记下了给出写法（closed_at 与 abandoned: true、stage 与 history 原样）；没记下说原因', () => {
  const ok = abandonNotice({ runId: 'r1', why: null, now: new Date(T) })
  assert.match(ok, /【放弃】/)
  assert.match(ok, /"r1"/)
  assert.match(ok, /"abandoned": true/)
  assert.match(ok, new RegExp(T))
  const no = abandonNotice({ runId: 'r1', why: 'unbound' })
  assert.match(no, /没有记成/)
  assert.doesNotMatch(no, /undefined/)
})
