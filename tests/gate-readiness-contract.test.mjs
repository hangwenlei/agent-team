// M4y（docs/60）：H2 派验证段的产者（stages.json 里 verifies: true 的段——at-qa、at-acceptance）之前核契约的账。
//
// at-acceptance 的正文对它承诺「漂了报给 PM，PM 处理完才派你」，门禁原来不拦：contract_sha 与磁盘上的契约对不上时照样派得出去。
// 结论出来之后再处理账，那份结论对着的可能正是一份要恢复原样的契约——恢复之后没有修订块，契约基线（docs/45）也不会叫它重出。
// 出路照用【契约】那一句（写 state.json、派发返回时同一句，hooks/lib/ledger.mjs 的 contractCheckNotice）；不报磁盘上算出来的值。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { verifyStageOf } from '../hooks/lib/stages.mjs'

const OTHER_SHA = 'sha256:' + 'b'.repeat(64)
const dispatch = (target, caller = 'agent-team:at-pm') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  agent_type: caller,
  tool_input: { subagent_type: target, prompt: 'x' },
})
const S6_READY = ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md']
const S7_READY = [...S6_READY, '06-test.md']

// 造一趟 run：artifacts 里的文件都在；contract 是 'match'（记的就是磁盘上的）、'drift'（记的是别的合法值）、'pending'、'invalid'、
// 'missing'（记着值、契约不在）、'unstarted'（PENDING、契约不在）。
function withRun({ stage, artifacts, contract }, body, gate = undefined) {
  const files = contract === 'missing' || contract === 'unstarted' ? artifacts.filter((a) => a !== '00-contract.md') : artifacts
  const dirs = makeRun({ runId: 'r1', stage, artifacts: files })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    const statePath = join(runDir, 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    const disk = files.includes('00-contract.md') ? sha256OfContract(readFileSync(join(runDir, '00-contract.md'))) : null
    state.contract_sha = { match: disk, drift: OTHER_SHA, pending: 'PENDING', invalid: 'not-a-sha', missing: OTHER_SHA, unstarted: 'PENDING' }[contract]
    writeFileSync(statePath, JSON.stringify(state))
    return body({ ...dirs, disk, gate })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}
const decide = (dirs, target, caller) => {
  const r = run('readiness', dispatch(target, caller), dirs.gate, dirs.projectDir)
  return { d: decisionOf(r.stdout), r }
}

test('H2（docs/60）：契约的账对得上——派 at-qa、at-acceptance 照常放行', () => {
  withRun({ stage: 'S6', artifacts: S6_READY, contract: 'match' }, (dirs) => {
    const { d, r } = decide(dirs, 'agent-team:at-qa')
    assert.equal(d, null, JSON.stringify(d) + r.stderr)
  })
  withRun({ stage: 'S7', artifacts: S7_READY, contract: 'match' }, (dirs) => {
    const { d, r } = decide(dirs, 'agent-team:at-acceptance')
    assert.equal(d, null, JSON.stringify(d) + r.stderr)
  })
})

test('H2（docs/60）：contract_sha 与磁盘上的契约对不上——拒派 at-qa、at-acceptance，理由是【契约】那一句加「处理完再派」，不报磁盘上算出来的值', () => {
  for (const [stage, artifacts, target] of [
    ['S6', S6_READY, 'agent-team:at-qa'],
    ['S7', S7_READY, 'agent-team:at-acceptance'],
  ]) {
    withRun({ stage, artifacts, contract: 'drift' }, (dirs) => {
      const { d, r } = decide(dirs, target)
      assert.equal(d?.permissionDecision, 'deny', target + r.stderr)
      const why = d.permissionDecisionReason
      assert.ok(why.includes('【契约】') && why.includes('对不上'), why)
      assert.ok(why.includes(target.replace('agent-team:', '')) && why.includes('处理完再派'), why)
      assert.ok(!why.includes(dirs.disk), '不报磁盘上算出来的值：' + why)
    })
  }
})

test('H2（docs/60）：PENDING 而契约在、contract_sha 不合法、记着值而契约不在——都拒，各给【契约】那一支的出路', () => {
  const cases = [
    ['pending', 'PENDING'],
    ['invalid', '不是合法的 sha256'],
    ['missing', '磁盘上没有 00-contract.md'],
  ]
  for (const [contract, says] of cases) {
    withRun({ stage: 'S6', artifacts: S6_READY, contract }, (dirs) => {
      const { d, r } = decide(dirs, 'agent-team:at-qa')
      assert.equal(d?.permissionDecision, 'deny', contract + r.stderr)
      assert.ok(d.permissionDecisionReason.includes(says) && d.permissionDecisionReason.includes('处理完再派'), contract + '：' + d.permissionDecisionReason)
    })
  }
})

test('H2（docs/60）：只管验证段的产者——契约的账对不上时派 at-product、at-architect 不在这里拦（派发返回时【契约】照常说）', () => {
  withRun({ stage: 'S3', artifacts: ['00-contract.md', '01-prd.md'], contract: 'drift' }, (dirs) => {
    const { d, r } = decide(dirs, 'agent-team:at-architect')
    assert.equal(d, null, JSON.stringify(d) + r.stderr)
  })
  withRun({ stage: 'S2', artifacts: ['00-contract.md'], contract: 'drift' }, (dirs) => {
    const { d, r } = decide(dirs, 'agent-team:at-product')
    assert.equal(d, null, JSON.stringify(d) + r.stderr)
  })
})

test('H2（docs/60）：PENDING、契约还没写——不是契约的账的事，这一条不拦（前置缺不缺照旧由前置判）', () => {
  withRun({ stage: 'S6', artifacts: S6_READY, contract: 'unstarted' }, (dirs) => {
    const { d, r } = decide(dirs, 'agent-team:at-qa')
    assert.ok(d === null || !d.permissionDecisionReason.includes('处理完再派'), JSON.stringify(d) + r.stderr)
  })
})

test('H2（docs/60）：「验证段的产者」从 stages.json 的 verifies 派生——插件副本里把 S6 的 verifies 拿掉，派 at-qa 不再核契约的账', () => {
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-h2-verifies-')))
  try {
    const repo = new URL('../', import.meta.url)
    cpSync(new URL('hooks', repo), join(plugin, 'hooks'), { recursive: true })
    cpSync(new URL('roster.json', repo), join(plugin, 'roster.json'))
    const stages = JSON.parse(readFileSync(new URL('stages.json', repo), 'utf8'))
    delete stages.S6.verifies
    writeFileSync(join(plugin, 'stages.json'), JSON.stringify(stages), 'utf8')
    const gate = join(plugin, 'hooks', 'boot.mjs')
    withRun({ stage: 'S6', artifacts: S6_READY, contract: 'drift' }, (dirs) => {
      const { d, r } = decide(dirs, 'agent-team:at-qa')
      assert.equal(d, null, JSON.stringify(d) + r.stderr)
    }, gate)
    withRun({ stage: 'S7', artifacts: S7_READY, contract: 'drift' }, (dirs) => {
      const { d, r } = decide(dirs, 'agent-team:at-acceptance')
      assert.equal(d?.permissionDecision, 'deny', '没拿掉的 S7 照拒' + r.stderr)
    }, gate)
  } finally {
    rmSync(plugin, { recursive: true, force: true })
  }
})

test('verifyStageOf（docs/60）：验证段的产者回那一段（链上第一个），别的角色、阶段链读不出、角色不是字符串回 null', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  assert.equal(verifyStageOf(stages, 'at-qa'), 'S6')
  assert.equal(verifyStageOf(stages, 'at-acceptance'), 'S7')
  for (const role of ['at-product', 'at-architect', 'at-backend']) assert.equal(verifyStageOf(stages, role), null, role)
  assert.equal(verifyStageOf(null, 'at-qa'), null)
  assert.equal(verifyStageOf(stages, { toString: 1 }), null)
  const custom = { A: { producers: ['x', 'y'], produces: ['a.md'], verifies: true }, B: { role: 'y', produces: ['b.md'], verifies: true } }
  assert.equal(verifyStageOf(custom, 'y'), 'A', '链上第一个')
})

test('正文（docs/60）：/agent-team:at 与 at-acceptance 说派验证段之前门禁对一遍契约的账、对不上不放行——门禁真的拒（上面几条）', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('').split('\n').join('')
  assert.ok(at.includes('派验证段的产者（`at-qa`、`at-acceptance`）之前也对一遍，对不上不放行'), 'commands/at.md')
  const acc = readFileSync(new URL('../agents/at-acceptance.md', import.meta.url), 'utf8')
  assert.ok(acc.includes('派你之前门禁再对一遍，对不上不让派'), 'agents/at-acceptance.md')
})

// 契约在、这一次读不出（被别的程序占着）：不拦，留痕说没核。Windows 上造不出「在、却读不出」的文件，只在 POSIX 上用权限造。
test('H2（docs/60）：契约在却读不出——不拦，stderr 说这一次没核契约的账', { skip: process.platform === 'win32' }, () => {
  withRun({ stage: 'S6', artifacts: S6_READY, contract: 'drift' }, (dirs) => {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md')
    chmodSync(p, 0o000)
    try {
      if (process.getuid && process.getuid() === 0) return // root 无视权限位
      const { d, r } = decide(dirs, 'agent-team:at-qa')
      assert.ok(d === null || !d.permissionDecisionReason.includes('处理完再派'), JSON.stringify(d))
      assert.ok(r.stderr.includes('没核契约的账'), r.stderr)
    } finally {
      chmodSync(p, 0o644)
    }
  })
})
