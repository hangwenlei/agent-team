import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { readRunContext } from '../hooks/lib/runctx.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const STAGES = { S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] } }

function cleanup({ projectDir, pluginDir }) {
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(pluginDir, { recursive: true, force: true })
}

test('读得到当前 run 的 id、state 与 stages', () => {
  const dirs = makeRun({ runId: 'r42', stage: 'S2', stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.equal(ctx.runId, 'r42')
    assert.equal(ctx.state.stage, 'S2')
    assert.deepEqual(ctx.stages.S2.produces, ['01-prd.md'])
  } finally {
    cleanup(dirs)
  }
})

test('没有 .agent-team 时返回 ok:false 而不是抛异常', () => {
  const ctx = readRunContext('/definitely/not/a/real/path', '/also/not/real')
  assert.equal(ctx.ok, false)
  assert.match(ctx.reason, /current-run|\.agent-team/)
})

test('current-run 指向不存在的 run 时返回 ok:false', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    rmSync(`${dirs.projectDir}/.agent-team/runs/r1`, { recursive: true, force: true })
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
  } finally {
    cleanup(dirs)
  }
})

test('state.json 是坏 JSON 时返回 ok:false 而不是抛异常', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/runs/r1/state.json`, '{ not json', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
  } finally {
    cleanup(dirs)
  }
})

test('stages.json 从插件根读，不从项目根读', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    // 项目根里放一份内容不同的 stages.json——不应当被读到。
    writeFileSync(`${dirs.projectDir}/stages.json`, JSON.stringify({ SX: { role: 'wrong' } }), 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.ok(ctx.stages.S2, '读到的应当是插件根那份')
    assert.equal(ctx.stages.SX, undefined, '不应当读到项目根那份')
  } finally {
    cleanup(dirs)
  }
})

test('artifactExists 只在文件真存在时为 true', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['00-contract.md'], stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.artifactExists('00-contract.md'), true)
    assert.equal(ctx.artifactExists('01-prd.md'), false)
  } finally {
    cleanup(dirs)
  }
})
