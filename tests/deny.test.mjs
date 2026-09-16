// denyOutput 是「拒绝的输出契约」这件事本身的唯一真源，从 hooks/gate.mjs 抽出来
// 是因为它的 SubagentStop 分支（exit 2 + stderr）在 Task 6 给 stop-gate 接上
// 判定逻辑之前，从 gate.mjs 这条路径永远不会被真实调用到——留在 gate.mjs 里
// 只能靠人工代码走读验证，是「看起来健康、实际什么都不做」的失效形状，这个
// 项目一路被咬的就是这个（M0 的 junction 守卫、Task 1 一轮评审的 emitDeny
// 只换事件名不换形状）。抽成纯函数后可以直接单测三个分支，不需要经过子进程，
// 也不用等 Task 6 的判定逻辑落地（Task 1 二轮评审）。Task 6 现在已经落地
// （tests/gate-deliverable.test.mjs 有子进程级的 exit 2 用例），但这份直接
// 单测没有因此变得多余：那边验证的是"gate.mjs 这条传导链接对了"，这里验证
// 的是"denyOutput 这个契约本身没错"，两者答不同的问题。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { denyOutput } from '../hooks/lib/deny.mjs'

test('PreToolUse：stdout 上的 permissionDecision JSON，exitCode 0', () => {
  const out = denyOutput('测试理由', 'PreToolUse')
  assert.equal(out.stream, 'stdout')
  assert.equal(out.exitCode, 0)
  const parsed = JSON.parse(out.text)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, '测试理由')
})

// 这是 Task 1 落地时风险最高的一处：SubagentStop 的拒绝走 exit 2 + stderr
// （U5 实测，docs/07-U5-U6-U8-实测结论.md §1），不是 PreToolUse 那套 stdout
// JSON——当时 gate.mjs 里这条分支要等 Task 6 给 stop-gate 接上判定逻辑才会
// 被真实调用，这条测试直接执行 denyOutput 本身，不必等到那时候。Task 6 现在
// 已经落地，这条分支也已经能经 gate.mjs 真实调用到了，但直接测 denyOutput
// 仍然是必要的一半——见本文件顶部的说明。
test('SubagentStop：stderr 上的理由，exitCode 2', () => {
  const out = denyOutput('测试理由', 'SubagentStop')
  assert.equal(out.stream, 'stderr')
  assert.equal(out.exitCode, 2)
  assert.match(out.text, /测试理由/)
})

test('其它事件：stderr 打一行 agent-team BUG 提示，exitCode 0，不静默吞掉', () => {
  // PostToolUse 是当前唯一真实存在、但从不会调用 denyOutput 的事件
  // （H5a/deliverable 按规格 §6 只记 warning，从不拒绝）——用它代表
  // 「万一将来误调用」的场景，验证不可达分支也是有声的，不是静默吞掉。
  const out = denyOutput('测试理由', 'PostToolUse')
  assert.equal(out.stream, 'stderr')
  assert.equal(out.exitCode, 0)
  assert.match(out.text, /^agent-team BUG:/)
})
