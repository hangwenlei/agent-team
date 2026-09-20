import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stageRoles, expandProduces, producedNames, expectedArtifacts } from '../hooks/lib/stages.mjs'

const S5 = { role: 'at-backend', producers: ['at-backend', 'at-frontend', 'at-ui'], produces: ['05-impl/<role>.md'] }
const S1 = { role: 'at-pm', produces: ['00-contract.md'] }
const STAGES = { S1, S5 }

test('stageRoles：有 producers 时返回 producers，不是 role', () => {
  assert.deepEqual(stageRoles(S5), ['at-backend', 'at-frontend', 'at-ui'])
})

test('stageRoles：没有 producers 时退回 [role]', () => {
  assert.deepEqual(stageRoles(S1), ['at-pm'])
})

test('stageRoles：形状不对时返回空数组，不抛', () => {
  assert.deepEqual(stageRoles(null), [])
})

test('expandProduces：<role> 按给定角色逐个展开', () => {
  assert.deepEqual(expandProduces(S5, ['at-frontend', 'at-ui']), ['05-impl/at-frontend.md', '05-impl/at-ui.md'])
})

test('expandProduces：不含 <role> 的条目原样保留一次，不随角色数量翻倍', () => {
  assert.deepEqual(expandProduces(S1, ['at-pm', 'at-product']), ['00-contract.md'])
})

test('expandProduces：角色集合为空时，带 <role> 的条目一个都不产出', () => {
  assert.deepEqual(expandProduces(S5, []), [])
})

test('producedNames：<role> 按全部 producers 展开——validateState 要接受任何合法产者的文件', () => {
  assert.deepEqual(
    [...producedNames(STAGES)].sort(),
    ['00-contract.md', '05-impl/at-backend.md', '05-impl/at-frontend.md', '05-impl/at-ui.md'],
  )
})

test('expectedArtifacts：<role> 只按 roster ∩ producers 展开', () => {
  assert.deepEqual(
    [...expectedArtifacts(STAGES, ['at-frontend'])].sort(),
    ['00-contract.md', '05-impl/at-frontend.md'],
  )
})

test('expectedArtifacts：roster 里的角色不是这一阶段的 producer 时不产出它的名字', () => {
  assert.deepEqual([...expectedArtifacts({ S5 }, ['at-product'])], [])
})

test('expectedArtifacts：不含 <role> 的条目不受 roster 影响——S1 的产物与谁被派了无关', () => {
  assert.deepEqual([...expectedArtifacts({ S1 }, [])], ['00-contract.md'])
})

test('expectedArtifacts：roster 缺省时退回全部 producers，与 producedNames 一致', () => {
  assert.deepEqual([...expectedArtifacts(STAGES, undefined)].sort(), [...producedNames(STAGES)].sort())
})

// Task 4 Step 2：带 producers 的阶段，若 produces 是**数组**，每一条都必须含 <role>。
// 否则 stageOwnerOfRunPath 会把一个静态产物名归给 producers[0]，归属就错了。
//
// M2b Task 2 改：这条不变量只对数组形式成立——object 分支的 expandProduces
// (hooks/lib/stages.mjs) 按 key 精确取该角色自己那几份，天然不会混淆归属，不需要
// 也不可能含 <role>（S2 就是纯字面量）。S2 加了 producers 之后，原来「for (const p of
// s.produces)」对它会直接抛 TypeError（对象不可 for-of）——这条测试自己也要跟着两种
// 形式的区分改，不是只改 stages.json 就够。这条钉的是仓库根真实 stages.json 本身的
// 形状，不是 stages.mjs 的行为。
test('不变量：带 producers 的阶段，若 produces 是数组，每一条都必须含 <role>', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const bad = []
  for (const [id, s] of Object.entries(stages)) {
    if (!Array.isArray(s.producers)) continue
    if (!Array.isArray(s.produces)) continue // 对象形式：按 key 隔离，不适用这条不变量
    for (const p of s.produces) if (!p.includes('<role>')) bad.push(`${id}:${p}`)
  }
  assert.deepEqual(bad, [])
})

// 正向自检锚：上一条在「stages.json 里没有任何带 producers 的数组形式阶段」时会零次
// 迭代、空转恒绿——这条证明真的有这样的阶段（S5——S2 虽然也带 producers，但是对象
// 形式，上面那条对它是显式 continue，不是没查到），上一条不是在空集合上通过。
test('前置条件：stages.json 里确实有带 producers 的阶段——上一条不是空转', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const withProducers = Object.keys(stages).filter((id) => Array.isArray(stages[id].producers))
  assert.deepEqual(withProducers, ['S2', 'S5'])
})

// M2b Task 2 补的对称不变量：带 producers 的阶段，若 produces 是**对象**，每个 key
// 都必须是这个阶段真实的 producer。否则 expandProduces 的对象分支会静默认领一个不在
// producers 里的名字——按角色取值时永远取不到（stageRoles 不会把它当成合法产出角色），
// 那份产物变成任何人都交不出、也永远不会被 H2/H5/账本比对认领到的孤儿 key。
test('不变量：带 producers 的阶段，若 produces 是对象，每个 key 都必须是这个阶段的 producer', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const bad = []
  for (const [id, s] of Object.entries(stages)) {
    if (!s.produces || Array.isArray(s.produces) || typeof s.produces !== 'object') continue
    const producers = new Set(Array.isArray(s.producers) ? s.producers : [])
    for (const key of Object.keys(s.produces)) if (!producers.has(key)) bad.push(`${id}:${key}`)
  }
  assert.deepEqual(bad, [])
})

// 正向自检锚：上一条在「stages.json 里没有任何对象形式 produces 的阶段」时会零次
// 迭代、空转恒绿——这条证明真的有这样的阶段（S2），上一条不是在空集合上通过。
test('前置条件：stages.json 里确实有对象形式 produces 的阶段——上一条不是空转', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const objectForm = Object.keys(stages).filter((id) => {
    const p = stages[id].produces
    return p !== null && typeof p === 'object' && !Array.isArray(p)
  })
  assert.deepEqual(objectForm, ['S2'])
})

// M2b Task 2：produces 的第二种形式——对象 `{role: [...]}`，各产者交各的（S2 的形状）。
// 与数组形式（<role> 模式，S5 的形状）不是取舍关系，是两种真实存在的阶段形状，
// expandProduces 必须都认得。
const S2_OBJ = {
  role: 'at-product',
  producers: ['at-product', 'at-ui'],
  produces: {
    'at-product': ['01-prd.md'],
    'at-ui': ['02-ui-spec.md', '02-wireframe.html'],
  },
}

test('对象形式：只给一个角色时，只返回它自己那几份', () => {
  assert.deepEqual(expandProduces(S2_OBJ, ['at-ui']), ['02-ui-spec.md', '02-wireframe.html'])
})

test('对象形式：at-product 不该被要求交 at-ui 的产物', () => {
  assert.deepEqual(expandProduces(S2_OBJ, ['at-product']), ['01-prd.md'])
})

test('对象形式：给多个角色时按给定顺序拼接', () => {
  assert.deepEqual(
    expandProduces(S2_OBJ, ['at-product', 'at-ui']),
    ['01-prd.md', '02-ui-spec.md', '02-wireframe.html'],
  )
})

test('对象形式：不在映射里的角色不产出任何东西', () => {
  assert.deepEqual(expandProduces(S2_OBJ, ['at-backend']), [])
})

test('对象形式：roles 为空数组时一个都不产出', () => {
  assert.deepEqual(expandProduces(S2_OBJ, []), [])
})

test('对象形式：映射的值不是数组时跳过它，不抛', () => {
  const bad = { producers: ['a'], produces: { a: 'not-an-array' } }
  assert.deepEqual(expandProduces(bad, ['a']), [])
})

// 这两条钉的是数组那一半：没有它们，只要对象分支写对了，整条函数的数组路径可以被
// 改坏而全绿（Global Constraints「教训 1」的落点）。
test('数组形式行为逐字不变：<role> 仍按角色展开', () => {
  const s5 = { producers: ['at-backend', 'at-frontend'], produces: ['05-impl/<role>.md'] }
  assert.deepEqual(
    expandProduces(s5, ['at-backend', 'at-frontend']),
    ['05-impl/at-backend.md', '05-impl/at-frontend.md'],
  )
})

test('数组形式行为逐字不变：不含 <role> 的条目仍原样保留一次', () => {
  const s1 = { role: 'at-pm', produces: ['00-contract.md'] }
  assert.deepEqual(expandProduces(s1, ['at-pm', 'at-product']), ['00-contract.md'])
})
