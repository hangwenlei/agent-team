// H6 返工预算写时强制（纯函数部分）。规格 §4.2 ③、M2a 设计 §1.2、
// hooks/lib/rework-guard.mjs 头部——完整背景不在这里重复。
//
// decideRework 只认 before/after 两份 state.json 的**内容**（已经 JSON.parse 过的
// 对象），不碰磁盘、不知道 Edit/Write 的区别——那部分传导链在
// tests/gate-rework.test.mjs 里单独测（子进程级，Edit 的 old_string/new_string
// 替换只有那边能测到）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRework } from '../hooks/lib/rework-guard.mjs'

const H = (...stages) => stages.map((s) => ({ stage: s, at: '2026-09-19T00:00:00Z' }))
const st = (history, rework) => ({ stage: 'S5', history, rework })

test('正常推进：history 追加一条，放行', () => {
  const r = decideRework({ before: st(H('S1', 'S2'), {}), after: st(H('S1', 'S2', 'S3'), {}) })
  assert.equal(r.ok, true)
})

test('正常返工：history 追加重复阶段、rework 跟着涨，放行', () => {
  const r = decideRework({ before: st(H('S1', 'S5'), {}), after: st(H('S1', 'S5', 'S5'), { S5: 1 }) })
  assert.equal(r.ok, true)
})

test('history 整体变短：拒', () => {
  const r = decideRework({ before: st(H('S1', 'S2', 'S3'), {}), after: st(H('S1', 'S2'), {}) })
  assert.equal(r.ok, false)
})

test('history 长度没变但某阶段出现次数变少：拒', () => {
  const r = decideRework({ before: st(H('S1', 'S5', 'S5'), { S5: 1 }), after: st(H('S1', 'S5', 'S2'), {}) })
  assert.equal(r.ok, false)
})

test('rework 低于 history 派生值：拒', () => {
  const r = decideRework({ before: st(H('S1', 'S5', 'S5'), { S5: 1 }), after: st(H('S1', 'S5', 'S5'), { S5: 0 }) })
  assert.equal(r.ok, false)
})

test('rework 超过硬上限 3：拒', () => {
  const h = H('S5', 'S5', 'S5', 'S5', 'S5')
  const r = decideRework({ before: st(H('S5'), {}), after: st(h, { S5: 4 }) })
  assert.equal(r.ok, false)
})

test('旧 state 不存在（本趟第一次写）：放行', () => {
  const r = decideRework({ before: null, after: st(H('S1'), {}) })
  assert.equal(r.ok, true)
})

test('新内容不是合法 JSON 对象：放行，不拒——拒了会让人连修回去都做不到', () => {
  const r = decideRework({ before: st(H('S1'), {}), after: null })
  assert.equal(r.ok, true)
})

test('拒的时候要说清是哪一条判据、哪个阶段', () => {
  const r = decideRework({ before: st(H('S1', 'S5', 'S5'), { S5: 1 }), after: st(H('S1', 'S5', 'S5'), { S5: 0 }) })
  assert.match(r.reason, /S5/)
})

// Step 10 变异验证实测发现的缺口（不在 brief 的四条变异预言里，是跑变异 2 时才现出来
// 的）：只要 history 的元素都是合法的 { stage, at } 形状，"整体变短"与"某阶段计数变少"
// 这两条判据永远同时触发——总条数下降，按抽屉原理必有至少一个阶段的计数跟着下降，
// 不可能只掉前者不掉后者。于是上面「history 整体变短：拒」那条测试测不出「整体变短」
// 判据本身有没有被短路掉：就算把它删掉，"计数变少"那条判据照样把同一个夹具判成拒绝。
// 这条补的是"整体变短"判据唯一有独立价值的场景——history 里混进了不是 { stage, at }
// 形状的脏记录（counts() 按设计不数它，但 .length 数），删掉这一条脏记录会让总条数下降、
// 但每个"数得到"的阶段计数原封不动。
test('history 混进一条不是 {stage,at} 形状的脏记录，删掉它——每个真实阶段的计数都没变，仍然拒', () => {
  const before = { stage: 'S5', history: [{ stage: 'S1', at: 'x' }, 'not-a-real-entry', { stage: 'S5', at: 'x' }], rework: {} }
  const after = { stage: 'S5', history: [{ stage: 'S1', at: 'x' }, { stage: 'S5', at: 'x' }], rework: {} }
  const r = decideRework({ before, after })
  assert.equal(r.ok, false)
})

// 修复轮 1 Major 1（评审实测抓到的真实绕过，不是假设）：判据③原来用 `<` 直接比较
// `rw[stage]`，判据④原来用 `typeof v === 'number'` 当前置条件。`<`/`>` 在两边类型不同
// 时会做隐式数值转换（`'4' < 4` 按数值比较，为 false，逃过判据③），而
// `typeof v === 'number'` 对字符串/数组一律为 false、直接跳过判据④——两个洞合起来，
// 从一个合法的打满状态（history 里 S5 出现 4 次、rework.S5 = 3，已经在硬上限）出发，
// 把 rework.S5 写成字符串或数组就能让第 4 轮返工也被放行，H6 存在的全部理由（"第 3 轮
// 终局是硬上限，告警守不住"）落空。下面三条各自独立重放评审给出的实测用例，第四条是
// 正向锚——防止修复本身被錯改成"rework 一律拒"这种同样会让上面三条变绿、但把整条链
// 锁死的塌法。
test('rework 写成数字字符串 "4"、且 history 追加到第 5 次出现（真实落地第 4 轮返工）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5', 'S5'), { S5: '4' }),
  })
  assert.equal(r.ok, false)
})

test('rework 写成单元素数组 [4]（history 不变，仍是打满状态）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5'), { S5: [4] }),
  })
  assert.equal(r.ok, false)
})

test('rework 写成数字字符串 "99"（history 不变，仍是打满状态）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5'), { S5: '99' }),
  })
  assert.equal(r.ok, false)
})

// 正向锚：合法的数字 3（等于硬上限、也等于 history 的派生值）在打满状态下必须放行——
// 上面三条的修法如果被错改成"rework 字段只要不是纯数字类型就一律拒"，这条会变红，
// 说明改坏了不是收紧、是锁死。
test('rework 是合法数字 3、且没有变化：放行——修法不能连合法的整数都一起拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
  })
  assert.equal(r.ok, true)
})
