// 门禁找「用户项目根」的口径（docs/24 §2.1，全量审查第 1 条）。
//
// 此前 hooks/gate.mjs 用 process.cwd() 当项目根，前提是「hook 以用户项目为 cwd 运行」。
// 这个前提只在会话刚起来时成立：平台按会话**当前** cwd 起 hook 进程，而主线程的 Bash
// 做过 cd 之后，这个 cwd 会一直留在子目录里（子代理的 Bash 不跨调用保留 cd，主线程保留）。
// at-pm 就是主线程、持有 Bash、正文还要它跑构建与测试——一次 `cd web && npm test` 之后，
// 本会话余下时间里 readRunContext 在 <子目录>/.agent-team 找不到 run，判 no-run，H2–H6
// 全部 fail open，只往 stderr 写一句「当前没有进行中的 run」。平台注入给 hook 的
// CLAUDE_PROJECT_DIR 不随 cd 漂移，这才是项目根。
//
// 下面的子进程判据**每一条都把 cwd 钉在项目的子目录里**，只经 CLAUDE_PROJECT_DIR 告诉门禁
// 项目根在哪——gate.mjs 里 ROOT_PROJECT 的每一处消费点（readiness、writepath、contract、
// rework、stop-gate/deliverable 共用的那一处、ledger）各配一条。把 ROOT_PROJECT 改回
// process.cwd()，这里每一条都红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE, hermeticEnv } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { projectRootFrom } from '../hooks/lib/runctx.mjs'

// ---- 纯函数 ----

test('projectRootFrom：CLAUDE_PROJECT_DIR 有值时用它，不看 cwd', () => {
  assert.equal(projectRootFrom({ CLAUDE_PROJECT_DIR: '/proj' }, '/proj/web'), '/proj')
})

test('projectRootFrom：CLAUDE_PROJECT_DIR 缺失时退回 cwd', () => {
  assert.equal(projectRootFrom({}, '/proj'), '/proj')
})

test('projectRootFrom：CLAUDE_PROJECT_DIR 是空串时退回 cwd——空串不是一个目录', () => {
  assert.equal(projectRootFrom({ CLAUDE_PROJECT_DIR: '' }, '/proj'), '/proj')
})

test('projectRootFrom：env 不是对象时退回 cwd，不抛异常', () => {
  assert.equal(projectRootFrom(undefined, '/proj'), '/proj')
})

// ---- 子进程：cwd 在子目录，项目根只由 CLAUDE_PROJECT_DIR 给出 ----

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
