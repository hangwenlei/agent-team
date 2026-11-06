// 并行微调——门禁子进程那一层：按会话与 agent_id 认这一趟（hooks/lib/runpick.mjs）、互斥（hooks/lib/parallel.mjs）、认领文件（hooks/lib/claims.mjs）、
// 放弃收尾（hooks/lib/abandon.mjs）、命令展开时的【微调】与接手别的会话的微调。纯函数那一层在各自的 *.test.mjs。
// 夹具照真实会话：微调不写 current-run；每一趟 run 目录里放 state.json、门禁记的归属与原话记录、派发记录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { ownerRecord } from '../hooks/lib/owner.mjs'
import { dispatchLine } from '../hooks/lib/completion.mjs'

const NL = String.fromCharCode(10)
const PM = 'agent-team:at-pm'
const AT = '2026-11-06T10:00:00Z'
const H = (...ids) => ids.map((stage) => ({ stage, at: AT }))
const DOC = (title) => '# ' + title + NL + NL + '内容' + NL
const PROJECT = { paths: { 'at-frontend': ['web/'], 'at-backend': ['api/'] }, available_roles: ['at-frontend', 'at-backend'] }

const stateOf = (id, { mode = 'tweak', stage = 'S5', history = null, extra = {} } = {}) => {
  const hist = history ?? H(...({ S1: ['S1'], S4: ['S1', 'S4'], S5: ['S1', 'S4', 'S5'], S6: ['S1', 'S4', 'S5', 'S6'], S8: ['S1', 'S4', 'S5', 'S6', 'S8'] }[stage] ?? [stage]))
  return {
    run_id: id,
    ...(mode === null ? {} : { mode }),
    stage,
    contract_sha: 'PENDING',
    roster: [],
    stage_roles: {},
    trimmed: {},
    artifacts: {},
    rework: reworkFromHistory(hist),
    rework_base: {},
    never_invoked: [],
    escalations: [],
    closed_at: null,
    history: hist,
    ...extra,
  }
}

const wordsOf = (id, sid, command) =>
  JSON.stringify({ at: AT, session_id: sid, args: `改 ${id}`, source: 'command', command, runs_before: [], binding: null, bound: id, dropped: null, bound_at: AT })

/**
 * 造一个项目：runs 里每一趟 { id, mode = 'tweak', stage = 'S5', owner = 's-1', words = mode === 'tweak' ? 'at-tweak' : 'at', dispatches = [], files = {}, extra = {} }。
 * pointer：current-run 的内容（null 不写）。默认每一趟都带契约与派发（S5 的前置齐）。
 */
function makeProject({ pointer = null, runs = [] } = {}) {
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-par-')))
  const base = join(projectDir, '.agent-team')
  mkdirSync(join(base, 'runs'), { recursive: true })
  writeFileSync(join(base, 'project.json'), JSON.stringify(PROJECT))
  if (pointer !== null) writeFileSync(join(base, 'current-run'), pointer)
  for (const r of runs) {
    const { id, mode = 'tweak', stage = 'S5', owner = 's-1', dispatches = [], files = { '00-contract.md': DOC('契约'), '04-dispatch.md': DOC('派发') }, extra = {}, history = null } = r
    const words = Object.hasOwn(r, 'words') ? r.words : mode === 'tweak' ? 'at-tweak' : 'at'
    const dir = join(base, 'runs', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify(stateOf(id, { mode, stage, history, extra }), null, 2))
    if (owner) writeFileSync(join(dir, 'owner.json'), JSON.stringify(ownerRecord({ sessionId: owner, at: AT, via: 'create' })))
    if (words) writeFileSync(join(dir, 'user-words.json'), wordsOf(id, owner, words))
    if (dispatches.length) {
      writeFileSync(
        join(dir, 'dispatches.jsonl'),
        dispatches.map((d) => dispatchLine({ at: AT, agentId: d.agent_id, toolUseId: null, role: d.role, stage: d.stage ?? stage, caller: 'at-pm', callerId: null, mode: 'async' })).join(NL) + NL,
      )
    }
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), text)
    }
  }
  return projectDir
}

function withProject(opts, body) {
  const projectDir = makeProject(opts)
  try {
    return body(projectDir)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
}

const reasonOf = (out) => decisionOf(out.stdout)?.permissionDecisionReason ?? ''
const denied = (out) => decisionOf(out.stdout)?.permissionDecision === 'deny'
const ctxText = (out) => (out.stdout.trim() ? JSON.parse(out.stdout).hookSpecificOutput?.additionalContext ?? '' : '')

const dispatch = (projectDir, target, sid, check = 'readiness') =>
  run(
    check,
    { hook_event_name: 'PreToolUse', tool_name: 'Agent', agent_type: PM, session_id: sid, tool_input: { subagent_type: 'agent-team:' + target, description: 'x', prompt: 'x' } },
    GATE,
    projectDir,
  )

/** 写一个文件：who 是 { sid } 的项目经理（主线程）或 { role, agentId, sid } 的子代理；sid 为 null 时不带 session_id。 */
const write = (projectDir, file, who, { check = 'writepath', event = 'PreToolUse', content = 'x' } = {}) => {
  const input = { hook_event_name: event, tool_name: 'Write', tool_input: { file_path: file, content } }
  input.agent_type = who.role ? 'agent-team:' + who.role : PM
  if (who.agentId) input.agent_id = who.agentId
  if (who.sid !== null && who.sid !== undefined) input.session_id = who.sid
  return run(check, input, GATE, projectDir)
}

const TWO = () => ({
  runs: [
    { id: 't1', owner: 's-1', dispatches: [{ agent_id: 'a1', role: 'at-frontend' }] },
    { id: 't2', owner: 's-2', stage: 'S4', files: { '00-contract.md': DOC('契约') }, dispatches: [] },
  ],
})

test('两趟微调、没有 current-run：H2 按会话认这一趟——s-1 的 t1 有派发、派 at-frontend 放行；s-2 的 t2 停在 S4 没有派发、拒', () => {
  withProject(TWO(), (p) => {
    assert.equal(denied(dispatch(p, 'at-frontend', 's-1')), false)
    assert.equal(denied(dispatch(p, 'at-frontend', 's-1', 'delegation')), false, 'H1 按 t1 换了花名册')
    const out = dispatch(p, 'at-frontend', 's-2')
    assert.equal(denied(out), true)
    assert.match(reasonOf(out), /04-dispatch\.md|S4/)
  })
})

test('子代理按派发记录认回 t1：a1 写自己认领的 web/ 放行、写 api/ 拒（照 t1 判写路径隔离）', () => {
  withProject(TWO(), (p) => {
    assert.equal(denied(write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'a1', sid: 's-1' })), false)
    assert.equal(denied(write(p, join(p, 'api', 'x.ts'), { role: 'at-frontend', agentId: 'a1', sid: 's-1' })), true)
  })
})

test('认不出是哪一趟派的团队角色：开着微调时拒、叫它冒泡；项目里没有微调也没有 current-run 时照旧放行（自举不变）', () => {
  withProject(TWO(), (p) => {
    const out = write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'zz', sid: 's-1' })
    assert.equal(denied(out), true)
    assert.match(reasonOf(out), /冒泡：/)
    assert.match(reasonOf(out), /认不出/)
  })
  withProject({ runs: [] }, (p) => {
    assert.equal(denied(write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'zz', sid: 's-1' })), false)
  })
})

test('t1 收口之后，它派出去的 a1 照样认回 t1：写 api/ 照 t1 判、拒', () => {
  const opts = TWO()
  opts.runs[0].extra = { closed_at: AT }
  withProject(opts, (p) => {
    assert.equal(denied(write(p, join(p, 'api', 'x.ts'), { role: 'at-frontend', agentId: 'a1', sid: 's-1' })), true)
  })
})

test('主线程读不到会话 id：挑不出这一趟，照 current-run 判，stderr 留一行', () => {
  withProject(TWO(), (p) => {
    const out = write(p, join(p, '.agent-team', 'runs', 't1', '04-dispatch.md'), { sid: null })
    assert.equal(denied(out), false)
    assert.match(out.stderr, /读不到会话 id/)
    assert.match(out.stderr, /current-run/)
  })
})

test('s-1 的项目经理写 s-2 那一趟微调的契约：会话归属那一道拒', () => {
  withProject(TWO(), (p) => {
    const out = write(p, join(p, '.agent-team', 'runs', 't2', '00-contract.md'), { sid: 's-1' })
    assert.equal(denied(out), true)
    assert.match(reasonOf(out), /会话归属/)
  })
})

test('「可以了，收尾」记进这个会话名下的那一趟微调（不看 current-run）', () => {
  const opts = TWO()
  opts.pointer = 'f1'
  opts.runs.push({ id: 'f1', mode: 'full', stage: 'S5', owner: 's-9', extra: { closed_at: AT } })
  withProject(opts, (p) => {
    const questions = [{ question: '改好了，刷新看看？', header: '这一轮', multiSelect: false, options: [{ label: '可以了，收尾', description: '' }, { label: '再改', description: '' }] }]
    const out = run(
      'approval-ask',
      { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', agent_type: PM, session_id: 's-1', tool_input: { questions }, tool_response: { questions, answers: { [questions[0].question]: '可以了，收尾' } } },
      GATE,
      p,
    )
    assert.equal(out.status, 0, out.stderr)
    assert.match(readFileSync(join(p, '.agent-team', 'runs', 't1', 'approvals.jsonl'), 'utf8'), /tweak-done/)
    assert.equal(existsSync(join(p, '.agent-team', 'runs', 'f1', 'approvals.jsonl')), false)
  })
})

test('门禁源码里读运行上下文只有一处（runCtxFor）：每一次都先挑这一趟', () => {
  const src = readFileSync(new URL('../hooks/gate.mjs', import.meta.url), 'utf8')
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  const calls = code.split('readRunContext(').length - 1
  assert.equal(calls, 1, `gate.mjs 里 readRunContext( 出现 ${calls} 次`)
  assert.match(src, /function runCtxFor\([^)]*\)\s*\{[\s\S]{0,600}readRunContext\(/)
})
