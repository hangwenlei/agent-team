// 第 33 条（docs/24 附录、docs/39 §2，M4l）：fail closed 的检查项在判定中途崩溃——最外层 catch 照安全边界拒（G10），H6 是 fail closed 的（CK4）。
// 外部输入自然触发不到这一支（各纯函数对退化输入都很防御），用 tests/helpers/inject-throw.cjs 预加载、让判定中途抛异常：H1 认目标角色时调
// startsWith、H6 读验收结论首行时调 normalize（macOS 上路径归一化先调它，同样在判定中途）。fail open 的那几格在 tests/gate-fail-open.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, decisionOf, hermeticEnv, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const NL = String.fromCharCode(10)
const INJECT = fileURLToPath(new URL('./helpers/inject-throw.cjs', import.meta.url))
const crash = (check, input, cwd, how) => run(check, input, GATE, cwd, { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: how }, { nodeArgs: ['-r', INJECT] })
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-06T10:00:00Z' }))
const CHAIN = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']

function withRun(opts, files, body) {
  const dirs = makeRun({ runId: 'r1', ...opts })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  for (const [name, text] of Object.entries(files)) writeFileSync(join(runDir, name), text)
  try {
    return body({ ...dirs, runDir })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('第 33 条（G10）：H1 判定中途崩溃——最外层 catch 照安全边界拒，理由带上异常消息', () => {
  withRun({ stage: 'S2', history: H('S1', 'S2') }, {}, ({ projectDir }) => {
    const target = 'agent-team:at-crash'
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Agent', agent_type: 'agent-team:at-pm', tool_input: { subagent_type: target, prompt: 'x' } }
    const r = crash('delegation', input, projectDir, `prefix:${target}`)
    const d = decisionOf(r.stdout)
    assert.equal(d?.permissionDecision, 'deny', r.stdout + r.stderr)
    assert.ok(d.permissionDecisionReason.includes('门禁异常，按安全边界拒绝') && d.permissionDecisionReason.includes('injected'), d.permissionDecisionReason)
  })
})

test('第 33 条（CK4）：H6 是 fail closed 的——收口那一次写入在判定中途崩溃，拒（不是放行）', () => {
  const s8 = { stage: 'S8', history: H(...CHAIN), roster: ['at-qa', 'at-acceptance'], stage_roles: { S6: ['at-qa'], S7: ['at-acceptance'] } }
  const files = { '06-test.md': 'test' + NL, '07-acceptance.md': '结论：通过' + NL, '08-delivery.md': 'delivery' + NL }
  withRun(s8, files, ({ projectDir, runDir }) => {
    const statePath = join(runDir, 'state.json')
    const now = JSON.parse(readFileSync(statePath, 'utf8'))
    const content = JSON.stringify({ ...now, never_invoked: [], closed_at: '2026-10-06T12:00:00Z' }, null, 2)
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath, content } }
    assert.equal(decisionOf(run('rework', input, GATE, projectDir).stdout), null, '不注入时这次收口放行')
    const r = crash('rework', input, projectDir, 'normalize')
    const d = decisionOf(r.stdout)
    assert.equal(d?.permissionDecision, 'deny', r.stdout + r.stderr)
    assert.ok(d.permissionDecisionReason.includes('门禁异常，按安全边界拒绝'), d.permissionDecisionReason)
  })
})
