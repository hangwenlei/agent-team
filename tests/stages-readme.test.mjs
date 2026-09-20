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
import { REAL_STAGES, whoCanReach } from './helpers/stage-role-reach.mjs'

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

// ---- 「H5a 的静默集合」那张表（M2b 终审 A4）----
//
// 这张表此前**没有任何机械守卫**。tests/gate-deliverable.test.mjs 的 tableFailHint 写着
// 「那里是这张表的单一真源，这组测试只是它的守卫」，**但它守的是那个文件里的
// H5A_SILENCE_TABLE**（一份拷贝），拿 computeReach 对。README 那张表可以单独漂走而零
// 测试红。今天两份一致（终审独立跑 computeReach 八行逐字对过），所以这是**潜在**不是
// 已发生——但这张表被重算过三次，每次都是被扩链或加边逼出来的，且上一版 S5 那一行本身
// 就是错的、从写下来那天起全绿。本仓库已经有「从 README 抽表格、对真源比」这台机器
// （本文件上半段的控制文件表），把 H5a 表接上同一台。
//
// 钉的是**能从数据机械推出来的那三列**：
//   第 1 列 `state.stage` 与第 2 列「该段 role」→ 对 stages.json；
//   第 3 列「谁派得到它」           → 对 computeReach（whoCanReach）。
// 第 4、5 列（「第 1 条会成立吗」/「会被静默吗」）**不钉**：它们写的是「实际上不会——
// 返回的角色不会是它们」这类人的判断，不是 roster/stages 能推出来的量。这是**有意的
// 边界，不是漏掉**——照本分支的口径把没盖住的那半说清楚。
//
// 两条比较各占一个 test()：第 1/2 列对的是 stages.json，第 3 列对的是花名册拓扑，
// 是两个不同的问题，一条红了不该把另一条的结论一起埋掉。
function backtickTokens(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
}

// 从表头行「谁派得到它」往下读，直到第一行不以 `|` 开头为止。认表头而不是认 `| S1 |`
// 这种行形状：README 里别处也可能出现阶段编号开头的表格行，而这张表只有一个表头。
function extractH5aRows(text) {
  const lines = text.split(/\r?\n/)
  const head = lines.findIndex((l) => l.startsWith('|') && l.includes('谁派得到它'))
  if (head < 0) return []
  const rows = []
  for (let i = head + 2; i < lines.length; i++) {
    // +2 跳过表头行与 |---| 分隔行
    const line = lines[i]
    if (!line.startsWith('|')) break
    const cells = line.split('|')
    const reachCell = cells[3] ?? ''
    rows.push({
      stage: (cells[1] ?? '').trim(),
      role: backtickTokens(cells[2] ?? '')[0] ?? null,
      // 「谁派得到它」有两种单元格：列了谁（反引号清单），或者一句「没有角色派得到
      // `at-X`」。后者的单元格里那个反引号 token 是**该段自己的 role**，不是派得到它
      // 的人——不认这句就会把它当成一个派得到自己的角色抠出来。
      reachedBy: reachCell.includes('没有角色派得到') ? [] : backtickTokens(reachCell),
    })
  }
  return rows
}

// ⭐ 正向自检锚：证明抽取器**两种单元格都认得**，且不是恒返回空清单。钉在合成样本上
// （手法同 tests/commands.test.mjs 的「自检：pathKeyBans() 从一条已知的禁令子句里抠得出
// 被点名的角色」）——不抄真表的内容，免得自检自己变成这张表的第三份拷贝。
test('自检：H5a 表抽取器认得出「列了谁」与「没有角色派得到」两种单元格', () => {
  const sample =
    '| `state.stage` | 该段 `role` | 谁派得到它 | 第 1 条会成立吗 | 会被静默吗 |\n' +
    '|---|---|---|---|---|\n' +
    '| S1 | `at-sample-a` | 没有角色派得到 `at-sample-a`（`tests/x.test.mjs` 钉着） | 不会 | 不会 |\n' +
    '| S2 | `at-sample-b` | `__main__`、`at-sample-a` | 会 | 看第 2 条 |\n' +
    '\n其后的正文\n'
  assert.deepEqual(extractH5aRows(sample), [
    { stage: 'S1', role: 'at-sample-a', reachedBy: [] },
    { stage: 'S2', role: 'at-sample-b', reachedBy: ['__main__', 'at-sample-a'] },
  ])
})

const H5A_HINT =
  '——这张表的单一真源就是 stages.README.md 本身（tests/gate-deliverable.test.mjs 的 ' +
  'tableFailHint 这么写的），这一条是它的守卫。别改这条断言了事：先用 computeReach 对' +
  '新花名册/新阶段链重算，确认差在哪一段、是哪条边造成的，再把 README 那一节与 ' +
  'tests/gate-deliverable.test.mjs 的 H5A_SILENCE_TABLE 一起更新。'

test('stages.README.md 的 H5a 静默表：阶段列与 role 列与 stages.json 一致', () => {
  assert.deepEqual(
    extractH5aRows(README).map((r) => [r.stage, r.role]),
    Object.entries(REAL_STAGES).map(([id, s]) => [id, s.role]),
    `README 的 H5a 静默表的阶段/role 两列与 stages.json 对不上${H5A_HINT}`,
  )
})

// ⚠️ 这一条**迭代 Object.keys(REAL_STAGES)，不迭代抽出来的行**。拿抽出来的行去派生
// 期望值（`rows.map(r => [r.stage, whoCanReach(r.stage)])`）会让判据在抽取器退化成空
// 清单时两边同为空数组而恒绿——「锚要钉在判据真正迭代的那一层」说的就是这个。README
// 少一行时，这里拿到 null，对面拿到真实清单，红。
test('stages.README.md 的 H5a 静默表：「谁派得到它」列与 computeReach 算出来的一致', () => {
  const byStage = new Map(extractH5aRows(README).map((r) => [r.stage, r.reachedBy]))
  assert.deepEqual(
    Object.keys(REAL_STAGES).map((id) => [id, byStage.get(id) ?? null]),
    Object.keys(REAL_STAGES).map((id) => [id, whoCanReach(id)]),
    `README 的 H5a 静默表第三列与真实 roster.json/stages.json 算出来的对不上${H5A_HINT}`,
  )
})
