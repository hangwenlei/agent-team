// 并行微调——互斥与命令展开时的【微调】（hooks/lib/parallel.mjs）。门禁子进程那一层在 tests/gate-parallel.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideExclusion, tweaksNotice } from '../hooks/lib/parallel.mjs'

const D = (id) => ({ id, startedAt: '2026-11-06T10:00:00Z', wordsHead: `改 ${id}` })

test('tweaksNotice：都空回 null；at 说开着微调时不能起完整的一趟、出路「有微调开着」', () => {
  assert.equal(tweaksNotice({ command: 'at', mine: null, others: [] }), null)
  const n = tweaksNotice({ command: 'at', mine: null, others: [D('t1'), D('t2')] })
  assert.match(n, /^【微调】/)
  assert.match(n, /"t1"/)
  assert.match(n, /"t2"/)
  assert.match(n, /"2026-11-06T10:00:00Z"/)
  assert.match(n, /有微调开着/)
})

test('tweaksNotice：at-tweak——这个会话已有一趟，出路「先收尾」；只有别的会话的，说可以并行', () => {
  const mine = tweaksNotice({ command: 'at-tweak', mine: D('t1'), others: [D('t2')] })
  assert.match(mine, /"t1"/)
  assert.match(mine, /先收尾/)
  assert.match(mine, /\/agent-team:at-tweak 第 1 节/)
  const others = tweaksNotice({ command: 'at-tweak', mine: null, others: [D('t2')] })
  assert.match(others, /并行/)
  assert.doesNotMatch(others, /先收尾/)
})

test('tweaksNotice：at-resume——这个会话的接着走；别的会话的给接手那条出路，题面带 run id', () => {
  assert.match(tweaksNotice({ command: 'at-resume', mine: D('t1'), others: [] }), /\/agent-team:at-tweak/)
  const others = tweaksNotice({ command: 'at-resume', mine: null, others: [D('t2')] })
  assert.match(others, /在这个会话接手/)
  assert.match(others, /run id/)
})

test('tweaksNotice：at-status 列全部，标出这个会话的', () => {
  const n = tweaksNotice({ command: 'at-status', mine: D('t1'), others: [D('t2')] })
  assert.match(n, /"t1"[^"]*这个会话/)
  assert.match(n, /"t2"/)
})

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
