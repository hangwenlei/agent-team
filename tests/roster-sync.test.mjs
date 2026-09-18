import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { parseAgentAllowlist } from '../hooks/lib/frontmatter.mjs'
import { PLUGIN_PREFIX, stripPluginPrefix } from '../hooks/lib/decide.mjs'

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
  const allowed = new Set(parseAgentAllowlist(md).map(stripPluginPrefix))
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

// 修复轮 2（评审发现 3）：这条此前只读 agents/at-pm.md。M1c Task 6/7 给
// at-product.md（派 at-backend）与 at-architect.md（派 at-backend/at-frontend）也
// 加上了 Agent(...) 白名单，但 parseAgentAllowlist 全仓只有本文件在消费，而本文件
// 两条断言都硬编码只读 at-pm.md——另外两份新增的白名单从写下来那天起就没有任何
// 测试校验过。变异实测：把 at-architect 的白名单改成裸名
// （Agent(at-backend, at-frontend)）、塞进 agent-team:at-outsider，把 at-product
// 的改成指向不存在的角色（agent-team:at-nosuchrole），三种同时改上——`node --test`
// 全绿、390/0。裸名那种写法按下面这条测试自己的注释会让平台过滤后一个角色都派不
// 出去；而 S5 的实现派发正是 at-architect 发起的，这不是一个抽象风险。
//
// 身份锚点先钉住「哪几份正文带 Agent(...) 白名单」这个集合本身（当前是这三份：
// at-architect / at-pm / at-product；at-backend / at-frontend / at-outsider 不
// 派发，没有白名单），不是「length > 0」——按第 1 条评审同一个理由，避免「扫描范围
// 被意外缩小」这类退化在这里重演。
const AGENT_FILES = readdirSync(new URL('../agents/', import.meta.url)).filter((f) => f.endsWith('.md'))
const allowlistOf = (f) => parseAgentAllowlist(readFileSync(new URL(`../agents/${f}`, import.meta.url), 'utf8'))
const EXPECTED_DELEGATORS = ['at-architect.md', 'at-pm.md', 'at-product.md']

test('agents/ 目录下恰好是这三份带 Agent(...) 白名单的正文', () => {
  const delegators = AGENT_FILES.filter((f) => allowlistOf(f).length > 0)
  assert.deepEqual(
    [...delegators].sort(),
    [...EXPECTED_DELEGATORS].sort(),
    `实际带 Agent(...) 白名单的文件是 ${JSON.stringify([...delegators].sort())}，` +
      `与预期的 ${JSON.stringify(EXPECTED_DELEGATORS)} 不一致——下面几条只遍历` +
      'EXPECTED_DELEGATORS，新增或删掉一个会派发的角色时必须回来同步这份清单',
  )
})

// 实测：tools: Agent(...) 白名单是**过滤注册表**的，而插件 agent 的注册名带前缀。
// 白名单里写裸名会让交集为空，平台报 "Available agents: none"，
// 那个角色于是一个都派不出去——而这个故障是静默的，其余测试无一会发现。
test('每一份带 Agent(...) 白名单的正文，白名单项都必须写全限定名，否则平台过滤后一个都不剩', () => {
  for (const f of EXPECTED_DELEGATORS) {
    const names = allowlistOf(f)
    assert.ok(names.length > 0, `agents/${f} 的 tools 里没有解出 Agent(...) 白名单`)
    for (const n of names) {
      assert.ok(
        n.startsWith(PLUGIN_PREFIX),
        `agents/${f} 的白名单项 ${n} 不是全限定名：平台按 ${PLUGIN_PREFIX}xxx 注册，` +
          `写裸名会把可派发集合过滤成空集`,
      )
    }
  }
})

// 此前没有任何测试校验过白名单项（剥前缀后）真的是 roster.json 的键——at-pm 的
// 白名单恰好被「必须覆盖整个派发宇宙」那条顺带校验了，at-product / at-architect
// 的没有任何测试碰过。
test('每一份带 Agent(...) 白名单的正文，剥前缀后的每一项都必须是 roster.json 的键', () => {
  const roster = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
  for (const f of EXPECTED_DELEGATORS) {
    for (const n of allowlistOf(f)) {
      const bare = stripPluginPrefix(n)
      assert.ok(
        Object.hasOwn(roster, bare),
        `agents/${f} 的白名单项 ${n}（剥前缀后 ${bare}）不在 roster.json 里`,
      )
    }
  }
})

// at-outsider 是测试替身，roster.json 里所有角色的 can_delegate_to 都不含它
// （tests/roster-closure.test.mjs 守着那一侧），但 tools: Agent(...) 白名单是
// 另一份独立的数据源，两者不会自动保持一致——这条测试补上白名单这一侧。
test('没有任何一份正文的 Agent(...) 白名单里含 at-outsider', () => {
  for (const f of EXPECTED_DELEGATORS) {
    for (const n of allowlistOf(f)) {
      assert.notEqual(
        stripPluginPrefix(n),
        'at-outsider',
        `agents/${f} 的白名单里出现了 at-outsider——它是测试替身，任何角色都不该能派发到它`,
      )
    }
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
