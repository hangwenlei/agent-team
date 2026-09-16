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
  const r = decideDeliverable({ role: 'at-product', stages: STAGES, artifactExists: have('01-prd.md') })
  assert.equal(r.ok, true)
})

test('产物未写时不 ok，并列出缺的是哪些', () => {
  const r = decideDeliverable({ role: 'at-product', stages: STAGES, artifactExists: have() })
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ['01-prd.md'])
})

test('理由点名阶段与文件', () => {
  const r = decideDeliverable({ role: 'at-product', stages: STAGES, artifactExists: have() })
  assert.match(r.reason, /S2/)
  assert.match(r.reason, /01-prd\.md/)
})

// 简报原稿这里写的角色名是 'at-worker-a'——已删除的旧名（Task 6 简报「简报
// 已经过时的地方」第 4 条）。换成 at-outsider：花名册里真实存在、但设计上
// 从不出现在任何阶段里的角色（仓库根真实 stages.json 没有一条 role 是
// at-outsider），比随便一个"恰好没写进这个局部 STAGES 夹具"的角色更能
// 说明这条测试到底在验证什么。
test('不在阶段链里的角色没有交付物义务', () => {
  const r = decideDeliverable({ role: 'at-outsider', stages: STAGES, artifactExists: have() })
  assert.equal(r.ok, true)
})

test('stages 缺失时不判定为失败——门禁坏了不该诬告角色', () => {
  const r = decideDeliverable({ role: 'at-product', stages: null, artifactExists: have() })
  assert.equal(r.ok, true)
})

// 下面两条边界，decideDeliverable 与 hooks/lib/readiness.mjs 的
// decideReadiness 面对的是同一份 stages.json、同一组情形（角色身兼多阶段、
// produces 为空）——两边的语义不能打架，否则 H2 与 H5 会对"角色这一刻该看
// 哪个阶段"给出不一致的答案。

test('同一角色的多个阶段按 stages 的书写顺序（插入序）判定，不按阶段 id 字符串排序', () => {
  // "S10".localeCompare("S2") < 0——字典序会把 S10 排到 S2 前面。
  // decideReadiness 曾经这样排过序，Task 3 评审 Minor 2 改成了插入序；
  // decideDeliverable 面对的是同一份 stages.json 的书写顺序，必须延用
  // 同一套顺序语义。S2、S10 的产物都缺：插入序下 S2 先声明、应该先报 S2；
  // 若误用字符串排序，S10 会被排到前面，报出来的会是 S10。
  const stages = {
    S2: { role: 'at-pm', requires: [], produces: ['02-x.md'] },
    S10: { role: 'at-pm', requires: [], produces: ['10-y.md'] },
  }
  const r = decideDeliverable({ role: 'at-pm', stages, artifactExists: have() })
  assert.equal(r.ok, false)
  assert.equal(r.stageId, 'S2')
})

test('produces 为空的阶段视为跳过（不检查），与 decideReadiness 的已知边界一致', () => {
  // decideReadiness 那边这条边界的完整说明见 hooks/lib/readiness.mjs
  // Task 3 评审 Minor 3 的注释：纯评审类、不产出文件的阶段两边都不设防，
  // 是同一个已知边界，不是 decideDeliverable 单独引入的新缺口。
  const stages = { S1: { role: 'at-pm', requires: [], produces: [] } }
  const r = decideDeliverable({ role: 'at-pm', stages, artifactExists: have() })
  assert.equal(r.ok, true)
})
