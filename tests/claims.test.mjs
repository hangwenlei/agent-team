// 并行微调——认领文件（hooks/lib/claims.mjs）：每一趟微调的子代理第一次写一个项目文件时记进这一趟的 claims.jsonl，别的没收尾的微调再写它门禁拒。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimLine, readClaims, claimBlock, claimDenyReason } from '../hooks/lib/claims.mjs'
import { CLAIMS_FILE, GATE_FILES } from '../hooks/lib/control-files.mjs'

test('认领记录是门禁专属文件', () => {
  assert.equal(CLAIMS_FILE, 'claims.jsonl')
  assert.ok(GATE_FILES.includes('runs/*/claims.jsonl'))
})

test('readClaims：认 claimLine 写的行，跳过坏行与缺 key 的行', () => {
  const text = [
    claimLine({ at: 't', key: 'c:/p/web/a.ts', path: 'web/a.ts', role: 'at-frontend' }),
    '{bad',
    JSON.stringify({ kind: 'claim', path: 'web/b.ts' }),
    claimLine({ at: 't', key: 'c:/p/web/c.ts', path: 'web/c.ts', role: 'at-frontend' }),
  ].join('\n')
  assert.deepEqual([...readClaims(text)].sort(), ['c:/p/web/a.ts', 'c:/p/web/c.ts'])
  assert.equal(readClaims(null).size, 0)
})

test('claimBlock：别的一趟认领了这个键回那一趟，没有回 null', () => {
  const others = [
    { id: 't1', keys: new Set(['k1']), startedAt: '2026-11-06T10:00:00Z', wordsHead: '标题改大' },
    { id: 't3', keys: new Set(['k3']), startedAt: null, wordsHead: null },
  ]
  assert.equal(claimBlock({ key: 'k3', others }).id, 't3')
  assert.equal(claimBlock({ key: 'k2', others }), null)
  assert.equal(claimBlock({ key: 'k1', others: [] }), null)
})

test('claimDenyReason：说清是哪一趟在改、叫它冒泡不绕开；磁盘上的值过引号', () => {
  const r = claimDenyReason({ path: 'web/a.ts', other: { id: 't1', startedAt: '2026-11-06T10:00:00Z', wordsHead: '标题改大' } })
  assert.match(r, /^agent-team 认领：/)
  assert.match(r, /"t1"/)
  assert.match(r, /"2026-11-06T10:00:00Z"/)
  assert.match(r, /"标题改大"/)
  assert.match(r, /web\/a\.ts/)
  assert.match(r, /冒泡：/)
  assert.match(r, /Bash/)
  assert.doesNotMatch(claimDenyReason({ path: 'x', other: { id: 't9', startedAt: null, wordsHead: null } }), /null|undefined/)
})
