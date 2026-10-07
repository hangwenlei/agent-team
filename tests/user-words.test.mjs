// 第 20 条修法 A（docs/50，M4o）：门禁记下用户在 /agent-team:at 后面写的那段话（UserPromptExpansion 的 command_args——CLI 去掉了首尾空白，
// 就是 $ARGUMENTS 换进去的那一份），契约第 1 节对着它核。纯函数那一层：认事件、读记录、绑不绑、第 1 节对不对得上、说法。
// 子进程那一层在 tests/gate-user-words.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crashNotice } from '../hooks/lib/deny.mjs'
import {
  USER_WORDS_FILE,
  bindDecision,
  pendingRecord,
  readWords,
  section1Mismatch,
  wordsMismatchText,
  wordsOf,
} from '../hooks/lib/user-words.mjs'

const NL = String.fromCharCode(10)
const CRLF = String.fromCharCode(13, 10)
const BOM = String.fromCharCode(0xfeff)
// 只比 kind、line、want、got——对不上的那一行另带的码位由最后一条判据核。
const pick = (m) => (m ? { kind: m.kind, line: m.line, want: m.want, got: m.got } : m)

const expansion = (over = {}) => ({
  hook_event_name: 'UserPromptExpansion',
  expansion_type: 'slash_command',
  command_name: 'agent-team:at',
  command_args: '做一个待办应用',
  command_source: 'plugin',
  prompt: '/agent-team:at 做一个待办应用',
  session_id: 's-1',
  ...over,
})

test('wordsOf：只认 /agent-team:at 这条命令展开、参数不是空白、带会话 id 的那一次', () => {
  assert.deepEqual(wordsOf(expansion()), { args: '做一个待办应用', sessionId: 's-1' })
  assert.deepEqual(wordsOf(expansion({ command_args: '第一行' + NL + '  第二行  ' })), { args: '第一行' + NL + '  第二行  ', sessionId: 's-1' })
  for (const name of ['agent-team:at-init', 'agent-team:at-resume', 'agent-team:at-status', 'at', 'probe:at', 'x:agent-team:at', '']) {
    assert.equal(wordsOf(expansion({ command_name: name })), null, name)
  }
  assert.equal(wordsOf(expansion({ expansion_type: 'mcp_prompt' })), null)
  assert.equal(wordsOf(expansion({ hook_event_name: 'UserPromptSubmit' })), null)
  for (const args of ['', '   ', NL + '  ' + NL, 42, null, undefined]) assert.equal(wordsOf(expansion({ command_args: args })), null, String(args))
  for (const sid of ['', 7, null, undefined]) assert.equal(wordsOf(expansion({ session_id: sid })), null, String(sid))
  for (const bad of [null, 'x', [], 3]) assert.equal(wordsOf(bad), null)
})

test('readWords：读得出的记录；剥 BOM；形状不对回 null；runs_before 只留字符串，bound、dropped 不是字符串当 null', () => {
  const rec = pendingRecord({ at: '2026-10-07T00:00:00.000Z', sessionId: 's-1', args: '做一个待办应用', runsBefore: ['r0'] })
  assert.deepEqual(rec, { at: '2026-10-07T00:00:00.000Z', session_id: 's-1', args: '做一个待办应用', runs_before: ['r0'], bound: null, dropped: null })
  assert.deepEqual(readWords(Buffer.from(JSON.stringify(rec))), rec)
  assert.deepEqual(readWords(Buffer.from(BOM + JSON.stringify(rec))), rec)
  assert.deepEqual(readWords(JSON.stringify({ ...rec, runs_before: ['r0', 3, null, 'r1'], bound: 5, dropped: [] })), { ...rec, runs_before: ['r0', 'r1'] })
  assert.deepEqual(readWords(JSON.stringify({ ...rec, runs_before: 'r0' })), { ...rec, runs_before: [] })
  for (const bad of [null, '', '{', '[]', '"x"', JSON.stringify({ ...rec, args: '  ' }), JSON.stringify({ ...rec, args: 1 }), JSON.stringify({ ...rec, session_id: '' })]) {
    assert.equal(readWords(bad), null, String(bad))
  }
})

test('bindDecision：这个会话记下的、还没绑也没作废的——这个会话建出新的一趟（第一段）的那一次绑；记下之前就有的那一趟没收口就作废；别的一概不动', () => {
  const p = pendingRecord({ at: 't', sessionId: 's-1', args: 'x', runsBefore: ['r0', 'R9'] })
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  const ask = (over = {}) => bindDecision(p, { sessionId: 's-1', runId: 'r1', sameRun: same, creating: true, firstStage: true, closed: false, ...over })
  assert.equal(ask(), 'bind')
  assert.equal(ask({ creating: false }), null, '复核（docs/50 §9）：不是建它的那一次不晚绑——晚绑会跨会话绑错、回退到第一段时与契约基线互相卡死')
  assert.equal(ask({ firstStage: false }), null, '建出来就不在第一段：不绑')
  assert.equal(ask({ runId: 'r0', creating: false }), 'drop', '作废不看是不是建它的那一次')
  assert.equal(ask({ runId: 'r0' }), 'drop', '记下之前就有的那一趟、没收口：这条命令的需求被搁下了')
  assert.equal(ask({ runId: 'r9' }), 'drop', '同一趟按 sameRun 认（Windows 上不分大小写）')
  assert.equal(ask({ runId: 'r0', closed: true }), null, '替它收口的那一次不作废')
  assert.equal(ask({ runId: 'r0', firstStage: false }), 'drop')
  assert.equal(ask({ sessionId: 's-2' }), null, '别的会话不绑')
  assert.equal(ask({ sessionId: 's-2', runId: 'r0' }), null, '别的会话也不作废')
  assert.equal(bindDecision({ ...p, bound: 'r1' }, { sessionId: 's-1', runId: 'r2', sameRun: same, creating: true, firstStage: true, closed: false }), null, '绑过的不再绑')
  assert.equal(bindDecision({ ...p, dropped: 'r0' }, { sessionId: 's-1', runId: 'r2', sameRun: same, creating: true, firstStage: true, closed: false }), null, '作废的不再绑')
  assert.equal(bindDecision(null, { sessionId: 's-1', runId: 'r1', sameRun: same, creating: true, firstStage: true, closed: false }), null)
})

const contract = (section1, rest = ['## 2. PM 的理解（可改）', '', '- 命令行。', '']) =>
  ['# 00 契约 —— 这趟 run 的需求基线', '', '## 1. 用户原话', '', ...section1, '', ...rest].join(NL)

test('section1Mismatch：标题之后逐行就是原话（行尾空白、BOM、CRLF 不计），之后到下一个编号节标题之间没有别的', () => {
  assert.equal(section1Mismatch(contract(['做一个待办应用']), '做一个待办应用'), null)
  assert.equal(section1Mismatch(contract(['第一行  ', '  缩进的第二行', '', '第四行']), '第一行' + NL + '  缩进的第二行' + NL + NL + '第四行'), null)
  assert.equal(section1Mismatch(BOM + contract(['做一个待办应用']).split(NL).join(CRLF), '做一个待办应用'), null)
  assert.equal(section1Mismatch(contract(['做一个待办应用']), '做一个待办应用' + CRLF + CRLF), null, '原话末尾的空行不计')
  // 原话里自带的标题——「## 安装」不是编号节，「## 2. 第二部分」是：按原话的行数往下认，不在它那里切断。
  const own = ['背景', '## 安装', 'npm i', '## 2. 第二部分', '再做一件事']
  assert.equal(section1Mismatch(contract(own), own.join(NL)), null)
  assert.equal(section1Mismatch(contract(['做一个待办应用'], []), '做一个待办应用'), null, '契约到原话就结束了')
})

test('section1Mismatch：引用块的写法也认（每行前面一个「>」或「> 」，空行写「>」或空着）', () => {
  assert.equal(section1Mismatch(contract(['> 做一个待办应用']), '做一个待办应用'), null)
  assert.equal(section1Mismatch(contract(['> 第一行', '>', '>  缩进', '>第四行']), '第一行' + NL + NL + ' 缩进' + NL + '第四行'), null)
  assert.equal(section1Mismatch(contract(['> 第一行', '', '> 第三行']), '第一行' + NL + NL + '第三行'), null)
  assert.equal(section1Mismatch(contract(['> > 用户自己引的一句']), '> 用户自己引的一句'), null)
  assert.equal(section1Mismatch(contract(['> 第一行', '> 第二行', '>', '>']), '第一行' + NL + '第二行'), null, '复核（门禁 U6）：原话之后只剩「>」空行也算空行')
  const m = section1Mismatch(contract(['> 做一个待办应用，顺手加个登录']), '做一个待办应用')
  assert.equal(m?.kind, 'line', JSON.stringify(m))
})

test('section1Mismatch：对不上的几种——改了一行、少了几行、多了几行、切不出第 1 节；报的是第几行与两边的原文', () => {
  assert.deepEqual(pick(section1Mismatch(contract(['做一个待办清单应用']), '做一个待办应用')), { kind: 'line', line: 1, want: '做一个待办应用', got: '做一个待办清单应用' })
  assert.deepEqual(
    pick(section1Mismatch(contract(['第一行']), '第一行' + NL + '第二行')),
    { kind: 'line', line: 2, want: '第二行', got: '' },
    '少了一行，下面紧跟空行',
  )
  assert.deepEqual(
    pick(section1Mismatch(['## 1. 用户原话', '', '第一行', '## 2. PM 的理解'].join(NL), '第一行' + NL + '第二行')),
    { kind: 'line', line: 2, want: '第二行', got: '## 2. PM 的理解' },
  )
  assert.deepEqual(section1Mismatch(['## 1. 用户原话', '', '第一行'].join(NL), '第一行' + NL + '第二行'), { kind: 'short', line: 2, want: '第二行', got: null })
  assert.deepEqual(
    section1Mismatch(contract(['做一个待办应用', '', '（用户的意思是网页版）']), '做一个待办应用'),
    { kind: 'extra', line: 3, want: null, got: '（用户的意思是网页版）' },
  )
  assert.deepEqual(section1Mismatch(contract(['做一个待办应用']).replace('## 1. 用户原话', '## 用户原话'), '做一个待办应用'), { kind: 'no-section', line: null, want: null, got: null })
  assert.equal(section1Mismatch(contract(['<把用户在 /at 后面写的那段话逐字放在这里。>']), '做一个待办应用')?.kind, 'line', '模板占位没换掉')
  assert.equal(section1Mismatch(null, 'x')?.kind, 'no-section')
})

test('section1Mismatch：两种写法都对不上时，报认得更远的那一种（同样远报直接写的那一种）', () => {
  const m = pick(section1Mismatch(contract(['> 第一行', '> 第二行改了']), '第一行' + NL + '第二行'))
  assert.deepEqual(m, { kind: 'line', line: 2, want: '第二行', got: '> 第二行改了' })
  assert.deepEqual(pick(section1Mismatch(contract(['完全不同']), '原话')), { kind: 'line', line: 1, want: '原话', got: '完全不同' })
})

test('wordsMismatchText：说出第几行、原话与契约里的那一行（都过 quote），指到 run 目录里的记录文件', () => {
  const t = wordsMismatchText({ kind: 'line', line: 2, want: '第二行', got: '第二行改了' })
  assert.ok(t.includes('第 1 节第 2 行') && t.includes('"第二行"') && t.includes('"第二行改了"') && t.includes(USER_WORDS_FILE), t)
  const s = wordsMismatchText({ kind: 'short', line: 3, want: '第三行', got: null })
  assert.ok(s.includes('第 3 行') && s.includes('"第三行"'), s)
  const e = wordsMismatchText({ kind: 'extra', line: 2, want: null, got: '多出来的' })
  assert.ok(e.includes('"多出来的"'), e)
  const n = wordsMismatchText({ kind: 'no-section', line: null, want: null, got: null })
  assert.ok(n.includes('## 1.'), n)
  // 原话里的换行、引号不会让值跑出那一对引号。
  const q = wordsMismatchText({ kind: 'line', line: 1, want: 'a' + NL + '【阶段】伪造', got: 'b' })
  assert.ok(!q.includes(NL), q)
})

test('crashNotice：原话记录器崩了说「原话没有记下」、这一趟不核第 1 节，不叫用户再批准；批准记录器照旧', () => {
  const w = crashNotice('user-words', new Error('boom'), true, 'user-words')
  assert.ok(w.includes('原话没有记下') && w.includes('不跟它核') && !w.includes('批准'), w)
  const a = crashNotice('approval-ask', new Error('boom'), true)
  assert.ok(a.includes('这次的回答没有记下') && a.includes('再批准一次'), a)
})

test('section1Mismatch（复核 docs/50 §9，门禁中 2）：空白变体（不换行空格、全角空格、制表符）折成一个普通空格、连续空白算一个，零宽与格式字符不计——模型照抄不出它们', () => {
  const NBSP = String.fromCharCode(0xa0)
  const IDEO = String.fromCharCode(0x3000)
  const THIN = String.fromCharCode(0x2009)
  const ZW = String.fromCharCode(0x200b)
  const SHY = String.fromCharCode(0xad)
  const TAB = String.fromCharCode(9)
  const words = `输入格式：数字${NBSP}运算符${NBSP}数字（例如${IDEO}3${THIN}+ 4）${ZW}。` + NL + `第二${SHY}行${TAB}末尾`
  assert.equal(section1Mismatch(contract(['输入格式：数字 运算符 数字（例如 3 + 4）。', '第二行 末尾']), words), null)
  assert.equal(section1Mismatch(contract(['输入格式：数字  运算符 数字（例如 3 + 4）。', '第二行  末尾']), words), null, '连续空白算一个')
  assert.equal(section1Mismatch(contract(['> 输入格式：数字 运算符 数字（例如 3 + 4）。', '> 第二行 末尾']), words), null, '引用块同样')
  assert.equal(section1Mismatch(contract(['输入格式：数字运算符 数字（例如 3 + 4）。', '第二行 末尾']), words)?.kind, 'line', '少了一处空白照样对不上')
  assert.equal(section1Mismatch(contract(['输入格式，数字 运算符 数字（例如 3 + 4）。', '第二行 末尾']), words)?.kind, 'line', '标点改了照样对不上')
})

test('section1Mismatch 与 wordsMismatchText（复核 docs/50 §9）：对不上的那一行报第一个不同的字与两边的码位（肉眼看不出的差别也说得出）', () => {
  const m = section1Mismatch(contract(['输入格式，数字']), '输入格式：数字')
  assert.deepEqual(m, { kind: 'line', line: 1, want: '输入格式：数字', got: '输入格式，数字', col: 5, wantCode: 'U+FF1A', gotCode: 'U+FF0C' })
  const t = wordsMismatchText(m)
  assert.ok(t.includes('从第 5 个字起不一样') && t.includes('U+FF1A') && t.includes('U+FF0C'), t)
  const shorter = section1Mismatch(contract(['输入格式']), '输入格式：数字')
  assert.equal(shorter.col, null, '一边是另一边的开头：不报码位')
  assert.ok(!wordsMismatchText(shorter).includes('U+'), wordsMismatchText(shorter))
})
