// U7 实测（docs/06-U7-实测结论.md）证明：context: fork 的 skill 能用 agent:
// 参数直接起一个 subagent，全程不经过 Agent 工具，H1 派发门禁（挂在
// PreToolUse / matcher ^Agent$ 上）看不见这次调用——目标角色若在花名册白名单
// （宇宙）内，fork 直接拿到它的真实定义，绕过整套派发门禁。规格 §6.1 定的
// 主防线是不给角色 Skill 这个工具、且本插件自带的 skill 一律不声明
// context: fork。这两条测试把这条防线钉死，不依赖任何人记得住这条规则。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AGENTS_DIR = join(ROOT, 'agents')
const SKILLS_DIR = join(ROOT, 'skills')

// 与 hooks/lib/frontmatter.mjs 的 parseAgentAllowlist 同一种行扫描手法：找
// 以 tools: 开头的那一行。但那个函数只挖 Agent(...) 括号里的类型列表，挖不出
// 整条 tools: 行——这里要查的是"整行里有没有 Skill 这个词"，不是 Agent 白
// 名单的内容，parseAgentAllowlist 帮不上忙。不改 frontmatter.mjs：它是生产
// 代码，当前唯一消费者是 tests/roster-sync.test.mjs，不该为这份新测试扩出一
// 个用不到第二次的导出。
function toolsLineOf(md) {
  const line = md.split(/\r?\n/).find((l) => /^tools:/.test(l.trim()))
  return line ?? ''
}

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

test('没有任何角色的 tools: 包含 Skill', () => {
  const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))
  assert.ok(
    agentFiles.length > 0,
    'agents/ 目录下一个 .md 都没找到——这条测试没有实际检查任何东西',
  )

  for (const file of agentFiles) {
    const md = readFileSync(join(AGENTS_DIR, file), 'utf8')
    const toolsLine = toolsLineOf(md)
    assert.ok(
      !/\bSkill\b/.test(toolsLine),
      `agents/${file} 的 tools: 行里出现了 Skill（${JSON.stringify(toolsLine)}）。` +
        'context: fork 的 skill 能用 agent: 参数绕过 Agent 工具直接起一个 ' +
        'subagent，H1 派发门禁看不到这次调用，会直接拿到目标角色的真实定义' +
        '（U7 实测，见 docs/06-U7-实测结论.md）。而且主线程 agent 的 tools: ' +
        '会把整个工具面传导给整棵子树（同一份实测里 "Skill is disabled for ' +
        'this session, in subagents as well as here" 就是证据）——给任何一个 ' +
        '角色开这个口子，等于给它派生出的整棵子树都开了口子。',
    )
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
