// 门禁找「用户项目根」的口径（docs/24 §2.1，全量审查第 1 条）。
//
// 此前 hooks/gate.mjs 用 process.cwd() 当项目根，前提是「hook 以用户项目为 cwd 运行」。
// 这个前提只在会话刚起来时成立：平台按会话**当前** cwd 起 hook 进程，而主线程的 Bash
// 做过 cd 之后，这个 cwd 会一直留在子目录里（子代理的 Bash 不跨调用保留 cd，主线程保留）。
// at-pm 就是主线程、持有 Bash、正文还要它跑构建与测试——一次 `cd web && npm test` 之后，
// 本会话余下时间里 readRunContext 在 <子目录>/.agent-team 找不到 run，判 no-run，H2–H6
// 全部 fail open，只往 stderr 写一句「当前没有进行中的 run」。
//
// 只换成 CLAUDE_PROJECT_DIR 也不对（M3p 复核，docs/24 §2.1）：它是**会话启动时**的项目根，
// 用户 /cd 到另一个项目之后它不跟着走——那边的 run 就被门禁整个看丢了，这是同一类 fail open。
// 现行口径：从 cwd 往上找最近的 .agent-team；cwd 还在启动项目里时找到启动项目为止、不越界，
// 离开了启动项目就一直找上去；都找不到才退回 CLAUDE_PROJECT_DIR（再没有就是 cwd）。
//
// 下面的子进程判据**每一条都把 cwd 钉在别处**（项目的子目录，或 /cd 之后的另一个项目），
// gate.mjs 里 ROOT_PROJECT 的每一处消费点（readiness、writepath、contract、rework、
// stop-gate/deliverable 共用的那一处、ledger 有 run 与没有 run 的两处）各配一条。
// 把 ROOT_PROJECT 改回 process.cwd()，这里每一条都红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE, hermeticEnv } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { projectRootFrom } from '../hooks/lib/runctx.mjs'
import { norm } from '../hooks/lib/path-norm.mjs'
import { TRACE_ENV } from '../hooks/lib/trace.mjs'

// ---- projectRootFrom 本身（「这个目录下有没有 .agent-team」由调用方注入；比较经 norm()，
// 假路径两侧同样按字面解析，M3q）----

// dirs：有 .agent-team 的目录。比较一律过 norm()，免得 win32 上 '/proj' 被 resolve 成 'C:proj'
// 之后字面对不上。
const having = (...dirs) => {
  const set = new Set(dirs.map(norm))
  return (d) => set.has(norm(d))
}
const root = (env, cwd, has) => norm(projectRootFrom(env, cwd, has))

test('projectRootFrom：cwd 在启动项目的子目录里，往上找到启动项目的 .agent-team', () => {
  assert.equal(root({ CLAUDE_PROJECT_DIR: '/proj' }, '/proj/web/src', having('/proj')), norm('/proj'))
})

test('projectRootFrom：/cd 到另一个项目之后，用那个项目的 .agent-team，不用启动项目的', () => {
  assert.equal(root({ CLAUDE_PROJECT_DIR: '/a' }, '/b/web', having('/a', '/b')), norm('/b'))
})

test('projectRootFrom：cwd 在启动项目里时不越过启动项目往上找——祖先目录里的 .agent-team 不是这个项目的', () => {
  assert.equal(root({ CLAUDE_PROJECT_DIR: '/home/u/proj' }, '/home/u/proj/web', having('/home/u')), norm('/home/u/proj'))
})

test('projectRootFrom：离开启动项目、一路找不到 .agent-team 时退回启动项目', () => {
  assert.equal(root({ CLAUDE_PROJECT_DIR: '/a' }, '/b/web', having()), norm('/a'))
})

test('projectRootFrom：离最近的那个赢——嵌套的子项目有自己的 .agent-team 时用它', () => {
  assert.equal(root({ CLAUDE_PROJECT_DIR: '/proj' }, '/proj/pkg/x', having('/proj', '/proj/pkg')), norm('/proj/pkg'))
})

// M3v 第三轮真实会话（docs/30 §3）：PM 用 Bash `cd .agent-team/runs/<id>` 之后 cwd 留在那里，相对路径的 Write 在 run 目录里
// 造出一个嵌套的 .agent-team——「离最近的那个赢」于是把 run 目录认成了项目根，那一趟的门禁全看错了地方。项目根不会在
// 某个 .agent-team 目录里面，那样的候选跳过。
test('projectRootFrom：.agent-team 里面嵌套出来的 .agent-team 不算——项目根不会在 .agent-team 目录里', () => {
  const nested = '/proj/.agent-team/runs/r1'
  assert.equal(root({ CLAUDE_PROJECT_DIR: '/proj' }, nested, having('/proj', nested)), norm('/proj'))
  assert.equal(root({}, `${nested}/sub`, having('/proj', nested)), norm('/proj'))
  assert.equal(root({}, '/proj/.AGENT-TEAM/runs/r1', having('/proj', '/proj/.AGENT-TEAM/runs/r1')), norm('/proj'))
})

test('projectRootFrom：没有 CLAUDE_PROJECT_DIR 时照样往上找', () => {
  assert.equal(root({}, '/proj/web', having('/proj')), norm('/proj'))
})

test('projectRootFrom：没有 CLAUDE_PROJECT_DIR、也找不到 .agent-team 时退回 cwd', () => {
  assert.equal(root({}, '/proj/web', having()), norm('/proj/web'))
})

test('projectRootFrom：CLAUDE_PROJECT_DIR 是空串时当它不存在——空串不是一个目录', () => {
  assert.equal(root({ CLAUDE_PROJECT_DIR: '' }, '/proj/web', having()), norm('/proj/web'))
})

test('projectRootFrom：env 是 undefined 或 null 时不抛，按没有 CLAUDE_PROJECT_DIR 处理', () => {
  assert.equal(root(undefined, '/proj/web', having('/proj')), norm('/proj'))
  assert.equal(root(null, '/proj/web', having('/proj')), norm('/proj'))
})

test('projectRootFrom：探测函数抛异常时不抛，退回 CLAUDE_PROJECT_DIR', () => {
  const boom = () => { throw new Error('EACCES') }
  assert.equal(root({ CLAUDE_PROJECT_DIR: '/proj' }, '/proj/web', boom), norm('/proj'))
})

test('hermeticEnv：剥掉留痕开关与 CLAUDE_PROJECT_DIR，别的变量原样保留', () => {
  const env = hermeticEnv({ [TRACE_ENV]: '1', CLAUDE_PROJECT_DIR: '/x', KEEP: 'y' })
  assert.deepEqual(env, { KEEP: 'y' })
})

// ---- 子进程：cwd 在项目的子目录里 ----

const PROJECT = {
  available_roles: ['at-product', 'at-architect', 'at-backend', 'at-frontend'],
  paths: { 'at-backend': ['src/server/'], 'at-frontend': ['src/web/'] },
}

function setup(opts) {
  const dirs = makeRun({ project: PROJECT, ...opts })
  const sub = join(dirs.projectDir, 'src', 'server')
  mkdirSync(sub, { recursive: true })
  const env = { ...hermeticEnv(), CLAUDE_PROJECT_DIR: dirs.projectDir }
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  const gate = (check, input) => run(check, input, GATE, sub, env)
  return { dirs, sub, runDir, gate }
}

function cleanup({ dirs }) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
}

test('cwd 在子目录：H2 就绪门禁照样按项目根的 run 判定——缺前置产物时 deny', () => {
  const f = setup({ stage: 'S2' })
  try {
    const { stdout } = f.gate('readiness', {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'agent-team:at-architect' },
    })
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(f)
  }
})

test('cwd 在子目录：H3 写路径门禁照样拦 at-backend 写 at-frontend 的地盘', () => {
  const f = setup({ stage: 'S5', roster: ['at-backend'] })
  try {
    const { stdout } = f.gate('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(f.dirs.projectDir, 'src', 'web', 'App.tsx'), content: 'x' },
    })
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(f)
  }
})

test('cwd 在子目录：H4 契约保护照样拦子代理写 00-contract.md', () => {
  const f = setup({ stage: 'S5', roster: ['at-backend'], artifacts: ['00-contract.md'] })
  try {
    const { stdout } = f.gate('contract', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(f.runDir, '00-contract.md'), content: 'x' },
    })
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(f)
  }
})

test('cwd 在子目录：H6 返工预算照样拦把 history 删短的 Write', () => {
  const history = [
    { stage: 'S1', at: '2026-09-17T14:30:00Z' },
    { stage: 'S2', at: '2026-09-17T14:40:00Z' },
    { stage: 'S3', at: '2026-09-17T14:50:00Z' },
  ]
  const f = setup({ stage: 'S3', history })
  try {
    const p = join(f.runDir, 'state.json')
    const before = JSON.parse(readFileSync(p, 'utf8'))
    const after = { ...before, stage: 'S2', history: history.slice(0, 2) }
    const { stdout } = f.gate('rework', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: p, content: JSON.stringify(after) },
    })
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(f)
  }
})

test('cwd 在子目录：H5b 照样把没交产物就停下的子代理顶回去（exit 2）', () => {
  const f = setup({ stage: 'S2', roster: ['at-product'] })
  try {
    const { status } = f.gate('stop-gate', {
      hook_event_name: 'SubagentStop',
      agent_type: 'agent-team:at-product',
    })
    assert.equal(status, 2)
  } finally {
    cleanup(f)
  }
})

test('cwd 在子目录：ledger 照样回传契约哈希——项目根读对了，账本才有东西可回', () => {
  const f = setup({ stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const p = join(f.runDir, '00-contract.md')
    writeFileSync(p, '# 契约\n', 'utf8')
    const { stdout } = f.gate('ledger', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: p, content: '# 契约\n' },
    })
    assert.match(stdout, /sha256/)
  } finally {
    cleanup(f)
  }
})

test('对照：CLAUDE_PROJECT_DIR 缺失、cwd 就是项目根时，门禁照旧按 cwd 判定', () => {
  const dirs = makeRun({ project: PROJECT, stage: 'S5', roster: ['at-backend'], artifacts: ['00-contract.md'] })
  try {
    const { stdout } = run(
      'contract',
      {
        tool_name: 'Write',
        agent_type: 'agent-team:at-backend',
        tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md'), content: 'x' },
      },
      GATE,
      dirs.projectDir,
      hermeticEnv(),
    )
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('cwd 在子目录、没有 run：ledger 照样从项目根读 project.json、回传触达表——/at-init 那条通道', () => {
  const f = setup({ stage: 'S1' })
  try {
    rmSync(join(f.dirs.projectDir, '.agent-team', 'current-run'))
    rmSync(join(f.dirs.projectDir, '.agent-team', 'runs'), { recursive: true, force: true })
    const { stdout } = f.gate('ledger', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(f.dirs.projectDir, '.agent-team', 'project.json') },
    })
    assert.match(stdout, /reach\.json/)
  } finally {
    cleanup(f)
  }
})

// ---- 子进程：/cd 到另一个项目之后 ----
//
// 会话在 A 启动（CLAUDE_PROJECT_DIR = A，A 里没有 run），用户 /cd 到 B，run 在 B。
// 只认 CLAUDE_PROJECT_DIR 的门禁在 A 里找不到 run，B 里的一切都 fail open——M3p 第一版就是
// 这样（复核拿修复前后两份代码对照实测过）。

test('/cd 到另一个项目之后：门禁认那个项目的 run——H4 照样拦子代理写那边的契约', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-home-')))
  const dirs = makeRun({ project: PROJECT, stage: 'S5', roster: ['at-backend'], artifacts: ['00-contract.md'] })
  try {
    const sub = join(dirs.projectDir, 'src', 'server')
    mkdirSync(sub, { recursive: true })
    const { stdout } = run(
      'contract',
      {
        tool_name: 'Write',
        agent_type: 'agent-team:at-backend',
        tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md'), content: 'x' },
      },
      GATE,
      sub,
      { ...hermeticEnv(), CLAUDE_PROJECT_DIR: home },
    )
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
