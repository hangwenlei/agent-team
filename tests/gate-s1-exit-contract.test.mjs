// docs/63：推进出第一段那一次，这次写入的 contract_sha 要与磁盘上的契约对得上（H6）。
//
// docs/37 §5「PENDING 而契约不在，一律当还没写」：过了第一段契约丢了、contract_sha 还是 PENDING，派发返回与写 state.json 时都不报。
// 那一轮按阶段改 compareContractSha，一批停在后段、PENDING 又不写契约的夹具跟着变红，退回了。这里换一个更窄的做法：推进出第一段那一次就要
// 记上——之后 PENDING 而契约不在的那一格就走不到了（除非 Bash 改 state.json）。出路照用【契约】那一句。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, decisionOf, hermeticEnv } from './helpers/gate-runner.mjs'
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
    const dw = drift.permissionDecisionReason
    // 说的是这次写入里的值；不报磁盘上算出来的值。复核（docs/63 §8）：第一段里契约由项目经理写、可以改——出路是记最近一次写契约的回传，
    // 不说「契约被人改过、恢复原样」（照原话改第 1 节本身就不是第 4 节的修订，恢复原样会绕回原话那一条）。
    assert.ok(dw.includes('对不上') && dw.includes(OTHER) && !dw.includes(fx.disk), dw)
    assert.ok(dw.includes('还在 S1') && dw.includes('最近一次写契约') && !dw.includes('恢复原样'), dw)
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

// 契约在、这一次读不出（被占着）：不拦，留痕。复核（docs/63 §8）：用预加载让读契约抛异常（tests/helpers/inject-throw.cjs 的 read:），三个系统上都跑；
// 断言认这一条自己那一行——推进判据自己也会留一行「读不出」。
const INJECT = fileURLToPath(new URL('./helpers/inject-throw.cjs', import.meta.url))
test('H6（docs/63）：推进出 S1 时契约在却读不出——不按这一条拦，stderr 留痕', () => {
  inS1({}, (fx) => {
    const r = run('rework', advance(fx, 'PENDING'), undefined, fx.projectDir, { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: 'read:00-contract.md' }, { nodeArgs: ['-r', INJECT] })
    const d = decisionOf(r.stdout)
    assert.ok(d === null || !d.permissionDecisionReason.includes('推进出 S1 之前'), JSON.stringify(d))
    assert.ok(r.stderr.includes('推进出 S1 之前没核契约的账'), r.stderr)
  })
})

test('H6（复核 docs/63 §8）：一次写入里先回到 S1、再推进出来——同样核（分两次写要核的，写在一次里照样核）', () => {
  inS1({}, (fx) => {
    // 先停在 S2（记着契约的 sha），再一次写入：history 追加 S1、S2，rework_base 里契约标 accepted，contract_sha 写成 PENDING。
    const atS2 = { ...fx.state, stage: 'S2', contract_sha: fx.disk, history: H('S1', 'S2'), rework: reworkFromHistory(H('S1', 'S2')) }
    writeFileSync(fx.statePath, JSON.stringify(atS2))
    const hist = H('S1', 'S2', 'S1', 'S2')
    const both = { ...atS2, contract_sha: 'PENDING', history: hist, rework: reworkFromHistory(hist), rework_base: { '00-contract.md': 'accepted' } }
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: fx.statePath, content: JSON.stringify(both, null, 2) } }
    const d = decisionOf(run('rework', input, undefined, fx.projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('推进出 S1 之前'), d.permissionDecisionReason)
  })
})

test('H6（复核 docs/63 §8）：第 1 节对不上原话、契约的账也没记——先说原话那一句（改好第 1 节契约的哈希就变了），出路里一并说记上回传的 sha', () => {
  inS1({}, (fx) => {
    writeFileSync(join(fx.runDir, 'user-words.json'), JSON.stringify({ args: '做一个待办应用', session_id: 's-1', runs_before: [], bound: 'r1', dropped: null, binding: null }))
    const d = decide(fx, 'PENDING').d
    assert.equal(d?.permissionDecision, 'deny')
    const why = d.permissionDecisionReason
    assert.ok(why.includes('对不上用户在 /agent-team:at 后面写的原话') && !why.includes('推进出 S1 之前'), why)
    assert.ok(why.includes('改好之后把那一次写契约收到的【契约】回传给的 sha 记进 contract_sha'), why)
  })
})

test('正文（docs/63）：/agent-team:at 说推进出 S1 那一次门禁也对一遍契约的账、对不上不放行——门禁真的拒（上面几条）', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('').split('\n').join('')
  assert.ok(at.includes('推进出 `S1` 那一次、派验证段的产者（`at-qa`、`at-acceptance`）之前也对一遍，对不上不放行'), 'commands/at.md')
})
