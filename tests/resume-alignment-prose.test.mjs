// M4h（docs/43）：docs/39 §5 第三轮后一半「续跑与对齐」的正文——第 40 条（续跑开工前先读 /agent-team:at 第 3–6 节）、第 38 条（03-alignment.md
// 的定义、S3 的完成定义、派发裁决模板不再说「拉通」）、第 24-1 条（放弃旧 run 之前先确认没有还在跑的派发）。门禁那一半在 tests/readiness.test.mjs、
// tests/gate-readiness.test.mjs（整段裁掉之后 H2 的拒绝理由）、tests/gate-ledger.test.mjs（写 current-run 时的【派发】）、tests/gate-completion.test.mjs
// （S2 的协调者进度）。承重的句子整句钉（空白不计）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const bodyOf = (role) => read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---')
const AT = read('commands/at.md')
const RESUME = read('commands/at-resume.md')

// ---- 第 40 条 ----

const RESUME_READ_FIRST =
  '**先读规矩**：上下文可能已经压缩掉了 `/agent-team:at` 的正文——动手之前先 `Read` `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 3–6 节' +
  '（逐段推进、回退、问用户、收尾），下面说「照 /agent-team:at 第几节」的地方照它办，不凭记忆。'
test('M4h 第 40 条：at-resume 第 2 节开头——动手之前先读 /agent-team:at 第 3–6 节', () => {
  const s2 = RESUME.slice(RESUME.indexOf('## 2. 核实磁盘'), RESUME.indexOf('## 3.'))
  assert.ok(has(s2, RESUME_READ_FIRST), 'at-resume 第 2 节缺「先读规矩」')
  assert.ok(s2.indexOf('**先读规矩**') < s2.indexOf('**先看收没收口。**'), '「先读规矩」要排在第 2 节最前面')
})

// ---- 第 38 条 ----

// M4d 起 03-alignment.md 是推进出 S3 的硬条件（H6 核它在不在、空不空），可它在任何正文里都没有定义（docs/11 §5.18 C1 当时裁定不补）。
const ARCH_ALIGN =
  '**`03-alignment.md` 是 `S3` 的第二份产物**：各端对齐的结论——接口契约在各端怎么落（谁调谁、字段与错误码、鉴权）、几端之间的依赖与先后、' +
  '未决问题（要 PM 定或要问用户的，逐条列；没有就写「无」）。只有一端的项目也要写，一两行就够（例：「只有后端；接口照 03-arch.md 的接口契约。' +
  '未决问题：无。」）。PM 推进出 `S3` 时门禁核它在不在、空不空；PM 在 `S4` 照它的未决问题裁决（`04-dispatch.md`）。'
test('M4h 第 38 条：架构师正文定义 03-alignment.md', () => {
  assert.ok(has(bodyOf('at-architect'), ARCH_ALIGN))
})

const AT_S3_ALIGN =
  '完成定义里写上 `03-arch.md` 要带「落盘清单」一节、`03-alignment.md` 写各端对齐的结论与未决问题（两份的写法都见 ' +
  '`${CLAUDE_PLUGIN_ROOT}/agents/at-architect.md`）。'
test('M4h 第 38 条：/agent-team:at 的 S3 那一条，完成定义列上 03-alignment.md', () => {
  const s3 = AT.slice(AT.indexOf('- **S3 技术对齐**'), AT.indexOf('- **S4 裁决**'))
  assert.ok(has(s3, AT_S3_ALIGN), 'S3 那一条的完成定义变了')
})

test('M4h 第 38 条：派发裁决模板不再说「拉通」，改指 03-alignment.md', () => {
  const t = read('templates/04-dispatch.md')
  assert.ok(!t.includes('拉通'), '模板还在说「拉通」：门禁下没有并行拉通这一步（H2 按前置拦）')
  assert.ok(t.includes('# 04 派发裁决 —— PM 对 S3 对齐结果（`03-alignment.md`）的决断'), t.split('\n')[0])
  assert.ok(t.includes('S3 对齐（`03-alignment.md` 的未决问题）里出现的分歧'), '第 3 节那一句')
})

// ---- 第 24-1 条 ----

const AT_ABANDON =
  '改 `current-run` 之前先确认那一趟没有还在跑的派发（它派出去的人的完成通知都到了）：还在跑的，门禁认得出它们是那一趟派的、不按新的这一趟核，' +
  '但那一趟交的东西没人核，它们改的项目文件还会跟新的这一趟撞在一起；写 `current-run` 那一次的回传里有【派发】一段的，照它办。'
test('M4h 第 24-1 条：/agent-team:at 第 1 节「放弃」那一支——改 current-run 之前先确认没有还在跑的派发', () => {
  // 复核（docs/43 §8，低-4）：只切「停在更早的段」那一条（到下一条「- 」为止）——原来切的是整个第 1 节那一段，挪到「已收口」那一支也绿。
  const start = AT.indexOf('- `stage` 停在更早的段、没收口')
  assert.ok(start >= 0, '/agent-team:at 第 1 节没有「stage 停在更早的段」那一条')
  const end = AT.slice(start + 2).search(/\r?\n(\r?\n)?- /)
  const branch = AT.slice(start, end < 0 ? undefined : start + 2 + end)
  assert.ok(has(branch, AT_ABANDON), branch)
})

// ---- 复核（docs/43 §8） ----

// 低-2：at-resume 原来写「不在 available_roles 里的不用写」，与 /agent-team:at 第 3 节（凡是决定不叫的都写进 trimmed）、at-pm 正文（判据是
// 「你真裁过没有」）相反；照它做，整段不做的 S2 只记了 at-product，H2、推进、收口都认不出是整段裁掉。
const RESUME_TRIM = '`trimmed`（不在 `available_roles` 里的也写——`trimmed` 记的是你裁过谁，不是那条回传点不点名）。'
test('M4h 复核：at-resume 的 S2 那一条——不用 at-ui 的写进 trimmed，不在 available_roles 里的也写', () => {
  assert.ok(has(RESUME, RESUME_TRIM))
  assert.ok(!RESUME.includes('里的不用写'), '还留着「不在 available_roles 里的不用写」')
})

// 疑点：at-resume 第 1 节丢了指针时写回 current-run，那一次同样会出【派发】（别的 run 里有门禁没见它停下的派发）。
const RESUME_POINTER = '写回指针那一次的回传里有【派发】一段的，照它办。'
test('M4h 复核：at-resume 第 1 节写回 current-run——回传里有【派发】的照它办', () => {
  const s1 = RESUME.slice(RESUME.indexOf('## 1. 读回位置'), RESUME.indexOf('## 2. '))
  assert.ok(has(s1, RESUME_POINTER))
})

// 疑点：stages.README.md 讲协调者进度的那一节只讲 S5；S2 的 at-product 这一种（第 14 条）补一句。
const STAGES_S2 =
  'M4h（`docs/43`，审查第 14 条）起 S2 也报：`at-product` 既是 S2 的协调者又是它的产者，它返回时自己那份交了、S2 却没齐（它派的 `at-ui`' +
  ' 还没交），同样报 `at-ui` 的进度——头一句说「它自己的那几份交了」，不是执行段的不提实现记录。'
test('M4h 复核：stages.README.md 的协调者进度那一节——S2 的 at-product 这一种也写上', () => {
  const r = read('stages.README.md')
  const sec = r.slice(r.indexOf('⚠️ **S5 那一行的「静默」'), r.indexOf('## 另一条相关的缺口'))
  assert.ok(has(sec, STAGES_S2))
})
