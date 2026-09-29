// 门禁自检的正文一半（M3t，docs/28，全量审查第 4 条）：协议只写在 agents/at-pm.md 的一节里，命令各有
// 一步指过去。门禁那一半在 tests/gate-check.test.mjs。
//
// 这一族判据的上限（docs/16 §3 的三样）：
//   - 拒绝的判据长什么样：理解语义、认得出「说反话」的正文判据。
//   - 它打不红的那一刀：把那一节改写成「写入成功就是在线」这类说反话的版本，常量、关键句与位置都还在。
//   - 什么会让答案改变：能在 CI 里用真实会话核 PM 的实际行为（今天只有 docs/28 记的几次实测）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { GATE_CHECK_PATH, GATE_CHECK_ONLINE, REMINDER_TEXT } from '../hooks/lib/gate-check.mjs'
import { MIN_MAJOR_MINOR } from './helpers/min-node.mjs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const PM = read('agents/at-pm.md')
const REMINDER_HEAD = REMINDER_TEXT.slice(0, REMINDER_TEXT.indexOf(':') + 1)

// 按 `## ` 切节（`###` 不切）；每节带着自己的标题。
function sections(md) {
  const out = []
  let cur = null
  for (const line of md.split(/\r?\n/)) {
    if (/^## /.test(line)) {
      cur = { heading: line.slice(3).trim(), text: '' }
      out.push(cur)
    } else if (cur) {
      cur.text += line + '\n'
    }
  }
  return out
}

function gateCheckSections() {
  return sections(PM).filter((s) => s.text.includes(GATE_CHECK_PATH) && s.text.includes(GATE_CHECK_ONLINE))
}

test('at-pm.md 里恰好一节同时写着自检路径与「在线」固定串——协议只有一份', () => {
  assert.equal(gateCheckSections().length, 1, gateCheckSections().map((s) => s.heading).join('、') || '一节都没有')
})

const SECTION = gateCheckSections()[0] ?? { heading: '', text: '' }

test('自检一节：Node 的版本写的就是 hooks/boot.mjs 的 MIN_NODE（主、次版本）', () => {
  const found = [...SECTION.text.matchAll(/Node(?:\.js)?\s*(?:≥|>=)?\s*(\d+\.\d+)/g)].map((m) => m[1])
  assert.ok(found.length > 0, '自检一节没写 Node 要多新')
  assert.deepEqual([...new Set(found)], [MIN_MAJOR_MINOR])
})

test('自检一节：认得出续会话后的提醒、平台「先读后写」的拦截', () => {
  assert.ok(SECTION.text.includes(REMINDER_HEAD), `没提到以 ${REMINDER_HEAD} 开头的那句提醒`)
  assert.ok(SECTION.text.includes('File has not been read yet'))
})

test('自检一节：只有一种结果能往下走，写入成功与权限拒绝都判门禁没在跑', () => {
  assert.match(SECTION.text, /只有一种结果能往下走/)
  assert.match(SECTION.text, /含有\**「agent-team 门禁自检：在线」/)
  assert.match(SECTION.text, /写入成功[^\n]*这\**不是\**在线/)
  assert.match(SECTION.text, /权限判定之前/)
})

test('自检一节：排查清单与禁令都在——不交给模型现编', () => {
  for (const s of ['disableAllHooks', '--bare', '桌面端', '重开 Claude Code', '原样告诉用户', '不改写、不补充']) {
    assert.ok(SECTION.text.includes(s), s)
  }
  assert.match(SECTION.text, /不要改用 `Bash`/)
  assert.match(SECTION.text, /不要为 `gate-check` 向用户要写入授权/)
  assert.match(SECTION.text, /不要提议继续/)
})

// ---- 命令：除了只读的，每条都在开头指向这一节 ----

const COMMANDS = readdirSync(new URL('../commands/', import.meta.url)).filter((f) => f.endsWith('.md'))
// 只读、不写不派的命令不做自检；每一条都要在正文里自己声明只读、不做自检。
const EXEMPT = ['at-status.md']

test('锚：豁免的命令真的在 commands/ 里，且正文声明只读、不做门禁自检', () => {
  for (const f of EXEMPT) {
    assert.ok(COMMANDS.includes(f), f)
    const body = read(`commands/${f}`)
    assert.match(body, /只读/, f)
    assert.match(body, /不做门禁自检/, f)
  }
})

// 「开头」= 第一个 `## ` 小节结束之前（含前言）。拿到「在线」之前不做任何写入与派发，所以这一步要排在
// 所有干活的小节前面；判据只认位置，不认措辞。
function headOf(md) {
  const secs = md.split(/\r?\n## /)
  return secs.slice(0, 2).join('\n## ')
}

test('每条不豁免的命令都在开头指向 at-pm.md 的那一节', () => {
  const missing = COMMANDS.filter((f) => !EXEMPT.includes(f)).filter((f) => !headOf(read(`commands/${f}`)).includes(SECTION.heading))
  assert.deepEqual(missing, [], `这些命令开头没提「${SECTION.heading}」`)
})

test('at-pm.md 的那一节点名的命令，恰好是不豁免的那些，并点名豁免的那一条不做', () => {
  const named = new Set([...SECTION.text.matchAll(/\/agent-team:(at[\w-]*)/g)].map((m) => `${m[1]}.md`))
  for (const f of COMMANDS) assert.ok(named.has(f), `自检一节没提 /agent-team:${f.replace(/\.md$/, '')}`)
  for (const f of EXEMPT) assert.match(SECTION.text, new RegExp(`/agent-team:${f.replace(/\.md$/, '')}\`?\\s*只读，不做自检`))
})

test('命令正文不重复写自检路径与固定串——它们只在 at-pm.md 与门禁的常量里各出现一次', () => {
  for (const f of COMMANDS) {
    const body = read(`commands/${f}`)
    assert.ok(!body.includes(GATE_CHECK_PATH), f)
    assert.ok(!body.includes(GATE_CHECK_ONLINE), f)
  }
})
