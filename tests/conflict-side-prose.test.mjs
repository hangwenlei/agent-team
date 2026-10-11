// docs/73（docs/69 §4「项目经理照自己写的契约第 3 节裁冲突」）：第 4 节 contract-conflict 那一行没分哪些要问。
// 复核（docs/73 §8）之后按情形、按方向分：跟用户原话相抵、改得了的照契约改（不用问），产者写明照原话做不到的问；原话读得出几种意思的问（contract-hole）；
// 只跟第 2、3 节（项目经理自己写的理解）不一致的，收窄到原话以内自己定、写进 04-dispatch.md 与交付文档，扩出原话或改第 2、3 节去迁就产出的问（tradeoff）。
// 第一版那个「产出写明交给你定」的例外去掉了（被验的一方写一句就关掉）。写在第 4 节表格之后、「问之前先记」之前，整段钉；表格行、at-pm、README 两半、
// 04-dispatch 模板各钉一处；反向：「第 2、3 节」与「不用问／自己定／自决」同一句出现的，只许是钉住的那一段。门禁不读内容。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const flat = (s) => s.replace(/\s+/g, '')

const ENV_ROW = '| `env-blocked` | 环境挡住了：缺工具、服务或权限，构建或测试跑不起来，这一段交不出来或验证不了 |'
const SIDE =
  '**`contract-conflict` 里哪些要问**（管设计分歧：`S2` 到 `S5` 里角色的产出跟契约不一致；验证段判没过的，照第 3 节 `S6`、`S7` 那一条与「回退」处理）：' +
  '- 跟契约第 1 节用户原话或第 4 节修订记录里用户说的相抵、照原话改得了的：照契约改——重派它的产者（那一段已经过了的，先照「回退」记），不用问；' +
  '产者写明照原话做不到（附理由）的，照本节问。' +
  '- 第 1 节读得出不止一种意思、产出读的那一种也说得通的，不算跟原话相抵：照本节问（`contract-hole`）。' +
  '- 只跟契约第 2 节、第 3 节（你自己写的理解）不一致的，看方向：收窄到原话以内（不采纳超出原话的产出、照第 3 节不做）的，你自己定，写进 `04-dispatch.md`' +
  '第 3 节与交付文档；扩出原话（采纳第 3 节排除的东西），或者改第 2、3 节去迁就产出的，照本节问（`tradeoff`）——第 2、3 节不是用户的话。'
const NEXT = '**问之前先记**'
const START = '**`contract-conflict` 里哪些要问**'

test('docs/73：第 4 节表格之后、「问之前先记」之前——contract-conflict 里哪些要问，整段钉、跟上下文连着', () => {
  const at = read('commands/at.md')
  const s4 = at.slice(at.indexOf('## 4.'), at.indexOf('## 5.'))
  assert.ok(flat(s4).includes(flat(ENV_ROW + SIDE + NEXT)), '表格最后一行、这一段、「问之前先记」连着')
  assert.equal(at.split(START).length - 1, 1)
  const from = at.indexOf(START)
  assert.equal(flat(at.slice(from, at.indexOf(NEXT, from))), flat(SIDE), '那一段整段相等')
  assert.ok(flat(s4).includes(flat('| `contract-conflict` | 角色产出与契约某条相抵（哪些要问见表下一段），或满足 A 条必须违反 B 条 |')), '表格那一行')
})

test('docs/73：at-pm「什么时候打断用户」——契约冲突指到第 4 节表格下那一段（切到下一个二级标题）', () => {
  const pm = read('agents/at-pm.md')
  const from = pm.indexOf('## 什么时候打断用户')
  const end = pm.indexOf('\n## ', from + 1)
  const sec = pm.slice(from, end < 0 ? pm.length : end)
  assert.ok(flat(sec).includes(flat('契约冲突（哪些要问、哪些照契约改或你自己定，见 `/agent-team:at` 第 4 节表格下那一段）、')), 'at-pm 那一句')
})

test('docs/73：README 两半「契约冲突」那一行、04-dispatch 模板的裁决那一节', () => {
  const readme = read('README.md')
  assert.ok(readme.includes('| 契约冲突 | 某个角色说照你的原话做不到，或者要做的超出你的原话，或契约里的两条没法同时满足 |'), 'README 中文')
  assert.ok(
    readme.includes("| Conflict | A role says your request cannot be met as written, or the work would go beyond what you asked, or two of the contract's clauses cannot both be met |"),
    'README 英文',
  )
  assert.ok(
    flat(read('templates/04-dispatch.md')).includes(flat('PM 在这里定（扩出原话、或者改契约第 2、3 节去迁就产出的要问用户，见 /agent-team:at 第 4 节表格下那一段）。')),
    '04-dispatch 模板',
  )
})

test('docs/73 §8：「第 2、3 节」与「不用问／自己定／自决」同一句出现的，只许是第 4 节钉住的那一段（commands、agents、templates）', () => {
  const sec23 = /第2节、第3节|第2、3节|第2节与第3节|第2节和第3节/
  const decide = /不用问|不必问|自己定|自决/
  const allowed = flat(SIDE)
  const files = [
    ...readdirSync(new URL('../commands/', import.meta.url)).map((n) => `commands/${n}`),
    ...readdirSync(new URL('../agents/', import.meta.url)).map((n) => `agents/${n}`),
    ...readdirSync(new URL('../templates/', import.meta.url)).map((n) => `templates/${n}`),
  ].filter((p) => p.endsWith('.md'))
  assert.ok(files.length > 10, '前置：扫得到正文')
  for (const p of files) {
    for (const s of flat(read(p)).split('。')) {
      if (sec23.test(s) && decide.test(s)) assert.ok(allowed.includes(s), `${p}：「第 2、3 节」与自决同一句——${s.slice(0, 80)}`)
    }
  }
})
