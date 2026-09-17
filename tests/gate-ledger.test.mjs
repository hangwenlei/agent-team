// ledger 在 gate.mjs 里 tests/ledger.test.mjs 覆盖不到的部分：ctx 读取、路径分派、
// additionalContext 的输出形状、以及「与本检查项无关的写入保持沉默」。
// 与 tests/gate-writepath.test.mjs 同一个已知边界：gate.mjs 读的是仓库根真实
// stages.json（S1 归 at-pm、produces 是 00-contract.md），夹具改不了它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

// GATE 直接从 gate-runner.mjs 拿，不在本文件里另算一份——brief 原稿这里是
// `new URL('../hooks/gate.mjs', import.meta.url).pathname`，在 win32 上
// URL.pathname 前面带一个斜杠（"/C:/Users/..."），不是合法的 Windows 路径；
// spawnSync 把它当 argv 传给 node.exe 时会被当成"缺盘符的 POSIX 绝对路径"按当前
// 盘符再拼一次，变成 "C:\C:\Users\..."，六条测试里凡是真的 spawn 子进程的全部
// MODULE_NOT_FOUND（Task 6 落地时在本机 Windows 环境实测到，不在简报明确列出的
// 「已经过时的地方」四条里）。tests/gate-writepath.test.mjs 已经踩过同一个坑：
// 它从 gate-runner.mjs 拿用 fileURLToPath 算好的 GATE，这里照抄同一个修法，不
// 另起一份用 .pathname 的算法——两处路径计算只该有一份，跟 hooks/lib/path-norm.mjs
// 头部那条「重复会分叉」的教训是同一类。

function ctxOf(stdout) {
  if (!stdout.trim()) return null
  return JSON.parse(stdout).hookSpecificOutput.additionalContext
}

test('写了契约：回传的哈希与磁盘上算出来的一致', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', '00-contract.md')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p },
    }, GATE, projectDir)
    const ctx = ctxOf(stdout)
    assert.ok(ctx.includes(sha256OfContract(readFileSync(p))))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('写了 project.json：回传触达表，含 reach.json 落盘指示', () => {
  const { projectDir, pluginDir } = makeRun({
    runId: 'r1', stage: 'S1',
    project: { paths: { 'at-product': ['docs/'], 'at-backend': ['src/server/'] } },
  })
  try {
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'project.json') },
    }, GATE, projectDir)
    const ctx = ctxOf(stdout)
    assert.match(ctx, /reach\.json/)
    // 仓库根真实 roster.json：at-product → at-backend 这条边存在。
    assert.ok(ctx.includes('at-product → at-backend'))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('写了坏的 state.json：problems 逐条回传', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const bad = JSON.parse(readFileSync(p, 'utf8'))
    bad.rework = { S1: 2 }   // history 里 S1 只出现一次，应当是 0
    writeFileSync(p, JSON.stringify(bad), 'utf8')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p },
    }, GATE, projectDir)
    assert.match(ctxOf(stdout), /rework/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('写业务代码时保持沉默——零 stdout', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-backend',
      tool_input: { file_path: join(projectDir, 'src', 'server', 'api.ts') },
    }, GATE, projectDir)
    assert.equal(stdout.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// Task 6 变异验证第 3 项发现的缺口：上面那条「保持沉默」的夹具（stage S1、没有
// artifacts）无论 isControlFile/underDir 那道早退在不在，stageDone 恒为 false、
// kind 恒为 'other'，notices 恒是空数组——早退删不删，stdout 都是空的，那条测试
// 证明不了早退本身有必要（实测：把早退改成无条件继续，`node --test` 仍然
// pass 258 / fail 0，没有任何测试变红）。这一条把「当前阶段产物已经齐了」这个
// 会让 buildLedgerNotices 产出非空内容的条件叠上去，才能让早退的有无造成
// 可观察的差异：00-contract.md 已经在磁盘上（stageDone 为 true），但这次写入
// 仍然是与 ledger 无关的业务代码——早退在场时应当继续保持沉默，不能因为「阶段
// 已经齐了」这件事跟这次写入的路径无关就把它汇报出来。
test('阶段产物已经齐了，但这次写的是业务代码：仍然保持沉默——早退不看 stageDone', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-backend',
      tool_input: { file_path: join(projectDir, 'src', 'server', 'api.ts') },
    }, GATE, projectDir)
    assert.equal(stdout.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('ledger 永不拒绝——输出里不会出现 permissionDecision', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const { stdout, status } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-backend',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    assert.equal(status, 0)
    assert.doesNotMatch(stdout, /permissionDecision/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('没有 run 时 fail open 且留痕，不静默', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    rmSync(join(projectDir, '.agent-team', 'current-run'), { force: true })
    const { stdout, stderr, status } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'project.json') },
    }, GATE, projectDir)
    assert.equal(status, 0)
    assert.equal(stdout.trim(), '')
    assert.match(stderr, /ledger 回传/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})
