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

// ⚠️ M2b Task 3 补：**这条不变量此前从来不存在。**
//
// 上面四条各守一面——白名单项是不是 roster.json 的键、是不是全限定名、含不含
// at-outsider、at-pm 的白名单盖不盖得住整个派发宇宙——**但没有一条问过「某份正文的
// 白名单有没有盖住这个角色自己在花名册里的那几条边」**。于是 M1c Task 6/7 给
// at-product.md / at-architect.md 加上 Agent(...) 白名单之后，这两份与 roster.json
// 分叉了整整一轮而全程绿：M2b Task 3 把 at-product 的边从 at-backend 换成 at-ui、
// 给 at-architect 加了 at-ui/at-ios/at-android 三条之后，at-product.md 的白名单仍然只
// 写着 at-backend（**正是这一轮被删掉的那条边**），at-architect.md 仍然少三个，而
// `node --test` 是 544/0。发现它的不是测试，是派下一个任务之前的人工扫描
// （docs/11 §5.13：「一个不变量从来没被写下来」和「一个不变量被写错了」在测试套件里
// 长得一模一样——都是全绿）。
//
// 后果不是「白名单写得不够全」这种整洁问题，是**那条花名册边是死的**：H1 查花名册，
// 放行；平台按白名单过滤 agent 注册表，解析不到那个名字，报 not found——而那条错误
// 信息指向**被派的那一方**，排查的人会去翻被派角色的正文找原因（docs/04 §7 记的
// 失效形状，本文件开头 U4 那段记的是同一个机制的另一面）。
//
// 判据用 ⊇ 不用 ==：at-pm.md 的白名单是整个会话的 agent **宇宙**（主规格 §3.3 U2，
// 见本文件开头），而 at-pm 自己的 can_delegate_to 只是其中一部分——这是故意的，
// == 会把它判红。
const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const roleOf = (f) => f.replace(/\.md$/, '')
const edgesOf = (f) => ROSTER[roleOf(f)]?.can_delegate_to ?? []

test('每一份带 Agent(...) 白名单的正文，白名单必须覆盖该角色在 roster.json 里的每一条 can_delegate_to', () => {
  for (const f of EXPECTED_DELEGATORS) {
    const allowed = new Set(allowlistOf(f).map(stripPluginPrefix))
    for (const target of edgesOf(f)) {
      assert.ok(
        allowed.has(target),
        `roster.json 里 ${roleOf(f)} → ${target} 这条边存在，但 agents/${f} 的 Agent(...) ` +
          `白名单里没有 ${target}——**这条边是死的**：H1 查花名册会放行，而平台按白名单` +
          '过滤 agent 注册表、解析不到这个名字，报 not found，错误信息指向**被派的那一方**' +
          '（docs/04 §7 记的失效形状）。判据是 ⊇ 不是 ==：白名单可以比自己的边多' +
          '（at-pm 的白名单是整个会话的 agent 宇宙），但一条都不能少。',
      )
    }
  }
})

// ⭐ 正向自检锚（docs/11 §3.3 第 2 条）：上面那条的**内层**循环跑几圈，完全取决于
// EXPECTED_DELEGATORS 里那几个角色的 can_delegate_to 有没有东西。三份全空时内层零圈，
// 那条测试恒绿而一个白名单都没检查过。
//
// ⚠️ 锚必须钉在**那条不变量真正迭代的那个集合**上——EXPECTED_DELEGATORS 对应角色的边，
// **不是** Object.values(ROSTER) 的全部边。用后者的话，把这三份 delegator 的边全清空、
// 只留 __main__ 那几条，锚照样绿，而不变量已经在空转、没人知道。M2b Task 2 的数组形式
// 锚栽的正是「锚钉错了集合」这一步，不在这里重演。
test('锚：EXPECTED_DELEGATORS 这三份正文对应的角色，在 roster.json 里确实有边——否则上面那条内层零圈空转', () => {
  assert.ok(
    EXPECTED_DELEGATORS.flatMap(edgesOf).length > 0,
    `EXPECTED_DELEGATORS（${JSON.stringify(EXPECTED_DELEGATORS)}）对应的角色在 roster.json ` +
      '里一条 can_delegate_to 都没有——上面那条「白名单必须覆盖每一条边」的内层循环一圈' +
      '都不会跑，它是恒绿的，没有检查任何东西',
  )
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
