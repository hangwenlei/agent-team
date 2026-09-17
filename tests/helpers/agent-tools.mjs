// agent / command markdown 的 `tools:` 声明 —— 解析成「原文 + 工具名集合」。
//
// 为什么这份实现在这里而不是在两个测试文件里各写一份（M1b 终审 C2）：
//
// tests/tool-surface.test.mjs 与 tests/command-tool-closure.test.mjs 此前各有一份
// 逐字相同的行扫描（`.find(l => /^tools:/.test(l.trim()))`，只取表头那一行）。
// 后者给自己补了一条「解出的工具集合非空」的正向前置断言，前者没有——同一份知识
// 的两份拷贝只改了一份，而没改的那一份恰好是安全那一侧。代价实测过：把
// agents/at-backend.md 的 `tools:` 改写成合法的 YAML 块序列
//
//     tools:
//       - Skill
//       - SendMessage
//       - ListAgents
//
// 之后 `node --test` 仍然 304 pass / 0 fail —— 规格 §6.1 禁授的三个工具（U7 实测
// 证出 Skill 能绕过 H1 派发门禁）全部授予了一个角色，零测试变红。
//
// 这正是 hooks/lib/path-norm.mjs 头部记的那条教训：两份逐字相同的 norm() 真的
// 分叉过，结论是抽成单一导出。「一个 tools: 声明长什么样」是同一类知识。
//
// 放在 tests/helpers/ 而不是 hooks/lib/frontmatter.mjs：
//   - frontmatter.mjs 是**生产代码**，当前唯一消费者是 tests/roster-sync.test.mjs，
//     它只挖 Agent(...) 括号里的类型列表，不解整条声明。为一份只有测试要用的解析
//     扩它的导出面，是往运行时代码里加没有运行时消费者的东西——这条判断两个测试
//     文件的注释里都已经写过一次，本轮不推翻它。
//   - tests/helpers/gate-runner.mjs 是本仓库现成的先例：两份独立的子进程驱动拷贝
//     开始漂移之后抽成了这里的一个 helper。
//   - 它也不违反 command-tool-closure.test.mjs 记下的那条顾虑（「不让两个测试文件
//     之间产生 import 依赖，各自单独跑时都不需要先理解另一个文件的内部结构」）：
//     两边 import 的是这个 helper，不是对方。
//
// ⚠️ 本文件不管「哪些工具该授 / 不该授」——那是两个测试各自的判据，不是同一份
// 知识（禁授清单的防分叉另有一条测试，从 tool-surface.test.mjs 的源码里把
// FORBIDDEN_TOOLS 的 name 抠出来对账）。这里只回答「这份文件声明了什么」。

// frontmatter 的正文行（首尾两条 `---` 之间）。没有 frontmatter 时返回空数组。
// 只在 frontmatter 里找 tools:，正文里偶然以 tools: 开头的一行不算声明。
function frontmatterLines(md) {
  const lines = md.split(/\r?\n/)
  if (!/^---\s*$/.test(lines[0] ?? '')) return []
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) return lines.slice(1, i)
  }
  return []
}

// 按顶层逗号切，括号里的逗号不算——`Agent(a, b), Read` 是两项，不是三项。
function splitTopLevel(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

// 一项的工具名：去掉引号，取 `(` 之前的部分。`Agent(agent-team:at-product, …)`
// 的名字是 `Agent`，括号里的角色名不是工具名。
function toolNameOf(item) {
  return item
    .trim()
    .replace(/^["']|["']$/g, '')
    .split('(')[0]
    .trim()
}

/**
 * 解析一份 markdown 的 tools: 声明。
 *
 * 返回 { text, names }：
 *   text  —— 这条声明的**全部原文**（表头行，加上块序列形式下跟在它后面的每一个
 *            `- X` 行）。查「整条声明里有没有出现某个词」用它。C2 的成因就是这里
 *            此前只有表头一行。
 *   names —— 解出的工具名数组，顺序与声明一致。用来做「非空」这类正向前置断言。
 *
 * 认三种写法（都是合法 YAML）：
 *   tools: A, B, C          行内
 *   tools: [A, B, C]        行内流式序列
 *   tools:                  块序列
 *     - A
 *     - B
 */
export function toolsDeclarationOf(md) {
  const lines = frontmatterLines(md)
  const i = lines.findIndex((l) => /^tools\s*:/.test(l))
  if (i === -1) return { text: '', names: [] }

  const head = lines[i]
  const collected = [head]
  let inline = head.replace(/^tools\s*:/, '').trim()
  const items = []

  if (!inline) {
    // 块序列：表头行没有值，值在后面缩进的 `- X` 行上。遇到第一条不是 `- X`
    // 的非空行就停——那已经是 frontmatter 的下一个键了。
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      const m = lines[j].match(/^\s+-\s*(.*)$/)
      if (!m) break
      collected.push(lines[j])
      items.push(m[1])
    }
  } else if (inline.startsWith('[') && inline.endsWith(']')) {
    inline = inline.slice(1, -1)
  }

  const chunks = inline ? [inline] : items
  const names = []
  for (const chunk of chunks) {
    for (const piece of splitTopLevel(chunk)) {
      const name = toolNameOf(piece)
      if (name) names.push(name)
    }
  }

  return { text: collected.join('\n'), names }
}
