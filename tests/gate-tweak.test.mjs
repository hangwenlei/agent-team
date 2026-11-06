// 单个微调——门禁子进程那一层：按 state 的 mode 选阶段链（微调走 stages.tweak.json）、建好之后不许改 mode、微调里项目经理直接派开发角色、
// 测试段由项目经理产出、没有验收段的链收口时读测试报告、「可以了，收尾」，以及一整趟微调走通。纯函数那一层在 tests/tweak.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'

const NL = String.fromCharCode(10)
const PM = 'agent-team:at-pm'
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-11-05T10:00:00Z' }))
const stateOf = (id, { mode = 'tweak', stage = 'S1', history = null, extra = {} } = {}) => {
  const hist = history ?? H(stage)
  return {
    run_id: id,
    ...(mode === null ? {} : { mode }),
    stage,
    contract_sha: 'PENDING',
    roster: [],
    stage_roles: {},
    trimmed: {},
    artifacts: {},
    rework: reworkFromHistory(hist),
    rework_base: {},
    never_invoked: [],
    escalations: [],
    closed_at: null,
    history: hist,
    ...extra,
  }
}
const reasonOf = (out) => decisionOf(out.stdout)?.permissionDecisionReason ?? ''
const denied = (out) => decisionOf(out.stdout)?.permissionDecision === 'deny'
const dispatch = (projectDir, target, over = {}) =>
  run(
    over.check ?? 'readiness',
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      agent_type: PM,
      session_id: 's-1',
      tool_input: { subagent_type: 'agent-team:' + target, description: 'x', prompt: 'x' },
      ...(over.input ?? {}),
    },
    GATE,
    projectDir,
  )
const write = (projectDir, file, content, over = {}) =>
  run(
    over.check ?? 'writepath',
    { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: over.agent_type ?? PM, session_id: 's-1', tool_input: { file_path: file, content }, ...(over.input ?? {}) },
    GATE,
    projectDir,
  )

function cleanup(dirs) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
}

// 一趟停在 stage 的 run（r1），state 照 stateOf；files 是 run 目录里先放好的产物。
function withRun(body, { mode = 'tweak', stage = 'S5', history = null, files = {} } = {}) {
  const dirs = makeRun({ runId: 'r1', stage })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    writeFileSync(join(runDir, 'state.json'), JSON.stringify(stateOf('20261105-1000-tweak', { mode, stage, history }), null, 2))
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(runDir, name, '..'), { recursive: true })
      writeFileSync(join(runDir, name), text)
    }
    return body({ ...dirs, runDir })
  } finally {
    cleanup(dirs)
  }
}
const DOC = (title) => '# ' + title + NL + NL + '内容' + NL

test('mode 为 tweak 的一趟：H2 认短链——S5 的前置是 04-dispatch.md，有它派 at-frontend 放行、没有它拒', () => {
  const files = { '00-contract.md': DOC('契约'), '04-dispatch.md': DOC('派发') }
  withRun(({ projectDir }) => assert.equal(denied(dispatch(projectDir, 'at-frontend')), false), { stage: 'S5', history: H('S1', 'S4', 'S5'), files })
  withRun(
    ({ projectDir }) => {
      const out = dispatch(projectDir, 'at-frontend')
      assert.equal(denied(out), true)
      assert.match(reasonOf(out), /04-dispatch\.md/)
    },
    { stage: 'S5', history: H('S1', 'S4', 'S5'), files: { '00-contract.md': DOC('契约') } },
  )
})

test('没有 mode 的旧 run 与 mode 为 full 的一趟：照正常链判（S5 的前置还要 03-arch.md）', () => {
  const files = { '00-contract.md': DOC('契约'), '04-dispatch.md': DOC('派发') }
  for (const mode of [null, 'full']) {
    withRun(
      ({ projectDir }) => {
        const out = dispatch(projectDir, 'at-frontend', { check: 'readiness' })
        assert.equal(denied(out), true, String(mode))
        assert.match(reasonOf(out), /03-arch\.md/, String(mode))
      },
      { mode, stage: 'S5', history: H('S1', 'S2', 'S3', 'S4', 'S5'), files },
    )
  }
})

test('mode 为 tweak：项目经理写 06-test.md 放行（S6 是它的产物）；正常一趟里项目经理写 06-test.md 照旧拒', () => {
  withRun(({ projectDir, runDir }) => assert.equal(denied(write(projectDir, join(runDir, '06-test.md'), '结论：通过' + NL)), false), { stage: 'S6', history: H('S1', 'S4', 'S5', 'S6') })
  withRun(({ projectDir, runDir }) => assert.equal(denied(write(projectDir, join(runDir, '06-test.md'), '结论：通过' + NL)), true), {
    mode: 'full',
    stage: 'S6',
    history: H('S1', 'S2', 'S3', 'S4', 'S5', 'S6'),
  })
})

test('H6：建好之后把 mode 从 full 改成 tweak、从 tweak 改成 full、去掉 tweak，都拒；照旧带着放行', () => {
  const cases = [
    ['full', 'tweak', true],
    ['tweak', 'full', true],
    ['tweak', null, true],
    ['tweak', 'tweak', false],
    ['full', 'full', false],
    [null, 'full', false],
  ]
  for (const [from, to, deny] of cases) {
    withRun(
      ({ projectDir, runDir }) => {
        const after = stateOf('20261105-1000-tweak', { mode: to, stage: 'S1' })
        const out = write(projectDir, join(runDir, 'state.json'), JSON.stringify(after, null, 2), { check: 'rework' })
        assert.equal(denied(out), deny, `${from} → ${to}：${reasonOf(out)}`)
        if (deny) assert.match(reasonOf(out), /mode/)
      },
      { mode: from, stage: 'S1' },
    )
  }
})

test('H6：建 run 的那一次写 mode 为 tweak 放行', () => {
  const dirs = makeRun({ runId: 'r0', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r0'), { recursive: true, force: true })
    rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
    const file = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const out = write(dirs.projectDir, file, JSON.stringify(stateOf('20261105-1000-tweak', { stage: 'S1' }), null, 2), { check: 'rework' })
    assert.equal(denied(out), false, reasonOf(out))
  } finally {
    cleanup(dirs)
  }
})

test('mode 写坏（"Tweak"、1）：运行上下文按正常链读，账本的回传报出来', () => {
  for (const bad of ['Tweak', 1]) {
    withRun(
      ({ projectDir, runDir }) => {
        const st = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'))
        writeFileSync(join(runDir, 'state.json'), JSON.stringify({ ...st, mode: bad }, null, 2))
        const d = dispatch(projectDir, 'at-frontend')
        assert.match(reasonOf(d), /03-arch\.md/, String(bad))
        const led = run('ledger', { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: PM, session_id: 's-1', tool_input: { file_path: join(runDir, 'state.json') } }, GATE, projectDir)
        assert.match(led.stdout, /mode 是/, String(bad))
      },
      { stage: 'S5', history: H('S1', 'S4', 'S5'), files: { '00-contract.md': DOC('契约'), '04-dispatch.md': DOC('派发') } },
    )
  }
})
