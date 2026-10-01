// M3y（docs/33，全量审查第 15 条）：返工轮里「这份产物还是上一轮的」怎么判。
//
// 回退那一次写入里，state.json 的 rework_base 记下回退那一刻磁盘上各份产物的 sha（H6 对着磁盘核）。之后某份产物的磁盘内容
// 与它记的 sha 还相同，就是上一轮的——交没交、齐没齐的几个判据（H5a/H5b、【阶段】、H2）都不该把它算成这一轮交的。
// 值是 "accepted" 的，是 PM 声明这一轮接受它原样，不算旧。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeFreshness } from '../hooks/lib/freshness.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const OLD = 'old content\n'
const NEW = 'new content\n'
const disk = (files) => {
  const reads = []
  return {
    reads,
    artifactExists: (n) => Object.hasOwn(files, n),
    artifactBytes: (n) => {
      reads.push(n)
      return Object.hasOwn(files, n) ? Buffer.from(files[n], 'utf8') : null
    },
  }
}

test('M3y freshness：磁盘内容与 rework_base 记的 sha 相同 → 旧，不算这一轮的', () => {
  const d = disk({ '05-impl/at-backend.md': OLD })
  const f = makeFreshness({ ...d, reworkBase: { '05-impl/at-backend.md': sha256OfContract(Buffer.from(OLD)) } })
  assert.equal(f.isStale('05-impl/at-backend.md'), true)
  assert.equal(f.artifactCurrent('05-impl/at-backend.md'), false)
})

test('M3y freshness：重写过（sha 不同）→ 不旧，算这一轮的', () => {
  const d = disk({ '05-impl/at-backend.md': NEW })
  const f = makeFreshness({ ...d, reworkBase: { '05-impl/at-backend.md': sha256OfContract(Buffer.from(OLD)) } })
  assert.equal(f.isStale('05-impl/at-backend.md'), false)
  assert.equal(f.artifactCurrent('05-impl/at-backend.md'), true)
})

// sha 的口径与 artifacts 同一个（sha256OfContract 归一化 BOM 与 CRLF）：只改行尾不算重写。
test('M3y freshness：只把行尾改成 CRLF、加 BOM，仍是旧的', () => {
  const d = disk({ '05-impl/at-backend.md': String.fromCharCode(0xfeff) + OLD.replace(/\n/g, '\r\n') })
  const f = makeFreshness({ ...d, reworkBase: { '05-impl/at-backend.md': sha256OfContract(Buffer.from(OLD)) } })
  assert.equal(f.isStale('05-impl/at-backend.md'), true)
})

test('M3y freshness：值是 "accepted" → 不旧（PM 声明这一轮接受原样）', () => {
  const d = disk({ '05-impl/at-frontend.md': OLD })
  const f = makeFreshness({ ...d, reworkBase: { '05-impl/at-frontend.md': 'accepted' } })
  assert.equal(f.isStale('05-impl/at-frontend.md'), false)
  assert.equal(f.artifactCurrent('05-impl/at-frontend.md'), true)
})

test('M3y freshness：rework_base 里没有这一条 → 只看在不在，而且一个字节都不读', () => {
  const d = disk({ '01-prd.md': OLD })
  const f = makeFreshness({ ...d, reworkBase: { '05-impl/at-backend.md': sha256OfContract(Buffer.from(OLD)) } })
  assert.equal(f.artifactCurrent('01-prd.md'), true)
  assert.equal(f.artifactCurrent('02-ui-spec.md'), false)
  assert.deepEqual(d.reads, [], '首轮与快照外的产物不该多读文件')
})

test('M3y freshness：rework_base 缺失、null、数组、标量都当没有快照——行为与 v1.6.0 相同', () => {
  for (const reworkBase of [undefined, null, [], 'x', 3]) {
    const d = disk({ '05-impl/at-backend.md': OLD })
    const f = makeFreshness({ ...d, reworkBase })
    assert.equal(f.artifactCurrent('05-impl/at-backend.md'), true, JSON.stringify(reworkBase))
    assert.equal(f.isStale('05-impl/at-backend.md'), false)
  }
})

// 读不出来（artifactBytes 给 null、或算 sha 抛异常）一律算不旧：与 H2、H5 的 fail open 一致，不能拿 sha256OfContract(null)
// 去比——那是字符串 "null" 的哈希，形状合法。
test('M3y freshness：在、但读不出来 → 不旧（fail open）', () => {
  const f = makeFreshness({
    artifactExists: () => true,
    artifactBytes: () => null,
    reworkBase: { '05-impl/at-backend.md': sha256OfContract(null) },
  })
  assert.equal(f.isStale('05-impl/at-backend.md'), false)
  assert.equal(f.artifactCurrent('05-impl/at-backend.md'), true)
})

test('M3y freshness：读字节抛异常 → 不旧，不抛', () => {
  const f = makeFreshness({
    artifactExists: () => true,
    artifactBytes: () => { throw new Error('EBUSY') },
    reworkBase: { '05-impl/at-backend.md': sha256OfContract(Buffer.from(OLD)) },
  })
  assert.equal(f.isStale('05-impl/at-backend.md'), false)
})

test('M3y freshness：记的值不是合法 sha、不在磁盘上、键是继承来的——都不旧', () => {
  const d = disk({ '05-impl/at-backend.md': OLD })
  assert.equal(makeFreshness({ ...d, reworkBase: { '05-impl/at-backend.md': 'sha256:xyz' } }).isStale('05-impl/at-backend.md'), false)
  assert.equal(makeFreshness({ ...d, reworkBase: { '06-test.md': sha256OfContract(Buffer.from(OLD)) } }).isStale('06-test.md'), false)
  assert.equal(makeFreshness({ ...d, reworkBase: Object.create({ '05-impl/at-backend.md': sha256OfContract(Buffer.from(OLD)) }) }).isStale('05-impl/at-backend.md'), false)
  assert.equal(makeFreshness({ ...d, reworkBase: {} }).isStale({ toString: 1 }), false)
})
