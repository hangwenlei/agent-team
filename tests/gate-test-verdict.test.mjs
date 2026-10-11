// docs/66：测试报告的固定首行，推进出测试那一段时 H6 读它（docs/46 §4「测试报告的结论不读」）。
//
// /agent-team:at 第 3 节一直写着「推进之前读结论：06-test.md 判不通过的照回退处理，不要推进」，门禁只核测试报告在不在、空不空、是不是这一轮的。
// 现在测试报告的第一个非空行固定写「结论：通过」「结论：不通过」「结论：跑不起来」之一（不通过、跑不起来后面可以接冒号写原因）：推进出测试那一段时，
// 不通过的拒（回退到实现那一段）、读不出的拒（同段重派 at-qa 照格式写）；跑不起来的放行——那是正文里的 env-blocked 那一问，用户定。at-qa 停下时首行读不出，
// H5b 拦它当场改；【阶段】在测试那一段齐了时补一句。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { testVerdict, TEST_VERDICT_LINES } from '../hooks/lib/test-verdict.mjs'
import { bodyShaOf } from '../hooks/lib/contract-base.mjs'

const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-10T12:00:00Z' }))
const S6_FILES = ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md', '05-impl/at-backend.md']
const ctxOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '')

// 停在 S6 的一趟（S1 到 S6 都走过、产物都在、contract_sha 记的就是磁盘上的契约）；report 是 06-test.md 的内容（null 不写）。
function inS6(report, body) {
  const dirs = makeRun({ runId: 'r1', stage: 'S6', artifacts: S6_FILES, roster: ['at-product', 'at-architect', 'at-backend', 'at-qa'] })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    if (report !== null) writeFileSync(join(runDir, '06-test.md'), report)
    const statePath = join(runDir, 'state.json')
    const hist = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6')
    const state = {
      ...JSON.parse(readFileSync(statePath, 'utf8')),
      contract_sha: sha256OfContract(readFileSync(join(runDir, '00-contract.md'))),
      stage_roles: { S2: ['at-product'], S3: ['at-architect'], S5: ['at-architect', 'at-backend'], S6: ['at-qa'] },
      trimmed: { 'at-ui': 'S2', 'at-frontend': 'S5', 'at-ios': 'S5', 'at-android': 'S5' },
      history: hist,
      rework: reworkFromHistory(hist),
    }
    writeFileSync(statePath, JSON.stringify(state))
    return body({ ...dirs, runDir, statePath, state })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}
const toS7 = (fx) => {
  const hist = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
  const after = { ...fx.state, stage: 'S7', history: hist, rework: reworkFromHistory(hist) }
  return { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath, content: JSON.stringify(after, null, 2) } }
}
const advance = (fx) => decisionOf(run('rework', toS7(fx), GATE, fx.projectDir).stdout)
const stopQa = (extra = {}) => ({ hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-qa', agent_id: 'a0000000000000081', ...extra })

test('testVerdict（docs/66）：第一个非空行是三种之一——通过严格，不通过、跑不起来按前缀认；全角冒号、强调、前面的空行照认；标题打头、通过后面夹话读不出', () => {
  assert.equal(testVerdict(Buffer.from('结论：通过\n\n- 22 条全过\n')), 'pass')
  assert.equal(testVerdict(Buffer.from('\n\n**结论：通过**\n')), 'pass')
  assert.equal(testVerdict(Buffer.from('结论：不通过：缺测试\n')), 'fail')
  assert.equal(testVerdict(Buffer.from('结论：不通过（2 条挂了）\n')), 'fail')
  assert.equal(testVerdict(Buffer.from('结论：跑不起来：没装 Docker\n')), 'env')
  assert.equal(testVerdict(Buffer.from('测试结论:通过\n')), 'pass')
  assert.equal(testVerdict(Buffer.from('# 06 测试报告\n\n结论：通过\n')), null)
  assert.equal(testVerdict(Buffer.from('结论：通过（有一条没跑）\n')), null)
  assert.equal(testVerdict(Buffer.from('')), null)
  assert.equal(TEST_VERDICT_LINES.length, 3)
})

test('H6（docs/66）：推进出 S6——测试报告首行「结论：通过」放行，「结论：跑不起来」也放行（环境阻塞那一问由用户定）', () => {
  for (const report of ['结论：通过\n', '结论：跑不起来：缺 Docker，`npm test` 起不来\n']) {
    inS6(report, (fx) => {
      assert.equal(advance(fx), null, JSON.stringify(report))
    })
  }
})

test('H6（docs/66）：推进出 S6——首行「结论：不通过」拒，出路是回退到 S5；首行读不出拒，出路是在 S6 里同段重派 at-qa 照格式写', () => {
  inS6('结论：不通过：缺测试\n\n- `--top` 没有用例\n', (fx) => {
    const d = advance(fx)
    assert.equal(d?.permissionDecision, 'deny')
    const why = d.permissionDecisionReason
    assert.ok(why.includes('06-test.md') && why.includes('「结论：不通过」') && why.includes('「回退」记回到 S5'), why)
  })
  inS6('# 06 测试报告\n\n结论：通过\n', (fx) => {
    const d = advance(fx)
    assert.equal(d?.permissionDecision, 'deny')
    const why = d.permissionDecisionReason
    for (const l of TEST_VERDICT_LINES) assert.ok(why.includes(`「${l}」`), l)
    assert.ok(why.includes('在 S6 里同段重派 at-qa') && !why.includes('回退'), why)
  })
})

test('H6（docs/66）：只在推进出 S6 的那一次读——S6 里原地重写不读；已经走过 S6 的（S7 推进到 S8）不按测试报告拦', () => {
  inS6('结论：不通过\n', (fx) => {
    const same = { ...fx.state, roster: [...fx.state.roster] }
    const r = run('rework', { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath, content: JSON.stringify(same, null, 2) } }, GATE, fx.projectDir)
    assert.equal(decisionOf(r.stdout), null, r.stdout)
    // 已经走过 S6（旧 run 照着首行没有固定格式时推进过来的）：停在 S7、验收结论通过，推进到 S8 不按测试报告拦。
    writeFileSync(join(fx.runDir, '07-acceptance.md'), '结论：通过\n')
    const s7hist = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
    const atS7 = { ...fx.state, stage: 'S7', stage_roles: { ...fx.state.stage_roles, S7: ['at-acceptance'] }, history: s7hist, rework: reworkFromHistory(s7hist) }
    writeFileSync(fx.statePath, JSON.stringify(atS7))
    const s8hist = [...s7hist, { stage: 'S8', at: '2026-10-10T12:00:00Z' }]
    const toS8 = { ...atS7, stage: 'S8', history: s8hist, rework: reworkFromHistory(s8hist) }
    const r8 = run('rework', { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath, content: JSON.stringify(toS8, null, 2) } }, GATE, fx.projectDir)
    const d8 = decisionOf(r8.stdout)
    assert.ok(d8 === null || !d8.permissionDecisionReason.includes('06-test.md 第一行'), JSON.stringify(d8))
  })
})

test('H5b（docs/66）：at-qa 在 S6 停下、测试报告首行读不出——拦，叫它改好再停；首行是三种之一（含不通过）照常放行；冒泡的出口照旧', () => {
  inS6('# 测试报告\n\n全过\n', (fx) => {
    const r = run('stop-gate', stopQa(), GATE, fx.projectDir)
    assert.equal(r.status, 2, r.stderr)
    assert.ok(r.stderr.includes('06-test.md') && r.stderr.includes('第一行读不出测试结论'), r.stderr)
    assert.ok(r.stderr.includes('不改，你停下时门禁会拦回来') && r.stderr.includes('冒泡：'), r.stderr)
    const ok = run('stop-gate', stopQa({ stop_hook_active: true, last_assistant_message: '冒泡：S5 的实现记录还没交齐，开不了跑。' }), GATE, fx.projectDir)
    assert.equal(ok.status, 0, ok.stderr)
  })
  for (const report of ['结论：通过\n', '结论：不通过：缺测试\n', '结论：跑不起来\n']) {
    inS6(report, (fx) => {
      assert.equal(run('stop-gate', stopQa(), GATE, fx.projectDir).status, 0, report)
    })
  }
  // 不在测试那一段停下的 at-qa（state.stage 已经是 S7）：不按测试报告的首行拦。
  inS6('# 测试报告\n', (fx) => {
    writeFileSync(fx.statePath, JSON.stringify({ ...fx.state, stage: 'S7' }))
    const r = run('stop-gate', stopQa(), GATE, fx.projectDir)
    assert.ok(!r.stderr.includes('第一行读不出测试结论'), r.stderr)
  })
})

test('H6（docs/66）：S6 整段裁掉（at-qa 记在 trimmed 里、谁都没叫过）——磁盘上留着一份测试报告也不读它的首行', () => {
  inS6('# 不知谁留下的报告\n', (fx) => {
    const st = { ...fx.state, trimmed: { ...fx.state.trimmed, 'at-qa': 'S6' }, stage_roles: { ...fx.state.stage_roles, S6: [] } }
    writeFileSync(fx.statePath, JSON.stringify(st))
    const d = decisionOf(run('rework', toS7({ ...fx, state: st }), GATE, fx.projectDir).stdout)
    assert.ok(d === null || !d.permissionDecisionReason.includes('06-test.md 第一行'), JSON.stringify(d))
  })
})

test('【阶段】（docs/66）：at-qa 写的测试报告首行读不出——叫它把第一行改好；项目经理在 S6 齐了、测试没过时写 state.json——说推进出 S6 会被拒', () => {
  inS6('# 测试报告\n', (fx) => {
    const byQa = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-qa', tool_input: { file_path: join(fx.runDir, '06-test.md') } }
    const c = ctxOf(run('ledger', byQa, GATE, fx.projectDir))
    assert.ok(c.includes('你写的 06-test.md 第一行读不出测试结论'), c)
  })
  inS6('结论：不通过\n', (fx) => {
    const byPm = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath } }
    const c = ctxOf(run('ledger', byPm, GATE, fx.projectDir))
    assert.ok(c.includes('推进出 S6 会被 H6 拒') && c.includes('「回退」记回到 S5'), c)
  })
  inS6('结论：通过\n', (fx) => {
    const byPm = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath } }
    const c = ctxOf(run('ledger', byPm, GATE, fx.projectDir))
    assert.ok(!c.includes('推进出 S6 会被') && !c.includes('读不出测试结论'), c)
  })
})

test('正文（docs/66）：at-qa 写明第一行的三种写法；/agent-team:at 说推进出 S6 时门禁读它——门禁真的读（上面几条）', () => {
  const flat = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('').split('\n').join('')
  const qa = flat('agents/at-qa.md')
  assert.ok(qa.includes('`06-test.md` 的第一行写总的结论，逐字是这三句之一：「结论：通过」「结论：不通过」「结论：跑不起来」'), 'agents/at-qa.md')
  const at = flat('commands/at.md')
  assert.ok(at.includes('门禁推进出 `S6` 时读 `06-test.md` 的第一行'), 'commands/at.md')
})

// ——— 复核（docs/66 §8）：测试没过时用户的出口——照现状交付，门禁记下、按 sha 绑在测试报告上 ———

const NL = '\n'
const FAIL = '结论：不通过' + NL + NL + '- `legacy.test.js` 第 3 条：这一趟之前就挂着' + NL
const asked = (answer) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion',
  agent_type: 'agent-team:at-pm',
  tool_input: { questions: [{ question: '测试没过，怎么办？', header: '测试', multiSelect: false, options: [] }] },
  tool_response: { questions: [{ question: '测试没过，怎么办？', header: '测试', multiSelect: false, options: [] }], answers: { '测试没过，怎么办？': answer } },
})
const approvalsOf = (runDir) => {
  try {
    return readFileSync(join(runDir, 'approvals.jsonl'), 'utf8').split(NL).filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

test('照现状交付（复核 docs/66 §8）：停在 S6、测试报告不通过——用户选「照现状交付」，门禁记下（绑在 06-test.md 上），推进出 S6 放行；报告再改一个字，批准不算了', () => {
  inS6(FAIL, (fx) => {
    const r = run('approval-ask', asked('照现状交付'), GATE, fx.projectDir)
    const c = ctxOf(r)
    assert.ok(c.includes('已记下照现状交付的批准') && c.includes('06-test.md'), c)
    const rows = approvalsOf(fx.runDir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].product, '06-test.md')
    assert.equal(rows[0].sha, sha256OfContract(Buffer.from(FAIL)))
    assert.equal(advance(fx), null, '批准过的这一份放行')
    const byPm = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath } }
    assert.ok(!ctxOf(run('ledger', byPm, GATE, fx.projectDir)).includes('推进出 S6 会被 H6 拒'), '【阶段】也认这条批准')
    writeFileSync(join(fx.runDir, '06-test.md'), FAIL + '补一句' + NL)
    assert.equal(advance(fx)?.permissionDecision, 'deny', '改过之后批准不算了')
  })
})

test('照现状交付（复核 docs/66 §8）：拒绝理由里给这条出路；停在 S6 时写「跑不起来」的不需要批准、还没有测试报告的说还没有测试报告', () => {
  inS6(FAIL, (fx) => {
    const why = advance(fx).permissionDecisionReason
    assert.ok(why.includes('「照现状交付」') && why.includes('只对现在这份 06-test.md 有效'), why)
    assert.ok(why.includes('根因在更早一段的，回到那一段'), why)
  })
  inS6('结论：跑不起来：缺 Docker\n', (fx) => {
    const c = ctxOf(run('approval-ask', asked('照现状交付'), GATE, fx.projectDir))
    assert.ok(c.includes('测试报告第一行是「结论：跑不起来」') && c.includes('不需要批准'), c)
    assert.equal(approvalsOf(fx.runDir).length, 0)
  })
  inS6(null, (fx) => {
    const c = ctxOf(run('approval-ask', asked('照现状交付'), GATE, fx.projectDir))
    assert.ok(c.includes('还没有测试报告'), c)
  })
})

test('照现状交付（复核 docs/66 §8）：测试报告的批准之后，项目经理把用户的答复写成修订——那一次不算改需求（记进 deliver_used、测试报告不算对着上一版），推进出 S6 放行', () => {
  inS6(FAIL, (fx) => {
    const contract = ['# 00 契约', '', '## 1. 用户原话', '', '> 做一个计数工具。', '', '## 2. PM 的理解（可改）', '', '- 命令行。', '', '## 4. 修订记录', ''].join(NL)
    writeFileSync(join(fx.runDir, '00-contract.md'), contract)
    // 推进出第一段时门禁记下的基线（第 1 节与修订指纹）。
    writeFileSync(join(fx.runDir, 'contract-base.json'), JSON.stringify({ section1: '> 做一个计数工具。', body_sha: bodyShaOf(contract), revisions: [], verify_base: {}, revised_at: null }))
    run('approval-ask', asked('照现状交付'), GATE, fx.projectDir)
    writeFileSync(join(fx.runDir, '00-contract.md'), contract + '### 2026-10-10 · 升级 #1（kind: contract-conflict）' + NL + '**用户裁决**：照现状交付，老用例不修。' + NL)
    const posted = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: join(fx.runDir, '00-contract.md') } }
    const c = ctxOf(run('ledger', posted, GATE, fx.projectDir))
    assert.ok(!c.includes('契约改了'), c)
    const base = JSON.parse(readFileSync(join(fx.runDir, 'contract-base.json'), 'utf8'))
    assert.deepEqual(base.deliver_used, [sha256OfContract(Buffer.from(FAIL))])
    assert.deepEqual(base.verify_base, {})
    assert.equal(advance(fx), null)
  })
})

// ——— 复核（docs/66 §8）：几种写法与先后 ———

test('H6（复核 docs/66 §8）：推进那一次才把 at-qa 裁掉——派发记录里有它在 S6 的派发、或者写入前记着它，照样读测试报告首行', () => {
  // S6 的 stage_roles 真实顺序里要到推进那一次才记：写入前没有 S6 这一项，派发记录里有 at-qa 在 S6 的派发。
  inS6('结论：不通过\n', (fx) => {
    const { S6: _s6, ...rolesBefore } = fx.state.stage_roles
    const before = { ...fx.state, stage_roles: rolesBefore, roster: fx.state.roster.filter((r) => r !== 'at-qa') }
    writeFileSync(fx.statePath, JSON.stringify(before))
    writeFileSync(join(fx.runDir, 'dispatches.jsonl'), JSON.stringify({ kind: 'dispatch', agent_id: 'a0000000000000082', role: 'at-qa', stage: 'S6', caller: 'at-pm', at: '2026-10-10T12:00:00Z' }) + '\n')
    const trimmedWrite = { ...before, trimmed: { ...before.trimmed, 'at-qa': 'S6' }, stage_roles: { ...rolesBefore, S6: [] } }
    const d = decisionOf(run('rework', toS7({ ...fx, state: trimmedWrite }), GATE, fx.projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
  })
  // 没有派发记录、写入前记着 at-qa：推进那一次删名字再裁掉。
  inS6('结论：不通过\n', (fx) => {
    const trimmedWrite = { ...fx.state, roster: fx.state.roster.filter((r) => r !== 'at-qa'), trimmed: { ...fx.state.trimmed, 'at-qa': 'S6' }, stage_roles: { ...fx.state.stage_roles, S6: [] } }
    const d = decisionOf(run('rework', toS7({ ...fx, state: trimmedWrite }), GATE, fx.projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
  })
})

test('H6、【阶段】（复核 docs/66 §8）：测试报告对着上一版契约、首行又是不通过——先说契约那一句（同段重派重出），不说「记回到 S5」；【阶段】也不补测试那一句', () => {
  inS6('结论：不通过\n', (fx) => {
    const sha6 = sha256OfContract(readFileSync(join(fx.runDir, '06-test.md')))
    writeFileSync(join(fx.runDir, 'contract-base.json'), JSON.stringify({ revisions: ['### 2026-10-10 · 用户主动提出'], verify_base: { '06-test.md': sha6 }, revised_at: '2026-10-10T12:30:00Z' }))
    const why = advance(fx).permissionDecisionReason
    assert.ok(why.includes('在 S6 里同段重派') && !why.includes('「回退」记回到 S5'), why)
    const byPm = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath } }
    const c = ctxOf(run('ledger', byPm, GATE, fx.projectDir))
    assert.ok(!c.includes('推进出 S6 会被 H6 拒'), c)
  })
})

test('【阶段】（复核 docs/66 §8）：at-qa 写的是不通过——给它自己的那一句（回报时照实说），不给项目经理那一句；已经走过 S6、停在 S7 的不说推进出 S6', () => {
  inS6('结论：不通过：缺测试\n', (fx) => {
    const byQa = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-qa', tool_input: { file_path: join(fx.runDir, '06-test.md') } }
    const c = ctxOf(run('ledger', byQa, GATE, fx.projectDir))
    assert.ok(c.includes('测试结论是「结论：不通过」') && c.includes('回报时照实说') && !c.includes('会被 H6 拒'), c)
  })
  inS6('# 旧格式的测试报告\n', (fx) => {
    writeFileSync(join(fx.runDir, '07-acceptance.md'), '结论：通过\n')
    const hist = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
    writeFileSync(fx.statePath, JSON.stringify({ ...fx.state, stage: 'S7', stage_roles: { ...fx.state.stage_roles, S7: ['at-acceptance'] }, history: hist, rework: reworkFromHistory(hist) }))
    const byPm = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath } }
    const c = ctxOf(run('ledger', byPm, GATE, fx.projectDir))
    assert.ok(!c.includes('推进出 S6'), c)
  })
})
