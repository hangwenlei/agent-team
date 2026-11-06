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

// 门禁绑进 run 目录的原话记录（建微调那一次由 /agent-team:at-tweak 记下、建 run 时绑上）。
const boundWords = (command = 'at-tweak') =>
  JSON.stringify({ at: 't', session_id: 's-1', args: '标题改大', source: 'command', command, runs_before: [], binding: null, bound: 'r1', dropped: null, bound_at: 't' })

// 一趟停在 stage 的 run（r1），state 照 stateOf；files 是 run 目录里先放好的产物。微调的一趟默认带着门禁绑进去的 at-tweak 原话记录（words: null 不放）。
function withRun(body, { mode = 'tweak', stage = 'S5', history = null, files = {}, words = mode === 'tweak' ? 'at-tweak' : null } = {}) {
  const dirs = makeRun({ runId: 'r1', stage })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    writeFileSync(join(runDir, 'state.json'), JSON.stringify(stateOf('20261105-1000-tweak', { mode, stage, history }), null, 2))
    if (words) writeFileSync(join(runDir, 'user-words.json'), boundWords(words))
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

const expandCmd = (command, sid = 's-1', args = '标题改大') => ({
  hook_event_name: 'UserPromptExpansion',
  expansion_type: 'slash_command',
  command_name: 'agent-team:' + command,
  command_args: args,
  command_source: 'plugin',
  prompt: '/agent-team:' + command + ' ' + args,
  session_id: sid,
})

// 微调这条短链只能由用户发 /agent-team:at-tweak 起（不然项目经理写一个 mode 就绕开了产品定义与架构）：建 run 那一次 H6 核这个会话的原话记录。
test('H6：建 run 那一次写 mode 为 tweak——这个会话发过 /agent-team:at-tweak 放行；没发过、发的是 /agent-team:at、别的会话发的，拒', () => {
  const cases = [
    [['at-tweak', 's-1'], false],
    [null, true],
    [['at', 's-1'], true],
    [['at-tweak', 's-2'], true],
  ]
  for (const [expanded, deny] of cases) {
    const dirs = makeRun({ runId: 'r0', stage: 'S1' })
    try {
      rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r0'), { recursive: true, force: true })
      rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
      if (expanded) run('user-words', expandCmd(expanded[0], expanded[1]), GATE, dirs.projectDir)
      const file = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
      const out = write(dirs.projectDir, file, JSON.stringify(stateOf('20261105-1000-tweak', { stage: 'S1' }), null, 2), { check: 'rework' })
      assert.equal(denied(out), deny, `${JSON.stringify(expanded)}：${reasonOf(out)}`)
      if (deny) assert.match(reasonOf(out), /\/agent-team:at-tweak/)
      // 建完整的一趟不受这一条管。
      const full = write(dirs.projectDir, file, JSON.stringify(stateOf('20261105-1000-tweak', { mode: 'full', stage: 'S1' }), null, 2), { check: 'rework' })
      assert.equal(denied(full), false, reasonOf(full))
    } finally {
      cleanup(dirs)
    }
  }
})

test('H6：state.json 读不出来时写 mode tweak——run 目录里门禁绑进去的原话记录是 /agent-team:at-tweak 的放行，不是或没有的拒', () => {
  for (const [words, deny] of [
    ['at-tweak', false],
    ['at', true],
    [null, true],
  ]) {
    withRun(
      ({ projectDir, runDir }) => {
        writeFileSync(join(runDir, 'state.json'), '{')
        writeFileSync(join(runDir, 'dispatches.jsonl'), '')
        const out = write(projectDir, join(runDir, 'state.json'), JSON.stringify(stateOf('20261105-1000-tweak', { stage: 'S5', history: H('S1', 'S4', 'S5') }), null, 2), { check: 'rework' })
        assert.equal(denied(out), deny, `${words}：${reasonOf(out)}`)
      },
      { stage: 'S5', history: H('S1', 'S4', 'S5'), words },
    )
  }
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 测试段由项目经理产出；没有验收段的链收口时读测试报告。
const BASE_FILES = { '00-contract.md': DOC('契约'), '04-dispatch.md': DOC('派发'), '05-impl/at-frontend.md': DOC('实现记录') }
const advanceTo = (projectDir, runDir, to, extra = {}) => {
  const now = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'))
  const ids = ['S1', 'S4', 'S5', 'S6', 'S8']
  const hist = H(...ids.slice(0, ids.indexOf(to) + 1))
  const next = { ...now, stage: to, history: hist, rework: reworkFromHistory(hist), stage_roles: { S5: ['at-frontend'] }, ...extra }
  return write(projectDir, join(runDir, 'state.json'), JSON.stringify(next, null, 2), { check: 'rework' })
}

test('微调里推出 S6：06-test.md 第一行「不通过」拒、读不出拒、「跑不起来」放行、「通过」放行', () => {
  for (const [first, deny] of [
    ['结论：不通过', true],
    ['大概过了', true],
    ['结论：跑不起来：没有测试命令', false],
    ['结论：通过', false],
  ]) {
    withRun(
      ({ projectDir, runDir }) => {
        const out = advanceTo(projectDir, runDir, 'S8')
        assert.equal(denied(out), deny, `${first}：${reasonOf(out)}`)
      },
      { stage: 'S6', history: H('S1', 'S4', 'S5', 'S6'), files: { ...BASE_FILES, '06-test.md': first + NL + NL + '跑了 npm test' + NL } },
    )
  }
})

test('微调里收口：测试报告「通过」放行；「跑不起来」「不通过」没有照现状交付的批准拒，理由说这一趟没有验收段', () => {
  for (const [first, deny] of [
    ['结论：通过', false],
    ['结论：跑不起来：没有测试命令', true],
  ]) {
    withRun(
      ({ projectDir, runDir }) => {
        const out = advanceTo(projectDir, runDir, 'S8', { closed_at: '2026-11-05T12:00:00Z' })
        assert.equal(denied(out), deny, `${first}：${reasonOf(out)}`)
        if (deny) assert.match(reasonOf(out), /没有验收段/)
      },
      { stage: 'S8', history: H('S1', 'S4', 'S5', 'S6', 'S8'), files: { ...BASE_FILES, '06-test.md': first + NL, '08-delivery.md': DOC('交付') } },
    )
  }
})

test('微调里在 S8 选「照现状交付」：批准绑在测试报告上，之后收口放行', () => {
  withRun(
    ({ projectDir, runDir }) => {
      const questions = [{ question: '测试跑不起来，要怎么办？', header: '交付', multiSelect: false, options: [{ label: '照现状交付', description: '' }, { label: '停在这里', description: '' }] }]
      const ask = {
        hook_event_name: 'PostToolUse',
        tool_name: 'AskUserQuestion',
        agent_type: PM,
        session_id: 's-1',
        tool_input: { questions },
        tool_response: { questions, answers: { [questions[0].question]: '照现状交付' } },
      }
      const rec = run('approval-ask', ask, GATE, projectDir)
      assert.match(JSON.parse(rec.stdout).hookSpecificOutput.additionalContext, /已记下照现状交付/)
      const out = advanceTo(projectDir, runDir, 'S8', { closed_at: '2026-11-05T12:00:00Z' })
      assert.equal(denied(out), false, reasonOf(out))
    },
    { stage: 'S8', history: H('S1', 'S4', 'S5', 'S6', 'S8'), files: { ...BASE_FILES, '06-test.md': '结论：跑不起来：没有测试命令' + NL, '08-delivery.md': DOC('交付') } },
  )
})

// ---------------------------------------------------------------------------------------------------------------------------------
// H1：微调这一趟里项目经理直接派开发角色。
const DEVS = ['at-frontend', 'at-backend', 'at-ui', 'at-ios', 'at-android']
const OTHERS = ['at-product', 'at-architect', 'at-qa', 'at-acceptance']

test('微调里项目经理派五个开发角色：H1 放行；派产品、架构、测试、验收：H1 拒', () => {
  withRun(
    ({ projectDir }) => {
      for (const r of DEVS) assert.equal(denied(dispatch(projectDir, r, { check: 'delegation' })), false, r)
      for (const r of OTHERS) assert.equal(denied(dispatch(projectDir, r, { check: 'delegation' })), true, r)
    },
    { stage: 'S5', history: H('S1', 'S4', 'S5') },
  )
})

test('正常一趟里项目经理派 at-frontend：H1 照旧拒；at-architect 派 at-frontend 照旧放行', () => {
  withRun(
    ({ projectDir }) => {
      assert.equal(denied(dispatch(projectDir, 'at-frontend', { check: 'delegation' })), true)
      assert.equal(denied(dispatch(projectDir, 'at-architect', { check: 'delegation' })), false)
      const arch = dispatch(projectDir, 'at-frontend', { check: 'delegation', input: { agent_type: 'agent-team:at-architect', agent_id: 'a0123456789abcdef' } })
      assert.equal(denied(arch), false)
    },
    { mode: 'full', stage: 'S5', history: H('S1', 'S2', 'S3', 'S4', 'S5') },
  )
})

test('H1：state 写着 tweak、却没有门禁绑进去的 /agent-team:at-tweak 原话记录（或已经收口）：照正常花名册判', () => {
  for (const words of [null, 'at']) {
    withRun(({ projectDir }) => assert.equal(denied(dispatch(projectDir, 'at-frontend', { check: 'delegation' })), true, String(words)), {
      stage: 'S5',
      history: H('S1', 'S4', 'S5'),
      words,
    })
  }
  withRun(
    ({ projectDir, runDir }) => {
      const st = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'))
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ ...st, stage: 'S8', history: H('S1', 'S4', 'S5', 'S6', 'S8'), closed_at: '2026-11-05T12:00:00Z' }, null, 2))
      assert.equal(denied(dispatch(projectDir, 'at-frontend', { check: 'delegation' })), true, '已收口')
    },
    { stage: 'S5', history: H('S1', 'S4', 'S5') },
  )
})

test('指针不在、那一趟 state.json 坏了：照正常花名册判（项目经理派开发角色拒）', () => {
  withRun(
    ({ projectDir, runDir }) => {
      writeFileSync(join(runDir, 'state.json'), '{')
      assert.equal(denied(dispatch(projectDir, 'at-frontend', { check: 'delegation' })), true, 'state 坏了')
      rmSync(join(projectDir, '.agent-team', 'current-run'))
      assert.equal(denied(dispatch(projectDir, 'at-frontend', { check: 'delegation' })), true, '指针不在')
    },
    { stage: 'S5', history: H('S1', 'S4', 'S5') },
  )
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
