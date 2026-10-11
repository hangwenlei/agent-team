// docs/78（docs/32 §4「新 run 漏写 stage_roles 时静默退回整趟口径」）：按段判的门禁（【阶段】、推进、产者交代……）认 state.json 的 stage_roles——不是对象
// （没有这个键、null、数组……）就当旧 run、按整趟 roster 判。新 run 漏写它，门禁一声不吭地退回旧口径（validateState 对缺失不报：旧 run 本来就没有）。拿
// closed_at、rework_base 在不在认新旧不准：旧 run 在新插件下续跑，回退会写进 rework_base、收口会写进 closed_at。门禁看得准的是两个时刻：建 run 的那一次
// （写之前 state.json 读不到、这一趟的目录里还没有门禁在 state.json 落盘之后才写的文件）stage_roles 不是对象，H6 拒；写入之前它是对象、这次写入不是了，
// H6 也拒。没有这个键的旧 run 两条都碰不到（半路加上的除外，docs/78 §4）。认值、认「建 run」的写法是两轮复核之后定的（docs/78 §8）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideStageRolesKey } from '../hooks/lib/rework-guard.mjs'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { USER_WORDS_FILE } from '../hooks/lib/user-words.mjs'
import { dispatchLine } from '../hooks/lib/completion.mjs'
import { GATE_FILES } from '../hooks/lib/control-files.mjs'
import { runContextFix } from '../hooks/lib/fail-open.mjs'

const FIX_STATE = runContextFix('state')

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
  // 复核（docs/78 §8，中 1）：认值不只认键——按段判的消费方（participantsOf）把不是对象的值当成旧 run、退回整趟 roster，与没有这个键一样。
  for (const v of [[], null, 'S2']) {
    assert.equal(decideStageRolesKey({ before: null, after: { ...NEW, stage_roles: v }, creating: true }).ok, false, JSON.stringify(v))
    assert.equal(decideStageRolesKey({ before: NEW, after: { ...NEW, stage_roles: v }, creating: false }).ok, false, JSON.stringify(v))
  }
  // 写入之前的值本来就坏了（不是对象）：消费方早已把它当旧 run，这一次去掉或改成对象都放行（与【state.json】叫改成对象的出路不打架）。
  const broken = { ...NEW, stage_roles: [] }
  assert.equal(decideStageRolesKey({ before: broken, after: without(NEW, 'stage_roles'), creating: false }).ok, true)
  assert.equal(decideStageRolesKey({ before: broken, after: NEW, creating: false }).ok, true)
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

// 复核（docs/78 §8，中 2）：Edit 也走这一条——Edit 建 run（old_string 为空串、文件不在）不带拒、带了放行；Edit 去掉键拒。
test('H6（docs/78 §8）：Edit 建 run 不带 stage_roles 拒、带了放行；Edit 把它去掉拒', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', '20261011-1500-demo', 'state.json')
    const edit = (old_string, new_string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', agent_type: 'agent-team:at-pm', session_id: 's-1', tool_input: { file_path: statePath, old_string, new_string } })
    assert.equal(decisionOf(run('rework', edit('', JSON.stringify(without(NEW, 'stage_roles'), null, 2)), GATE, dirs.projectDir)).permissionDecision, 'deny')
    assert.notEqual(decisionOf(run('rework', edit('', JSON.stringify(NEW, null, 2)), GATE, dirs.projectDir)).permissionDecision, 'deny')
    // 落盘之后（照真实顺序：Write 建目录、写文件），再用 Edit 去掉那一行。
    mkdirSync(join(statePath, '..'), { recursive: true })
    writeFileSync(statePath, JSON.stringify(NEW, null, 2))
    const d = decisionOf(run('rework', edit('  "stage_roles": {},\n', ''), GATE, dirs.projectDir))
    assert.equal(d.permissionDecision, 'deny', JSON.stringify(d))
    assert.match(d.permissionDecisionReason, /stage_roles/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 复核（docs/78 §8，中 2）：建 run 因为缺 stage_roles 被拒，原话记录里不留打算绑到哪一趟（binding）——那一趟没建出来。这一条排在原话绑定之前。
test('H6（docs/78 §8）：/agent-team:at 之后建 run 不带 stage_roles 被拒——项目一级的原话记录不记 binding', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
    const expansion = { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'agent-team:at', command_args: '做一个待办应用', command_source: 'plugin', prompt: '/agent-team:at 做一个待办应用', session_id: 's-1' }
    run('user-words', expansion, GATE, dirs.projectDir)
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', '20261011-1500-demo', 'state.json')
    assert.equal(decisionOf(run('rework', write(statePath, without(NEW, 'stage_roles')), GATE, dirs.projectDir)).permissionDecision, 'deny')
    const words = JSON.parse(readFileSync(join(dirs.projectDir, '.agent-team', USER_WORDS_FILE), 'utf8'))
    assert.equal(words.binding ?? null, null, JSON.stringify(words))
    assert.ok(!existsSync(join(statePath, '..')))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 复核（docs/78 §8，低 4）：认「建 run」要这一趟的目录还不在、或者是空的——state.json 丢了、目录里还有别的文件时照着重建，不是建 run（旧 run 重建不被逼着加键）。
// 第二轮复核（docs/78 §8）：跑过一阵的一趟——目录里有一份门禁在 state.json 落盘之后才写的文件（逐份各试一次：派发记录、批准记录、契约基线、交付快照、
// 原话记录）——state.json 丢了照着重建，不算建 run。
test('H6（docs/78 §8）：跑过一阵的一趟（目录里有任何一份门禁专属文件）state.json 丢了——不带 stage_roles 的重建照常放行', () => {
  for (const name of GATE_FILES.map((p) => p.split('/').pop())) {
    const dirs = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: [] })
    try {
      const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
      writeFileSync(join(statePath, '..', name), name === 'dispatches.jsonl' ? dispatchLine({ at: '2026-10-11T10:00:00.000Z', agentId: 'a0000000000000b01', toolUseId: null, role: 'at-product', stage: 'S2', caller: '__main__', callerId: null, mode: 'background' }) + '\n' : '{}')
      const now = JSON.parse(readFileSync(statePath, 'utf8'))
      rmSync(statePath)
      const d = decisionOf(run('rework', write(statePath, now), GATE, dirs.projectDir))
      assert.notEqual(d.permissionDecision, 'deny', name + '：' + JSON.stringify(d))
    } finally {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  }
})

// 第二轮复核（docs/78 §8，中 1、中 2、低 2）：建 run 的几种走法都核——先建空目录再写（/agent-team:at 第 1 节的正路）、先写了契约再建 run（门禁的回传会把人
// 引到这条路上）、目录里多了系统杂文件或空子目录、第二趟（runs/ 下已经有别的一趟）。
test('H6（docs/78 §8）：先建空目录、先写了契约、目录里有系统杂文件或空子目录、第二趟——建 run 不带 stage_roles 都拒，带了放行', () => {
  const cases = {
    空目录: () => {},
    先写了契约: (dir) => writeFileSync(join(dir, '00-contract.md'), '# 契约\n'),
    系统杂文件: (dir) => {
      writeFileSync(join(dir, '.DS_Store'), 'x')
      writeFileSync(join(dir, 'desktop.ini'), 'x')
      mkdirSync(join(dir, '05-impl'))
    },
  }
  for (const [name, prep] of Object.entries(cases)) {
    // 第二趟：runs/ 下留着 makeRun 建的 r1（一趟完整的 run），新的一趟另起一个目录。
    const dirs = makeRun({ runId: 'r1', stage: 'S5', artifacts: ['00-contract.md'], roster: [] })
    try {
      const dir = join(dirs.projectDir, '.agent-team', 'runs', '20261011-1500-demo')
      mkdirSync(dir)
      prep(dir)
      const statePath = join(dir, 'state.json')
      const no = decisionOf(run('rework', write(statePath, without(NEW, 'stage_roles')), GATE, dirs.projectDir))
      assert.equal(no.permissionDecision, 'deny', name + '：' + JSON.stringify(no))
      const yes = decisionOf(run('rework', write(statePath, NEW), GATE, dirs.projectDir))
      assert.notEqual(yes.permissionDecision, 'deny', name + '：' + JSON.stringify(yes))
    } finally {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  }
})

// 写入之前的 state.json 在、却读不出来（修复路，H6 对它放行任何合法对象）：不算建 run——认「建 run」要写之前文件读不到。
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
  assert.ok(s1.includes('建 run 那一次少了 `stage_roles`（或者值不是对象），门禁拒这次写入'), s1)
  assert.ok(s1.includes('之后每次写 `state.json` 都带着它、值是对象'), s1)
  // 例外名单那一句照旧（账本的校验对四个都向后兼容，tests/templates.test.mjs 钉着），stage_roles 的那一道写在它后面。
  assert.ok(s1.indexOf('建 run 那一次少了 `stage_roles`') > s1.indexOf('这四个少了账本**不会**报'), s1)
  // 第二轮复核（docs/78 §8，低 3）：state.json 读不出来时门禁给的修法——原文里认得出的 stage_roles 照原样保留，原文里没有它的旧 run 不要加。
  assert.ok(FIX_STATE.includes('stage_roles') && FIX_STATE.includes('原文里没有 stage_roles 的旧 run 不要加'), FIX_STATE)
})
