// docs/63：推进出第一段那一次，这次写入的 contract_sha 要与磁盘上的契约对得上（H6）。
//
// docs/37 §5「PENDING 而契约不在，一律当还没写」：过了第一段契约丢了、contract_sha 还是 PENDING，派发返回与写 state.json 时都不报。
// 那一轮按阶段改 compareContractSha，一批停在后段、PENDING 又不写契约的夹具跟着变红，退回了。这里换一个更窄的做法：推进出第一段那一次就要
// 记上——之后 PENDING 而契约不在的那一格就走不到了（除非 Bash 改 state.json）。出路照用【契约】那一句。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'

const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-10T12:00:00Z' }))
const OTHER = 'sha256:' + 'c'.repeat(64)

// 停在 S1 的一趟：契约在（contract 为 false 时不在）；state.json 的 contract_sha 是 recorded。
function inS1({ recorded = 'PENDING', contract = true } = {}, body) {
  const dirs = makeRun({ runId: 'r1', stage: 'S1', artifacts: contract ? ['00-contract.md'] : [] })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    const statePath = join(runDir, 'state.json')
    const state = { ...JSON.parse(readFileSync(statePath, 'utf8')), contract_sha: recorded, history: H('S1'), rework: {} }
    writeFileSync(statePath, JSON.stringify(state))
    const disk = contract ? sha256OfContract(readFileSync(join(runDir, '00-contract.md'))) : null
    return body({ ...dirs, runDir, statePath, state, disk })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}
// 项目经理推进到 S2 的那一次写入；sha 是这次写入里的 contract_sha。
const advance = (fx, sha) => {
  const after = { ...fx.state, stage: 'S2', contract_sha: sha, history: H('S1', 'S2'), rework: reworkFromHistory(H('S1', 'S2')) }
  return { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath, content: JSON.stringify(after, null, 2) } }
}
const decide = (fx, sha) => {
  const r = run('rework', advance(fx, sha), undefined, fx.projectDir)
  return { d: decisionOf(r.stdout), r }
}

test('H6（docs/63）：推进出 S1 的这次写入里 contract_sha 记的就是磁盘上的契约——放行', () => {
  inS1({}, (fx) => {
    const { d, r } = decide(fx, fx.disk)
    assert.equal(d, null, JSON.stringify(d) + r.stderr)
  })
})

test('H6（docs/63）：推进出 S1 时 contract_sha 还是 PENDING——拒，出路是【契约】那一句（记写契约那一次回传给的值，不报磁盘上算出来的值以外的东西）', () => {
  inS1({}, (fx) => {
    const { d } = decide(fx, 'PENDING')
    assert.equal(d?.permissionDecision, 'deny')
    const why = d.permissionDecisionReason
    assert.ok(why.includes('推进出 S1') && why.includes('【契约】') && why.includes('PENDING'), why)
  })
})

test('H6（docs/63）：推进出 S1 时 contract_sha 记的是别的合法值、不是合法的 sha——拒，各给【契约】那一支的出路；漂了的不报磁盘上算出来的值', () => {
  inS1({}, (fx) => {
    const drift = decide(fx, OTHER).d
    assert.equal(drift?.permissionDecision, 'deny')
    assert.ok(drift.permissionDecisionReason.includes('对不上') && !drift.permissionDecisionReason.includes(fx.disk), drift.permissionDecisionReason)
    const invalid = decide(fx, 'not-a-sha').d
    assert.equal(invalid?.permissionDecision, 'deny')
    assert.ok(invalid.permissionDecisionReason.includes('不是合法的 sha256'), invalid.permissionDecisionReason)
  })
})

test('H6（docs/63）：不是推进出 S1 的写入（S1 里原地重写、记 PENDING）不核——S1 里写契约之前、记账之前照常写 state.json', () => {
  inS1({}, (fx) => {
    const same = { ...fx.state, contract_sha: 'PENDING' }
    const r = run('rework', { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath, content: JSON.stringify(same, null, 2) } }, undefined, fx.projectDir)
    assert.equal(decisionOf(r.stdout), null, r.stdout)
  })
})

// 契约在、这一次读不出（被占着）：不拦，留痕。Windows 上造不出，只在 POSIX 上用权限造。
test('H6（docs/63）：推进出 S1 时契约在却读不出——不按这一条拦，stderr 留痕', { skip: process.platform === 'win32' }, () => {
  inS1({}, (fx) => {
    const p = join(fx.runDir, '00-contract.md')
    chmodSync(p, 0o000)
    try {
      if (process.getuid && process.getuid() === 0) return
      const { d, r } = decide(fx, 'PENDING')
      assert.ok(d === null || !d.permissionDecisionReason.includes('推进出 S1 之前'), JSON.stringify(d))
      assert.ok(r.stderr.includes('读不出') , r.stderr)
    } finally {
      chmodSync(p, 0o644)
    }
  })
})

test('正文（docs/63）：/agent-team:at 说推进出 S1 那一次门禁也对一遍契约的账、对不上不放行——门禁真的拒（上面几条）', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('').split('\n').join('')
  assert.ok(at.includes('推进出 `S1` 那一次、派验证段的产者（`at-qa`、`at-acceptance`）之前也对一遍，对不上不放行'), 'commands/at.md')
})
