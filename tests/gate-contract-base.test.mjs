// M4j（docs/45，审查第 20 条与 docs/39 §3「契约修订之后，验证段的结论不要求重出」）：门禁子进程这一层——账本记下契约基线（推进出第一段
// 之后第一次见到 state.json）、契约修订时按修订块标题分（改需求的重拍验证段的快照并说【契约】，不改需求的答复只换指纹）、第 1 节变了说
// 【契约】、已经收口的只说另起一趟；H6 推进与收口时拒第 1 节变了的、拒对着上一版契约的验证段结论（出路看当前段；修订那一刻还在跑的
// 验证段角色交的也算）；【阶段】的收口阻碍里同样列它；H3 对任何人写基线文件都拒。纯函数那一层在 tests/contract-base.test.mjs。
// 复核（docs/45 §8）之后整份重写。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { bodyShaOf } from '../hooks/lib/contract-base.mjs'
import { dispatchLine } from '../hooks/lib/completion.mjs'

const NL = String.fromCharCode(10)
const BOM = String.fromCharCode(0xfeff)
const sha = (s) => sha256OfContract(Buffer.from(s, 'utf8'))
const V1 = ['# 00 契约', '', '## 1. 用户原话', '', '> 做一个待办清单。', '', '## 2. PM 的理解（可改）', '', '- 命令行。', '', '## 4. 修订记录', ''].join(NL)
const USER = V1 + '### 2026-10-06 · 用户主动提出' + NL + '**改动**：加一条：能删。' + NL
const ADMIN = V1 + '### 2026-10-06 · 升级 #1（kind: env-blocked）' + NL + '**用户裁决**：照现状交付。' + NL
const DRIFTED = V1.replace('做一个待办清单。', '做一个待办清单，还要能删。')
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-06T10:00:00Z' }))
const CHAIN = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const upTo = (s) => H(...CHAIN.slice(0, CHAIN.indexOf(s) + 1))
const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const PAST = '2026-01-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

function withRun(opts, body) {
  const dirs = makeRun({ runId: 'r1', ...opts })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  try {
    return body({ ...dirs, runDir })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}
const posted = (file) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: file } })
const baseOf = (runDir) => JSON.parse(readFileSync(join(runDir, 'contract-base.json'), 'utf8'))
const putBase = (runDir, over = {}) =>
  writeFileSync(join(runDir, 'contract-base.json'), JSON.stringify({ section1: '> 做一个待办清单。', body_sha: bodyShaOf(V1), revisions: [], verify_base: {}, revised_at: null, ...over }))
const qaDispatch = (at, agentId = 'a0000000000000c01') =>
  dispatchLine({ at, agentId, toolUseId: null, role: 'at-qa', stage: 'S6', caller: 'at-pm', callerId: null, mode: 'background' })

test('M4j 账本：推进出第一段之后第一次见到 state.json 记基线；还在第一段、契约还不在时不记（下一次再记）；记下之后不改', () => {
  withRun({ stage: 'S1', history: upTo('S1') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.ok(!existsSync(join(runDir, 'contract-base.json')), '还在 S1：不记')
  })
  withRun({ stage: 'S2', history: upTo('S2') }, ({ projectDir, runDir }) => {
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.ok(!existsSync(join(runDir, 'contract-base.json')), '复核（K03）：契约还不在——不记，下一次再记')
    writeFileSync(join(runDir, '00-contract.md'), V1)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.deepEqual(baseOf(runDir), { section1: '> 做一个待办清单。', body_sha: bodyShaOf(V1), revisions: [], verify_base: {}, revised_at: null, deliver_used: [] })
    writeFileSync(join(runDir, '00-contract.md'), DRIFTED)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.equal(baseOf(runDir).section1, '> 做一个待办清单。', '记下之后，再写 state.json 不改基线')
  })
})

test('M4j 账本（复核 F8）：契约里切不出第 1 节——记下基线时说一句不锁第 1 节', () => {
  withRun({ stage: 'S2', history: upTo('S2') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1.replace('## 1. 用户原话', '## 用户原话'))
    const c = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(c.includes('【契约】契约里切不出第 1 节'), c)
    assert.equal(baseOf(runDir).section1, null)
  })
})

test('M4j 账本：改需求的修订——重拍快照、说哪几份对着上一版契约与出路（看当前段）；不改需求的答复（复核 F3）只换指纹、不说；契约没变不说', () => {
  withRun({ stage: 'S8', history: upTo('S8') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    putBase(runDir)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    writeFileSync(join(runDir, '07-acceptance.md'), 'acc v1' + NL)
    writeFileSync(join(runDir, '00-contract.md'), ADMIN)
    const admin = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!admin.includes('契约改了'), admin)
    assert.deepEqual(baseOf(runDir).verify_base, {}, '不改需求的答复：不重拍')
    assert.deepEqual(baseOf(runDir).revisions, ['### 2026-10-06 · 升级 #1（kind: env-blocked）'])
    const user = ADMIN + NL + '### 2026-10-07 · 用户主动提出' + NL + '**改动**：加一条：能删。' + NL
    writeFileSync(join(runDir, '00-contract.md'), user)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(
      c.includes('【契约】契约改了：验证段已经写成的 06-test.md、07-acceptance.md 对着的是上一版契约（门禁记下了它们这一刻的样子）。' +
        '推进出验证段与收口之前，它们要对着这一版重出——照 /agent-team:at 第 3 节的「回退」记回到 S6，让产者对着这一版重出。'),
      c,
    )
    const b = baseOf(runDir)
    assert.deepEqual(b.verify_base, { '06-test.md': sha('test v1' + NL), '07-acceptance.md': sha('acc v1' + NL) })
    assert.ok(typeof b.revised_at === 'string' && b.body_sha === bodyShaOf(user), JSON.stringify(b))
    const again = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!again.includes('契约改了'), again)
    // 改需求之后再加一块不改需求的答复：快照原样留着，不再说「契约改了」。
    writeFileSync(join(runDir, '00-contract.md'), user + NL + '### 2026-10-08 · 升级 #2（kind: sensitive）' + NL + '**用户裁决**：批准删掉旧目录。' + NL)
    const later = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!later.includes('契约改了'), later)
    assert.deepEqual(baseOf(runDir).verify_base, b.verify_base)
  })
})

test('M4j 账本（复核 F4）：修订那一刻还在跑的验证段角色——【契约】点名它，停下之后同段重派', () => {
  withRun({ stage: 'S6', history: upTo('S6') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    putBase(runDir)
    writeFileSync(join(runDir, 'dispatches.jsonl'), qaDispatch(PAST) + NL)
    writeFileSync(join(runDir, '00-contract.md'), USER)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes('还在跑的 at-qa（S6）：门禁没见它停下，它交的结论同样算对着上一版契约——停下之后在那一段同段重派它重出。'), c)
  })
})

test('M4j 账本：第 1 节变了说【契约】；只改第 1 节不算修订（复核 F2）', () => {
  withRun({ stage: 'S8', history: upTo('S8') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    putBase(runDir)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    writeFileSync(join(runDir, '00-contract.md'), DRIFTED)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(
      c.includes('【契约】契约第 1 节是用户原话，推进出 S1 之后门禁记下了它（这一趟 run 目录里的 contract-base.json，section1 那一项）；' +
        '这次写入之后磁盘上的第 1 节跟它不一样。照它改回去——用户改了需求的，修订写进第 4 节「修订记录」，第 1 节原样留着。改回去之前，推进与收口都会被拒。'),
      c,
    )
    assert.ok(!c.includes('契约改了'), c)
    assert.deepEqual(baseOf(runDir).verify_base, {}, '只改第 1 节：不重拍')
  })
})

test('M4j 账本（复核 F11）：已经收口的 run 上改契约——只说另起一趟，不给回退', () => {
  withRun({ stage: 'S8', history: upTo('S8') }, ({ projectDir, runDir }) => {
    const statePath = join(runDir, 'state.json')
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), closed_at: '2026-10-06T12:00:00Z' }))
    writeFileSync(join(runDir, '00-contract.md'), V1)
    putBase(runDir)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    writeFileSync(join(runDir, '00-contract.md'), USER)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes('【契约】这一趟已经收口：收口之后改契约') && !c.includes('「回退」'), c)
  })
})

// ---- H6 ----

function advanceS6(runDir) {
  const statePath = join(runDir, 'state.json')
  const now = JSON.parse(readFileSync(statePath, 'utf8'))
  const next = [...upTo('S6'), ...H('S7')]
  return { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath, content: JSON.stringify({ ...now, stage: 'S7', history: next, rework: reworkFromHistory(next) }, null, 2) } }
}
const s6Run = { stage: 'S6', history: upTo('S6'), roster: ['at-qa'], stage_roles: { S6: ['at-qa'] } }

test('M4j H6：推进出 S6 时对着上一版契约的测试报告拒，出路是同段重派（复核 F1）；重出之后放行；第 1 节变了也拒', () => {
  withRun(s6Run, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    putBase(runDir, { verify_base: { '06-test.md': sha('test v1' + NL) }, revised_at: '2026-10-06T10:30:00.000Z' })
    const d = decisionOf(run('rework', advanceS6(runDir), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('契约在 06-test.md 写成之后改过') && d.permissionDecisionReason.includes('在 S6 里同段重派它的产者重出'), d.permissionDecisionReason)
    assert.ok(!d.permissionDecisionReason.includes('「回退」'), d.permissionDecisionReason)
    writeFileSync(join(runDir, '06-test.md'), 'test v2' + NL)
    assert.equal(decisionOf(run('rework', advanceS6(runDir), GATE, projectDir).stdout), null, '重出之后放行')
    writeFileSync(join(runDir, '00-contract.md'), DRIFTED)
    const drift = decisionOf(run('rework', advanceS6(runDir), GATE, projectDir).stdout)
    assert.ok(drift?.permissionDecision === 'deny' && drift.permissionDecisionReason.includes('契约第 1 节是用户原话'), JSON.stringify(drift))
  })
})

test('M4j H6（复核 F4）：修订之前派出去、之后才交的测试报告也算对着上一版契约；修订之后重派过的放行', () => {
  withRun(s6Run, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), USER)
    writeFileSync(join(runDir, '06-test.md'), 'test written after revision' + NL)
    putBase(runDir, { body_sha: bodyShaOf(USER), revisions: ['### 2026-10-06 · 用户主动提出'], verify_base: {}, revised_at: '2026-10-06T10:30:00.000Z' })
    writeFileSync(join(runDir, 'dispatches.jsonl'), qaDispatch(PAST) + NL)
    const d = decisionOf(run('rework', advanceS6(runDir), GATE, projectDir).stdout)
    assert.ok(d?.permissionDecision === 'deny' && d.permissionDecisionReason.includes('契约在 06-test.md 写成之后改过'), JSON.stringify(d))
    writeFileSync(join(runDir, 'dispatches.jsonl'), qaDispatch(PAST) + NL + qaDispatch(FUTURE, 'a0000000000000c02') + NL)
    assert.equal(decisionOf(run('rework', advanceS6(runDir), GATE, projectDir).stdout), null, '修订之后重派过：放行')
  })
})

// 复核（K01）：H6 里契约判据排在缺、空、上一轮的、返工预算这些判据之后——返工轮里一份结论既是上一轮的（rework_base）、又对着上一版契约，
// 先给「上一轮的」那条（重跑之后重写），不叫它再记一次回退。
test('M4j H6（复核 K01）：返工轮里推进出 S6，测试报告既是上一轮的又对着上一版契约——先给 rework_base 那条理由', () => {
  const history = [...upTo('S8'), ...H('S6')]
  withRun({ stage: 'S6', history, roster: ['at-qa'], stage_roles: { S6: ['at-qa'] } }, ({ projectDir, runDir }) => {
    const statePath = join(runDir, 'state.json')
    writeFileSync(join(runDir, '00-contract.md'), V1)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    const t1 = sha('test v1' + NL)
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), rework: reworkFromHistory(history), rework_base: { '06-test.md': t1 } }))
    putBase(runDir, { verify_base: { '06-test.md': t1 }, revised_at: '2026-10-06T10:30:00.000Z' })
    const now = JSON.parse(readFileSync(statePath, 'utf8'))
    const next = [...history, ...H('S7')]
    const write = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath, content: JSON.stringify({ ...now, stage: 'S7', history: next, rework: reworkFromHistory(next) }, null, 2) } }
    const d = decisionOf(run('rework', write, GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('rework_base') && !d.permissionDecisionReason.includes('契约在'), d.permissionDecisionReason)
  })
})

test('M4j H6（复核 F7）：基线带 BOM 照样读；读不出来不拦、留一行痕', () => {
  withRun(s6Run, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), DRIFTED)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    writeFileSync(join(runDir, 'contract-base.json'), BOM + JSON.stringify({ section1: '> 做一个待办清单。', body_sha: bodyShaOf(V1), revisions: [], verify_base: {}, revised_at: null }))
    const d = decisionOf(run('rework', advanceS6(runDir), GATE, projectDir).stdout)
    assert.ok(d?.permissionDecision === 'deny' && d.permissionDecisionReason.includes('契约第 1 节是用户原话'), JSON.stringify(d))
    writeFileSync(join(runDir, 'contract-base.json'), '{"section1": "> 做一个待')
    const r = run('rework', advanceS6(runDir), GATE, projectDir)
    assert.equal(decisionOf(r.stdout), null)
    assert.ok(r.stderr.includes('契约基线') && r.stderr.includes('读不出来'), r.stderr)
    // 账本见到读不出来的基线：不重记（重记会把改过的第 1 节洗成基线），留痕。
    const led = run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.equal(readFileSync(join(runDir, 'contract-base.json'), 'utf8'), '{"section1": "> 做一个待', '读不出来的基线原样留着')
    assert.ok(led.stderr.includes('契约基线在却读不出来'), led.stderr)
  })
})

test('M4j 【阶段】（复核 F6）：S8 齐了、却有对着上一版契约的结论——收口阻碍里列它与出路，不说该收口了', () => {
  withRun({ stage: 'S8', history: upTo('S8'), roster: ['at-qa', 'at-acceptance'], stage_roles: { S6: ['at-qa'], S7: ['at-acceptance'] } }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), USER)
    for (const [f, t] of [['06-test.md', 'test v1'], ['07-acceptance.md', 'acc v2'], ['08-delivery.md', 'del v2']]) writeFileSync(join(runDir, f), t + NL)
    putBase(runDir, { body_sha: bodyShaOf(USER), revisions: ['### 2026-10-06 · 用户主动提出'], verify_base: { '06-test.md': sha('test v1' + NL) }, revised_at: '2026-10-06T10:30:00.000Z' })
    const c = ctxOf(run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir).stdout)
    assert.ok(c.includes('06-test.md（对着上一版契约：契约在它写成之后改过——照 /agent-team:at 第 3 节的「回退」记回到 S6，让产者对着这一版重出）'), c)
  })
})

test('M4j H3：契约基线是门禁专属文件——项目经理写它也拒，理由说它是契约基线', () => {
  withRun({ stage: 'S3', history: upTo('S3') }, ({ projectDir, runDir }) => {
    const write = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: join(runDir, 'contract-base.json'), content: '{}' } }
    const d = decisionOf(run('writepath', write, GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('这是门禁记下的契约基线'), d.permissionDecisionReason)
  })
})
