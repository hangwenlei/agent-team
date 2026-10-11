// docs/73（docs/69 §4「项目经理照自己写的契约第 3 节裁冲突」）：真实会话 M17 里产品定义与现有测试冲突，项目经理照契约第 3 节（它自己写的「明确不做的事」）
// 采纳了架构师的方案、没问用户。第 4 节 contract-conflict 那一行没分「站在用户原话一边」与「只靠自己写的第 2、3 节」。裁定：跟第 1 节原话、第 4 节修订记录里用户
// 说的相抵，照契约改产出、不用问；只跟第 2、3 节相抵的照第 4 节问用户（第 2、3 节不是用户的话，与 docs/67 同一个口径），除非那份产出自己写明了交给项目经理定。
// 写在第 4 节表格之后、「问之前先记」之前，整段钉。门禁不读内容。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const flat = (s) => s.replace(/\s+/g, '')

const ENV_ROW = '| `env-blocked` | 环境挡住了：缺工具、服务或权限，构建或测试跑不起来，这一段交不出来或验证不了 |'
const SIDE =
  '**`contract-conflict` 站在哪一边**：角色产出跟契约第 1 节用户原话或第 4 节修订记录里用户说的相抵，照契约改产出（重派它的产者），不用问；只跟契约第 2 节、' +
  '第 3 节相抵的，那是你自己写的理解跟角色的产出不一致——第 2、3 节不是用户的话，照本节问用户，除非那份产出自己写明了交给你定（例如产品定义里标着' +
  '「建议，PM 可确认」的那一条）。用户原话没说、两边都说得通的，是 `tradeoff`。'
const NEXT = '**问之前先记**'

test('docs/73：第 4 节表格之后、「问之前先记」之前——contract-conflict 站在哪一边，整段钉', () => {
  const at = read('commands/at.md')
  const s4 = at.slice(at.indexOf('## 4.'), at.indexOf('## 5.'))
  assert.ok(flat(s4).includes(flat(ENV_ROW + SIDE + NEXT)), '表格最后一行、这一段、「问之前先记」连着')
  assert.equal(at.split('**`contract-conflict` 站在哪一边**').length - 1, 1)
})

test('docs/73：at-pm「什么时候打断用户」——契约冲突点到只跟第 2、3 节相抵的也算', () => {
  const pm = read('agents/at-pm.md')
  const sec = pm.slice(pm.indexOf('## 什么时候打断用户'))
  assert.ok(flat(sec).includes(flat('只有这几类：敏感与不可逆、契约冲突（只跟你自己写的契约第 2、3 节相抵的也算，见 `/agent-team:at` 第 4 节）、取舍、')), 'at-pm 那一句')
})
