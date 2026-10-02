// hooks/hooks.json 里的检查名（"delegation"）与 hooks/gate.mjs 里 CHECK === 'delegation'
// 的判断是同一个字面量的两处硬编码，此前没有任何测试对账过。两者一旦漂移
// （改名漏改一处、手滑打错字），gate.mjs 对未知检查名会零输出、exit 0——
// 这与插件改名导致 plugin-name-sync 测试崩红是同一类失效，但方向更糟：
// 那边吵闹（一律拒绝，立刻发现），这边安静（一律放行，永远发现不了）。
// 这份测试就是守住 hooks.json 与 gate.mjs 之间的这条隐性契约。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { CHECKS, KNOWN_CHECKS } from '../hooks/lib/checks.mjs'
import { REMINDER_EVENT, REMINDER_TEXT, REMINDER_COMMAND } from '../hooks/lib/gate-check.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const hooksConfig = JSON.parse(
  readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'),
)

function findAgentEntry() {
  return hooksConfig.hooks?.PreToolUse?.find((e) => e.matcher === '^Agent$')
}

test('PreToolUse 钩子数组存在且非空', () => {
  assert.ok(Array.isArray(hooksConfig.hooks?.PreToolUse), 'hooks.json 缺少 PreToolUse 数组')
  assert.ok(hooksConfig.hooks.PreToolUse.length > 0, 'PreToolUse 数组是空的')
})

test('存在一项 matcher 精确锚定为 "^Agent$"', () => {
  assert.ok(
    findAgentEntry(),
    'hooks.json 的 PreToolUse matcher 必须是锚定的 "^Agent$"；未锚定的 "Agent" ' +
      '会误配将来任何名字里含 Agent 的工具，而那种调用没有 subagent_type，' +
      '会被「未指定 subagent_type」那条拒掉——fail closed 在错误的地方，理由也文不对题',
  )
})

test('该项的 hook 是 exec 形式：command 为 node，且带 args 数组', () => {
  const entry = findAgentEntry()
  assert.ok(entry, 'hooks.json 里找不到 matcher 精确为 "^Agent$" 的注册项（见上一条测试）')
  const hook = entry.hooks[0]
  assert.equal(hook.type, 'command')
  assert.equal(hook.command, 'node')
  assert.ok(Array.isArray(hook.args), 'hook.args 不是数组')
})

test('args[0] 把 ${CLAUDE_PLUGIN_ROOT} 替换成仓库根之后指向真实存在的文件', () => {
  const entry = findAgentEntry()
  assert.ok(entry, 'hooks.json 里找不到 matcher 精确为 "^Agent$" 的注册项（见上一条测试）')
  const hook = entry.hooks[0]
  const resolved = hook.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)
  assert.ok(
    existsSync(resolved),
    `${resolved} 不存在——hooks.json 里写的路径与仓库里的实际文件已经漂移`,
  )
})

test('args[1] 是 gate.mjs 的 KNOWN_CHECKS 认得的检查名', () => {
  const entry = findAgentEntry()
  assert.ok(entry, 'hooks.json 里找不到 matcher 精确为 "^Agent$" 的注册项（见上一条测试）')
  const hook = entry.hooks[0]
  assert.ok(
    KNOWN_CHECKS.has(hook.args[1]),
    `hooks.json 注册的检查名 ${JSON.stringify(hook.args[1])} 不在 gate.mjs 的 ` +
      `KNOWN_CHECKS 里——两处已经漂移，gate.mjs 会对这个检查项一律 deny` +
      `（未知检查名现在 fail closed，但注册漂移本身仍是需要修的配置错误）`,
  )
})

// 上面几条只校验「存在一项 matcher 精确为 ^Agent$」，从不检查 hooks.json 里
// 其它注册项——往数组里再塞一条伪造条目（哪怕 command 是 bash、args 指向
// 不存在的文件），其它既有测试照样全绿。这条不变量对*每一个*注册项都成立，
// 但刻意不要求「每一项 matcher 都必须是 ^Agent$」：writepath（H3）、contract
// （H4）迟早会注册在 Edit|Write|NotebookEdit 这组 matcher 上——那样写的话
// 这条测试必错。writepath 本来在 Task 1 就注册，评审时撤回并挪到了 Task 4
// （判定逻辑落地的那一步）：判定逻辑不在就注册，等于提前打开一条「读不到
// stdin 就拒绝真实 Edit/Write」的 fail-closed 路径。
// 门禁自检的提醒（M3t，docs/28）不是检查项：它故意不走 node，所以单列，不进下面这些判据；
// 它自己的判据在本文件末尾。认它按事件与逐字的命令，不按「长得像」。
const isReminder = (event, hook) => event === REMINDER_EVENT && hook?.command === REMINDER_COMMAND

function allHookCommands() {
  return Object.entries(hooksConfig.hooks ?? {}).flatMap(([event, groups]) =>
    groups.flatMap((group) => (group.hooks ?? []).filter((hook) => !isReminder(event, hook))),
  )
}

test('hooks.json 里每一道门禁的注册（自检提醒除外）都是 node 调用、参数完整、指向真实文件与已知检查名', () => {
  const commands = allHookCommands()
  assert.ok(commands.length > 0, 'hooks.json 里一个 hook 命令都没有')
  for (const hook of commands) {
    const label = JSON.stringify(hook)
    assert.equal(hook.type, 'command', `${label} 的 type 不是 "command"`)
    assert.equal(
      hook.command,
      'node',
      `${label} 的 command 不是 "node"——门禁一律走 node 起 boot.mjs；若这条是自检提醒，先核它与 gate-check.mjs 的 REMINDER_COMMAND 是否逐字一致`,
    )
    assert.ok(
      Array.isArray(hook.args) && hook.args.length > 0,
      `${label} 缺少非空的 args 数组`,
    )
    const resolved = hook.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)
    assert.ok(
      existsSync(resolved),
      `${label} 的 args[0]（解析后为 ${resolved}）不存在——与仓库里的实际文件已经漂移`,
    )
    assert.ok(
      KNOWN_CHECKS.has(hook.args[1]),
      `${label} 的 args[1]（检查名 ${JSON.stringify(hook.args[1])}）不在 gate.mjs 的 KNOWN_CHECKS 里`,
    )
  }
})

// 上面那条只查一个方向：hooks.json 里注册的每一项都得是已知检查名。反方向此前
// 没有任何测试守——KNOWN_CHECKS 里的一个检查名从 hooks.json 里被整条删掉，
// gate.mjs 会一律对它「未知检查项」但那是另一码事：真正的失效是这个检查项自此
// 再也不会被平台触发，而这份测试文件此前没有任何一条断言会因此变红（Task 6
// 变异验证第 1 项实测：删掉新加的 ledger 注册，`node --test` 全绿、pass 数字都不
// 变）。这条补上反方向：KNOWN_CHECKS 里的每个检查名，必须在 hooks.json 里至少
// 注册一次（args[1] 命中），否则这个检查项形同虚设——写了判定逻辑、写了纯函数
// 测试、写了子进程测试，但平台永远不会调用它。
test('KNOWN_CHECKS 里的每一个检查名都在 hooks.json 里至少注册了一次', () => {
  const registered = new Set(allHookCommands().map((hook) => hook.args?.[1]))
  for (const name of KNOWN_CHECKS) {
    assert.ok(
      registered.has(name),
      `检查名 ${JSON.stringify(name)} 在 checks.mjs 的 KNOWN_CHECKS 里，但 hooks.json 里没有` +
        `任何一条 hook 命令的 args[1] 是它——这个检查项写了判定逻辑也测过，但平台永远不会触发它。`,
    )
  }
})

// 终审修复轮复评：本轮把「任何持有 Bash 的角色都写得了 artifacts」写进了 hooks/gate.mjs
// 的运行时文案、hooks/lib/artifact-drift.mjs 头部、三份角色正文（at-pm/at-backend/
// at-frontend）与两份规格文档——这句话的承重事实是「hooks.json 没有任何 matcher 覆盖
// Bash」（见 hooks/lib/writepath.mjs 头部「这道闸只管 Edit/Write/NotebookEdit」），但
// 这件事本身，全仓库零测试：上面几条只查「注册项指向的文件/检查名对不对」，从不检查
// matcher 的**内容**能匹配到哪些工具名。按发现 3 用的同一条标准（「模块知道这两份拷贝
// 存在，却没有东西保证它们同步」），这句被多处文案依赖的事实也该有一份同样的机械保证：
// 哪天有人往 PreToolUse/PostToolUse 加了一条能匹配 Bash 的 matcher（哪怕是手滑，比如把
// "^(Edit|Write|NotebookEdit)$" 写成不锚定的 "Edit|Write|NotebookEdit|Bash"），那些文案
// 会当场变成错的，而不会有任何机械信号——这条测试补上那个信号。
//
// 只查 PreToolUse 与 PostToolUse：SubagentStop 是生命周期事件，不按 tool_name 匹配，
// 这条判据不适用于它。
//
// 用 new RegExp(matcher) 而不是字符串比较：matcher 是正则源码，"^Bash$" 与
// "^(Edit|Write|Bash)$" 都该被抓到，纯子串检查抓不住后者。matcher 缺失（undefined）
// 时 new RegExp(undefined) 等价于 new RegExp('')——匹配一切字符串，包括 "Bash"，这正是
// 语义上该有的结果：没有 matcher 等于不筛选、匹配一切工具调用，自然也包括 Bash，不需要
// 额外一条防御性断言去单独判「matcher 是不是非空字符串」。
function preAndPostToolUseMatchers() {
  const pre = hooksConfig.hooks?.PreToolUse ?? []
  const post = hooksConfig.hooks?.PostToolUse ?? []
  return [...pre, ...post].map((entry) => entry.matcher)
}

test('前置条件：hooks.json 里 PreToolUse/PostToolUse 合起来确实有 matcher 可查——否则下面那条在空转', () => {
  assert.ok(
    preAndPostToolUseMatchers().length > 0,
    'hooks.json 的 PreToolUse 与 PostToolUse 合起来一个注册项都没有',
  )
})

test('hooks.json 的 PreToolUse/PostToolUse 没有任何 matcher 能匹配到 "Bash"——这是「Bash 不经任何 hook」这句话（写在多处文案里）的承重事实', () => {
  for (const matcher of preAndPostToolUseMatchers()) {
    assert.ok(
      !new RegExp(matcher).test('Bash'),
      `matcher ${JSON.stringify(matcher)} 匹配得到 "Bash"——hooks/gate.mjs 的运行时文案、` +
        'hooks/lib/artifact-drift.mjs 头部、agents/at-pm.md、agents/at-backend.md、' +
        'agents/at-frontend.md，以及主规格 §6.2 与 M1c 设计 §1.2 都在说「Bash 不经任何 ' +
        'hook」，这句话现在不成立了，需要一起改，而且这件事本身说明写路径隔离/账本比对' +
        '现在真的会挡到 Bash 调用，是一次影响面很大的行为变化，不只是文案过时。',
    )
  }
})

// ---------------------------------------------------------------------------
// 接线判据（M3p，docs/24 §2.4，全量审查第 11 条）
// ---------------------------------------------------------------------------
//
// 上面各条只对账「注册项指向的文件与检查名对不对」，从不对账**挂在哪个事件上、matcher
// 放进来哪些工具**。审查时的变异：把 H3/H4/H6 那组 matcher 改成 "^(Edit|Write)$"、把
// stop-gate 挪到 Stop 事件上、把某一条注册删掉复制成两条——套件照样 910/910 全绿，而每
// 一刀都让一道门禁在真实会话里静默失效或重复触发。
//
// 下面把 checks.mjs 里每个检查项自己声明的契约（event、toolNames）当真源，逐条对账
// hooks.json：事件对得上、matcher 放进来的工具恰好是 toolNames、每个检查项只注册一次、
// 每条都经 boot.mjs 进门。

// matcher 在平台上是正则源码；判据用 new RegExp(matcher) 对一个工具名宇宙逐个试。
// 宇宙 = 各检查项声明的工具 + 平台的其它工具 + 几个「差一点就对」的名字——后者专抓
// 不锚定的 matcher（"Edit|Write" 会放进 MultiEdit、EditX）。
const DECLARED_TOOLS = [...new Set(Object.values(CHECKS).flatMap((s) => s.toolNames ?? []))]
const OTHER_TOOLS = [
  'Bash', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'Skill',
  'AskUserQuestion', 'SendMessage', 'ListAgents', 'Task', 'MultiEdit', 'NotebookRead',
]
const NEAR_MISS = ['Agents', 'SubAgent', 'AgentX', 'XEdit', 'EditX', 'Writer', 'NotebookEditX', 'xWrite']
// 去重（M3z）：AskUserQuestion 既是 approval-ask 声明的工具、又在 OTHER_TOOLS 里，不去重时同一个名字会被数两遍。
const TOOL_UNIVERSE = [...new Set([...DECLARED_TOOLS, ...OTHER_TOOLS, ...NEAR_MISS])]

// 每一条注册展开成 { event, matcher, check, entry }。
function registrations() {
  const out = []
  for (const [event, groups] of Object.entries(hooksConfig.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        if (isReminder(event, hook)) continue
        out.push({ event, matcher: group.matcher, check: hook.args?.[1], entry: hook.args?.[0] })
      }
    }
  }
  return out
}

test('接线前置：展开出来的注册项覆盖了 checks.mjs 的每一个检查项——下面几条不是对空集合说话', () => {
  const seen = new Set(registrations().map((r) => r.check))
  assert.deepEqual([...seen].sort(), Object.keys(CHECKS).sort())
})

test('接线：每个检查项挂在它自己声明的 hook 事件上', () => {
  for (const r of registrations()) {
    assert.equal(
      r.event,
      CHECKS[r.check]?.event,
      `${r.check} 注册在 ${r.event} 上，而 checks.mjs 声明它是 ${CHECKS[r.check]?.event} 的检查项——` +
        '挂错事件时平台要么永远不触发它，要么送来它读不懂的输入形状',
    )
  }
})

test('接线：工具事件上的 matcher 放进来的工具恰好是该检查项声明的 toolNames', () => {
  for (const r of registrations()) {
    const declared = CHECKS[r.check]?.toolNames
    if (declared === null || declared === undefined) continue
    const matched = TOOL_UNIVERSE.filter((t) => new RegExp(r.matcher ?? '').test(t))
    assert.deepEqual(
      matched.sort(),
      [...declared].sort(),
      `${r.check} 的 matcher ${JSON.stringify(r.matcher)} 放进来的是 ${JSON.stringify(matched)}，` +
        `checks.mjs 声明的是 ${JSON.stringify(declared)}。少了的那个工具从此不经这道门禁；` +
        '多了的那个会送来这道门禁不认得的调用（gate.mjs 对不认得的 tool_name 静默放行）',
    )
  }
})

test('接线：生命周期事件上的检查项（toolNames 为 null）不带 matcher——它要看见每一次事件', () => {
  for (const r of registrations()) {
    if (CHECKS[r.check]?.toolNames !== null) continue
    assert.equal(
      r.matcher,
      undefined,
      `${r.check} 注册时带了 matcher ${JSON.stringify(r.matcher)}；它按角色自己判该不该管，` +
        'matcher 只会让一部分子代理收尾静默绕过它',
    )
  }
})

test('接线：每个检查项恰好注册一次', () => {
  const counts = {}
  for (const r of registrations()) counts[r.check] = (counts[r.check] ?? 0) + 1
  for (const [check, n] of Object.entries(counts)) {
    assert.equal(n, 1, `${check} 注册了 ${n} 次——同一次工具调用会被判两遍，账本回传也会发两遍`)
  }
})

test('接线：每一道门禁都经 hooks/boot.mjs 进门，不直接跑 gate.mjs', () => {
  for (const r of registrations()) {
    assert.equal(
      r.entry,
      '${CLAUDE_PLUGIN_ROOT}/hooks/boot.mjs',
      `${r.check} 的入口是 ${r.entry}。直接跑 gate.mjs 时，任何一个 lib 加载失败都会让进程 ` +
        'exit 1 放行——fail closed 的门禁整体消失（docs/24 §2.2）；boot.mjs 是接住这类失败的那一层',
    )
  }
})

// ---- 门禁自检的提醒（M3t，docs/28，全量审查第 4 条）----
//
// 门禁起不来时平台一律放行、PM 看不见。门禁自检（agents/at-pm.md）能查出来，但得有人记得做：续会话
// 之后用户直接说「继续」、压缩之后接着跑，都不经过任何命令。这条 UserPromptSubmit hook 每轮往上下文里
// 放一句提醒，让 PM 在这一轮第一次派发或写 .agent-team 之前自检。它故意不走 node——要在 node 缺失、
// Claude Code 太旧（丢掉 args）时照样出现，所以是 shell 形式的一行 echo：纯 ASCII（Windows 没有 Git Bash
// 时退到 PowerShell 5.1，中文会乱码），整句单引号（bash 与 PowerShell 里都是字面量）。

// M3z（docs/34）：UserPromptSubmit 上多了一道门禁（approval-prompt，经 boot.mjs 进门，由上面的接线判据管）。提醒按「不走 node」
// 认——它要恰好一条、逐字等于 REMINDER_COMMAND；混进第二条不走 node 的，这里当场红。
function reminderEntries() {
  return (hooksConfig.hooks?.[REMINDER_EVENT] ?? [])
    .flatMap((g) => (g.hooks ?? []).map((hook) => ({ group: g, hook })))
    .filter(({ hook }) => hook.command !== 'node')
}

test('自检提醒：UserPromptSubmit 上不走 node 的恰好这一条，逐字等于 gate-check.mjs 的 REMINDER_COMMAND', () => {
  // 事件名钉成字面量，不经常量自证：提醒要每轮紧挨着用户消息出现。SessionStart 只在会话开头注入一次，
  // 续会话时同样的文本不再注入——恰好丢掉要补的那条路（docs/28 §2.2）。
  assert.equal(REMINDER_EVENT, 'UserPromptSubmit')
  assert.ok(Array.isArray(hooksConfig.hooks.UserPromptSubmit), 'hooks.json 里没有 UserPromptSubmit')
  const entries = reminderEntries()
  assert.equal(entries.length, 1, JSON.stringify(entries))
  assert.equal(entries[0].hook.type, 'command')
  assert.equal(entries[0].hook.command, REMINDER_COMMAND)
  assert.equal(entries[0].group.matcher, undefined, 'UserPromptSubmit 没有 matcher 可言')
})

test('自检提醒：shell 形式、不带 args、不调 node——它要在门禁起不来的时候照样出现', () => {
  const { hook } = reminderEntries()[0]
  assert.equal(hook.args, undefined, '带了 args 就成了 exec 形式：CLI 早于 2.1.139 时整条退化')
  // 多一个键就改了平台怎么跑它：shell 换了解释器（找不到那个 shell 时起不来、静默消失），once 只跑第一轮，
  // async 不进上下文。
  assert.deepEqual(Object.keys(hook).sort(), ['command', 'timeout', 'type'])
  assert.doesNotMatch(hook.command, /\bnode\b/)
  assert.ok(hook.command.startsWith("echo '") && hook.command.endsWith("'"), hook.command)
})

test('自检提醒：文字纯 ASCII、不含单引号——PowerShell 5.1 输出中文会乱码，单引号会提前闭合', () => {
  assert.match(REMINDER_TEXT, /^[\x20-\x7e]+$/)
  assert.ok(!REMINDER_TEXT.includes("'"), REMINDER_TEXT)
  assert.ok(REMINDER_TEXT.startsWith('agent-team reminder:'), REMINDER_TEXT)
})

// 两半都承重：复核实测，续会话、门禁离线时原文 6/6 重做自检；只删「去做自检」那半句 4/6，整段删光 3/6。
// 上限（docs/16 §3）：认不出「do not run the gate self-check」这类说反话的改写，关键词都还在；要答案改变，
// 得能在 CI 里用真实会话核 PM 的行为。
test('自检提醒：说了什么时候、做什么、更早的结果不算数', () => {
  assert.match(REMINDER_TEXT, /before the first Agent dispatch or the first write under \.agent-team in this turn/)
  assert.match(REMINDER_TEXT, /\bgate self-check\b/)
  assert.match(REMINDER_TEXT, /\brole file\b/)
  assert.match(REMINDER_TEXT, /Earlier results do not count/)
})

// 按平台的实际选择去跑：Windows 上找得到 Git Bash 用 bash，找不到退到 PowerShell（从不用 cmd.exe，
// 单引号在 cmd.exe 里是字面字符）；两个都在就两个都跑。macOS / Linux 用 sh。这张表只对条目不写 shell
// 键时成立（上面那条键集判据钉着）。
const SHELLS = process.platform === 'win32'
  ? [['C:/Program Files/Git/bin/bash.exe', ['-c']], ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command']]]
  : [['sh', ['-c']]]

test('自检提醒：平台会用的每一种 shell 都把它原样打出来', () => {
  let ran = 0
  for (const [shell, pre] of SHELLS) {
    const out = spawnSync(shell, [...pre, REMINDER_COMMAND], { encoding: 'utf8' })
    if (out.error?.code === 'ENOENT') continue
    ran++
    assert.equal(out.status, 0, `${shell}：${out.stderr}`)
    assert.equal(out.stdout.trim(), REMINDER_TEXT, shell)
  }
  assert.ok(ran > 0, '一种 shell 都没找到——这条判据什么都没测')
})
