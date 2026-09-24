// M3l：门禁留痕（hooks/lib/trace.mjs）的判据。
//
// 为什么要有它：一道静默 exit 0 的门禁在会话转录里不留任何记录（docs/20 §7.3，
// 量法与原始输出在 docs/21），于是一趟干净的 run 证明不了五道门禁跑过。留痕开关
// 打开后，每次 exit 0 往 stderr 多写一行，CLI 会把它连同那道门禁的 statusMessage
// 一起记进转录。
//
// 这个开关有四条硬约束（trace.mjs 头部逐条写着），这里一条一组判据：
//   ① 默认关      —— 三、「关」的几种写法与不设，三样输出逐字节相同
//   ② 纯旁路      —— 二、开/关各跑一次：stdout 与退出码逐字节相同，stderr 只在
//                    exit 0 时多出恰好那一行（exit 2 那一支一个字不加）
//   ③ 绝不抛异常  —— 一、纯函数层：注册抛、写入抛、取环境变量抛，一样都不漏出来
//   ④ 不写文件    —— 四、开着把整张矩阵跑一遍，项目目录下的文件清单前后相同
// 另有两组：五、测试帮手缺省剥掉开关（不然开着留痕跑 node --test，九条与留痕无关的
// 既有用例会一起红，docs/21 §8 的 M1）；六、docs/21 里写的开关名、前缀与判读表就是源码里
// 与 hooks.json 里的那几样。
//
// ⚠️ 二那张矩阵是**纯旁路**这条约束唯一的子进程级判据，所以它自己要先被证明不是空转：
// 「每个检查项都在矩阵里」「退出码 0 与 2 都出现过」「stdout 空与非空都出现过」
// 各有一条自检，矩阵缩水时它们先红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, GATE, envWithoutTrace } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { CHECKS } from '../hooks/lib/checks.mjs'
import { TRACE_ENV, TRACE_PREFIX, traceEnabled, traceLine, installTrace } from '../hooks/lib/trace.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const PROJECT = JSON.parse(read('templates/project.json'))

// ---------------------------------------------------------------------------
// 一、纯函数层
// ---------------------------------------------------------------------------

test('traceEnabled：只有恰好是 "1" 才算开——缺省、空串、"0"、"true"、带空白的 "1" 一律算关', () => {
  const cases = [
    [undefined, false],
    ['', false],
    ['0', false],
    ['true', false],
    ['yes', false],
    [' 1', false],
    ['1 ', false],
    ['1', true],
  ]
  for (const [v, want] of cases) {
    const env = v === undefined ? {} : { [TRACE_ENV]: v }
    assert.equal(traceEnabled(env), want, `${TRACE_ENV}=${JSON.stringify(v)} 应当判成 ${want ? '开' : '关'}`)
  }
})

test('traceEnabled：env 本身缺失或取值时抛异常，一律当关、不漏异常', () => {
  assert.equal(traceEnabled(undefined), false)
  assert.equal(traceEnabled(null), false)
  const hostile = new Proxy({}, { get() { throw new Error('boom') } })
  assert.equal(traceEnabled(hostile), false)
})

test('traceLine：以固定前缀开头、带检查项名与 main 状态、恰好一行、以换行结尾', () => {
  const line = traceLine('contract', true)
  assert.equal(line, `${TRACE_PREFIX} check=contract main=entered exit=0\n`)
  assert.equal(traceLine('stop-gate', false), `${TRACE_PREFIX} check=stop-gate main=not-entered exit=0\n`)
})

test('traceLine：检查项名里的换行、空白与引号被收窄——这一行永远只有一行', () => {
  const line = traceLine('a\nb c"d', true)
  assert.equal(line.split('\n').length, 2, '只允许结尾那一个换行')
  assert.ok(line.startsWith(`${TRACE_PREFIX} check=a_b_c_d `), line)
  assert.ok(traceLine(undefined, true).includes('check=undefined '))
})

function fakeProc({ onThrows = false, writeThrows = false } = {}) {
  const listeners = []
  const written = []
  return {
    listeners,
    written,
    on(event, fn) {
      if (onThrows) throw new Error('on boom')
      listeners.push([event, fn])
    },
    stderr: {
      write(s) {
        if (writeThrows) throw new Error('write boom')
        written.push(s)
      },
    },
  }
}

test('installTrace：关着时一个监听都不注册，返回 false', () => {
  for (const env of [{}, { [TRACE_ENV]: '0' }, { [TRACE_ENV]: '' }]) {
    const proc = fakeProc()
    assert.equal(installTrace({ env, check: 'contract', proc, state: { entered: true } }), false)
    assert.equal(proc.listeners.length, 0, `env=${JSON.stringify(env)} 时注册了监听`)
  }
})

test('installTrace：开着时注册恰好一个 exit 监听；exit 0 写恰好一行，exit 2 与 exit 1 一个字不写', () => {
  const proc = fakeProc()
  const state = { entered: true }
  assert.equal(installTrace({ env: { [TRACE_ENV]: '1' }, check: 'rework', proc, state }), true)
  assert.equal(proc.listeners.length, 1)
  const [event, fn] = proc.listeners[0]
  assert.equal(event, 'exit')
  fn(2)
  fn(1)
  assert.deepEqual(proc.written, [], 'exit 非 0 时写了东西——exit 2 那段 stderr 是发给子代理的 Stop hook feedback')
  fn(0)
  assert.deepEqual(proc.written, [traceLine('rework', true)])
})

test('installTrace：监听在退出那一刻才读 state——main() 没进去就写 main=not-entered', () => {
  const proc = fakeProc()
  const state = { entered: false }
  installTrace({ env: { [TRACE_ENV]: '1' }, check: 'delegation', proc, state })
  proc.listeners[0][1](0)
  assert.deepEqual(proc.written, [traceLine('delegation', false)])
  state.entered = true
  proc.listeners[0][1](0)
  assert.equal(proc.written[1], traceLine('delegation', true))
})

test('installTrace：注册那一步抛异常，不漏出来、返回 false', () => {
  const proc = fakeProc({ onThrows: true })
  assert.doesNotThrow(() => installTrace({ env: { [TRACE_ENV]: '1' }, check: 'x', proc, state: {} }))
  assert.equal(installTrace({ env: { [TRACE_ENV]: '1' }, check: 'x', proc, state: {} }), false)
})

test('installTrace：写 stderr 抛异常，监听本身不抛——一次放行不能因为留痕写不出去变成失败', () => {
  const proc = fakeProc({ writeThrows: true })
  installTrace({ env: { [TRACE_ENV]: '1' }, check: 'x', proc, state: { entered: true } })
  assert.doesNotThrow(() => proc.listeners[0][1](0))
})

test('installTrace：proc 本身缺失或残缺，不漏异常', () => {
  assert.doesNotThrow(() => installTrace({ env: { [TRACE_ENV]: '1' }, check: 'x', proc: undefined, state: {} }))
  const noStderr = { on: (e, fn) => fn(0) }
  assert.doesNotThrow(() => installTrace({ env: { [TRACE_ENV]: '1' }, check: 'x', proc: noStderr, state: {} }))
})

// ---------------------------------------------------------------------------
// 二、子进程层：纯旁路矩阵
// ---------------------------------------------------------------------------
//
// 每一格造一个夹具、拿一个输入，**开/关各跑一次 gate.mjs**，比三样：
//   stdout 逐字节相同 / 退出码相同 / stderr 只在 exit 0 时多出恰好那一行。
// 格子选的是每个检查项在真实会话里会走到的那几种形状：静默放行、stderr 留痕、
// stdout 上的拒绝 JSON、stdout 上的 additionalContext、SubagentStop 的 exit 2。

const ENV_OFF = envWithoutTrace()
const ENV_ON = { ...envWithoutTrace(), [TRACE_ENV]: '1' }

function cleanDir() {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-trace-cwd-'))
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

function fromRun(opts) {
  const dirs = makeRun(opts)
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', opts.runId ?? 'r1')
  return {
    cwd: dirs.projectDir,
    runDir,
    cleanup: () => {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    },
  }
}

const SCENARIOS = [
  {
    name: 'H1 delegation：花名册之内的派发，静默放行',
    check: 'delegation',
    setup: () => ({
      ...cleanDir(),
      input: { tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-product' } },
    }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H1 delegation：花名册之外的派发，stdout 上的拒绝 JSON',
    check: 'delegation',
    setup: () => ({
      ...cleanDir(),
      input: { tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'general-purpose' } },
    }),
    shape: { status: 0, stdout: 'nonempty', stderr: 'empty' },
  },
  {
    name: 'H2 readiness：前置产物齐，静默放行',
    check: 'readiness',
    setup: () => ({
      ...fromRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: ['at-product'], project: PROJECT }),
      input: { tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-product' } },
    }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H2 readiness：没有进行中的 run，stderr 留痕放行',
    check: 'readiness',
    setup: () => ({
      ...cleanDir(),
      input: { tool_name: 'Agent', agent_type: 'at-pm', tool_input: { subagent_type: 'agent-team:at-product' } },
    }),
    shape: { status: 0, stdout: 'empty', stderr: 'nonempty' },
  },
  {
    name: 'H3 writepath：主线程（无 agent_type），静默放行',
    check: 'writepath',
    setup: () => ({ ...cleanDir(), input: { tool_name: 'Write', tool_input: { file_path: 'x.txt', content: 'a' } } }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H3 writepath：PM 写 at-product 的产物，stdout 上的拒绝 JSON',
    check: 'writepath',
    setup: () => {
      const s = fromRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], project: PROJECT })
      return { ...s, input: { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: join(s.runDir, '01-prd.md'), content: 'x' } } }
    },
    shape: { status: 0, stdout: 'nonempty', stderr: 'empty' },
  },
  {
    name: 'H4 contract：调用者是 PM，读运行上下文之前就静默放行',
    check: 'contract',
    setup: () => ({ ...cleanDir(), input: { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: 'x.txt', content: 'a' } } }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H4 contract：at-product 写自己的产物（不是契约），判定之后静默放行',
    check: 'contract',
    setup: () => {
      const s = fromRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], project: PROJECT })
      return { ...s, input: { tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: join(s.runDir, '01-prd.md'), content: 'x' } } }
    },
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H4 contract：at-product 写契约，stdout 上的拒绝 JSON',
    check: 'contract',
    setup: () => {
      const s = fromRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], project: PROJECT })
      return { ...s, input: { tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: join(s.runDir, '00-contract.md'), content: 'x' } } }
    },
    shape: { status: 0, stdout: 'nonempty', stderr: 'empty' },
  },
  {
    name: 'H6 rework：写的不是 state.json，静默放行',
    check: 'rework',
    setup: () => ({ ...cleanDir(), input: { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: 'x.txt', content: 'a' } } }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H6 rework：把 rework 改小的 Edit，stdout 上的拒绝 JSON',
    check: 'rework',
    setup: () => {
      const s = fromRun({ runId: 'r1', stage: 'S5' })
      const p = join(s.runDir, 'state.json')
      writeFileSync(
        p,
        JSON.stringify({
          run_id: '20260917-1430-fixture', stage: 'S5', contract_sha: 'PENDING', roster: [], artifacts: {},
          never_invoked: [], escalations: [],
          history: [
            { stage: 'S1', at: '2026-09-17T14:30:00Z' },
            { stage: 'S5', at: '2026-09-17T14:40:00Z' },
            { stage: 'S5', at: '2026-09-17T14:50:00Z' },
          ],
          rework: { S5: 1 },
        }),
        'utf8',
      )
      return {
        ...s,
        input: { tool_name: 'Edit', agent_type: 'at-pm', tool_input: { file_path: p, old_string: '"rework":{"S5":1}', new_string: '"rework":{"S5":0}' } },
      }
    },
    shape: { status: 0, stdout: 'nonempty', stderr: 'empty' },
  },
  {
    name: 'H5a deliverable：不是 Agent 调用，静默退出',
    check: 'deliverable',
    setup: () => ({ ...cleanDir(), input: { tool_name: 'Bash', tool_input: {} } }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H5a deliverable：at-product 返回而产物还没落盘，stdout 上的 additionalContext',
    check: 'deliverable',
    setup: () => ({
      ...fromRun({ runId: 'r1', stage: 'S2', roster: ['at-product'] }),
      input: { tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } },
    }),
    shape: { status: 0, stdout: 'nonempty', stderr: 'empty' },
  },
  {
    name: 'H5b stop-gate：产物已经落盘，静默放行',
    check: 'stop-gate',
    setup: () => ({
      ...fromRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'] }),
      input: { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' },
    }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'H5b stop-gate：产物缺失，exit 2 + stderr（这一支留痕一个字都不许加）',
    check: 'stop-gate',
    setup: () => ({
      ...fromRun({ runId: 'r1', stage: 'S2' }),
      input: { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' },
    }),
    shape: { status: 2, stdout: 'empty', stderr: 'nonempty' },
  },
  // M3n：内部分叉带着主线程（at-pm）的身份停下，在 PM 自己的阶段、PM 的产物还不在
  // （docs/22 §5 的实物）。这一支是「判定为不归本检查项管」，它的放行不许比别的放行
  // 更不可见——开着留痕时这一格要多出恰好那一行，和其它静默放行一样。
  {
    name: 'H5b stop-gate：分叉带着 PM 的身份在 S4 停下、04-dispatch.md 还不在，判定为不归它管、静默放行',
    check: 'stop-gate',
    setup: () => ({
      ...fromRun({ runId: 'r1', stage: 'S4' }),
      input: { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-pm' },
    }),
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'ledger：写的不在 .agent-team 下，静默退出',
    check: 'ledger',
    setup: () => {
      const s = fromRun({ runId: 'r1', stage: 'S2' })
      return { ...s, input: { tool_name: 'Write', agent_type: 'at-backend', tool_input: { file_path: join(s.cwd, 'src', 'x.mjs'), content: 'x' } } }
    },
    shape: { status: 0, stdout: 'empty', stderr: 'empty' },
  },
  {
    name: 'ledger：写 run 目录下的产物，stdout 上的【产物】回传',
    check: 'ledger',
    setup: () => {
      const s = fromRun({ runId: 'r1', stage: 'S2', artifacts: ['01-prd.md'] })
      return { ...s, input: { tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: join(s.runDir, '01-prd.md'), content: 'x' } } }
    },
    shape: { status: 0, stdout: 'nonempty', stderr: 'empty' },
  },
  {
    name: 'ledger：没有进行中的 run，stderr 留痕',
    check: 'ledger',
    setup: () => ({ ...cleanDir(), input: { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: 'x.txt', content: 'a' } } }),
    shape: { status: 0, stdout: 'empty', stderr: 'nonempty' },
  },
]

function runBoth(sc) {
  const s = sc.setup()
  try {
    return {
      off: run(sc.check, s.input, GATE, s.cwd, ENV_OFF),
      on: run(sc.check, s.input, GATE, s.cwd, ENV_ON),
    }
  } finally {
    s.cleanup()
  }
}

// 自检：矩阵本身不是空转。
test('自检：矩阵覆盖 checks.mjs 里的每一个检查项——新增检查项而不进矩阵，这条先红', () => {
  const covered = new Set(SCENARIOS.map((s) => s.check))
  for (const name of Object.keys(CHECKS)) assert.ok(covered.has(name), `检查项 ${name} 不在留痕矩阵里`)
})

test('自检：矩阵里退出码 0 与 2 都出现过、stdout 空与非空都出现过', () => {
  const statuses = new Set(SCENARIOS.map((s) => s.shape.status))
  const stdouts = new Set(SCENARIOS.map((s) => s.shape.stdout))
  assert.deepEqual([...statuses].sort(), [0, 2])
  assert.deepEqual([...stdouts].sort(), ['empty', 'nonempty'])
})

for (const sc of SCENARIOS) {
  test(`${sc.name}：夹具自检——留痕关着时的形状就是这一格声称的形状`, () => {
    const { off } = runBoth(sc)
    assert.equal(off.status, sc.shape.status, `退出码：${off.status}；stderr=${off.stderr}`)
    assert.equal(off.stdout === '' ? 'empty' : 'nonempty', sc.shape.stdout, `stdout=${off.stdout}`)
    assert.equal(off.stderr === '' ? 'empty' : 'nonempty', sc.shape.stderr, `stderr=${off.stderr}`)
  })

  test(`${sc.name}：开/关两次，stdout 逐字节相同、退出码相同`, () => {
    const { off, on } = runBoth(sc)
    assert.equal(on.stdout, off.stdout)
    assert.equal(on.status, off.status)
  })

  test(`${sc.name}：开着时 stderr 只多出恰好那一行，而且只在 exit 0 时多`, () => {
    const { off, on } = runBoth(sc)
    const extra = off.status === 0 ? traceLine(sc.check, true) : ''
    assert.equal(on.stderr, off.stderr + extra)
  })
}

// ---------------------------------------------------------------------------
// 三、默认关：「关」的几种写法与不设，三样输出逐字节相同
// ---------------------------------------------------------------------------

// 按形状挑，不按下标挑：下标是位置，矩阵里插一格就静默指到别处（docs/16 那条
// 「方位词和行号是同一族」）。三种形状各取第一格：静默放行、stderr 留痕放行、exit 2。
const BY_SHAPE = [
  (s) => s.shape.status === 0 && s.shape.stdout === 'empty' && s.shape.stderr === 'empty',
  (s) => s.shape.status === 0 && s.shape.stdout === 'empty' && s.shape.stderr === 'nonempty',
  (s) => s.shape.status === 2,
].map((pred) => SCENARIOS.find(pred))

test('自检：「默认关」那几条挑得到三种形状各一格', () => {
  assert.equal(BY_SHAPE.filter(Boolean).length, 3)
})

for (const v of ['0', '', 'true', 'yes']) {
  test(`默认关：${TRACE_ENV}=${JSON.stringify(v)} 与不设逐字节相同（静默放行、stderr 留痕、exit 2 各一格）`, () => {
    for (const sc of BY_SHAPE) {
      const s = sc.setup()
      try {
        const absent = run(sc.check, s.input, GATE, s.cwd, ENV_OFF)
        const other = run(sc.check, s.input, GATE, s.cwd, { ...ENV_OFF, [TRACE_ENV]: v })
        assert.deepEqual(other, absent, `${sc.name}`)
      } finally {
        s.cleanup()
      }
    }
  })
}

// ---------------------------------------------------------------------------
// 四、不写文件：开着把整张矩阵跑一遍，项目目录下的文件清单前后相同
// ---------------------------------------------------------------------------

function listing(dir) {
  const out = []
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const st = statSync(p)
      out.push(`${p.slice(dir.length)}|${st.isDirectory() ? 'd' : st.size}`)
      if (st.isDirectory()) walk(p)
    }
  }
  walk(dir)
  return out.sort()
}

test('不写文件：开着跑遍整张矩阵，每一格的项目目录文件清单前后相同', () => {
  for (const sc of SCENARIOS) {
    const s = sc.setup()
    try {
      const before = listing(s.cwd)
      run(sc.check, s.input, GATE, s.cwd, ENV_ON)
      assert.deepEqual(listing(s.cwd), before, sc.name)
    } finally {
      s.cleanup()
    }
  }
})

// ---------------------------------------------------------------------------
// 五、测试帮手缺省剥掉开关
// ---------------------------------------------------------------------------

test('测试帮手：跑测试的进程自己开着留痕，run() 缺省仍然按「关」跑', () => {
  const saved = process.env[TRACE_ENV]
  process.env[TRACE_ENV] = '1'
  const s = cleanDir()
  try {
    const r = run('writepath', { tool_name: 'Write', tool_input: { file_path: 'x.txt', content: 'a' } }, GATE, s.cwd)
    assert.equal(r.stderr, '')
  } finally {
    if (saved === undefined) delete process.env[TRACE_ENV]
    else process.env[TRACE_ENV] = saved
    s.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 六、docs/21 写的开关名与前缀，就是源码里那两个
// ---------------------------------------------------------------------------
//
// docs/21 是「怎么用它验证一趟 run」的那份说明：它教人设哪个变量、grep 哪个前缀。
// 源码里任何一个改了名而文档没跟，照着文档做的人会得到一个零命中——而零命中在这里
// 恰好长得跟「门禁没跑」一模一样。

test('docs/21 里写着的开关名与 grep 前缀，就是 hooks/lib/trace.mjs 导出的那两个', () => {
  const doc = read('docs/21-门禁留痕.md')
  assert.ok(doc.includes(TRACE_ENV), `docs/21 里找不到 ${TRACE_ENV}`)
  assert.ok(doc.includes(TRACE_PREFIX), `docs/21 里找不到 ${TRACE_PREFIX}`)
})

// docs/21 §4 那张判读表，是核的人把一条记录对回「这是哪一道门禁」的唯一依据：
// 记录里 CLI 写下的身份是 `command` 字段 = hooks.json 的 statusMessage，
// 而这一行自报的是 check=<检查项>。**两列都来自 hooks/hooks.json**，所以表逐行对着它钉：
// 有人改了一句 statusMessage、或者加了一道门禁而表没跟，核的人会拿着一句过期的字去
// 对记录——对不上时它长得跟「那道门禁没跑」一模一样。
//
// 框表用两个锚（§4 的标题与 §5 的标题），锚在文件里必须恰好出现一次：撞上第二处，
// 抠出来的就不是那张表（docs/16 §3.2 那个形状）。
const TABLE_START = '## 4. 怎么用它验证一趟 run 里每道门禁都跑过'
const TABLE_END = '## 5. '

function traceTableOf(doc) {
  const nStart = doc.split(TABLE_START).length - 1
  if (nStart !== 1) return { err: `起始锚出现 ${nStart} 次，要求恰好 1 次` }
  const rest = doc.slice(doc.indexOf(TABLE_START) + TABLE_START.length)
  const nEnd = rest.split(TABLE_END).length - 1
  if (nEnd !== 1) return { err: `结束锚在起始锚之后出现 ${nEnd} 次，要求恰好 1 次` }
  const body = rest.slice(0, rest.indexOf(TABLE_END))
  const pairs = []
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\|[^|]*\|\s*`([a-z-]+)`\s*\|\s*`([^`]+)`\s*\|/)
    if (m) pairs.push(`${m[1]} ⇄ ${m[2]}`)
  }
  return { pairs }
}

function hooksJsonPairs() {
  const hooks = JSON.parse(read('hooks/hooks.json')).hooks
  const pairs = []
  for (const groups of Object.values(hooks)) {
    for (const g of groups) for (const h of g.hooks) pairs.push(`${h.args[1]} ⇄ ${h.statusMessage}`)
  }
  return pairs
}

test('自检：traceTableOf() 从合成样本里只抠判读表那几行，别的表不混进来', () => {
  const sample = [
    '| `PreToolUse:Write` | **有** | x |',
    TABLE_START,
    '| 门禁 | `check=` | 记录的 `command` |',
    '| H1 | `delegation` | `校验派发白名单…` | x |',
    '## 5. 下一节',
    '| H9 | `nope` | `不该被抠出来` | x |',
  ].join('\n')
  assert.deepEqual(traceTableOf(sample), { pairs: ['delegation ⇄ 校验派发白名单…'] })
})

test('docs/21 §4 那张判读表逐行等于 hooks/hooks.json 里的（检查项, statusMessage）', () => {
  const got = traceTableOf(read('docs/21-门禁留痕.md'))
  assert.ok(!got.err, `docs/21 里框不出那张判读表：${got.err}`)
  assert.deepEqual(got.pairs.slice().sort(), hooksJsonPairs().sort())
})
