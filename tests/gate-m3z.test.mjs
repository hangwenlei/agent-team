// 第 16 条（M3z，docs/34）：门禁子进程级。纯函数在 tests/budget.test.mjs、tests/approvals.test.mjs、tests/redo.test.mjs、
// tests/rework-guard.test.mjs、tests/state.test.mjs、tests/ledger.test.mjs、tests/control-files.test.mjs；这里钉 hooks/gate.mjs
// 把它们接对了：
//   - 两个记录器真的读 hook 输入、真的写当前 run 的 approvals.jsonl，UserPromptSubmit 上一个字都不往 stdout 写；
//   - H3 拦门禁专属文件（PM、主线程、认不出的写法、别的项目）；
//   - H6 读同一个 run 目录的批准、第 4 轮整条走得通，拒绝理由带诊断；
//   - ledger 拍交付快照、出【返工预算】；H2、H3 拿快照判「交过」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, runAsync, hermeticEnv, GATE } from './helpers/gate-runner.mjs'
import { spawnSync } from 'node:child_process'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { approvalLabel } from '../hooks/lib/budget.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const INJECT = fileURLToPath(new URL('./helpers/inject-throw.cjs', import.meta.url))
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-01T00:00:00Z' }))
const FIRST6 = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']
const roundsOf = (n) => {
  const out = [...FIRST6]
  for (let i = 0; i < n; i++) out.push('S5', 'S6')
  return out
}
const PROJECT = {
  available_roles: ['at-product', 'at-architect', 'at-backend', 'at-frontend', 'at-qa', 'at-acceptance'],
  paths: { 'at-backend': ['src/server/'], 'at-frontend': ['src/web/'] },
}
const ROSTER = ['at-product', 'at-architect', 'at-backend', 'at-qa']
const sha = (text) => sha256OfContract(Buffer.from(text, 'utf8'))

// 一趟 run：state.json 照 ids（段名序列）写，stage 等于末条、rework 等于派生值；files 落盘；approvals 是 approvals.jsonl 的行。
function fixture({ ids, files = {}, approvals = null, extra = {}, roster = ROSTER } = {}) {
  const stage = ids[ids.length - 1]
  const dirs = makeRun({ runId: 'r1', stage, roster, project: PROJECT })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(runDir, rel)), { recursive: true })
    writeFileSync(join(runDir, rel), text, 'utf8')
  }
  const history = H(...ids)
  const state = {
    run_id: '20261001-0900-fixture',
    stage,
    contract_sha: 'PENDING',
    roster,
    artifacts: {},
    rework: reworkFromHistory(history),
    never_invoked: [],
    escalations: [],
    history,
    ...extra,
  }
  const statePath = join(runDir, 'state.json')
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
  if (approvals) writeFileSync(join(runDir, 'approvals.jsonl'), approvals.map((a) => JSON.stringify(a)).join('\n') + '\n', 'utf8')
  return {
    p: dirs.projectDir,
    runDir,
    statePath,
    state,
    approvalsPath: join(runDir, 'approvals.jsonl'),
    deliveredPath: join(runDir, 'delivered.json'),
    cleanup: () => {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    },
  }
}
function using(opts, body) {
  const fx = fixture(opts)
  try {
    return body(fx)
  } finally {
    fx.cleanup()
  }
}

const out = (r) => (r.stdout.trim() ? JSON.parse(r.stdout) : {})
const contextOf = (r) => out(r).hookSpecificOutput?.additionalContext ?? ''
const reasonOf = (r) => out(r).hookSpecificOutput?.permissionDecisionReason ?? ''
const denied = (r) => out(r).hookSpecificOutput?.permissionDecision === 'deny'
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

const asked = (answers, { multiSelect = false, extra = {}, agent = 'at-pm' } = {}) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion',
  ...(agent ? { agent_type: agent } : {}),
  tool_input: { questions: Object.keys(answers).map((q) => ({ question: q, header: 'h', multiSelect, options: [] })) },
  tool_response: { questions: Object.keys(answers).map((q) => ({ question: q, header: 'h', multiSelect, options: [] })), answers, ...extra },
})
const prompted = (prompt) => ({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt })
const writeState = (fx, after, agent = 'at-pm') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: agent,
  tool_input: { file_path: fx.statePath, content: JSON.stringify(after, null, 2) },
})
const postedState = (fx, agent = 'at-pm') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: agent, tool_input: { file_path: fx.statePath } })
const dispatch = (target, caller) => ({ hook_event_name: 'PreToolUse', tool_name: 'Agent', ...(caller ? { agent_type: caller } : {}), tool_input: { subagent_type: target, prompt: 'x' } })
const writeFile = (path, agent) => ({ hook_event_name: 'PreToolUse', tool_name: 'Write', ...(agent ? { agent_type: agent } : {}), tool_input: { file_path: path, content: 'x' } })
const stateOf = (ids, extra = {}) => {
  const history = H(...ids)
  return { run_id: '20261001-0900-fixture', stage: ids[ids.length - 1], contract_sha: 'PENDING', roster: ROSTER, artifacts: {}, rework: reworkFromHistory(history), never_invoked: [], escalations: [], history, ...extra }
}

const L5 = approvalLabel('S5')

// ============================================================================ approval-ask

test('approval-ask：第 4 轮、用户选了「再返工一轮：回到 S5」→ 记一行（covers S5、S6），回传说记下了，给用户一行', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const r = run('approval-ask', asked({ 'S5 已经返工 3 轮，再来一轮？': `${L5} (Recommended)` }), GATE, fx.p)
    assert.deepEqual(lines(fx.approvalsPath).map(({ source, rework_to, covers }) => ({ source, rework_to, covers })), [
      { source: 'ask', rework_to: 'S5', covers: ['S5', 'S6'] },
    ])
    assert.match(contextOf(r), /已记下返工批准：回到 S5（覆盖 S5、S6；这一趟共 1 条）/)
    assert.match(out(r).systemMessage, /^agent-team 返工批准：已记下/)
  })
})

test('approval-ask：一次两题都选了规范标签 → 只记一行', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const r = run('approval-ask', asked({ a: L5, b: L5 }), GATE, fx.p)
    assert.equal(lines(fx.approvalsPath).length, 1)
    assert.match(contextOf(r), /不需要/)
  })
})

test('approval-ask：上限内选了规范标签 → 不记，回传说不需要', () => {
  using({ ids: roundsOf(1) }, (fx) => {
    const r = run('approval-ask', asked({ q: L5 }), GATE, fx.p)
    assert.equal(existsSync(fx.approvalsPath), false)
    assert.match(contextOf(r), /没有记成返工批准：现在回到 S5 不需要批准/)
    assert.match(out(r).systemMessage, /没有记成批准/)
  })
})

test('approval-ask：离开键盘自动提交、要追问、另写了话、多选题 → 都不记，回传各说原因', () => {
  const cases = [
    [asked({ q: L5 }, { extra: { afkTimeoutMs: 60000 } }), /离开/],
    [asked({ q: L5 }, { extra: { followUp: true } }), /追问/],
    [asked({ q: L5 }, { extra: { response: '等等，先别继续' } }), /另写了一段话/],
    [asked({ q: L5 }, { multiSelect: true }), /多选/],
    [asked({ q: [L5] }), /多选/],
  ]
  for (const [input, re] of cases) {
    using({ ids: roundsOf(3) }, (fx) => {
      const r = run('approval-ask', input, GATE, fx.p)
      assert.equal(existsSync(fx.approvalsPath), false, String(re))
      assert.match(contextOf(r), re)
    })
  }
})

test('approval-ask：回答里没有像批准的 → 一个字都不写', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const r = run('approval-ask', asked({ q: '停在这里' }), GATE, fx.p)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '')
  })
})

test('approval-ask：模型在 tool_input 里预填的答案不算——只读 tool_response', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const input = asked({ q: '停在这里' })
    input.tool_input.answers = { q: L5 }
    run('approval-ask', input, GATE, fx.p)
    assert.equal(existsSync(fx.approvalsPath), false)
  })
})

test('approval-ask：读不到运行状态（current-run 指针丢了）→ 不记，回传带按原因的修法', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    rmSync(join(fx.p, '.agent-team', 'current-run'))
    const r = run('approval-ask', asked({ q: L5 }), GATE, fx.p)
    assert.equal(existsSync(fx.approvalsPath), false)
    assert.match(contextOf(r), /读不到这个项目的运行状态/)
    assert.match(contextOf(r), /current-run/)
  })
})

// ============================================================================ approval-prompt

test('approval-prompt：用户单独发一条整条只写标签 → 记一行（source prompt），stdout 一个字都不写', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const r = run('approval-prompt', prompted(` ${L5}\n`), GATE, fx.p)
    assert.equal(r.stdout, '')
    assert.equal(r.status, 0)
    assert.deepEqual(lines(fx.approvalsPath).map((l) => [l.source, l.rework_to]), [['prompt', 'S5']])
    assert.match(r.stderr, /已记下返工批准/)
  })
})

test('approval-prompt：带说明的话、task-notification、上限内 → 不记；stdout 一个字都不写', () => {
  for (const [ids, prompt] of [
    [roundsOf(3), `好的，${L5}`],
    [roundsOf(3), `<task-notification>\n<summary>${L5}</summary>\n</task-notification>`],
    [roundsOf(1), L5],
  ]) {
    using({ ids }, (fx) => {
      const r = run('approval-prompt', prompted(prompt), GATE, fx.p)
      assert.equal(r.stdout, '')
      assert.equal(existsSync(fx.approvalsPath), false, prompt)
    })
  }
})

test('approval-prompt：读不出输入、判定中途崩溃 → stdout 为空、exit 0、没有 BUG 行（出口契约照核）', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const bad = run('approval-prompt', 'not json', GATE, fx.p)
    assert.equal(bad.stdout, '')
    assert.equal(bad.status, 0)
    const crash = run('approval-prompt', prompted(L5), GATE, fx.p, { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: 'normalize' }, { nodeArgs: ['-r', INJECT] })
    assert.equal(crash.stdout, '')
    assert.equal(crash.status, 0)
    assert.match(crash.stderr, /injected: normalize/)
  })
})

test('approval-ask：判定中途崩溃 → 回传说「这次的回答没有记下」，不说放行', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const r = run('approval-ask', asked({ q: L5 }), GATE, fx.p, { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: 'normalize' }, { nodeArgs: ['-r', INJECT] })
    assert.match(contextOf(r), /^agent-team 账本回传：\n【门禁】这次的回答没有记下/)
    assert.doesNotMatch(out(r).systemMessage, /放行/)
  })
})

// ============================================================================ H3：门禁专属文件

test('H3：PM、主线程、执行角色写 approvals.jsonl / delivered.json 一律拒', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    for (const name of ['approvals.jsonl', 'delivered.json']) {
      for (const agent of ['at-pm', null, 'at-backend']) {
        const r = run('writepath', writeFile(join(fx.runDir, name), agent), GATE, fx.p)
        assert.ok(denied(r), `${name} ${agent}`)
        assert.match(reasonOf(r), /门禁自己/)
      }
    }
  })
})

test('H3：认不出的写法（流后缀、结尾带点、大写）在文件还不在时也拒——主线程也一样', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    for (const leaf of ['approvals.jsonl::$DATA', 'APPROVALS.JSONL', 'delivered.json.']) {
      const r = run('writepath', writeFile(join(fx.runDir, leaf), null), GATE, fx.p)
      assert.ok(denied(r), leaf)
    }
  })
})

test('H3：别的项目的 .agent-team/runs/<id>/approvals.jsonl 也拒；同名的业务文件不拦', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const other = join(fx.p, 'elsewhere', '.agent-team', 'runs', 'r9', 'approvals.jsonl')
    assert.ok(denied(run('writepath', writeFile(other, 'at-pm'), GATE, fx.p)))
    assert.equal(run('writepath', writeFile(join(fx.p, 'src', 'web', 'delivered.json'), 'at-frontend'), GATE, fx.p).stdout, '')
  })
})

// ============================================================================ H6：第 4 轮整条走通

test('H6 第 4 轮：先被拒（规范标签）→ 用户选了标签、门禁记下 → 原样重写放行 → 推进进 S6 放行', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    const fourth = stateOf([...roundsOf(3), 'S5'])
    const r1 = run('rework', writeState(fx, fourth), GATE, fx.p)
    assert.ok(denied(r1))
    assert.ok(reasonOf(r1).includes(L5), reasonOf(r1))
    assert.match(reasonOf(r1), /门禁这一趟记下的返工批准：0 条/)

    run('approval-ask', asked({ q: L5 }), GATE, fx.p)
    assert.equal(run('rework', writeState(fx, fourth), GATE, fx.p).stdout, '')
    writeFileSync(fx.statePath, JSON.stringify(fourth, null, 2))
    assert.equal(run('rework', writeState(fx, stateOf([...roundsOf(3), 'S5', 'S6'])), GATE, fx.p).stdout, '')
  })
})

test('H6 第 4 轮：对话里单独发一条标签也算（问不了用户的宿主）', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    run('approval-prompt', prompted(L5), GATE, fx.p)
    assert.equal(run('rework', writeState(fx, stateOf([...roundsOf(3), 'S5'])), GATE, fx.p).stdout, '')
  })
})

test('H6：PM 自己往 approvals.jsonl 里伪造的行，H3 写不进；Bash 写进去的照样认（登记的边界）', () => {
  using({ ids: roundsOf(3), approvals: [{ at: 't', source: 'ask', rework_to: 'S5', covers: ['S5', 'S6'] }] }, (fx) => {
    assert.equal(run('rework', writeState(fx, stateOf([...roundsOf(3), 'S5'])), GATE, fx.p).stdout, '')
  })
})

test('H6 诊断：这份 state.json 不在 current-run 指向的那一趟里 → 理由末尾说批准会记到别处', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    mkdirSync(join(fx.p, '.agent-team', 'runs', 'r2'), { recursive: true })
    writeFileSync(join(fx.p, '.agent-team', 'runs', 'r2', 'state.json'), JSON.stringify(stateOf(['S1'])))
    writeFileSync(join(fx.p, '.agent-team', 'current-run'), 'r2')
    const r = run('rework', writeState(fx, stateOf([...roundsOf(3), 'S5'])), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /不在 current-run 指向的那一趟 run 里/)
  })
})

test('H6：只改 stage、不记 history → 拒（子进程级）', () => {
  using({ ids: FIRST6 }, (fx) => {
    const r = run('rework', writeState(fx, { ...fx.state, stage: 'S5' }), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /history 的最后一条/)
  })
})

// ============================================================================ ledger：交付快照、【返工预算】

test('ledger：PM 写 state.json 之后拍交付快照——早于当前段的产物记 sha，当前段的不记；回退之后晚段的条目删掉', () => {
  const files = { '00-contract.md': 'c\n', '01-prd.md': 'p\n', '03-arch.md': 'a\n', '04-dispatch.md': 'd\n', '05-impl/at-backend.md': 'b\n', '06-test.md': 't\n' }
  using({ ids: FIRST6, files }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    const snap = JSON.parse(readFileSync(fx.deliveredPath, 'utf8')).products
    assert.equal(snap['05-impl/at-backend.md'], sha('b\n'))
    assert.equal(snap['00-contract.md'], sha('c\n'))
    assert.equal(Object.hasOwn(snap, '06-test.md'), false)
    // 回退到 S5（直接改磁盘模拟落盘）：S5 那份不再在快照里。
    writeFileSync(fx.statePath, JSON.stringify(stateOf([...FIRST6, 'S5'])))
    run('ledger', postedState(fx), GATE, fx.p)
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(fx.deliveredPath, 'utf8')).products, '05-impl/at-backend.md'), false)
  })
})

test('ledger：写的不是 state.json 时不动快照', () => {
  using({ ids: FIRST6, files: { '01-prd.md': 'p\n' } }, (fx) => {
    run('ledger', { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: join(fx.runDir, '01-prd.md') } }, GATE, fx.p)
    assert.equal(existsSync(fx.deliveredPath), false)
  })
})

test('ledger【返工预算】：第 4 轮记好之后批准记录丢了 → 写 state.json 时单列一块，给规范标签，不说「改完再继续」', () => {
  using({ ids: [...roundsOf(3), 'S5'] }, (fx) => {
    const r = run('ledger', postedState(fx), GATE, fx.p)
    assert.match(contextOf(r), /【返工预算】history 显示 S5 已经返工 4 轮，上限 3/)
    assert.ok(contextOf(r).includes(L5))
    assert.doesNotMatch(contextOf(r), /【state\.json】/)
  })
})

// ============================================================================ H2 / H3：不记回退就重派、重做

const IMPL = { '00-contract.md': 'c\n', '01-prd.md': 'p\n', '03-arch.md': 'a\n', '03-alignment.md': 'al\n', '04-dispatch.md': 'd\n', '05-impl/at-backend.md': 'b\n' }

test('H2 B2：S6 里架构师再派 at-backend——快照拍过（PM 推进时记过账）之后拒，之前放行', () => {
  using({ ids: FIRST6, files: IMPL }, (fx) => {
    assert.equal(run('readiness', dispatch('agent-team:at-backend', 'agent-team:at-architect'), GATE, fx.p).stdout, '', '还没有快照')
    run('ledger', postedState(fx), GATE, fx.p)
    const r = run('readiness', dispatch('agent-team:at-backend', 'agent-team:at-architect'), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /不记回退重做 S5/)
    assert.match(reasonOf(r), /冒泡给派你的人/)
  })
})

test('H2 L7：S7 里 PM 派 at-qa 补测——06-test.md 交过 → 拒，出路是先记一次回退（回到 S6）', () => {
  using({ ids: [...FIRST6, 'S7'], files: { ...IMPL, '06-test.md': 't\n' } }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    const r = run('readiness', dispatch('agent-team:at-qa', 'at-pm'), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /回到 S6/)
  })
})

test('H2：回退记过之后（stage 回到 S5）同一次派发放行', () => {
  using({ ids: [...FIRST6, 'S5'], files: IMPL }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    assert.equal(run('readiness', dispatch('agent-team:at-backend', 'agent-team:at-architect'), GATE, fx.p).stdout, '')
  })
})

test('H3 B4：S6 里 at-backend 改自己 S5 的实现记录——快照之后拒；补派（快照之后才落盘）写几次都放行', () => {
  using({ ids: FIRST6, files: IMPL }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    const r = run('writepath', writeFile(join(fx.runDir, '05-impl/at-backend.md'), 'agent-team:at-backend'), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /回到 S5/)
    // at-frontend 那份在快照里没有：补派。
    const fe = join(fx.runDir, '05-impl/at-frontend.md')
    assert.equal(run('writepath', writeFile(fe, 'agent-team:at-frontend'), GATE, fx.p).stdout, '')
    writeFileSync(fe, 'fe\n')
    assert.equal(run('writepath', writeFile(fe, 'agent-team:at-frontend'), GATE, fx.p).stdout, '', '第二次写')
  })
})

test('H3 L2：架构师在 S5 改 03-arch.md 放行（它在 S5 有活）；到了 S6 拒', () => {
  using({ ids: [...FIRST6.slice(0, 5)], files: IMPL }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    assert.equal(run('writepath', writeFile(join(fx.runDir, '03-arch.md'), 'agent-team:at-architect'), GATE, fx.p).stdout, '')
  })
  using({ ids: FIRST6, files: IMPL }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    assert.ok(denied(run('writepath', writeFile(join(fx.runDir, '03-arch.md'), 'agent-team:at-architect'), GATE, fx.p)))
  })
})

test('H3：PM 自己的早段产物（契约、04-dispatch.md）随时可写', () => {
  using({ ids: FIRST6, files: IMPL }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    assert.equal(run('writepath', writeFile(join(fx.runDir, '04-dispatch.md'), 'at-pm'), GATE, fx.p).stdout, '')
  })
})

// ============================================================================ 复核（docs/34 §3）

// platform-1：先拿字面末段筛一道，8.3 短名、末段是 `.` 的写法、指向它的链接都漏过去——主线程豁免就在后面。物理段名（norm 之后）
// 每一次都认一遍。
test('复核 H3：门禁专属文件的别名写法——末段 `.`、`x/..`、8.3 短名——主线程写也拒', () => {
  using({ ids: roundsOf(3) }, (fx) => {
    writeFileSync(fx.approvalsPath, '')
    const sep = process.platform === 'win32' ? String.fromCharCode(92) : '/'
    for (const p of [fx.approvalsPath + sep + '.', join(fx.approvalsPath, 'x', '..')]) {
      assert.ok(denied(run('writepath', writeFile(p, null), GATE, fx.p)), p)
    }
    if (process.platform === 'win32') {
      const dir = spawnSync('cmd', ['/c', 'dir', '/x', fx.runDir], { encoding: 'utf8' }).stdout ?? ''
      const m = /\s(\S+~\d+\.JSO)\s+approvals\.jsonl/i.exec(dir)
      if (m) assert.ok(denied(run('writepath', writeFile(join(fx.runDir, m[1]), null), GATE, fx.p)), m[1])
    }
  })
})

// platform-2：approvals.jsonl 末行没有换行（手改过、echo -n 写过）时，追加的一行会和它粘在一起，两条一起失效。
test('复核 approval-ask：已有的一行没有结尾换行时，追加之前先补换行——两条都算数', () => {
  const old = { at: 't', source: 'ask', rework_to: 'S5', covers: ['S5', 'S6'] }
  using({ ids: [...roundsOf(4)] }, (fx) => {
    writeFileSync(fx.approvalsPath, JSON.stringify(old))
    const r = run('approval-ask', asked({ q: L5 }), GATE, fx.p)
    assert.equal(lines(fx.approvalsPath).length, 2, readFileSync(fx.approvalsPath, 'utf8'))
    assert.match(contextOf(r), /这一趟共 2 条/)
  })
})

// platform-3：插件被加载了两份时，同一个批准事件上会并行起几个记录器——各自读到「还没有批准」、各记一条，额度凭空多出几轮。
test('复核 approval-prompt：同一个批准事件上并行起几个记录器，只记一条', async () => {
  const fx = fixture({ ids: roundsOf(3) })
  try {
    await Promise.all(Array.from({ length: 6 }, () => runAsync('approval-prompt', prompted(L5), { cwd: fx.p })))
    assert.equal(lines(fx.approvalsPath).length, 1, readFileSync(fx.approvalsPath, 'utf8'))
  } finally {
    fx.cleanup()
  }
})

// 复核（redo-4）：补派还在跑时 PM 写了一次 state.json（补记 stage_roles、记 escalation），stage 没变——快照不重拍，补派写几次都放行。
test('复核 ledger：stage 没变的 state.json 写入不重拍快照——补派的窗口直到下一次推进或回退才关', () => {
  using({ ids: FIRST6, files: IMPL }, (fx) => {
    run('ledger', postedState(fx), GATE, fx.p)
    const fe = join(fx.runDir, '05-impl/at-frontend.md')
    writeFileSync(fe, 'fe\n')
    writeFileSync(fx.statePath, JSON.stringify({ ...fx.state, stage_roles: { S5: ['at-architect', 'at-backend', 'at-frontend'] } }, null, 2))
    run('ledger', postedState(fx), GATE, fx.p)
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(fx.deliveredPath, 'utf8')).products, '05-impl/at-frontend.md'), false)
    assert.equal(run('writepath', writeFile(fe, 'agent-team:at-frontend'), GATE, fx.p).stdout, '')
    // 推进到 S7：重拍，补派那份进快照。
    writeFileSync(fx.statePath, JSON.stringify(stateOf([...FIRST6, 'S7']), null, 2))
    run('ledger', postedState(fx), GATE, fx.p)
    assert.equal(JSON.parse(readFileSync(fx.deliveredPath, 'utf8')).products['05-impl/at-frontend.md'], sha('fe\n'))
  })
})

// 复核（budget-2）：停在 DONE 的旧 run（v1.7.0 写进去的收口标记）、S5–S8 都满了三轮——回退到 S5 被预判拒、给标签；照标签问、门禁记下，
// 原样重写放行。此前记录器认不出这是回退（末条在链外），判「不需要」，死循环。
test('复核 H6：停在 DONE 的旧 run 满额时回退 → 拒、给标签 → 照标签批准、门禁记下 → 重写放行', () => {
  const full = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
  for (let i = 0; i < 3; i++) full.push('S5', 'S6', 'S7', 'S8')
  const ids = [...full, 'DONE']
  using({ ids }, (fx) => {
    const back = stateOf([...ids, 'S5'])
    const r1 = run('rework', writeState(fx, back), GATE, fx.p)
    assert.ok(denied(r1))
    assert.ok(reasonOf(r1).includes(L5), reasonOf(r1))
    run('approval-ask', asked({ q: L5 }), GATE, fx.p)
    assert.deepEqual(lines(fx.approvalsPath).map((l) => l.covers), [['S5', 'S6', 'S7', 'S8']])
    assert.equal(run('rework', writeState(fx, back), GATE, fx.p).stdout, '')
  })
})

// 复核（prose-2）：一次写入先推进、再回退（[..., S6, S5]）、越限——拒，叫它拆开写；照做：推进那一次放行，回退那一次给标签，
// 照标签批准之后重写放行。
test('复核 H6：先推进再回退写在一次里被拒 → 拆开写 → 回退那一次照标签批准 → 放行', () => {
  const base = [...roundsOf(2), 'S5']
  using({ ids: base }, (fx) => {
    const r1 = run('rework', writeState(fx, stateOf([...base, 'S6', 'S5'])), GATE, fx.p)
    assert.ok(denied(r1))
    assert.match(reasonOf(r1), /拆开写/)
    const forward = stateOf([...base, 'S6'])
    assert.equal(run('rework', writeState(fx, forward), GATE, fx.p).stdout, '')
    writeFileSync(fx.statePath, JSON.stringify(forward, null, 2))
    const back = stateOf([...base, 'S6', 'S5'])
    const r2 = run('rework', writeState(fx, back), GATE, fx.p)
    assert.ok(denied(r2))
    assert.ok(reasonOf(r2).includes(L5), reasonOf(r2))
    run('approval-ask', asked({ q: L5 }), GATE, fx.p)
    assert.equal(run('rework', writeState(fx, back), GATE, fx.p).stdout, '')
  })
})
