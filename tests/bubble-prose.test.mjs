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

// 复核（docs/37 §3）：环境的原因跑不起来（缺工具、服务、权限）不是冒泡——那就是这一轮的测试结论，照实写进 06-test.md；冒泡只用于
// S5 没交齐。回退表不让 PM 为它回 S6 重跑（同一个环境再跑一遍也一样），照第 4 节 env-blocked 问用户；用户定了照现状交付的，收口那一步
// 写明哪些没验证。
test('M4c 环境原因跑不起来：at-qa 照实写进 06-test.md、不冒泡；回退表不回 S6 重跑、问用户；收口写明哪些没验证', () => {
  const qa = flat(read('agents/at-qa.md'))
  assert.ok(sentences(qa).some((x) => x.includes('环境的原因跑不起来') && x.includes('06-test.md') && x.includes('不要冒泡')), 'at-qa 没写环境原因跑不起来怎么办')
  const at = flat(read('commands/at.md'))
  const back = at.slice(at.indexOf('### 回退'), at.indexOf('回退是一次 `state.json` 的写入'))
  assert.ok(back.includes('环境') && back.includes('`env-blocked`') && back.includes('不回退重跑'), back)
  const closing = at.slice(at.indexOf('**一、验收没过不收口。**'), at.indexOf('**二、**'))
  for (const k of ['`env-blocked`', '照现状交付', '写明哪些没验证']) assert.ok(closing.includes(k), `第 6 节第一步缺「${k}」`)
})

// 复核（docs/37 §3）：at-resume 说「契约不要重写」，而门禁的【契约】会叫 PM「原样重写一次 00-contract.md、从回传里拿 sha」——两句要对上。
test('M4c at-resume：「契约不要重写」带上例外——门禁回传叫原样重写一次拿 sha 的照做，第 1 节一个字不动', () => {
  const r = flat(read('commands/at-resume.md'))
  for (const k of ['原样重写一次 `00-contract.md`', '一个字不动']) assert.ok(r.includes(k), `at-resume 缺「${k}」`)
})

// 复核（docs/37 §3）：at-acceptance 收不到【契约】（第 20 条），不再许诺「没收到漂移告警就按原话用、收到了就冒泡」。
test('M4c at-acceptance：不再许诺它结构上收不到的漂移告警', () => {
  const f = flat(read('agents/at-acceptance.md'))
  assert.ok(!f.includes('没收到漂移告警'), f)
  assert.ok(!f.includes('收到了就停下来冒泡给 PM'), f)
})
