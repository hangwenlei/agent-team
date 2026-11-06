// 一趟只归一个会话——纯函数那一层（hooks/lib/owner.mjs）：归属记录的读写、主线程的写入与派发碰不碰别的会话的一趟、拒绝理由、
// 接手标签怎么认、命令展开时告诉项目经理的那一段。门禁子进程那一层在 tests/gate-owner.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OWNER_FILE,
  SUPPLEMENT_LABEL,
  END_LABEL,
  TAKEOVER_LABEL,
  TAKEOVER_CLOSE_LABEL,
  BACK_LABEL,
  ownerRecord,
  readOwner,
  blocksMe,
  ownerWriteBlock,
  ownerDispatchBlock,
  ownerDenyReason,
  takeoverAnswer,
  sessionNotice,
  takeoverNotice,
} from '../hooks/lib/owner.mjs'

test('常量：文件名与五个规范标签逐字', () => {
  assert.equal(OWNER_FILE, 'owner.json')
  assert.deepEqual(
    [SUPPLEMENT_LABEL, END_LABEL, TAKEOVER_LABEL, TAKEOVER_CLOSE_LABEL, BACK_LABEL],
    ['是，回那个会话补充', '不是，结束这次', '在这个会话接手', '接手并收口，再开始这次', '回那个会话'],
  )
})

test('readOwner：坏的、缺 session_id、via 不认得的都当没有', () => {
  assert.equal(readOwner(Buffer.from('{')), null)
  assert.equal(readOwner(null), null)
  assert.equal(readOwner(Buffer.from('[]')), null)
  assert.equal(readOwner(Buffer.from(JSON.stringify({ via: 'create' }))), null)
  assert.equal(readOwner(Buffer.from(JSON.stringify({ session_id: '', via: 'create' }))), null)
  assert.equal(readOwner(Buffer.from(JSON.stringify({ session_id: 's-1', via: 'x' }))), null)
  assert.deepEqual(readOwner(Buffer.from(JSON.stringify(ownerRecord({ sessionId: 's-1', at: 't', via: 'create' })))), {
    session_id: 's-1',
    at: 't',
    via: 'create',
    previous: null,
  })
  assert.deepEqual(readOwner(Buffer.from(JSON.stringify(ownerRecord({ sessionId: 's-2', at: 't', via: 'takeover', previous: 's-1' })))), {
    session_id: 's-2',
    at: 't',
    via: 'takeover',
    previous: 's-1',
  })
})

test('blocksMe：有主人、没收口、主人不是我才算；会话 id 不是非空字符串时恒为假', () => {
  const owner = { session_id: 's-1', via: 'create' }
  assert.equal(blocksMe({ closed: false, owner }, 's-2'), true)
  assert.equal(blocksMe({ closed: false, owner }, 's-1'), false)
  assert.equal(blocksMe({ closed: true, owner }, 's-2'), false)
  assert.equal(blocksMe({ closed: false, owner: null }, 's-2'), false)
  assert.equal(blocksMe(null, 's-2'), false)
  assert.equal(blocksMe({ closed: false, owner }, ''), false)
  assert.equal(blocksMe({ closed: false, owner }, undefined), false)
})

test('ownerWriteBlock：别的会话写有归属、没收口的一趟里的文件，拒；主人、已收口、没归属、没会话 id 都放行', () => {
  const infoOf = (id) =>
    ({
      r1: { closed: false, owner: { session_id: 's-1', via: 'create' } },
      r0: { closed: true, owner: { session_id: 's-1', via: 'create' } },
      rx: { closed: false, owner: null },
    })[id] ?? null
  const same = (a, b) => a === b
  const t = (runId, creatingState = false) => ({ kind: 'run-file', runId, creatingState })
  assert.deepEqual(ownerWriteBlock({ sessionId: 's-2', target: t('r1'), pointerId: 'r1', infoOf, same }), { runId: 'r1', kind: 'run', via: 'create' })
  assert.equal(ownerWriteBlock({ sessionId: 's-1', target: t('r1'), pointerId: 'r1', infoOf, same }), null)
  assert.equal(ownerWriteBlock({ sessionId: 's-2', target: t('r0'), pointerId: 'r0', infoOf, same }), null)
  assert.equal(ownerWriteBlock({ sessionId: 's-2', target: t('rx'), pointerId: 'rx', infoOf, same }), null)
  assert.equal(ownerWriteBlock({ sessionId: null, target: t('r1'), pointerId: 'r1', infoOf, same }), null)
  assert.equal(ownerWriteBlock({ sessionId: 's-2', target: null, pointerId: 'r1', infoOf, same }), null)
})

test('ownerWriteBlock：指针指着别的会话的一趟时另建一趟、切走或指过去，拒', () => {
  const infoOf = (id) => (id === 'r1' ? { closed: false, owner: { session_id: 's-1', via: 'takeover' } } : null)
  const same = (a, b) => a === b
  assert.deepEqual(
    ownerWriteBlock({ sessionId: 's-2', target: { kind: 'run-file', runId: 'r2', creatingState: true }, pointerId: 'r1', infoOf, same }),
    { runId: 'r1', kind: 'create', via: 'takeover' },
  )
  assert.deepEqual(ownerWriteBlock({ sessionId: 's-2', target: { kind: 'pointer', newId: 'r2' }, pointerId: 'r1', infoOf, same }), {
    runId: 'r1',
    kind: 'pointer',
    via: 'takeover',
  })
  assert.deepEqual(ownerWriteBlock({ sessionId: 's-2', target: { kind: 'pointer', newId: 'r1' }, pointerId: null, infoOf, same }), {
    runId: 'r1',
    kind: 'pointer',
    via: 'takeover',
  })
  // 不是在建（state.json 已经在）、写的也不是那一趟：不归这一道管。
  assert.equal(ownerWriteBlock({ sessionId: 's-2', target: { kind: 'run-file', runId: 'r2', creatingState: false }, pointerId: 'r1', infoOf, same }), null)
  // 建的就是指针指着的那一趟（同一个目录）：按 run-file 那一支判，不另算 create。
  assert.deepEqual(
    ownerWriteBlock({ sessionId: 's-2', target: { kind: 'run-file', runId: 'r1', creatingState: true }, pointerId: 'r1', infoOf, same }),
    { runId: 'r1', kind: 'run', via: 'takeover' },
  )
  // 主人自己另建、切指针：放行。
  assert.equal(ownerWriteBlock({ sessionId: 's-1', target: { kind: 'run-file', runId: 'r2', creatingState: true }, pointerId: 'r1', infoOf, same }), null)
  assert.equal(ownerWriteBlock({ sessionId: 's-1', target: { kind: 'pointer', newId: 'r2' }, pointerId: 'r1', infoOf, same }), null)
})

test('ownerWriteBlock：改 current-run 却算不出改完指向哪一趟（newUnknown），有一趟挡我就拒', () => {
  const infoOf = (id) => (id === 'r1' ? { closed: false, owner: { session_id: 's-1', via: 'create' } } : null)
  const same = (a, b) => a === b
  const target = { kind: 'pointer', newId: null, newUnknown: true }
  assert.deepEqual(ownerWriteBlock({ sessionId: 's-2', target, pointerId: 'r0', infoOf, same, listRuns: () => ['r0', 'r1'] }), {
    runId: 'r1',
    kind: 'pointer',
    via: 'create',
  })
  assert.equal(ownerWriteBlock({ sessionId: 's-2', target, pointerId: 'r0', infoOf, same, listRuns: () => ['r0'] }), null)
  assert.equal(ownerWriteBlock({ sessionId: 's-1', target, pointerId: 'r0', infoOf, same, listRuns: () => ['r0', 'r1'] }), null)
})

test('ownerDispatchBlock：指针指着别的会话的一趟时，主线程派人拒', () => {
  const infoOf = (id) => (id === 'r1' ? { closed: false, owner: { session_id: 's-1', via: 'create' } } : null)
  assert.deepEqual(ownerDispatchBlock({ sessionId: 's-2', pointerId: 'r1', infoOf }), { runId: 'r1', kind: 'dispatch', via: 'create' })
  assert.equal(ownerDispatchBlock({ sessionId: 's-1', pointerId: 'r1', infoOf }), null)
  assert.equal(ownerDispatchBlock({ sessionId: 's-2', pointerId: null, infoOf }), null)
  assert.equal(ownerDispatchBlock({ sessionId: null, pointerId: 'r1', infoOf }), null)
})

test('ownerDenyReason：说归另一个会话（接手过的说被接手），给两条出路', () => {
  const a = ownerDenyReason({ runId: 'r1', kind: 'run', via: 'create' })
  assert.match(a, /归另一个会话/)
  assert.match(a, /别的会话的一趟/)
  assert.match(a, /\/agent-team:at-resume/)
  assert.match(a, /"r1"/)
  assert.match(ownerDenyReason({ runId: 'r1', kind: 'run', via: 'takeover' }), /被另一个会话接手/)
  assert.match(ownerDenyReason({ runId: 'r1', kind: 'create', via: 'create' }), /不能另建一趟/)
  assert.match(ownerDenyReason({ runId: 'r1', kind: 'pointer', via: 'create' }), /current-run/)
  assert.match(ownerDenyReason({ runId: 'r1', kind: 'dispatch', via: 'create' }), /派人/)
})

test('takeoverAnswer：只认单独一道单选题里干净地选了两个接手标签之一', () => {
  const tr = (answer, extra = {}) => ({ questions: [{ question: 'Q', multiSelect: false }], answers: { Q: answer }, ...extra })
  assert.deepEqual(takeoverAnswer(tr(TAKEOVER_LABEL)), { label: TAKEOVER_LABEL })
  assert.deepEqual(takeoverAnswer(tr(TAKEOVER_CLOSE_LABEL + '（推荐）')), { label: TAKEOVER_CLOSE_LABEL })
  assert.equal(takeoverAnswer(tr(BACK_LABEL)), null)
  assert.equal(takeoverAnswer(tr('随便说点什么')), null)
  assert.equal(takeoverAnswer(null), null)
  assert.deepEqual(takeoverAnswer(tr(TAKEOVER_LABEL + '，然后再说')), { why: 'malformed' })
  assert.deepEqual(takeoverAnswer(tr(TAKEOVER_LABEL, { followUp: true })), { why: 'follow-up' })
  assert.deepEqual(takeoverAnswer(tr(TAKEOVER_LABEL, { afkTimeoutMs: 1000 })), { why: 'afk' })
  assert.deepEqual(takeoverAnswer(tr(TAKEOVER_LABEL, { response: '我再想想' })), { why: 'response' })
  assert.deepEqual(takeoverAnswer(tr(TAKEOVER_LABEL, { annotations: { Q: { notes: '先别动' } } })), { why: 'notes' })
  assert.deepEqual(takeoverAnswer({ questions: [{ question: 'Q', multiSelect: true }], answers: { Q: TAKEOVER_LABEL } }), { why: 'multi' })
  assert.deepEqual(takeoverAnswer({ questions: [{ question: 'Q', multiSelect: false }], answers: { Q: [TAKEOVER_LABEL] } }), { why: 'array' })
  assert.deepEqual(takeoverAnswer({ questions: [], answers: { Q: TAKEOVER_LABEL } }), { why: 'unmatched' })
  assert.deepEqual(
    takeoverAnswer({
      questions: [
        { question: 'Q', multiSelect: false },
        { question: 'P', multiSelect: false },
      ],
      answers: { Q: TAKEOVER_LABEL, P: '别的' },
    }),
    { why: 'not-alone' },
  )
})

test('sessionNotice：三条命令各自的出路；交付了只差收口的另说；磁盘上的值带引号', () => {
  const base = { runId: 'r1', startedAt: '2026-11-05T10:00:00Z', wordsHead: '做一个记账应用', delivered: false, via: 'create' }
  assert.match(sessionNotice({ ...base, command: 'at' }), /^【会话】[\s\S]*归另一个会话[\s\S]*\/agent-team:at 第 1 节「别的会话的一趟」/)
  assert.match(sessionNotice({ ...base, command: 'at', delivered: true }), /只差收口/)
  assert.doesNotMatch(sessionNotice({ ...base, command: 'at' }), /只差收口/)
  assert.match(sessionNotice({ ...base, command: 'at-resume' }), /\/agent-team:at-resume 第 1 节「别的会话的一趟」/)
  assert.doesNotMatch(sessionNotice({ ...base, command: 'at-status' }), /问用户/)
  assert.match(sessionNotice({ ...base, command: 'at-status' }), /归另一个会话/)
  const n = sessionNotice({ ...base, command: 'at' })
  assert.match(n, /"r1"/)
  assert.match(n, /"做一个记账应用"/)
  assert.match(n, /"2026-11-05T10:00:00Z"/)
  assert.match(sessionNotice({ ...base, command: 'at', via: 'takeover' }), /接手/)
  // 原话开头、起的时间读不出来：照样说，只是不带那两样。
  const bare = sessionNotice({ ...base, command: 'at', startedAt: null, wordsHead: null })
  assert.match(bare, /归另一个会话/)
  assert.doesNotMatch(bare, /null/)
})

test('takeoverNotice：记下了说改归这个会话、原会话再写会被拒；没记下说为什么', () => {
  assert.match(takeoverNotice({ runId: 'r1', why: null }), /^【会话】[\s\S]*已记下[\s\S]*"r1"[\s\S]*改归这个会话/)
  for (const why of ['no-run', 'closed', 'already-mine', 'no-session', 'write-failed', 'multi', 'notes', 'follow-up']) {
    const t = takeoverNotice({ runId: 'r1', why })
    assert.match(t, /没有记成接手/, why)
    assert.doesNotMatch(t, /undefined/, why)
  }
})
