// Task 10a：实现者在人工走读 Task 9 时带回来的范围外发现，控制方核实属实——
// agents/at-pm.md 的 tools: 行没有 AskUserQuestion，而 commands/at.md 第 4 节
// 把它定为五类强制升级条件唯一的打断出口；commands/at-status.md、
// commands/at-resume.md 又都指示 PM 用 Glob 去磁盘核实产物。规格自己早就写了
// （docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md §7 目录树
// 第 461 行、§3.1 机制映射表、§5.3、§9 测试策略第 4 条），只是没有传播到
// agents/at-pm.md 文件本身，也没有任何测试守住这件事。
//
// 这与 M1a ③ 是同一个形状：六个角色的工具面里一个 Write/Edit 都没有，判定逻辑
// 100% 正确、单元测试 100% 通过，而那道闸这辈子等不到一次可拦的调用。这次反过
// 来：命令正文写好了指令，执行它的工具却不在工具面里。
//
// 这条测试钉的不变量：commands/ 下每条命令正文里，明确以工具身份提到的每一个
// 工具，都必须出现在 agents/at-pm.md 的 tools: 行里。不满足就是同一类缺口的
// 重演——下次谁在 tools: 行漏掉一个命令正文用到的工具，这条测试要自己变红，
// 不依赖人工走读第二次撞见它。
//
// 放在独立文件而不是 tests/commands.test.mjs 的理由：commands.test.mjs 现有
// 的测试全部是"commands/ 正文引用的东西是否存在于某个数据源"（roster.json 的
// 角色名、stages.json 的 produces、templates/state.json 的字段名），从未读过
// agents/at-pm.md。这条测试的断言对象反过来——是 agents/at-pm.md 的 tools: 行
// 是否覆盖了 commands/ 提出的要求，命令正文只是需求来源，跟 tests/roster-
// sync.test.mjs（断言对象也是 at-pm.md，需求来源是 roster.json 的
// can_delegate_to 并集）是同一种框架，跟 commands.test.mjs 的框架不是一路。
// 本仓库对 at-pm.md 的不同不变量本来就分文件放（tool-surface.test.mjs 守禁用
// 工具、roster-sync.test.mjs 守 Agent(...) 白名单），这条新不变量照此惯例
// 单独成文件。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { toolsDeclarationOf } from './helpers/agent-tools.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMMANDS_DIR = join(ROOT, 'commands')
const AT_PM_PATH = join(ROOT, 'agents', 'at-pm.md')

const FILES = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'))
const textOf = (f) => readFileSync(join(COMMANDS_DIR, f), 'utf8')

// tools: 的解析改用 tests/helpers/agent-tools.mjs，与 tests/tool-surface.test.mjs
// **共用同一份实现**（M1b 终审 C2）。此前两边各有一份逐字相同的行扫描，只取表头
// 那一行；本文件给自己补了下面「grantedTools.size > 0」的正向前置断言，
// tool-surface.test.mjs 没有——同一份知识的两份拷贝只改了一份，而没改的那一份
// 恰好是安全那一侧，一次合法的 YAML 块序列改写就能把规格 §6.1 的防线整体架空。
// 抽出来的完整理由（以及为什么是 tests/helpers/ 而不是 hooks/lib/frontmatter.mjs、
// 为什么这不算「两个测试文件互相 import」）写在那个 helper 的头部。

// 规格 §6.1 的三个工具（Skill、SendMessage、ListAgents）一律不授予任何角色
// ——Skill 的 context: fork 能绕过 H1 派发门禁，SendMessage/ListAgents 能跨
// 角色与跨会话触达——由 tests/tool-surface.test.mjs 强制：那份测试断言
// agents/*.md 的 tools: 行不得含这三个词。
//
// 这三个词必须从下面「核心不变量」实际用的候选集合里排除，否则会跟
// tool-surface.test.mjs 那条测试当场互相矛盾：命令正文里解释一句「不要用
// `Skill` 绕过门禁」本该是被鼓励写的话（规格 §6.1 为这条旁路整节论证，
// commands/at.md 第 5 节现在就在写同类的防护性说明）；如果本文件把这种解释
// 性提及也算作"命令要求 PM 使用 Skill"，就会断言"at-pm.md 的 tools: 行必须
// 加 Skill"，而 tool-surface.test.mjs 断言"绝不能加 Skill"——写那句解释的人
// 会被两条互相矛盾的红测试卡死，看不出该听谁的。
//
// 排除它们不会削弱本测试守的不变量：它守的是"命令让 PM 用的工具，PM 真的
// 有"，而这三个工具按设计任何角色都不该有，不存在"该给却没给"这种失败模式
// ——不给正是规格要的结果，不是本测试要抓的缺口。
//
// 这份排除清单与 tests/tool-surface.test.mjs 实际禁用的清单是同一份知识的两
// 份拷贝，靠下面「前置条件：FORBIDDEN_BY_SPEC 与 tool-surface.test.mjs……」
// 那条测试防止分叉——改这里务必确认那条测试仍然通过。
const FORBIDDEN_BY_SPEC = ['Skill', 'SendMessage', 'ListAgents']

// 候选工具名——显式清单，不是自动收集的。前 9 个是这个插件当前用到的工具
// 全集（见 agents/*.md 与 roster.json），多列的 Bash/Grep/NotebookEdit 是
// 防御性占位：命令正文目前不提，一旦哪天真的提了，这里不用跟着改判定逻辑，
// 只是它们此刻永远不会被命中。
//
// 后 3 个（Skill/SendMessage/ListAgents）故意也写进这份"原始候选清单"，
// 不是遗漏也不是矛盾——它们要先真的成为候选，才谈得上被下面的 .filter 摘掉；
// 如果一开始就不写进来，FORBIDDEN_BY_SPEC 的排除会是一句空话（摘掉一个本来
// 就不存在的东西，删掉 FORBIDDEN_BY_SPEC 里的名字也不会改变任何行为，排除
// 是否真的在起作用就没法用变异验证证明）。写进来再靠 .filter 摘掉，才能让
// "删掉 FORBIDDEN_BY_SPEC 里的一项 → 那个工具重新变成活跃候选 → 只要命令
// 正文提到它就会被判定要求授予"这条因果链是真的，可以被变异验证复现（Task
// 10a 第二轮报告记了这条验证）。
const CANDIDATE_TOOLS = [
  'Agent',
  'Read',
  'Glob',
  'Write',
  'Edit',
  'AskUserQuestion',
  'Bash',
  'Grep',
  'NotebookEdit',
  'Skill',
  'SendMessage',
  'ListAgents',
].filter((tool) => !FORBIDDEN_BY_SPEC.includes(tool))

// 判断某个候选工具名是不是「以工具的身份」出现在一段正文里：用 \b 词边界、
// 大小写敏感匹配（跟 tool-surface.test.mjs 判定禁用工具同一种手法）。这批
// 命令正文里，这几个词的精确大小写英文形式只会用来指真正的 Claude Code 工具
// ——角色名、参数名都是小写或连字符形式（`agent-team:at-product`、
// `subagent_type`），撞不上这个形状；`\bEdit\b` 也不会误中 `NotebookEdit`
// 内部的 `Edit`（两侧都是词字符，没有词边界）。
function mentionsTool(text, tool) {
  return new RegExp('\\b' + tool + '\\b').test(text)
}

function toolSetFromToolsText(text) {
  const set = new Set()
  for (const tool of CANDIDATE_TOOLS) {
    if (mentionsTool(text, tool)) set.add(tool)
  }
  return set
}

const atPmMd = readFileSync(AT_PM_PATH, 'utf8')
// text 是整条 tools: 声明的原文（块序列形式下含后面每一个 `- X` 行），不再只是
// 表头那一行——候选工具用 \b 词边界在这段原文上查，跟 Agent(...) 括号里的角色名
// 撞不上（那些是小写连字符形式）。
const atPmToolsText = toolsDeclarationOf(atPmMd).text
const grantedTools = toolSetFromToolsText(atPmToolsText)

test('前置条件：agents/at-pm.md 有 tools: 声明，且能从里面解出至少一个候选工具', () => {
  assert.notEqual(atPmToolsText, '', 'agents/at-pm.md 没有找到 tools: 声明——下面的对账没有基准')
  assert.ok(
    grantedTools.size > 0,
    `agents/at-pm.md 的 tools: 声明（${JSON.stringify(atPmToolsText)}）一个候选工具都没解出来，` +
      '下面的对账会在跟空集合比，永远全绿',
  )
})

test('前置条件：commands/ 正文里确实提到了候选清单里的工具——否则下面的闭包测试在空转', () => {
  const anyMention = FILES.some((f) => CANDIDATE_TOOLS.some((tool) => mentionsTool(textOf(f), tool)))
  assert.ok(
    anyMention,
    'commands/ 下没有任何文件提到 CANDIDATE_TOOLS 里的任何一个词——下面这条测试' +
      '一次都不会真正执行断言，通过是假的',
  )
})

// 规格 §6.1 的三个工具一律不授予任何角色，由 tests/tool-surface.test.mjs 的
// FORBIDDEN_TOOLS 强制。本文件的 FORBIDDEN_BY_SPEC 是同一份知识的第二份拷贝
// ——两边故意分开维护，不改 tool-surface.test.mjs（它是已经过评审的既有文
// 件），也不让两个测试文件之间产生 import 依赖（各自单独跑
// `node --test tests/xxx.test.mjs` 时都不需要先理解另一个文件的内部结构）。
// 代价是两份可能悄悄分叉——这条测试就是防分叉的唯一防线：把
// tests/tool-surface.test.mjs 的源码文本当数据读（不是当模块导入、不改动
// 它），从它的 FORBIDDEN_TOOLS 数组里抠出每个 `name: '...'`，跟本文件的
// FORBIDDEN_BY_SPEC 比集合是否相等。
function forbiddenToolNamesFromToolSurfaceTest() {
  const src = readFileSync(join(ROOT, 'tests', 'tool-surface.test.mjs'), 'utf8')
  return new Set([...src.matchAll(/\bname:\s*'([^']+)'/g)].map((m) => m[1]))
}

test('前置条件：本文件排除的 FORBIDDEN_BY_SPEC 与 tool-surface.test.mjs 实际禁用的工具是同一组名字——防两处静默分叉', () => {
  const there = forbiddenToolNamesFromToolSurfaceTest()
  assert.ok(
    there.size > 0,
    '从 tests/tool-surface.test.mjs 源码里一个 FORBIDDEN_TOOLS 的 name 都没抠出来' +
      '——那份文件的写法可能变了，本文件的解析手法失效了，不能拿空集合去对账',
  )
  assert.deepEqual(
    new Set(FORBIDDEN_BY_SPEC),
    there,
    `本文件 FORBIDDEN_BY_SPEC = ${JSON.stringify(FORBIDDEN_BY_SPEC)}，但 tests/` +
      `tool-surface.test.mjs 实际禁用的是 ${JSON.stringify([...there])}——两处` +
      '维护同一份知识的两份拷贝分叉了，其中一处需要更新',
  )
})

// 核心不变量：同一种断言形状（某工具是否在 grantedTools 里）遍历「命令文件 ×
// 候选工具」这些互不耦合的数据点——按 tool-surface.test.mjs 的先例共用一个
// test()。任何一次真实回归（漏授一个工具）只会牵连提到那个工具的那些文件，
// 不会波及其它文件对其它工具的判断，互相不遮蔽。
test('commands/ 每条命令正文里以工具身份提到的每个工具，都在 agents/at-pm.md 的 tools: 行里', () => {
  for (const file of FILES) {
    const text = textOf(file)
    for (const tool of CANDIDATE_TOOLS) {
      if (!mentionsTool(text, tool)) continue
      assert.ok(
        grantedTools.has(tool),
        `commands/${file} 提到了工具 ${tool}，但 agents/at-pm.md 的 tools: 行` +
          `（${JSON.stringify(atPmToolsText)}）里没有它。主线程 agent 的 tools: 行` +
          '是整个会话的能力上界，被所有子孙代理继承——不在这一行里的工具，命令' +
          '正文写的指令这辈子调不出来（错误形如 "X is disabled for this ' +
          'session, in subagents as well as here"）。',
      )
    }
  }
})
