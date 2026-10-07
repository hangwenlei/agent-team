// 第 20 条修法 A（docs/50，M4o）：门禁子进程这一层——
//   - 记录器（user-words，UserPromptExpansion）：/agent-team:at 展开时把参数记进项目一级的 .agent-team/user-words.json（连同这个会话的 id、
//     那一刻 runs/ 下已有的 run），一个字都不往 stdout 写、永不拒；.agent-team 不在不建；不带参数的命令清掉这个会话还挂着的那份；
//   - 绑定：只在这个会话用 Write 建出一趟新 run 的 state.json（第一段）的那一次（H6，写之前文件还不在）；账本不绑。记下之前就有的那一趟
//     没收口却被写了（续跑了它，不论它自己带没带记录），记录作废；绑过、作废的不再绑；
//   - 核：第一段里写契约时第 1 节对不上原话，【契约】当场说；第一段的产物齐了时【阶段】那一句补上；推进出第一段时 H6 拒；
//   - H3：两份记录都是门禁专属文件，任何人的 Edit/Write 都拒，理由说清它是什么。
// 复核（docs/50 §9）之后整份重写：原来账本在第一段里写 state.json、契约时也绑（晚绑会跨会话绑错、回退到第一段时与契约基线互相卡死），
// 续跑带记录的旧 run 不作废。纯函数那一层在 tests/user-words.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { USER_WORDS_FILE } from '../hooks/lib/user-words.mjs'

const NL = String.fromCharCode(10)
const NBSP = String.fromCharCode(0xa0)
const ARGS = '做一个待办应用：' + NL + '能加、能删  ' + NL + '## 安装' + NL + 'npm i'
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-07T10:00:00Z' }))
const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const contract = (section1) =>
  ['# 00 契约 —— 这趟 run 的需求基线', '', '## 1. 用户原话', '', ...section1, '', '## 2. PM 的理解（可改）', '', '- 网页版。', '', '## 4. 修订记录', ''].join(NL)
const VERBATIM = contract(ARGS.split(NL))
const QUOTED = contract(ARGS.split(NL).map((l) => '> ' + l))
const PARAPHRASED = contract(['做一个待办应用：能加、能删，用 npm 装。'])
const TALK = '对不上用户在 /agent-team:at 后面写的原话'
const count = (s, k) => s.split(k).length - 1

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
const pendingPath = (projectDir) => join(projectDir, '.agent-team', USER_WORDS_FILE)
const pendingOf = (projectDir) => JSON.parse(readFileSync(pendingPath(projectDir), 'utf8'))
const boundOf = (runDir) => JSON.parse(readFileSync(join(runDir, USER_WORDS_FILE), 'utf8'))
const point = (projectDir, id) => writeFileSync(join(projectDir, '.agent-team', 'current-run'), id)
const stateOf = (id, stage = 'S1', history = H('S1')) => ({ run_id: id, stage, contract_sha: 'PENDING', roster: [], artifacts: {}, rework: {}, never_invoked: [], escalations: [], history })
const stateWrite = (runDir, state, sid = 's-1') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: 'agent-team:at-pm',
  session_id: sid,
  tool_input: { file_path: join(runDir, 'state.json'), content: JSON.stringify(state, null, 2) },
})

function cleanup(dirs) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
}

// 建一趟新 run：目录、state.json（第一段）、指针。viaGate：照项目经理的做法用 Write 写 state.json，先经 H6（写之前文件不在——建出它的那一次）；
// 否则直接落盘（Bash 写的、门禁没见到建的那一次）。
function createRun(projectDir, id, { sid = 's-1', viaGate = true } = {}) {
  const dir = join(projectDir, '.agent-team', 'runs', id)
  mkdirSync(dir, { recursive: true })
  const state = stateOf(id)
  if (viaGate) {
    const d = decisionOf(run('rework', stateWrite(dir, state, sid), GATE, projectDir).stdout)
    assert.equal(d, null, '建 run 的那一次 H6 放行：' + JSON.stringify(d))
  }
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2))
  point(projectDir, id)
  return dir
}

// 项目里先没有 run；这个会话发 /agent-team:at（args），之后建 r1（creator 那个会话建的、经不经 H6）。stage 不是 S1 时，建好之后直接把它推到那一段。
function freshRun(body, { stage = 'S1', args = ARGS, sid = 's-1', creator = sid, viaGate = true } = {}) {
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
    run('user-words', expansion(args, { session_id: sid }), GATE, dirs.projectDir)
    const runDir = createRun(dirs.projectDir, 'r1', { sid: creator, viaGate })
    if (stage !== 'S1') {
      const ids = ['S1', 'S2', 'S3']
      const hist = H(...ids.slice(0, ids.indexOf(stage) + 1))
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ ...stateOf('r1', stage, hist), rework: reworkFromHistory(hist) }, null, 2))
    }
    return body({ ...dirs, runDir })
  } finally {
    cleanup(dirs)
  }
}

function advance(runDir, to, sid = 's-1') {
  const now = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'))
  const ids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
  const next = H(...ids.slice(0, ids.indexOf(to) + 1))
  return stateWrite(runDir, { ...now, stage: to, history: next, rework: reworkFromHistory(next) }, sid)
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

test('记录器：别的命令、不是斜杠命令、没有会话 id 都不记；项目里没有 .agent-team 时不建它', () => {
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
    assert.ok(!existsSync(pendingPath(dirs.projectDir)))
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

test('记录器（复核 docs/50 §9，门禁低 3）：不带参数的 /agent-team:at 清掉这个会话还挂着的那份；别的会话的那份不动', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S5' })
  try {
    run('user-words', expansion('再加一个导出功能'), GATE, dirs.projectDir)
    const r = run('user-words', expansion('', { prompt: '/agent-team:at' }), GATE, dirs.projectDir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.ok(!existsSync(pendingPath(dirs.projectDir)), '这个会话的那份清掉了')
    run('user-words', expansion('别的会话的需求', { session_id: 's-2' }), GATE, dirs.projectDir)
    run('user-words', expansion('  ', { prompt: '/agent-team:at' }), GATE, dirs.projectDir)
    assert.equal(pendingOf(dirs.projectDir).args, '别的会话的需求', '别的会话的那份不动')
  } finally {
    cleanup(dirs)
  }
})

test('绑定：这个会话用 Write 建出新的一趟（state.json 写之前不在）的那一次——记录绑进那一趟的 run 目录，项目一级那份标上 bound；照抄的、引用块的都不说', () => {
  freshRun(({ projectDir, runDir }) => {
    assert.equal(boundOf(runDir).args, ARGS)
    assert.equal(pendingOf(projectDir).bound, 'r1')
    writeFileSync(join(runDir, '00-contract.md'), VERBATIM)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c.includes(TALK) && !c.includes(USER_WORDS_FILE), c)
    writeFileSync(join(runDir, '00-contract.md'), QUOTED)
    const q = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!q.includes(TALK), q)
  })
})

test('核：第一段里写契约，第 1 节对不上原话——【契约】当场说第几行、两边各是什么、原话记在哪，改好之前推进不出第一段；只说一次', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes('【契约】') && c.includes(TALK), c)
    assert.ok(c.includes('第 1 节第 1 行') && c.includes('"做一个待办应用：能加、能删，用 npm 装。"') && c.includes(USER_WORDS_FILE), c)
    assert.ok(c.includes('推进不出 S1'), c)
    assert.equal(count(c, TALK), 1, '写契约那一次只说一次（【阶段】不再补同一句）：' + c)
  })
})

test('核：原话里的不换行空格、全角空格、零宽字符，契约里照抄成普通空格、去掉了——照样认（模型照抄不出它们）', () => {
  const ZW = String.fromCharCode(0x200b)
  const IDEO = String.fromCharCode(0x3000)
  freshRun(
    ({ projectDir, runDir }) => {
      writeFileSync(join(runDir, '00-contract.md'), contract(['输入格式：数字 运算符 数字（例如 3 + 4）。']))
      const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(!c.includes(TALK), c)
      assert.equal(decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout), null)
    },
    { args: `输入格式：数字${NBSP}运算符${NBSP}数字（例如${IDEO}3 + 4）。${ZW}` },
  )
})

test('不绑：别的会话建的这一趟；不经门禁建的（Bash 写的 state.json）；已经绑过（另起的第二趟）', () => {
  freshRun(
    ({ projectDir, runDir }) => {
      assert.ok(!existsSync(join(runDir, USER_WORDS_FILE)), '别的会话建的不绑')
      writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
      const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(!c.includes(TALK), c)
    },
    { creator: 's-2' },
  )
  freshRun(
    ({ projectDir, runDir }) => {
      assert.ok(!existsSync(join(runDir, USER_WORDS_FILE)), '门禁没见到建的那一次：不绑')
      writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
      run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir)
      assert.ok(!existsSync(join(runDir, USER_WORDS_FILE)), '账本不晚绑')
      assert.equal(decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout), null, 'H6 也不晚绑')
    },
    { viaGate: false },
  )
  freshRun(({ projectDir }) => {
    const r2 = createRun(projectDir, 'r2')
    assert.ok(!existsSync(join(r2, USER_WORDS_FILE)), '绑过的不再绑给第二趟')
  })
})

test('不绑（复核 docs/50 §9，门禁低 4）：别的会话在命令之后建了一趟，这个会话续跑它——不晚绑，推进出第一段不按这条命令核', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
    run('user-words', expansion('做一个记账本'), GATE, dirs.projectDir)
    const r2 = createRun(dirs.projectDir, 'r2', { sid: 's-2' })
    writeFileSync(join(r2, '00-contract.md'), contract(['别的会话的用户说的话']))
    run('ledger', posted(join(r2, 'state.json')), GATE, dirs.projectDir)
    run('ledger', posted(join(r2, '00-contract.md')), GATE, dirs.projectDir)
    assert.ok(!existsSync(join(r2, USER_WORDS_FILE)))
    assert.equal(decisionOf(run('rework', advance(r2, 'S2'), GATE, dirs.projectDir).stdout), null)
  } finally {
    cleanup(dirs)
  }
})

test('作废：记下之前就有、没收口的那一趟被写了（续跑了它）——记录作废，之后另起的一趟不绑；替它收口的那一次不作废', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S5', history: H('S1', 'S2', 'S3', 'S4', 'S5') })
  try {
    const r0 = join(dirs.projectDir, '.agent-team', 'runs', 'r0')
    run('user-words', expansion(), GATE, dirs.projectDir)
    run('ledger', posted(join(r0, 'state.json')), GATE, dirs.projectDir)
    assert.equal(pendingOf(dirs.projectDir).dropped, 'r0')
    const r1 = createRun(dirs.projectDir, 'r1')
    assert.ok(!existsSync(join(r1, USER_WORDS_FILE)))
    writeFileSync(join(r1, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(r1, '00-contract.md')), GATE, dirs.projectDir).stdout)
    assert.ok(!c.includes(TALK), c)
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
    const r1 = createRun(closed.projectDir, 'r1')
    writeFileSync(join(r1, '00-contract.md'), PARAPHRASED)
    const c = ctxOf(run('ledger', posted(join(r1, '00-contract.md')), GATE, closed.projectDir).stdout)
    assert.ok(c.includes(TALK), '替它收口之后另起的这一趟照常绑、照常核：' + c)
  } finally {
    cleanup(closed)
  }
})

test('作废（复核 docs/50 §9，中 1）：续跑的那一趟自己带着原话记录——项目一级那份照样作废，旧的那份原样留着，之后另起的一趟不绑', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S3', history: H('S1', 'S2', 'S3') })
  try {
    const r0 = join(dirs.projectDir, '.agent-team', 'runs', 'r0')
    writeFileSync(join(r0, USER_WORDS_FILE), JSON.stringify({ at: 't', session_id: 's-0', args: '需求 X', runs_before: [], bound: 'r0', dropped: null }))
    run('user-words', expansion('需求 Y'), GATE, dirs.projectDir)
    run('ledger', posted(join(r0, 'state.json')), GATE, dirs.projectDir)
    assert.equal(pendingOf(dirs.projectDir).dropped, 'r0', '续跑了带记录的旧 run：作废')
    assert.equal(boundOf(r0).args, '需求 X', '旧 run 自己那份原样留着')
    const r1 = createRun(dirs.projectDir, 'r1')
    writeFileSync(join(r1, '00-contract.md'), contract(['用户后来在对话里说的话']))
    const c = ctxOf(run('ledger', posted(join(r1, '00-contract.md')), GATE, dirs.projectDir).stdout)
    assert.ok(!c.includes(TALK), c)
    assert.ok(!existsSync(join(r1, USER_WORDS_FILE)), '作废的不绑给之后另起的一趟')
  } finally {
    cleanup(dirs)
  }
})

test('作废（复核 docs/50 §9，门禁 G23）：续跑一趟停在第一段、没有记录的旧 run——不按新命令核，记录作废', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S1', history: H('S1') })
  try {
    const r0 = join(dirs.projectDir, '.agent-team', 'runs', 'r0')
    run('user-words', expansion('需求 Y'), GATE, dirs.projectDir)
    writeFileSync(join(r0, '00-contract.md'), contract(['旧的那一趟的需求']))
    const c = ctxOf(run('ledger', posted(join(r0, '00-contract.md')), GATE, dirs.projectDir).stdout)
    assert.ok(!c.includes(TALK), c)
    assert.equal(pendingOf(dirs.projectDir).dropped, 'r0')
    assert.equal(decisionOf(run('rework', advance(r0, 'S2'), GATE, dirs.projectDir).stdout), null)
  } finally {
    cleanup(dirs)
  }
})

test('作废（复核 docs/50 §9，门禁 G3）：Windows 上指针写的 run id 与目录名大小写不同，照样认出是记下之前就有的那一趟', { skip: process.platform !== 'win32' }, () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S5', history: H('S1', 'S2', 'S3', 'S4', 'S5') })
  try {
    run('user-words', expansion(), GATE, dirs.projectDir)
    point(dirs.projectDir, 'R0')
    run('ledger', posted(join(dirs.projectDir, '.agent-team', 'runs', 'R0', 'state.json')), GATE, dirs.projectDir)
    assert.ok(pendingOf(dirs.projectDir).dropped?.toLowerCase() === 'r0', JSON.stringify(pendingOf(dirs.projectDir)))
  } finally {
    cleanup(dirs)
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
    const d = decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes(TALK) && d.permissionDecisionReason.includes(USER_WORDS_FILE) && d.permissionDecisionReason.includes('再推进'), d.permissionDecisionReason)
    writeFileSync(join(runDir, '00-contract.md'), VERBATIM)
    assert.equal(decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout), null)
  })
  const old = makeRun({ runId: 'r1', stage: 'S1', history: H('S1') })
  try {
    const runDir = join(old.projectDir, '.agent-team', 'runs', 'r1')
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    assert.equal(decisionOf(run('rework', advance(runDir, 'S2'), GATE, old.projectDir).stdout), null, '没有原话记录：不核')
  } finally {
    cleanup(old)
  }
})

test('H6（复核 docs/50 §9，门禁 G1）：第一段里不推进的写入（记 contract_sha）——第 1 节对不上也不拒，只在推进出去那一次拒', () => {
  freshRun(({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
    const now = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'))
    const sha = 'a'.repeat(64)
    assert.equal(decisionOf(run('rework', stateWrite(runDir, { ...now, contract_sha: sha }), GATE, projectDir).stdout), null)
  })
})

test('只在第一段核：走过第一段之后写契约不说原话这一句；推进出 S2 也不按它核（第 1 节的变化归契约基线管）', () => {
  freshRun(
    ({ projectDir, runDir }) => {
      assert.equal(boundOf(runDir).args, ARGS, '前置：建的那一次绑上了')
      writeFileSync(join(runDir, '00-contract.md'), PARAPHRASED)
      const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(!c.includes(TALK), c)
      writeFileSync(join(runDir, '01-prd.md'), 'prd' + NL)
      const d = decisionOf(run('rework', advance(runDir, 'S3'), GATE, projectDir).stdout)
      assert.ok(!d || !d.permissionDecisionReason.includes(TALK), d?.permissionDecisionReason)
    },
    { stage: 'S2' },
  )
})

test('H3：两份原话记录都是门禁专属文件——项目经理的 Write、Edit 一律拒，理由说清它是什么、出路是改第 1 节', () => {
  freshRun(({ projectDir, runDir }) => {
    for (const file of [pendingPath(projectDir), join(runDir, USER_WORDS_FILE)]) {
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
        // 复核（docs/50 §9，正文中 3）：原来落到「交付快照」那一句。
        assert.ok(d.permissionDecisionReason.includes('用户发出 /agent-team:at 时记下的原话') && !d.permissionDecisionReason.includes('交付快照'), d.permissionDecisionReason)
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
