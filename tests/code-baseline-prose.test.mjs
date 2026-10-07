// 第 39 条（docs/49，M4n）：返工回到 S5 之前的段时，S5 写进项目的代码还在工作树里，原来谁也说不清这一轮改过什么。S4 写派发裁决时用只读的 git
// 命令记下代码基线（04-dispatch.md 第 6 节）；回退到 S5 之前时照它列出这一轮改过的文件，要不要退回基线照 sensitive 问用户（退回是动工作树的
// git 操作，项目经理不自己跑）。门禁不跑 git、不读这一节，判据钉的是正文与模板里承重的那几句。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
// 比之前去掉全部空白：正文按显示宽度折行。
const squash = (s) => s.replace(/\s+/g, '')
const has = (text, k) => squash(text).includes(squash(k))

function section(text, head) {
  const lines = text.split(/\r?\n/)
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return null
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

const TEMPLATE = [
  '只用只读的 git 命令记：`git rev-parse HEAD` 的输出',
  '`git status --porcelain` 里 `.agent-team/` 之外的条目（没有就写「干净」）',
  '不是 git 仓库的写「不是 git 仓库」',
  '不提交、不打标签、不暂存：那些是动工作树或历史的 git 命令',
  '这一节照抄上一次记的，不重记',
]
test('第 39 条：04-dispatch.md 有「代码基线」一节——只读命令、记什么、不是 git 仓库怎么写、返工轮不重记', () => {
  const sec = section(read('templates/04-dispatch.md'), '## 6. 代码基线')
  assert.ok(sec, 'templates/04-dispatch.md 里没有「## 6. 代码基线」')
  for (const k of TEMPLATE) assert.ok(has(sec, k), `代码基线那一节缺「${k}」`)
})

test('第 39 条：/agent-team:at 的 S4 写派发裁决时记代码基线', () => {
  const at = read('commands/at.md')
  const s4 = at.slice(at.indexOf('- **S4 裁决**'), at.indexOf('- **S5 实现**'))
  assert.ok(s4.length > 0, '前置：找不到 S4 那一条')
  assert.ok(has(s4, '以及代码基线（模板那一节：只用只读的 git 命令记，不提交、不打标签）'), s4.slice(0, 200))
})

const ROLLBACK = [
  '**回到 `S5` 之前的段，代码不跟着回退**',
  '用只读的 git 命令（`git diff --stat <基线>`、`git status --porcelain`）列出这一轮改过、新加了哪些文件',
  '照第 4 节的 `sensitive` 问要不要把代码退回基线',
  '基线写着「不是 git 仓库」的，照实告诉用户代码退不回去',
  '回到 `S5` 本身不用问',
]
test('第 39 条：/agent-team:at 的「回退」——回到 S5 之前，照基线列出这一轮改过的文件，退不退回照 sensitive 问用户', () => {
  const at = read('commands/at.md')
  const rb = at.slice(at.indexOf('### 回退'), at.indexOf('## 4. 什么时候必须停下来问用户'))
  assert.ok(rb.length > 0, '前置：找不到「回退」一节')
  for (const k of ROLLBACK) assert.ok(has(rb, k), `「回退」一节缺「${k}」`)
})
