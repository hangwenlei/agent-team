// 第 20 条修法 A（docs/50，M4o）：门禁子进程这一层——
//   - 记录器（user-words，UserPromptExpansion）：/agent-team:at 展开时把参数记进项目一级的 .agent-team/user-words.json（连同这个会话的 id、
//     那一刻 runs/ 下已有的 run），一个字都不往 stdout 写、永不拒；.agent-team 不在不建；
//   - 绑定：这个会话之后第一次在一趟新的 run（记下那一刻还没有它）的第一段里写 state.json 或契约，账本把记录绑进那一趟的 run 目录；
//     记下之前就有的那一趟没收口却被写了（续跑了它），记录作废；绑过、作废的不再绑；
//   - 核：第一段里写契约时第 1 节对不上原话，【契约】当场说；第一段的产物齐了时【阶段】那一句补上；推进出第一段时 H6 拒（H6 也会绑）；
//   - H3：两份记录都是门禁专属文件，任何人的 Edit/Write 都拒。
// 纯函数那一层在 tests/user-words.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { USER_WORDS_FILE } from '../hooks/lib/user-words.mjs'

const NL = String.fromCharCode(10)
const ARGS = '做一个待办应用：' + NL + '能加、能删  ' + NL + '## 安装' + NL + 'npm i'
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-07T10:00:00Z' }))
const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const contract = (section1) =>
  ['# 00 契约 —— 这趟 run 的需求基线', '', '## 1. 用户原话', '', ...section1, '', '## 2. PM 的理解（可改）', '', '- 网页版。', '', '## 4. 修订记录', ''].join(NL)
const VERBATIM = contract(ARGS.split(NL))
const QUOTED = contract(ARGS.split(NL).map((l) => '> ' + l))
const PARAPHRASED = contract(['做一个待办应用：能加、能删，用 npm 装。'])
const TALK = '对不上用户在 /agent-team:at 后面写的原话'

const expansion = (args = ARGS, over = {}) => ({
  hook_event_name: 'UserPromptExpansion',
  expansion_type: 'slash_command',
  command_name: 'agent-team:at',
  command_args: args,
  command_source: 'plugin',
  prompt: '/agent-team:at ' + args,
  session_id: 's-1',
  ...over,
})
const posted = (file, sid = 's-1') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', session_id: sid, tool_input: { file_path: file } })
const pendingOf = (projectDir) => JSON.parse(readFileSync(join(projectDir, '.agent-team', USER_WORDS_FILE), 'utf8'))
const boundOf = (runDir) => JSON.parse(readFileSync(join(runDir, USER_WORDS_FILE), 'utf8'))
const point = (projectDir, id) => writeFileSync(join(projectDir, '.agent-team', 'current-run'), id)

function cleanup(dirs) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
}

// 一趟在 /agent-team:at 之后才建的 run r1（停在 stage）：先把夹具建好的 r1 挪开、跑记录器、再挪回来——记录器那一刻 runs/ 下没有它。
function freshRun(body, { stage = 'S1', args = ARGS, sid = 's-1' } = {}) {
  const dirs = makeRun({ runId: 'r1', stage, history: H(...['S1', 'S2', 'S3'].slice(0, ['S1', 'S2', 'S3'].indexOf(stage) + 1)) })
  const at = join(dirs.projectDir, '.agent-team')
  const runDir = join(at, 'runs', 'r1')
  try {
    renameSync(runDir, join(at, 'r1-away'))
    const rec = run('user-words', expansion(args, { session_id: sid }), GATE, dirs.projectDir)
    renameSync(join(at, 'r1-away'), runDir)
    return body({ ...dirs, runDir, rec })
  } finally {
    cleanup(dirs)
  }
}

// 一趟新的 run：建 runs/<id>/state.json（第一段）并把指针指过去。
function newRun(projectDir, id) {
  const dir = join(projectDir, '.agent-team', 'runs', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ run_id: id, stage: 'S1', contract_sha: 'PENDING', roster: [], artifacts: {}, rework: {}, never_invoked: [], escalations: [], history: H('S1') }))
  point(projectDir, id)
  return dir
}

function advanceS1(runDir, sid = 's-1') {
  const statePath = join(runDir, 'state.json')
  const now = JSON.parse(readFileSync(statePath, 'utf8'))
  const next = H('S1', 'S2')
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    agent_type: 'agent-team:at-pm',
    session_id: sid,
    tool_input: { file_path: statePath, content: JSON.stringify({ ...now, stage: 'S2', history: next, rework: reworkFromHistory(next) }, null, 2) },
  }
}

test('记录器：/agent-team:at 展开时把参数、会话 id、那一刻 runs/ 下已有的 run 记进 .agent-team/user-words.json；stdout 一个字都不写；再来一次就换成新的', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S5' })
  try {
    const r = run('user-words', expansion(), GATE, dirs.projectDir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    const p = pendingOf(dirs.projectDir)
    assert.equal(p.args, ARGS)
    assert.equal(p.session_id, 's-1')
    assert.deepEqual(p.runs_before, ['r0'])
    assert.equal(p.bound, null)
    assert.equal(p.dropped, null)
    assert.ok(typeof p.at === 'string' && !Number.isNaN(Date.parse(p.at)), p.at)
    run('user-words', expansion('换一个需求', { session_id: 's-2' }), GATE, dirs.projectDir)
    assert.equal(pendingOf(dirs.projectDir).args, '换一个需求')
    assert.equal(pendingOf(dirs.projectDir).session_id, 's-2')
  } finally {
    cleanup(dirs)
  }
})

test('记录器：别的命令、空参数、不是斜杠命令、没有会话 id 都不记；项目里没有 .agent-team 时不建它', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S5' })
  try {
    for (const input of [
      expansion(ARGS, { command_name: 'agent-team:at-init' }),
      expansion(ARGS, { command_name: 'agent-team:at-resume' }),
      expansion('   '),
      expansion(ARGS, { expansion_type: 'mcp_prompt' }),
      expansion(ARGS, { session_id: undefined }),
    ]) {
      const r = run('user-words', input, GATE, dirs.projectDir)
      assert.equal(r.status, 0, r.stderr)
      assert.equal(r.stdout, '')
    }
    assert.ok(!existsSync(join(dirs.projectDir, '.agent-team', USER_WORDS_FILE)))
  } finally {
    cleanup(dirs)
  }
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-bare-')))
  try {
    const r = run('user-words', expansion(), GATE, bare)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!existsSync(join(bare, '.agent-team')), '不建 .agent-team')
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }
})

test('绑定：这个会话之后第一次在新的一趟（第一段）里写契约——记录绑进那一趟的 run 目录，项目一级那份标上 bound；照抄的、引用块的都不说', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), VERBATIM)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c.includes(TALK) && !c.includes(USER_WORDS_FILE), c)
    assert.equal(boundOf(runDir).args, ARGS)
    assert.equal(pendingOf(projectDir).bound, 'r1')
    writeFileSync(join(runDir, '00-contract.md'), QUOTED)
    const q = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!q.includes(TALK), q)
  })
})

test('核：第一段里写契约，第 1 节对不上原话——【契约】当场说第几行、两边各是什么、原话记在哪，改好之前推进不出第一段', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes('【契约】') && c.includes(TALK), c)
    assert.ok(c.includes('第 1 节第 1 行') && c.includes('"做一个待办应用：能加、能删，用 npm 装。"') && c.includes(USER_WORDS_FILE), c)
    assert.ok(c.includes('推进不出 S1'), c)
  })
})

test('不绑：别的会话；记下之前就有的那一趟；已经绑过（另起的第二趟）', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md'), 's-2'), GATE, projectDir).stdout)
    assert.ok(!c.includes(TALK), c)
    assert.ok(!existsSync(join(runDir, USER_WORDS_FILE)), '别的会话不绑')
  })
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), VERBATIM)
    run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir)
    const r2 = newRun(projectDir, 'r2')
    writeFileSync(join(r2, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c.includes(TALK), c)
    assert.ok(!existsSync(join(r2, USER_WORDS_FILE)), '绑过的不再绑给第二趟')
  })
})

test('作废：记下之前就有、没收口的那一趟被写了（续跑了它）——记录作废，之后另起的一趟不绑；替它收口的那一次不作废', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S5', history: H('S1', 'S2', 'S3', 'S4', 'S5') })
  try {
    const r0 = join(dirs.projectDir, '.agent-team', 'runs', 'r0')
    run('user-words', expansion(), GATE, dirs.projectDir)
    run('ledger', posted(join(r0, 'state.json')), GATE, dirs.projectDir)
    assert.equal(pendingOf(dirs.projectDir).dropped, 'r0')
    const r1 = newRun(dirs.projectDir, 'r1')
    writeFileSync(join(r1, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(r1, '00-contract.md')), GATE, dirs.projectDir).stdout)
    assert.ok(!c.includes(TALK), c)
    assert.ok(!existsSync(join(r1, USER_WORDS_FILE)))
  } finally {
    cleanup(dirs)
  }
  const closed = makeRun({ runId: 'r0', stage: 'S8', history: H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8') })
  try {
    const r0 = join(closed.projectDir, '.agent-team', 'runs', 'r0')
    run('user-words', expansion(), GATE, closed.projectDir)
    const st = JSON.parse(readFileSync(join(r0, 'state.json'), 'utf8'))
    writeFileSync(join(r0, 'state.json'), JSON.stringify({ ...st, closed_at: '2026-10-07T10:30:00Z' }))
    run('ledger', posted(join(r0, 'state.json')), GATE, closed.projectDir)
    assert.equal(pendingOf(closed.projectDir).dropped, null, '收口那一次不作废')
    const r1 = newRun(closed.projectDir, 'r1')
    writeFileSync(join(r1, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(r1, '00-contract.md')), GATE, closed.projectDir).stdout)
    assert.ok(c.includes(TALK), '替它收口之后另起的这一趟照常绑、照常核：' + c)
  } finally {
    cleanup(closed)
  }
})

test('【阶段】：第一段的产物齐了、第 1 节对不上原话——「齐了」那一句补上推进出第一段会被拒；照抄的不补', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(c.includes('【阶段】S1 的产物已经齐了') && c.includes(TALK) && c.includes('推进出 S1'), c)
    writeFileSync(join(runDir, '00-contract.md'), VERBATIM)
    const ok = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(ok.includes('【阶段】S1 的产物已经齐了') && !ok.includes(TALK), ok)
  })
})

test('H6：推进出第一段时第 1 节对不上绑着的原话——拒；改成照抄之后放行；没有记录的（更早建的 run）照常放行', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir)
    const d = decisionOf(run('rework', advanceS1(runDir), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes(TALK) && d.permissionDecisionReason.includes(USER_WORDS_FILE) && d.permissionDecisionReason.includes('再推进'), d.permissionDecisionReason)
    writeFileSync(join(runDir, '00-contract.md'), VERBATIM)
    assert.equal(decisionOf(run('rework', advanceS1(runDir), GATE, projectDir).stdout), null)
  })
  const old = makeRun({ runId: 'r1', stage: 'S1', history: H('S1') })
  try {
    const runDir = join(old.projectDir, '.agent-team', 'runs', 'r1')
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    assert.equal(decisionOf(run('rework', advanceS1(runDir), GATE, old.projectDir).stdout), null, '没有原话记录：不核')
  } finally {
    cleanup(old)
  }
})

test('H6：契约不经账本写成（没绑上）——推进出第一段那一次 H6 自己绑、照样核；别的会话推进不绑、不核', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    const other = decisionOf(run('rework', advanceS1(runDir, 's-2'), GATE, projectDir).stdout)
    assert.equal(other, null, '别的会话：不绑、不核')
    assert.ok(!existsSync(join(runDir, USER_WORDS_FILE)))
    const d = decisionOf(run('rework', advanceS1(runDir), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.equal(boundOf(runDir).args, ARGS)
  })
})

test('只在第一段核：走过第一段之后写契约不说原话这一句、也不绑；已经绑着原话的，账本与 H6（推进出 S2）也不按它核（第 1 节的变化归契约基线管）', () => {
  freshRun(
    ({ projectDir, runDir }) => {
      writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
      const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(!c.includes(TALK), c)
      assert.ok(!existsSync(join(runDir, USER_WORDS_FILE)), '走过第一段的不绑')
      writeFileSync(join(runDir, USER_WORDS_FILE), JSON.stringify({ at: 't', session_id: 's-1', args: ARGS, runs_before: [], bound: 'r1', dropped: null }))
      const again = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(!again.includes(TALK), again)
      const statePath = join(runDir, 'state.json')
      const now = JSON.parse(readFileSync(statePath, 'utf8'))
      const next = H('S1', 'S2', 'S3')
      const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', session_id: 's-1', tool_input: { file_path: statePath, content: JSON.stringify({ ...now, stage: 'S3', history: next, rework: reworkFromHistory(next) }) } }
      writeFileSync(join(runDir, '01-prd.md'), 'prd' + NL)
      const d = decisionOf(run('rework', input, GATE, projectDir).stdout)
      assert.ok(!d || !d.permissionDecisionReason.includes(TALK), d?.permissionDecisionReason)
    },
    { stage: 'S2' },
  )
})

test('H3：两份原话记录都是门禁专属文件——项目经理的 Write、Edit 一律拒', () => {
  freshRun(({ projectDir, runDir }) => {
    for (const file of [join(projectDir, '.agent-team', USER_WORDS_FILE), join(runDir, USER_WORDS_FILE)]) {
      for (const tool of ['Write', 'Edit']) {
        const input = {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          agent_type: 'agent-team:at-pm',
          session_id: 's-1',
          tool_input: tool === 'Write' ? { file_path: file, content: '{}' } : { file_path: file, old_string: 'a', new_string: 'b' },
        }
        const d = decisionOf(run('writepath', input, GATE, projectDir).stdout)
        assert.equal(d?.permissionDecision, 'deny', `${tool} ${file}`)
      }
    }
  })
})

test('记录器：读不出这次的 hook 输入——不拦、stdout 不写，stderr 说原话没有记下（不说「回答」）', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S5' })
  try {
    for (const bad of ['not json', '[1]', 'null']) {
      const r = run('user-words', bad, GATE, dirs.projectDir)
      assert.equal(r.status, 0, r.stderr)
      assert.equal(r.stdout, '')
      assert.ok(r.stderr.includes('这次的原话没有记下') && !r.stderr.includes('回答'), r.stderr)
    }
  } finally {
    cleanup(dirs)
  }
})
