// 规格段被拒时按这一段给出路（docs/54，M4s；docs/36 §5「S2 里 at-ui 被拒拿到的是给 S5 的出路」、docs/37 §5「S2 的 at-ui 被拒」）：
// H3 原来不知道当前段，叶子角色一律拿「由 PM 在 paths 里把它也列到你名下」（或「由 PM 决定要不要划给某个角色」）——那是执行段的出路，
// S2 不补 paths。停下时的拦截文案只在执行段点出「被写路径隔离拒了的写进实现记录那一节」，规格段没有对应的一句。现在 H3 收当前段：
// 调用者是这一段（不是执行段）的产者时，出路是把要落的写进这一段的产物；H5b 对「也在执行段干活」的角色在规格段补同样的一句。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideWritePath } from '../hooks/lib/writepath.mjs'
import { decideDeliverable } from '../hooks/lib/deliverable.mjs'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const RUN = '/proj/.agent-team/runs/r1'
const AT = '/proj/.agent-team'
const PROJECT = { paths: { 'at-ui': ['src/ui/'], 'at-frontend': ['src/web/'], 'at-backend': ['src/server/'] } }
const call = (role, filePath, stageId) =>
  decideWritePath({ roster: ROSTER, role, filePath, project: PROJECT, runDir: RUN, stages: STAGES, agentTeamDir: AT, stageId })
const SPEC_WAY = '这一段（S2）你交的是 run 目录里的 02-ui-spec.md、02-wireframe.html：要落的东西写进它们，这一段不为这个补 paths；确实要别的角色动的，写进去、冒泡给派你的上级。'

test('H3：at-ui 在 S2 写别人认领的文件——出路是这一段的规格，不给「列到你名下」', () => {
  const r = call('at-ui', '/proj/src/web/App.tsx', 'S2')
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('这条路径归 "at-frontend"') && r.reason.includes(SPEC_WAY), r.reason)
  assert.ok(!r.reason.includes('列到你名下'), r.reason)
})

test('H3：at-ui 在 S2 写没人认领的地方——同样给这一段的规格，不给「由 PM 决定要不要划给某个角色」', () => {
  const r = call('at-ui', '/proj/nowhere/x.css', 'S2')
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('没有被任何角色认领') && r.reason.includes(SPEC_WAY), r.reason)
  assert.ok(!r.reason.includes('由 PM 决定要不要'), r.reason)
})

test('H3：执行段（S5）、认不出的段、调用者不是这一段的产者——照旧给原来的出路', () => {
  for (const stageId of ['S5', undefined, 'S99', 'constructor']) {
    const r = call('at-ui', '/proj/src/web/App.tsx', stageId)
    assert.ok(r.reason.includes('列到你名下') && !r.reason.includes('这一段（'), `${stageId}：${r.reason}`)
  }
  // at-backend 不是 S2、S3 的产者（提前派到了它）：照旧——S3 的产物是数组形式，不按产者展开，判产者这一步不能省。
  assert.ok(call('at-backend', '/proj/src/web/App.tsx', 'S2').reason.includes('列到你名下'))
  assert.ok(call('at-backend', '/proj/src/web/App.tsx', 'S3').reason.includes('列到你名下'))
  // 自己的前缀照旧放行。
  assert.equal(call('at-ui', '/proj/src/ui/Button.tsx', 'S2').decision, 'allow')
})

test('H5b：at-ui 在 S2 没交齐——拦截文案补「被拒了的写进这一段的规格」；at-product 不补；执行段照旧是实现记录那一句', () => {
  const none = () => false
  const ui = decideDeliverable({ role: 'at-ui', stageId: 'S2', stages: STAGES, artifactExists: none })
  assert.equal(ui.ok, false)
  assert.ok(ui.reason.includes('被写路径隔离拒了的，这一段不为这个补 paths：要落的东西写进 02-ui-spec.md、02-wireframe.html——写了就能停。'), ui.reason)
  const prod = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: STAGES, artifactExists: none })
  assert.ok(!prod.reason.includes('被写路径隔离拒了的'), prod.reason)
  const impl = decideDeliverable({ role: 'at-ui', stageId: 'S5', stages: STAGES, artifactExists: none })
  assert.ok(impl.reason.includes('「被写路径隔离拒绝」一节') && !impl.reason.includes('这一段不为这个补 paths'), impl.reason)
})

test('子进程：state 停在 S2 时 at-ui 写别人认领的文件，拒绝理由给这一段的规格', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', roster: ['at-product', 'at-ui'], project: PROJECT })
  try {
    const input = { tool_name: 'Write', agent_type: 'agent-team:at-ui', tool_input: { file_path: join(dirs.projectDir, 'src', 'web', 'App.tsx'), content: 'x' } }
    const d = decisionOf(run('writepath', input, undefined, dirs.projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny')
    assert.ok(d.permissionDecisionReason.includes(SPEC_WAY), d.permissionDecisionReason)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('正文：at-ui 在 S2 被拒照拒绝理由写进这一段的规格；不再说「列到你名下」那句是给 S5 的', () => {
  const ui = readFileSync(new URL('../agents/at-ui.md', import.meta.url), 'utf8').replace(/\s+/g, '')
  assert.ok(ui.includes('在`S2`被拒，照拒绝理由把要落的设计写进你这一段的规格（`S2`不补`paths`），要别的角色动的写进你的回报冒泡给派你的角色'), 'at-ui.md')
  assert.ok(!ui.includes('那句是给`S5`的'), 'at-ui.md 还在说「列到你名下」那句是给 S5 的')
})
