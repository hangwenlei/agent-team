// 并行微调——互斥与命令展开时的【微调】（hooks/lib/parallel.mjs）。门禁子进程那一层在 tests/gate-parallel.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideExclusion } from '../hooks/lib/parallel.mjs'

const tw = (id, owner) => ({ id, owner })

test('decideExclusion：不是建 run 一律放行', () => {
  assert.deepEqual(decideExclusion({ creating: false, mode: 'tweak', sessionId: 's-1', pointerRun: { id: 'f1', open: true, tweak: false }, openTweaks: [tw('t1', 's-1')] }), { ok: true })
})

test('decideExclusion：建微调——读不到会话 id 拒', () => {
  const r = decideExclusion({ creating: true, mode: 'tweak', sessionId: null, pointerRun: null, openTweaks: [] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /^agent-team H6 互斥：/)
  assert.match(r.reason, /会话 id/)
})

test('decideExclusion：建微调——current-run 指着一趟没收口的完整需求，拒，出路在 at-tweak 第 1 节；指着收口了的、指着微调的放行', () => {
  const r = decideExclusion({ creating: true, mode: 'tweak', sessionId: 's-1', pointerRun: { id: 'f1', open: true, tweak: false }, openTweaks: [] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /"f1"/)
  assert.match(r.reason, /\/agent-team:at-tweak 第 1 节/)
  assert.equal(decideExclusion({ creating: true, mode: 'tweak', sessionId: 's-1', pointerRun: { id: 'f1', open: false, tweak: false }, openTweaks: [] }).ok, true)
  assert.equal(decideExclusion({ creating: true, mode: 'tweak', sessionId: 's-1', pointerRun: { id: 't0', open: true, tweak: true }, openTweaks: [] }).ok, true)
})

test('decideExclusion：建微调——这个会话名下已有一趟没收口的微调，拒，出路「先收尾」；别的会话的微调开着放行', () => {
  const r = decideExclusion({ creating: true, mode: 'tweak', sessionId: 's-1', pointerRun: null, openTweaks: [tw('t1', 's-1')] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /"t1"/)
  assert.match(r.reason, /先收尾/)
  assert.equal(decideExclusion({ creating: true, mode: 'tweak', sessionId: 's-2', pointerRun: null, openTweaks: [tw('t1', 's-1')] }).ok, true)
})

test('decideExclusion：建完整的一趟——有微调没收口，拒，列出它们、出路「有微调开着」；没有就放行', () => {
  const r = decideExclusion({ creating: true, mode: 'full', sessionId: 's-3', pointerRun: null, openTweaks: [tw('t1', 's-1'), tw('t2', 's-2')] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /"t1"/)
  assert.match(r.reason, /"t2"/)
  assert.match(r.reason, /有微调开着/)
  assert.equal(decideExclusion({ creating: true, mode: 'full', sessionId: 's-3', pointerRun: null, openTweaks: [] }).ok, true)
})
