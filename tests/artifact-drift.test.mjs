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
// ⚠️ M3a Task 3：上面这句**只对 drifted / missing 成立了**——unrecorded 已经改回
// producedNames（roster 无关），理由见下面那一节与 hooks/lib/artifact-drift.mjs。
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
// []，跟 roster 过滤到底生没生效没有关系。这正是 docs/11 §3.3 第 2 条点名的那种
// 否定断言——必须配一条自检才能证明判据真的在工作，不是恒沉默。
//
// ⚠️ **M3a Task 3 改了它的自检是哪一条。** 这里原来的自检是下面那对 unrecorded
// 对照（roster 排除它时不进 unrecorded / roster 不排除时进）——那一对现在**失效了**，
// 因为 unrecorded 已经不看 roster（见下面那一节）。同一个"roster 收窄生没生效"的
// 问题，现在只能钉在 drifted / missing 这一侧，所以自检换成紧接着下面那条
// **非空洞版的 missing 收窄**（账本里真的记着那个名字，Object.hasOwn 为真，missing
// 因此不再恒空），它和上面那条 brief 逐字的第二条（roster 含 at-frontend 时报 missing）
// 正反对照。

// ---- M3a Task 3 Step 6：反向判据——drifted / missing 的 roster 口径**没变** ----
//
// 这一组与下一组是一对：同一批夹具，改 roster，**drifted / missing 跟着变、
// unrecorded 不变**。两组都在，"哪个清单看 roster"才有可观测的证据。
//
// 这一条是上面那条 brief 逐字 missing 收窄的非空洞版：账本里**真的记着**
// 05-impl/at-frontend.md，Object.hasOwn 为真，missing 不再恒空——它为空只可能是因为
// 这个名字没进 expectedArtifacts（roster 收窄真的生效了）。正向自检锚是上面那条
// "roster 里有的角色……时报 missing"：同一份账本、同一块空磁盘，只换 roster。
test('roster 收窄仍然管着 missing：账本里记着 at-frontend 的产物，但这一趟没派它——不报 missing', () => {
  const r = compareArtifacts({
    artifacts: { '05-impl/at-frontend.md': A }, stages: STAGES_M2A, roster: ['at-backend'],
    artifactBytes: bytesOf({}),
  })
  assert.deepEqual(r.missing, [])
})

// drifted 那一侧同样要钉——missing 与 drifted 是循环里两个不同的分支，钉住一个
// 不代表另一个也在按 roster 收窄（docs/16 §3.2：锚要钉在判据真正迭代的那一层）。
test('roster 收窄仍然管着 drifted：账本记的哈希与磁盘对不上，但这一趟没派 at-frontend——不报 drifted', () => {
  const r = compareArtifacts({
    artifacts: { '05-impl/at-frontend.md': A }, stages: STAGES_M2A, roster: ['at-backend'],
    artifactBytes: bytesOf({ '05-impl/at-frontend.md': '乙\n' }),
  })
  assert.deepEqual(r.drifted, [])
})

test('正向自检锚：同一份账本与磁盘，roster 换成含 at-frontend 时 drifted 真的会报——证明上一条不是恒沉默', () => {
  const r = compareArtifacts({
    artifacts: { '05-impl/at-frontend.md': A }, stages: STAGES_M2A, roster: ['at-frontend'],
    artifactBytes: bytesOf({ '05-impl/at-frontend.md': '乙\n' }),
  })
  assert.deepEqual(r.drifted, [{ name: '05-impl/at-frontend.md', recorded: A, actual: B }])
})

// ---- M3a Task 3 Step 5：这一条的期望值被这次改动翻过来了 ----
//
// ⚠️ **口径变了。** 这条原来断言的是 unrecorded 为空，名字里写着"证明它真的被排除在
// '该有'集合之外"——那是**旧口径**：unrecorded 当时和 drifted / missing 共用
// expectedArtifacts(stages, roster) 这一个宇宙。
//
// M3a Task 3 把 unrecorded 换成 producedNames(stages)（roster 无关），理由是
// hooks/lib/artifact-drift.mjs 头部对它的定义："磁盘上有、账本里没有——**Bash 绕过
// H3 的直接表征**"。一个按 roster 收窄的 unrecorded 看不见一个还没进 roster 的角色
// 写出来的任何东西，而 roster 在设计上滞后于派发——判据与它自己声明的用途矛盾
// （设计 §3.3）。**所以这条现在必须看见 at-frontend 的文件。**
//
// 这条与下面那条（roster 缺省）、以及再下面形状 B 那条（roster 是 []）是同一件事的
// 三个 roster 取值：**磁盘内容一样、账本一样，只换 roster，unrecorded 三次相同**。
// 这就是 Step 6 要的另一半——unrecorded 不跟着 roster 变。
test('roster 里没有的角色，它写在磁盘上的文件照样进 unrecorded——unrecorded 不按 roster 收窄', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES_M2A, roster: ['at-backend'],
    artifactBytes: bytesOf({ '05-impl/at-frontend.md': '甲\n' }),
  })
  assert.deepEqual(r.unrecorded, ['05-impl/at-frontend.md'])
})

test('同样的磁盘内容与账本，roster 缺省（退回全部 producers）时 unrecorded 一模一样——换 roster 不改变这个清单', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES_M2A,
    artifactBytes: bytesOf({ '05-impl/at-frontend.md': '甲\n' }),
  })
  assert.deepEqual(r.unrecorded, ['05-impl/at-frontend.md'])
})

// ---- M3a Task 3：unrecorded 脱离 roster 收窄（设计 §1 形状 B、§3.3）----
//
// hooks/lib/artifact-drift.mjs 的头部注释写着 unrecorded 是「Bash 绕过 H3 的直接表征」。
// 按 roster 收窄的 unrecorded 看不见一个还没进 roster 的角色写出来的任何东西——判据与
// 它自己声明的用途矛盾。下面这条钉的就是那个矛盾。
//
// 夹具是 docs/15 记的那一趟真实形状（docs/11 §5.16 的「同一条洞在 S5 上的第二种形状」）：
// S5 的实现记录已经落盘，而 PM 还没把 at-backend/at-frontend 写进 roster——commands/at.md
// 第 4 步在**派发并核实之后**才累加 roster，所以产物落盘的那一刻 roster 必然还不含写它的
// 那个人。roster 因此是 []，不是「派了一个、漏了一个」。
test('形状 B：产物已经落盘而写它的角色还没进 roster（roster 是空的）——unrecorded 必须看见它们', () => {
  const r = compareArtifacts({
    artifacts: {}, stages: STAGES_M2A, roster: [],
    artifactBytes: bytesOf({ '05-impl/at-backend.md': '甲\n', '05-impl/at-frontend.md': '甲\n' }),
  })
  assert.deepEqual(r.unrecorded, ['05-impl/at-backend.md', '05-impl/at-frontend.md'])
})
