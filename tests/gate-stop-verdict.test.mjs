// docs/62：H5b 在验收角色停下那一刻核验收结论的首行（docs/46 §4「H5b 不核首行格式」）。
//
// 验收结论第一个非空行固定写「结论：通过」「结论：不通过」「结论：判不了」之一（hooks/lib/verdict.mjs 的 acceptanceVerdict）。原来 at-acceptance
// 写坏了首行照样停得下，写入那一刻的【阶段】叫它改、它不改也拦不住；要等项目经理推进出验收那一段时 H6 拒，再同段重派一次。现在它在验收那一段停下、
// 产物齐了、首行却读不出时 H5b 拦，叫它当场改；冒泡的出口照旧。只核格式，不判过没过——不通过、判不了照样放它停下。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { BUBBLE_MARK } from '../hooks/lib/deliverable.mjs'
import { VERDICT_LINES } from '../hooks/lib/verdict.mjs'

const ACC = 'agent-team:at-acceptance'
const S7_FILES = ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md', '06-test.md']
const stop = (agent, { active, message } = {}) => ({
  hook_event_name: 'SubagentStop',
  agent_type: agent,
  agent_id: 'a0000000000000071',
  ...(active === undefined ? {} : { stop_hook_active: active }),
  ...(message === undefined ? {} : { last_assistant_message: message }),
})

// 停在 stage 的一趟 run；verdict 是 07-acceptance.md 的内容（null 不写）。
function inRun({ stage = 'S7', verdict, files = S7_FILES, extra = {} }, body) {
  const dirs = makeRun({ runId: 'r1', stage, artifacts: files, roster: ['at-qa', 'at-acceptance'] })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    if (verdict !== null && verdict !== undefined) writeFileSync(join(runDir, '07-acceptance.md'), verdict)
    if (Object.keys(extra).length) {
      const p = join(runDir, 'state.json')
      writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), ...extra }))
    }
    return body({ ...dirs, runDir })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('H5b（docs/62）：at-acceptance 在 S7 停下、07-acceptance.md 第一行读不出验收结论——拦，叫它把第一行改成三种之一再停，冒泡的出口照旧', () => {
  inRun({ verdict: '# 验收报告\n\n结论：通过\n\n- 第 1 条：过\n' }, (dirs) => {
    const r = run('stop-gate', stop(ACC), GATE, dirs.projectDir)
    assert.equal(r.status, 2, r.stderr)
    assert.ok(r.stderr.includes('07-acceptance.md') && r.stderr.includes('第一行读不出验收结论'), r.stderr)
    for (const l of VERDICT_LINES) assert.ok(r.stderr.includes(`「${l}」`), l)
    assert.ok(r.stderr.includes(BUBBLE_MARK), '冒泡的出口照旧：' + r.stderr)
    // 派发记录记下这一回停下是拦。
    const log = readFileSync(join(dirs.runDir, 'dispatches.jsonl'), 'utf8')
    assert.ok(log.includes('"outcome":"block"') && log.includes('"role":"at-acceptance"'), log)
  })
})

test('H5b（docs/62）：首行是三种之一——放行；不通过、判不了照样放行（只核格式，不判过没过）', () => {
  for (const verdict of ['结论：通过\n', '结论：不通过（第 2 条没过）\n', '结论：判不了\n\n契约第 3 条没写清楚\n', '\n\n**结论：通过**\n']) {
    inRun({ verdict }, (dirs) => {
      const r = run('stop-gate', stop(ACC), GATE, dirs.projectDir)
      assert.equal(r.status, 0, JSON.stringify(verdict) + r.stderr)
    })
  }
})

test('H5b（docs/62）：被拦过一回、最后一条回复第一行是「冒泡：」——放它停下', () => {
  inRun({ verdict: '# 验收报告\n' }, (dirs) => {
    const r = run('stop-gate', stop(ACC, { active: true, message: `${BUBBLE_MARK}契约第 3 条与第 5 条冲突，结论写不出来。` }), GATE, dirs.projectDir)
    assert.equal(r.status, 0, r.stderr)
  })
})

test('H5b（docs/62）：只管验收角色在验收那一段——at-qa 的测试报告不核首行；at-acceptance 不在验收那一段停下、这一趟收了口的不核', () => {
  inRun({ stage: 'S6', verdict: null, files: ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md', '06-test.md'] }, (dirs) => {
    writeFileSync(join(dirs.runDir, '06-test.md'), '# 测试报告\n')
    assert.equal(run('stop-gate', stop('agent-team:at-qa'), GATE, dirs.projectDir).status, 0)
  })
  inRun({ verdict: '# 验收报告\n' }, (dirs) => {
    const r = run('stop-gate', stop('agent-team:at-qa'), GATE, dirs.projectDir)
    assert.ok(!r.stderr.includes('第一行读不出验收结论'), 'at-qa 在 S7 停下：' + r.stderr)
  })
  inRun({ stage: 'S6', verdict: '# 验收报告\n' }, (dirs) => {
    const r = run('stop-gate', stop(ACC), GATE, dirs.projectDir)
    assert.ok(!r.stderr.includes('第一行读不出验收结论'), r.stderr)
  })
  inRun({ stage: 'S8', verdict: '# 验收报告\n', files: [...S7_FILES, '08-delivery.md'], extra: { closed_at: '2026-10-10T12:00:00Z' } }, (dirs) => {
    const r = run('stop-gate', stop(ACC), GATE, dirs.projectDir)
    assert.ok(!r.stderr.includes('第一行读不出验收结论'), r.stderr)
  })
})

test('H5b（docs/62）：07-acceptance.md 还没写、是空文件——照旧是「还没有写到磁盘上」「是空文件」那一句，不说首行', () => {
  for (const verdict of [null, '']) {
    inRun({ verdict }, (dirs) => {
      const r = run('stop-gate', stop(ACC), GATE, dirs.projectDir)
      assert.equal(r.status, 2, r.stderr)
      assert.ok(!r.stderr.includes('第一行读不出验收结论'), r.stderr)
    })
  }
})

test('正文（docs/62）：at-acceptance 说第一行读不出的，停下时门禁就拦回来——门禁真的拦（上面第一条）', () => {
  const acc = readFileSync(new URL('../agents/at-acceptance.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('').split('\n').join('')
  assert.ok(acc.includes('读不出来的，你停下时门禁就拦回来，叫你把这一行改好再停。'), 'agents/at-acceptance.md')
})
