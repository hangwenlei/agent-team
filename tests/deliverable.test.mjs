// H5 交付物校验的纯函数核心——decideDeliverable 不碰文件系统
// （artifactExists 由调用方注入），可以脱离 Claude Code 与磁盘单测。
// 它同时喂 H5b（SubagentStop，真拦截）与 H5a（PostToolUse，权威记录）
// 两条 hook；这两条 hook 在 gate.mjs 里各自怎么从输入中挖出角色、怎么读
// 运行上下文、deny/warning 怎么传导——那部分入口传导链由
// tests/gate-deliverable.test.mjs 的子进程级测试覆盖，不在这里重复
// （Task 3 的教训：纯函数测试和入口传导链测试要分开覆盖，只测前者会漏掉
// 字段选错、ctx 分派这类真实发生过的问题）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideDeliverable } from '../hooks/lib/deliverable.mjs'

const STAGES = {
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  S3: { role: 'at-architect', requires: ['01-prd.md'], produces: ['03-arch.md'] },
}
const have = (...names) => (rel) => names.includes(rel)

test('产物已写时 ok', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: STAGES, artifactExists: have('01-prd.md') })
  assert.equal(r.ok, true)
})

test('产物未写时不 ok，并列出缺的是哪些', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: STAGES, artifactExists: have() })
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ['01-prd.md'])
})

test('理由点名阶段与文件', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: STAGES, artifactExists: have() })
  assert.match(r.reason, /S2/)
  assert.match(r.reason, /01-prd\.md/)
})

// 简报原稿这里写的角色名是 'at-worker-a'——已删除的旧名（Task 6 简报「简报
// 已经过时的地方」第 4 条）。换成 at-outsider：花名册里真实存在、但设计上
// 从不出现在任何阶段里的角色（仓库根真实 stages.json 没有一条 role 是
// at-outsider），比随便一个"恰好没写进这个局部 STAGES 夹具"的角色更能
// 说明这条测试到底在验证什么。
test('不在阶段链里的角色没有交付物义务', () => {
  const r = decideDeliverable({ role: 'at-outsider', stageId: 'S2', stages: STAGES, artifactExists: have() })
  assert.equal(r.ok, true)
})

test('stages 缺失时不判定为失败——门禁坏了不该诬告角色', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: null, artifactExists: have() })
  assert.equal(r.ok, true)
})

// produces 为空这条边界，decideDeliverable 与 hooks/lib/readiness.mjs 的
// decideReadiness 面对的是同一份 stages.json、同一组情形——两边对"没有产物
// 义务的阶段要不要拦"这件事语义不能打架，否则 H2 与 H5 会对同一个阶段给出
// 不一致的答案。
//
// "角色身兼多阶段时，先判定哪一段"这条边界，M1b 之前两个函数共用同一条迭代
// 规则（都取该角色第一个未完成的阶段）。Task 7 把 decideDeliverable 改成只
// 认调用方传入的 stageId、不再自己迭代所有阶段——这正是这次改动要修的 bug
// 本体（见 hooks/lib/deliverable.mjs 头部【M1b 改】那段）。原来这里还有一条
// "同一角色的多个阶段按插入序判定"的测试，验的是 decideDeliverable 自己遍历
// mine 数组、跳过已完成阶段这条逻辑；这条逻辑随这次改动整体删除了（新实现是
// stages[stageId] 直查，不再有第二个候选阶段可比顺序），继续留着那条测试、
// 只补一个 stageId 参数，会让它退化成跟上面"产物未写时不 ok"完全同构的重复
// 断言，而测试名和注释仍然宣称在验证"插入序"——这正是这个项目反复栽过的失效
// 形状（一个看起来在验证某件事、实际什么都没验的断言）。删掉它，覆盖它原本
// 要防的回归("不再自己找第一个未完成的阶段")的是下面新增的第一条测试，
// 用的是规格 §4 里真实会出现的场景（at-architect 身兼 S3 与 S5），比原来
// S2/S10 这个纯为了避开字典序而造的合成夹具更贴近会真正发生的情形。
test('produces 为空的阶段视为跳过（不检查），与 decideReadiness 的已知边界一致', () => {
  // decideReadiness 那边这条边界的完整说明见 hooks/lib/readiness.mjs
  // Task 3 评审 Minor 3 的注释：纯评审类、不产出文件的阶段两边都不设防，
  // 是同一个已知边界，不是 decideDeliverable 单独引入的新缺口。
  const stages = { S1: { role: 'at-pm', requires: [], produces: [] } }
  const r = decideDeliverable({ role: 'at-pm', stageId: 'S1', stages, artifactExists: have() })
  assert.equal(r.ok, true)
})

// 下面四条覆盖 M1b Task 7 的新语义：decideDeliverable 现在只认调用方传入的
// stageId，不再自己猜"该看哪一段"。

test('按传入的 stageId 判定，不再自己找「第一个未完成的阶段」', () => {
  // at-architect 同时是 S3 与 S5 的执行者——规格 §4 的完整阶段链就是这样。
  // 它刚交完 S3（03-arch.md 在磁盘上），S5 的产物当然还没有。
  const stages = {
    S3: { role: 'at-architect', requires: [], produces: ['03-arch.md'] },
    S5: { role: 'at-architect', requires: [], produces: ['05-impl/index.md'] },
  }
  const exists = (p) => p === '03-arch.md'
  // 老规则会拿 S5 的缺失产物把刚交完 S3 的它顶回去，最多九次然后平台静默放行。
  assert.deepEqual(
    decideDeliverable({ role: 'at-architect', stageId: 'S3', stages, artifactExists: exists }),
    { ok: true },
  )
  // 真到了 S5 才该拦。
  const r = decideDeliverable({ role: 'at-architect', stageId: 'S5', stages, artifactExists: exists })
  assert.equal(r.ok, false)
  assert.equal(r.stageId, 'S5')
})

test('角色不是当前阶段的执行者：不表态，但说明为什么', () => {
  const stages = { S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] } }
  const r = decideDeliverable({ role: 'at-backend', stageId: 'S2', stages, artifactExists: () => false })
  assert.deepEqual(r, { ok: true, skipped: 'role-not-in-stage' })
})

test('stageId 查不到（缺失、或 state.stage 是个不存在的阶段）：不表态，并说明为什么', () => {
  const stages = { S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] } }
  for (const stageId of [undefined, null, 'S9', 3]) {
    assert.deepEqual(
      decideDeliverable({ role: 'at-product', stageId, stages, artifactExists: () => false }),
      { ok: true, skipped: 'unknown-stage' },
    )
  }
})

test('当前阶段没有 produces 义务：不表态', () => {
  const stages = { S3: { role: 'at-architect', requires: [], produces: [] } }
  assert.deepEqual(
    decideDeliverable({ role: 'at-architect', stageId: 'S3', stages, artifactExists: () => false }),
    { ok: true },
  )
})
