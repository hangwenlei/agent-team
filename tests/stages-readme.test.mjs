// stages.README.md 的「控制文件」表格行抄了一份 hooks/lib/control-files.mjs 的
// CONTROL_FILES 清单（current-run / project.json / reach.json /
// runs/<id>/state.json），抄得完全正确——但没有任何东西保证它跟着 CONTROL_FILES
// 变。docs/09-M1b-入口决策.md 账一实现约束 1 说清单只有一处真源，现有的防抄测试
// （tests/templates.test.mjs「模板里不得再抄一份控制文件清单」、
// tests/commands.test.mjs 的命令正文闭包）只扫 templates/ 与 commands/，够不到
// stages.README.md（docs/11-M1b-遗留与已知边界.md 1.5 第二条）。
//
// 放独立文件而不是塞进 tests/templates.test.mjs：那个文件测的是 templates/ 目录
// 本身的内容，stages.README.md 不是它的测试对象；也不放进
// tests/control-files.test.mjs——那个文件测 CONTROL_FILES/isControlFile 这个模块
// 自身的行为，不该反过来知道有一份 README 在引用它。这更接近
// tests/plugin-name-sync.test.mjs（PLUGIN_PREFIX 与 .claude-plugin/plugin.json 的
// name 对账）那种「两个源头必须保持一致」的独立小文件，此文件仿它的写法。
//
// ⭐ 正向锚点（硬要求，见 docs/11 §3.3 第 2 条 / §3.1 表格第 5 条「零迭代恒绿」）：
// 这条测试写成「从 README 里抽出清单再比对」，必须配一条自检证明抽取判据真的抽得
// 出东西——否则抽取正则写错时会在真实文件上抽出空集合，而空集合可能恰好让比对
// 逻辑通过（比如若干年后有人把下面的相等比较改写成「CONTROL_FILES 的每一项都要
// 出现在抽出的清单里」这种单向子集检查，抽取器抽出空集合时这类检查会对着空数组
// 空转，看不出任何异常）。这个仓库为「纯否定断言 / 零迭代恒绿」这个形状开过四轮
// 循环。下面把抽取器写成本文件内的纯函数，配一条独立 test() 在真实文件上验证它
// 确实抽出了已知的非空清单——不依赖 CONTROL_FILES 对不对：就算 CONTROL_FILES
// 本身是空的或错的，这条自检也该照样通过/照样不通过，因为它只问「抽取器有没有
// 抽对 README 里写的字面量」，跟下面那条真正的对账测试问的是两个不同的问题，
// 各自占一个 test()。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONTROL_FILES } from '../hooks/lib/control-files.mjs'

const README = readFileSync(new URL('../stages.README.md', import.meta.url), 'utf8')

// 只认「控制文件」那一行的第二格（"是什么"列），不认整行——第四格（"判据在哪"列）
// 里同样有反引号（`hooks/lib/control-files.mjs`、`CONTROL_FILES`），抽整行会把这些
// 实现细节也当成"控制文件名"混进来，得到一份混杂了非文件名 token 的假清单。
function extractControlFileCell(text) {
  const line = text.split('\n').find((l) => l.includes('**控制文件**'))
  if (!line) return null
  const cells = line.split('|')
  // 表格行形如 "| **控制文件** | <是什么> | <谁能写> | <判据在哪> |"——split('|') 后
  // cells[0] 是行首 '|' 前的空串，cells[1] 是 "**控制文件**"，cells[2] 才是"是什么"。
  return cells[2] ?? null
}

function extractControlFileTokens(text) {
  const cell = extractControlFileCell(text)
  if (!cell) return []
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
}

// README 用人类可读的占位符 <id>（runs/<id>/state.json），CONTROL_FILES 用 glob
// 风格的 *（runs/*/state.json）——字面量不同、语义相同。归一化只做这一件事：把
// 用尖括号包起来的整段路径替换成 *，不做其它改写，避免这条对账变成一条似是而非
// 的比对。
function normalizeToken(token) {
  return token
    .split('/')
    .map((seg) => (/^<.+>$/.test(seg) ? '*' : seg))
    .join('/')
}

test('自检：抽取器能从 stages.README.md 的控制文件行里抽出非空的原始清单', () => {
  const tokens = extractControlFileTokens(README)
  assert.deepEqual(tokens, ['current-run', 'project.json', 'reach.json', 'runs/<id>/state.json'])
})

test('stages.README.md 的控制文件表格枚举与 CONTROL_FILES 完全一致（集合相等）', () => {
  const tokens = extractControlFileTokens(README).map(normalizeToken).sort()
  assert.deepEqual(tokens, [...CONTROL_FILES].sort())
})
