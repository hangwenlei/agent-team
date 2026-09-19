import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareArtifacts } from '../hooks/lib/artifact-drift.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] },
}
// Task 4：S5 多产者夹具，自建一份、不读真 stages.json（跟 tests/writepath.test.mjs
// 的 STAGES_M2A 同一个理由：单测要能独立于真实配置）。
const STAGES_M2A = {
  S5: {
    role: 'at-backend',
    producers: ['at-backend', 'at-frontend'],
    requires: [],
    produces: ['05-impl/<role>.md'],
  },
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

// 修复轮 1（评审缺陷 1）：原来一个 test() 里塞两条断言，钉的是不同侧面
// （r.drifted 与 r.missing）——前一条失败会让后一条"从未被执行到"这件事
// 完全不可见，违反 docs/11 §3.3 第 1 条。按字段拆开，每条测试名字各自说清
// 自己钉的是哪个字段；两条测试共用同一份 compareArtifacts 调用形状，不算
// 违反"同一断言形状遍历互不耦合的数据点可以共块"那条例外——这里两条测的是
// 同一个场景的两个不同字段，不是同一断言形状的不同数据点，不适用那条例外。
test('记录了但磁盘上内容变了 → drifted 里有这条记录，两个哈希都带出来', () => {
  const r = compareArtifacts({
    artifacts: { '00-contract.md': A }, stages: STAGES, artifactBytes: bytesOf({ '00-contract.md': '乙\n' }),
  })
  assert.deepEqual(r.drifted, [{ name: '00-contract.md', recorded: A, actual: B }])
})

test('记录了但磁盘上内容变了 → missing 仍为空（drifted 与 missing 互斥）', () => {
  const r = compareArtifacts({
    artifacts: { '00-contract.md': A }, stages: STAGES, artifactBytes: bytesOf({ '00-contract.md': '乙\n' }),
  })
  assert.deepEqual(r.missing, [])
})

test('记录了但磁盘上没有 → missing 里有这条记录', () => {
  const r = compareArtifacts({ artifacts: { '00-contract.md': A }, stages: STAGES, artifactBytes: bytesOf({}) })
  assert.deepEqual(r.missing, [{ name: '00-contract.md', recorded: A }])
})

test('记录了但磁盘上没有 → drifted 仍为空（missing 与 drifted 互斥）', () => {
  const r = compareArtifacts({ artifacts: { '00-contract.md': A }, stages: STAGES, artifactBytes: bytesOf({}) })
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

// 修复轮 1（评审缺陷 2）：11 处 assert.doesNotThrow 原来都没有失败消息，炸的时候
// 只能看到 Node 默认的 AssertionError，要人工二分才知道是哪个退化值作用在哪个
// 参数上炸的。这里符合 docs/11 §3.3 的例外（同一断言形状遍历互不耦合的数据点可以
// 共块），不拆成 11 个 test()，但每次调用都补上点名"当前 bad 值 + 目标字段"的
// message。JSON.stringify(bad) 而不是模板字符串直接插值 bad：null 与 undefined
// 直接插值都会隐式转成看得懂的文字，但 JSON.stringify(null) 是字符串 'null'、
// JSON.stringify(undefined) 是值 undefined（模板字符串里再转成文字 'undefined'），
// 两者最终文本不同，不会长得一样；'x' 经 JSON.stringify 带引号（"x"），与裸数字
// 3、空数组 [] 也不会混淆。
test('退化输入一律不抛', () => {
  for (const bad of [null, undefined, [], 'x', 3]) {
    assert.doesNotThrow(
      () => compareArtifacts({ artifacts: bad, stages: STAGES, artifactBytes: bytesOf({}) }),
      `artifacts 传 ${JSON.stringify(bad)} 时不应抛`,
    )
    assert.doesNotThrow(
      () => compareArtifacts({ artifacts: {}, stages: bad, artifactBytes: bytesOf({}) }),
      `stages 传 ${JSON.stringify(bad)} 时不应抛`,
    )
  }
  assert.doesNotThrow(
    () => compareArtifacts({ artifacts: {}, stages: STAGES, artifactBytes: null }),
    'artifactBytes 传 null 时不应抛',
  )
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

// Task 4 Step 7（brief 逐字）：compareArtifacts 现在按 expectedArtifacts（roster ∩
// producers）而不是 producedNames（全部 producers）展开 <role>。roster 里没有的
// 角色，它的实现记录不该被算进"这一趟该有的"集合，磁盘上没有也不该报 missing。
test('S5 多产者：roster 里没有的角色，它的实现记录不会被报成 missing', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES_M2A, roster: ['at-backend'],
    artifactBytes: bytesOf({}),
  })
  assert.deepEqual(r.missing, [])
})

test('S5 多产者：roster 里有的角色，它的实现记录记了而磁盘没有时报 missing', () => {
  const r = compareArtifacts({
    artifacts: { '05-impl/at-frontend.md': A }, stages: STAGES_M2A, roster: ['at-frontend'],
    artifactBytes: bytesOf({}),
  })
  assert.deepEqual(r.missing, [{ name: '05-impl/at-frontend.md', recorded: A }])
})

// ⚠️ 上面第一条（brief 逐字）名字承诺的是"roster 过滤生效，所以不报 missing"，但
// 它用的夹具（artifacts: {}，磁盘也是空的）让这条断言在**任何** produced 集合下都
// 成立：compareArtifacts 只有 Object.hasOwn(recorded, name) 为真时才会把一个名字
// 送进 missing，而 recorded 是 {}，对任何 name 这个判定恒为 false——missing 恒是
// []，跟 roster 过滤到底生没生效没有关系。实测验证：把 compareArtifacts 内部改回
// producedNames(stages)（brief Step 10 变异表第 2 项要求的那个变异）之后手工重算，
// 这一条**不会**变红（下面两条会）。这正是 docs/11 §3.3 第 2 条点名的那种否定断言
// ——必须配一条自检才能证明判据真的在工作，不是恒沉默。下面两条是那个自检：用同一份
// 磁盘内容（at-frontend 的文件真的存在），roster 排除它时不进 unrecorded、roster
// 不排除它时确实会进 unrecorded——两条对照，"排除"这件事才有可观测的证据。
test('roster 里没有的角色，它的文件即使在磁盘上也不进 unrecorded——证明它真的被排除在"该有"集合之外，不是上一条 missing 恰好没触发', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES_M2A, roster: ['at-backend'],
    artifactBytes: bytesOf({ '05-impl/at-frontend.md': '甲\n' }),
  })
  assert.deepEqual(r.unrecorded, [])
})

test('正向自检锚：同样的磁盘内容，roster 缺省（退回全部 producers）时 at-frontend 真的会被报进 unrecorded——证明上一条的判据不是恒沉默', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES_M2A,
    artifactBytes: bytesOf({ '05-impl/at-frontend.md': '甲\n' }),
  })
  assert.deepEqual(r.unrecorded, ['05-impl/at-frontend.md'])
})
