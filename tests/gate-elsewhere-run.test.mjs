// 第 24 条（docs/49，M4n）：按 agent_id 认派它的那一趟。切走 current-run 之后，旧 run 上还在跑的人停下、完成、再往下派人时，门禁原来一律按
// 新的这一趟判——停下行记进新 run 的派发记录、交付物按新 run 的段核（旧 run 的执行角色恰好也是新 run 当前段的产者时，会被拦下、叫它把那一趟的活
// 交进这一趟的 run 目录）。现在：当前这一趟的派发记录里没有它、别的一趟有，就是那一趟派的——
//   - H5b：不按这一趟核、放它停下，停下行记回那一趟（那一趟没收口时）；
//   - 完成核验：告诉项目经理它属于哪一趟、这一趟不核它；
//   - H5a：那一趟的协调者再往下派人，派发记录记回那一趟，回传告诉它那一趟已经不是当前 run。
// 派发记录里哪一趟都没有它的（CLI 的内部分叉、门禁不在时派出去的），照原来按当前这一趟判。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { DISPATCHES_FILE } from '../hooks/lib/control-files.mjs'
import { readDispatchLog } from '../hooks/lib/completion.mjs'

const BACKEND = 'agent-team:at-backend'
const ARCH = 'agent-team:at-architect'
const S5 = { stage: 'S5', roster: ['at-architect'], stage_roles: {} }

// 项目里两趟：r1（旧，先建）与 r2（新）。body 拿到 dirs、两个 run 目录与切指针的函数。
function twoRuns(body, { r2Stage = 'S5' } = {}) {
  const dirs = makeRun({ runId: 'r1', ...S5 })
  const r1 = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  const r2 = join(dirs.projectDir, '.agent-team', 'runs', 'r2')
  mkdirSync(r2, { recursive: true })
  const state = JSON.parse(readFileSync(join(r1, 'state.json'), 'utf8'))
  writeFileSync(join(r2, 'state.json'), JSON.stringify({ ...state, run_id: 'r2', stage: r2Stage, history: [{ stage: r2Stage, at: '2026-10-06T12:00:00Z' }] }))
  const point = (id) => writeFileSync(join(dirs.projectDir, '.agent-team', 'current-run'), id)
  try {
    return body({ ...dirs, r1, r2, point })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

const logOf = (runDir) => readDispatchLog(existsSync(join(runDir, DISPATCHES_FILE)) ? readFileSync(join(runDir, DISPATCHES_FILE), 'utf8') : null)
const launched = (agentId) => ({ isAsync: true, status: 'async_launched', agentId, description: 'x', prompt: 'y' })
const post = (target, agentId, { caller, callerId, toolUseId = 'toolu_01AAAA' } = {}) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  tool_use_id: toolUseId,
  tool_input: { subagent_type: target, description: 'x', prompt: 'y' },
  tool_response: launched(agentId),
  ...(caller ? { agent_type: caller } : {}),
  ...(callerId ? { agent_id: callerId } : {}),
})
const stop = (agent, agentId) => ({ hook_event_name: 'SubagentStop', agent_type: agent, agent_id: agentId, stop_hook_active: false, last_assistant_message: '写完了。' })
const note = (taskId, toolUseId = 'toolu_01AAAA') =>
  `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n<summary>Agent "x" finished</summary>\n<result>写完了。</result>\n</task-notification>`
const prompt = (text) => ({ hook_event_name: 'UserPromptSubmit', prompt: text })
const contextOf = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '')

test('第 24 条（H5b）：r1 派出去的 at-backend 在指针切到 r2 之后停下——不按 r2 的 S5 拦它，停下行记回 r1、r2 不记', () => {
  twoRuns(({ projectDir, r1, r2, point }) => {
    run('deliverable', post(BACKEND, 'a0000000000000101'), GATE, projectDir)
    assert.equal(logOf(r1).dispatches.length, 1, '前置：派发记在 r1')
    point('r2')
    const r = run('stop-gate', stop(BACKEND, 'a0000000000000101'), GATE, projectDir)
    assert.equal(r.status, 0, `r2 的 S5 也缺 05-impl/at-backend.md，原来会拦：${r.stderr}`)
    assert.deepEqual(logOf(r1).stops.get('a0000000000000101'), ['pass'])
    assert.equal(logOf(r2).stops.get('a0000000000000101'), undefined, '停下行不该记进 r2')
    assert.ok(r.stderr.includes('"r1"'), `留痕要点名它属于哪一趟：${r.stderr}`)
  })
})

test('第 24 条（H5b 对照）：同一个角色在 r2 里派出去的，照旧按 r2 的段拦', () => {
  twoRuns(({ projectDir, r2, point }) => {
    point('r2')
    run('deliverable', post(BACKEND, 'a0000000000000102'), GATE, projectDir)
    const r = run('stop-gate', stop(BACKEND, 'a0000000000000102'), GATE, projectDir)
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.deepEqual(logOf(r2).stops.get('a0000000000000102'), ['block'])
  })
})

test('第 24 条（H5b 对照）：哪一趟的派发记录里都没有它——照当前这一趟判', () => {
  twoRuns(({ projectDir, point }) => {
    point('r2')
    const r = run('stop-gate', stop(BACKEND, 'a0000000000000103'), GATE, projectDir)
    assert.equal(r.status, 2, r.stdout + r.stderr)
  })
})

test('第 24 条（H5b）：当前这一趟与别的一趟都记着它（拷过来的派发记录）——当前这一趟优先', () => {
  twoRuns(({ projectDir, r1, r2, point }) => {
    run('deliverable', post(BACKEND, 'a0000000000000104'), GATE, projectDir)
    writeFileSync(join(r2, DISPATCHES_FILE), readFileSync(join(r1, DISPATCHES_FILE)))
    point('r2')
    const r = run('stop-gate', stop(BACKEND, 'a0000000000000104'), GATE, projectDir)
    assert.equal(r.status, 2, r.stdout + r.stderr)
  })
})

test('第 24 条（H5b）：派它的那一趟已经收口——照样放它停下、不记进当前这一趟，那一趟也不再记', () => {
  twoRuns(({ projectDir, r1, r2, point }) => {
    run('deliverable', post(BACKEND, 'a0000000000000105'), GATE, projectDir)
    const st = JSON.parse(readFileSync(join(r1, 'state.json'), 'utf8'))
    writeFileSync(join(r1, 'state.json'), JSON.stringify({ ...st, stage: 'S8', closed_at: '2026-10-06T11:00:00Z' }))
    point('r2')
    const r = run('stop-gate', stop(BACKEND, 'a0000000000000105'), GATE, projectDir)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(logOf(r1).stops.get('a0000000000000105'), undefined)
    assert.equal(logOf(r2).stops.get('a0000000000000105'), undefined)
  })
})

test('第 24 条（完成核验）：r1 派出去的人的完成通知到了、指针已经指着 r2——告诉项目经理它属于 r1、这一趟不核它', () => {
  twoRuns(({ projectDir, point }) => {
    run('deliverable', post(BACKEND, 'a0000000000000106'), GATE, projectDir)
    point('r2')
    const c = contextOf(run('completion', prompt(note('a0000000000000106')), GATE, projectDir))
    assert.ok(c.includes('at-backend（S5）') && c.includes('"r1"'), c)
    assert.match(c, /不按这一趟核/)
    assert.match(c, /\/agent-team:at-resume/)
    assert.ok(!c.includes('没交齐'), `不该按 r2 的 S5 说它没交齐：${c}`)
  })
})

test('第 24 条（完成核验）：派它的那一趟已经收口——说那一趟已经收口、它写的东西不计入任何一趟', () => {
  twoRuns(({ projectDir, r1, point }) => {
    run('deliverable', post(BACKEND, 'a0000000000000107'), GATE, projectDir)
    const st = JSON.parse(readFileSync(join(r1, 'state.json'), 'utf8'))
    writeFileSync(join(r1, 'state.json'), JSON.stringify({ ...st, stage: 'S8', closed_at: '2026-10-06T11:00:00Z' }))
    point('r2')
    const c = contextOf(run('completion', prompt(note('a0000000000000107')), GATE, projectDir))
    assert.ok(c.includes('"r1"'), c)
    assert.match(c, /那一趟已经收口/)
  })
})

test('第 24 条（H5a）：r1 的架构师在指针切到 r2 之后再派 at-backend——派发记回 r1（架构师在 r1 的那一段），回传告诉它 r1 已经不是当前 run', () => {
  // r2 停在 S3：派发行的段要取架构师在 r1 的那一段（S5），不是当前这一趟的段。
  twoRuns(({ projectDir, r1, r2, point }) => {
    run('deliverable', post(ARCH, 'a0000000000000108'), GATE, projectDir)
    point('r2')
    const r = run('deliverable', post(BACKEND, 'a0000000000000109', { caller: ARCH, callerId: 'a0000000000000108', toolUseId: 'toolu_01BBBB' }), GATE, projectDir)
    assert.equal(r.status, 0, r.stderr)
    const d = logOf(r1).dispatches.find((x) => x.agent_id === 'a0000000000000109')
    assert.ok(d, 'r1 的派发记录里要有它')
    assert.equal(d.stage, 'S5')
    assert.equal(d.caller_id, 'a0000000000000108')
    assert.equal(logOf(r2).dispatches.find((x) => x.agent_id === 'a0000000000000109'), undefined, 'r2 不该记它')
    const c = contextOf(r)
    assert.ok(c.includes('"r1"'), c)
    assert.match(c, /不是当前 run/)
    // 它停下时同样认回 r1。
    const s = run('stop-gate', stop(BACKEND, 'a0000000000000109'), GATE, projectDir)
    assert.equal(s.status, 0, s.stdout + s.stderr)
    assert.deepEqual(logOf(r1).stops.get('a0000000000000109'), ['pass'])
  }, { r2Stage: 'S3' })
})

test('第 24 条（完成核验）：通知的收件人不是项目经理（-p 下送给还在跑的协调者）——不说它属于哪一趟', () => {
  twoRuns(({ projectDir, point }) => {
    run('deliverable', post(BACKEND, 'a0000000000000110'), GATE, projectDir)
    point('r2')
    const r = run('completion', { ...prompt(note('a0000000000000110')), agent_type: ARCH, agent_id: 'a0000000000000111' }, GATE, projectDir)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!contextOf(r).includes('那一趟派出去的'), contextOf(r))
  })
})
