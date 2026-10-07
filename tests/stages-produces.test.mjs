// 第 46 条（docs/48，M4m）：stages.produces.md 是 /agent-team:at-resume 与 /agent-team:at-status 运行时让模型读的那一份（一段的产物怎么展开）。
// 它举的例子要与 stages.json 一致、举的展开结果要与 expandProduces 一致——正文写错了，模型就照错的展开去核盘。
// 复核（docs/48 §8）：例子与写法名按表格逐行对（只比集合时，两行的例子对调、写法名改掉都照绿）；「例：」要出自它那一行那一段；规则那几句按原话钉。
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

const KINDS = ['字面文件名的数组', '含 <role> 的数组', '对象']
const kindOf = (produces) => (Array.isArray(produces) ? (produces.some((p) => typeof p === 'string' && p.includes('<role>')) ? KINDS[1] : KINDS[0]) : KINDS[2])

// 表格里每一行：| 写法 | Sx 的 `json` | 这一段要交的 |。写法名去掉反引号再比。
function tableRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => /^\|\s*([^|]+?)\s*\|\s*(S\d+) 的 `([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/.exec(line))
    .filter(Boolean)
    .map(([, kind, sid, json, says]) => ({ kind: kind.replace(/`/g, ''), sid, json, says }))
}

test('自检：tableRows() 逐行抽出写法名、段、例子与说明', () => {
  const sample = ['| 写法 | 例子 | 这一段要交的 |', '|---|---|---|', '| 含 `<role>` 的数组 | S5 的 `["05-impl/<role>.md"]` | 各一份（例：`05-impl/at-ui.md`） |'].join('\n')
  assert.deepEqual(tableRows(sample), [{ kind: '含 <role> 的数组', sid: 'S5', json: '["05-impl/<role>.md"]', says: '各一份（例：`05-impl/at-ui.md`）' }])
})

test('第 46 条：stages.produces.md 表里每一行的例子是 stages.json 里那一段的 produces 原样，写法名对得上它的形状，三种写法各一行', () => {
  const rows = tableRows(DOC)
  assert.ok(rows.length > 0, '前置：表里一行「写法 | Sx 的 `…` | …」都没抽到——这条判据空转了')
  for (const { kind, sid, json } of rows) {
    assert.deepEqual(JSON.parse(json), STAGES[sid]?.produces, `${sid} 的例子与 stages.json 不一致：${json}`)
    assert.equal(kind, kindOf(STAGES[sid].produces), `「${kind}」那一行举的 ${sid} 是「${kindOf(STAGES[sid].produces)}」`)
  }
  assert.deepEqual(rows.map((r) => r.kind).sort(), [...KINDS].sort())
})

test('第 46 条：stages.produces.md 举的展开结果，出自它那一行那一段、对那一段的某个产者用 expandProduces 算得出', () => {
  const shown = tableRows(DOC).flatMap(({ sid, says }) => [...says.matchAll(/例：`([^`]+)`/g)].map((m) => ({ sid, name: m[1] })))
  assert.ok(shown.length > 0, '前置：表里没抽到「例：`…`」——这条判据空转了')
  for (const { sid, name } of shown) {
    const st = STAGES[sid]
    assert.ok(stageRoles(st).some((r) => expandProduces(st, [r]).includes(name)), `「${name}」不是 ${sid} 对它的任何一个产者展开得出的产物`)
  }
})

// 规则那几句按原话钉（判据核不了「这句话与代码一致」，钉住它至少改了会有人看见；docs/48 §4）。比之前去掉全部空白：正文按显示宽度折行。
const RULES = [
  '没有 `producers` 的段，产者只有 `role` 那一个',
  '数组里的每一份，与这一段叫到了谁无关',
  '这一段叫到的每个产者各一份，`<role>` 换成它的角色名',
  '数组里不含 `<role>` 的条目照字面算一份',
  '这一段叫到的每个产者自己名下的那几份；对象里没有它的键，它在这一段不交东西',
  '读 `state.json` 的 `stage_roles` 里这一段的键：那是这一段叫到的人',
  '没有 `stage_roles` 字段的旧 run，退回整趟的 `roster`',
  '只留这一段的产者（`producers`，没有就是 `role`）',
  '`stage_roles` 有、却还没有这一段的键：这一段还没记账',
  '**空不算齐了**',
  '键在、值是 `[]`：记了账、这一段一个产者都没叫',
  '别拿整趟 `roster` 去展开',
]
test('第 46 条：stages.produces.md 里展开与按段取产者的规则句都在（原话）', () => {
  const squash = (s) => s.replace(/\s+/g, '')
  for (const k of RULES) assert.ok(squash(DOC).includes(squash(k)), `stages.produces.md 缺「${k}」`)
})

test('第 46 条：/agent-team:at-resume 与 /agent-team:at-status 指向 stages.produces.md', () => {
  for (const f of ['commands/at-resume.md', 'commands/at-status.md']) {
    assert.ok(read(f).includes('`${CLAUDE_PLUGIN_ROOT}/stages.produces.md`'), `${f} 没指向 stages.produces.md`)
  }
})
