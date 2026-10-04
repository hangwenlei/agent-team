// 审查第 18 条（M4c，docs/37）：冒泡的正文这一半——收件的协调者怎么读下级的冒泡。门禁那一半（H5b 认标记）在 tests/gate-bubble.test.mjs，
// PM 那一侧（/agent-team:at 第 3 节「核实」、S5 那一条、回退表）与 at-qa 的没开跑在 tests/shared-paths-prose.test.mjs。
// 标记取自 hooks/lib/deliverable.mjs 的 BUBBLE_MARK：改名时门禁、拒绝文案、正文一起红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BUBBLE_MARK } from '../hooks/lib/deliverable.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const flat = (s) => s.replace(/\n[ \t>]*/g, '')
const sentences = (s) => s.split('。')

// 协调者收到的是下级的回报原文（同步派发是工具结果，异步派发是完成通知里的结果）。门禁在 SubagentStop 上放行冒泡时发不出任何话
// （那一刻发话等于拦截），所以「读出它是冒泡、产物没交」只能靠正文。
test('M4c 协调者正文：下级回报第一行是冒泡标记的，它没交产物——定得了的就定，定不了的原样冒泡给 PM', () => {
  for (const [file, who] of [
    ['agents/at-architect.md', '执行角色'],
    ['agents/at-product.md', '`at-ui`'],
  ]) {
    const f = flat(read(file))
    const s = sentences(f).find((x) => x.includes(who) && x.includes(`第一行是「${BUBBLE_MARK}`))
    assert.ok(s, `${file} 没有一句同时提到 ${who} 与「回报第一行是冒泡标记」`)
    for (const k of ['没交', '原样冒泡给 PM']) assert.ok(s.includes(k), `${file}：${s}`)
  }
})
