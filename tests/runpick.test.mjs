// 并行微调——挑这一趟（hooks/lib/runpick.mjs）：子代理按派发记录认回派它的那一趟微调，主线程按会话认它名下没收口的那一趟微调，都不是回 null（照 current-run）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTweakRun, pickRun } from '../hooks/lib/runpick.mjs'

test('isTweakRun：state 写着 tweak、run 目录里绑着 at-tweak 的原话记录才算', () => {
  assert.equal(isTweakRun({ state: { mode: 'tweak' }, words: { command: 'at-tweak' } }), true)
  assert.equal(isTweakRun({ state: { mode: 'tweak' }, words: null }), false)
  assert.equal(isTweakRun({ state: { mode: 'tweak' }, words: { command: 'at' } }), false)
  assert.equal(isTweakRun({ state: { mode: 'full' }, words: { command: 'at-tweak' } }), false)
  assert.equal(isTweakRun({ state: null, words: { command: 'at-tweak' } }), false)
})

const T = (over = {}) => [
  { id: 't1', open: true, owner: 's-1', agentIds: ['a1'], ...(over.t1 ?? {}) },
  { id: 't2', open: true, owner: 's-2', agentIds: ['a2'], ...(over.t2 ?? {}) },
]

test('pickRun：带 agent_id 先按派发记录认（收尾了的微调也认）', () => {
  assert.deepEqual(pickRun({ agentId: 'a2', sessionId: 's-1', tweaks: T() }), { runId: 't2', via: 'agent' }, '派发记录优先于会话')
  assert.deepEqual(pickRun({ agentId: 'a2', tweaks: T({ t2: { open: false } }) }), { runId: 't2', via: 'agent' })
})

// 实测（docs/105 §8）：前台派发（-p、SDK 宿主）的派发记录要等子代理跑完才记，它跑着的时候认不出 agent_id。子代理 hook 输入里的会话 id 是派它的主会话那一个，
// 这个会话名下恰好一趟没收尾的微调就是它；会话也对不上的回 null。
test('pickRun：agent_id 认不出时按会话认这个会话名下没收尾的那一趟（via agent-session）；会话对不上、只有收尾了的、读不到会话 id 回 null', () => {
  assert.deepEqual(pickRun({ agentId: 'zz', sessionId: 's-1', tweaks: T() }), { runId: 't1', via: 'agent-session' })
  assert.equal(pickRun({ agentId: 'zz', sessionId: 's-9', tweaks: T() }), null)
  assert.equal(pickRun({ agentId: 'zz', sessionId: 's-1', tweaks: T({ t1: { open: false } }) }), null)
  assert.equal(pickRun({ agentId: 'zz', tweaks: T() }), null)
  // 终审：agent_id 在别的一趟（不是微调）的派发记录里——不走按会话认的退路。
  assert.equal(pickRun({ agentId: 'zz', sessionId: 's-1', tweaks: T(), agentElsewhere: true }), null)
})

test('pickRun：主线程按会话认它名下没收口的那一趟；收口了的、读不到会话 id、不是主线程都不认', () => {
  assert.deepEqual(pickRun({ mainThread: true, sessionId: 's-2', tweaks: T() }), { runId: 't2', via: 'session' })
  assert.equal(pickRun({ mainThread: true, sessionId: 's-2', tweaks: T({ t2: { open: false } }) }), null)
  assert.equal(pickRun({ mainThread: true, sessionId: '', tweaks: T() }), null)
  assert.equal(pickRun({ mainThread: true, tweaks: T() }), null)
  assert.equal(pickRun({ mainThread: false, sessionId: 's-1', tweaks: T() }), null)
  assert.equal(pickRun({ mainThread: true, sessionId: 's-9', tweaks: T() }), null)
  assert.equal(pickRun({ mainThread: true, sessionId: 's-1', tweaks: null }), null)
})

test('pickRun：同一个会话名下有两趟没收口的（正路上不会有），取 run id 按字符串排最大的那一趟', () => {
  const tweaks = [
    { id: '20261106-1000-a', open: true, owner: 's-1', agentIds: [] },
    { id: '20261106-1200-b', open: true, owner: 's-1', agentIds: [] },
  ]
  assert.deepEqual(pickRun({ mainThread: true, sessionId: 's-1', tweaks }), { runId: '20261106-1200-b', via: 'session' })
})

// 开销（docs/106）：派发记录按需读——agentIds、agentInPointer、agentElsewhere 都可以是 getter，用到才读。顺序：开着的微调 → current-run 那一趟 → 收口了的微调 → 按会话认。
test('pickRun 按需读：开着的微调里认到就不读收口了的；在 current-run 那一趟的派发记录里就不读收口了的微调；会话名下不是恰好一趟时不问别的 run', () => {
  const reads = []
  const tw = (id, open, owner, ids) => ({ id, open, owner, get agentIds() { reads.push(id); return ids } })
  assert.deepEqual(pickRun({ agentId: 'a1', tweaks: [tw('c1', false, 's-x', ['zz']), tw('o1', true, 's-1', ['a1'])] }), { runId: 'o1', via: 'agent' })
  assert.deepEqual(reads, ['o1'], '开着的那一趟认到了，收口了的不读')

  reads.length = 0
  let pointerAsked = 0
  const inPointer = { agentId: 'af', sessionId: 's-1', tweaks: [tw('c1', false, 's-x', []), tw('o1', true, 's-1', [])], get agentInPointer() { pointerAsked++; return true } }
  assert.equal(pickRun(inPointer), null, '派它的是 current-run 那一趟：照指针判')
  assert.deepEqual(reads, ['o1'], '收口了的不读')
  assert.equal(pointerAsked, 1)

  reads.length = 0
  assert.deepEqual(pickRun({ agentId: 'ac', tweaks: [tw('c1', false, 's-x', ['ac']), tw('o1', true, 's-1', [])], agentInPointer: false }), { runId: 'c1', via: 'agent' }, '收口了的照样认')

  let elsewhereAsked = 0
  const noSession = { agentId: 'zz', sessionId: 's-9', tweaks: [tw('o1', true, 's-1', [])], agentInPointer: false, get agentElsewhere() { elsewhereAsked++; return false } }
  assert.equal(pickRun(noSession), null)
  assert.equal(elsewhereAsked, 0, '会话名下没有微调，不问别的 run')
  const withSession = { agentId: 'zz', sessionId: 's-1', tweaks: [tw('o1', true, 's-1', [])], agentInPointer: false, get agentElsewhere() { elsewhereAsked++; return false } }
  assert.deepEqual(pickRun(withSession), { runId: 'o1', via: 'agent-session' })
  assert.equal(elsewhereAsked, 1)
})
