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
// ——skills/ 在本仓库当前根本不存在（规格 §7 的 skills/ 要到 M1 及以后才
// 落地），这是预期状态，不是异常。
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

// 正向前置断言，单独占一个 test()。为什么必须独立：它一旦失败（解析手法失效、
// 或某个角色根本没有 tools: 声明），排在它后面的那些否定断言会在同一个 test()
// 里被 assert 抛出直接挡住——而那正是 C2 的失效形状：否定断言对着一个空字符串
// 天然全部成立，「全绿」什么都不证明。先例是 tests/command-tool-closure.test.mjs
// 的「前置条件：agents/at-pm.md 有 tools: 行，且能从里面解出至少一个候选工具」
// ——那条知识本轮才回灌到安全这一侧。
test('前置条件：agents/ 下每个 .md 都解得出至少一个工具名——否则下面的否定断言在对空集合空转', () => {
  assert.ok(
    AGENT_FILES.length > 0,
    'agents/ 目录下一个 .md 都没找到——下面那条测试没有实际检查任何东西',
  )
  for (const file of AGENT_FILES) {
    const { text, names } = declarationOf(file)
    assert.ok(
      names.length > 0,
      `agents/${file} 的 frontmatter 里没有解出任何工具名（tools: 声明原文为 ` +
        `${JSON.stringify(text)}）。要么这个角色真的没有 tools: 声明，要么它用了一种 ` +
        'tests/helpers/agent-tools.mjs 还不认识的 YAML 写法——两种情况下，下面那条' +
        '「不得出现 Skill / SendMessage / ListAgents」的否定断言都是在对着空文本做，' +
        '恒真、什么都不证明（M1b 终审 C2 的成因）。',
    )
  }
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
          '而且主线程 agent 的 tools: 会把整个工具面传导给整棵子树（U7 实测里 ' +
          '"Skill is disabled for this session, in subagents as well as ' +
          'here" 就是证据）——给任何一个角色开这个口子，等于给它派生出的整棵 ' +
          '子树都开了口子。规格 §6.1：角色工具面是按需白名单，这三个工具一律 ' +
          '不授予。',
      )
    }
  }
})

test('本插件自带的 skills/**/SKILL.md 不声明 context: fork（当前 0 个也算通过）', () => {
  const skillFiles = findFilesNamed(SKILLS_DIR, 'SKILL.md')

  // 不对数量做断言：skills/ 目录当前在本仓库不存在（规格 §7 的 skills/ 是
  // M1 及以后才落地的目录），findFilesNamed 对不存在的目录返回空数组，下面
  // 的循环零次迭代、测试直接通过——这是预期状态，"有几个测几个，零个也通
  // 过"，不代表这条防线没在守。
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
