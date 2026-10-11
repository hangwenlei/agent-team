// docs/78（docs/32 §4「新 run 漏写 stage_roles 时静默退回整趟口径」）：按段判的门禁（【阶段】、推进、产者交代……）认 state.json 有没有 stage_roles 这个键——
// 没有就当旧 run、按整趟 roster 判。新 run 漏写它，门禁一声不吭地退回旧口径（validateState 对缺失不报：旧 run 本来就没有）。拿 closed_at、rework_base
// 在不在认新旧不准：旧 run 在新插件下续跑，回退会写进 rework_base、收口会写进 closed_at。门禁看得准的是两个时刻：建 run 的那一次（写之前 state.json
// 不在，这一次是照现行模板写的）不带 stage_roles，H6 拒；写入之前有 stage_roles、这次写入把它去掉了，H6 也拒。旧 run 从来没有这个键，两条都碰不到它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideStageRolesKey } from '../hooks/lib/rework-guard.mjs'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const NEW = { run_id: '20261011-1500-demo', stage: 'S1', contract_sha: 'PENDING', roster: [], stage_roles: {}, trimmed: {}, artifacts: {}, rework: {}, rework_base: {}, never_invoked: [], escalations: [], closed_at: null, history: [{ stage: 'S1', at: '2026-10-11T15:00:00Z' }] }
const without = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k))

test('decideStageRolesKey（docs/78）：建 run 的那一次不带 stage_roles 拒、带了放行；写入之前有、这次去掉了拒；旧 run（写入之前就没有）不管', () => {
  const created = decideStageRolesKey({ before: null, after: without(NEW, 'stage_roles'), creating: true })
  assert.equal(created.ok, false)
  assert.match(created.reason, /stage_roles/)
  assert.match(created.reason, /\/agent-team:at 第 1 节/)
  assert.equal(decideStageRolesKey({ before: null, after: NEW, creating: true }).ok, true)
  const dropped = decideStageRolesKey({ before: NEW, after: without(NEW, 'stage_roles'), creating: false })
  assert.equal(dropped.ok, false)
  assert.match(dropped.reason, /去掉/)
  // 值写坏了（不是对象）不归这一条——validateState 报；只管键在不在。
  assert.equal(decideStageRolesKey({ before: NEW, after: { ...NEW, stage_roles: [] }, creating: false }).ok, true)
  const legacy = without(NEW, 'stage_roles')
  assert.equal(decideStageRolesKey({ before: legacy, after: legacy, creating: false }).ok, true)
  assert.equal(decideStageRolesKey({ before: legacy, after: NEW, creating: false }).ok, true)
  // 写入之前的读不出来（不是建 run）：不判。
  assert.equal(decideStageRolesKey({ before: null, after: legacy, creating: false }).ok, true)
  // 新内容不是对象：别的判据管。
  assert.equal(decideStageRolesKey({ before: NEW, after: null, creating: false }).ok, true)
})

const write = (statePath, state) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: 'agent-team:at-pm',
  session_id: 's-1',
  tool_input: { file_path: statePath, content: JSON.stringify(state, null, 2) },
})
const decisionOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput ?? {} : {})

test('H6（docs/78）：照真实顺序建 run——项目经理直接 Write runs/<id>/state.json（目录还不在）：不带 stage_roles 拒，带了放行', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', '20261011-1500-demo', 'state.json')
    const no = decisionOf(run('rework', write(statePath, without(NEW, 'stage_roles')), GATE, dirs.projectDir))
    assert.equal(no.permissionDecision, 'deny', JSON.stringify(no))
    assert.match(no.permissionDecisionReason, /stage_roles/)
    const yes = decisionOf(run('rework', write(statePath, NEW), GATE, dirs.projectDir))
    assert.notEqual(yes.permissionDecision, 'deny', JSON.stringify(yes))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('H6（docs/78）：有 stage_roles 的一趟，这次写入把它去掉了——拒；没有 stage_roles 的旧 run 照常写——放行', () => {
  for (const legacy of [false, true]) {
    const dirs = makeRun({ runId: 'r1', stage: 'S2', roster: [], stage_roles: legacy ? null : {} })
    try {
      const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
      const now = JSON.parse(readFileSync(statePath, 'utf8'))
      const next = without({ ...now, escalations: [] }, 'stage_roles')
      const d = decisionOf(run('rework', write(statePath, next), GATE, dirs.projectDir))
      if (legacy) assert.notEqual(d.permissionDecision, 'deny', JSON.stringify(d))
      else {
        assert.equal(d.permissionDecision, 'deny', JSON.stringify(d))
        assert.match(d.permissionDecisionReason, /stage_roles/)
      }
    } finally {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  }
})

// 写入之前的 state.json 在、却读不出来（修复路，H6 对它放行任何合法对象）：不算建 run——认「建 run」要写之前文件不在。
test('H6（docs/78）：写入之前的 state.json 在、却不是合法 JSON——不当成建 run，不带 stage_roles 的修复写入照常放行', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', roster: [], stage_roles: {} })
  try {
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const now = JSON.parse(readFileSync(statePath, 'utf8'))
    writeFileSync(statePath, '{ 坏了')
    const d = decisionOf(run('rework', write(statePath, without(now, 'stage_roles')), GATE, dirs.projectDir))
    assert.notEqual(d.permissionDecision, 'deny', JSON.stringify(d))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('正文（docs/78）：/agent-team:at 第 1 节说清建 run 那一次少了 stage_roles 会被拒，之后每次写都要带着它', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8')
  const s1 = at.slice(at.indexOf('## 1. 建 run'), at.indexOf('## 2. '))
  assert.ok(s1.includes('建 run 那一次少了 `stage_roles`，门禁拒这次写入'), s1)
  assert.ok(s1.includes('之后每次写 `state.json` 都带着它'), s1)
  // 例外名单那一句照旧（账本的校验对四个都向后兼容，tests/templates.test.mjs 钉着），stage_roles 的那一道写在它后面。
  assert.ok(s1.indexOf('建 run 那一次少了 `stage_roles`') > s1.indexOf('这四个少了账本**不会**报'), s1)
})
