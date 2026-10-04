// M4a（docs/35）：收口标记与返工轮的 accepted——门禁子进程级。
//
// 两件事，都在常用路径上，都是 1.7.0/1.8.0 带出来的副作用（2026-10-01 那次「还开着的条目」核验新发现）：
//   B. 返工轮里门禁自己把「把上一轮的 06-test.md 标 accepted」列成出路：标了之后 at-qa 不重测就停下，没测过的改动进了验收。
//      验证段（stages.json 的 "verifies": true）的产物在返工轮里一律重新出：H6 拒标，每一处给出「标 accepted」的回传都不再给它。
//   A. 交付之后在同一会话里接着要求改动：门禁把它当成旧 run 的重做，只给「记回退」。加收口标记 closed_at（见下半部分）。
// 纯函数在 tests/stages.test.mjs、tests/rework-base.test.mjs、tests/closing.test.mjs；这里钉 hooks/gate.mjs 把它们接对了。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { run, hermeticEnv, GATE } from './helpers/gate-runner.mjs'
import { fileURLToPath } from 'node:url'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'

const sha = (text) => sha256OfContract(Buffer.from(text, 'utf8'))
const H = (...stages) => stages.map((stage) => ({ stage, at: '2026-10-01T00:00:00Z' }))
const FIRST = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6')
const PROJECT = {
  available_roles: ['at-product', 'at-ui', 'at-architect', 'at-backend', 'at-qa', 'at-acceptance'],
  paths: { 'at-backend': ['src/server/'] },
}
const ROSTER = ['at-product', 'at-architect', 'at-backend', 'at-qa']
const R1 = {
  '00-contract.md': 'contract\n',
  '01-prd.md': 'prd r1\n',
  '02-ui-spec.md': 'ui spec r1\n',
  '02-wireframe.html': '<p>wire r1</p>\n',
  '03-arch.md': 'arch r1\n',
  '03-alignment.md': 'align r1\n',
  '04-dispatch.md': 'dispatch r1\n',
  '05-impl/at-backend.md': 'backend r1\n',
  '06-test.md': 'test r1\n',
}
const baseOf = (...names) => Object.fromEntries(names.map((n) => [n, sha(R1[n])]))

function fixture({ stage, history, reworkBase, files = R1, roster = ROSTER, extra = {} }) {
  const dirs = makeRun({ runId: 'r1', stage, roster, project: PROJECT })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(runDir, rel)), { recursive: true })
    writeFileSync(join(runDir, rel), text, 'utf8')
  }
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
    ...(reworkBase === undefined ? {} : { rework_base: reworkBase }),
    ...extra,
  }
  const statePath = join(runDir, 'state.json')
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
  const cleanup = () => {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
  return { p: dirs.projectDir, runDir, statePath, state, cleanup }
}
function using(opts, body) {
  const fx = fixture(opts)
  try {
    return body(fx)
  } finally {
    fx.cleanup()
  }
}

const as = (agent) => (agent ? { agent_type: agent } : {})
const dispatch = (target, caller) => ({ hook_event_name: 'PreToolUse', tool_name: 'Agent', ...as(caller), tool_input: { subagent_type: target, prompt: 'x' } })
const returned = (target, caller) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  ...as(caller),
  tool_input: { subagent_type: target, prompt: 'x' },
  tool_response: { isAsync: true, status: 'async_launched' },
})
const stopped = (agent) => ({ hook_event_name: 'SubagentStop', agent_type: agent })
const writeState = (fx, after, agent = 'at-pm') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: agent,
  tool_input: { file_path: fx.statePath, content: JSON.stringify(after, null, 2) },
})
const postedState = (fx) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: fx.statePath } })

const reasonOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecisionReason ?? '' : '')
const contextOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const denied = (r) => r.stdout.trim() !== '' && JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny'

// ============================================================================ B：验证段的产物不给「标 accepted」

// 问题 B 的原样状态：S6 测试不过回到 S5，后端这一轮重写过（磁盘 r2），推进到 S6；06-test.md 还是上一轮的。
const B = {
  stage: 'S6',
  history: [...FIRST, ...H('S5', 'S6')],
  reworkBase: baseOf('05-impl/at-backend.md', '06-test.md'),
  files: { ...R1, '05-impl/at-backend.md': 'backend r2\n' },
}
// 给出「标 accepted」这条路的说法（PM 那一侧「改成 "accepted"」，执行角色那一侧「由项目经理标 "accepted"」）。验证段那一句自己写着
// 「不能标 "accepted"」，不算。
const NO_ACCEPT = /改成 "accepted"|由项目经理标 "accepted"/

test('M4a B：PM 异步派 at-qa 那一刻（H5a）——06-test.md 还旧，回传只给「重跑之后重写」，不给标 accepted', () => {
  using(B, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-qa'), GATE, fx.p))
    assert.match(c, /06-test\.md/)
    assert.match(c, /重跑之后重写/)
    assert.doesNotMatch(c, NO_ACCEPT)
  })
})

test('M4a B：at-qa 不重测就停下（H5b）——拒，理由要它重跑之后重写，不给「追加一节说不用改」这条路', () => {
  using(B, (fx) => {
    const r = run('stop-gate', stopped('agent-team:at-qa'), GATE, fx.p)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /06-test\.md/)
    assert.match(r.stderr, /重跑之后重写/)
    assert.doesNotMatch(r.stderr, /确实不用改/)
  })
})

test('M4a B：PM 派 at-acceptance（H2）——前置 06-test.md 还旧，拒，理由只给「重跑之后重写」', () => {
  using(B, (fx) => {
    const r = run('readiness', dispatch('agent-team:at-acceptance'), GATE, fx.p)
    assert.ok(denied(r))
    const reason = reasonOf(r)
    assert.match(reason, /06-test\.md/)
    assert.match(reason, /重跑之后重写/)
    assert.doesNotMatch(reason, NO_ACCEPT)
  })
})

test('M4a B：PM 写 state.json（【返工】）——当前段的 06-test.md 还旧，出路只给「重跑之后重写」', () => {
  using(B, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.match(c, /【返工】/)
    assert.match(c, /06-test\.md/)
    assert.match(c, /重跑之后重写/)
    assert.doesNotMatch(c, NO_ACCEPT)
  })
})

test('M4a B：S6→S7 推进（H6）——拒，理由只给「重跑之后重写」', () => {
  using(B, (fx) => {
    const after = { ...fx.state, stage: 'S7', history: [...B.history, ...H('S7')], rework: reworkFromHistory([...B.history, ...H('S7')]) }
    const r = run('rework', writeState(fx, after), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /重跑之后重写/)
    assert.doesNotMatch(reasonOf(r), NO_ACCEPT)
  })
})

test('M4a B：PM 照旧把 06-test.md 标 accepted（H6）——拒，点名验证段', () => {
  using(B, (fx) => {
    const after = { ...fx.state, rework_base: { ...B.reworkBase, '06-test.md': 'accepted' } }
    const r = run('rework', writeState(fx, after), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /验证段/)
  })
})

// 正面锚：还旧的是非验证段的产物（回到 S5、实现记录还旧）时，同几个出口照旧给「标 accepted」——上面的 doesNotMatch 不是因为
// 这几个出口本来就不提 accepted。
test('M4a B 锚：回到 S5、实现记录还旧时，【返工】与 H5a 照旧给「标 accepted」', () => {
  using({ stage: 'S5', history: [...FIRST, ...H('S5')], reworkBase: baseOf('05-impl/at-backend.md', '06-test.md') }, (fx) => {
    assert.match(contextOf(run('ledger', postedState(fx), GATE, fx.p)), NO_ACCEPT)
    assert.match(contextOf(run('deliverable', returned('agent-team:at-backend'), GATE, fx.p)), NO_ACCEPT)
  })
})

// ============================================================================ A：收口标记 closed_at

const FULL = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8')
const DONE_FILES = { ...R1, '07-acceptance.md': 'acc r1\n', '08-delivery.md': 'delivery r1\n' }
const CLOSED_AT = '2026-10-01T15:00:00Z'
const AT_S8 = { stage: 'S8', history: FULL, files: DONE_FILES, roster: [...ROSTER, 'at-acceptance'] }
const AT_S8_CLOSED = { ...AT_S8, extra: { closed_at: CLOSED_AT } }
const L5 = '再返工一轮：回到 S5'
const asked = (answers) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion',
  agent_type: 'at-pm',
  tool_input: { questions: Object.keys(answers).map((q) => ({ question: q, header: 'h', multiSelect: false, options: [] })) },
  tool_response: { questions: Object.keys(answers).map((q) => ({ question: q, header: 'h', multiSelect: false, options: [] })), answers },
})

test('M4a A H6：最后一段、东西都在，记 closed_at → 放行；缺 08-delivery.md → 拒并点名', () => {
  using(AT_S8, (fx) => {
    assert.ok(!denied(run('rework', writeState(fx, { ...fx.state, closed_at: CLOSED_AT }), GATE, fx.p)))
  })
  const { ['08-delivery.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8, files }, (fx) => {
    const r = run('rework', writeState(fx, { ...fx.state, closed_at: CLOSED_AT }), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /08-delivery\.md[^\n]*你自己写/)
  })
})

test('M4a A H6：已收口之后记回退 → 拒，理由是「已经收口」那一句（排在返工预算与快照判据之前）', () => {
  using(AT_S8_CLOSED, (fx) => {
    const hist = [...FULL, ...H('S5')]
    const r = run('rework', writeState(fx, { ...fx.state, stage: 'S5', history: hist, rework: reworkFromHistory(hist) }), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /已经收口/)
    assert.doesNotMatch(reasonOf(r), /rework_base/)
  })
})

test('M4a A H2：已收口，PM 派协调者、派叶子 → 都拒，给另起一趟、不给记回退', () => {
  using(AT_S8_CLOSED, (fx) => {
    for (const target of ['agent-team:at-architect', 'agent-team:at-qa']) {
      const r = run('readiness', dispatch(target), GATE, fx.p)
      assert.ok(denied(r), target)
      assert.match(reasonOf(r), /已经收口/)
      assert.match(reasonOf(r), /\/agent-team:at /)
      assert.doesNotMatch(reasonOf(r), /记一次回退/)
    }
  })
})

test('M4a A H2：最后一段、没收口，PM 派协调者 → 拒；派这一轮还没交过的叶子（补收口缺的前置）→ 放行', () => {
  const { ['07-acceptance.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8, files }, (fx) => {
    const r = run('readiness', dispatch('agent-team:at-architect'), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /最后一段（S8）/)
    assert.ok(!denied(run('readiness', dispatch('agent-team:at-acceptance'), GATE, fx.p)))
  })
})

test('M4a A H2：最后一段、没收口，PM 重派已经交过的 at-qa → 拒，理由在记回退之外给「先收口再另起一趟」', () => {
  using(AT_S8, (fx) => {
    writeFileSync(join(fx.runDir, 'delivered.json'), JSON.stringify({ stage: 'S8', products: { '06-test.md': sha(R1['06-test.md']) } }))
    const r = run('readiness', dispatch('agent-team:at-qa'), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /交付之后的新改动/)
    assert.match(reasonOf(r), /第 6 节收口/)
  })
})

test('M4a A ledger：最后一段齐了、没收口、收得了口 → 【阶段】叫它收口、写 closed_at；已收口 → 不发【阶段】', () => {
  using(AT_S8, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.match(c, /该收口了/)
    assert.match(c, /closed_at/)
  })
  using(AT_S8_CLOSED, (fx) => {
    assert.doesNotMatch(contextOf(run('ledger', postedState(fx), GATE, fx.p)), /【阶段】/)
  })
})

test('M4a A ledger：最后一段的产物写了、前置还缺 → 【阶段】不催收口，列出阻碍', () => {
  const { ['07-acceptance.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8, files }, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.match(c, /【阶段】/)
    assert.doesNotMatch(c, /该收口了/)
    assert.match(c, /07-acceptance\.md/)
  })
})

test('M4a A 记录器：已收口的 run 上选了返工标签 → 不记，回传说已经收口', () => {
  using(AT_S8_CLOSED, (fx) => {
    const r = run('approval-ask', asked({ q: L5 }), GATE, fx.p)
    assert.match(contextOf(r), /已经收口/)
    let lines = ''
    try {
      lines = readFileSync(join(fx.runDir, 'approvals.jsonl'), 'utf8')
    } catch {
      lines = ''
    }
    assert.equal(lines, '')
  })
})

test('M4a A H5a：最后一段、没收口，补派 at-acceptance 补交缺的前置 → 回传说这是补收口要的、不用记回退', () => {
  const { ['07-acceptance.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8, files }, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-acceptance'), GATE, fx.p))
    assert.match(c, /最后一段/)
    assert.match(c, /补收口缺的前置[^\n]*不用记回退/)
  })
  // 锚：不在最后一段时不带这一句。
  using({ stage: 'S6', history: FIRST, files: R1 }, (fx) => {
    assert.doesNotMatch(contextOf(run('deliverable', returned('agent-team:at-acceptance'), GATE, fx.p)), /补收口缺的前置/)
  })
})

// ============================================================================ M4a 复核

// 三轮返工用满（S5–S8 各 3 轮），没有批准记录——【返工预算】与回退预判都会出声的形状。
const ROUNDS3 = [...FULL, ...H('S5', 'S6', 'S7', 'S8'), ...H('S5', 'S6', 'S7', 'S8'), ...H('S5', 'S6', 'S7', 'S8')]

test('M4a 复核 P9：H6 的收口判据排在返工预算之前——已收口、三轮用满再记回退，拿到的是「已经收口」，不是「再返工一轮」', () => {
  using({ ...AT_S8_CLOSED, history: ROUNDS3 }, (fx) => {
    const hist = [...ROUNDS3, ...H('S5')]
    const r = run('rework', writeState(fx, { ...fx.state, stage: 'S5', history: hist, rework: reworkFromHistory(hist) }), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /已经收口/)
    assert.doesNotMatch(reasonOf(r), /再返工一轮/)
  })
})

test('M4a 复核 P9：H2 的收口判据排在就绪与重派判据之前——已收口、前置缺、06 交过，派 at-qa 拿到的是「已经收口」', () => {
  const { ['04-dispatch.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8_CLOSED, files }, (fx) => {
    writeFileSync(join(fx.runDir, 'delivered.json'), JSON.stringify({ stage: 'S8', products: { '06-test.md': sha(R1['06-test.md']) } }))
    const reason = reasonOf(run('readiness', dispatch('agent-team:at-qa'), GATE, fx.p))
    assert.match(reason, /已经收口/)
    assert.doesNotMatch(reason, /前置产物还缺|记一次回退/)
  })
})

test('M4a 复核 G02：已收口时协调者再往下派 → 拒，收到的是「回报给派你的人」，不是 PM 那一版的另起一趟', () => {
  using(AT_S8_CLOSED, (fx) => {
    const reason = reasonOf(run('readiness', dispatch('agent-team:at-backend', 'agent-team:at-architect'), GATE, fx.p))
    assert.match(reason, /回报给派你的人/)
    assert.doesNotMatch(reason, /\/agent-team:at /)
  })
})

test('M4a 复核 P2：已收口的 run 不发【返工预算】（问用户批准这条路收口之后走不通）', () => {
  using({ ...AT_S8_CLOSED, history: [...ROUNDS3, ...H('S5', 'S6', 'S7', 'S8')] }, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.doesNotMatch(c, /【返工预算】|再返工一轮/)
  })
  // 锚：没收口时同一份 history 照发。
  using({ ...AT_S8, history: [...ROUNDS3, ...H('S5', 'S6', 'S7', 'S8')] }, (fx) => {
    assert.match(contextOf(run('ledger', postedState(fx), GATE, fx.p)), /【返工预算】/)
  })
})

test('M4a 复核 REAL-1：已收口的 run 上，at-acceptance 返回不再发「不是当前阶段的执行者」那条（停在旧阶段、记回退都不对）', () => {
  using(AT_S8_CLOSED, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-acceptance'), GATE, fx.p))
    assert.doesNotMatch(c, /停在旧阶段|记一次回退/)
  })
})

test('M4a 复核 REAL-1：已收口的 run 上，at-acceptance 改它交过的 07 → 拒，理由说已经收口，不叫记回退或推进', () => {
  using(AT_S8_CLOSED, (fx) => {
    writeFileSync(join(fx.runDir, 'delivered.json'), JSON.stringify({ stage: 'S8', products: { '07-acceptance.md': sha(DONE_FILES['07-acceptance.md']) } }))
    const w = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-acceptance', tool_input: { file_path: join(fx.runDir, '07-acceptance.md'), content: 'x' } }
    const r = run('writepath', w, GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /已经收口/)
    assert.doesNotMatch(reasonOf(r), /记一次回退|推进 stage/)
  })
})

test('M4a 复核 P7、G09：【产者交代】在最后一段——只能经协调者派的 at-ui 不叫 PM 直接派；已收口时 ② 是补不了派', () => {
  using(AT_S8, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.match(c, /【产者交代】/)
    assert.match(c, /at-ui[^\n]*在最后一段派不出去[^\n]*记一次回退/)
  })
  using(AT_S8_CLOSED, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.match(c, /补不了派/)
    assert.doesNotMatch(c, /把它派出去/)
  })
})

test('M4a 复核 F9：at-qa 不重测就停下——H5b 对它本人说「你这一轮重跑之后重写」，并说明结果相同时怎么写', () => {
  using(B, (fx) => {
    const r = run('stop-gate', stopped('agent-team:at-qa'), GATE, fx.p)
    assert.match(r.stderr, /你这一轮重跑之后重写/)
    assert.doesNotMatch(r.stderr, /让它的产者/)
    assert.match(r.stderr, /结论与上一轮相同/)
  })
})

test('M4a 复核 B-6：H2 前置还旧的理由里「重跑之后重写」只说一遍', () => {
  using(B, (fx) => {
    const reason = reasonOf(run('readiness', dispatch('agent-team:at-acceptance'), GATE, fx.p))
    assert.equal(reason.split('重跑之后重写').length - 1, 1, reason)
  })
})

test('M4a 复核 G12、G15：H5a「补收口缺的前置」只说给改得了 state.json 的人；不在最后一段时补记提示带「验证段的产物除外」', () => {
  const { ['07-acceptance.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8, files }, (fx) => {
    assert.doesNotMatch(contextOf(run('deliverable', returned('agent-team:at-acceptance', 'agent-team:at-architect'), GATE, fx.p)), /补收口缺的前置/)
  })
  using(B, (fx) => {
    assert.match(contextOf(run('deliverable', returned('agent-team:at-backend'), GATE, fx.p)), /验证段的产物除外/)
  })
})

test('M4a 复核 G08：最后一段、没收口、前置还是上一轮的 → 【阶段】列出它还旧，不催收口', () => {
  const hist = [...FULL, ...H('S7', 'S8')]
  using({ ...AT_S8, history: hist, reworkBase: { '07-acceptance.md': sha(DONE_FILES['07-acceptance.md']) } }, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.match(c, /07-acceptance\.md（还是上一轮的/)
    assert.doesNotMatch(c, /该收口了/)
  })
})

// ============================================================================ M4a 复核二

// G1：空文件全系统同一个口径——交付快照不把它记成交过，H2 放行补派、H3 放行重写；收口照样拦。
test('M4a 复核二 G1：06-test.md 是空文件（快照里记着空内容的 sha）→ PM 派 at-qa 补交放行、at-qa 写它放行', () => {
  using({ ...AT_S8, files: { ...DONE_FILES, '06-test.md': '' } }, (fx) => {
    writeFileSync(join(fx.runDir, 'delivered.json'), JSON.stringify({ stage: 'S8', products: { '06-test.md': sha('') } }))
    assert.ok(!denied(run('readiness', dispatch('agent-team:at-qa'), GATE, fx.p)))
    const w = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-qa', tool_input: { file_path: join(fx.runDir, '06-test.md'), content: 'x' } }
    assert.ok(!denied(run('writepath', w, GATE, fx.p)))
  })
})

// 文档核对订正：空文件现在让那一段根本不算齐（artifactCurrent），【阶段】不发——与交付文档缺着时一样，不再单独点名「空文件」。
test('M4a 复核二 G5：只有换行与空白的 08-delivery.md → 收口拒、【阶段】不说该收口了', () => {
  using({ ...AT_S8, files: { ...DONE_FILES, '08-delivery.md': '\r\n  \n' } }, (fx) => {
    const r = run('rework', writeState(fx, { ...fx.state, closed_at: CLOSED_AT }), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /08-delivery\.md[^\n]*空文件/)
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.doesNotMatch(c, /该收口了/)
  })
})

test('M4a 复核二 G9：门禁层冻结的拒绝理由带 at.md 的路径', () => {
  using(AT_S8_CLOSED, (fx) => {
    const r = run('rework', writeState(fx, { ...fx.state, stage: 'S5' }), GATE, fx.p)
    assert.match(reasonOf(r), /commands[\\/]at\.md/)
  })
})

// G3、G6、PF-8：【产者交代】在最后一段，PM 实际派不出去的缺口角色（只能经协调者派的，以及协调者本身）不叫它「派出去」；
// PM 派得到的叶子照旧；驱动者本人不算；不在最后一段时不说这一句。
test('M4a 复核二 P7：最后一段的【产者交代】——at-architect 与 at-ui 派不出去、at-acceptance 照旧派出去', () => {
  using({ ...AT_S8, roster: ['at-product', 'at-backend', 'at-qa'], extra: { stage_roles: { S2: ['at-product'], S5: ['at-backend'], S6: ['at-qa'] } } }, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    const two = c.split('\n').find((l) => l.includes('② 不是裁剪'))
    assert.ok(two, c)
    assert.match(two, /at-architect/)
    assert.match(two, /在最后一段派不出去/)
    assert.match(two, /把它派出去（at-acceptance）/)
    assert.doesNotMatch(two, /at-pm/)
  })
  using({ ...B, roster: ['at-product', 'at-backend'], extra: { stage_roles: { S2: ['at-product'], S5: ['at-backend'] } } }, (fx) => {
    assert.doesNotMatch(contextOf(run('ledger', postedState(fx), GATE, fx.p)), /最后一段派不出去/)
  })
})

test('M4a 复核二 PF-2：最后一段补交 at-acceptance 返回 → 回传叫它从第 6 节第一步重走一遍再收口', () => {
  const { ['07-acceptance.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8, files }, (fx) => {
    assert.match(contextOf(run('deliverable', returned('agent-team:at-acceptance'), GATE, fx.p)), /从第一步重走一遍/)
  })
})

test('M4a 复核二 D02、F03：已收口 H3 拒绝理由给出路；H5b 对产者本人说只追加一句不算', () => {
  using(AT_S8_CLOSED, (fx) => {
    writeFileSync(join(fx.runDir, 'delivered.json'), JSON.stringify({ stage: 'S8', products: { '07-acceptance.md': sha(DONE_FILES['07-acceptance.md']) } }))
    const w = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-acceptance', tool_input: { file_path: join(fx.runDir, '07-acceptance.md'), content: 'x' } }
    assert.match(reasonOf(run('writepath', w, GATE, fx.p)), /写进你的回报，由项目经理另起一趟/)
  })
  using(B, (fx) => {
    assert.match(run('stop-gate', stopped('agent-team:at-qa'), GATE, fx.p).stderr, /只在末尾追加一句「核过」不算/)
  })
})

// ============================================================================ M4a 文档核对

const INJECT = fileURLToPath(new URL('./helpers/inject-throw.cjs', import.meta.url))

// F1：空文件在交付那一刻就不算交了——at-qa 交一个空的 06-test.md 停不下来；PM 跳过它派 at-acceptance，H2 按前置缺拒。
test('M4a 核对 F1：首轮 S6，at-qa 交空的 06-test.md 就停 → H5b 拒，说是空文件', () => {
  using({ stage: 'S6', history: FIRST, files: { ...R1, '06-test.md': '\n  \n' } }, (fx) => {
    const r = run('stop-gate', stopped('agent-team:at-qa'), GATE, fx.p)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /06-test\.md 是空文件/)
  })
})

test('M4a 核对 F1：S7，06-test.md 是空文件，派 at-acceptance → H2 拒，前置缺 06', () => {
  using({ stage: 'S7', history: [...FIRST, ...H('S7')], files: { ...R1, '06-test.md': '' } }, (fx) => {
    const r = run('readiness', dispatch('agent-team:at-acceptance'), GATE, fx.p)
    assert.ok(denied(r))
    assert.match(reasonOf(r), /前置产物还缺[^\n]*06-test\.md/)
  })
})

// F2：空的兄弟产物不再让 H3 的补派豁免一直开着（1.8.0 拒这一写入）。
test('M4a 核对 F2：S6，at-ui 的 02-wireframe.html 是空文件，它改已经交过的 02-ui-spec.md → 拒（不当成补派）', () => {
  using({ stage: 'S6', history: FIRST, files: { ...R1, '02-wireframe.html': '' } }, (fx) => {
    writeFileSync(join(fx.runDir, 'delivered.json'), JSON.stringify({ stage: 'S6', products: { '02-ui-spec.md': sha(R1['02-ui-spec.md']) } }))
    const w = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-ui', tool_input: { file_path: join(fx.runDir, '02-ui-spec.md'), content: 'y' } }
    assert.ok(denied(run('writepath', w, GATE, fx.p)))
  })
})

// F3（G07）：ledger 的收口阻碍对「在、却读不出来」那一支——用崩溃注入的 read: 模式造出来。
test('M4a 核对 G07：最后一段的 08-delivery.md 读不出来 → 【阶段】不催收口，点名读不出来', () => {
  using(AT_S8, (fx) => {
    const r = run('ledger', postedState(fx), GATE, fx.p, { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: 'read:08-delivery.md' }, { nodeArgs: ['-r', INJECT] })
    const c = contextOf(r)
    assert.doesNotMatch(c, /该收口了/)
    assert.match(c, /08-delivery\.md（在磁盘上但读不出来/)
  })
})

// PG-6：最后一段、没收口，补交的 at-acceptance 返回——先说补交这条正路，不先断言「两种可能」（两样都不对）。
test('M4a 核对 PG-6：最后一段补交的 at-acceptance 返回 → 回传不说「两种可能」', () => {
  const { ['07-acceptance.md']: _gone, ...files } = DONE_FILES
  using({ ...AT_S8, files }, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-acceptance'), GATE, fx.p))
    assert.match(c, /补收口缺的前置/)
    assert.doesNotMatch(c, /两种可能/)
  })
})
