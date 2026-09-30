// M3v（docs/30，全量审查第 12 条）：门禁判不出来而放行时，谁听得见。子进程级的形状表——每一格走平台真实的顺序：
// 夹具 → PreToolUse → 真的落盘 → PostToolUse（Write 会顺带建出父目录，PostToolUse 那一帧看到的磁盘与 PreToolUse
// 不同；不落盘就跑 PostToolUse，测的不是平台上会发生的事）。
//
// 口径（hooks/lib/fail-open.mjs 头部是理由）：
//   - PM 自己发起的派发（H5a）与写入（ledger，写 run 目录下的非控制文件）上，判不出来时回传一段【门禁】、给用户一行；
//   - PreToolUse 上不发受信块（readiness 的 stdout 永远不含受信前缀），SubagentStop 上什么都不发；
//   - 该沉默的格一律断言 stdout === ''——只断言「不含【门禁】」拦不住一个只发 systemMessage 的误报。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, hermeticEnv, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'
import { GATE_CHECK_ONLINE, GATE_CHECK_PATH } from '../hooks/lib/gate-check.mjs'
import {
  SECOND_WRITE_NOTE,
  dispatchNoRunNotice,
  dispatchUnreadableNotice,
  ledgerUnreadableNotice,
  runContextFix,
  systemMessage,
} from '../hooks/lib/fail-open.mjs'

const REPO = new URL('../', import.meta.url)
const TEMPLATE = JSON.parse(readFileSync(new URL('templates/project.json', REPO), 'utf8'))
const INJECT = fileURLToPath(new URL('./helpers/inject-throw.cjs', import.meta.url))
const PM = 'agent-team:at-pm'
const MARK = '【门禁】'

const parse = (r) => (r.stdout.trim() ? JSON.parse(r.stdout) : null)
const ctxOf = (r) => parse(r)?.hookSpecificOutput?.additionalContext ?? ''
const smOf = (r) => parse(r)?.systemMessage ?? null
const denied = (r) => parse(r)?.hookSpecificOutput?.permissionDecision === 'deny'
const reasonOf = (r) => parse(r)?.hookSpecificOutput?.permissionDecisionReason ?? ''
const as = (caller) => (caller === undefined ? {} : { agent_type: caller })
const dispatch = (event, caller, target) => ({
  hook_event_name: event, tool_name: 'Agent', ...as(caller), tool_input: { subagent_type: target, prompt: 'x' },
})
const writing = (event, caller, file_path, content = 'x\n') => ({
  hook_event_name: event, tool_name: 'Write', ...as(caller), tool_input: { file_path, content },
})

// ---- 夹具 ----

// 一个带 run 的项目，门禁用的是本仓库这份插件（stages.json、roster.json 都是真的）。
function healthy({ stage = 'S2', history = null, roster = [], artifacts = [] } = {}) {
  const dirs = makeRun({ runId: 'r1', stage, history, roster, artifacts, project: TEMPLATE })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
  const p = dirs.projectDir
  return { p, runDir: join(p, '.agent-team', 'runs', 'r1'), gate: GATE, cleanup: () => rmSync(p, { recursive: true, force: true }) }
}

function noRun() {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-fo-')))
  mkdirSync(join(p, '.agent-team'), { recursive: true })
  writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TEMPLATE), 'utf8')
  return { p, runDir: null, gate: GATE, cleanup: () => rmSync(p, { recursive: true, force: true }) }
}

// 插件副本，stages.json 写坏：cause 是 plugin。
// stagesText / rosterText 缺省时 stages.json 写坏、roster.json 照抄本仓库的。
function withBrokenPlugin(fx, { stagesText = '{ x', rosterText = null } = {}) {
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-fo-plug-')))
  cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
  if (rosterText === null) cpSync(new URL('roster.json', REPO), join(plugin, 'roster.json'))
  else writeFileSync(join(plugin, 'roster.json'), rosterText, 'utf8')
  if (stagesText === null) cpSync(new URL('stages.json', REPO), join(plugin, 'stages.json'))
  else writeFileSync(join(plugin, 'stages.json'), stagesText, 'utf8')
  const cleanup = fx.cleanup
  return { ...fx, gate: join(plugin, 'hooks', 'boot.mjs'), cleanup: () => { cleanup(); rmSync(plugin, { recursive: true, force: true }) } }
}

// 判不出来的几种状态，按 runctx 的 cause 分。
const UNREADABLE = {
  'pointer（丢了）': ['pointer', () => { const fx = healthy(); rmSync(join(fx.p, '.agent-team', 'current-run')); return fx }],
  'pointer（悬空）': ['pointer', () => { const fx = healthy(); writeFileSync(join(fx.p, '.agent-team', 'current-run'), 'r9', 'utf8'); return fx }],
  state: ['state', () => { const fx = healthy(); writeFileSync(join(fx.runDir, 'state.json'), '{ x', 'utf8'); return fx }],
  project: ['project', () => { const fx = healthy(); writeFileSync(join(fx.p, '.agent-team', 'project.json'), '{ x', 'utf8'); return fx }],
  runs: ['runs', () => {
    const fx = healthy()
    rmSync(join(fx.p, '.agent-team', 'current-run'))
    rmSync(join(fx.p, '.agent-team', 'runs'), { recursive: true, force: true })
    writeFileSync(join(fx.p, '.agent-team', 'runs'), '不是目录', 'utf8')
    return fx
  }],
  plugin: ['plugin', () => withBrokenPlugin(healthy())],
  // 复核（docs/30 §3）：解析得出、形状不对的 stages.json 此前被说成 state.stage 不在阶段链里。
  'plugin（stages.json 是 {}）': ['plugin', () => withBrokenPlugin(healthy(), { stagesText: '{}' })],
}

function using(make, body) {
  const fx = make()
  try {
    return body(fx)
  } finally {
    fx.cleanup()
  }
}

// 平台顺序的一次写入：三道 PreToolUse → 没被拒就落盘 → PostToolUse。
function writeStep(fx, caller, file, content = 'x\n') {
  const pre = ['writepath', 'contract', 'rework'].map((c) => [c, run(c, writing('PreToolUse', caller, file, content), fx.gate, fx.p)])
  if (pre.some(([, r]) => denied(r))) return { pre, post: null }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
  return { pre, post: run('ledger', writing('PostToolUse', caller, file, content), fx.gate, fx.p) }
}

// ---- 写 stdout 的出口只有两个 ----
//
// 放行一侧只经 emitHookJson（输出形状由纯函数 hookOutput 定，写完就退出），拒绝只经 denyAndExit。别处直接写 stdout，
// 出口契约（tests/helpers/gate-runner.mjs）只在某个子进程用例恰好走到它时才红；这一条按源码派生，写下的那一刻就红。
// boot.mjs 的加载失败退路单列：gate.mjs 起不来时它是唯一还在跑的代码，只写 denyOutput（或逐字段相同的拷贝）给的拒绝。
test('hooks/gate.mjs 与 hooks/lib 里写 stdout 的地方只在 emitHookJson 与 denyAndExit 里', async () => {
  const { readdirSync } = await import('node:fs')
  const files = ['hooks/gate.mjs', ...readdirSync(new URL('hooks/lib/', REPO)).filter((n) => n.endsWith('.mjs')).map((n) => `hooks/lib/${n}`)]
  const sites = []
  for (const rel of files) {
    const text = readFileSync(new URL(rel, REPO), 'utf8')
    for (const m of text.matchAll(/process\.stdout|process\[|console\.(log|info|dir|table)\b/g)) {
      const before = text.slice(0, m.index)
      const fns = [...before.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)]
      sites.push(`${rel}:${fns.length ? fns[fns.length - 1][1] : '(顶层)'}`)
    }
  }
  assert.deepEqual([...new Set(sites)].sort(), ['hooks/gate.mjs:denyAndExit', 'hooks/gate.mjs:emitHookJson'])
  const boot = readFileSync(new URL('hooks/boot.mjs', REPO), 'utf8')
  assert.equal([...boot.matchAll(/process\.stdout|process\[|console\./g)].length, 1, 'boot.mjs 只在 refuse 里写一次拒绝')
})

// ---- readiness（PreToolUse:Agent）：不发受信块 ----

test('readiness：任何状态、任何调用者，stdout 都不含受信前缀；判不出来时 stdout 为空', () => {
  const states = { 'no-run': noRun, ...Object.fromEntries(Object.entries(UNREADABLE).map(([k, [, make]]) => [k, make])) }
  for (const [label, make] of Object.entries(states)) {
    using(make, (fx) => {
      for (const caller of [PM, undefined, 'agent-team:at-architect']) {
        for (const target of ['agent-team:at-product', 'agent-team:at-backend', 'general-purpose']) {
          const r = run('readiness', dispatch('PreToolUse', caller, target), fx.gate, fx.p)
          assert.equal(r.stdout, '', `${label} ${caller} → ${target}：${r.stdout}`)
        }
      }
    })
  }
  using(() => healthy({ stage: 'S2' }), (fx) => {
    const r = run('readiness', dispatch('PreToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p)
    assert.ok(!r.stdout.includes(TRUSTED_PREFIX), r.stdout)
  })
})

// ---- H5a（PostToolUse:Agent）：派发 ----

test('H5a no-run：PM 与主线程派一个它派得动的团队角色——【门禁】说明有意的放行，给用户一行', () => {
  using(noRun, (fx) => {
    for (const caller of [PM, undefined]) {
      const r = run('deliverable', dispatch('PostToolUse', caller, 'agent-team:at-product'), fx.gate, fx.p)
      assert.equal(ctxOf(r), `${TRUSTED_PREFIX}：\n${dispatchNoRunNotice()}`)
      assert.equal(smOf(r), systemMessage('dispatch-no-run'))
      assert.match(r.stderr, /当前没有进行中的 run/)
    }
  })
})

test('H5a no-run 反例：目标不在调用者的 can_delegate_to 里、或者是协调者发起的——stdout 为空', () => {
  using(noRun, (fx) => {
    const cells = [
      [PM, 'general-purpose'], [PM, 'Explore'], [PM, 'agent-team:at-backend'], [PM, 'agent-team:at-outsider'],
      [PM, 'agent-team:at-pm'], [undefined, 'agent-team:at-backend'],
      ['agent-team:at-architect', 'agent-team:at-backend'], ['agent-team:at-product', 'agent-team:at-ui'], ['', 'agent-team:at-product'],
    ]
    for (const [caller, target] of cells) {
      const r = run('deliverable', dispatch('PostToolUse', caller, target), fx.gate, fx.p)
      assert.equal(r.stdout, '', `${caller} → ${target}：${r.stdout}`)
    }
  })
})

test('H5a unreadable：PM 与主线程发起的派发收到按原因的修法；用户看到固定的一行', () => {
  for (const [label, [cause, make]] of Object.entries(UNREADABLE)) {
    using(make, (fx) => {
      for (const caller of [PM, undefined]) {
        const r = run('deliverable', dispatch('PostToolUse', caller, 'agent-team:at-product'), fx.gate, fx.p)
        assert.equal(ctxOf(r), `${TRUSTED_PREFIX}：\n${dispatchUnreadableNotice(cause)}`, label)
        assert.equal(smOf(r), systemMessage('dispatch-unreadable', { cause }), label)
        assert.match(r.stderr, /读不到运行上下文/, label)
      }
    })
  }
})

test('H5a unreadable：project、plugin、runs 三种原因不把 PM 指去修 current-run 或 state.json', () => {
  for (const label of ['project', 'plugin', 'runs']) {
    using(UNREADABLE[label][1], (fx) => {
      const ctx = ctxOf(run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p))
      assert.ok(ctx.includes(MARK), label)
      assert.doesNotMatch(ctx, /current-run|state\.json/, `${label}：${ctx}`)
    })
  }
})

test('H5a unreadable 反例：协调者发起的派发只留 stderr（它派的角色写入时会被 H3 以同一个原因拒掉）', () => {
  for (const [label, [, make]] of Object.entries(UNREADABLE)) {
    using(make, (fx) => {
      const r = run('deliverable', dispatch('PostToolUse', 'agent-team:at-architect', 'agent-team:at-backend'), fx.gate, fx.p)
      assert.equal(r.stdout, '', label)
      assert.match(r.stderr, /读不到运行上下文/, label)
    })
  }
})

test('H5a 丢指针、有好几趟 run：给规则（最后建的那一趟、拿不准问用户），不列目录名', () => {
  const make = () => {
    const fx = healthy({ stage: 'S8' })
    const runs = join(fx.p, '.agent-team', 'runs')
    const newer = join(runs, '20260929-1100-hello-lang')
    const older = join(runs, '20260918-1000-farewell-draft')
    cpSync(fx.runDir, newer, { recursive: true })
    cpSync(fx.runDir, older, { recursive: true })
    rmSync(fx.runDir, { recursive: true, force: true })
    rmSync(join(fx.p, '.agent-team', 'current-run'))
    return fx
  }
  using(make, (fx) => {
    const ctx = ctxOf(run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p))
    assert.match(ctx, /最后建的那一趟/)
    assert.match(ctx, /问用户/)
    assert.doesNotMatch(ctx, /hello-lang|farewell-draft|20260929|20260918/)
  })
})

// ---- ledger（PostToolUse:Write）----

test('ledger unreadable：PM 写 run 目录下的契约与产物——【门禁】按原因给修法，哈希不要自己算', () => {
  for (const label of ['pointer（丢了）', 'pointer（悬空）', 'state', 'plugin']) {
    const [cause, make] = UNREADABLE[label]
    using(make, (fx) => {
      for (const [caller, rel] of [[PM, '00-contract.md'], [undefined, '01-prd.md']]) {
        const file = join(fx.p, '.agent-team', 'runs', 'r1', rel)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, '# x\n', 'utf8')
        const r = run('ledger', writing('PostToolUse', caller, file), fx.gate, fx.p)
        assert.equal(ctxOf(r), `${TRUSTED_PREFIX}：\n${ledgerUnreadableNotice(cause)}`, `${label} ${rel}`)
        assert.equal(smOf(r), systemMessage('ledger-unreadable', { cause }), `${label} ${rel}`)
      }
    })
  }
})

test('ledger unreadable 反例：.agent-team 下 run 目录之外的文件、控制文件、.agent-team 之外、非 PM——stdout 为空', () => {
  using(UNREADABLE['pointer（丢了）'][1], (fx) => {
    const cells = [
      [PM, join(fx.p, '.agent-team', 'notes.md'), 'notes'],
      [PM, join(fx.runDir, 'state.json'), JSON.stringify({ stage: 'S2' })],
      [PM, join(fx.p, 'src', 'app.js'), 'x'],
      [undefined, join(fx.p, 'README.md'), 'x'],
      ['agent-team:at-backend', join(fx.runDir, '05-impl', 'at-backend.md'), 'x'],
      ['agent-team:at-architect', join(fx.runDir, '03-design.md'), 'x'],
    ]
    for (const [caller, file, content] of cells) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content, 'utf8')
      const r = run('ledger', writing('PostToolUse', caller, file, content), fx.gate, fx.p)
      assert.equal(r.stdout, '', `${caller} ${file}：${r.stdout}`)
    }
  })
  using(UNREADABLE.plugin[1], (fx) => {
    const file = join(fx.p, 'src', 'x.js')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'x', 'utf8')
    assert.equal(run('ledger', writing('PostToolUse', PM, file), fx.gate, fx.p).stdout, '')
  })
})

test('ledger：project.json 坏着时走原有那条缝（【project.json】），不叠一段【门禁】', () => {
  using(UNREADABLE.project[1], (fx) => {
    const file = join(fx.runDir, '00-contract.md')
    writeFileSync(file, '# x\n', 'utf8')
    const r = run('ledger', writing('PostToolUse', PM, file), fx.gate, fx.p)
    assert.match(ctxOf(r), /【project\.json】/)
    assert.ok(!ctxOf(r).includes(MARK), ctxOf(r))
  })
})

// 偏离 /agent-team:at 第 1 节的顺序（先写 state.json 与 current-run）、直接写契约：PreToolUse 那一帧没有 run（no-run），
// Write 顺带建出 runs/<id>/，PostToolUse 那一帧就是「有人建过 run 而指针不在」。契约的哈希确实丢了，这一格该出声。
test('ledger：从没建过 run 的项目里直接写契约——落盘之后判丢指针，【门禁】给出补建的路', () => {
  using(noRun, (fx) => {
    const file = join(fx.p, '.agent-team', 'runs', '20260930-0100-x', '00-contract.md')
    const { pre, post } = writeStep(fx, PM, file, '# x\n')
    for (const [c, r] of pre) assert.equal(r.stdout, '', c)
    assert.equal(ctxOf(post), `${TRUSTED_PREFIX}：\n${ledgerUnreadableNotice('pointer')}`)
    assert.match(ctxOf(post), /一趟都没有 state\.json，就照 \/agent-team:at 第 1 节先写 state\.json/)
  })
})

// ---- 正路不出声 ----

// 照 /agent-team:at-init 与 /agent-team:at 第 1、2 节走一遍，PM 的每一次调用：stdout 为空；例外只有两次——写
// project.json 与写契约的回传，那两份里不许有 systemMessage 与【门禁】。
test('正路：at-init 与第一趟建 run（先建目录 / 不先建目录），PM 的调用不出【门禁】、不给用户刷一行', () => {
  for (const mkdirFirst of [true, false]) {
    for (const caller of [PM, undefined]) {
      const p = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-fo-path-')))
      const fx = { p, gate: GATE }
      try {
        const id = '20260930-0900-hello'
        const runDir = join(p, '.agent-team', 'runs', id)
        const state = { ...JSON.parse(readFileSync(new URL('templates/state.json', REPO), 'utf8')), run_id: id, stage: 'S1', history: [{ stage: 'S1', at: '2026-09-30T09:00:00Z' }] }
        const steps = [
          [join(p, '.agent-team', 'project.json'), JSON.stringify(TEMPLATE, null, 2), 'project'],
          [join(p, '.agent-team', 'reach.json'), '{}', null],
          ['mkdir', null, null],
          [join(runDir, 'state.json'), JSON.stringify(state, null, 2), null],
          [join(p, '.agent-team', 'current-run'), id, null],
          [join(runDir, '00-contract.md'), '# 契约\n\n## 1. 用户原话\n\n打个招呼\n', 'contract'],
        ]
        for (const [file, content, exempt] of steps) {
          if (file === 'mkdir') {
            if (mkdirFirst) mkdirSync(runDir, { recursive: true })
            continue
          }
          const { pre, post } = writeStep(fx, caller, file, content)
          for (const [c, r] of pre) assert.equal(r.stdout, '', `${file} ${c}：${r.stdout}`)
          if (exempt) {
            const v = parse(post)
            assert.ok(v && !('systemMessage' in v), `${file}：${post.stdout}`)
            assert.ok(!ctxOf(post).includes(MARK), ctxOf(post))
          } else {
            assert.equal(post.stdout, '', `${file}：${post.stdout}`)
          }
        }
        // 自检：在线，没有追加句。
        const check = run('writepath', writing('PreToolUse', caller, join(p, GATE_CHECK_PATH)), fx.gate, p)
        assert.ok(reasonOf(check).startsWith(GATE_CHECK_ONLINE))
        assert.doesNotMatch(reasonOf(check), /另外，/)
      } finally {
        rmSync(p, { recursive: true, force: true })
      }
    }
  }
})

// ---- unknown-stage ----

const S9 = { stage: 'S9', history: [{ stage: 'S1', at: '2026-09-30T01:00:00Z' }, { stage: 'S2', at: '2026-09-30T02:00:00Z' }] }

test('unknown-stage：PM 收到【门禁】——history 末条是真阶段时让它改回，用户看到一行', () => {
  using(() => healthy(S9), (fx) => {
    const r = run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p)
    const ctx = ctxOf(r)
    assert.match(ctx, /【门禁】交付物核验这次没有做——state\.stage 是 "S9"，不在阶段链里/)
    assert.match(ctx, /把 state\.stage 改回 history 末条的 S2/)
    assert.doesNotMatch(ctx, /冒泡/)
    assert.equal(smOf(r), systemMessage('unknown-stage'))
    assert.match(r.stderr, /不在阶段链里/)
  })
})

test('unknown-stage：history 末条也坏着时不说「改回」，只许追加', () => {
  const history = [...S9.history, { stage: 'S9', at: '2026-09-30T03:00:00Z' }]
  using(() => healthy({ stage: 'S9', history }), (fx) => {
    const ctx = ctxOf(run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p))
    assert.ok(ctx.includes(MARK))
    assert.doesNotMatch(ctx, /改回/)
    assert.match(ctx, /追加一条真实的当前阶段/)
  })
})

test('unknown-stage：stage 缺失时说「缺失或不是字符串」，不写 undefined', () => {
  using(() => healthy(), (fx) => {
    const file = join(fx.runDir, 'state.json')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    delete state.stage
    writeFileSync(file, JSON.stringify(state), 'utf8')
    const ctx = ctxOf(run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p))
    assert.match(ctx, /state\.stage 缺失或不是字符串/)
    assert.doesNotMatch(ctx, /undefined/)
  })
})

test('unknown-stage：协调者收件——冒泡句、修法照带、不带 systemMessage；stderr 留自己的痕，不说「没有放行任何东西」', () => {
  using(() => healthy(S9), (fx) => {
    const r = run('deliverable', dispatch('PostToolUse', 'agent-team:at-architect', 'agent-team:at-backend'), fx.gate, fx.p)
    const ctx = ctxOf(r)
    assert.match(ctx, /这一条你改不了/)
    assert.match(ctx, /原样冒泡给派你的人/)
    assert.match(ctx, /改回 history 末条的 S2/)
    assert.equal(smOf(r), null)
    assert.match(r.stderr, /at-architect/)
    assert.doesNotMatch(r.stderr, /没有放行任何东西/)
  })
})

test('unknown-stage 与账本比对同时成立：两段并进同一份回传，受信前缀只出现一次', () => {
  // roster 要带上 at-product：S2 是多产者阶段，账本比对的 drifted 按这一趟在场的产者展开（tests/fixtures/make-run.mjs 头部）。
  using(() => healthy({ ...S9, roster: ['at-product'], artifacts: ['01-prd.md'] }), (fx) => {
    const file = join(fx.runDir, 'state.json')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    state.artifacts = { '01-prd.md': 'a'.repeat(64) }
    writeFileSync(file, JSON.stringify(state), 'utf8')
    const r = run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p)
    const ctx = ctxOf(r)
    assert.ok(ctx.includes(MARK), ctx)
    assert.ok(ctx.includes('【账本比对】'), ctx)
    assert.equal(ctx.split(TRUSTED_PREFIX).length - 1, 1)
  })
})

test('unknown-stage：照回传的修法做——返工预算门禁放行，下一次派发不再出【门禁】', () => {
  using(() => healthy(S9), (fx) => {
    const file = join(fx.runDir, 'state.json')
    const fixed = { ...JSON.parse(readFileSync(file, 'utf8')), stage: 'S2' }
    const content = JSON.stringify(fixed, null, 2)
    const { pre, post } = writeStep(fx, PM, file, content)
    for (const [c, r] of pre) assert.ok(!denied(r), `${c}：${reasonOf(r)}`)
    assert.ok(post)
    const r = run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p)
    assert.ok(!ctxOf(r).includes(MARK), ctxOf(r))
  })
})

test('unknown-stage：H5b 只留 stderr 一行，stdout 为空、不拦', () => {
  using(() => healthy(S9), (fx) => {
    const r = run('stop-gate', { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' }, fx.gate, fx.p)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /不在阶段链里/)
  })
})

// ---- 门禁自检的追加句 ----

const selfCheck = (fx, caller = PM, root = fx.p) => reasonOf(run('writepath', writing('PreToolUse', caller, join(root, GATE_CHECK_PATH)), fx.gate, fx.p))

test('门禁自检：丢指针时「在线」后面追加按原因的修法（命令开头的口径）', () => {
  for (const caller of [PM, undefined]) {
    using(UNREADABLE['pointer（丢了）'][1], (fx) => {
      const reason = selfCheck(fx, caller)
      assert.ok(reason.startsWith(GATE_CHECK_ONLINE), reason)
      assert.ok(reason.includes(`另外，门禁读不到这个项目的运行状态`), reason)
      assert.ok(reason.includes(runContextFix('pointer', { atStart: true })), reason)
    })
  }
})

test('门禁自检：插件的 stages.json 坏了——追加句叫用户重装，不叫 PM 写回什么', () => {
  using(UNREADABLE.plugin[1], (fx) => {
    const reason = selfCheck(fx)
    assert.match(reason, /重装或更新 agent-team 插件/)
    assert.doesNotMatch(reason, /写回一份合法的/)
  })
})

test('门禁自检：state.stage 不在阶段链里——追加 unknown-stage 的修法', () => {
  using(() => healthy(S9), (fx) => {
    const reason = selfCheck(fx)
    assert.match(reason, /另外，交付物核验在 state\.stage 改对之前不做/)
    assert.match(reason, /改回 history 末条的 S2/)
  })
})

test('门禁自检反例：没有 run、run 正常、子代理发起、自检写在别的项目里——不追加', () => {
  using(noRun, (fx) => assert.doesNotMatch(selfCheck(fx), /另外，/))
  using(() => healthy(), (fx) => assert.doesNotMatch(selfCheck(fx), /另外，/))
  using(UNREADABLE['pointer（丢了）'][1], (fx) => {
    const sub = selfCheck(fx, 'agent-team:at-backend')
    assert.ok(sub.startsWith(GATE_CHECK_ONLINE))
    assert.doesNotMatch(sub, /另外，/)
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-fo-else-')))
    try {
      const reason = selfCheck(fx, PM, elsewhere)
      assert.ok(reason.startsWith(GATE_CHECK_ONLINE))
      assert.doesNotMatch(reason, /另外，/)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})

// ---- 输入读不出来 ----

test('输入读不出来：fail open 的检查项在 Pre/Post 上给用户一行、不进模型；SubagentStop 只留 stderr', () => {
  using(() => healthy(), (fx) => {
    for (const [check, bad] of [['readiness', 'not json'], ['deliverable', '[1]'], ['ledger', 'null'], ['readiness', {}], ['ledger', { tool_input: {} }], ['deliverable', { tool_name: 3 }]]) {
      const r = run(check, bad, fx.gate, fx.p)
      assert.deepEqual(parse(r), { systemMessage: systemMessage('input', { check }) }, `${check} ${JSON.stringify(bad)}`)
      assert.match(r.stderr, /读不出这次的 hook 输入/, check)
    }
    const s = run('stop-gate', 'not json', fx.gate, fx.p)
    assert.equal(s.stdout, '')
    assert.match(s.stderr, /读不出这次的 hook 输入/)
  })
})

// ---- 最外层 catch（注入：hooks 的判定中途抛异常）----

const crash = (fx, check, input, how) =>
  run(check, input, fx.gate, fx.p, { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: how }, { nodeArgs: ['-r', INJECT], contract: how !== 'exit' && !how.includes('exit') })

test('崩溃：ledger 在 PM 写契约时崩——一份【门禁】给 PM、一行给用户；执行角色收到冒泡句、没有 systemMessage', () => {
  using(() => healthy({ stage: 'S1' }), (fx) => {
    const file = join(fx.runDir, '00-contract.md')
    writeFileSync(file, '# x\n', 'utf8')
    const r = crash(fx, 'ledger', writing('PostToolUse', PM, file), 'hash')
    assert.match(ctxOf(r), /^agent-team 账本回传：\n【门禁】这次写入的回传没有算完——门禁自己出了错（"injected: createHash"）/)
    assert.equal(smOf(r), systemMessage('crash', { check: 'ledger' }))
    assert.match(r.stderr, /异常崩溃/)
  })
  using(() => healthy({ stage: 'S5', roster: ['at-backend'] }), (fx) => {
    const file = join(fx.runDir, '05-impl', 'at-backend.md')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '# x\n', 'utf8')
    const r = crash(fx, 'ledger', writing('PostToolUse', 'agent-team:at-backend', file), 'hash')
    assert.match(ctxOf(r), /原样冒泡给派你的人/)
    assert.equal(smOf(r), null)
  })
})

test('崩溃：deliverable 给 PM 一份【门禁】；readiness 只给用户一行、不带受信块；stop-gate 什么都不写', () => {
  using(() => healthy(), (fx) => {
    const target = 'agent-team:at-crash'
    const d = crash(fx, 'deliverable', dispatch('PostToolUse', PM, target), `prefix:${target}`)
    assert.match(ctxOf(d), /【门禁】交付物核验这次没有做完——门禁自己出了错/)
    assert.equal(smOf(d), systemMessage('crash', { check: 'deliverable' }))
    const r = crash(fx, 'readiness', dispatch('PreToolUse', PM, target), `prefix:${target}`)
    assert.deepEqual(parse(r), { systemMessage: systemMessage('crash', { check: 'readiness' }) })
    const s = crash(fx, 'stop-gate', { hook_event_name: 'SubagentStop', agent_type: target }, `prefix:${target}`)
    assert.equal(s.stdout, '')
    assert.equal(s.status, 0)
    assert.match(s.stderr, /异常崩溃/)
  })
})

test('崩溃：已经往 stdout 写过一份之后再崩（process.exit 被注入成抛异常）——不写第二份，拒绝照样有效', () => {
  using(() => healthy({ stage: 'S1' }), (fx) => {
    const file = join(fx.runDir, '00-contract.md')
    writeFileSync(file, '# x\n', 'utf8')
    const l = crash(fx, 'ledger', writing('PostToolUse', PM, file), 'exit')
    assert.match(ctxOf(l), /【契约】/)
    assert.ok(!ctxOf(l).includes(MARK))
    assert.ok(l.stderr.includes(SECOND_WRITE_NOTE))
    const w = crash(fx, 'writepath', writing('PreToolUse', PM, join(fx.p, GATE_CHECK_PATH)), 'exit')
    assert.ok(reasonOf(w).startsWith(GATE_CHECK_ONLINE))
    assert.ok(w.stderr.includes(SECOND_WRITE_NOTE))
  })
  // 复核（docs/30 §3）：SubagentStop 的拒绝是 stderr + exit 2，不写 stdout——崩溃之后照样按 exit 2 退出，不被改判成放行。
  using(() => healthy({ stage: 'S2', roster: ['at-product'] }), (fx) => {
    const s = crash(fx, 'stop-gate', { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' }, 'exit')
    assert.equal(s.status, 2, s.stderr)
    assert.ok(s.stderr.includes('01-prd.md'), s.stderr)
    assert.ok(s.stderr.includes(SECOND_WRITE_NOTE))
  })
})

// 复核（docs/30 §3）：花名册读坏时 H1 先拒掉派发，PostToolUse:Agent 不会跑；这一格只防 H5a 的 no-run 分支在读坏的花名册上
// 自己抛异常、说成「门禁自己出了错」。
test('H5a no-run：花名册读坏时不回传、不崩', () => {
  using(() => withBrokenPlugin(noRun(), { stagesText: null, rosterText: 'null' }), (fx) => {
    const r = run('deliverable', dispatch('PostToolUse', PM, 'agent-team:at-product'), fx.gate, fx.p)
    assert.equal(r.stdout, '')
    assert.doesNotMatch(r.stderr, /异常崩溃/)
  })
})
