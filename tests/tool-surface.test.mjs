// U7 实测（docs/06-U7-实测结论.md）证明：context: fork 的 skill 能用 agent:
// 参数直接起一个 subagent，全程不经过 Agent 工具，H1 派发门禁（挂在
// PreToolUse / matcher ^Agent$ 上）看不见这次调用——目标角色若在花名册白名单
// （宇宙）内，fork 直接拿到它的真实定义，绕过整套派发门禁。U8 实测
// （docs/07-U5-U6-U8-实测结论.md）确认当前配置下 SendMessage/ListAgents 没有
// 被授予、这条路目前不存在，但官方工具说明的触达范围（本机其它 Claude 会话）
// 与 cross-session permission laundering 警告，与 Skill 是同一种风险形状，
// 只是没有像 Skill 那样临时授予后实测出真正的旁路。规格 §6.1 把这三个工具
// 一并定为角色工具面一律不授予；本插件自带的 skill 也一律不声明
// context: fork。这两条测试把这条防线钉死，不依赖任何人记得住这条规则。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { toolsDeclarationOf } from './helpers/agent-tools.mjs'
import { EXPECTED_AGENTS } from './helpers/expected-agents.mjs'
import { stripPluginPrefix } from '../hooks/lib/decide.mjs'
import { isVerifyStage, stageRoles } from '../hooks/lib/stages.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AGENTS_DIR = join(ROOT, 'agents')
const SKILLS_DIR = join(ROOT, 'skills')

// ⚠️ 这里此前是一份只取表头那一行的扫描（`.find(l => /^tools:/.test(l.trim()))`），
// 在它上面做三次否定断言、没有任何正向断言证明这一行解得出工具名。M1b 终审 C2
// 实测：把 agents/at-backend.md 的 tools: 改写成合法的 YAML 块序列并把三个禁授
// 工具全写进去，`node --test` 仍然 304 pass / 0 fail —— 规格 §6.1 唯一的机械防线
// 被一次合法的 YAML 改写整体架空。解析改到 tests/helpers/agent-tools.mjs，那里
// 认行内与块序列两种形式，并且是 tests/command-tool-closure.test.mjs 共用的**同
// 一份**实现：C2 的成因正是两份行扫描只改了一份（详见那个 helper 的头部注释）。
const AGENT_FILES = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))
const declarationOf = (file) => toolsDeclarationOf(readFileSync(join(AGENTS_DIR, file), 'utf8'))

// 规格 §6.1：角色工具面是按需白名单，这三个工具一律不授予。Skill 的旁路是
// U7 临时授予后实测出来的（docs/06-U7-实测结论.md）；SendMessage/ListAgents
// 是 U8 的结论（docs/07-U5-U6-U8-实测结论.md）——当前配置下未授予、这条路不
// 存在，但官方工具说明的触达范围与 cross-session permission laundering 警告
// 是同一形状的风险，本轮没有像 Skill 那样临时授予后实测。三个工具的理由不同，
// 断言失败时要分别点名，不能用一句笼统的话糊弄过去。
const FORBIDDEN_TOOLS = [
  {
    name: 'Skill',
    reason:
      'context: fork 的 skill 能用 agent: 参数绕过 Agent 工具直接起一个 ' +
      'subagent，H1 派发门禁看不到这次调用，会直接拿到目标角色的真实定义' +
      '（U7 实测，见 docs/06-U7-实测结论.md）。',
  },
  {
    name: 'SendMessage',
    reason:
      '官方工具说明称它可给已存在的 agent（含本机其它 Claude 会话）发消息并续起，' +
      '并明确警告过 cross-session permission laundering。花名册 can_delegate_to 管的是' +
      '能不能派，按文档描述管不住能不能发消息。**授予后的实际行为本项目未实测**，' +
      '此处按文档推断从严不授予（U8，见 docs/07-U5-U6-U8-实测结论.md）。',
  },
  {
    name: 'ListAgents',
    reason:
      '持有该工具的角色能枚举出「in-process subagents you spawned」之外的 ' +
      '本机其它 Claude 会话，为绕开花名册触达受限 agent 或跨会话侦察提供前提' +
      '（U8 结论，见 docs/07-U5-U6-U8-实测结论.md）。',
  },
]

// 同款手法用来查 skill frontmatter 的 context: 字段是否声明为 fork。
function declaresForkContext(md) {
  return md
    .split(/\r?\n/)
    .some((l) => /^context:\s*["']?fork["']?\s*$/.test(l.trim()))
}

// 递归找某个目录下所有指定文件名的文件；目录不存在时返回空数组而不是报错
// ——如果 skills/ 目录不存在或未来被清空，这是预期状态，不是异常：下面的
// 测试对着空数组照样能通过（见下面那条测试自己的注释）。
function findFilesNamed(dir, filename) {
  if (!existsSync(dir)) return []
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...findFilesNamed(full, filename))
    } else if (entry.isFile() && entry.name === filename) {
      found.push(full)
    }
  }
  return found
}

function toPosix(p) {
  return p.split('\\').join('/')
}

// 修复轮 2（评审发现 1）：这条身份锚点是本轮新加的，此前唯一的正向前置断言是
// 「AGENT_FILES.length > 0」——只证明扫到了至少一个文件，证不了扫到的就是 EXPECTED_AGENTS 里那些。
// 变异实测过：把 AGENT_FILES 的过滤条件改成只匹配 `pm.md`（模拟扫描范围被意外
// 缩小），同时给 agents/at-backend.md 授予 Skill/SendMessage/ListAgents——因为
// 扫描结果只剩 at-pm.md 一个文件，下面禁授工具那条否定断言只检查了这一个文件，
// at-backend.md 的真实违规完全落在检查范围之外，`node --test` 全绿、390/0——这是
// M1b 终审 C2 的同一个文件、同一条测试、同一族失败，只是退化方式从「块序列写法」
// 换成了「扫描范围本身被缩小」。EXPECTED_AGENTS 与 tests/agents.test.mjs 共用同一份
// （tests/helpers/expected-agents.mjs），不在这里重复写一份字面量数组。
test('前置条件：agents/ 目录下恰好是 EXPECTED_AGENTS 列出的那些角色文件——否则下面的否定断言可能只在被意外缩小的那一部分文件上检查', () => {
  assert.deepEqual(
    [...AGENT_FILES].sort(),
    EXPECTED_AGENTS,
    // M2b Task 4：这段文案原来写的是「与预期的六个角色」，而 agents/ 下自 M2a Task 2
    // 起就是十一份——一条会被打印出来的活文案报了一个错的总数，真红的时候会把排查方向
    // 带偏。与 tests/agents.test.mjs 那条同源同因，两边一起改成**不报总数**（本分支
    // Task 1 起「列举，不报总数」那一族定过的同一条理由（docs/16 §3.1））：只改一份，就是本仓库反复踩过的
    // 「同一份知识两份拷贝、日后只改一份」当场复演。
    `agents/ 目录扫描结果是 ${JSON.stringify([...AGENT_FILES].sort())}，与预期的 ` +
      `${JSON.stringify(EXPECTED_AGENTS)} 不一致——下面所有对 AGENT_FILES 的检查` +
      '范围都会跟着变，且不会有任何提示',
  )
})

// 正向前置断言，单独占一个 test()。为什么必须独立：它一旦失败（解析手法失效、
// 或某个角色根本没有 tools: 声明），排在它后面的那些否定断言会在同一个 test()
// 里被 assert 抛出直接挡住——而那正是 C2 的失效形状：否定断言对着一个空字符串
// 天然全部成立，「全绿」什么都不证明。先例是 tests/command-tool-closure.test.mjs
// 的「前置条件：agents/at-pm.md 有 tools: 行，且能从里面解出至少一个候选工具」
// ——那条知识本轮才回灌到安全这一侧。
test('前置条件：agents/ 下每个 .md 都解得出至少一个工具名——否则下面的否定断言在对空集合空转', () => {
  for (const file of AGENT_FILES) {
    const { text, names } = declarationOf(file)
    assert.ok(
      names.length > 0,
      `agents/${file} 的 frontmatter 里没有解出任何工具名（tools: 声明原文为 ` +
        `${JSON.stringify(text)}）。要么这个角色真的没有 tools: 声明，要么它用了一种 ` +
        'tests/helpers/agent-tools.mjs 还不认识的 YAML 写法——两种情况下，下面那条' +
        '「不得出现 Skill / SendMessage / ListAgents」的否定断言都是在对着空文本做，' +
        '恒真、什么都不证明（M1b 终审 C2 的成因）。而且一份没有 tools: 行的正文会继承全部工具，' +
        '包括禁授的那三样（官方文档：省略 tools 即继承全部工具）——主线程的 tools: 不替它兜着（M4b P4，docs/36）。',
    )
  }
})

// ⭐ `tools:` 的**身份锚**（M2c 补轮）。
//
// **这一层此前是空的。** 逐条核过今天守着 `tools:` 的都是什么：
//
//   · `Skill` / `SendMessage` / `ListAgents` 一律不得出现 —— 本文件下面那条；
//   · `Bash` 的逐份授予（多给一份、少给一份都红）—— `tests/agents.test.mjs` 的
//     「Bash 的授予与 HAS_BASH 逐份一致」；
//   · `Agent(...)` 白名单（谁有、内容、全限定名、⊇ 自己的边、⊆ 花名册、不含
//     at-outsider）—— `tests/roster-sync.test.mjs` 那一组；
//   · 每份都解得出至少一个工具名 —— 上面那条前置。
//
// **剩下的全部没人守**：`Read` / `Glob` / `Write` / `Edit` / `AskUserQuestion`，
// 以及**任何一个上面四行都没点到名的工具**。往任意一份 `tools:` 里加一个 `Grep`、
// `WebFetch`、`NotebookEdit`，整套测试零红。
//
// ⚠️ **为什么 `at-pm` 那一行要紧**：它是主会话的工具面——插件把主会话钉成 at-pm，用户在普通会话里能用的 MCP 与
// 网页工具，装了插件的项目里主会话都拿不到（M4b P2 实测）；它的 `Agent(...)` 类型表是整个会话的派发宇宙
// （主规格 §3.3 U2/U4）。
// ⚠️ **订正（M4b，docs/36）**：这里原来写「主线程的 tools: 是整个会话的能力天花板，被子代理继承；给 at-pm 加一个
// 工具等于给整棵子树加」——工具这一维不成立。P4 实测：主线程白名单只有 Read 与 Agent 时，子代理照样调通了自己 tools:
// 里列的 MCP、Grep、WebSearch、WebFetch。只封顶派发宇宙；每个角色拿的是自己清单里的工具。原来引作证据的
// `... is disabled for this session, in subagents as well as here` 是一句固定文案（调用方清单里没有、内建目录里有的工具
// 一律报它），docs/15 早有反证。所以禁授（Skill / SendMessage / ListAgents）靠的是**每一份**自己的 tools: 行——
// 下面那条逐份的禁授判据、上面那条「每份都解得出至少一个工具名」的前置（缺 tools: 行＝继承全部工具），加这份期望值。
//
// ⚠️ **这条缺口不是读出来的，是一次为别的目的做的变异顺带照出来的。** M2c 给两份
// README 补「`at-pm` 工具面」判据时，变异「往 `agents/at-pm.md` 的 `tools:` 里加一个
// `Grep`」跑出来的结果是：**整套里只有那两条新加的 README 判据会红，别的一条都没有。**
// 本分支已经有过一次同样的发现方式——`tests/commands.test.mjs` 那条角色名闭包判据
// 根本没有正向锚，是做**角色侧**变异时同一把刀顺带照出来的：一边报警一边沉默，
// 那个沉默就是答案。**两次都不是读代码读出来的。**
//
// 形状照 `tests/agents.test.mjs` 的 `model:` 身份锚：`deepEqual` 一份逐份期望值，
// 不是 `length > 0` 那种数量锚——「正向锚是数量不是身份」正是 M1b 终审第 1 条栽过的
// 那一步。`got` 按 `AGENT_FILES` 逐份建出来，少扫一份 / 多扫一份都会让它当场红。
//
// ## 三条取舍
//
// 1. **`Agent(...)` 括号里那一长串不钉。** `toolsDeclarationOf().names` 给出的就是
//    裸名 `Agent`（那个 helper 的 `toolNameOf` 明写「括号里的角色名不是工具名」），
//    正合适：那份名字清单已经由 `tests/roster-sync.test.mjs` 那一组守着，而且它是
//    **从 `roster.json` 派生**的——在这里再钉一份字面量就是第二份拷贝，花名册一动
//    就得回来改两处，正是本仓库开过好几轮循环的那个形状。这里只钉「谁有 `Agent`、
//    谁没有」这一层，与那一组不重叠。
// 2. **排序之后比，不比声明顺序。** 要抓的是「多了 / 少了一个工具」；纯粹调换次序
//    是无害编辑，让它红只会制造噪声。排序不削弱任何方向：加一个、删一个、写重了
//    一个，排序后仍然红。
// 3. **用现成的解析器**，不另写一份行扫描——M1b 终审 C2 的成因就是两份逐字相同的
//    行扫描只改了一份。
//
// ⚠️ 这条与 `tests/agents.test.mjs` 的 `HAS_BASH` **有意在 `Bash` 这一格上重叠**，
// 不是冗余：那一条驱动的是「持有 `Bash` 的正文必须写哪几条红线」，这一条钉的是整条
// 声明。两者从相反方向夹着同一个事实——`HAS_BASH` 停在旧值时这条红，这份期望值停在
// 旧值时那条红。
// M4b（docs/36，审查第 29 条）：十个团队角色加 Grep（只读、不经任何门禁；at-outsider 是派不起来的测试替身，保持最小）；
// 写文档、不在验证段的 at-product、at-architect 加 Edit。at-qa、at-acceptance 不给 Edit，理由见下面那条判据。
const EXPECTED_TOOLS = {
  'at-acceptance.md': ['Glob', 'Grep', 'Read', 'Write'],
  'at-android.md': ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
  'at-architect.md': ['Agent', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
  'at-backend.md': ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
  'at-frontend.md': ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
  'at-ios.md': ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
  'at-outsider.md': ['Read'],
  'at-pm.md': ['Agent', 'AskUserQuestion', 'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
  'at-product.md': ['Agent', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
  'at-qa.md': ['Bash', 'Glob', 'Grep', 'Read', 'Write'],
  'at-ui.md': ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
}

test('十一份 agent 的 tools: 声明与预期逐份一致——加一个工具、少一个工具都红', () => {
  const got = {}
  for (const file of AGENT_FILES) {
    got[file] = [...declarationOf(file).names].sort()
  }
  assert.deepEqual(
    got,
    EXPECTED_TOOLS,
    '某个角色的 tools: 声明变了，而这份期望值没跟着变。**不要先改这份期望值**——先回答：' +
      '这个工具为什么要授予（或为什么要收回）？规格 §6.1 把角色工具面定为**按需白名单**，' +
      '多一个就是多一份触达面。动的是 at-pm.md 时，它是主会话的工具面，README 两半的已知边界照着它写；' +
      '每个角色只拿自己清单里的工具（主线程的 tools: 不封顶子代理的工具，M4b P4 实测，docs/36）。改对了再回来同步这份清单，并确认 ' +
      'tests/agents.test.mjs 的 HAS_BASH、tests/roster-sync.test.mjs 的 Agent(...) 那一组、' +
      '以及 README 两半已知边界里 at-pm 的工具面（tests/readme-sync.test.mjs）是不是也要一起动。',
  )
})

test('没有任何角色的 tools: 包含 Skill / SendMessage / ListAgents', () => {
  for (const file of AGENT_FILES) {
    const { text, names } = declarationOf(file)
    for (const { name, reason } of FORBIDDEN_TOOLS) {
      // 两道一起查，各自抓不同的形状：names 是解析出来的顶层工具名（精确）；
      // text 是整条声明的原文（保守，连写在括号里、注释里的同名词也一并挡住）。
      // 原来只有后者，而且 text 只有表头一行——块序列形式整条溜过去。
      assert.ok(
        !names.includes(name) && !new RegExp(`\\b${name}\\b`).test(text),
        `agents/${file} 的 tools: 声明里出现了 ${name}（原文 ${JSON.stringify(text)}）。` +
          reason +
          '禁授靠的是每一份自己的 tools: 行：主线程的 tools: 不封顶子代理的工具（M4b P4 实测，docs/36），' +
          '任何一个角色写了它，那个角色就真拿到了。规格 §6.1：角色工具面是按需白名单，这三个工具一律 ' +
          '不授予。',
      )
    }
  }
})

test('本插件自带的 skills/**/SKILL.md 不声明 context: fork（当前 0 个也算通过）', () => {
  const skillFiles = findFilesNamed(SKILLS_DIR, 'SKILL.md')

  // 不对数量做断言：如果 skills/ 目录不存在或未来被清空，findFilesNamed 对
  // 不存在的目录返回空数组，下面的循环零次迭代、测试直接通过——这是预期
  // 状态，"有几个测几个，零个也通过"，不代表这条防线没在守。
  for (const file of skillFiles) {
    const rel = toPosix(relative(ROOT, file))
    const md = readFileSync(file, 'utf8')
    assert.ok(
      !declaresForkContext(md),
      `${rel} 声明了 context: fork。这正是 U7 实测证出的旁路：带这个声明的 ` +
        'skill 能用 agent: 参数直接起一个 subagent，全程不经过 Agent 工具，' +
        'H1 派发门禁看不见这次调用（docs/06-U7-实测结论.md）。本插件自己捆绑' +
        '的 skill 一律不得使用 context: fork。',
    )
  }
})

// ============================================================================ M4b（docs/36，审查第 29 条）

// 验证段（stages.json 里 "verifies": true 的段）的产者，除主会话角色外不持 Edit。验证段的产物在返工轮里要整份重新出，
// 门禁只按 sha 判新旧、认不出「在上一轮那份末尾补一句」（hooks/lib/freshness.mjs 的 VERIFY_REDO）。不给 Edit 让这一招
// 从一次小编辑变回整份重写——这是**摩擦，不是屏障**：Write 读一遍再整份写回照样做得到，持 Bash 的 at-qa 一行 >> 也
// 做得到；主会话角色（at-pm，S8 的产者）要用 Edit 追加契约修订块、改 state.json，豁免。所以它对 at-acceptance 是一层摩擦
// （只能整份写回），对 at-qa 更弱（一行 >>）；「只补一句」门禁认不出，只靠正文的要求。主会话角色从 settings.json 剥前缀取，
// 不写字面量。
const STAGES = JSON.parse(readFileSync(join(ROOT, 'stages.json'), 'utf8'))
const SETTINGS = JSON.parse(readFileSync(join(ROOT, 'settings.json'), 'utf8'))
const MAIN_ROLE = stripPluginPrefix(SETTINGS.agent)
const VERIFY_PRODUCERS = [
  ...new Set(Object.values(STAGES).filter((s) => isVerifyStage(s)).flatMap((s) => stageRoles(s))),
].filter((r) => r !== MAIN_ROLE)

test('M4b 前置：验证段里除主会话角色外的产者不为空，每个都有一份 agents/*.md', () => {
  assert.ok(MAIN_ROLE && AGENT_FILES.includes(`${MAIN_ROLE}.md`), `settings.json 的 agent 剥前缀后是 ${JSON.stringify(MAIN_ROLE)}`)
  assert.ok(VERIFY_PRODUCERS.length > 0, '验证段的产者算出来是空集——下面那条判据在空转')
  for (const r of VERIFY_PRODUCERS) assert.ok(AGENT_FILES.includes(`${r}.md`), r)
})

test('M4b 验证段的产者（主会话角色除外）不持 Edit——返工轮里它们的产物整份重出', () => {
  for (const r of VERIFY_PRODUCERS) {
    assert.ok(
      !declarationOf(`${r}.md`).names.includes('Edit'),
      `${r} 是验证段的产者，tools: 里却有 Edit。它的产物返工时要整份重新出，门禁只按 sha 判、认不出「末尾补一句」；` +
        '不给 Edit 是摩擦，不是屏障（Write 照样能整份写回、持 Bash 的还能 >>），别把它写成「挡住了」。真要给，先改 docs/36 的裁定。',
    )
  }
})

// 正文的理由跟着工具清单走：验证段的产者（主会话除外）正文里要有一句把「没有 Edit」与「整份重写」连在一起；at-qa 原来那句
// 「你也没有 Edit，是同一个理由」（同一个理由＝不新增代码文件）的前提不成立——Write 能整份覆盖已有文件，H3 对两者同一个
// matcher（docs/11 §5.14 的收口）。「不新增代码文件」本身照旧，钉住它。
test('M4b 验证段的产者（主会话除外）正文写明没有 Edit 是因为整份重写；at-qa 不再说「是同一个理由」，「不新增代码文件」照旧', () => {
  for (const r of VERIFY_PRODUCERS) {
    const body = readFileSync(join(AGENTS_DIR, `${r}.md`), 'utf8').replace(/\r\n/g, '\n')
    const paras = body.split(/\n\s*\n/)
    assert.ok(
      paras.some((p) => /没有 `Edit`/.test(p) && p.includes('整份')),
      `agents/${r}.md 里没有一段同时写着「没有 \`Edit\`」与「整份」`,
    )
  }
  const qa = readFileSync(join(AGENTS_DIR, 'at-qa.md'), 'utf8')
  assert.ok(!qa.includes('是同一个理由'), 'at-qa.md 还在说「你也没有 Edit，是同一个理由」')
  assert.ok(qa.includes('不新增代码文件'), 'at-qa.md 的「不新增代码文件」不见了')
})
