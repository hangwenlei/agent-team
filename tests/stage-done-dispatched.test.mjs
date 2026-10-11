// docs/77（docs/76 §4「改动前就有的几格对不上」「协调者进度不认 trimmed」）：推进判据（advance.mjs 的 departureNeeds）的「叫到」是 stage_roles 并上
// 门禁的派发记录；isStageDone（【阶段】、交付物核验、协调者进度判齐都用它）原来只看 stage_roles——派发记录里有、stage_roles 没记的人没交时，【阶段】说
// 「S5 的产物已经齐了」，照着推进 H6 却拒。现在 isStageDone 多收一个 dispatched：这一段记了账（stage_roles 有这一段的数组，或者没有 stage_roles 的旧 run）
// 时并上派发记录里在这一段派出去过的人；没记账的照旧不并（并了会在协调者只派出一部分人时提前判齐）。协调者进度那一侧认 trimmed：叫到之后又裁掉、
// 已经停下的那个人，mayWaive 许的那几份写成免了，不再当成「停下了却没交齐」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isStageDone } from '../hooks/lib/state.mjs'
import { participantsOf } from '../hooks/lib/stages.mjs'
import { dispatchLine, stopLine } from '../hooks/lib/completion.mjs'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { BUBBLE_MARK } from '../hooks/lib/deliverable.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const ARCH_ID = 'a0000000000000a05'
const BASE = {
  stage: 'S5',
  roster: ['at-product', 'at-architect', 'at-backend'],
  stage_roles: { S2: ['at-product'], S3: ['at-architect'], S5: ['at-architect', 'at-backend'] },
}
const only = (...names) => (n) => names.includes(n)

test('isStageDone（docs/77）：这一段记了账时并上派发记录——派出去过、stage_roles 没记的人没交，不齐；不给 dispatched 的照旧', () => {
  const dispatched = { S5: ['at-backend', 'at-frontend'] }
  const base = { stage: 'S5', stages: STAGES, artifactExists: only('05-impl/at-backend.md'), roster: participantsOf(BASE, 'S5'), state: BASE }
  assert.equal(isStageDone({ ...base, dispatched }), false)
  assert.equal(isStageDone(base), true)
  // 派发记录里别的段的人不算这一段的。
  assert.equal(isStageDone({ ...base, dispatched: { S2: ['at-frontend'] } }), true)
  // 它交了就齐。
  assert.equal(isStageDone({ ...base, artifactExists: only('05-impl/at-backend.md', '05-impl/at-frontend.md'), dispatched }), true)
  // 叫到之后又裁掉（只在派发记录里有）、已经停下：免掉，与推进同一个口径。
  const trimmed = { ...BASE, trimmed: { 'at-frontend': 'S5' } }
  assert.equal(isStageDone({ ...base, state: trimmed, dispatched }), true)
  assert.equal(isStageDone({ ...base, state: trimmed, dispatched, running: new Set(['at-frontend']) }), false)
  // 旧 run（没有 stage_roles）：整趟 roster 并上派发记录。
  const legacy = { stage: 'S5', roster: ['at-architect', 'at-backend'] }
  assert.equal(isStageDone({ ...base, roster: participantsOf(legacy, 'S5'), state: legacy, dispatched }), false)
})

test('isStageDone（docs/77）：这一段还没记账（stage_roles 没有这一段的数组）不并派发记录——协调者只派出一部分人时不提前判齐', () => {
  const unrecorded = { ...BASE, stage_roles: { S2: ['at-product'], S3: ['at-architect'] } }
  const base = { stage: 'S5', stages: STAGES, artifactExists: only('05-impl/at-backend.md'), roster: participantsOf(unrecorded, 'S5'), state: unrecorded }
  assert.equal(isStageDone({ ...base, dispatched: { S5: ['at-backend'] } }), false)
  const notArray = { ...BASE, stage_roles: { ...BASE.stage_roles, S5: 'at-backend' } }
  assert.equal(isStageDone({ ...base, roster: participantsOf(notArray, 'S5'), state: notArray, dispatched: { S5: ['at-backend'] } }), false)
})

// 派发记录：架构师在 S5 派出 at-backend 与 at-frontend，两个都停下了（放行）。
function dispatchLog(roles) {
  const lines = []
  roles.forEach((role, i) => {
    const id = `a00000000000000${i}${role === 'at-frontend' ? 'f' : 'b'}`
    lines.push(dispatchLine({ at: '2026-10-11T10:00:00.000Z', agentId: id, toolUseId: null, role, stage: 'S5', caller: 'at-architect', callerId: ARCH_ID, mode: 'background' }))
    lines.push(stopLine({ at: '2026-10-11T10:05:00.000Z', agentId: id, role, stage: 'S5', outcome: 'pass' }))
  })
  return lines.join('\n') + '\n'
}

// 项目经理写 state.json（落盘之后的账本）拿【阶段】；同一个状态往 S6 推进（H6）拿拒没拒。
function scene({ state = BASE, files = {} } = {}) {
  const dirs = makeRun({ runId: 'r1', stage: 'S5', artifacts: ['00-contract.md', '01-prd.md', '03-arch.md', '03-alignment.md', '04-dispatch.md', '05-impl/at-backend.md'], roster: state.roster })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    const statePath = join(runDir, 'state.json')
    for (const [n, c] of Object.entries(files)) {
      mkdirSync(join(runDir, n, '..'), { recursive: true })
      writeFileSync(join(runDir, n), c)
    }
    const now = JSON.parse(readFileSync(statePath, 'utf8'))
    const cur = { ...now, ...state }
    writeFileSync(statePath, JSON.stringify(cur))
    const posted = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath } }
    const out = run('ledger', posted, GATE, dirs.projectDir).stdout
    const ledger = out.trim() ? JSON.parse(out).hookSpecificOutput?.additionalContext ?? '' : ''
    const next = { ...cur, stage: 'S6', history: [...cur.history, { stage: 'S6', at: '2026-10-11T11:00:00.000Z' }] }
    const pre = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath, content: JSON.stringify(next, null, 2) } }
    const r = run('rework', pre, GATE, dirs.projectDir)
    const h6 = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput ?? {} : {}
    return { ledger, denied: h6.permissionDecision === 'deny', reason: h6.permissionDecisionReason ?? '' }
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('【阶段】（docs/77）：派发记录里有、stage_roles 没记的 at-frontend 没交——不说 S5 齐了，推进 H6 也拒（两边同一个口径）', () => {
  const s = scene({ files: { 'dispatches.jsonl': dispatchLog(['at-backend', 'at-frontend']) } })
  assert.ok(!s.ledger.includes('【阶段】S5 的产物已经齐了'), s.ledger)
  assert.ok(s.denied, '推进应当被拒：' + s.reason)
  assert.match(s.reason, /05-impl\/at-frontend\.md/)
})

test('【阶段】（docs/77）：它交了、或者叫到之后又裁掉（trimmed 记着 S5、已经停下）——说 S5 齐了，推进也放行', () => {
  const log = dispatchLog(['at-backend', 'at-frontend'])
  const done = scene({ files: { 'dispatches.jsonl': log, '05-impl/at-frontend.md': '# 实现记录\n' } })
  assert.ok(done.ledger.includes('【阶段】S5 的产物已经齐了'), done.ledger)
  assert.ok(!done.denied, done.reason)
  const trimmed = scene({ state: { ...BASE, trimmed: { 'at-frontend': 'S5' } }, files: { 'dispatches.jsonl': log } })
  assert.ok(trimmed.ledger.includes('【阶段】S5 的产物已经齐了'), trimmed.ledger)
  assert.ok(!trimmed.denied, trimmed.reason)
})

// 调用点：每一处 isStageDone 调用都传 dispatched: dispatchedByStageOf(ctx)。扫描面与 tests/stage-trim-done.test.mjs 的调用点判据同一个写法
// （认任何写法的调用、跳过定义与行注释）。
test('调用点（docs/77）：hooks 下每一处 isStageDone 调用都传 dispatched: dispatchedByStageOf(ctx)', () => {
  const HOOKS = new URL('../hooks/', import.meta.url)
  const files = [
    ...readdirSync(HOOKS).filter((x) => x.endsWith('.mjs')).map((x) => ['hooks/' + x, new URL(x, HOOKS)]),
    ...readdirSync(new URL('lib/', HOOKS)).filter((x) => x.endsWith('.mjs')).map((x) => ['hooks/lib/' + x, new URL('lib/' + x, HOOKS)]),
  ]
  const where = new Set()
  for (const [name, u] of files) {
    const text = readFileSync(u, 'utf8').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n')
    for (let i = text.indexOf('isStageDone('); i >= 0; i = text.indexOf('isStageDone(', i + 1)) {
      if (text.slice(Math.max(0, i - 9), i) === 'function ') continue
      let depth = 0
      let j = i + 'isStageDone('.length
      for (; j < text.length; j++) {
        if (text[j] === '{' || text[j] === '(') depth++
        else if (text[j] === '}' || text[j] === ')') {
          if (depth === 0) break
          depth--
        }
      }
      const args = text.slice(i, j)
      where.add(name)
      assert.ok(/dispatched\s*:\s*dispatchedByStageOf\(ctx\)/.test(args), `${name}：dispatched 没传——${args.slice(0, 200)}`)
    }
  }
  assert.deepEqual([...where], ['hooks/gate.mjs'])
})

// 协调者进度：叫到之后又裁掉、已经停下的那个人，免掉的那一份写成免了，不当成「停下了却没交齐」；还在跑的照旧说可能还在跑。
const post = (target, agentId, { caller, callerId, toolUseId }) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  tool_use_id: toolUseId,
  tool_input: { subagent_type: target, description: 'x', prompt: 'y' },
  tool_response: { isAsync: true, status: 'async_launched', agentId, description: 'x', prompt: 'y' },
  ...(caller ? { agent_type: caller, agent_id: callerId } : {}),
})
const stopped = (agent, agentId, active, message) => ({ hook_event_name: 'SubagentStop', agent_type: agent, agent_id: agentId, stop_hook_active: active, last_assistant_message: message })
const note = (taskId, toolUseId) =>
  '<task-notification>\n' +
  `<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n` +
  '<summary>Agent "x" finished</summary>\n<result>派完了。</result>\n</task-notification>'

function progress({ frontendStops, frontendFile = null, extraState = {}, stages = null }) {
  const dirs = makeRun({
    runId: 'r1',
    stage: 'S5',
    artifacts: ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md'],
    roster: ['at-architect', 'at-backend', 'at-frontend'],
    stage_roles: { S3: ['at-architect'], S5: ['at-architect', 'at-backend', 'at-frontend'] },
    trimmed: { 'at-frontend': 'S5' },
  })
  // 自造的阶段链：门禁从它自己所在的插件根读 stages.json，所以拷一份插件、把链换掉（tests/gate-acceptance.test.mjs 同一个做法）。
  const plugin = stages ? realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-r35-plug-'))) : null
  let gate = GATE
  try {
    if (plugin) {
      const REPO = new URL('../', import.meta.url)
      cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
      cpSync(new URL('roster.json', REPO), join(plugin, 'roster.json'))
      writeFileSync(join(plugin, 'stages.json'), JSON.stringify(stages))
      gate = join(plugin, 'hooks', 'boot.mjs')
    }
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    if (frontendFile !== null) {
      mkdirSync(join(runDir, '05-impl'), { recursive: true })
      writeFileSync(join(runDir, '05-impl', 'at-frontend.md'), frontendFile)
    }
    const statePath = join(runDir, 'state.json')
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), ...extraState }))
    const ARCH = 'agent-team:at-architect'
    run('deliverable', post(ARCH, 'a00000000000000a5', { toolUseId: 'toolu_01A5' }), gate, dirs.projectDir)
    run('deliverable', post('agent-team:at-frontend', 'a00000000000000f5', { caller: ARCH, callerId: 'a00000000000000a5', toolUseId: 'toolu_01F5' }), gate, dirs.projectDir)
    run('deliverable', post('agent-team:at-backend', 'a00000000000000b5', { caller: ARCH, callerId: 'a00000000000000a5', toolUseId: 'toolu_01B5' }), gate, dirs.projectDir)
    // 真实顺序：它没交、被 H5b 拦一回，再以冒泡停下（项目经理随后决定这一趟不要它、写进 trimmed——夹具里 trimmed 先写好，门禁那几步不看它）。
    if (frontendStops) {
      run('stop-gate', stopped('agent-team:at-frontend', 'a00000000000000f5', false, '写不了。'), gate, dirs.projectDir)
      run('stop-gate', stopped('agent-team:at-frontend', 'a00000000000000f5', true, `${BUBBLE_MARK}缺组件库。`), gate, dirs.projectDir)
    }
    const r = run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000a5', 'toolu_01A5') }, gate, dirs.projectDir)
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : ''
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
    if (plugin) rmSync(plugin, { recursive: true, force: true })
  }
}

test('进度（docs/77）：叫到之后又裁掉、已经停下的 at-frontend——那一行写免了、收尾不叫写 trimmed；它还在跑时照旧说可能还在跑', () => {
  const c = progress({ frontendStops: true })
  assert.match(c, /at-frontend（后台派发）：05-impl\/at-frontend\.md 没交，trimmed 里记着它在 S5 裁掉了，这一份免了\n/)
  assert.ok(!c.includes('停下了却没交齐'), c)
  assert.ok(!c.includes('它停下时冒泡了'), c)
  assert.match(c, /at-backend（后台派发）：05-impl\/at-backend\.md 还没有——门禁还没见它停下：可能还在跑/)
  const still = progress({ frontendStops: false })
  assert.match(still, /at-frontend（后台派发）：05-impl\/at-frontend\.md 还没有——门禁还没见它停下：可能还在跑/)
})

test('进度（docs/77）：免不免与推进同一个口径——空文件免；还是上一轮的不免；后面有一段要它当前置的不免', () => {
  const blank = progress({ frontendStops: true, frontendFile: '' })
  assert.match(blank, /05-impl\/at-frontend\.md 没交，trimmed 里记着它在 S5 裁掉了，这一份免了\n/)
  const OLD = 'old frontend\n'
  const stale = progress({ frontendStops: true, frontendFile: OLD, extraState: { rework_base: { '05-impl/at-frontend.md': sha256OfContract(Buffer.from(OLD)) } } })
  assert.match(stale, /05-impl\/at-frontend\.md 还是上一轮的——它停下时冒泡了/)
  const stages = JSON.parse(JSON.stringify(STAGES))
  stages.S6.requires = [...stages.S6.requires, '05-impl/at-frontend.md']
  const required = progress({ frontendStops: true, stages })
  assert.match(required, /05-impl\/at-frontend\.md 还没有——它停下时冒泡了/)
})
