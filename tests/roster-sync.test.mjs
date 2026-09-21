import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { parseAgentAllowlist } from '../hooks/lib/frontmatter.mjs'
import { MAIN, PLUGIN_PREFIX, stripPluginPrefix } from '../hooks/lib/decide.mjs'

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
// 身份锚点先钉住「哪几份正文带 Agent(...) 白名单」这个集合本身（当前是
// at-architect / at-pm / at-product 三份），不是「length > 0」——按第 1 条评审同一个
// 理由，避免「扫描范围被意外缩小」这类退化在这里重演。
//
// ⚠️ 裁定「理由换成认知上的」修了这段注释的括号：它原来写的是「at-backend / at-frontend /
// at-outsider 不派发，没有白名单」——**那是六份正文时期的清单**，M2a Task 2 起
// agents/ 下有十一份，不带白名单的是八个（at-acceptance / at-android / at-backend /
// at-frontend / at-ios / at-outsider / at-qa / at-ui）。**列三个说成全部，是一条会被
// 当成现状读的假话**，按本分支已经定过的同一条理由（「列举，不报总数」与「豁免不覆盖被证伪的预测」两条，docs/16 §3.1/§3.5）改掉：这里不再
// 枚举那一侧，只说规则——今天「带白名单的三份」恰好等于「roster.json 里有边的三个
// 角色」，而那个等式的**承重方向**由下面 ROLES_WITH_EDGES 那条单独守，不靠这条身份锚
// 间接覆盖。
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

// tools: Agent(...) 白名单是**过滤注册表**的，而插件 agent 的注册名带前缀；写裸名会让
// 交集为空，平台报 "Available agents: none"，那个角色于是一个都派不出去——而这个故障是
// 静默的，其余测试无一会发现。
//
// ⚠️ **裁定「认知状态分开标」（2026-09-20）：上面这句话对本测试遍历的三份正文，认知状态不一样，
// 分开说。**
//
//   · **`at-pm.md` 那一份是实测**：U3/U4（`docs/04` §7、本文件开头那段）直接观测到裸名
//     过不了平台的名称解析，而主线程那一份过滤的是整个会话的 agent 宇宙——交集空了，
//     任何层级都派不出去。**这一半有证据。**
//   · **`at-product.md` / `at-architect.md` 那两份是推断，不是实测**：依据是 M2b Task 5
//     测到的「子代理自己那份名字清单不收窄」（`docs/15` §3.7 的实验组：白名单里**没有**
//     `at-ui`，`at-product` 照样派出了 `at-ui`）。清单内容既然不参与判定，写成裸名照理
//     也不参与——**但「裸名」这一种变异本身没有被测过**：实验组用的是合格的全限定名、
//     只是指向了错的角色。**这一半是推的。**
//
// **所以这条测试对那两份正文守的是「别让它变成一个没人验证过的形状」，不是一条已证实的
// 失效。** 判据本身不动（全限定名是唯一已知安全的写法，代价为零），改的是别让一句话里
// 两种认知状态混在一起——读的人分不出哪半是测出来的，就会把推断当证据用。
//
// 结清它要的第四臂（测什么、为什么现在不测、什么时候顺带捡起来）记在
// `docs/11-M1b-遗留与已知边界.md` §5.17。
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
// ⚠️ **裁定「理由换成认知上的」（M2b Task 5 实测，2026-09-20）：这一段原来的「后果」是假话，已改写。**
//
// 原文写的是「**那条花名册边是死的**：H1 放行、平台按白名单过滤、报 not found」。
// 三臂实验把它对**子代理**这一侧证伪了（`docs/15` §3.7，全部记录级）：
//
//   · 实验组：把 at-product.md 的白名单改成 `Agent(agent-team:at-backend)`
//     （**恰好去掉 at-ui**），at-product **照样成功派出了 at-ui**（子代理谱系里
//     `agentType: agent-team:at-ui`、`spawnDepth: 2`），平台一声没吭；
//   · 阴性对照：把 at-product.md 的 `Agent(...)` **整段删掉**，它连派发工具都没有了
//     ——这一臂同时证明副本确实被加载、`tools:` 确实被读，实验没有接错线。
//
// **结论是两句，别只记住一句：名字清单不收窄；`Agent(...)` 在不在才收窄。**
//
// 「边是死的」那个后果**只对 at-pm.md 这一份成立**——它是整个会话的 agent **宇宙**
// （主规格 §3.3 U2，本文件开头 U4 那段），少一个名字，任何层级都解析不到。那一面由
// 本文件第一条「at-pm 的白名单必须覆盖整个派发宇宙」守着，**不是由下面这一条**。
//
// **那下面这一条为什么还留着？理由是认知上的，不是机械上的。**
// 同一趟实测里（`docs/15` §5.2）一个 PM 写下「我作为 at-pm 是有权限直接派 at-ui 的」
// ——**那是假话**：roster.json 里没有 at-pm → at-ui 这条边，H1 会当场拒。它是**照自己
// frontmatter 那行 `Agent(...)` 读出来的**，而 at-pm.md 的正文当时已经明写「以
// roster.json 为准」并刻意不复述清单。**模型会把 `tools:` 那行读成「我能派谁」，这是
// 实测到的行为，不是猜测。** 让子代理那两份的名字清单**等于**它真实的边，是在让那个
// （技术上错误的）读法**恰好读对**。写成「为了整洁」就把这条理由丢了。
// （agents/at-pm.md 那一侧的对策是裁定「补那句否定」：把「白名单不是你的边」这句**否定**
// 补进正文，由 tests/agents.test.mjs 钉着。）
//
// 判据用 ⊇ 不用 ==：at-pm.md 的白名单是整个会话的 agent **宇宙**，而 at-pm 自己的
// can_delegate_to 只是其中一部分——这是故意的，== 会把它判红。
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
          `白名单里没有 ${target}。**这条边不会因此变死**——M2b Task 5 实测过，子代理` +
          '自己那份名字清单不收窄（docs/15 §3.7）。要守的是另一件事：**模型会把 tools: ' +
          '那行读成「我能派谁」**（docs/15 §5.2 实测到 PM 据此写下一句假话），清单与' +
          '真实的边一致，才能让那个错误读法恰好读对。判据是 ⊇ 不是 ==：白名单可以比' +
          '自己的边多（at-pm 的那份是整个会话的 agent 宇宙），但一条都不能少。',
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
// ⚠️ **裁定「理由换成认知上的」新增：机械上承重的那一半在这里。**
//
// 上面那条（白名单 ⊇ 自己的边）按本轮实测是**认知**承重的。**机械**承重的是这一条：
// `roster.json` 里 `can_delegate_to` 非空的角色，正文的 `tools:` 里**必须有
// `Agent(...)`**——阴性对照实测过，整段删掉之后那个角色在会话里**根本拿不到派发工具**，
// 它的**每一条**边一起死（`docs/15` §3.7 / §3.7.1：at-product 去够 `Task` 拿到
// `No such tool available`，两份 at-ui 产物无人产出）。
//
// **清单从 roster.json 派生，不硬编码。** EXPECTED_DELEGATORS 守的是相反方向
// （「不该有白名单的别有」），对这一条只是间接覆盖；而且它是一份字面量，跟着数据
// 一起被改掉时什么都不剩——本分支为「锚钉错了集合 / 判据钉了字面量」开过三轮循环
// （docs/11 §5.13；裁定「paths 禁令要有守卫」与「命令名排除集单一真源」）。
//
// `__main__` 要排掉：它不是一份 agent 正文，是「**没被 settings.json 的 `agent` 键
// 钉住的主会话**」这一种身份（`docs/05-M0-结论.md`），`agents/` 下没有 `__main__.md`。
// 用 decide.mjs 导出的 `MAIN`，不写字面量——那个常量已经是单一真源。
const ROLES_WITH_EDGES = Object.keys(ROSTER)
  .filter((r) => r !== MAIN && (ROSTER[r]?.can_delegate_to ?? []).length > 0)
  .sort()

test('roster.json 里有 can_delegate_to 边的角色，正文的 tools: 里必须有 Agent(...)——否则它一条边都用不了', () => {
  for (const role of ROLES_WITH_EDGES) {
    const f = `${role}.md`
    assert.ok(
      AGENT_FILES.includes(f),
      `roster.json 里 ${role} 有 can_delegate_to 边，但 agents/ 下没有 ${f}` +
        `（实际扫到的是 ${JSON.stringify([...AGENT_FILES].sort())}）`,
    )
    assert.ok(
      allowlistOf(f).length > 0,
      `roster.json 里 ${role} 的 can_delegate_to 是 ` +
        `${JSON.stringify(ROSTER[role].can_delegate_to)}，但 agents/${f} 的 tools: 里` +
        '解不出 Agent(...)——**那个角色在会话里根本拿不到派发工具**，上面那些边一条都' +
        '用不了。这一条与「白名单 ⊇ 自己的边」不是同一件事：名字清单少一个不影响派发' +
        '（实测，docs/15 §3.7），`Agent(...)` 整个没有才是真的断。',
    )
  }
})

// ⭐ 正向自检锚（docs/11 §3.3 第 2 条）：上面那条迭代的是 ROLES_WITH_EDGES。
// 花名册哪天被改成除 __main__ 外都没有边、或者上面那个 filter 写成了排除一切，
// 它零圈空转、恒绿。**锚必须钉在派生出来的那个集合本身**，不是 Object.keys(ROSTER)
// 非空（那个恒真）、也不是 EXPECTED_DELEGATORS 非空（那是另一份数据，改不到一起）。
test('锚：roster.json 里确实有「有边、且不是 __main__」的角色——否则上面那条零圈空转', () => {
  assert.ok(
    ROLES_WITH_EDGES.length > 0,
    'roster.json 里除 __main__ 外没有任何角色带 can_delegate_to 边——上面那条' +
      '「有边就必须有 Agent(...)」一圈都不会跑，它是恒绿的，没有检查任何东西',
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

// ⚠️ **裁定「补那句否定」（M2b Task 5，2026-09-20）：把「白名单不是你的边」这句否定钉进
// agents/at-pm.md 的正文。**
//
// **为什么这三条放在本文件、不放 tests/agents.test.mjs**：要钉的这句话讲的就是
// 「`Agent(...)` 白名单」与「`roster.json` 的边」这两份数据的关系——本文件开头那段
// U4 注释讲的正是同一件事，而 agents.test.mjs 的职责是正文闭包（提到的名字存不存在）
// 与红线。更实际的一条：下面那个锚要算「at-pm 的白名单是不是严格宽于它自己的边」，
// 用的是本文件已有的 allowlistOf / ROSTER；放到隔壁就得把这套机械再搬一份过去，
// 而「同一份知识两处各写一遍」是本仓库开过好几轮循环的那个形状。
//
// 实证在 `docs/15` §5.2：一个 PM 在真实 run 里写下「我作为 `at-pm` 是有权限直接派
// `at-ui` 的」。roster.json 里**没有**这条边。它是照 frontmatter 那行 `Agent(...)`
// 读出来的——而正文**当时已经**写着「以 `roster.json` 为准」。**光有肯定这一半不够。**
//
// 三条分开写（docs/11 §3.3 第 1 条：检验不同侧面的固定断言要拆开），而且**否定与它的
// 依据各钉一条**：本分支刚为「禁令留着、依据消失」开过一轮修复（commit 55b1002），
// 只钉「不是你能派谁」而不钉「那它是什么」，正是同一个不对称。
const bodyOfAgent = (f) =>
  readFileSync(new URL(`../agents/${f}`, import.meta.url), 'utf8').split(/^---\s*$/m).slice(2).join('---')

test('at-pm.md 正文有「能派谁以 roster.json 的 can_delegate_to 为准」这一半（肯定）', () => {
  assert.match(
    bodyOfAgent('at-pm.md'),
    /你能直接派谁[\s\S]{0,120}can_delegate_to[\s\S]{0,20}为准/,
    'agents/at-pm.md 的正文里找不到「你能直接派谁……以 can_delegate_to 为准」——' +
      '这是 PM 判断自己能派谁的唯一真源指向，删掉它就只剩 frontmatter 那行白名单可读，' +
      '而那一行不是边（docs/15 §5.2 实测过照它读会读出假话）',
  )
})

test('at-pm.md 正文有「frontmatter 那行 Agent(...) 不是你能派谁」这一半（否定）', () => {
  assert.match(
    bodyOfAgent('at-pm.md'),
    /不是「你能派谁」/,
    'agents/at-pm.md 的正文里找不到「那一行 Agent(...) **不是**你能派谁」这句否定。' +
      'docs/15 §5.2 是这句话缺失造成假信念的直接实证：正文当时已经有肯定那一半' +
      '（以 roster.json 为准），PM 仍然照白名单写下「我有权限直接派 at-ui」。' +
      '肯定与否定要各写一句，不能指望读的人自己推出来',
  )
})

test('at-pm.md 正文说清了那行白名单到底是什么——否定留着、依据没了同样不行', () => {
  assert.match(
    bodyOfAgent('at-pm.md'),
    /整个会话的\s*agent\s*宇宙/,
    'agents/at-pm.md 的正文里找不到「整个会话的 agent 宇宙」这个说明。只写「那不是你的边」' +
      '而不说它究竟是什么，就是本分支 commit 55b1002 修过的那个不对称（禁令留着、依据' +
      '消失）——读的人不知道那一行为什么存在、比边宽多少，下次照样会拿它当边读',
  )
})

// ⭐ 正向自检锚：上面三条守的那件事，**前提是 at-pm 的白名单确实比它自己的边宽**。
// 哪天两者相等了（比如有人把白名单收成 can_delegate_to 的样子），照白名单读也读不出
// 假话，那三条就从「防一个实测到的失效」退化成「钉三句措辞」——它们还会绿，而绿的
// 理由已经换了一个，没有任何提示。锚钉的就是这个前提本身。
test('锚：at-pm 的 Agent(...) 白名单严格宽于 at-pm 自己的 can_delegate_to——否则上面三条守的那个失效今天不可能发生', () => {
  const allowed = new Set(allowlistOf('at-pm.md').map(stripPluginPrefix))
  const edges = new Set(ROSTER['at-pm']?.can_delegate_to ?? [])
  const extra = [...allowed].filter((n) => !edges.has(n)).sort()
  assert.ok(
    extra.length > 0,
    `at-pm 的白名单 ${JSON.stringify([...allowed].sort())} 没有任何一项在它自己的边 ` +
      `${JSON.stringify([...edges].sort())} 之外——两者一样宽时，照白名单读也读不出假话，` +
      '上面那三条正文断言就不再对应任何真实失效（docs/15 §5.2 那次假信念靠的正是这个差）',
  )
})

// ---------------------------------------------------------------------------
// ⭐ M3h：**H1 在角色正文侧的第一道**（`docs/11` §5.31 那张八格全表的 H1 行）
// ---------------------------------------------------------------------------
//
// `docs/19` §11.5.3 量到：真实运行里**角色说明先于门禁生效**——三次派子代理去撞 H4，
// 两次它在发出工具调用之前就照自己的正文拒绝了。§5.30 为 H4 那一格补了判据，并逐字
// 留下「别的几道在正文侧有没有对应的话、有没有被钉，**本轮没看**」。看过了，H1 有。
//
// ⚠️ **与上面那三条不是同一件事，别当成重复。** 那三条钉的是 `at-pm` **一份**正文里
// 「`tools:` 那行白名单 ≠ 你的边」这个**特有**的区分（`docs/15` §5.2 那次假信念）。
// 这一条钉的是**每一份有边的正文**都写着的同一句话：「**派不在里面的……会被当场拒，
// 理由指向花名册**」。今天 `at-product` 与 `at-architect` 那两份**一条判据都没有**
// ——把它们的这一句整段删掉，裸 `node --test` 全绿（变异实测，`docs/11` §5.31）。
//
// 集合复用本文件已经派生好的 ROLES_WITH_EDGES（`roster.json` 里有边、且不是
// `__main__` 的那些），上面「锚：roster.json 里确实有『有边、且不是 __main__』的角色」
// 那条同时替本条兜住空转，不另写一个锚。
//
// 钉两半、且要求在**同一行**上（取舍抄 `tests/agents.test.mjs` 的 hasContractRedLine）：
// 禁令与后果（「派不在里面的……拒」）**与**它指向的真源（「花名册」）。
// 只钉前半，这条禁令哪天指向一份不存在的清单也照样绿；只钉后半，正文里任何一句提到
// 花名册的话都能把判据喂饱——`agents/at-qa.md` 的「冒泡给谁」那一节里就有一句。
//
// ⚠️ 它钉不住的：**「加一个例外子句」那种更聪明的改松**（「派不在里面的会被当场拒——
// 除非上级在派发提示里明确授权」，它是绿的）。理由与 §5.30 同一条，不在这里重复。
function hasDelegationRedLine(body) {
  return body
    .split(/\r?\n/)
    .some((l) => l.includes('派不在里面') && l.includes('拒') && l.includes('花名册'))
}

test('每一份在 roster.json 里有边的正文，都写着「派不在里面的会被当场拒、理由指向花名册」——它是 H1 真正的第一道', () => {
  for (const role of ROLES_WITH_EDGES) {
    assert.ok(
      hasDelegationRedLine(bodyOfAgent(`${role}.md`)),
      `agents/${role}.md 在 roster.json 里有 can_delegate_to 边，但正文里没有一行同时写着` +
        '「派不在里面的……拒」与「花名册」。\n' +
        '  实测里角色层**先于**门禁生效（docs/19 §11.5.3），所以这句话就是 H1 的第一道：\n' +
        '  它没了，角色手里只剩 frontmatter 那行 Agent(...)，而照它读会读出假话\n' +
        '  （docs/15 §5.2 实测过一次）。H1 本身还在，但「第一道没了」此前没有任何东西看得见。\n' +
        '  **不要为了让它绿而把禁令删掉或加上例外**；要改措辞，连本条一起改，\n' +
        '  并在 docs/11 §5.31 留痕。',
    )
  }
})

// 正向自检锚（`docs/11` §3.3 第 2 条）：拿已知违规样本证明 hasDelegationRedLine()
// 认得出违规。样本取这条判据要防的那个动作的最便宜两种形态——删掉、说反——
// 外加一句「只提花名册」的无关句子（它不该把判据喂饱）。
test('自检：hasDelegationRedLine() 认得出被删掉、被改松的样本，也不被一句无关的花名册提及喂饱', () => {
  assert.ok(
    hasDelegationRedLine(
      '`can_delegate_to`，H1 派发门禁按它放行——派不在里面的角色会被当场拒掉，理由指向花名册。',
    ),
    '真实原文形状都认不出来，判据本身坏了',
  )
  // ① 整条删掉，只留肯定那一半。
  assert.ok(
    !hasDelegationRedLine('**你能派谁，判据是花名册（`roster.json`）里你自己的 `can_delegate_to`。**'),
    '禁令与后果那一半被整条删掉时应判为不通过',
  )
  // ② 说反 / 改松——**这才是这条判据要拦的那个动作**。
  assert.ok(
    !hasDelegationRedLine('派不在里面的角色通常也派得动，门禁只会提醒一句，理由指向花名册。'),
    '「派不在里面的通常也派得动」这种改松应判为不通过',
  )
  // ③ 一句无关的花名册提及不该被当成这条红线。
  assert.ok(
    !hasDelegationRedLine('派发你的那个角色——当前花名册里指向你的边来自 PM。判据是 `roster.json`。'),
    'at-qa 那句「冒泡给谁」不该被当成 H1 的第一道',
  )
  // ④ 两半分在两行——**故意判为不通过**，与 hasContractRedLine 同一个取舍。
  assert.ok(
    !hasDelegationRedLine('派不在里面的角色会被当场拒掉。\r\n理由指向花名册。'),
    '两半分在两行时按设计判为不通过——这条断言红了说明有人放宽了「同一行」那个要求',
  )
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
