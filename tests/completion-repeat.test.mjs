// docs/82（docs/38 §5「重复通知会重复回传」，docs/80 §4 同一族）：平台对同一个 task-id 会送不止一条完成通知（docs/38 §1.3 的实测），完成核验每一条都
// 把同一段话整段重报。现在门禁在派发记录里记下这一条通知上一次回传的指纹（`told` 行：agent_id 与那一段回传的 sha），同一个
// agent_id 再来一条、结论没变时改说一句短的——「之前已经核过一次、结论没变，照那一次的回传处理」；结论变了（交了、停下的结果变了）照常整段报。不改成
// 一声不吭：项目经理会把门禁没说话读成「核过了、没问题」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { readDispatchLog, toldLine } from '../hooks/lib/completion.mjs'

const PRODUCT = 'agent-team:at-product'
const launched = (agentId) => ({ isAsync: true, status: 'async_launched', agentId, description: 'x', prompt: 'y' })
const post = (target, response, toolUseId) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  tool_use_id: toolUseId,
  tool_input: { subagent_type: target, description: 'x', prompt: 'y' },
  tool_response: response,
})
const stopped = (agent, agentId, active, message) => ({ hook_event_name: 'SubagentStop', agent_type: agent, agent_id: agentId, stop_hook_active: active, last_assistant_message: message })
const note = (taskId, toolUseId) =>
  '<task-notification>\n' +
  `<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n` +
  '<summary>Agent "x" finished</summary>\n<result>回报。</result>\n</task-notification>'
const ctxOf = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const SHORT = '这条完成通知门禁之前已经核过一次、结论没变'

test('readDispatchLog（docs/82）：认 told 行——每个 agent_id 记最后一次回传的指纹；形状不对的跳过', () => {
  const at = '2026-10-11T10:00:00.000Z'
  const text = [
    toldLine({ at, agentId: 'a00000000000000c1', role: 'at-product', stage: 'S2', sha: 'sha256:' + '1'.repeat(64) }),
    toldLine({ at, agentId: 'a00000000000000c1', role: 'at-product', stage: 'S2', sha: 'sha256:' + '2'.repeat(64) }),
    JSON.stringify({ kind: 'told', at, agent_id: 'a00000000000000c2', role: 'at-ui', stage: 'S2', sha: 42 }),
    JSON.stringify({ kind: 'told', at, agent_id: 'a00000000000000c3', role: 'at-ui', stage: 'S2', sha: 'sha256:xyz' }),
  ].join('\n')
  const log = readDispatchLog(text)
  assert.equal(log.told.get('a00000000000000c1'), 'sha256:' + '2'.repeat(64))
  assert.ok(!log.told.has('a00000000000000c2') && !log.told.has('a00000000000000c3'))
  assert.equal(log.dispatches.length, 0)
})

function inS2(body) {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: ['at-product'], stage_roles: {} })
  try {
    return body(dirs, join(dirs.projectDir, '.agent-team', 'runs', 'r1'))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('完成核验（docs/82）：同一个 task-id 的通知来第二次、结论没变——只说一句之前核过、结论没变，不整段重报；第一次照常整段报', () => {
  inS2((dirs) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c1'), 'toolu_01C1'), GATE, dirs.projectDir)
    const notify = () => ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c1', 'toolu_01C1') }, GATE, dirs.projectDir))
    const first = notify()
    assert.match(first, /01-prd\.md 还没有/)
    assert.ok(!first.includes(SHORT), first)
    const second = notify()
    assert.ok(second.includes(`交付物核验：at-product（S2）${SHORT}`), second)
    assert.ok(!second.includes('01-prd.md 还没有'), second)
    const third = notify()
    assert.ok(third.includes(SHORT) && !third.includes('01-prd.md 还没有'), third)
  })
})

test('完成核验（docs/82）：结论变了——之间门禁拦过它一回（成因变了）就照常整段报；交了就不出声', () => {
  inS2((dirs, runDir) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c2'), 'toolu_01C2'), GATE, dirs.projectDir)
    const notify = () => ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c2', 'toolu_01C2') }, GATE, dirs.projectDir))
    notify()
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c2', false, '写不了。'), GATE, dirs.projectDir)
    const changed = notify()
    assert.match(changed, /01-prd\.md 还没有/)
    assert.match(changed, /门禁最后一回拦了它/)
    assert.ok(!changed.includes(SHORT), changed)
    writeFileSync(join(runDir, '01-prd.md'), '# 产品定义\n')
    assert.equal(notify(), '')
  })
})

test('完成核验（docs/82）：记下的是派发记录里的一行 told（门禁专属文件），不是别的地方', () => {
  inS2((dirs, runDir) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c3'), 'toolu_01C3'), GATE, dirs.projectDir)
    run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c3', 'toolu_01C3') }, GATE, dirs.projectDir)
    const log = readDispatchLog(readFileSync(join(runDir, 'dispatches.jsonl'), 'utf8'))
    assert.match(log.told.get('a00000000000000c3') ?? '', /^sha256:[0-9a-f]{64}$/)
  })
})

test('完成核验（docs/82）：一条消息里有两个子代理的通知——各按各的指纹认，第二回两条都只说一句', () => {
  inS2((dirs) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c4'), 'toolu_01C4'), GATE, dirs.projectDir)
    run('deliverable', post(PRODUCT, launched('a00000000000000c5'), 'toolu_01C5'), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000c5', false, '写不了。'), GATE, dirs.projectDir)
    const both = () =>
      ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c4', 'toolu_01C4') + '\n' + note('a00000000000000c5', 'toolu_01C5') }, GATE, dirs.projectDir))
    const first = both()
    assert.equal(first.split('01-prd.md 还没有').length - 1, 2, first)
    const second = both()
    assert.equal(second.split(SHORT).length - 1, 2, second)
    assert.ok(!second.includes('01-prd.md 还没有'), second)
  })
})

test('完成核验（docs/82 §8）：那一句短话给出看不到上一次时的出路——读它的回报、照 /agent-team:at 第 3 节去 run 目录核实', () => {
  inS2((dirs) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000c6'), 'toolu_01C6'), GATE, dirs.projectDir)
    const notify = () => ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c6', 'toolu_01C6') }, GATE, dirs.projectDir))
    notify()
    assert.ok(notify().includes('那一次的回传已经不在上下文里的，读它的回报、照 /agent-team:at 第 3 节「核实」去 run 目录核实'))
  })
})

// 复核（docs/82 §8）补的几格。
const UI = 'agent-team:at-ui'
const postBy = (target, agentId, callerId, toolUseId) => ({ ...post(target, launched(agentId), toolUseId), agent_type: PRODUCT, agent_id: callerId })

test('完成核验（docs/82 §8）：多段回传（缺产物那一段加进度）——第二回整段只说一句；它派出去的人之后交齐停下，第三回结论变了照常整段报', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: ['at-product', 'at-ui'], stage_roles: {} })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    run('deliverable', post(PRODUCT, launched('a00000000000000e1'), 'toolu_01E1'), GATE, dirs.projectDir)
    run('deliverable', postBy(UI, 'a00000000000000e2', 'a00000000000000e1', 'toolu_01E2'), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000e1', false, '写不了。'), GATE, dirs.projectDir)
    run('stop-gate', stopped(PRODUCT, 'a00000000000000e1', true, '冒泡：缺用户确认。'), GATE, dirs.projectDir)
    const notify = () => ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000e1', 'toolu_01E1') }, GATE, dirs.projectDir))
    const first = notify()
    assert.ok(first.includes('01-prd.md 还没有') && first.includes('（S2 进度）'), first)
    const second = notify()
    assert.ok(second.includes(SHORT), second)
    assert.ok(!second.includes('01-prd.md 还没有') && !second.includes('（S2 进度）'), second)
    for (const n of ['02-ui-spec.md', '02-wireframe.html']) writeFileSync(join(runDir, n), '# 界面\n')
    run('stop-gate', stopped(UI, 'a00000000000000e2', false, '写好了。'), GATE, dirs.projectDir)
    const third = notify()
    assert.ok(third.includes('（S2 进度）') && third.includes('那一头没有要等的了') && !third.includes(SHORT), third)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('完成核验（docs/82 §8）：交齐了的通知来两回都不出声，也不记 told 行', () => {
  inS2((dirs, runDir) => {
    run('deliverable', post(PRODUCT, launched('a00000000000000e3'), 'toolu_01E3'), GATE, dirs.projectDir)
    writeFileSync(join(runDir, '01-prd.md'), '# 产品定义\n')
    const notify = () => ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000e3', 'toolu_01E3') }, GATE, dirs.projectDir))
    assert.equal(notify(), '')
    assert.equal(notify(), '')
    assert.ok(!readDispatchLog(readFileSync(join(runDir, 'dispatches.jsonl'), 'utf8')).told.has('a00000000000000e3'))
  })
})

test('完成核验（docs/82 §8）：收口之后才完成的那一句照旧每次说，不往已收口的 run 写 told 行', () => {
  const H = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map((stage) => ({ stage, at: '2026-10-11T10:00:00Z' }))
  const dirs = makeRun({ runId: 'r1', stage: 'S8', roster: [], history: H })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    run('deliverable', post(PRODUCT, launched('a00000000000000e4'), 'toolu_01E4'), GATE, dirs.projectDir)
    const statePath = join(runDir, 'state.json')
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), closed_at: '2026-10-11T12:00:00Z' }))
    const notify = () => ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000e4', 'toolu_01E4') }, GATE, dirs.projectDir))
    for (let i = 0; i < 2; i++) {
      const c = notify()
      assert.ok(c.includes('在这一趟收口之后才完成') && !c.includes(SHORT), c)
    }
    assert.ok(!readFileSync(join(runDir, 'dispatches.jsonl'), 'utf8').includes('"kind":"told"'))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('完成核验（docs/82 §8）：别的一趟派出去的人的通知来两回——那一句照旧每次说', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: ['at-product'], stage_roles: {} })
  try {
    const r2 = join(dirs.projectDir, '.agent-team', 'runs', 'r2')
    mkdirSync(r2, { recursive: true })
    const state = JSON.parse(readFileSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json'), 'utf8'))
    writeFileSync(join(r2, 'state.json'), JSON.stringify({ ...state, run_id: 'r2' }))
    run('deliverable', post(PRODUCT, launched('a00000000000000e5'), 'toolu_01E5'), GATE, dirs.projectDir)
    writeFileSync(join(dirs.projectDir, '.agent-team', 'current-run'), 'r2')
    const notify = () => ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000e5', 'toolu_01E5') }, GATE, dirs.projectDir))
    for (let i = 0; i < 2; i++) {
      const c = notify()
      assert.ok(c.includes('"r1"') && c.includes('不按这一趟核') && !c.includes(SHORT), c)
    }
    assert.ok(!existsSync(join(r2, 'dispatches.jsonl')) || !readFileSync(join(r2, 'dispatches.jsonl'), 'utf8').includes('"kind":"told"'))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('正文（docs/82 §8）：/agent-team:at 第 3 节说了同一条通知再来、结论没变时回传只说一句、照那一次办', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
  assert.ok(at.includes('同一个子代理的完成通知平台会送不止一条：再来一条、结论没变时，回传只说一句「之前已经核过一次、结论没变」——\n   照那一次的回传办。'))
})
