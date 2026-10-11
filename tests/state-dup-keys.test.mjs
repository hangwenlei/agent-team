// docs/74（docs/55 §4「JSON 里重复的键：后一个盖掉前一个，不报」）：项目经理写 state.json 时同一个对象里一个键写了两次，JSON.parse 只认最后一个，
// 前一个悄悄丢掉——解析之后分不出来。现在扫原文找出重复的键（任何一层），写 state.json 时账本把它们并进【state.json】那几条报出来，只报不拦。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { duplicateKeys } from '../hooks/lib/state.mjs'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

test('duplicateKeys：顶层与嵌套对象里重复的键都认，路径带上；字符串里的引号、转义、数组里的对象不误认；没有重复给空', () => {
  assert.deepEqual(duplicateKeys('{"stage":"S2","roster":[],"stage":"S3"}'), [{ path: [], key: 'stage' }])
  assert.deepEqual(duplicateKeys('{"trimmed":{"at-ui":"S2","at-ui":"S5"},"stage":"S5"}'), [{ path: ['trimmed'], key: 'at-ui' }])
  assert.deepEqual(duplicateKeys('{"a":{"b":{"c":1,"c":2}}}'), [{ path: ['a', 'b'], key: 'c' }])
  // 数组里的两个对象各自有同名键，不算重复；字符串值里写着 "stage" 不算键。
  assert.deepEqual(duplicateKeys('{"history":[{"stage":"S1"},{"stage":"S2"}],"note":"\\"stage\\": x","stage":"S2"}'), [])
  // 转义的引号与反斜杠。
  assert.deepEqual(duplicateKeys('{"k\\"x":1,"k\\"x":2,"z\\\\":1}'), [{ path: [], key: 'k"x' }])
  assert.deepEqual(duplicateKeys('{"stage":"S1"}'), [])
  // 数组里重复的值不是键；两个不同的键值相同也不算重复。
  assert.deepEqual(duplicateKeys('{"roster":["at-qa","at-qa"],"a":"x","b":"x"}'), [])
  // 同一个键写了三次只报一次。
  assert.deepEqual(duplicateKeys('{"s":1,"s":2,"s":3}'), [{ path: [], key: 's' }])
  // 读不出的文字（不是对象）给空。
  assert.deepEqual(duplicateKeys('not json'), [])
  assert.deepEqual(duplicateKeys(null), [])
})

test('账本（docs/74）：项目经理写的 state.json 里重复了键——【state.json】里报它、说 JSON 只认最后一个；没有重复的不说', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', roster: ['at-product'] })
  try {
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const now = readFileSync(statePath, 'utf8')
    const obj = JSON.parse(now)
    // 手写一份带重复键的原文：stage 写了两次（第二次盖掉第一次）。
    assert.ok(Object.hasOwn(obj, 'stage'))
    const raw = JSON.stringify(obj).replace(/^\{/, '{"stage":"S1",')
    writeFileSync(statePath, raw)
    const posted = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath } }
    const out = run('ledger', posted, GATE, dirs.projectDir).stdout
    const ctx = out.trim() ? JSON.parse(out).hookSpecificOutput?.additionalContext ?? '' : ''
    assert.ok(ctx.includes('键 "stage" 写了不止一次') && ctx.includes('JSON 只认最后一个'), ctx)
    writeFileSync(statePath, now)
    const out2 = run('ledger', posted, GATE, dirs.projectDir).stdout
    assert.ok(!out2.includes('写了不止一次'), out2)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
