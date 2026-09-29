// 真的旧 Node 上，boot.mjs 能解析、跑到版本检查、按失败策略表拒绝（M3t，docs/28，全量审查第 4 条）。
//
// tests/boot.test.mjs 用预加载伪造版本号，测得到判定，测不到「旧 Node 能不能把 boot.mjs 解析起来」——
// 那要真的旧 Node：顶层 await、?.、??、node: 前缀随便漏进一处，旧 Node 就在解析或链接期死掉，
// exit 1、stdout 为空，平台当 non-blocking error 放行，门禁静默全开。CI 的最低版本作业（仅 Linux）
// 把两个真的旧 Node 的路径以 JSON 数组放进 AGENT_TEAM_OLD_NODES；没设时（本地、主矩阵）跳过。
// 覆盖的是那两个版本本身，不是「12.17 起的每一个版本」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, hermeticEnv } from './helpers/gate-runner.mjs'
import { MIN_NODE } from './helpers/min-node.mjs'
import { CHECKS } from '../hooks/lib/checks.mjs'
import { GATE_CHECK_PATH, GATE_CHECK_ONLINE } from '../hooks/lib/gate-check.mjs'

const OLD = process.env.AGENT_TEAM_OLD_NODES ? JSON.parse(process.env.AGENT_TEAM_OLD_NODES) : []

const INPUT = {
  PreToolUse: { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-backend', tool_input: { file_path: '/p/x', content: '' } },
  PostToolUse: { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: '/p/x', content: '' } },
  SubagentStop: { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' },
}
const inputFor = (check) => {
  const spec = CHECKS[check]
  const base = INPUT[spec.event]
  return spec.toolNames && !spec.toolNames.includes(base.tool_name) ? { ...base, tool_name: spec.toolNames[0], tool_input: { subagent_type: 'agent-team:at-product' } } : base
}

test('旧 Node 判据：CI 的最低版本作业交来了至少一个真的旧 Node', { skip: !process.env.AGENT_TEAM_OLD_NODES }, () => {
  assert.ok(Array.isArray(OLD) && OLD.length > 0, process.env.AGENT_TEAM_OLD_NODES)
})

for (const node of OLD) {
  test(`真的旧 Node（${node}）：每道门禁都跑到了版本检查，按失败策略表收尾`, () => {
    const version = spawnSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8' }).stdout.trim()
    assert.match(version, /^\d+\.\d+\.\d+$/, `${node} 报不出版本`)
    const dir = mkdtempSync(join(tmpdir(), 'agent-team-oldnode-'))
    try {
      for (const [check, spec] of Object.entries(CHECKS)) {
        const r = run(check, inputFor(check), undefined, dir, hermeticEnv(), { node })
        if (spec.failClosed) {
          const reason = decisionOf(r.stdout)?.permissionDecisionReason ?? ''
          assert.equal(decisionOf(r.stdout)?.permissionDecision, 'deny', `${check}：${r.stdout}${r.stderr}`)
          assert.equal(r.status, 0, check)
          assert.ok(reason.includes(MIN_NODE) && reason.includes(`v${version}`), `${check}：${reason}`)
        } else {
          // stderr 首行不一定是版本说明：12.17–12.19 上首行是 ESM 的 ExperimentalWarning。
          assert.equal(r.stdout, '', check)
          assert.equal(r.status, 1, `${check}：${r.stderr}`)
          assert.ok(r.stderr.includes(MIN_NODE) && r.stderr.includes(`v${version}`), `${check}：${r.stderr}`)
        }
      }
      const gc = run('writepath', { ...INPUT.PreToolUse, agent_type: 'agent-team:at-pm', tool_input: { file_path: join(dir, GATE_CHECK_PATH), content: 'x' } }, undefined, dir, hermeticEnv(), { node })
      assert.equal(decisionOf(gc.stdout)?.permissionDecision, 'deny', gc.stdout + gc.stderr)
      assert.ok(!gc.stdout.includes(GATE_CHECK_ONLINE), gc.stdout)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
