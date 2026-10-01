// M3y（docs/33，全量审查第 15 条）：返工轮里上一轮的产物——门禁子进程级。
//
// 回退之后上一轮的产物都还在磁盘上。交没交、齐没齐的判据（H5a/H5b 的交付物、【阶段】、H5a「停在旧阶段」、H2 的就绪）原来只问
// 文件在不在，于是回退那一刻【阶段】就催推进、零改动停下 H5b 放行、H2 被旧产物满足连前置都不查。state.json 的 rework_base
// 记着回退那一刻各份产物的 sha（H6 对着磁盘核），磁盘内容与它相同的就是上一轮的。纯函数在 tests/freshness.test.mjs、
// tests/rework-base.test.mjs、tests/deliverable.test.mjs、tests/readiness.test.mjs；这里钉 hooks/gate.mjs 把它们接对了：
// 每一道读的是 rework_base、磁盘字节真的读到了、收件人分对了、H6 真的读磁盘拍快照。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, hermeticEnv, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'

const REPO = new URL('../', import.meta.url)
const INJECT = fileURLToPath(new URL('./helpers/inject-throw.cjs', import.meta.url))
const sha = (text) => sha256OfContract(Buffer.from(text, 'utf8'))
const H = (...stages) => stages.map((stage) => ({ stage, at: '2026-10-01T00:00:00Z' }))
const FIRST = H('S1', 'S2', 'S3', 'S4', 'S5', 'S6')
const PROJECT = {
  available_roles: ['at-product', 'at-ui', 'at-architect', 'at-backend', 'at-qa'],
  paths: { 'at-backend': ['src/server/'] },
}
// 不含 at-ui：S5 只等 at-backend 那一份。含它的话 S5 本来就判不齐（05-impl/at-ui.md 不在），旧产物让 S5 判齐那一刀测不到。
const ROSTER = ['at-product', 'at-architect', 'at-backend', 'at-qa']
// 第一轮落盘的产物。
const R1 = {
  '00-contract.md': 'contract\n',
  '01-prd.md': 'prd r1\n',
  '02-ui-spec.md': 'ui spec r1\n',
  '02-wireframe.html': '<p>wire r1</p>\n',
  '03-arch.md': 'arch r1\n',
  '03-alignment.md': 'align r1\n',
  '04-dispatch.md': 'dispatch r1\n',
  '05-impl/at-backend.md': 'backend r1\n',
  '06-test.md': 'test r1\n',
}
const baseOf = (...names) => Object.fromEntries(names.map((n) => [n, sha(R1[n])]))

// 一趟返工中的 run：files 落盘，state.json 照给定的 stage / history / rework_base 写（rework 由 history 派生）。
function fixture({ stage, history, reworkBase, files = R1, roster = ROSTER, extra = {} }) {
  const dirs = makeRun({ runId: 'r1', stage, roster, project: PROJECT })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(runDir, rel)), { recursive: true })
    writeFileSync(join(runDir, rel), text, 'utf8')
  }
  const state = {
    run_id: '20261001-0900-fixture',
    stage,
    contract_sha: 'PENDING',
    roster,
    artifacts: {},
    rework: reworkFromHistory(history),
    never_invoked: [],
    escalations: [],
    history,
    ...(reworkBase === undefined ? {} : { rework_base: reworkBase }),
    ...extra,
  }
  const statePath = join(runDir, 'state.json')
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
  const cleanup = () => {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
  return { p: dirs.projectDir, runDir, statePath, state, cleanup }
}
function using(opts, body) {
  const fx = fixture(opts)
  try {
    return body(fx)
  } finally {
    fx.cleanup()
  }
}

const as = (agent) => (agent ? { agent_type: agent } : {})
const dispatch = (target, caller) => ({ hook_event_name: 'PreToolUse', tool_name: 'Agent', ...as(caller), tool_input: { subagent_type: target, prompt: 'x' } })
const returned = (target, caller) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  ...as(caller),
  tool_input: { subagent_type: target, prompt: 'x' },
  tool_response: { status: 'completed' },
})
const stopped = (agent) => ({ hook_event_name: 'SubagentStop', agent_type: agent })
const writeState = (fx, after, agent = 'at-pm') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: agent,
  tool_input: { file_path: fx.statePath, content: JSON.stringify(after, null, 2) },
})
const postedState = (fx) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: fx.statePath } })

const reasonOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecisionReason ?? '' : '')
const contextOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const denied = (r) => r.stdout.trim() !== '' && JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny'

// 回退到 S5 之后（S6 → S5）：S5 及之后在磁盘上的产物进快照。
const AT_S5 = { stage: 'S5', history: [...FIRST, ...H('S5')], reworkBase: baseOf('05-impl/at-backend.md', '06-test.md') }

// ============================================================================ H2

test('M3y H2：回退到 S5、实现记录还是上一轮的、04-dispatch.md 不在 → 拒（旧产物不再让 S5 判齐、跳过前置）', () => {
  const { ['04-dispatch.md']: _gone, ...files } = R1
  using({ ...AT_S5, files }, (fx) => {
    const r = run('readiness', dispatch('agent-team:at-backend'), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /04-dispatch\.md（S4 的产物）/)
  })
})

test('M3y H2：回退到 S4、04-dispatch.md 还是上一轮的，PM 派 at-backend → 拒，出路给「标 accepted」', () => {
  const reworkBase = baseOf('04-dispatch.md', '05-impl/at-backend.md', '06-test.md')
  using({ stage: 'S4', history: [...FIRST, ...H('S4')], reworkBase }, (fx) => {
    const r = run('readiness', dispatch('agent-team:at-backend'), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /04-dispatch\.md（S4 的产物）还是上一轮的/)
    assert.match(reasonOf(r), /改成 "accepted"/)
  })
})

test('M3y H2：同一格由架构师派 → 叫它冒泡，不叫它改 rework_base', () => {
  const reworkBase = baseOf('04-dispatch.md', '05-impl/at-backend.md', '06-test.md')
  using({ stage: 'S4', history: [...FIRST, ...H('S4')], reworkBase }, (fx) => {
    const r = run('readiness', dispatch('agent-team:at-backend', 'agent-team:at-architect'), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /冒泡/)
    assert.doesNotMatch(reasonOf(r), /改成 "accepted"/)
  })
})

// 放行的几格：返工轮里正常的派发不能被多拦。
test('M3y H2：返工轮里正常的派发放行——S5 派 at-backend、S6 原地重来派 at-qa、S2 派 at-product', () => {
  using(AT_S5, (fx) => {
    assert.equal(run('readiness', dispatch('agent-team:at-backend'), GATE, fx.p).stdout.trim(), '')
  })
  using({ stage: 'S6', history: [...FIRST, ...H('S6')], reworkBase: baseOf('06-test.md') }, (fx) => {
    assert.equal(run('readiness', dispatch('agent-team:at-qa'), GATE, fx.p).stdout.trim(), '')
  })
  const atS2 = baseOf('01-prd.md', '02-ui-spec.md', '02-wireframe.html', '03-arch.md', '03-alignment.md', '04-dispatch.md', '05-impl/at-backend.md', '06-test.md')
  using({ stage: 'S2', history: [...FIRST, ...H('S2')], reworkBase: atS2 }, (fx) => {
    assert.equal(run('readiness', dispatch('agent-team:at-product'), GATE, fx.p).stdout.trim(), '')
    // 反面：同一格提前派架构师——01-prd.md 还是上一轮的，S3 的前置不算在。
    const r = run('readiness', dispatch('agent-team:at-architect'), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /01-prd\.md（S2 的产物）还是上一轮的/)
  })
})

// ============================================================================ H5b / H5a

test('M3y H5b：回退到 S5、at-backend 零改动停下 → 拦下，说清是上一轮的、给两条出口', () => {
  using(AT_S5, (fx) => {
    const r = run('stop-gate', stopped('agent-team:at-backend'), GATE, fx.p)
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /05-impl\/at-backend\.md 还是上一轮的/)
    assert.match(r.stderr, /末尾追加一节/)
  })
})

test('M3y H5b：重写过之后停下 → 放行', () => {
  using({ ...AT_S5, files: { ...R1, '05-impl/at-backend.md': 'backend r2\n' } }, (fx) => {
    const r = run('stop-gate', stopped('agent-team:at-backend'), GATE, fx.p)
    assert.equal(r.status, 0, r.stderr)
  })
})

test('M3y H5b：上一轮的是 .html → 出口说用 HTML 注释追加', () => {
  const atS2 = baseOf('01-prd.md', '02-ui-spec.md', '02-wireframe.html', '03-arch.md', '03-alignment.md', '04-dispatch.md', '05-impl/at-backend.md', '06-test.md')
  using({ stage: 'S2', history: [...FIRST, ...H('S2')], reworkBase: atS2, files: { ...R1, '02-ui-spec.md': 'ui spec r2\n' } }, (fx) => {
    const r = run('stop-gate', stopped('agent-team:at-ui'), GATE, fx.p)
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /02-wireframe\.html 还是上一轮的/)
    assert.match(r.stderr, /<!-- -->/)
    assert.doesNotMatch(r.stderr, /02-ui-spec\.md 还是上一轮的/)
  })
})

test('M3y H5a：PM 收件 → 说是上一轮的，出路有「标 accepted」', () => {
  using(AT_S5, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-backend'), GATE, fx.p))
    assert.match(c, /05-impl\/at-backend\.md 还是上一轮的/)
    assert.match(c, /改成 "accepted"/)
    assert.match(c, /等 at-backend 写完/)
    assert.match(c, /重派它这一轮重写/)
    assert.doesNotMatch(c, /磁盘上还没有/, '在磁盘上的不能说成没有')
  })
})

test('M3y H5a：架构师收件 → 叫它冒泡，不叫它改 rework_base', () => {
  using(AT_S5, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-backend', 'agent-team:at-architect'), GATE, fx.p))
    assert.match(c, /05-impl\/at-backend\.md 还是上一轮的/)
    assert.match(c, /冒泡给派你的人，由项目经理标 "accepted"/)
    assert.doesNotMatch(c, /改成 "accepted"/)
  })
})

test('M3y H5a「停在旧阶段」：S5 的产物都还是上一轮的，架构师返回不报「停在旧阶段」', () => {
  using({ ...AT_S5, extra: { stage_roles: { S2: ['at-product', 'at-ui'], S3: ['at-architect'], S5: ['at-architect', 'at-backend'], S6: ['at-qa'] } } }, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-architect'), GATE, fx.p))
    assert.doesNotMatch(c, /停在旧阶段/)
  })
})

// ============================================================================ ledger

test('M3y ledger：回退到 S5 那一次写入之后，【阶段】不催推进，【返工】列出上一轮的', () => {
  using(AT_S5, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.doesNotMatch(c, /【阶段】S5 的产物已经齐了/)
    assert.match(c, /【返工】/)
    assert.match(c, /当前段 S5：05-impl\/at-backend\.md/)
  })
})

test('M3y ledger：S5 的产物都重写过 → 【阶段】照常发，【返工】不发', () => {
  using({ ...AT_S5, files: { ...R1, '05-impl/at-backend.md': 'backend r2\n' } }, (fx) => {
    const c = contextOf(run('ledger', postedState(fx), GATE, fx.p))
    assert.match(c, /【阶段】S5 的产物已经齐了/)
    assert.doesNotMatch(c, /【返工】/)
  })
})

// ============================================================================ H6

const BEFORE_S6 = { stage: 'S6', history: FIRST, reworkBase: {} }
const restartTo = (fx, stage, rework_base) => {
  const after = { ...fx.state, stage, history: [...fx.state.history, ...H(stage)] }
  after.rework = reworkFromHistory(after.history)
  if (rework_base === undefined) delete after.rework_base
  else after.rework_base = rework_base
  return after
}

test('M3y H6：回退写入带对了 rework_base（照磁盘算）→ 放行', () => {
  using(BEFORE_S6, (fx) => {
    const r = run('rework', writeState(fx, restartTo(fx, 'S5', baseOf('05-impl/at-backend.md', '06-test.md'))), GATE, fx.p)
    assert.equal(r.stdout.trim(), '', r.stdout)
  })
})

test('M3y H6：回退写入没带 rework_base → 拒，理由里有照磁盘算出的整份', () => {
  using(BEFORE_S6, (fx) => {
    const r = run('rework', writeState(fx, restartTo(fx, 'S5')), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.ok(reasonOf(r).includes(`"05-impl/at-backend.md": "${sha(R1['05-impl/at-backend.md'])}"`), reasonOf(r))
    assert.ok(reasonOf(r).includes(`"06-test.md": "${sha(R1['06-test.md'])}"`), reasonOf(r))
  })
})

test('M3y H6：推进离开 S5 时实现记录还是上一轮的 → 拒；重写过、或同一次 Write 标 "accepted" → 放行', () => {
  const advance = (fx, rework_base) => ({
    ...fx.state,
    stage: 'S6',
    history: [...fx.state.history, ...H('S6')],
    rework: reworkFromHistory([...fx.state.history, ...H('S6')]),
    rework_base,
  })
  using(AT_S5, (fx) => {
    const r = run('rework', writeState(fx, advance(fx, AT_S5.reworkBase)), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /05-impl\/at-backend\.md/)
    const acc = { ...AT_S5.reworkBase, '05-impl/at-backend.md': 'accepted' }
    assert.equal(run('rework', writeState(fx, advance(fx, acc)), GATE, fx.p).stdout.trim(), '')
  })
  using({ ...AT_S5, files: { ...R1, '05-impl/at-backend.md': 'backend r2\n' } }, (fx) => {
    assert.equal(run('rework', writeState(fx, advance(fx, AT_S5.reworkBase)), GATE, fx.p).stdout.trim(), '')
  })
})

test('M3y H6：回退之后的写入丢了 rework_base → 拒，理由附写入前整份', () => {
  using(AT_S5, (fx) => {
    const after = { ...fx.state }
    delete after.rework_base
    const r = run('rework', writeState(fx, after), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /写入前是/)
  })
})

// 逐份读：一份产物读不出来，回退快照不核它，不能让整次判定 fail closed。
test('M3y H6：拍快照时某一份读不出来 → 不核它（不写放行），stderr 点名', () => {
  using(BEFORE_S6, (fx) => {
    const r = run(
      'rework',
      writeState(fx, restartTo(fx, 'S5', baseOf('06-test.md'))),
      GATE,
      fx.p,
      { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: 'read:05-impl/at-backend.md' },
      { nodeArgs: ['-r', INJECT] },
    )
    assert.equal(r.stdout.trim(), '', r.stdout)
    assert.match(r.stderr, /05-impl\/at-backend\.md/)
  })
})

// 阶段链读不出来、形状不对：回退快照那几条跳过、留痕；decideRework 那几条照拦。
function withPlugin(fx, stagesText) {
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-m3y-plug-')))
  cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
  cpSync(new URL('roster.json', REPO), join(plugin, 'roster.json'))
  writeFileSync(join(plugin, 'stages.json'), stagesText, 'utf8')
  return { gate: join(plugin, 'hooks', 'boot.mjs'), cleanup: () => rmSync(plugin, { recursive: true, force: true }) }
}

for (const stagesText of ['{ x', '{}', '{"S1":1}']) {
  test(`M3y H6：stages.json 是 ${stagesText} → 回退快照不核、stderr 留痕；返工计数照拦`, () => {
    using(BEFORE_S6, (fx) => {
      const plug = withPlugin(fx, stagesText)
      try {
        const ok = run('rework', writeState(fx, restartTo(fx, 'S5')), plug.gate, fx.p)
        assert.equal(ok.stdout.trim(), '', ok.stdout)
        assert.match(ok.stderr, /rework_base/)
        const shrink = { ...fx.state, history: fx.state.history.slice(0, 3) }
        assert.ok(denied(run('rework', writeState(fx, shrink), plug.gate, fx.p)))
      } finally {
        plug.cleanup()
      }
    })
  })
}

// ============================================================================ 复核补的（M3y 对抗验证）

test('M3y H5a：一份没写、一份是上一轮的 → PM 收到的回传两样都说', () => {
  const atS2 = baseOf('01-prd.md', '02-ui-spec.md', '02-wireframe.html', '03-arch.md', '03-alignment.md', '04-dispatch.md', '05-impl/at-backend.md', '06-test.md')
  const { ['02-ui-spec.md']: _gone, ...files } = R1
  using({ stage: 'S2', history: [...FIRST, ...H('S2')], reworkBase: atS2, files }, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-ui'), GATE, fx.p))
    assert.match(c, /02-ui-spec\.md，但磁盘上还没有/)
    assert.match(c, /02-wireframe\.html 还是上一轮的/)
  })
})

test('M3y H5a：非 PM 收件时出路有重派，不只是等', () => {
  using(AT_S5, (fx) => {
    const c = contextOf(run('deliverable', returned('agent-team:at-backend', 'agent-team:at-architect'), GATE, fx.p))
    assert.match(c, /重派 at-backend/)
  })
})

// 「不是当前阶段的执行者、也派不到」那一支补的返工出路按收件人分：PM 照「回退」记一次回退，别人冒泡。首轮 run 上同样发——
// 第一次驳回之后的返工恰好发生在一趟从没回退过的 run 上（第 16 条的典型情形）。
test('M3y H5a「不是当前阶段的执行者」：返工出路按收件人分，首轮与返工轮都发', () => {
  for (const opts of [AT_S5, { stage: 'S6', history: FIRST, reworkBase: {} }]) {
    using(opts, (fx) => {
      const pm = contextOf(run('deliverable', returned(opts.stage === 'S5' ? 'agent-team:at-qa' : 'agent-team:at-product'), GATE, fx.p))
      assert.match(pm, /记一次回退/)
      assert.match(pm, /记完之后把它们标 "accepted"，不必再派一遍/)
      assert.doesNotMatch(pm, /记回退是项目经理的事/)
      const arch = contextOf(run('deliverable', returned(opts.stage === 'S5' ? 'agent-team:at-qa' : 'agent-team:at-product', 'agent-team:at-architect'), GATE, fx.p))
      assert.match(arch, /记回退是项目经理的事/)
      assert.doesNotMatch(arch, /记一次回退/)
    })
  }
})

// runctx 读 stages.json 时剥 BOM；H6 读同一份文件也要剥，否则带 BOM 的阶段链让回退快照那几条静默跳过、别的门禁照常。
test('M3y H6：stages.json 带 BOM → 照常核回退快照', () => {
  using(BEFORE_S6, (fx) => {
    const plug = withPlugin(fx, String.fromCharCode(0xfeff) + readFileSync(new URL('stages.json', REPO), 'utf8'))
    try {
      assert.ok(denied(run('rework', writeState(fx, restartTo(fx, 'S5')), plug.gate, fx.p)))
    } finally {
      plug.cleanup()
    }
  })
})

// 逐份读产物时 stat 失败怎么归类（gate.mjs 的 diskSha）：不在（ENOENT、ENOTDIR、是目录）→ 写了 sha 算多出来；别的错 → 在、但读不出来，不核。
test('M3y H6：产物位置上是一个目录 → 算不在，给它写 sha 是多出来的', () => {
  const { ['06-test.md']: _t, ...files } = R1
  using({ ...BEFORE_S6, files }, (fx) => {
    mkdirSync(join(fx.runDir, '06-test.md'))
    const r = run('rework', writeState(fx, restartTo(fx, 'S5', { ...baseOf('05-impl/at-backend.md'), '06-test.md': sha('x') })), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /多出/)
  })
})

test('M3y H6：产物的上一级是一个文件（ENOTDIR，Windows 上是 ENOENT）→ 算不在', () => {
  const { ['05-impl/at-backend.md']: _b, ...files } = R1
  using({ ...BEFORE_S6, files: { ...files, '05-impl': 'not a dir\n' } }, (fx) => {
    const r = run('rework', writeState(fx, restartTo(fx, 'S5', { ...baseOf('06-test.md'), '05-impl/at-backend.md': sha('x') })), GATE, fx.p)
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /多出/)
  })
})

test('M3y H6：stat 报别的错（注入 EACCES）→ 在、但读不出来：写一个 sha 放行，stderr 点名', () => {
  using(BEFORE_S6, (fx) => {
    const r = run(
      'rework',
      writeState(fx, restartTo(fx, 'S5', { ...baseOf('05-impl/at-backend.md'), '06-test.md': sha('whatever') })),
      GATE,
      fx.p,
      { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: 'stat:EACCES:06-test.md' },
      { nodeArgs: ['-r', INJECT] },
    )
    assert.equal(r.stdout.trim(), '', r.stdout)
    assert.match(r.stderr, /06-test\.md/)
  })
})

// 「上一级是一个文件」在 Windows 上 stat 给 ENOENT，那一条打不到 ENOTDIR 那一支——注入一次，各平台都走到它。
test('M3y H6：stat 报 ENOTDIR（注入）→ 算不在，给它写 sha 是多出来的', () => {
  using(BEFORE_S6, (fx) => {
    const r = run(
      'rework',
      writeState(fx, restartTo(fx, 'S5', { ...baseOf('05-impl/at-backend.md'), '06-test.md': sha('x') })),
      GATE,
      fx.p,
      { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: 'stat:ENOTDIR:06-test.md' },
      { nodeArgs: ['-r', INJECT] },
    )
    assert.ok(denied(r), r.stdout)
    assert.match(reasonOf(r), /多出/)
  })
})
