// docs/71（docs/46 §4、docs/66 §4「验收那一段整段裁掉、测试跑不起来时，收口不读任何结论」）：验收那一段整段裁掉时，收口那一次 H6 读测试报告的第一行——
// 不是「结论：通过」的（跑不起来也算：这一趟没有一样验证过），只有用户经「照现状交付」批准过这一份才放行；两个记录器在验收整段裁掉、走过测试那一段时把批准
// 绑在测试报告上（跑不起来也记）；【阶段】的收口阻碍列它；记那条答复的修订不算改需求。验收那一段没裁的照旧读验收结论（tests/gate-acceptance.test.mjs）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { bodyShaOf } from '../hooks/lib/contract-base.mjs'

const NL = String.fromCharCode(10)
const sha = (s) => sha256OfContract(Buffer.from(s, 'utf8'))
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-11T10:00:00Z' }))
const CHAIN = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const CONTRACT = ['# 00 契约', '', '## 1. 用户原话', '', '> 做一个待办清单。', '', '## 2. PM 的理解（可改）', '', '- 命令行。', '', '## 4. 修订记录', ''].join(NL)
const ENV = '结论：跑不起来：缺 Docker' + NL + NL + '- 没跑：集成测试要 Docker' + NL
const FAIL = '结论：不通过' + NL + NL + '- 第 3 条挂了' + NL
const PASS = '结论：通过' + NL

// 停在 S8、验收那一段整段裁掉（at-acceptance 写进 trimmed、谁都没派过）。
const TRIMMED = { stage: 'S8', history: H(...CHAIN), roster: ['at-qa'], stage_roles: { S6: ['at-qa'], S7: [] }, trimmed: { 'at-acceptance': 'S7' } }
function withRun(opts, files, body) {
  const dirs = makeRun({ runId: 'r1', ...opts })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  for (const [name, text] of Object.entries({ '00-contract.md': CONTRACT, '08-delivery.md': 'delivery' + NL, ...files })) writeFileSync(join(runDir, name), text)
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
const closeWrite = (runDir) => stateWrite(runDir, (s) => ({ ...s, never_invoked: [], closed_at: '2026-10-11T12:00:00Z' }))
const close = (fx) => decisionOf(run('rework', closeWrite(fx.runDir), GATE, fx.projectDir).stdout)
const asked = (answer) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion',
  agent_type: 'agent-team:at-pm',
  tool_input: { questions: [{ question: '测试跑不起来、验收裁掉了，怎么办？', header: '交付', multiSelect: false, options: [] }] },
  tool_response: { questions: [{ question: '测试跑不起来、验收裁掉了，怎么办？', header: '交付', multiSelect: false, options: [] }], answers: { '测试跑不起来、验收裁掉了，怎么办？': answer } },
})
const posted = (file) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: file } })
const approvalsOf = (runDir) => {
  const f = join(runDir, 'approvals.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').split(NL).filter(Boolean).map((l) => JSON.parse(l)) : []
}

test('H6（docs/71）：验收整段裁掉、测试报告「结论：跑不起来」——收口拒，理由说没有一样验证过、给照现状交付与回退两条路；用户选「照现状交付」记在测试报告上，收口放行；报告再改一个字，批准不算了', () => {
  withRun(TRIMMED, { '06-test.md': ENV }, (fx) => {
    const d = close(fx)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    const why = d.permissionDecisionReason
    assert.ok(why.includes('验收那一段（S7）整段裁掉') && why.includes('06-test.md') && why.includes('「结论：跑不起来」') && why.includes('没有一样验证过'), why)
    assert.ok(why.includes('「照现状交付」') && why.includes('只对现在这份 06-test.md 有效') && why.includes('回退'), why)
    const r = run('approval-ask', asked('照现状交付'), GATE, fx.projectDir)
    assert.ok(ctxOf(r.stdout).includes('已记下照现状交付的批准') && ctxOf(r.stdout).includes('06-test.md'), r.stdout)
    assert.deepEqual(approvalsOf(fx.runDir).map((v) => [v.kind, v.product, v.sha]), [['deliver-as-is', '06-test.md', sha(ENV)]])
    assert.equal(close(fx), null, '批准之后收口放行')
    writeFileSync(join(fx.runDir, '06-test.md'), ENV + '- 补一句' + NL)
    assert.equal(close(fx)?.permissionDecision, 'deny', '报告改过之后批准不算')
  })
})

test('H6（docs/71）：验收整段裁掉——测试报告「结论：通过」照常收口；「结论：不通过」在 S6 时批过照现状交付的放行，没批过的拒；第一行读不出的拒', () => {
  withRun(TRIMMED, { '06-test.md': PASS }, (fx) => assert.equal(close(fx), null))
  withRun(TRIMMED, { '06-test.md': FAIL }, (fx) => {
    assert.equal(close(fx)?.permissionDecision, 'deny')
    writeFileSync(join(fx.runDir, 'approvals.jsonl'), JSON.stringify({ at: '2026-10-11T11:00:00Z', source: 'ask', kind: 'deliver-as-is', product: '06-test.md', sha: sha(FAIL) }) + NL)
    assert.equal(close(fx), null, 'S6 时批过的照现状交付照样认')
  })
  withRun(TRIMMED, { '06-test.md': 'test' + NL }, (fx) => {
    const d = close(fx)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes('读不出'), d.permissionDecisionReason)
  })
})

test('H6（docs/71）：测试那一段也整段裁掉（没有测试报告）——收口照旧不读；验收那一段没裁的照旧读验收结论、不读测试报告；推进（不是收口）不读', () => {
  const both = { stage: 'S8', history: H(...CHAIN), roster: [], stage_roles: { S6: [], S7: [] }, trimmed: { 'at-qa': 'S6', 'at-acceptance': 'S7' } }
  withRun(both, {}, (fx) => assert.equal(close(fx), null))
  // 两段都裁掉、磁盘上却留着一份测试报告（不是这一趟派人写的）——照样不读。
  withRun(both, { '06-test.md': ENV }, (fx) => assert.equal(close(fx), null))
  const full = { stage: 'S8', history: H(...CHAIN), roster: ['at-qa', 'at-acceptance'], stage_roles: { S6: ['at-qa'], S7: ['at-acceptance'] } }
  withRun(full, { '06-test.md': ENV, '07-acceptance.md': '结论：通过' + NL }, (fx) => assert.equal(close(fx), null))
  const s7 = { stage: 'S7', history: H(...CHAIN.slice(0, 7)), roster: ['at-qa'], stage_roles: { S6: ['at-qa'], S7: [] }, trimmed: { 'at-acceptance': 'S7' } }
  withRun(s7, { '06-test.md': ENV }, (fx) => {
    const adv = stateWrite(fx.runDir, (s) => ({ ...s, stage: 'S8', history: [...s.history, ...H('S8')] }))
    assert.equal(decisionOf(run('rework', adv, GATE, fx.projectDir).stdout), null)
  })
})

test('记录器（docs/71）：对话里单独发「照现状交付」那一路同样绑测试报告；验收没裁的、停在 S8 的照旧绑验收结论', () => {
  withRun(TRIMMED, { '06-test.md': ENV }, (fx) => {
    run('approval-prompt', { hook_event_name: 'UserPromptSubmit', prompt: '照现状交付' }, GATE, fx.projectDir)
    assert.deepEqual(approvalsOf(fx.runDir).map((v) => v.product), ['06-test.md'])
  })
  const full = { stage: 'S8', history: H(...CHAIN), roster: ['at-qa', 'at-acceptance'], stage_roles: { S6: ['at-qa'], S7: ['at-acceptance'] } }
  withRun(full, { '06-test.md': ENV, '07-acceptance.md': '结论：不通过' + NL }, (fx) => {
    run('approval-ask', asked('照现状交付'), GATE, fx.projectDir)
    assert.deepEqual(approvalsOf(fx.runDir).map((v) => v.product), ['07-acceptance.md'])
  })
})

test('【阶段】（docs/71）：S8、验收整段裁掉、测试报告跑不起来——收口阻碍里列它与出路，不说该收口了；批准之后说该收口了', () => {
  withRun(TRIMMED, { '06-test.md': ENV }, (fx) => {
    const c = ctxOf(run('ledger', posted(join(fx.runDir, 'state.json')), GATE, fx.projectDir).stdout)
    assert.ok(c.includes('06-test.md（') && c.includes('「结论：跑不起来」') && c.includes('「照现状交付」'), c)
    assert.ok(!c.includes('该收口了'), c)
    run('approval-ask', asked('照现状交付'), GATE, fx.projectDir)
    const after = ctxOf(run('ledger', posted(join(fx.runDir, 'state.json')), GATE, fx.projectDir).stdout)
    assert.ok(after.includes('该收口了'), after)
  })
})

test('契约基线（docs/71）：验收整段裁掉、停在 S8 批了照现状交付——之后记那条答复的修订不算改需求（记进 deliver_used），收口放行', () => {
  withRun(TRIMMED, { '06-test.md': ENV }, (fx) => {
    writeFileSync(join(fx.runDir, 'contract-base.json'), JSON.stringify({ section1: '> 做一个待办清单。', body_sha: bodyShaOf(CONTRACT), revisions: [], verify_base: {}, revised_at: null }))
    run('approval-ask', asked('照现状交付'), GATE, fx.projectDir)
    const revised = CONTRACT + '### 2026-10-11 · 升级 #1（kind: contract-conflict）' + NL + '**用户裁决**：照现状交付。' + NL
    writeFileSync(join(fx.runDir, '00-contract.md'), revised)
    run('ledger', posted(join(fx.runDir, '00-contract.md')), GATE, fx.projectDir)
    const base = JSON.parse(readFileSync(join(fx.runDir, 'contract-base.json'), 'utf8'))
    assert.deepEqual(base.deliver_used, [sha(ENV)], JSON.stringify(base))
  })
})

test('正文（docs/71）：/agent-team:at 第 6 节——验收整段裁掉的，门禁收口时改读测试报告的第一行、不是通过的要用户批过照现状交付', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
  const s6 = at.slice(at.indexOf('## 6. 收尾'))
  const flat = (s) => s.replace(/\s+/g, '')
  assert.ok(
    flat(s6).includes(
      flat(
        '这一趟整段裁掉了 `at-acceptance`（`trimmed` 里记着它在 S7、这一趟在 S7 没叫过它）的，没有验收结论：门禁收口时改读 `06-test.md` 的第一行——' +
          '不是「结论：通过」的（跑不起来也算：这一趟没有一样验证过），同样只有用户经「照现状交付」批准过、门禁记下了才放行；交付文档里照实写明这一趟没有验收。',
      ),
    ),
    '第 6 节那一句',
  )
  assert.ok(!flat(s6).includes(flat('这一步跳过')), '第 6 节还写着这一步跳过')
})
