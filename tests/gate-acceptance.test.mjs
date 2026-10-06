// M4k（docs/46，docs/35 §5 与 docs/39 §3「收口不读验收结论」）：门禁子进程这一层——H6 推进出验收那一段与收口时读验收结论首行（没过、
// 又没有门禁记下的照现状交付批准就拒）；approval-ask、approval-prompt 两个记录器认「照现状交付」，按 sha 绑在那一刻的验收结论上记进
// approvals.jsonl；【阶段】的收口阻碍列它；记照现状交付答复的修订块（标题带「· 照现状交付」）不算改需求（与 M4j 契约基线的衔接）；
// H3 拒写批准记录时说清它也记照现状交付。纯函数那一层在 tests/verdict.test.mjs、tests/approvals.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { bodyShaOf } from '../hooks/lib/contract-base.mjs'
import { dispatchLine } from '../hooks/lib/completion.mjs'

const NL = String.fromCharCode(10)
const sha = (s) => sha256OfContract(Buffer.from(s, 'utf8'))
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-06T10:00:00Z' }))
const CHAIN = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const upTo = (s) => H(...CHAIN.slice(0, CHAIN.indexOf(s) + 1))
const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const CONTRACT = ['# 00 契约', '', '## 1. 用户原话', '', '> 做一个待办清单。', '', '## 2. PM 的理解（可改）', '', '- 命令行。', '', '## 4. 修订记录', ''].join(NL)
const PASS = '结论：通过' + NL + NL + '- 第 1 条：过' + NL
const FAIL = '结论：不通过' + NL + NL + '- 第 1 条：过' + NL + '- 第 2 条：没过' + NL
const UNKNOWN = '结论：判不了' + NL + NL + '- 第 1 条：判不了（测试跑不起来）' + NL

const S8_RUN = { stage: 'S8', history: upTo('S8'), roster: ['at-qa', 'at-acceptance'], stage_roles: { S6: ['at-qa'], S7: ['at-acceptance'] } }
const S7_RUN = { stage: 'S7', history: upTo('S7'), roster: ['at-qa', 'at-acceptance'], stage_roles: { S6: ['at-qa'], S7: ['at-acceptance'] } }

function withRun(opts, files, body) {
  const dirs = makeRun({ runId: 'r1', ...opts })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  for (const [name, text] of Object.entries({ '00-contract.md': CONTRACT, ...files })) writeFileSync(join(runDir, name), text)
  try {
    return body({ ...dirs, runDir })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}
const stateWrite = (runDir, change) => {
  const statePath = join(runDir, 'state.json')
  const now = JSON.parse(readFileSync(statePath, 'utf8'))
  return { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath, content: JSON.stringify(change(now), null, 2) } }
}
const closeWrite = (runDir) => stateWrite(runDir, (s) => ({ ...s, never_invoked: [], closed_at: '2026-10-06T12:00:00Z' }))
const advanceS7 = (runDir) => stateWrite(runDir, (s) => ({ ...s, stage: 'S8', history: [...s.history, ...H('S8')] }))
const asked = (answer, extra = {}) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion',
  agent_type: 'agent-team:at-pm',
  tool_input: { questions: [{ question: '验收没过，怎么办？', header: '交付', multiSelect: false, options: [] }] },
  tool_response: { questions: [{ question: '验收没过，怎么办？', header: '交付', multiSelect: false, options: [] }], answers: { '验收没过，怎么办？': answer }, ...extra },
})
const prompted = (prompt) => ({ hook_event_name: 'UserPromptSubmit', prompt })
const posted = (file) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: file } })
const approvalsOf = (runDir) => {
  const f = join(runDir, 'approvals.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').split(NL).filter(Boolean).map((l) => JSON.parse(l)) : []
}
const DONE = (acc) => ({ '06-test.md': 'test' + NL, '07-acceptance.md': acc, '08-delivery.md': 'delivery' + NL })

test('M4k H6：收口时验收结论判不通过——拒（附照现状交付的出路）；用户在 AskUserQuestion 里选了「照现状交付」，门禁记下、收口放行；验收结论再改一个字，批准不算了', () => {
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    const d = decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('「结论：不通过」') && d.permissionDecisionReason.includes('验收没过不收口'), d.permissionDecisionReason)
    assert.ok(d.permissionDecisionReason.includes('「照现状交付」'), d.permissionDecisionReason)
    const r = run('approval-ask', asked('照现状交付'), GATE, projectDir)
    assert.ok(ctxOf(r.stdout).includes('【门禁】已记下照现状交付的批准'), r.stdout)
    assert.match(JSON.parse(r.stdout).systemMessage, /^agent-team 照现状交付：已记下/)
    assert.deepEqual(approvalsOf(runDir).map((v) => [v.kind, v.product, v.sha, v.source]), [['deliver-as-is', '07-acceptance.md', sha(FAIL), 'ask']])
    assert.equal(decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout), null, '批准之后收口放行')
    writeFileSync(join(runDir, '07-acceptance.md'), FAIL + '- 补一句' + NL)
    const again = decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout)
    assert.equal(again?.permissionDecision, 'deny', '验收结论改过之后批准不算')
  })
})

test('M4k approval-prompt：用户单独发一条「照现状交付」——门禁记下（stdout 一个字不写）；验收结论是通过的、不在的不记', () => {
  withRun(S8_RUN, DONE(UNKNOWN), ({ projectDir, runDir }) => {
    const r = run('approval-prompt', prompted('照现状交付'), GATE, projectDir)
    assert.equal(r.stdout.trim(), '')
    assert.deepEqual(approvalsOf(runDir).map((v) => [v.kind, v.sha, v.source]), [['deliver-as-is', sha(UNKNOWN), 'prompt']])
    assert.equal(decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout), null)
  })
  withRun(S8_RUN, DONE(PASS), ({ projectDir, runDir }) => {
    const r = run('approval-ask', asked('照现状交付'), GATE, projectDir)
    assert.ok(ctxOf(r.stdout).includes('没有记成照现状交付的批准') && ctxOf(r.stdout).includes('结论：通过'), r.stdout)
    assert.deepEqual(approvalsOf(runDir), [])
  })
  withRun(S7_RUN, { '06-test.md': 'test' + NL }, ({ projectDir, runDir }) => {
    const r = run('approval-ask', asked('照现状交付'), GATE, projectDir)
    assert.ok(ctxOf(r.stdout).includes('还没有验收结论'), r.stdout)
    assert.deepEqual(approvalsOf(runDir), [])
  })
})

test('M4k H6：推进出 S7——判不了拒（出路按原因分、附照现状交付）；首行读不出拒、出路是在 S7 同段重派；通过放行', () => {
  withRun(S7_RUN, { '06-test.md': 'test' + NL, '07-acceptance.md': UNKNOWN }, ({ projectDir, runDir }) => {
    const d = decisionOf(run('rework', advanceS7(runDir), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    const why = d.permissionDecisionReason
    assert.ok(why.includes('「结论：判不了」') && why.includes('验收没过不推进出 S7') && why.includes('回到 S6') && why.includes('env-blocked'), why)
    assert.ok(why.includes('「照现状交付」'), why)
    writeFileSync(join(runDir, '07-acceptance.md'), '# 验收报告' + NL + NL + '结论：通过' + NL)
    const none = decisionOf(run('rework', advanceS7(runDir), GATE, projectDir).stdout)
    assert.ok(none?.permissionDecision === 'deny' && none.permissionDecisionReason.includes('在 S7 里同段重派 at-acceptance'), JSON.stringify(none))
    writeFileSync(join(runDir, '07-acceptance.md'), PASS)
    assert.equal(decisionOf(run('rework', advanceS7(runDir), GATE, projectDir).stdout), null)
  })
})

test('M4k H6：验收那一段整段裁掉、谁都没叫过——没有验收结论，收口不读', () => {
  const trimmedRun = { stage: 'S8', history: upTo('S8'), roster: ['at-qa'], stage_roles: { S6: ['at-qa'], S7: [] }, trimmed: { 'at-acceptance': 'S7' } }
  withRun(trimmedRun, { '06-test.md': 'test' + NL, '08-delivery.md': 'delivery' + NL }, ({ projectDir, runDir }) => {
    assert.equal(decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout), null)
  })
})

test('M4k 【阶段】：S8 齐了、验收结论判不通过又没批准——收口阻碍里列它与出路，不说该收口了；批准之后说该收口了', () => {
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    const c = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(c.includes('07-acceptance.md（') && c.includes('「结论：不通过」') && c.includes('「照现状交付」'), c)
    assert.ok(!c.includes('该收口了'), c)
    run('approval-ask', asked('照现状交付'), GATE, projectDir)
    const after = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(after.includes('该收口了'), after)
  })
})

test('M4k 与契约基线的衔接（评审 F1、F2）：门禁记下照现状交付批准之后的第一次修订不算改需求（不重拍、记进 deliver_used、说一句）；用过之后再改需求照常重拍；没有批准照标题分', () => {
  const putBase = (runDir) =>
    writeFileSync(join(runDir, 'contract-base.json'), JSON.stringify({ section1: '> 做一个待办清单。', body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: {}, revised_at: null }))
  const answered = CONTRACT + '### 2026-10-06 · 升级 #1（kind: contract-conflict）' + NL + '**用户裁决**：照现状交付，第 2 条不修。' + NL
  const baseNow = (runDir) => JSON.parse(readFileSync(join(runDir, 'contract-base.json'), 'utf8'))
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    putBase(runDir)
    run('approval-ask', asked('照现状交付'), GATE, projectDir)
    writeFileSync(join(runDir, '00-contract.md'), answered)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c.includes('契约改了') && c.includes('照现状交付'), c)
    assert.deepEqual(baseNow(runDir).verify_base, {})
    assert.deepEqual(baseNow(runDir).deliver_used, [sha(FAIL)])
    // 复核（中 1）：之后往同一块里补一句——不算修订，不重拍。
    const completed = answered + '**对契约的影响**：第 2 条不修，交付文档写明。' + NL
    writeFileSync(join(runDir, '00-contract.md'), completed)
    const c2 = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c2.includes('契约改了'), c2)
    assert.deepEqual(baseNow(runDir).verify_base, {})
    assert.equal(decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout), null, '收口放行')
    // 收口之后（closed_at 落了盘），再往用掉批准的那一块补一句：不算改了契约，不说「已经收口」。
    const statePath = join(runDir, 'state.json')
    const closedState = { ...JSON.parse(readFileSync(statePath, 'utf8')), never_invoked: [], closed_at: '2026-10-06T12:00:00Z' }
    writeFileSync(statePath, JSON.stringify(closedState))
    writeFileSync(join(runDir, '00-contract.md'), completed + '**补记**：用户确认过。' + NL)
    const afterClose = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!afterClose.includes('这一趟已经收口'), afterClose)
    writeFileSync(statePath, JSON.stringify({ ...closedState, closed_at: null }))
    writeFileSync(join(runDir, '00-contract.md'), completed + '### 2026-10-07 · 用户主动提出' + NL + '**改动**：加一条：能删。' + NL)
    const again = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(again.includes('契约改了'), again)
  })
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    putBase(runDir)
    writeFileSync(join(runDir, '00-contract.md'), answered)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes('契约改了'), c)
  })
})

test('M4k 评审 F3：验收结论对着上一版契约（契约基线记着）——记录器不记照现状交付的批准，回传说先重出', () => {
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    writeFileSync(
      join(runDir, 'contract-base.json'),
      JSON.stringify({ section1: '> 做一个待办清单。', body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: { '07-acceptance.md': sha(FAIL) }, revised_at: '2026-10-06T10:30:00.000Z' }),
    )
    const r = run('approval-ask', asked('照现状交付'), GATE, projectDir)
    assert.ok(ctxOf(r.stdout).includes('没有记成照现状交付的批准') && ctxOf(r.stdout).includes('对着上一版契约'), r.stdout)
    assert.deepEqual(approvalsOf(runDir), [])
  })
})

test('M4k 评审 F5：S7 齐了时【阶段】也读首行——PM 收到「推进出 S7 会被拒」与出路；at-acceptance 写出读不出的首行，叫它自己改；通过的不提', () => {
  withRun(S7_RUN, { '06-test.md': 'test' + NL, '07-acceptance.md': FAIL }, ({ projectDir, runDir }) => {
    const c = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(c.includes('推进出 S7') && c.includes('「结论：不通过」') && c.includes('「照现状交付」'), c)
    writeFileSync(join(runDir, '07-acceptance.md'), '# 验收报告' + NL + NL + '结论：通过' + NL)
    const byAcc = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-acceptance', tool_input: { file_path: join(runDir, '07-acceptance.md') } }
    const mine = ctxOf(run('ledger', byAcc, GATE, projectDir).stdout)
    assert.ok(mine.includes('你写的 07-acceptance.md 第一行读不出验收结论') && mine.includes('改完再停下'), mine)
    writeFileSync(join(runDir, '07-acceptance.md'), PASS)
    const ok = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(!ok.includes('推进出 S7 会被') && !ok.includes('读不出验收结论'), ok)
  })
})

test('M4k 评审 F10：H6 因为验收结论拒、而门禁找不到进行中的 run 时——拒绝理由补一句用户的批准会记不下', () => {
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    rmSync(join(projectDir, '.agent-team', 'current-run'))
    const d = decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('「结论：不通过」') && d.permissionDecisionReason.includes('用户的回答会记不下'), d.permissionDecisionReason)
  })
})

test('M4k 评审 F11：插件的阶段链上认不出验收那一段——H6 不读验收结论、留一行痕', () => {
  const REPO = new URL('../', import.meta.url)
  const stages = JSON.parse(readFileSync(new URL('stages.json', REPO), 'utf8'))
  stages.S7 = { ...stages.S7, role: 'at-reviewer' }
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-m4k-plug-')))
  try {
    cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
    cpSync(new URL('roster.json', REPO), join(plugin, 'roster.json'))
    writeFileSync(join(plugin, 'stages.json'), JSON.stringify(stages))
    withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
      const r = run('rework', closeWrite(runDir), join(plugin, 'hooks', 'boot.mjs'), projectDir)
      assert.equal(decisionOf(r.stdout), null)
      assert.ok(r.stderr.includes('认不出验收那一段'), r.stderr)
    })
  } finally {
    rmSync(plugin, { recursive: true, force: true })
  }
})

test('M4k 复核（中 2）：同一份验收结论批两次——第二次不记（回传说已经记过）；改过的验收结论上的旧批准不用来盖修订', () => {
  const putBase = (runDir) =>
    writeFileSync(join(runDir, 'contract-base.json'), JSON.stringify({ section1: '> 做一个待办清单。', body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: {}, revised_at: null }))
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    run('approval-prompt', prompted('照现状交付'), GATE, projectDir)
    const again = ctxOf(run('approval-ask', asked('照现状交付'), GATE, projectDir).stdout)
    assert.ok(again.includes('没有记成照现状交付的批准') && again.includes('已经记过'), again)
    assert.equal(approvalsOf(runDir).length, 1)
  })
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    putBase(runDir)
    run('approval-ask', asked('照现状交付'), GATE, projectDir)
    writeFileSync(join(runDir, '07-acceptance.md'), FAIL + '- 第 3 条：没过' + NL)
    writeFileSync(join(runDir, '00-contract.md'), CONTRACT + '### 2026-10-07 · 用户主动提出' + NL + '**改动**：加一条：能删。' + NL)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes('契约改了'), c)
  })
  // 批准记录里同一份 sha 有两行（Bash 写的、旧版本记的）：也只盖一次修订——第二次修订照标题分。
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    putBase(runDir)
    const line = JSON.stringify({ at: '2026-10-06T11:00:00.000Z', source: 'ask', kind: 'deliver-as-is', product: '07-acceptance.md', sha: sha(FAIL) })
    writeFileSync(join(runDir, 'approvals.jsonl'), line + NL + line.split('11:00').join('11:05') + NL)
    const first = CONTRACT + '### 2026-10-06 · 升级 #1（kind: contract-conflict）' + NL + '**用户裁决**：照现状交付。' + NL
    writeFileSync(join(runDir, '00-contract.md'), first)
    assert.ok(!ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout).includes('契约改了'))
    writeFileSync(join(runDir, '00-contract.md'), first + '### 2026-10-07 · 用户主动提出' + NL + '**改动**：加一条：能删。' + NL)
    const second = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(second.includes('契约改了'), second)
  })
})

test('M4k 复核（中 3）：防绕过——派发记录里在 S7 派出去过的 at-acceptance，删名字、写 trimmed 也翻不成整段裁掉；同一次写入里删名字、裁掉并收口也不行', () => {
  const dispatched = { stage: 'S8', history: upTo('S8'), roster: ['at-qa'], stage_roles: { S6: ['at-qa'], S7: [] }, trimmed: { 'at-acceptance': 'S7' } }
  withRun(dispatched, DONE(FAIL), ({ projectDir, runDir }) => {
    const line = dispatchLine({ at: '2026-10-06T10:00:00.000Z', agentId: 'a0000000000000a07', toolUseId: null, role: 'at-acceptance', stage: 'S7', caller: 'at-pm', callerId: null, mode: 'background' })
    writeFileSync(join(runDir, 'dispatches.jsonl'), line + NL)
    const d = decisionOf(run('rework', closeWrite(runDir), GATE, projectDir).stdout)
    assert.ok(d?.permissionDecision === 'deny' && d.permissionDecisionReason.includes('「结论：不通过」'), JSON.stringify(d))
  })
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    const w = stateWrite(runDir, (s) => ({ ...s, roster: ['at-qa'], stage_roles: { S6: ['at-qa'], S7: [] }, trimmed: { 'at-acceptance': 'S7' }, never_invoked: [], closed_at: '2026-10-06T12:00:00Z' }))
    const d = decisionOf(run('rework', w, GATE, projectDir).stdout)
    assert.ok(d?.permissionDecision === 'deny' && d.permissionDecisionReason.includes('「结论：不通过」'), JSON.stringify(d))
  })
})

test('M4k 复核（中 3、低 4）：记录器认对着上一版契约的——验收结论修订之前派出去、之后才交的；测试报告对着上一版契约的；S7 的【阶段】这时不提照现状交付', () => {
  const REV = '2026-10-06T10:30:00.000Z'
  const baseWith = (runDir, vb) =>
    writeFileSync(join(runDir, 'contract-base.json'), JSON.stringify({ section1: '> 做一个待办清单。', body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: vb, revised_at: REV }))
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    baseWith(runDir, {})
    const line = dispatchLine({ at: '2026-10-06T10:00:00.000Z', agentId: 'a0000000000000a07', toolUseId: null, role: 'at-acceptance', stage: 'S7', caller: 'at-pm', callerId: null, mode: 'background' })
    writeFileSync(join(runDir, 'dispatches.jsonl'), line + NL)
    const r = ctxOf(run('approval-ask', asked('照现状交付'), GATE, projectDir).stdout)
    assert.ok(r.includes('对着上一版契约'), r)
    assert.deepEqual(approvalsOf(runDir), [])
  })
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    baseWith(runDir, { '06-test.md': sha('test' + NL) })
    const r = ctxOf(run('approval-ask', asked('照现状交付'), GATE, projectDir).stdout)
    assert.ok(r.includes('对着上一版契约'), r)
    assert.deepEqual(approvalsOf(runDir), [])
  })
  withRun(S7_RUN, { '06-test.md': 'test' + NL, '07-acceptance.md': FAIL }, ({ projectDir, runDir }) => {
    baseWith(runDir, { '07-acceptance.md': sha(FAIL) })
    const c = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(!c.includes('「照现状交付」'), c)
  })
})

test('M4k H3：批准记录是门禁专属文件——拒绝理由说它也记照现状交付的批准', () => {
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    const write = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: join(runDir, 'approvals.jsonl'), content: '{}' } }
    const d = decisionOf(run('writepath', write, GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('照现状交付'), d.permissionDecisionReason)
  })
})

test('M4k 记录器：照现状交付那一问被排除（离开键盘）、读不到运行状态（current-run 不在）——回传说的是照现状交付那一种，什么都不记', () => {
  withRun(S8_RUN, DONE(FAIL), ({ projectDir, runDir }) => {
    const afk = ctxOf(run('approval-ask', asked('照现状交付', { afkTimeoutMs: 60000 }), GATE, projectDir).stdout)
    assert.ok(afk.includes('没有记成照现状交付的批准') && afk.includes('离开'), afk)
    rmSync(join(projectDir, '.agent-team', 'current-run'))
    const none = ctxOf(run('approval-ask', asked('照现状交付'), GATE, projectDir).stdout)
    assert.ok(none.includes('没有记成照现状交付的批准') && none.includes('读不到这个项目的运行状态'), none)
    assert.deepEqual(approvalsOf(runDir), [])
  })
})
