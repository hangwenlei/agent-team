import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeReach } from '../hooks/lib/reach.mjs'

const ROSTER = {
  'at-pm': { can_delegate_to: ['at-product', 'at-architect'] },
  'at-product': { can_delegate_to: ['at-backend'] },
  'at-architect': { can_delegate_to: ['at-backend', 'at-frontend'] },
  'at-backend': { can_delegate_to: [] },
  'at-frontend': { can_delegate_to: [] },
}
const PATHS = {
  'at-product': ['docs/'],
  'at-backend': ['src/server/', 'src/shared/'],
  'at-frontend': ['src/web/', 'src/shared/'],
}

test('叶子角色的触达等于自己认领的路径，不被标记为放大', () => {
  const r = computeReach({ roster: ROSTER, paths: PATHS })
  assert.deepEqual(r['at-backend'].reach.sort(), ['src/server/', 'src/shared/'])
  assert.equal(r['at-backend'].widened, false)
  assert.deepEqual(r['at-backend'].widenedBy, {})
})

// docs/04 §9 ① 的实测就是这一条：at-product 被 H3 拒绝写 src/web/x.ts 之后，
// 当场把同一个写入派发给路径的合法拥有者。挡住它的是 H1 花名册里没有这条边，
// 不是 H3。这条用例把那次实测固化成算法层面的断言。
test('at-product 经 at-backend 拿到 src/server/——这正是 docs/04 §9 ① 记的耦合', () => {
  const r = computeReach({ roster: ROSTER, paths: PATHS })
  assert.equal(r['at-product'].widened, true)
  assert.ok(r['at-product'].reach.includes('src/server/'))
  assert.equal(r['at-product'].widenedBy['src/server/'], 'at-product → at-backend')
})

test('at-product 触达不到 src/web/——它派不到 at-frontend', () => {
  const r = computeReach({ roster: ROSTER, paths: PATHS })
  assert.equal(r['at-product'].reach.includes('src/web/'), false)
})

test('at-pm 经两跳拿到全部路径，widenedBy 记的是最短那条链', () => {
  const r = computeReach({ roster: ROSTER, paths: PATHS })
  assert.equal(r['at-pm'].reach.length, 4)
  assert.equal(r['at-pm'].widenedBy['src/web/'], 'at-pm → at-architect → at-frontend')
})

// Step 5 变异验证补测：把 queue.shift() 改成 queue.pop()（BFS 改 DFS）之后，
// 上面那条「记的是最短那条链」在 ROSTER/PATHS 这套夹具上其实不会变红——到
// at-backend 的两条链（经 at-product、经 at-architect）长度相等（都是两跳），
// DFS 换一条不同但同样短的路线，reach.length 与 widenedBy['src/web/'] 都不受
// 影响，唯一被换掉的 widenedBy['src/shared/'] 没有任何断言盯着它。这条用一个
// 长度真正不对称的图钉住这件事：t/ 经 x → a → t 两跳可达，也经 x → b → d → t
// 三跳可达。BFS 保证记的是两跳那条；DFS 会先把 b 那支探到底，抢先把三跳那条
// 记进去。
test('widenedBy 记的确实是最短跳数那条链，不是任意一条更短的候选', () => {
  const r = computeReach({
    roster: {
      x: { can_delegate_to: ['a', 'b'] },
      a: { can_delegate_to: ['t'] },
      b: { can_delegate_to: ['d'] },
      d: { can_delegate_to: ['t'] },
      t: { can_delegate_to: [] },
    },
    paths: { t: ['t/'] },
  })
  assert.equal(r.x.widenedBy['t/'], 'x → a → t')
})

test('自己已经认领的前缀不算「被放大」，哪怕别人也认领了它', () => {
  // src/shared/ 同时归 at-backend 与 at-frontend。对 at-backend 来说它是 own，
  // 不该出现在 widenedBy 里——否则 /at-status 会把共享目录报成一次扩大。
  const r = computeReach({ roster: ROSTER, paths: PATHS })
  assert.equal('src/shared/' in r['at-backend'].widenedBy, false)
})

// Step 5 变异验证补测：上面那条测的是 at-backend——一个叶子角色
// （can_delegate_to: []）。叶子角色的 BFS 循环体根本不会执行，widenedBy
// 从头到尾都是 {}，跟 `if (reach.has(prefix)) continue` 这个判断毫无关系：
// 删掉那个判断，上面那条照样绿。这条换一个真正会派发的角色：p 自己认领
// shared/，也能派给同样认领 shared/ 的 q。shared/ 不该出现在 p 的
// widenedBy 里（它是 p 自己的东西，不是经 q 才拿到的）；q-only/ 才是真正
// 经派发拿到的，应该出现。
test('会派发的角色也一样：自己认领的前缀不因为被派对象也认领而计入 widenedBy', () => {
  const r = computeReach({
    roster: { p: { can_delegate_to: ['q'] }, q: { can_delegate_to: [] } },
    paths: { p: ['shared/'], q: ['shared/', 'q-only/'] },
  })
  assert.deepEqual(r.p.reach.sort(), ['q-only/', 'shared/'])
  assert.equal(r.p.widenedBy['q-only/'], 'p → q')
  assert.equal('shared/' in r.p.widenedBy, false)
})

// ——— 退化输入：约束 2 点名的环，加上自引用与坏形状 ———

test('环（A → B → A）不死循环，两边互相拿到对方的路径', () => {
  const r = computeReach({
    roster: { a: { can_delegate_to: ['b'] }, b: { can_delegate_to: ['a'] } },
    paths: { a: ['pa/'], b: ['pb/'] },
  })
  assert.deepEqual(r.a.reach.sort(), ['pa/', 'pb/'])
  assert.deepEqual(r.b.reach.sort(), ['pa/', 'pb/'])
  assert.equal(r.a.widenedBy['pb/'], 'a → b')
})

test('自引用（A → A）不把自己算成扩大自己', () => {
  const r = computeReach({
    roster: { a: { can_delegate_to: ['a'] } },
    paths: { a: ['pa/'] },
  })
  assert.deepEqual(r.a.reachableRoles, [])
  assert.deepEqual(r.a.reach, ['pa/'])
  assert.equal(r.a.widened, false)
})

test('三角环也终止，且每个角色都拿到闭包里全部路径', () => {
  const r = computeReach({
    roster: {
      a: { can_delegate_to: ['b'] },
      b: { can_delegate_to: ['c'] },
      c: { can_delegate_to: ['a'] },
    },
    paths: { a: ['pa/'], b: ['pb/'], c: ['pc/'] },
  })
  for (const k of ['a', 'b', 'c']) assert.equal(r[k].reach.length, 3)
})

test('派到花名册里不存在的角色：不抛，那一跳带不来任何路径', () => {
  const r = computeReach({
    roster: { a: { can_delegate_to: ['ghost'] } },
    paths: { a: ['pa/'] },
  })
  assert.deepEqual(r.a.reachableRoles, ['ghost'])
  assert.deepEqual(r.a.reach, ['pa/'])
})

test('paths 里没有条目的角色，own 是空数组不是 undefined', () => {
  const r = computeReach({ roster: ROSTER, paths: {} })
  assert.deepEqual(r['at-pm'].own, [])
  assert.deepEqual(r['at-pm'].reach, [])
})

test('坏形状一律不抛：roster / paths / can_delegate_to / paths 值', () => {
  assert.deepEqual(computeReach({ roster: null, paths: PATHS }), {})
  assert.deepEqual(computeReach({ roster: [], paths: PATHS }), {})
  assert.deepEqual(computeReach({ roster: 'x', paths: PATHS }), {})
  const r1 = computeReach({ roster: { a: { can_delegate_to: 'b' } }, paths: { a: ['pa/'] } })
  assert.deepEqual(r1.a.reachableRoles, [])
  const r2 = computeReach({ roster: { a: { can_delegate_to: ['b'] }, b: null }, paths: { a: ['pa/'] } })
  assert.deepEqual(r2.a.reach, ['pa/'])
  const r3 = computeReach({ roster: ROSTER, paths: { 'at-backend': 'src/server/' } })
  assert.deepEqual(r3['at-backend'].own, [])
  assert.deepEqual(computeReach({ roster: ROSTER, paths: null })['at-pm'].reach, [])
})

// ——— 账二「变更时必须被确认」的那一半 ———
//
// 上面所有用例都在夹具上跑，它们对 roster.json 改了一条边不会有任何反应。
// 这条不一样：它把**仓库里真实花名册的派发边拓扑**整体钉死。
// 钉的是拓扑（插件自己的文件），不是某个项目的 paths——docs/09 账二约束 3 禁止的是
// 后者。而放大触达的恰恰是拓扑，paths 只是往里填内容。
// 形状与用意都照 tests/roster-closure.test.mjs 的先例。
test('花名册的派发边拓扑没有变——变了就必须回来确认触达是否被放大', () => {
  const roster = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
  const edges = Object.fromEntries(
    Object.entries(roster).map(([k, v]) => [k, [...(v.can_delegate_to ?? [])].sort()]),
  )
  assert.deepEqual(
    edges,
    {
      __main__: ['at-architect', 'at-product'],
      'at-pm': ['at-architect', 'at-product'],
      'at-product': ['at-backend'],
      'at-architect': ['at-backend', 'at-frontend'],
      'at-backend': [],
      'at-frontend': [],
      'at-outsider': [],
    },
    'roster.json 的派发边变了。这不是让你改这条断言了事：一条 can_delegate_to 的变动' +
      '会改变各角色的**实际写入触达**（规格 §6.4 / docs/09 账二）——先用 computeReach ' +
      '算一遍新旧两版，确认哪个角色的触达被放大、放大到谁的地盘，确认这是有意的之后再' +
      '更新这里。顺带：H4 契约保护的 at-pm 豁免也依赖这份拓扑，见 tests/roster-closure.test.mjs。',
  )
})
