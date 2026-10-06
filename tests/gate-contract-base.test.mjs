// M4j（docs/45，审查第 20 条与 docs/39 §3「契约修订之后，验证段的结论不要求重出」）：门禁子进程这一层——账本记下契约基线（推进出第一段
// 之后第一次见到 state.json）、契约修订时重拍验证段的快照并说【契约】、第 1 节变了说【契约】；H6 推进与收口时拒第 1 节变了的、拒对着
// 上一版契约的验证段结论；H3 对任何人写基线文件都拒。纯函数那一层在 tests/contract-base.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const NL = String.fromCharCode(10)
const sha = (s) => sha256OfContract(Buffer.from(s, 'utf8'))
const V1 = ['# 00 契约', '', '## 1. 用户原话', '', '> 做一个待办清单。', '', '## 2. PM 的理解（可改）', '', '- 命令行。', '', '## 4. 修订记录', ''].join(NL)
const V2 = V1 + '### 修订 1（用户主动提出）' + NL + '- 加一条：能删。' + NL
const DRIFTED = V1.replace('做一个待办清单。', '做一个待办清单，还要能删。')
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-06T10:00:00Z' }))
const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')

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

test('M4j 账本：推进出第一段之后第一次见到 state.json，记下第 1 节与整份契约的 sha；还在第一段时不记；记下之后不再改第 1 节', () => {
  withRun({ stage: 'S1', history: H('S1') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.ok(!existsSync(join(runDir, 'contract-base.json')), '还在 S1：不记')
  })
  withRun({ stage: 'S2', history: H('S1', 'S2') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.deepEqual(baseOf(runDir), { section1: '> 做一个待办清单。', contract_sha: sha(V1), verify_base: {} })
    writeFileSync(join(runDir, '00-contract.md'), DRIFTED)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.equal(baseOf(runDir).section1, '> 做一个待办清单。', '记下之后，再写 state.json 不改基线')
  })
})

test('M4j 账本：契约修订之后重拍验证段的快照，【契约】说哪几份对着上一版契约、照「回退」重出；契约没变不说', () => {
  withRun({ stage: 'S8', history: H('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    writeFileSync(join(runDir, '07-acceptance.md'), 'acc v1' + NL)
    writeFileSync(join(runDir, '00-contract.md'), V2)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(
      c.includes('【契约】契约改了：验证段已经写成的 06-test.md、07-acceptance.md 对着的是上一版契约（门禁记下了它们这一刻的样子）。' +
        '推进出验证段与收口之前，它们要对着这一版重出——照 /agent-team:at 第 3 节的「回退」记回到 S6，再派人重出。'),
      c,
    )
    assert.deepEqual(baseOf(runDir), {
      section1: '> 做一个待办清单。',
      contract_sha: sha(V2),
      verify_base: { '06-test.md': sha('test v1' + NL), '07-acceptance.md': sha('acc v1' + NL) },
    })
    const again = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!again.includes('契约改了'), again)
  })
})

test('M4j 账本：第 1 节变了，【契约】当场说改回去、修订写第 4 节', () => {
  withRun({ stage: 'S3', history: H('S1', 'S2', 'S3') }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), V1)
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    writeFileSync(join(runDir, '00-contract.md'), DRIFTED)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(
      c.includes('【契约】契约第 1 节是用户原话，推进出 S1 之后门禁记下了它（这一趟 run 目录里的 contract-base.json，section1 那一项）；' +
        '这次写入之后磁盘上的第 1 节跟它不一样。照它改回去——用户改了需求的，修订写进第 4 节「修订记录」，第 1 节原样留着。改回去之前，推进与收口都会被拒。'),
      c,
    )
  })
})

test('M4j H6：推进出 S6 时，对着上一版契约的测试报告拒（回退到 S6 重出）；重出之后放行；第 1 节变了也拒', () => {
  const history = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6')
  withRun({ stage: 'S6', history, roster: ['at-qa'], stage_roles: { S6: ['at-qa'] } }, ({ projectDir, runDir }) => {
    const statePath = join(runDir, 'state.json')
    const before = JSON.parse(readFileSync(statePath, 'utf8'))
    writeFileSync(statePath, JSON.stringify({ ...before, rework: reworkFromHistory(history) }))
    writeFileSync(join(runDir, '00-contract.md'), V1)
    writeFileSync(join(runDir, '06-test.md'), 'test v1' + NL)
    writeFileSync(join(runDir, 'contract-base.json'), JSON.stringify({ section1: '> 做一个待办清单。', contract_sha: sha(V1), verify_base: { '06-test.md': sha('test v1' + NL) } }))
    const now = JSON.parse(readFileSync(statePath, 'utf8'))
    const next = [...history, ...H('S7')]
    const after = { ...now, stage: 'S7', history: next, rework: reworkFromHistory(next) }
    const write = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath, content: JSON.stringify(after, null, 2) } }
    const d = decisionOf(run('rework', write, GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('契约在 06-test.md 写成之后改过') && d.permissionDecisionReason.includes('「回退」记回到 S6'), d.permissionDecisionReason)
    writeFileSync(join(runDir, '06-test.md'), 'test v2' + NL)
    assert.equal(decisionOf(run('rework', write, GATE, projectDir).stdout), null, '重出之后放行')
    writeFileSync(join(runDir, '00-contract.md'), DRIFTED)
    const drift = decisionOf(run('rework', write, GATE, projectDir).stdout)
    assert.ok(drift?.permissionDecision === 'deny' && drift.permissionDecisionReason.includes('契约第 1 节是用户原话'), JSON.stringify(drift))
  })
})

test('M4j H3：契约基线是门禁专属文件——项目经理写它也拒', () => {
  withRun({ stage: 'S3', history: H('S1', 'S2', 'S3') }, ({ projectDir, runDir }) => {
    const write = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: join(runDir, 'contract-base.json'), content: '{}' } }
    const d = decisionOf(run('writepath', write, GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('这是门禁记下的契约基线'), d.permissionDecisionReason)
  })
})
