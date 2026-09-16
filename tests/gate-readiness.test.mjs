// H2（readiness）在 gate.mjs 里唯一一段 tests/readiness.test.mjs 覆盖不到的逻辑：
// decideReadiness 是纯函数，从不知道 ctx.ok 是什么——「读不到运行上下文时
// 到底做了什么」完全活在 gate.mjs 自己的 CHECK === 'readiness' 分支里。
//
// 规格 §6：H2 的失败策略是 allow + warning，不是静默放行。Task 1 评审记录
// 过这条遗留项：早期草稿在 ctx.ok === false 时只 process.exit(0)，一声不吭——
// 如果退回那个写法，下面这条测试必须变红，不能因为只断言了 exit code
// 就继续绿着（那是本任务自审明确要求排除的恒真断言）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './helpers/gate-runner.mjs'

test('readiness：ctx.ok 为 false 时 fail open 且在 stderr 留痕说明（不是静默放行）', () => {
  // 干净的临时目录当 cwd：这里必然没有 .agent-team，readRunContext 必然
  // 返回 ok:false——不依赖仓库根此刻是否恰好有/没有进行中的 run，那是
  // 环境状态，不该决定这条分支的测试结果。
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h2-cwd-'))
  try {
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'at-product' } }
    const { stdout, stderr, status } = run('readiness', input, undefined, cwd)

    assert.equal(status, 0, 'H2 fail open：读不到运行上下文不能拦住这次调用')
    assert.equal(stdout.trim(), '', '不该往 stdout 写 PreToolUse 的 deny JSON——这次判定是放行')
    assert.ok(
      stderr.trim().length > 0,
      '必须往 stderr 留痕；只断言 exit code 是 0 抓不住"退回静默放行"这个真实发生过的回归',
    )
    assert.match(stderr, /agent-team/, 'stderr 里应表明这是 agent-team 发出的')
    assert.match(stderr, /(H2|就绪)/, 'stderr 里应指明是就绪门禁本身，不能是一句认不出出处的泛泛之词')
    assert.match(
      stderr,
      /current-run/,
      'stderr 里应带上 readRunContext 给出的具体原因（这里必然提到 current-run），' +
        '而不是一句与实际失败原因无关、写死的固定文案',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
