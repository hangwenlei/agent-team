// 第 46 条（docs/48，M4m）：stages.produces.md 是 /agent-team:at-resume 与 /agent-team:at-status 运行时让模型读的那一份（一段的产物怎么展开）。
// 它举的例子要与 stages.json 一致、举的展开结果要与 expandProduces 一致——正文写错了，模型就照错的展开去核盘。
// 给维护者的那一份（理由、消费方表、开发史）留在 stages.README.md；运行时的正文不指向它，由 tests/runtime-prose.test.mjs 钉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandProduces, stageRoles } from '../hooks/lib/stages.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const STAGES = JSON.parse(read('stages.json'))
const DOC = read('stages.produces.md')

const kindOf = (produces) =>
  Array.isArray(produces) ? (produces.some((p) => typeof p === 'string' && p.includes('<role>')) ? '含 <role> 的数组' : '字面文件名的数组') : '对象'

test('第 46 条：stages.produces.md 表里每个例子都是 stages.json 里那一段的 produces 原样，三种写法各有一个', () => {
  const examples = [...DOC.matchAll(/(S\d+) 的 `([^`]+)`/g)].map(([, sid, json]) => ({ sid, json }))
  assert.ok(examples.length > 0, '前置：表里一个「S? 的 `…`」例子都没抽到——这条判据空转了')
  for (const { sid, json } of examples) {
    assert.deepEqual(JSON.parse(json), STAGES[sid]?.produces, `${sid} 的例子与 stages.json 不一致：${json}`)
  }
  assert.deepEqual([...new Set(examples.map(({ sid }) => kindOf(STAGES[sid].produces)))].sort(), ['含 <role> 的数组', '对象', '字面文件名的数组'].sort())
})

test('第 46 条：stages.produces.md 举的展开结果，是 expandProduces 对那一段的某个产者算出来的', () => {
  const shown = [...DOC.matchAll(/例：`([^`]+)`/g)].map((m) => m[1])
  assert.ok(shown.length > 0, '前置：没抽到「例：`…`」——这条判据空转了')
  for (const name of shown) {
    const from = Object.entries(STAGES).filter(([, st]) => stageRoles(st).some((r) => expandProduces(st, [r]).includes(name)))
    assert.ok(from.length > 0, `「${name}」不是任何一段对任何一个产者展开得出的产物`)
  }
})

test('第 46 条：stages.produces.md 按段取产者——stage_roles 里这一段的键，旧 run 退回 roster，空不算齐了', () => {
  // 比之前去掉全部空白：正文按显示宽度折行，一句话会断在两行。
  const squash = (s) => s.replace(/\s+/g, '')
  for (const k of ['读 `state.json` 的 `stage_roles` 里这一段的键', '没有 `stage_roles` 字段的旧 run，退回整趟的 `roster`', '**空不算齐了**', '别拿整趟 `roster` 去展开']) {
    assert.ok(squash(DOC).includes(squash(k)), `stages.produces.md 缺「${k}」`)
  }
})

test('第 46 条：/agent-team:at-resume 与 /agent-team:at-status 指向 stages.produces.md', () => {
  for (const f of ['commands/at-resume.md', 'commands/at-status.md']) {
    assert.ok(read(f).includes('`${CLAUDE_PLUGIN_ROOT}/stages.produces.md`'), `${f} 没指向 stages.produces.md`)
  }
})
