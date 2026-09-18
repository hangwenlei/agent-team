import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareArtifacts } from '../hooks/lib/artifact-drift.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] },
}
const A = sha256OfContract('甲\n')
const B = sha256OfContract('乙\n')
const bytesOf = (m) => (rel) => (m[rel] === undefined ? null : Buffer.from(m[rel], 'utf8'))

test('记录与磁盘一致时三个清单都空', () => {
  const r = compareArtifacts({
    artifacts: { '00-contract.md': A }, stages: STAGES, artifactBytes: bytesOf({ '00-contract.md': '甲\n' }),
  })
  assert.deepEqual(r, { drifted: [], missing: [], unrecorded: [] })
})

test('记录了但磁盘上内容变了 → drifted，两个哈希都带出来', () => {
  const r = compareArtifacts({
    artifacts: { '00-contract.md': A }, stages: STAGES, artifactBytes: bytesOf({ '00-contract.md': '乙\n' }),
  })
  assert.deepEqual(r.drifted, [{ name: '00-contract.md', recorded: A, actual: B }])
  assert.deepEqual(r.missing, [])
})

test('记录了但磁盘上没有 → missing', () => {
  const r = compareArtifacts({ artifacts: { '00-contract.md': A }, stages: STAGES, artifactBytes: bytesOf({}) })
  assert.deepEqual(r.missing, [{ name: '00-contract.md', recorded: A }])
  assert.deepEqual(r.drifted, [])
})

// 这一条是 Bash 绕过 H3 的直接表征：文件出现在磁盘上，但账本里没有它。
test('磁盘上有、artifacts 里没记 → unrecorded（Bash 绕过 H3 的表征）', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES, artifactBytes: bytesOf({ '01-prd.md': '甲\n' }),
  })
  assert.deepEqual(r.unrecorded, ['01-prd.md'])
})

test('只看 stages 的 produces，不管 run 目录下别的文件', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES, artifactBytes: bytesOf({ '随便什么.md': '甲\n' }),
  })
  assert.deepEqual(r.unrecorded, [])
})

test('退化输入一律不抛', () => {
  for (const bad of [null, undefined, [], 'x', 3]) {
    assert.doesNotThrow(() => compareArtifacts({ artifacts: bad, stages: STAGES, artifactBytes: bytesOf({}) }))
    assert.doesNotThrow(() => compareArtifacts({ artifacts: {}, stages: bad, artifactBytes: bytesOf({}) }))
  }
  assert.doesNotThrow(() => compareArtifacts({ artifacts: {}, stages: STAGES, artifactBytes: null }))
})

// Task 4 简报变异表第 3 项点名要求的回归：把 compareArtifacts 内部的 sha256OfContract
// 换成对裸字节直接 createHash('sha256')，必须有测试能抓住——这就是那一条。
// CRLF 与语义相同的 LF 内容归一化后应该算出同一个哈希（sha256OfContract 自己的
// 归一化行为已经在 tests/contract-hash.test.mjs 单测过），这里单测的是
// compareArtifacts **真的调用了**那个函数，不是自己重新拼了一份哈希逻辑。
// 上面用的夹具内容（'甲\n'/'乙\n'）都不含 \r\n，归一化在那些输入上是空操作，naive
// 的裸字节哈希会算出跟 sha256OfContract 完全相同的结果——不会被上面任何一条测试
// 揭穿。必须用真的带 CRLF 的磁盘内容才能让两种实现分叉，这正是简报头部⚠️那条警告
// 描述的场景：Windows 上 core.autocrlf 检出的文件会在这里产生假漂移。
test('CRLF 与语义相同的 LF 内容不产生假漂移——账本比对必须复用 sha256OfContract 的归一化', () => {
  const lf = '甲\n乙\n'
  const crlf = '甲\r\n乙\r\n'
  const r = compareArtifacts({
    artifacts: { '00-contract.md': sha256OfContract(lf) },
    stages: STAGES,
    artifactBytes: bytesOf({ '00-contract.md': crlf }),
  })
  assert.deepEqual(r.drifted, [])
})
