// docs/74（docs/55 §4「JSON 里重复的键：后一个盖掉前一个，不报」）：项目经理写 state.json 时同一个对象里一个键写了两次，JSON.parse 只认最后一个，
// 前一个悄悄丢掉——解析之后分不出来。现在扫原文找出重复的键（任何一层），写 state.json 时账本把它们并进【state.json】那几条报出来，只报不拦。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { duplicateKeys, duplicateKeyLines, DUP_LIMITS } from '../hooks/lib/state.mjs'
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
  assert.deepEqual(duplicateKeys('{"roster":["at-qa","at-qa","at-qa"],"a":"x","b":"x"}'), [])
  // 复核（docs/74 §8）：转义照 JSON.parse 解——\u 写法与原字是同一个键；\n、\r、\b 不是字母 n、r、b。
  assert.deepEqual(duplicateKeys('{"\\u0073tage":1,"stage":2}'), [{ path: [], key: 'stage' }])
  assert.deepEqual(duplicateKeys('{"a\\nb":1,"anb":2}'), [])
  assert.deepEqual(duplicateKeys('{"a\\rb":1,"arb":2,"\\b":1,"b":2,"\\f":1,"f":2}'), [])
  // 数组里的对象有重复：路径带上它是第几条（数字，从 0 起）。
  assert.deepEqual(duplicateKeys('{"history":[{"stage":"S1"},{"stage":"S1","stage":"S2"}]}'), [{ path: ['history', 1], key: 'stage' }])
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
    const raw = JSON.stringify(obj).replace(/^\{/, '{"stage":"S1","trimed":{},"备注":{"说明":1,"说明":2},')
    writeFileSync(statePath, raw)
    const posted = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath } }
    const out = run('ledger', posted, GATE, dirs.projectDir).stdout
    const ctx = out.trim() ? JSON.parse(out).hookSpecificOutput?.additionalContext ?? '' : ''
    assert.ok(ctx.includes('键 "stage" 写了不止一次') && ctx.includes('JSON 只认最后一个——门禁读到的是最后写的那个值'), ctx)
    // 复核（docs/74 §8）：嵌套的带路径、中文键照 UTF-8 读、与认不出的键在同一块里。
    assert.ok(ctx.includes('键 "说明" 写了不止一次（在 "备注" 里）'), ctx)
    const block = ctx.slice(ctx.indexOf('【state.json】'))
    assert.ok(block.includes('认不出的键 "trimed"') && block.includes('键 "stage" 写了不止一次'), block)
    writeFileSync(statePath, now)
    const out2 = run('ledger', posted, GATE, dirs.projectDir).stdout
    assert.ok(!out2.includes('写了不止一次'), out2)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 安全审查（docs/74 §8）：门禁每次写 state.json 都扫原文，要有上限——嵌套很深、重复的键很多、原文很长的，都不该把门禁拖垮或把回传撑爆。
test('duplicateKeys 的上限（docs/74 §8）：嵌套很深的不抛、不慢，超过深度的那几层不认键；重复的键很多时报的条数封顶、末尾一行说还有几个；原文太长不扫', () => {
  // 复核（docs/74 §8）：对象嵌套才是平方级的那一路（每一层复制一份路径），数组本来就不慢。
  const deep = '{"a":'.repeat(150000) + '1' + '}'.repeat(150000)
  const t0 = Date.now()
  assert.deepEqual(duplicateKeys(deep), [])
  assert.ok(Date.now() - t0 < 2000, '深嵌套扫得太慢')
  // 深度之内的重复照报，超过深度的那几层不认。
  const nest = (n, inner) => '{"k":'.repeat(n) + inner + '}'.repeat(n)
  assert.equal(duplicateKeys(nest(3, '{"a":1,"b":2,"b":3}')).length, 1)
  assert.equal(duplicateKeys(nest(DUP_LIMITS.depth + 5, '{"a":1,"b":2,"b":3}')).length, 0)
  // 很多重复：报的条数封顶，账本那几行末尾一行说还有几个没列。
  const many = '{' + Array.from({ length: 300 }, (_, i) => `"k${i}":1,"k${i}":2`).join(',') + '}'
  assert.equal(duplicateKeys(many).length, DUP_LIMITS.report)
  const lines = duplicateKeyLines(many)
  assert.equal(lines.length, DUP_LIMITS.report + 1)
  assert.ok(lines[lines.length - 1].includes(`还有 ${300 - DUP_LIMITS.report} 个`), lines[lines.length - 1])
  // 原文太长不扫。
  const huge = '{"a":1,"a":2,"pad":"' + 'x'.repeat(DUP_LIMITS.chars) + '"}'
  assert.deepEqual(duplicateKeys(huge), [])
})

test('duplicateKeyLines（docs/74 §8）：数组下标写成第几条（从 1 起）；措辞说门禁读的是最后一个、删掉前面的不改变读到的值', () => {
  const [line] = duplicateKeyLines('{"history":[{"stage":"S1"},{"stage":"S1","stage":"S2"}]}')
  assert.ok(line.includes('（在 "history" → 第 2 条 里）') && line.includes('删掉前面几个不改变门禁读到的值'), line)
})
