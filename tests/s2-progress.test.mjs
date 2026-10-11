// docs/80（docs/43 §4「S2 的进度只在 at-product 自己那份交了、S2 没齐时报」）：S2 的协调者 at-product 自己也是这一段的产者。它自己那份（01-prd.md）
// 没交就返回时，原来只走交付物核验那一段（说它缺什么、怎么办），它派出去的 at-ui 交没交、还在不在跑一字不提——PM 照「再派 at-product」去做之前，
// 看不到 at-ui 那一头。现在两处（完成通知到主会话时的完成核验、前台派发跑完时的 H5a）都在那一段之后再报进度，开头说它自己那几份还没交齐。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { BUBBLE_MARK } from '../hooks/lib/deliverable.mjs'
import { coordinatorProgress } from '../hooks/lib/completion.mjs'

const PRODUCT = 'agent-team:at-product'
const UI = 'agent-team:at-ui'
const launched = (agentId) => ({ isAsync: true, status: 'async_launched', agentId, description: 'x', prompt: 'y' })
const completed = (agentId) => ({ status: 'completed', prompt: 'y', agentId, agentType: PRODUCT, content: [{ type: 'text', text: '回报。' }], totalDurationMs: 1 })
const post = (target, response, { caller, callerId, toolUseId }) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  tool_use_id: toolUseId,
  tool_input: { subagent_type: target, description: 'x', prompt: 'y' },
  tool_response: response,
  ...(caller ? { agent_type: caller, agent_id: callerId } : {}),
})
const stopped = (agent, agentId, active, message) => ({ hook_event_name: 'SubagentStop', agent_type: agent, agent_id: agentId, stop_hook_active: active, last_assistant_message: message })
const note = (taskId, toolUseId) =>
  '<task-notification>\n' +
  `<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n` +
  '<summary>Agent "x" finished</summary>\n<result>回报。</result>\n</task-notification>'
const ctxOf = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '')

function inS2(body) {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: ['at-product', 'at-ui'], stage_roles: {} })
  try {
    return body(dirs)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('完成核验（docs/80）：at-product 自己那份没交、冒泡停下返回，它派出去的 at-ui 还在跑——先说它缺什么，再报 S2 进度、开头说它自己那几份还没交齐', () => {
  const c = inS2((dirs) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c1'), { toolUseId: 'toolu_01C1' }), GATE, dirs.projectDir)
    run('deliverable', post(UI, launched('a00000000000000d1'), { caller: PRODUCT, callerId: 'a00000000000000c1', toolUseId: 'toolu_01D1' }), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c1', false, '写不了。'), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c1', true, `${BUBBLE_MARK}缺用户确认。`), GATE, dirs.projectDir)
    return ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c1', 'toolu_01C1') }, GATE, dirs.projectDir))
  })
  assert.match(c, /at-product 在 S2 .*01-prd\.md 还没有/)
  assert.match(c, /交付物核验（S2 进度）：刚返回的 at-product 是 S2 的协调者，它自己的那几份还没交齐；/)
  assert.match(c, /at-ui（后台派发）：02-ui-spec\.md 还没有，02-wireframe\.html 还没有——门禁还没见它停下：可能还在跑/)
  assert.ok(c.indexOf('01-prd.md 还没有') < c.indexOf('（S2 进度）'), c)
})

test('H5a（docs/80）：前台派发的 at-product 跑完、自己那份没交，它派出去的 at-ui 还在跑——进度开头说它自己那几份还没交齐，不说「交了」', () => {
  const c = inS2((dirs) => {
    run('deliverable', post(UI, launched('a00000000000000d2'), { caller: PRODUCT, callerId: 'a00000000000000c2', toolUseId: 'toolu_01D2' }), GATE, dirs.projectDir)
    return ctxOf(run('deliverable', post(PRODUCT, completed('a00000000000000c2'), { toolUseId: 'toolu_01C2' }), GATE, dirs.projectDir))
  })
  assert.match(c, /交付物核验（S2 进度）：刚返回的 at-product 是 S2 的协调者，它自己的那几份还没交齐；/)
  assert.ok(!c.includes('它自己的那几份交了'), c)
  assert.match(c, /at-ui（后台派发）：02-ui-spec\.md 还没有/)
})

test('完成核验（docs/80）：at-product 自己那份没交、也没派过别人——照旧只说它缺什么，不报进度', () => {
  const c = inS2((dirs) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c3'), { toolUseId: 'toolu_01C3' }), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c3', false, '写不了。'), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c3', true, `${BUBBLE_MARK}缺用户确认。`), GATE, dirs.projectDir)
    return ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c3', 'toolu_01C3') }, GATE, dirs.projectDir))
  })
  assert.match(c, /at-product 在 S2 .*01-prd\.md 还没有/)
  assert.ok(!c.includes('（S2 进度）'), c)
})

test('coordinatorProgress（docs/80）：协调者自己那几份没交齐、它派出去的都交了——收尾不说「名单上的都交了、再推进」，叫照交付物核验那一段处理它自己那份', () => {
  const rows = [{ role: 'at-ui', mode: 'background', stop: 'pass', items: [{ name: '02-ui-spec.md', state: 'ok' }, { name: '02-wireframe.html', state: 'ok' }] }]
  const s = coordinatorProgress({ role: 'at-product', stageId: 'S2', rows, recipientIsPm: true, selfMissing: true, impl: false })
  assert.ok(s.includes('它自己的那几份还没交齐'), s)
  assert.ok(!s.includes('名单上的都交了'), s)
  assert.ok(s.includes('它派出去的都交了；它自己那几份照上面交付物核验那一段处理'), s)
  const done = coordinatorProgress({ role: 'at-product', stageId: 'S2', rows, recipientIsPm: true, selfDone: true, impl: false })
  assert.ok(done.includes('它自己的那几份交了') && done.includes('名单上的都交了'), done)
})

test('完成核验（docs/80）：at-product 派它那一段已经不是当前段了——照旧只说它缺什么，不报那一段的进度（与交了的那一支同一个条件）', () => {
  const c = inS2((dirs) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c4'), { toolUseId: 'toolu_01C4' }), GATE, dirs.projectDir)
    run('deliverable', post(UI, launched('a00000000000000d4'), { caller: PRODUCT, callerId: 'a00000000000000c4', toolUseId: 'toolu_01D4' }), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c4', false, '写不了。'), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c4', true, `${BUBBLE_MARK}缺用户确认。`), GATE, dirs.projectDir)
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), stage: 'S1', history: [{ stage: 'S1', at: '2026-09-17T14:30:00Z' }] }))
    return ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c4', 'toolu_01C4') }, GATE, dirs.projectDir))
  })
  assert.match(c, /01-prd\.md 还没有/)
  assert.ok(!c.includes('（S2 进度）'), c)
})
