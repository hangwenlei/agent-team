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
import { ownerRecord, TAKEOVER_LABEL } from '../hooks/lib/owner.mjs'
import { dispatchLine } from '../hooks/lib/completion.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

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
  input.agent_type = who.agentType ?? (who.role ? 'agent-team:' + who.role : PM)
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

// 实测（docs/105 §8）：前台派发时派发记录还没记，子代理按会话认回派它的那一趟——照那一趟判写路径。
test('前台派发：派发记录里还没有它，会话 s-1 名下有 t1——照 t1 判（web/ 放行、api/ 拒）', () => {
  withProject(TWO(), (p) => {
    assert.equal(denied(write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'zz', sid: 's-1' })), false)
    assert.equal(denied(write(p, join(p, 'api', 'x.ts'), { role: 'at-frontend', agentId: 'zz', sid: 's-1' })), true)
  })
})

test('认不出是哪一趟派的团队角色（派发记录里没有、会话名下也没有微调）：开着微调时拒、叫它冒泡；项目里没有微调也没有 current-run 时照旧放行（自举不变）', () => {
  withProject(TWO(), (p) => {
    const out = write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'zz', sid: 's-9' })
    assert.equal(denied(out), true)
    assert.match(reasonOf(out), /冒泡：/)
    assert.match(reasonOf(out), /认不出/)
  })
  withProject({ runs: [] }, (p) => {
    assert.equal(denied(write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'zz', sid: 's-1' })), false)
  })
})

// 安全审查：只有微调、判 no-run 时，花名册外的调用者（别家插件的子代理）不许写 .agent-team/ 下的文件——微调的 state.json、契约都在那里；项目文件照旧能写。
test('只有微调、没有 current-run：花名册外的子代理写微调的 state.json、契约，H3 拒（契约 H4 也拒）；写项目文件照旧放行', () => {
  withProject(TWO(), (p) => {
    const other = { agentType: 'helper:writer', agentId: 'o1', sid: 's-1' }
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', 'state.json'), other)), true)
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', '00-contract.md'), other)), true)
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', '00-contract.md'), other, { check: 'contract' })), true, 'H4 同样拒')
    assert.equal(denied(write(p, join(p, 'web', 'x.ts'), other)), false)
  })
})

// 安全审查（第二轮）：运行上下文读得出时也一样——非项目经理写 .agent-team/runs/ 下不是这一趟的 run 目录（别的微调的契约、产物），H3 拒、契约 H4 也拒。
test('运行上下文读得出时：花名册外的子代理写别的一趟 run 目录里的契约与产物，H3 拒（契约 H4 也拒）；a1 写别的一趟的实现记录也拒', () => {
  const opts = TWO()
  opts.pointer = 'f1'
  opts.runs.push({ id: 'f1', mode: 'full', stage: 'S5', owner: 's-9' })
  withProject(opts, (p) => {
    const other = { agentType: 'helper:writer', agentId: 'o1', sid: 's-9' }
    for (const name of ['00-contract.md', '04-dispatch.md']) {
      assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', name), other)), true, name)
    }
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', '00-contract.md'), other, { check: 'contract' })), true, 'H4')
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't2', '05-impl', 'at-frontend.md'), { role: 'at-frontend', agentId: 'a1', sid: 's-1' })), true)
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', '05-impl', 'at-frontend.md'), { role: 'at-frontend', agentId: 'a1', sid: 's-1' })), false, '自己那一趟的实现记录照写')
  })
})

// 安全审查：开着微调时，团队角色的子代理只有在 current-run 那一趟的派发记录里确有它时才退回按指针判；不然认不出、拒，叫它冒泡。
test('current-run 指着一趟完整的 run、又开着微调：派发记录里哪儿都没有的团队角色拒；在 current-run 那一趟派发记录里的照它判', () => {
  const opts = TWO()
  opts.pointer = 'f1'
  opts.runs.push({ id: 'f1', mode: 'full', stage: 'S5', owner: 's-9', dispatches: [{ agent_id: 'af', role: 'at-frontend' }] })
  withProject(opts, (p) => {
    const out = write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'zz', sid: 's-8' })
    assert.equal(denied(out), true)
    assert.match(reasonOf(out), /冒泡：/)
    assert.equal(denied(write(p, join(p, 'web', 'x.ts'), { role: 'at-frontend', agentId: 'af', sid: 's-9' })), false)
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
    assert.match(out.stderr, /挑这一趟：hook 输入里读不到会话 id[^\n]*按 current-run 判/)
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

// ---------------------------------------------------------------------------------------------------------------------------------
// 互斥（hooks/lib/parallel.mjs 的 decideExclusion）：H6 在建 run 的那一次判。夹具照真实顺序：命令展开时记下的原话还挂着，项目经理直接 Write 新一趟的 state.json。
const pendingWords = (p, sid, command = 'at-tweak') =>
  writeFileSync(
    join(p, '.agent-team', 'user-words.json'),
    JSON.stringify({ version: 2, sessions: { [sid]: { at: AT, session_id: sid, args: '标题改大', source: 'command', command, runs_before: [], binding: null, bound: null, dropped: null } } }),
  )
const create = (p, id, mode, sid) =>
  run(
    'rework',
    { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: PM, session_id: sid, tool_input: { file_path: join(p, '.agent-team', 'runs', id, 'state.json'), content: JSON.stringify(stateOf(id, { mode, stage: 'S1' }), null, 2) } },
    GATE,
    p,
  )

test('互斥：current-run 指着一趟没收口的完整需求时建微调，H6 拒；指针不在、只有别的会话的微调开着时放行；同一个会话再建一趟，拒', () => {
  withProject({ pointer: 'f1', runs: [{ id: 'f1', mode: 'full', stage: 'S3', owner: 's-9' }] }, (p) => {
    pendingWords(p, 's-3')
    const out = create(p, 't3', 'tweak', 's-3')
    assert.equal(denied(out), true)
    assert.match(reasonOf(out), /互斥/)
    assert.match(reasonOf(out), /"f1"/)
  })
  withProject({ runs: [{ id: 't1', owner: 's-1' }] }, (p) => {
    pendingWords(p, 's-3')
    assert.equal(denied(create(p, 't3', 'tweak', 's-3')), false)
    pendingWords(p, 's-1')
    const again = create(p, 't4', 'tweak', 's-1')
    assert.equal(denied(again), true)
    assert.match(reasonOf(again), /"t1"/)
  })
})

test('互斥：有微调没收口时建完整的一趟，H6 拒，理由列出那一趟；它收口之后放行', () => {
  withProject({ runs: [{ id: 't1', owner: 's-1' }] }, (p) => {
    const out = create(p, 'f9', 'full', 's-3')
    assert.equal(denied(out), true)
    assert.match(reasonOf(out), /"t1"/)
    assert.match(reasonOf(out), /有微调开着/)
  })
  withProject({ runs: [{ id: 't1', owner: 's-1', extra: { closed_at: AT } }] }, (p) => {
    assert.equal(denied(create(p, 'f9', 'full', 's-3')), false)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 认领文件（hooks/lib/claims.mjs）：子代理第一次写一个项目文件，落盘之后账本记进它那一趟的 claims.jsonl；别的没收尾的微调再写它，H3 拒。
const TWO_S5 = (over = {}) => ({
  runs: [
    { id: 't1', owner: 's-1', dispatches: [{ agent_id: 'a1', role: 'at-frontend' }], ...(over.t1 ?? {}) },
    { id: 't2', owner: 's-2', dispatches: [{ agent_id: 'a2', role: 'at-frontend' }], ...(over.t2 ?? {}) },
  ],
})
const A1 = { role: 'at-frontend', agentId: 'a1', sid: 's-1' }
const A2 = { role: 'at-frontend', agentId: 'a2', sid: 's-2' }
// 一次真实的写入：H3 放行之后落盘，再跑账本。
const land = (p, file, who) => {
  const pre = write(p, file, who)
  if (denied(pre)) return pre
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, 'x')
  write(p, file, who, { check: 'ledger', event: 'PostToolUse' })
  return pre
}
const claimsOf = (p, id) => {
  try {
    return readFileSync(join(p, '.agent-team', 'runs', id, 'claims.jsonl'), 'utf8')
  } catch {
    return ''
  }
}

test('认领：a1 先写 web/a.ts，记进 t1 的认领（t2 的没有）；a2 再写它（含 web/./a.ts 的写法）拒、点名 t1、叫它冒泡；a2 写别的文件放行', () => {
  withProject(TWO_S5(), (p) => {
    assert.equal(denied(land(p, join(p, 'web', 'a.ts'), A1)), false)
    assert.match(claimsOf(p, 't1'), /a\.ts/)
    assert.equal(claimsOf(p, 't2'), '')
    for (const file of [join(p, 'web', 'a.ts'), p + '/web/./a.ts']) {
      const out = write(p, file, A2)
      assert.equal(denied(out), true, file)
      assert.match(reasonOf(out), /"t1"/)
      assert.match(reasonOf(out), /冒泡：/)
    }
    assert.equal(denied(land(p, join(p, 'web', 'b.ts'), A2)), false)
    assert.match(claimsOf(p, 't2'), /b\.ts/)
    assert.equal(denied(write(p, join(p, 'web', 'a.ts'), A1)), false, '自己认领的照写')
  })
})

test('认领：t1 收口之后 a2 写 web/a.ts 放行；项目经理（主线程）不受认领管；任何人 Write claims.jsonl 都拒', () => {
  withProject(TWO_S5(), (p) => {
    land(p, join(p, 'web', 'a.ts'), A1)
    assert.equal(denied(write(p, join(p, 'web', 'a.ts'), { sid: 's-2' })), false, '项目经理')
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', 'claims.jsonl'), { sid: 's-1' })), true, '门禁专属')
    const st = JSON.parse(readFileSync(join(p, '.agent-team', 'runs', 't1', 'state.json'), 'utf8'))
    writeFileSync(join(p, '.agent-team', 'runs', 't1', 'state.json'), JSON.stringify({ ...st, closed_at: AT }))
    assert.equal(denied(write(p, join(p, 'web', 'a.ts'), A2)), false)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 放弃收尾（hooks/lib/abandon.mjs）：用户在 AskUserQuestion 里选「放弃这一趟」（题面带 run id），门禁记下；之后一次写入记 closed_at 与 abandoned: true。
const writeState = (p, id, sid, state) =>
  run(
    'rework',
    { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: PM, session_id: sid, tool_input: { file_path: join(p, '.agent-team', 'runs', id, 'state.json'), content: JSON.stringify(state, null, 2) } },
    GATE,
    p,
  )
const askAbandon = (p, runId, sid, answer = '放弃这一趟') => {
  const questions = [{ question: `放弃 ${runId} 这一趟吗？改过的文件已经列在上面。`, header: '放弃', multiSelect: false, options: [{ label: '放弃这一趟', description: '' }, { label: '不放弃', description: '' }] }]
  return run(
    'approval-ask',
    { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', agent_type: PM, session_id: sid, tool_input: { questions }, tool_response: { questions, answers: { [questions[0].question]: answer } } },
    GATE,
    p,
  )
}
const approvalsOf = (p, id) => {
  try {
    return readFileSync(join(p, '.agent-team', 'runs', id, 'approvals.jsonl'), 'utf8')
  } catch {
    return ''
  }
}

test('放弃一趟微调：没批准写 abandoned 拒；s-1 选「放弃这一趟」记进 t1；之后停在 S5 也放弃得了；放弃之后建完整的一趟放行；s-2 选这个标签不记', () => {
  withProject({ runs: [{ id: 't1', owner: 's-1' }] }, (p) => {
    const abandoned = { ...stateOf('t1', { stage: 'S5' }), closed_at: AT, abandoned: true }
    const no = writeState(p, 't1', 's-1', abandoned)
    assert.equal(denied(no), true)
    assert.match(reasonOf(no), /放弃这一趟/)
    assert.equal(denied(askAbandon(p, 't1', 's-2')), false)
    assert.doesNotMatch(approvalsOf(p, 't1'), /abandon/, 's-2 的回答不记')
    const rec = askAbandon(p, 't1', 's-1')
    assert.match(ctxText(rec), /【放弃】/)
    assert.match(approvalsOf(p, 't1'), /"kind":"abandon"/)
    assert.equal(denied(writeState(p, 't1', 's-1', abandoned)), false, ctxText(rec))
    writeFileSync(join(p, '.agent-team', 'runs', 't1', 'state.json'), JSON.stringify(abandoned))
    assert.equal(denied(create(p, 'f9', 'full', 's-3')), false, '放弃了的微调不再挡完整的一趟')
  })
})

test('放弃一趟完整的需求：current-run 指着 s-1 的 f1（停在 S3），选「放弃这一趟」、写 abandoned 放行；之后 s-1 建微调放行', () => {
  withProject({ pointer: 'f1', runs: [{ id: 'f1', mode: 'full', stage: 'S3', owner: 's-1', history: H('S1', 'S2', 'S3') }] }, (p) => {
    askAbandon(p, 'f1', 's-1')
    assert.match(approvalsOf(p, 'f1'), /"kind":"abandon"/)
    const abandoned = { ...stateOf('f1', { mode: 'full', stage: 'S3', history: H('S1', 'S2', 'S3') }), closed_at: AT, abandoned: true }
    assert.equal(denied(writeState(p, 'f1', 's-1', abandoned)), false)
    writeFileSync(join(p, '.agent-team', 'runs', 'f1', 'state.json'), JSON.stringify(abandoned))
    pendingWords(p, 's-1')
    assert.equal(denied(create(p, 't3', 'tweak', 's-1')), false)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 命令展开时的【微调】（session-notice）与接手别的会话的微调（approval-ask 认「在这个会话接手」）。
const expand = (p, command, sid) =>
  run(
    'session-notice',
    { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'agent-team:' + command, command_args: '改个字', command_source: 'plugin', prompt: '/agent-team:' + command + ' 改个字', session_id: sid },
    GATE,
    p,
  )
const askTakeover = (p, runId, sid) => {
  const questions = [{ question: `原来那个会话已经关了，要在这个会话接手 ${runId} 吗？`, header: '接手', multiSelect: false, options: [{ label: TAKEOVER_LABEL, description: '' }, { label: '回那个会话', description: '' }] }]
  return run(
    'approval-ask',
    { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', agent_type: PM, session_id: sid, tool_input: { questions }, tool_response: { questions, answers: { [questions[0].question]: TAKEOVER_LABEL } } },
    GATE,
    p,
  )
}
const ownerOf = (p, id) => JSON.parse(readFileSync(join(p, '.agent-team', 'runs', id, 'owner.json'), 'utf8')).session_id

test('命令展开：t1（s-1）开着——s-2 的 /agent-team:at 收到【微调】与「有微调开着」；s-1 的 /agent-team:at-tweak 收到「先收尾」；s-3 的 /agent-team:at-resume 收到接手那条出路', () => {
  withProject({ runs: [{ id: 't1', owner: 's-1' }] }, (p) => {
    const at = ctxText(expand(p, 'at', 's-2'))
    assert.match(at, /【微调】/)
    assert.match(at, /"t1"/)
    assert.match(at, /有微调开着/)
    assert.match(ctxText(expand(p, 'at-tweak', 's-1')), /先收尾/)
    assert.match(ctxText(expand(p, 'at-resume', 's-3')), /在这个会话接手/)
  })
  withProject({ runs: [] }, (p) => assert.equal(ctxText(expand(p, 'at', 's-2')), '', '没有微调不出声'))
})

test('接手别的会话的微调：s-3 选「在这个会话接手」、题面带 t1——改归 s-3，之后 s-3 派人按 t1 判；名下已有 t2 的 s-2 接手 t1 不记', () => {
  withProject({ runs: [{ id: 't1', owner: 's-1' }, { id: 't2', owner: 's-2' }] }, (p) => {
    const no = askTakeover(p, 't1', 's-2')
    assert.match(ctxText(no), /一个会话同一时刻只做一趟/)
    assert.equal(ownerOf(p, 't1'), 's-1')
    const yes = askTakeover(p, 't1', 's-3')
    assert.match(ctxText(yes), /已记下/)
    assert.equal(ownerOf(p, 't1'), 's-3')
    assert.equal(denied(dispatch(p, 'at-frontend', 's-3')), false)
    assert.equal(denied(write(p, join(p, '.agent-team', 'runs', 't1', '04-dispatch.md'), { sid: 's-1' })), true, '原来的会话再写，拒')
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 一整趟并行：两个会话各起一趟微调（不写 current-run）、交替推进、认领冲突一次、一趟收口一趟放弃，之后另一个会话起完整的一趟。夹具照真实顺序：
// 命令展开记原话 → 每一次写入先过 H3、H4、H6，放行才落盘，再跑账本；派发过 H1、H2，启动那一刻 H5a 记派发。
test('一整趟并行：s-1 的 t1 与 s-2 的 t2 同时走到 S5，a2 撞上 t1 认领的文件被拒；t1 收口、t2 放弃；之后 s-3 起完整的一趟放行；current-run 一直没写', () => {
  withProject({ runs: [] }, (p) => {
    const steps = []
    const doWrite = (file, content, who) => {
      for (const check of ['writepath', 'contract', 'rework']) {
        const out = write(p, file, who, { check, content })
        if (denied(out)) return { denied: true, check, reason: reasonOf(out) }
      }
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, content)
      write(p, file, who, { check: 'ledger', event: 'PostToolUse', content })
      return { denied: false }
    }
    const must = (label, r) => {
      steps.push(label)
      assert.equal(r.denied, false, `${label}：${r.check} 拒了——${r.reason}`)
    }
    const dirOf = (id) => join(p, '.agent-team', 'runs', id)
    const ids = ['S1', 'S4', 'S5', 'S6', 'S8']
    const state = (id, stage, extra = {}) => JSON.stringify(stateOf(id, { stage, history: H(...ids.slice(0, ids.indexOf(stage) + 1)), extra }), null, 2)
    const contractOf = (words) => ['# 00 契约', '', '## 1. 用户原话', '', words, '', '## 2. PM 的理解（可改）', '', '- 网页版。', '', '## 4. 修订记录', ''].join(NL)
    const startTweak = (id, sid, words, agentId) => {
      run('user-words', { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'agent-team:at-tweak', command_args: words, command_source: 'plugin', prompt: '/agent-team:at-tweak ' + words, session_id: sid }, GATE, p)
      const pm = { sid }
      must(`${id} 建 run`, doWrite(join(dirOf(id), 'state.json'), state(id, 'S1'), pm))
      const contract = contractOf(words)
      must(`${id} 写契约`, doWrite(join(dirOf(id), '00-contract.md'), contract, pm))
      const sha = sha256OfContract(Buffer.from(contract))
      must(`${id} 推进到 S4`, doWrite(join(dirOf(id), 'state.json'), state(id, 'S4', { contract_sha: sha }), pm))
      must(`${id} 写派发`, doWrite(join(dirOf(id), '04-dispatch.md'), DOC('派发：at-frontend'), pm))
      must(`${id} 推进到 S5`, doWrite(join(dirOf(id), 'state.json'), state(id, 'S5', { contract_sha: sha }), pm))
      for (const check of ['delegation', 'readiness']) assert.equal(denied(dispatch(p, 'at-frontend', sid, check)), false, `${id} 派 at-frontend（${check}）`)
      run(
        'deliverable',
        { hook_event_name: 'PostToolUse', tool_name: 'Agent', agent_type: PM, session_id: sid, tool_input: { subagent_type: 'agent-team:at-frontend', description: 'x', prompt: 'x' }, tool_response: { isAsync: true, status: 'async_launched', agentId, description: 'x', prompt: 'x' } },
        GATE,
        p,
      )
      return sha
    }
    const sha1 = startTweak('t1', 's-1', '把首页标题改大', 'a1')
    startTweak('t2', 's-2', '把页脚文字改成灰色', 'a2')
    const A1w = { role: 'at-frontend', agentId: 'a1', sid: 's-1' }
    const A2w = { role: 'at-frontend', agentId: 'a2', sid: 's-2' }
    must('a1 改 web/a.ts', doWrite(join(p, 'web', 'a.ts'), 'a', A1w))
    const clash = doWrite(join(p, 'web', 'a.ts'), 'b', A2w)
    assert.equal(clash.denied, true, 'a2 撞上 t1 认领的文件')
    assert.match(clash.reason, /"t1"/)
    must('a2 改 web/b.ts', doWrite(join(p, 'web', 'b.ts'), 'b', A2w))
    must('a1 写实现记录', doWrite(join(dirOf('t1'), '05-impl', 'at-frontend.md'), DOC('实现记录') + NL + '## 测试' + NL + NL + '只改文案，没有新行为' + NL, A1w))
    must('a2 写实现记录', doWrite(join(dirOf('t2'), '05-impl', 'at-frontend.md'), DOC('实现记录') + NL + '## 测试' + NL + NL + '只改样式，没有新行为' + NL, A2w))
    // t1：「可以了，收尾」→ S6 → S8 → 收口
    const questions = [{ question: '改好了，刷新看看？', header: '这一轮', multiSelect: false, options: [{ label: '可以了，收尾', description: '' }, { label: '再改', description: '' }] }]
    run('approval-ask', { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', agent_type: PM, session_id: 's-1', tool_input: { questions }, tool_response: { questions, answers: { [questions[0].question]: '可以了，收尾' } } }, GATE, p)
    const booked = { contract_sha: sha1, stage_roles: { S5: ['at-frontend'] }, roster: ['at-frontend'] }
    const S1W = { sid: 's-1' }
    must('t1 推进到 S6', doWrite(join(dirOf('t1'), 'state.json'), state('t1', 'S6', booked), S1W))
    must('t1 写测试报告', doWrite(join(dirOf('t1'), '06-test.md'), '结论：通过' + NL + NL + 'npm test：通过' + NL, S1W))
    must('t1 推进到 S8', doWrite(join(dirOf('t1'), 'state.json'), state('t1', 'S8', booked), S1W))
    must('t1 写交付文档', doWrite(join(dirOf('t1'), '08-delivery.md'), DOC('交付'), S1W))
    must('t1 收口', doWrite(join(dirOf('t1'), 'state.json'), state('t1', 'S8', { ...booked, never_invoked: [], closed_at: new Date().toISOString() }), S1W))
    // t2：放弃
    askAbandon(p, 't2', 's-2')
    const t2now = JSON.parse(readFileSync(join(dirOf('t2'), 'state.json'), 'utf8'))
    must('t2 放弃', doWrite(join(dirOf('t2'), 'state.json'), JSON.stringify({ ...t2now, closed_at: new Date().toISOString(), abandoned: true }, null, 2), { sid: 's-2' }))
    assert.equal(existsSync(join(p, '.agent-team', 'current-run')), false, '微调不写 current-run')
    // 之后 s-3 起完整的一趟
    must('s-3 建完整的一趟', doWrite(join(dirOf('f9'), 'state.json'), JSON.stringify(stateOf('f9', { mode: 'full', stage: 'S1' }), null, 2), { sid: 's-3' }))
    assert.equal(ownerOf(p, 't1'), 's-1')
    assert.equal(ownerOf(p, 't2'), 's-2')
  })
})
