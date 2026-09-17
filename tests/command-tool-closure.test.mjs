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

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMMANDS_DIR = join(ROOT, 'commands')
const AT_PM_PATH = join(ROOT, 'agents', 'at-pm.md')

const FILES = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'))
const textOf = (f) => readFileSync(join(COMMANDS_DIR, f), 'utf8')

// 与 tests/tool-surface.test.mjs 的 toolsLineOf(md) 同一种行扫描手法：只找以
// tools: 开头的那一行，不解析完整 YAML。hooks/lib/frontmatter.mjs 的
// parseAgentAllowlist 只挖 Agent(...) 括号里的类型列表，挖不出整条 tools: 行
// ——这里要的是整行本身，parseAgentAllowlist 帮不上忙。不改 frontmatter.mjs：
// 它是生产代码，当前唯一消费者是 tests/roster-sync.test.mjs，不该为这份新测试
// 扩出一个用不到第二次的导出（同一判断，tool-surface.test.mjs 的注释已经写过
// 一次，这里不重复论证，原样沿用手法）。
function toolsLineOf(md) {
  const line = md.split(/\r?\n/).find((l) => /^tools:/.test(l.trim()))
  return line ?? ''
}

// 候选工具名——显式清单，不是自动收集的。这个插件当前用到的工具全集恰好就是
// 这几个（见 agents/*.md 与 roster.json），多列的 Bash/Grep/NotebookEdit 是
// 防御性占位：命令正文目前不提，一旦哪天真的提了，这里不用跟着改判定逻辑，
// 只是它们此刻永远不会被命中。
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
]

// 判断某个候选工具名是不是「以工具的身份」出现在一段正文里：用 \b 词边界、
// 大小写敏感匹配（跟 tool-surface.test.mjs 判定禁用工具同一种手法）。这批
// 命令正文里，这几个词的精确大小写英文形式只会用来指真正的 Claude Code 工具
// ——角色名、参数名都是小写或连字符形式（`agent-team:at-product`、
// `subagent_type`），撞不上这个形状；`\bEdit\b` 也不会误中 `NotebookEdit`
// 内部的 `Edit`（两侧都是词字符，没有词边界）。
function mentionsTool(text, tool) {
  return new RegExp('\\b' + tool + '\\b').test(text)
}

function toolSetFromToolsLine(line) {
  const set = new Set()
  for (const tool of CANDIDATE_TOOLS) {
    if (mentionsTool(line, tool)) set.add(tool)
  }
  return set
}

const atPmMd = readFileSync(AT_PM_PATH, 'utf8')
const atPmToolsLine = toolsLineOf(atPmMd)
const grantedTools = toolSetFromToolsLine(atPmToolsLine)

test('前置条件：agents/at-pm.md 有 tools: 行，且能从里面解出至少一个候选工具', () => {
  assert.notEqual(atPmToolsLine, '', 'agents/at-pm.md 没有找到 tools: 行——下面的对账没有基准')
  assert.ok(
    grantedTools.size > 0,
    `agents/at-pm.md 的 tools: 行（${JSON.stringify(atPmToolsLine)}）一个候选工具都没解出来，` +
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
          `（${JSON.stringify(atPmToolsLine)}）里没有它。主线程 agent 的 tools: 行` +
          '是整个会话的能力上界，被所有子孙代理继承——不在这一行里的工具，命令' +
          '正文写的指令这辈子调不出来（错误形如 "X is disabled for this ' +
          'session, in subagents as well as here"）。',
      )
    }
  }
})
