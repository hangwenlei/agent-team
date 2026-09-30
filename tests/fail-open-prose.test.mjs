// M3v（docs/30，全量审查第 12 条）：门禁判不出来时开始回传【门禁】、在自检理由后面追加「另外，……」，正文要跟上——
// 不然 PM 收到它不知道该不该照做，commands/at.md 的「没收到就停下」会把一次「门禁在跑、只是读不出 run」误诊成
// 「门禁没在跑」，/agent-team:at-resume 读不到指针就对用户说「没有 run」、让旧 run 变成孤儿。
// 按同一行钉（照 tests/project-prose.test.mjs 的写法）：分在两段里的两个词，拼不出那一句话。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const lineWith = (text, ...words) => text.split(/\r?\n/).find((l) => words.every((w) => l.includes(w)))

test('agents/at-pm.md：受信回传的例外里列着【门禁】，照它修、不当成门禁没在跑', () => {
  const pm = read('agents/at-pm.md')
  assert.ok(lineWith(pm, '【门禁】', '照它给的修法'), '受信例外那一句要点名【门禁】与照做的动作')
  assert.ok(lineWith(pm, '【门禁】', '不是门禁没在跑'), '要说清收到【门禁】说明门禁在跑')
})

test('agents/at-pm.md：门禁自检第 1 支说清「另外，」那一句怎么读——不是受信回传，核实了再修', () => {
  const pm = read('agents/at-pm.md')
  const line = lineWith(pm, '「另外，」', '不是受信回传')
  assert.ok(line, '门禁自检一节要有一行同时写「另外，」与「不是受信回传」')
  assert.ok(lineWith(pm, '「另外，」', '去磁盘核实'))
})

test('commands/at.md §2：收到【门禁】（不论原因）是门禁在跑——照它做，再原样重写契约拿回传', () => {
  const at = read('commands/at.md')
  assert.ok(lineWith(at, '【门禁】', '不是门禁没在跑'), at)
  assert.ok(lineWith(at, '【门禁】', '00-contract.md') || lineWith(at, '【门禁】', '原样重写'))
})

test('commands/at-resume.md §1：读不到 current-run 时先 Glob runs/*/state.json，不直接说没有 run', () => {
  const r = read('commands/at-resume.md')
  assert.ok(lineWith(r, 'runs/*/state.json'), '要写明 Glob 的模式')
  assert.ok(lineWith(r, '丢了指针'))
  assert.ok(lineWith(r, '最后建的那一趟') || lineWith(r, '问用户'))
})

test('commands/at-init.md 收尾：自检时收到的「另外，」那一句，收尾时告诉用户——按原因说下一步', () => {
  const r = read('commands/at-init.md')
  assert.ok(lineWith(r, '「另外，」', '告诉用户'))
  // 复核（docs/30 §3）：插件文件读不出来、runs 读不出来时 /agent-team:at-resume 修不了，不能一律指向它。
  assert.ok(lineWith(r, '插件自己的文件读不出来', '重装'), '插件那一种要叫用户重装')
  assert.ok(lineWith(r, '`runs` 目录读不出来', '由用户处理'), 'runs 读不出来那一种由用户处理')
})

// 复核（docs/30 §3，noise 第 0 条）：第二趟起契约写在切指针之前，ledger 判得出这次写入不在当前 run 里、一句不说；
// 「两样都没有就是门禁没在跑」会误诊它。
test('commands/at.md §2：判「门禁没在跑」之前先核对 current-run 是不是正在写的这一趟', () => {
  const at = read('commands/at.md')
  assert.ok(lineWith(at, '.agent-team/current-run', '正在写的这一趟'), at)
})

test('README 两半：正常放行默认不留记录；项目经理自己发起的调用上判不出来时，告诉项目经理、界面上给你一行', () => {
  const md = read('README.md')
  const [zh, en] = md.split('<a id="english"></a>')
  assert.ok(lineWith(zh, '正常放行', '默认不留记录'), '中文一半')
  assert.ok(lineWith(zh, '项目经理自己发起的调用上', '判不出', '一行提示'), '中文一半')
  assert.ok(lineWith(en, 'ordinary pass', 'no record'), '英文一半')
  assert.ok(lineWith(en, "project manager's own calls", 'cannot tell', 'one-line notice'), '英文一半')
  // 复核（docs/30 §3）：没有 run 时派团队角色也会给一行——那一格门禁判得出来，不在「判不出来」那句里。
  assert.ok(lineWith(zh, '没有进行中的 run', '一行提示'), '中文一半')
  assert.ok(lineWith(en, 'no run is in progress', 'one-line notice'), '英文一半')
})
