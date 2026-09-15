import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseAgentAllowlist } from '../hooks/lib/frontmatter.mjs'
import { PLUGIN_PREFIX } from '../hooks/lib/decide.mjs'

const bare = (n) => (n.startsWith(PLUGIN_PREFIX) ? n.slice(PLUGIN_PREFIX.length) : n)

// ⚠️ U4 实测推翻了「白名单 == PM 的直接下级」这个模型。
// 真实机制：主线程 agent 的 tools: Agent(...) 过滤的是**整个会话**能解析到的
// agent 集合，并且**被所有子代理、孙代理继承**。实测原文：at-pm 的白名单写
// (at-product, at-architect) 时，架构师派 at-worker-a 得到
// "not found. Available agents: agent-team:at-architect, agent-team:at-product"
// ——恰好是 at-pm 那两个。
// 所以白名单是「这个会话里有哪些 agent 存在」的宇宙，不是「PM 能派谁」的边。
// 层级约束全部由 hook 的花名册承担。
test('at-pm 的白名单必须覆盖整个派发宇宙', () => {
  const md = readFileSync(new URL('../agents/at-pm.md', import.meta.url), 'utf8')
  const roster = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
  const allowed = new Set(parseAgentAllowlist(md).map(bare))
  const universe = new Set(Object.values(roster).flatMap((e) => e.can_delegate_to))
  assert.ok(universe.size > 0, '花名册里没有任何 can_delegate_to 目标')
  for (const name of universe) {
    assert.ok(
      allowed.has(name),
      `${name} 出现在某个角色的 can_delegate_to 里，却不在 at-pm 的白名单中。` +
        `主线程白名单过滤的是整棵子树可见的 agent 宇宙——不在里面的角色任何层级都` +
        `解析不到，平台报 not found，而 hook 会先放行，把排查方向指向被派的一方`,
    )
  }
})

// 实测：tools: Agent(...) 白名单是**过滤注册表**的，而插件 agent 的注册名带前缀。
// 白名单里写裸名会让交集为空，平台报 "Available agents: none"，
// PM 于是一个角色都派不出去——而这个故障是静默的，其余测试无一会发现。
test('at-pm 的白名单必须写全限定名，否则平台过滤后一个都不剩', () => {
  const md = readFileSync(new URL('../agents/at-pm.md', import.meta.url), 'utf8')
  const names = parseAgentAllowlist(md)
  assert.ok(names.length > 0, 'at-pm 的 tools 里没有 Agent(...) 白名单')
  for (const n of names) {
    assert.ok(
      n.startsWith(PLUGIN_PREFIX),
      `白名单项 ${n} 不是全限定名：平台按 ${PLUGIN_PREFIX}xxx 注册，` +
        `写裸名会把可派发集合过滤成空集`,
    )
  }
})

test('没有 Agent(...) 时返回空数组', () => {
  assert.deepEqual(parseAgentAllowlist('---\ntools: Read, Glob\n---\n正文'), [])
})

test('能解析带空格的列表', () => {
  assert.deepEqual(
    parseAgentAllowlist('---\ntools: Agent( a , b ), Read\n---\n正文'),
    ['a', 'b'],
  )
})
