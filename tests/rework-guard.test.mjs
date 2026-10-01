// H6 返工预算写时强制（纯函数部分）。规格 §4.2 ③、M2a 设计 §1.2、
// hooks/lib/rework-guard.mjs 头部——完整背景不在这里重复。
//
// decideRework 只认 before/after 两份 state.json 的**内容**（已经 JSON.parse 过的
// 对象），不碰磁盘、不知道 Edit/Write 的区别——那部分传导链在
// tests/gate-rework.test.mjs 里单独测（子进程级，Edit 的 old_string/new_string
// 替换只有那边能测到）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRework, parseStateText, replayEdit } from '../hooks/lib/rework-guard.mjs'

const H = (...stages) => stages.map((s) => ({ stage: s, at: '2026-09-19T00:00:00Z' }))
const st = (history, rework) => ({ stage: 'S5', history, rework })

test('正常推进：history 追加一条，放行', () => {
  const r = decideRework({ before: st(H('S1', 'S2'), {}), after: st(H('S1', 'S2', 'S3'), {}) })
  assert.equal(r.ok, true)
})

test('正常返工：history 追加重复阶段、rework 跟着涨，放行', () => {
  const r = decideRework({ before: st(H('S1', 'S5'), {}), after: st(H('S1', 'S5', 'S5'), { S5: 1 }) })
  assert.equal(r.ok, true)
})

test('history 整体变短：拒', () => {
  const r = decideRework({ before: st(H('S1', 'S2', 'S3'), {}), after: st(H('S1', 'S2'), {}) })
  assert.equal(r.ok, false)
})

test('history 长度没变但某阶段出现次数变少：拒', () => {
  const r = decideRework({ before: st(H('S1', 'S5', 'S5'), { S5: 1 }), after: st(H('S1', 'S5', 'S2'), {}) })
  assert.equal(r.ok, false)
})

test('rework 低于 history 派生值：拒', () => {
  const r = decideRework({ before: st(H('S1', 'S5', 'S5'), { S5: 1 }), after: st(H('S1', 'S5', 'S5'), { S5: 0 }) })
  assert.equal(r.ok, false)
})

test('rework 超过硬上限 3：拒', () => {
  const h = H('S5', 'S5', 'S5', 'S5', 'S5')
  const r = decideRework({ before: st(H('S5'), {}), after: st(h, { S5: 4 }) })
  assert.equal(r.ok, false)
})

test('旧 state 不存在（本趟第一次写）：放行', () => {
  const r = decideRework({ before: null, after: st(H('S1'), {}) })
  assert.equal(r.ok, true)
})

// M3r（docs/26，全量审查第 5 条）：原先这条是「新内容不是合法 JSON 对象：放行」。那一半口子
// 让返工史能用两次 Write 洗掉：先写一份垃圾（新的一侧 parse 不出来，放行），再写一份清零的
// 合法版本（旧的一侧 parse 不出来，放行）。现在只剩「旧的本来就坏了」这一侧放行——那是把坏文件
// 修回去的路；新内容必须永远是合法的 JSON 对象，PM 总写得出来，锁不死。
test('旧的是合法对象、新内容不是合法 JSON 对象：拒——两步清零的第一步', () => {
  for (const after of [null, [], 'x', 1]) {
    const r = decideRework({ before: st(H('S1'), {}), after })
    assert.equal(r.ok, false, JSON.stringify(after))
  }
})

test('新内容不是合法 JSON 对象时，理由说清要写一份合法的 JSON 对象', () => {
  const r = decideRework({ before: st(H('S1'), {}), after: null })
  assert.match(r.reason, /JSON 对象/)
})

test('旧的本来就坏了、新内容是合法对象：放行——把坏文件修回去这条路不能堵', () => {
  const r = decideRework({ before: null, after: st(H('S1'), {}) })
  assert.equal(r.ok, true)
})

test('旧的不在、新内容也不是合法 JSON 对象：拒——第一次建也要写对', () => {
  const r = decideRework({ before: null, after: null })
  assert.equal(r.ok, false)
})

test('拒的时候要说清是哪一条判据、哪个阶段', () => {
  const r = decideRework({ before: st(H('S1', 'S5', 'S5'), { S5: 1 }), after: st(H('S1', 'S5', 'S5'), { S5: 0 }) })
  assert.match(r.reason, /S5/)
})

// Step 10 变异验证实测发现的缺口（不在 brief 的四条变异预言里，是跑变异 2 时才现出来
// 的）：只要 history 的元素都是合法的 { stage, at } 形状，"整体变短"与"某阶段计数变少"
// 这两条判据永远同时触发——总条数下降，按抽屉原理必有至少一个阶段的计数跟着下降，
// 不可能只掉前者不掉后者。于是上面「history 整体变短：拒」那条测试测不出「整体变短」
// 判据本身有没有被短路掉：就算把它删掉，"计数变少"那条判据照样把同一个夹具判成拒绝。
// 这条补的是"整体变短"判据唯一有独立价值的场景——history 里混进了不是 { stage, at }
// 形状的脏记录（counts() 按设计不数它，但 .length 数），删掉这一条脏记录会让总条数下降、
// 但每个"数得到"的阶段计数原封不动。
test('history 混进一条不是 {stage,at} 形状的脏记录，删掉它——每个真实阶段的计数都没变，仍然拒', () => {
  const before = { stage: 'S5', history: [{ stage: 'S1', at: 'x' }, 'not-a-real-entry', { stage: 'S5', at: 'x' }], rework: {} }
  const after = { stage: 'S5', history: [{ stage: 'S1', at: 'x' }, { stage: 'S5', at: 'x' }], rework: {} }
  const r = decideRework({ before, after })
  assert.equal(r.ok, false)
})

// 修复轮 1 Major 1（评审实测抓到的真实绕过，不是假设）：判据③原来用 `<` 直接比较
// `rw[stage]`，判据④原来用 `typeof v === 'number'` 当前置条件。`<`/`>` 在两边类型不同
// 时会做隐式数值转换（`'4' < 4` 按数值比较，为 false，逃过判据③），而
// `typeof v === 'number'` 对字符串/数组一律为 false、直接跳过判据④——两个洞合起来，
// 从一个合法的打满状态（history 里 S5 出现 4 次、rework.S5 = 3，已经在硬上限）出发，
// 把 rework.S5 写成字符串或数组就能让第 4 轮返工也被放行，H6 存在的全部理由（"第 3 轮
// 终局是硬上限，告警守不住"）落空。下面三条各自独立重放评审给出的实测用例，第四条是
// 正向锚——防止修复本身被錯改成"rework 一律拒"这种同样会让上面三条变绿、但把整条链
// 锁死的塌法。
test('rework 写成数字字符串 "4"、且 history 追加到第 5 次出现（真实落地第 4 轮返工）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5', 'S5'), { S5: '4' }),
  })
  assert.equal(r.ok, false)
})

test('rework 写成单元素数组 [4]（history 不变，仍是打满状态）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5'), { S5: [4] }),
  })
  assert.equal(r.ok, false)
})

test('rework 写成数字字符串 "99"（history 不变，仍是打满状态）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5'), { S5: '99' }),
  })
  assert.equal(r.ok, false)
})

// 正向锚：合法的数字 3（等于硬上限、也等于 history 的派生值）在打满状态下必须放行——
// 上面三条的修法如果被错改成"rework 字段只要不是纯数字类型就一律拒"，这条会变红，
// 说明改坏了不是收紧、是锁死。
test('rework 是合法数字 3、且没有变化：放行——修法不能连合法的整数都一起拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
  })
  assert.equal(r.ok, true)
})

// 修复轮 1 的定向复评补的三条。
//
// 前两条钉的是判据④里 `!Number.isInteger(v)` 那一半。复评实测：把它删掉只留
// `v > REWORK_LIMIT`，套件 471/0 **零红**，而带着这个变异、从打满状态追加第 5 条 S5，
// rework 写成 "3abc" / {} / [1,2] / "NaN" 全部 ALLOW——第 4 轮返工落地。
//
// 根因是 NaN 参与的比较恒为 false：判据③的 `NaN < 4` 假、判据④的 `NaN > 3` 也假，
// 两道一起被绕过去。与修复轮之前那个字符串绕过**完全同形，只是深一层**。
//
// 上一轮补的三条回归用的是 "4" / [4] / "99"——它们都能干净地转成整数，所以**全部
// 锚在 `v > REWORK_LIMIT` 那一半上**，新写的另一半裸着。这正是 docs/11 §3.3 第 1 条
// 要防的：凡是变异验证里期望某条断言变红的，那条断言必须自己占一个 test()。
test('rework 写成转不成数字的字符串 "3abc"、且 history 追加到第 5 次出现：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5', 'S5'), { S5: '3abc' }),
  })
  assert.equal(r.ok, false)
})

test('rework 写成对象 {}（Number({}) 是 NaN）、且 history 追加到第 5 次出现：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5', 'S5', 'S5'), { S5: 3 }),
    after: st(H('S5', 'S5', 'S5', 'S5', 'S5'), { S5: {} }),
  })
  assert.equal(r.ok, false)
})

// 判据④的**下界**。复评发现原来这里只有上界，而第二道 validateState 写的是
// `!Number.isInteger(v) || v < 0`——fail-closed 的写时闸比 fail-open 的事后告警更宽松，
// 方向反了。这条钉住补上的那半。
test('rework 写成负数、且该阶段没有返工史（判据③管不到）：拒', () => {
  const r = decideRework({
    before: st(H('S1'), {}),
    after: st(H('S1', 'S2'), { S2: -1 }),
  })
  assert.equal(r.ok, false)
})

// M2b 终审 A5：判据④原来先 `Number(raw)` 再验，于是 `Number(true) === 1` 与
// `Number(' 1 ') === 1` 这两种形状从写时闸溜了过去——而事后的 validateState 对同一份
// state 报「rework["S5"] 不是非负整数」。**fail-closed 的写时闸比 fail-open 的事后告警
// 宽松**，与上面那条下界缺口完全同族。两条各占一个 test()：`true` 走的是 JS 的布尔→
// 数字转换，`' 1 '` 走的是带空格字符串→数字转换，是两种不同的溜法，一条红了不该把另一
// 条的结论一起埋掉。
//
// ⚠️ 两条都刻意选在 history 派生值 = 1 的状态上：判据③（`Number(raw) < n`）在这里算出
// 的是 `1 < 1` = false，管不到——**红只能来自判据④**。派生值取别的数会让判据③先返回，
// 这两条就锚不到要钉的那一层了。
test('rework 写成布尔 true（Number(true) === 1，判据③管不到）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5'), { S5: 1 }),
    after: st(H('S5', 'S5'), { S5: true }),
  })
  assert.equal(r.ok, false)
})

test('rework 写成带空格的字符串 " 1 "（Number(" 1 ") === 1，判据③管不到）：拒', () => {
  const r = decideRework({
    before: st(H('S5', 'S5'), { S5: 1 }),
    after: st(H('S5', 'S5'), { S5: ' 1 ' }),
  })
  assert.equal(r.ok, false)
})

// Minor 6 点名的那一格：rework 改小 × Write。此前 history 删短只走 Write、
// rework 改小只走 Edit，2×2 矩阵缺这一格。纯函数层与工具无关，这条补的是对称性。
test('rework 改小、走 Write 路径的那一格：拒（与 Edit 路径同判据）', () => {
  const r = decideRework({
    before: st(H('S5', 'S5'), { S5: 1 }),
    after: st(H('S5', 'S5'), { S5: 0 }),
  })
  assert.equal(r.ok, false)
})

// ---- replayEdit：只镜像平台 Edit 的「精确命中」那一层（M3r，docs/26，全量审查第 6 条）----
//
// 平台的 Edit（本机 claude.exe 2.1.283 的实现，docs/26 §5）：读文件时只把 CRLF 折成 LF、UTF-8 BOM
// 原样留着；匹配分四层——精确、弯引号互认、两层 \uXXXX 转义互认；**只有精确命中时 new_string 原样
// 写入**，其余几层会改写 new_string（比如把直引号换成弯引号）；多处命中又没带 replace_all 时报错、
// 不落盘；写回时恢复原来的行尾。
//
// H6 此前按字节重放，CRLF 的 state.json 上任何多行 Edit 都匹配不上、放行。第一版修法照「预测平台」
// 写，复核抓到它剥了 new_string 的 BOM、做了弯引号互认却没做平台随之而来的改写——门禁算出合法 JSON，
// 平台落盘的却是坏文件，两步清零换条路照样做成。所以现在只镜像第一层：那一层平台一个字不改，门禁算的
// 就是真实落盘的；其余几层门禁不预测，返回 null，由门禁拒、让它改用 Write。

const CRLF = (s) => s.split('\n').join('\r\n')

test('replayEdit：LF 文件上精确匹配', () => {
  assert.equal(replayEdit({ before: 'a\nb\nc', oldString: 'b', newString: 'B' }), 'a\nB\nc')
})

test('replayEdit：CRLF 文件、LF 写的多行 old_string 照样匹配（平台读文件时折 CRLF）', () => {
  const before = CRLF('{\n  "a": 1,\n  "b": 2\n}')
  assert.equal(replayEdit({ before, oldString: '"a": 1,\n  "b": 2', newString: '"a": 0' }), '{\n  "a": 0\n}')
})

test('replayEdit：old_string 写成 CRLF → null（平台只折文件、不折 old_string，匹配不上）', () => {
  assert.equal(replayEdit({ before: 'x\ny', oldString: 'x\r\ny', newString: 'z' }), null)
})

test('replayEdit：文件开头的 BOM 原样留着（平台不剥它）', () => {
  assert.equal(replayEdit({ before: '﻿{"a":1}', oldString: '{"a":1}', newString: '{"a":2}' }), '﻿{"a":2}')
})

test('replayEdit：new_string 原样放进去——带 BOM、带 CRLF 都不动（平台精确命中时一个字不改）', () => {
  assert.equal(replayEdit({ before: '{"a":1}', oldString: '1', newString: '﻿1' }), '{"a":﻿1}')
  assert.equal(replayEdit({ before: '{"a":1}', oldString: '1', newString: '1\r\n' }), '{"a":1\r\n}')
})

test('replayEdit：old_string 用了弯引号、文件是直引号 → null（那一层平台会改写 new_string，门禁不预测）', () => {
  const oldString = '“rework”: {“S5”: 3}'
  assert.equal(replayEdit({ before: '{"rework": {"S5": 3}}', oldString, newString: '"rework": {}' }), null)
})

test('replayEdit：弯引号与直引号同时在文件里时，只认精确命中的那一处', () => {
  const before = '“k”=1 "k"=1'
  assert.equal(replayEdit({ before, oldString: '"k"=1', newString: 'X' }), '“k”=1 X')
})

test('replayEdit：old_string 出现不止一处、又没带 replace_all → null（平台报错、不落盘）', () => {
  assert.equal(replayEdit({ before: 'a x a', oldString: 'a', newString: 'b' }), null)
})

test('replayEdit：replace_all 在 CRLF 文件上替换每一处', () => {
  assert.equal(replayEdit({ before: CRLF('a\nx\na'), oldString: 'a', newString: 'b', replaceAll: true }), 'b\nx\nb')
})

test('replayEdit：找不到 old_string → null', () => {
  assert.equal(replayEdit({ before: 'abc', oldString: 'zzz', newString: 'y' }), null)
})

test('replayEdit：old_string 为空、文件不在——新建，内容就是 new_string（平台同样）', () => {
  assert.equal(replayEdit({ before: null, oldString: '', newString: '{"a":1}' }), '{"a":1}')
})

test('replayEdit：old_string 为空、文件只有空白——整份写成 new_string（平台同样）', () => {
  assert.equal(replayEdit({ before: ' \r\n', oldString: '', newString: '{"a":1}' }), '{"a":1}')
})

test('replayEdit：old_string 为空、文件有内容——null（平台报错）', () => {
  assert.equal(replayEdit({ before: '{"a":1}', oldString: '', newString: '{"a":2}' }), null)
})

test('replayEdit：文件不在、old_string 不为空 → null（平台的 Edit 自己也会失败）', () => {
  assert.equal(replayEdit({ before: null, oldString: 'a', newString: 'b' }), null)
})

test('replayEdit：参数不是字符串 → null', () => {
  assert.equal(replayEdit({ before: 'a', oldString: undefined, newString: 'b' }), null)
})

// ---- parseStateText ----

test('parseStateText：开头的 BOM 剥掉；中间的 BOM 不剥（那就是坏文件）', () => {
  assert.deepEqual(parseStateText('﻿{"a":1}'), { a: 1 })
  assert.equal(parseStateText('{"a":﻿1}'), null)
})

test('parseStateText：合法 JSON 但不是对象（数组、字符串、null）→ null', () => {
  for (const text of ['[]', '"x"', 'null', '1']) assert.equal(parseStateText(text), null, text)
})

// ---- 第二轮复核补的判据：实现是对的，但这几件事此前没有判据钉着（docs/26 §3）----

// 平台精确命中时用函数替换（a.replace(c, () => u)），new_string 里的 $' $& $` $$ 一律按字面写入。
// 把 split/join 换成字符串替换（replaceAll(o, n)）是最顺手的重构，而那会展开 $ 模式——门禁算的与
// 平台落盘的不再一样，两步清零重新打开。
test("replayEdit：new_string 里的 $' 按字面写入，不当替换模式", () => {
  assert.equal(replayEdit({ before: '{"a":1}', oldString: '1}', newString: "1}$'" }), "{\"a\":1}$'")
})

test('replayEdit：new_string 里的 $& 按字面写入', () => {
  assert.equal(replayEdit({ before: '{"a":1}', oldString: '1', newString: '$&2' }), '{"a":$&2}')
})

test('replayEdit：new_string 里的 $$ 按字面写入', () => {
  assert.equal(replayEdit({ before: '{"a":1}', oldString: '1', newString: '$$' }), '{"a":$$}')
})

// 平台读文件只折成对的 CRLF，孤立的 \r 原样留着。
test('replayEdit：孤立的 \\r 不当换行——old_string 里的 \\n 碰不上它', () => {
  assert.equal(replayEdit({ before: 'x\ry', oldString: 'x\ny', newString: 'z' }), null)
})

test('replayEdit：孤立的 \\r 也不删——old_string 跳过它就碰不上', () => {
  assert.equal(replayEdit({ before: 'x\ry', oldString: 'xy', newString: 'z' }), null)
})

test('replayEdit：只折成对的 CRLF，孤立的 \\r 原样留在结果里', () => {
  assert.equal(replayEdit({ before: 'a\rb\r\nc', oldString: 'b\nc', newString: 'X' }), 'a\rX')
})

// ============================================================================
// M3z（docs/34，全量审查第 16 条）：第 4 轮有了诚实的写法，「只改 stage」「链外的段」不再写得进去。
//
// - 回退预判：回退那一次写入（restartInfo）就按「这一轮走完」算各段的返工轮数（写入后 history 里、最后那条回退条目之前的出现
//   次数，O5），超过上限（hooks/lib/budget.mjs 的 limitOf：3 + 覆盖它的返工批准条数）就拒，理由给规范标签——不等三段之后的推进
//   才撞墙。
// - 判据④只罚改大：值超过上限、而且比写入前大才拒；原样带着的不重复拒（批准文件丢了也不把整趟锁死）。类型照旧先验。
// - stage 不变量（阶段链读得出时）：after.stage 在链上；这次新追加的 history 条目都在链上；after.stage 等于 history 末条。
//   写入前读不出来（修坏文件）只核 after.stage 在链上。
import { approvalLabel, needOf } from '../hooks/lib/budget.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { restartInfo } from '../hooks/lib/rework-guard.mjs'

const CHAIN = {
  S1: { role: 'at-pm', produces: ['00-contract.md'] },
  S2: { role: 'at-product', produces: ['01-prd.md'] },
  S3: { role: 'at-architect', produces: ['03-arch.md'] },
  S4: { role: 'at-pm', produces: ['04-dispatch.md'] },
  S5: { role: 'at-backend', produces: ['05-impl/<role>.md'] },
  S6: { role: 'at-qa', produces: ['06-test.md'] },
  S7: { role: 'at-acceptance', produces: ['07-acceptance.md'] },
  S8: { role: 'at-pm', produces: ['08-delivery.md'] },
}
const FIRST6 = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']
// S6 → S5 回退 n 轮之后（每轮都重进 S6）的 history 段名。
const roundsOf = (n) => {
  const out = [...FIRST6]
  for (let i = 0; i < n; i++) out.push('S5', 'S6')
  return out
}
// stage 等于 history 末条、rework 等于派生值的一份 state。
const sv = (ids, extra = {}) => {
  const history = H(...ids)
  return { stage: ids[ids.length - 1], history, rework: reworkFromHistory(history), ...extra }
}
const decide = (beforeIds, afterIds, opts = {}) =>
  decideRework({ before: sv(beforeIds, opts.beforeExtra), after: opts.after ?? sv(afterIds, opts.afterExtra), stages: CHAIN, grants: opts.grants ?? [] })

test('M3z restartInfo：带上最后那条回退条目的下标', () => {
  const before = sv(roundsOf(1))
  const after = sv([...roundsOf(1), 'S5', 'S6'])
  assert.deepEqual(restartInfo({ before, after, stages: CHAIN }), { stage: 'S5', followedByForward: true, index: before.history.length })
})

test('M3z 回退预判：第 4 次 S6→S5、没有批准 → 在回退这一次就拒，理由给规范标签', () => {
  const r = decide(roundsOf(3), [...roundsOf(3), 'S5'])
  assert.equal(r.ok, false)
  assert.equal(r.budget, true)
  assert.ok(r.reason.includes(approvalLabel('S5')), r.reason)
  assert.ok(r.reason.includes('停在这里'), r.reason)
  assert.match(r.reason, /AskUserQuestion/)
  assert.match(r.reason, /S5（第 4 轮，上限 3）/)
  assert.match(r.reason, /S6（第 4 轮，上限 3）/)
  assert.match(r.reason, /0 条/)
})

test('M3z 回退预判：第 3 轮放行（上限内）', () => {
  assert.equal(decide(roundsOf(2), [...roundsOf(2), 'S5']).ok, true)
})

test('M3z 回退预判：批准覆盖 S5、S6 之后第 4 轮放行；只覆盖 S5 照样拒（S6 第 4 轮）', () => {
  const after = [...roundsOf(3), 'S5']
  assert.equal(decide(roundsOf(3), after, { grants: [{ reworkTo: 'S5', covers: ['S5', 'S6'] }] }).ok, true)
  const r = decide(roundsOf(3), after, { grants: [{ reworkTo: 'S5', covers: ['S5'] }] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /S6（第 4 轮，上限 3）/)
  assert.doesNotMatch(r.reason, /S5（第/)
  assert.match(r.reason, /1 条/)
})

test('M3z 回退预判：预算内的补记（同一次写入回退之后又往前记一段）放行（O5）', () => {
  assert.equal(decide(roundsOf(2), [...roundsOf(2), 'S5', 'S6']).ok, true)
})

test('M3z 回退预判：同一段原地重来、到了上限 → 拒，理由开头先说同段重派不是回退', () => {
  const before = [...roundsOf(2), 'S5']
  const r = decide(before, [...before, 'S5'])
  assert.equal(r.ok, false)
  assert.match(r.reason, /^如果这只是同一段里重派一个角色/)
  assert.ok(r.reason.includes(approvalLabel('S5')), r.reason)
})

test('M3z 回退预判先于判据③④：PM 把 rework 写小、写大，都先给规范标签', () => {
  const after = sv([...roundsOf(3), 'S5'])
  for (const S5 of [3, 4, '4']) {
    const r = decideRework({ before: sv(roundsOf(3)), after: { ...after, rework: { ...after.rework, S5 } }, stages: CHAIN, grants: [] })
    assert.equal(r.ok, false)
    assert.ok(r.reason.includes(approvalLabel('S5')), `${S5}: ${r.reason}`)
  }
})

test('M3z 判据④只罚改大：批准文件丢了、第 4 轮的计数原样带着 → 放行（不把整趟锁死）', () => {
  const ids = [...roundsOf(3), 'S5']
  const before = sv(ids)
  const after = sv(ids, { artifacts: { '05-impl/at-backend.md': 'sha256:' + 'b'.repeat(64) } })
  assert.equal(decideRework({ before, after, stages: CHAIN, grants: [] }).ok, true)
})

test('M3z 判据④：推进进一段、它的返工超过上限而且比写入前大 → 拒，标签回到最后一次回退回到的那一段', () => {
  // S5 第 4 轮（批准只覆盖了 S5）里推进到 S6：S6 从 3 到 4。
  const before = [...roundsOf(3), 'S5']
  const r = decide(before, [...before, 'S6'], { grants: [{ reworkTo: 'S5', covers: ['S5'] }] })
  assert.equal(r.ok, false)
  assert.equal(r.budget, true)
  assert.match(r.reason, /rework\["S6"\]/)
  assert.ok(r.reason.includes(approvalLabel('S5')), r.reason)
})

test('M3z 判据④：阶段链读不出来时照样核上限（不做预判），超过就拒', () => {
  const r = decideRework({ before: sv(roundsOf(3)), after: sv([...roundsOf(3), 'S5']), stages: null, grants: [] })
  assert.equal(r.ok, false)
  assert.equal(r.budget, true)
  assert.match(r.reason, /超过返工上限/)
})

test('M3z 判据④：类型照旧先验，理由说「不是非负整数」，不带 budget', () => {
  const r = decide(['S1', 'S2'], ['S1', 'S2'], { afterExtra: { rework: { S2: true } } })
  assert.equal(r.ok, false)
  assert.notEqual(r.budget, true)
  assert.match(r.reason, /不是非负整数/)
})

test('M3z stage 不变量：stage 写成链外的段（同时追加进 history）→ 拒（E1）', () => {
  const r = decide([...FIRST6], [...FIRST6, 'S5b'])
  assert.equal(r.ok, false)
  assert.match(r.reason, /不是阶段链上的段/)
})

test('M3z stage 不变量：history 新追加一条链外条目（夹在回退前面）→ 拒（E5）', () => {
  const after = sv([...FIRST6, 'S2'])
  after.history.splice(FIRST6.length, 0, { stage: '需求驳回', at: 'x' })
  after.rework = reworkFromHistory(after.history)
  const r = decideRework({ before: sv(FIRST6), after, stages: CHAIN, grants: [] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /history 新追加的第 7 条/)
})

test('M3z stage 不变量：新追加的条目不是 { stage, at } 形状 → 拒', () => {
  const after = sv(FIRST6)
  after.history.push('S7')
  const r = decideRework({ before: sv(FIRST6), after, stages: CHAIN, grants: [] })
  assert.equal(r.ok, false)
})

test('M3z stage 不变量：只改 stage、不追加 history → 拒（推进与回退都是同一次 Write 改 stage 并追加 history）', () => {
  const after = sv(FIRST6, { stage: 'S7' })
  const r = decideRework({ before: sv(FIRST6), after, stages: CHAIN, grants: [] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /history 的最后一条/)
  // 往回改也一样（回退不记账）。
  assert.equal(decideRework({ before: sv(FIRST6), after: sv(FIRST6, { stage: 'S5' }), stages: CHAIN, grants: [] }).ok, false)
})

test('M3z stage 不变量：收口往 history 里写 DONE → 拒，理由说链尾就是终点', () => {
  const ids = [...FIRST6, 'S7', 'S8']
  const r = decide(ids, [...ids, 'DONE'])
  assert.equal(r.ok, false)
  assert.match(r.reason, /最后一段（S8）就是终点/)
})

test('M3z stage 不变量：写入前读不出来（修坏文件）时只核 stage 在链上，原样保留的旧链外条目不核', () => {
  const after = sv([...FIRST6, 'S7', 'S8'])
  after.history.splice(3, 0, { stage: 'DONE', at: 'x' })
  after.rework = reworkFromHistory(after.history)
  assert.equal(decideRework({ before: null, after, stages: CHAIN, grants: [] }).ok, true)
  assert.equal(decideRework({ before: null, after: { ...after, stage: 'DONE' }, stages: CHAIN, grants: [] }).ok, false)
})

test('M3z stage 不变量：v1.7.0 落盘的「停在 DONE」——只记账被拒，追加 S8 放行', () => {
  const ids = [...FIRST6, 'S7', 'S8', 'DONE']
  const before = sv(ids)
  assert.equal(decideRework({ before, after: sv(ids, { contract_sha: 'PENDING' }), stages: CHAIN, grants: [] }).ok, false)
  assert.equal(decideRework({ before, after: sv([...ids, 'S8']), stages: CHAIN, grants: [] }).ok, true)
})

test('M3z stage 不变量：阶段链读不出来时整条跳过', () => {
  assert.equal(decideRework({ before: sv(FIRST6), after: sv(FIRST6, { stage: 'S7' }), stages: null }).ok, true)
})

test('M3z 正路不受影响：首轮整链逐段推进、回退一次、再推进', () => {
  const steps = [['S1'], ['S1', 'S2'], FIRST6, [...FIRST6, 'S7'], [...FIRST6, 'S7', 'S5'], [...FIRST6, 'S7', 'S5', 'S6']]
  for (let i = 1; i < steps.length; i++) {
    const r = decide(steps[i - 1], steps[i])
    assert.equal(r.ok, true, `${steps[i].join(',')}: ${r.reason}`)
  }
})

// 复核（docs/34 §3，prose-2）：一次写入先往前记一段、再回退（[..., S6, S5]）。预判把前进的那一条算进去（它确是这一轮的），记录器
// 却只能从磁盘现在的样子模拟「回到 S5」，S6 少算一次——批准盖不全，原样重写照样被拒，再问又说不需要，死循环。拒绝理由要叫它拆开写。
test('复核 回退预判：同一次写入里回退之前还追加了前进的条目、越限 → 拒，理由叫它先单独写推进；不冒同段重派的提示', () => {
  const before = [...roundsOf(2), 'S5']
  const r = decide(before, [...before, 'S6', 'S5'])
  assert.equal(r.ok, false)
  assert.match(r.reason, /先单独写一次推进/)
  assert.doesNotMatch(r.reason, /如果这只是同一段里重派一个角色/)
  // 拆开之后：推进那一次放行，回退那一次照常预判（给标签）。
  assert.equal(decide(before, [...before, 'S6']).ok, true)
  const r2 = decide([...before, 'S6'], [...before, 'S6', 'S5'])
  assert.equal(r2.ok, false)
  assert.ok(r2.reason.includes(approvalLabel('S5')), r2.reason)
  assert.doesNotMatch(r2.reason, /先单独写一次推进/)
})

// 复核（docs/34 §3，budget-1，高）：「history 只许追加」此前只核条数与各段出现次数——把一条更早的 S5 改成还有额度的 S2、同时照常
// 追加一条 S5，各段次数都不降，S5 的派生值却不涨：第 4、5、6 轮都不经批准做成，还能把回退藏起来（对调两条旧条目的段名）。
test('复核 H6：写入前已有的 history 条目，段名一个字都不许改（at 可以改）', () => {
  const before = sv(roundsOf(3))
  const changed = sv([...roundsOf(3), 'S5'])
  changed.history[6] = { stage: 'S2', at: 'x' }
  changed.rework = reworkFromHistory(changed.history)
  const r = decideRework({ before, after: changed, stages: CHAIN, grants: [] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /history\[6\]/)
  assert.match(r.reason, /已有的条目/)
  // 只改 at：放行。
  const at = sv(roundsOf(3))
  at.history[6] = { stage: 'S5', at: '2026-10-01T09:00:00Z' }
  assert.equal(decideRework({ before, after: at, stages: CHAIN, grants: [] }).ok, true)
  // 阶段链读不出来时照样核（这一条不靠阶段链）。
  assert.equal(decideRework({ before, after: changed, stages: null, grants: [] }).ok, false)
})

// 复核（budget-2、budget-3）：v1.7.0 落盘的 run 停在 DONE（history 末条是链外的收口标记）。回退要认得出：拿新追加的条目与最近一条
// 在链上的条目比——否则 DONE→S5 不算回退，快照不要求、预判不跑，判据④给的标签又记不下（记录器也认不出这是回退），死循环。
test('复核 restartInfo：跳过链外条目，与最近一条在链上的条目比——DONE 之后追加 S5 是回退', () => {
  const ids = [...FIRST6, 'S7', 'S8', 'DONE']
  const before = sv(ids)
  assert.deepEqual(restartInfo({ before, after: sv([...ids, 'S5']), stages: CHAIN }), { stage: 'S5', followedByForward: false, index: ids.length })
})

test('复核 H6：停在 DONE 的旧 run、预算已满时回退 → 预判给标签；照标签记下的批准盖得住（needOf 同一个口径）', () => {
  const full = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
  for (let i = 0; i < 3; i++) full.push('S5', 'S6', 'S7', 'S8')
  const ids = [...full, 'DONE']
  const r = decide(ids, [...ids, 'S5'])
  assert.equal(r.ok, false)
  assert.ok(r.reason.includes(approvalLabel('S5')), r.reason)
  const covers = needOf({ state: sv(ids), stages: CHAIN, grants: [], target: 'S5' })
  assert.deepEqual(covers, ['S5', 'S6', 'S7', 'S8'])
  assert.equal(decide(ids, [...ids, 'S5'], { grants: [{ reworkTo: 'S5', covers }] }).ok, true)
})

// 复核（budget-4）：一次写入记两轮（回退记晚了两次：[S5, S6, S5]）、第二轮越限——预判按最后那条回退之前计数，记录器从磁盘只模拟
// 一次回退，判成不需要。叫它拆开写，不给记不下的标签。
test('复核 回退预判：一次写入记了不止一轮、越限 → 拒，理由叫它拆开写', () => {
  const r = decide(roundsOf(2), [...roundsOf(2), 'S5', 'S6', 'S5'])
  assert.equal(r.ok, false)
  assert.match(r.reason, /拆开写/)
})
