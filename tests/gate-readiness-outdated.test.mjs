// M4z（docs/61）：H2 认「对着上一版契约的验证段结论」——用户改了需求之后、回退之前，这类结论不算交了的前置。
//
// docs/45 §4「只把住推进与收口」：修订之后、回退之前，H2 的前置照旧当那几份结论交了。S7 里改了需求，06-test.md 还是对着上一版契约测的，
// 项目经理照样派得出 at-acceptance——验收对着一份过期的测试报告跑一趟，收口时 H6 照旧拦回去。认法与 H6、【阶段】同一份 outdatedProducts，
// 出路同一份 outdatedFix（看当前段）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { decideReadiness } from '../hooks/lib/readiness.mjs'
import { CONTRACT_BASE_FILE } from '../hooks/lib/control-files.mjs'

const S7_READY = ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md', '06-test.md']
const REVISED_AT = '2026-10-10T12:00:00Z'
const dispatch = (target, caller = 'agent-team:at-pm') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  agent_type: caller,
  tool_input: { subagent_type: target, prompt: 'x' },
})
const shaOf = (runDir, name) => sha256OfContract(readFileSync(join(runDir, name)))

// 一趟停在 stage 的 run：artifacts 都在，contract_sha 记的就是磁盘上的契约；base(runDir) 给出契约基线的内容（null 不写）。
function withRun({ stage, artifacts, base = () => null }, body) {
  const dirs = makeRun({ runId: 'r1', stage, artifacts })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    const statePath = join(runDir, 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.contract_sha = shaOf(runDir, '00-contract.md')
    writeFileSync(statePath, JSON.stringify(state))
    const b = base(runDir)
    if (b) writeFileSync(join(runDir, CONTRACT_BASE_FILE), JSON.stringify(b))
    return body({ ...dirs, runDir })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}
const revisedAfter = (...names) => (runDir) => ({ revisions: ['### 2026-10-10 用户主动提出'], verify_base: Object.fromEntries(names.map((n) => [n, shaOf(runDir, n)])), revised_at: REVISED_AT })
const decide = (dirs, target, caller) => decisionOf(run('readiness', dispatch(target, caller), undefined, dirs.projectDir).stdout)

test('H2（docs/61）：改了需求之后 06-test.md 没有重出——派 at-acceptance 拒，理由说它是对着上一版契约的结论、出路是回退到 S6', () => {
  withRun({ stage: 'S7', artifacts: S7_READY, base: revisedAfter('06-test.md') }, (dirs) => {
    const d = decide(dirs, 'agent-team:at-acceptance')
    assert.equal(d?.permissionDecision, 'deny')
    const why = d.permissionDecisionReason
    assert.ok(why.includes('06-test.md') && why.includes('上一版契约'), why)
    // 出路看当前段（S7）：06-test.md 在更早的 S6——照「回退」记回到 S6，不是「后面的段走到时照常重出」。
    assert.ok(why.includes('「回退」记回到 S6') && !why.includes('不用回退'), why)
    assert.ok(!why.includes('accepted'), '验证段的结论不给「标 accepted」：' + why)
  })
})

test('H2（docs/61）：06-test.md 在修订之后重写过（内容与修订那一刻不同）——放行', () => {
  withRun({ stage: 'S7', artifacts: S7_READY, base: revisedAfter('06-test.md') }, (dirs) => {
    writeFileSync(join(dirs.runDir, '06-test.md'), '对着这一版契约重测过的报告\n')
    assert.equal(decide(dirs, 'agent-team:at-acceptance'), null)
  })
})

test('H2（docs/61）：没有契约基线、或者改的需求没碰到它（verify_base 里没有、也没有派发记录）——照常放行', () => {
  withRun({ stage: 'S7', artifacts: S7_READY }, (dirs) => {
    assert.equal(decide(dirs, 'agent-team:at-acceptance'), null)
  })
  withRun({ stage: 'S7', artifacts: S7_READY, base: () => ({ revisions: [], verify_base: {}, revised_at: null }) }, (dirs) => {
    assert.equal(decide(dirs, 'agent-team:at-acceptance'), null)
  })
})

test('H2（docs/61）：S7 自己那份结论也在、也是对着上一版的——这一段不算齐，照样查前置、照样拒（原来「产物都在就跳过前置」）', () => {
  withRun({ stage: 'S7', artifacts: [...S7_READY, '07-acceptance.md'], base: revisedAfter('06-test.md', '07-acceptance.md') }, (dirs) => {
    const d = decide(dirs, 'agent-team:at-acceptance')
    assert.equal(d?.permissionDecision, 'deny')
    assert.ok(d.permissionDecisionReason.includes('06-test.md'), d.permissionDecisionReason)
  })
})

// ——— decideReadiness 的单测：H2 只传两个注入（哪份是对着上一版契约的、出路怎么说），判定在这里 ———
const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const have = new Set(S7_READY)
const base = {
  targetRole: 'at-acceptance',
  stages: STAGES,
  artifactExists: (n) => have.has(n),
  roster: ['at-qa'],
  caller: 'at-pm',
  callerReach: null,
}

test('decideReadiness（docs/61）：对着上一版契约的前置——项目经理拿到出路，写不了 state.json 的叫它冒泡；缺的、还旧的先说', () => {
  const pm = decideReadiness({ ...base, callerCanWriteState: true, artifactOutdated: (n) => n === '06-test.md', outdatedOut: () => '出路文字' })
  assert.equal(pm.decision, 'deny')
  assert.ok(pm.reason.includes('06-test.md') && pm.reason.includes('出路文字') && pm.reason.includes('再派 at-acceptance'), pm.reason)
  const other = decideReadiness({ ...base, callerCanWriteState: false, artifactOutdated: (n) => n === '06-test.md', outdatedOut: () => '出路文字' })
  assert.equal(other.decision, 'deny')
  assert.ok(other.reason.includes('冒泡') && !other.reason.includes('再派 at-acceptance'), other.reason)
  // 缺的先说：缺的那一句，不说上一版契约。
  const missing = decideReadiness({ ...base, artifactExists: (n) => n !== '01-prd.md' && have.has(n), callerCanWriteState: true, artifactOutdated: (n) => n === '06-test.md', outdatedOut: () => '出路文字' })
  assert.ok(missing.reason.includes('01-prd.md') && !missing.reason.includes('上一版契约'), missing.reason)
  // 不在磁盘上的不算「对着上一版」。
  const gone = decideReadiness({ ...base, artifactExists: (n) => n !== '06-test.md' && have.has(n), callerCanWriteState: true, artifactOutdated: () => true, outdatedOut: () => 'x' })
  assert.ok(gone.reason.includes('还缺') && !gone.reason.includes('上一版契约'), gone.reason)
  // 不传注入：与原来一样放行。
  assert.equal(decideReadiness({ ...base, callerCanWriteState: true }).decision, 'allow')
})

test('正文（docs/61）：/agent-team:at 说对着上一版契约的结论重出之前不算交了的前置——门禁真的拒（上面几条）', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('').split('\n').join('')
  assert.ok(at.includes('重出之前它们也不算交了的前置：拿它们当前置的段派不出人。'), 'commands/at.md')
})
