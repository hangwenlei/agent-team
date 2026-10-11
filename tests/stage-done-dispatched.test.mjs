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
})

// 复核（docs/77 §8，中 1）：旧 run 的 roster 与 stage_roles 一样是推进那一次才累加的，段中途照样是没记账；项目经理在段中途先单独记下这一段、
// 记的人里一个产者都没有（`[]`、只有协调者）也是。这两种并上派发记录，会在协调者只派出一部分人时提前判齐——不并，与改动前一样。
// 第二轮复核（docs/77 §8，低 3）：判「记了账」看的是传进来的参与者（stage_roles 那一段，旧 run 是整趟 roster）里有没有这一段的产者——旧 run 在 S2 用过 at-ui，
// 它也是 S5 的产者，段中途参与者就不是空的，并上派发记录只会多要、不会提前判齐。参与者里一个产者都没有的不并（并了会把空名单变成非空、提前判齐）。
test('isStageDone（docs/77 §8）：参与者里一个产者都没有的不并派发记录（旧 run 的 roster 没有这一段的产者、记成 [] 或只有协调者）——协调者只派出一部分人时不提前判齐；有产者的旧 run 照样并', () => {
  const only5 = only('05-impl/at-backend.md')
  const dispatched = { S5: ['at-backend', 'at-frontend'] }
  const run5 = (state, exists = only5, d = dispatched) => isStageDone({ stage: 'S5', stages: STAGES, artifactExists: exists, roster: participantsOf(state, 'S5'), state, dispatched: d })
  // 旧 run、roster 里没有 S5 的产者：不并（at-backend 交了也不说齐）。
  assert.equal(run5({ stage: 'S5', roster: ['at-product', 'at-architect'] }, only5, { S5: ['at-backend'] }), false)
  // 旧 run、roster 里有 S5 的产者：并——派了没记的 at-frontend 没交，不齐（与推进同一个口径）。
  assert.equal(run5({ stage: 'S5', roster: ['at-architect', 'at-backend'] }), false)
  // 旧 run 在 S2 用过 at-ui（它也是 S5 的产者）：S5 里 at-ui 交了、at-backend 还没交——不齐。
  const withUi = { stage: 'S5', roster: ['at-product', 'at-ui', 'at-architect'] }
  assert.equal(run5(withUi, only('05-impl/at-ui.md'), { S2: ['at-ui'], S5: ['at-ui', 'at-backend'] }), false)
  const legacyS2 = { stage: 'S2', roster: [] }
  assert.equal(isStageDone({ stage: 'S2', stages: STAGES, artifactExists: only('01-prd.md'), roster: participantsOf(legacyS2, 'S2'), state: legacyS2, dispatched: { S2: ['at-product'] } }), false)
  const early = (s5) => ({ ...BASE, stage_roles: { ...BASE.stage_roles, S5: s5 } })
  const backendOnly = { S5: ['at-backend'] }
  for (const s5 of [[], ['at-architect']]) {
    const st = early(s5)
    assert.equal(isStageDone({ stage: 'S5', stages: STAGES, artifactExists: only5, roster: participantsOf(st, 'S5'), state: st, dispatched: backendOnly }), false, JSON.stringify(s5))
  }
})

test('isStageDone（docs/77）：这一段还没记账（stage_roles 没有这一段的数组）不并派发记录——协调者只派出一部分人时不提前判齐', () => {
  const unrecorded = { ...BASE, stage_roles: { S2: ['at-product'], S3: ['at-architect'] } }
  const base = { stage: 'S5', stages: STAGES, artifactExists: only('05-impl/at-backend.md'), roster: participantsOf(unrecorded, 'S5'), state: unrecorded }
  assert.equal(isStageDone({ ...base, dispatched: { S5: ['at-backend'] } }), false)
  const notArray = { ...BASE, stage_roles: { ...BASE.stage_roles, S5: 'at-backend' } }
  assert.equal(isStageDone({ ...base, roster: participantsOf(notArray, 'S5'), state: notArray, dispatched: { S5: ['at-backend'] } }), false)
})

// 派发记录：架构师在 S5 派出 at-backend 与 at-frontend，两个都停下了（放行）。
// running：没有停下行（还在跑）的角色。
function dispatchLog(roles, running = []) {
  const lines = []
  roles.forEach((role, i) => {
    const id = `a00000000000000${i}${role === 'at-frontend' ? 'f' : 'b'}`
    lines.push(dispatchLine({ at: '2026-10-11T10:00:00.000Z', agentId: id, toolUseId: null, role, stage: 'S5', caller: 'at-architect', callerId: ARCH_ID, mode: 'background' }))
    if (!running.includes(role)) lines.push(stopLine({ at: '2026-10-11T10:05:00.000Z', agentId: id, role, stage: 'S5', outcome: 'pass' }))
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
  // 复核（docs/77 §8，中 2）：它派出去了、还在跑（没有停下行）——同样不说齐了。
  const live = scene({ files: { 'dispatches.jsonl': dispatchLog(['at-backend', 'at-frontend'], ['at-frontend']) } })
  assert.ok(!live.ledger.includes('【阶段】S5 的产物已经齐了'), live.ledger)
  // 复核（docs/77 §8，中 1）：项目经理在段中途先单独记下 S5、只记了协调者——派出去的 at-backend 交了也不说齐了（at-frontend 可能还没派）。
  const early = scene({ state: { ...BASE, stage_roles: { ...BASE.stage_roles, S5: ['at-architect'] } }, files: { 'dispatches.jsonl': dispatchLog(['at-backend']) } })
  assert.ok(!early.ledger.includes('【阶段】S5 的产物已经齐了'), early.ledger)
})

test('【阶段】（docs/77）：它交了、或者叫到之后又裁掉（trimmed 记着 S5、已经停下）——说 S5 齐了，推进也放行', () => {
  const log = dispatchLog(['at-backend', 'at-frontend'])
  const done = scene({ files: { 'dispatches.jsonl': log, '05-impl/at-frontend.md': '# 实现记录\n' } })
  assert.ok(done.ledger.includes('【阶段】S5 的产物已经齐了'), done.ledger)
  assert.ok(!done.denied, done.reason)
  const trimmed = scene({ state: { ...BASE, trimmed: { 'at-frontend': 'S5' } }, files: { 'dispatches.jsonl': log } })
  assert.ok(trimmed.ledger.includes('【阶段】S5 的产物已经齐了'), trimmed.ledger)
  assert.ok(!trimmed.denied, trimmed.reason)
  // 复核（docs/77 §8，低 3）：同一段里它先有一次被中断（没有停下行）、重派的那一次停下了——按这个角色最近的一次认，不算还在跑。
  const again =
    dispatchLine({ at: '2026-10-11T09:00:00.000Z', agentId: 'a0000000000000f04', toolUseId: null, role: 'at-frontend', stage: 'S5', caller: 'at-architect', callerId: ARCH_ID, mode: 'background' }) +
    '\n' +
    log
  const redo = scene({ state: { ...BASE, trimmed: { 'at-frontend': 'S5' } }, files: { 'dispatches.jsonl': again } })
  assert.ok(redo.ledger.includes('【阶段】S5 的产物已经齐了'), redo.ledger)
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
      // 复核（docs/77 §8，中 2）：值后面直接收尾（`, dispatched: null` 接在后面、`&& null` 都算不对），键只出现一次（重复的键后一个生效）。
      assert.ok(/\bdispatched\s*:\s*dispatchedByStageOf\(ctx\)\s*(?:,|\})/.test(args), `${name}：dispatched 没传——${args.slice(0, 200)}`)
      assert.equal((args.match(/\bdispatched\s*:/g) || []).length, 1, `${name}：dispatched 写了不止一次——${args.slice(0, 200)}`)
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

// earlierFrontend：同一个协调者先派过一次 at-frontend、那一次被中断（没有停下行），再派的那一次照 frontendStops 停下。
function progress({ frontendStops, frontendFile = null, extraState = {}, stages = null, earlierFrontend = false }) {
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
    if (earlierFrontend) run('deliverable', post('agent-team:at-frontend', 'a00000000000000f4', { caller: ARCH, callerId: 'a00000000000000a5', toolUseId: 'toolu_01F4' }), gate, dirs.projectDir)
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

// 复核（docs/77 §8，低 1、低 2、低 3）。
test('进度（docs/77 §8）：空文件而且还是上一轮的不免；不随参与者变的固定产物不免；同一段里先有一次被中断、重派的那一次停下了照样免', () => {
  const blankStale = progress({ frontendStops: true, frontendFile: '', extraState: { rework_base: { '05-impl/at-frontend.md': sha256OfContract(Buffer.from('')) } } })
  assert.match(blankStale, /05-impl\/at-frontend\.md 是空文件——它停下时冒泡了/)
  const stages = JSON.parse(JSON.stringify(STAGES))
  stages.S5.produces = ['05-impl/<role>.md', '05-summary.md']
  const fixed = progress({ frontendStops: true, stages })
  assert.match(fixed, /at-frontend（后台派发）：05-impl\/at-frontend\.md 没交，trimmed 里记着它在 S5 裁掉了，这一份免了，05-summary\.md 还没有/)
  const redo = progress({ frontendStops: true, earlierFrontend: true })
  assert.match(redo, /at-frontend（后台派发）：05-impl\/at-frontend\.md 没交，trimmed 里记着它在 S5 裁掉了，这一份免了\n/)
})

// 第二轮复核（docs/77 §8，低 1）：进度那一行按这个协调者自己那一次派发判免不免——它派的那一次还在跑，别的协调者派的同一个角色停下了（还在跑按角色最近的
// 一次认，认的是那一次），这一行也不写免了、收尾不说都交了。
test('进度（docs/77 §8）：这个协调者派的那一次还在跑（或者最后一回被拦），别的协调者派的同一个角色冒泡停下了——这一行不写免了', () => {
  for (const f2Blocked of [false, true]) {
    const dirs = makeRun({
      runId: 'r1',
      stage: 'S5',
      artifacts: ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md'],
      roster: ['at-architect', 'at-backend', 'at-frontend'],
      stage_roles: { S3: ['at-architect'], S5: ['at-architect', 'at-backend', 'at-frontend'] },
      trimmed: { 'at-frontend': 'S5' },
    })
    try {
      const ARCH = 'agent-team:at-architect'
      run('deliverable', post(ARCH, 'a00000000000000a1', { toolUseId: 'toolu_01A1' }), GATE, dirs.projectDir)
      run('deliverable', post(ARCH, 'a00000000000000a2', { toolUseId: 'toolu_01A2' }), GATE, dirs.projectDir)
      run('deliverable', post('agent-team:at-frontend', 'a00000000000000f2', { caller: ARCH, callerId: 'a00000000000000a2', toolUseId: 'toolu_01F2' }), GATE, dirs.projectDir)
      if (f2Blocked) run('stop-gate', stopped('agent-team:at-frontend', 'a00000000000000f2', false, '写不了。'), GATE, dirs.projectDir)
      run('deliverable', post('agent-team:at-frontend', 'a00000000000000f1', { caller: ARCH, callerId: 'a00000000000000a1', toolUseId: 'toolu_01F1' }), GATE, dirs.projectDir)
      run('stop-gate', stopped('agent-team:at-frontend', 'a00000000000000f1', false, '写不了。'), GATE, dirs.projectDir)
      run('stop-gate', stopped('agent-team:at-frontend', 'a00000000000000f1', true, `${BUBBLE_MARK}缺组件库。`), GATE, dirs.projectDir)
      const r = run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000a2', 'toolu_01A2') }, GATE, dirs.projectDir)
      const c = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : ''
      assert.match(c, f2Blocked ? /at-frontend（后台派发）：05-impl\/at-frontend\.md 还没有——门禁最后一回拦了它/ : /at-frontend（后台派发）：05-impl\/at-frontend\.md 还没有——门禁还没见它停下：可能还在跑/)
      assert.ok(!c.includes('名单上的都交了'), c)
    } finally {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  }
})

// 第二轮复核（docs/77 §8，低 5）：一行里有一份在磁盘上、另一份免了，它停下时又冒泡了——在磁盘上的那一份可能只写了它卡在哪，照旧叫 PM 读它再定。
test('进度（docs/77 §8）：S2 里 at-ui 写了 02-ui-spec.md 又冒泡、裁掉之后 02-wireframe.html 免了——照旧说它停下时冒泡了、不说都交了', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md', '01-prd.md'], roster: ['at-product', 'at-ui'], stage_roles: {}, trimmed: { 'at-ui': 'S2' } })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    const PRODUCT = 'agent-team:at-product'
    run('deliverable', post(PRODUCT, 'a00000000000000c2', { toolUseId: 'toolu_01C2' }), GATE, dirs.projectDir)
    run('deliverable', post('agent-team:at-ui', 'a00000000000000d2', { caller: PRODUCT, callerId: 'a00000000000000c2', toolUseId: 'toolu_01D2' }), GATE, dirs.projectDir)
    writeFileSync(join(runDir, '02-ui-spec.md'), '卡住了：没有设计稿。\n')
    run('stop-gate', stopped('agent-team:at-ui', 'a00000000000000d2', false, '写不了。'), GATE, dirs.projectDir)
    run('stop-gate', stopped('agent-team:at-ui', 'a00000000000000d2', true, `${BUBBLE_MARK}没有设计稿。`), GATE, dirs.projectDir)
    const r = run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000c2', 'toolu_01C2') }, GATE, dirs.projectDir)
    const c = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : ''
    assert.match(c, /at-ui（后台派发）：02-ui-spec\.md 在磁盘上，02-wireframe\.html 没交，trimmed 里记着它在 S2 裁掉了，这一份免了——但它停下时冒泡了/)
    assert.ok(!c.includes('名单上的都交了'), c)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 复核（docs/77 §8，中 2）：交付物核验（前台派发的协调者跑完）与完成核验那两处调用的行为——S5 记了 [at-architect, at-backend]，架构师派出的 at-frontend
// 没记账、还在跑，at-backend 交了：两处都报进度，不说「停在旧阶段」、不沉默。
test('交付物核验与完成核验（docs/77 §8）：派了没记、还在跑的人让这一段不齐——协调者返回时报进度，不说停在旧阶段', () => {
  const ARCH = 'agent-team:at-architect'
  const each = (body) => {
    const dirs = makeRun({
      runId: 'r1',
      stage: 'S5',
      artifacts: ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md'],
      roster: ['at-architect', 'at-backend'],
      stage_roles: { S3: ['at-architect'], S5: ['at-architect', 'at-backend'] },
    })
    try {
      return body(dirs, join(dirs.projectDir, '.agent-team', 'runs', 'r1'))
    } finally {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  }
  const ctxOf = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '')
  // 架构师派出两个人：at-backend 写完、停下；at-frontend 还在跑。
  const work = (dirs, runDir, archId) => {
    run('deliverable', post('agent-team:at-backend', 'a00000000000000b7', { caller: ARCH, callerId: archId, toolUseId: 'toolu_01B7' }), GATE, dirs.projectDir)
    run('deliverable', post('agent-team:at-frontend', 'a00000000000000f7', { caller: ARCH, callerId: archId, toolUseId: 'toolu_01F7' }), GATE, dirs.projectDir)
    mkdirSync(join(runDir, '05-impl'), { recursive: true })
    writeFileSync(join(runDir, '05-impl', 'at-backend.md'), '# 实现记录\n')
    run('stop-gate', stopped('agent-team:at-backend', 'a00000000000000b7', false, '写好了。'), GATE, dirs.projectDir)
  }
  const bg = each((dirs, runDir) => {
    run('deliverable', post(ARCH, 'a00000000000000a7', { toolUseId: 'toolu_01A7' }), GATE, dirs.projectDir)
    work(dirs, runDir, 'a00000000000000a7')
    return ctxOf(run('completion', { hook_event_name: 'UserPromptSubmit', prompt: note('a00000000000000a7', 'toolu_01A7') }, GATE, dirs.projectDir))
  })
  assert.match(bg, /交付物核验（S5 进度）/)
  assert.match(bg, /at-frontend（后台派发）：05-impl\/at-frontend\.md 还没有——门禁还没见它停下：可能还在跑/)
  const fg = each((dirs, runDir) => {
    work(dirs, runDir, 'a00000000000000a8')
    const done = { status: 'completed', prompt: 'y', agentId: 'a00000000000000a8', agentType: ARCH, content: [{ type: 'text', text: '回报。' }], totalDurationMs: 1 }
    return ctxOf(run('deliverable', { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_01A8', tool_input: { subagent_type: ARCH, description: 'x', prompt: 'y' }, tool_response: done }, GATE, dirs.projectDir))
  })
  assert.match(fg, /交付物核验（S5 进度）/)
  assert.ok(!fg.includes('停在旧阶段'), fg)
})
