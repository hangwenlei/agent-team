#!/usr/bin/env node
// 门禁的进程入口——hooks/hooks.json 里每一道门禁都跑这个文件（UserPromptSubmit 上那条自检提醒不是门禁，
// 故意不走 node）。判定全在 ./gate.mjs；
// 这里只做两件事，都是把「判定模块根本跑不起来」纳入 ./lib/checks.mjs 的失败策略表：
//
// 1. 加载失败（M3p，docs/24 §2.2）。gate.mjs 的静态 import 在 ESM 链接期解析：任何一个 lib
//    缺失、有语法错误、或在模块顶层抛错，都发生在 gate.mjs 自己那层 try/catch 建立之前——进程
//    exit 1、stdout 为空，平台把它当 non-blocking error、工具照常执行，声明 fail closed 的那几道
//    门禁就这样整体消失。动态 import 把这类失败变成一个接得住的 rejected promise。
//
// 2. Node 太旧（M3t，docs/28，全量审查第 4 条）。门禁代码要 Node MIN_NODE 起才跑得对：低于它时
//    gate.mjs 要么解析不了（同上，静默放行），要么能加载、却在运行时缺内建 API（H1 拒掉一切派发、
//    理由不提 Node，几道 fail open 的检查项静默崩掉；门禁自检还会报「在线」）。所以先查版本，
//    太旧就不去加载 gate.mjs，按失败策略表收尾，理由写明要哪个版本、门禁用的是哪个 node。
//
// ⚠️ 硬约束：
//   - 本文件的静态 import 只许内建模块（tests/boot.test.mjs 钉着）。它是「别的东西坏了」时唯一
//     还在跑的代码，自己不能再依赖任何可能坏掉的文件。
//   - 本文件要在很旧的 Node 上也能解析、跑到版本检查那一行（Node 12.17 起、13.2 起；CI 用真的旧
//     Node 跑，见 tests/boot-old-node.test.mjs）：不用顶层 await、?.、??、Object.hasOwn，内建模块
//     写 'fs' 不写 'node:fs'（node: 前缀在 ESM 里要 12.20 / 14.13.1）。
//
// gate.mjs 正常加载时这里什么都不做：gate.mjs 顶层直接跑 main()，自己读 stdin、写决策、退出。
// 走到下面 refuse() 的两条路上 stdin 都还没被读过，所以还能自己把 hook 输入读出来。

import { readFileSync } from 'fs'

// 门禁代码需要的最低 Node：技术下限——hooks/ 里版本最新的内建是 Object.hasOwn（16.9）。README 两半、
// agents/at-pm.md 的排查清单、CI 的最低版本作业都拿这一行比对（判据从本文件的源码文本里抠它），
// 改它要一起改。
const MIN_NODE = '16.9.0'

// 拼进拒绝理由的路径与版本号只许占一行（docs/27）：控制字符与几种 Unicode 行分隔符写成 \u 转义。
// 放在顶上：下面「Node 太旧」那一支在模块求值时同步执行，用到它时它必须已经初始化。
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f\\u0085\\u2028\\u2029]', 'g')

const CHECK = process.argv[2]
const HAVE = String(process.versions.node)

if (atLeast(HAVE, MIN_NODE)) {
  import('./gate.mjs').catch(function (err) {
    return refuse({
      stderrHead:
        'agent-team 门禁代码加载失败（检查项 ' + JSON.stringify(CHECK) + '）：\n' + ((err && err.stack) || err),
      denyReason:
        'agent-team 门禁代码加载失败（' + summarize(err) + '），无法判定这次调用，按安全边界拒绝。' +
        '插件安装可能不完整或已损坏：重装或更新 agent-team 插件后再试。',
      openNote: '检查项加载失败，本次放行、没有拦截（它是 fail open 的）。重装或更新 agent-team 插件。',
      recorderNote:
        '检查项加载失败，这次的回答记不下（批准记录器不拦任何东西）。重装或更新 agent-team 插件；' +
        '用户若是在批准再返工一轮或照现状交付，修好之后要再批准一次。',
    })
  })
} else {
  const which = '门禁用的 node 是 v' + oneLine(HAVE) + '（' + oneLine(process.execPath) + '）'
  refuse({
    stderrHead: 'agent-team 门禁需要 Node ' + MIN_NODE + ' 或更新，而' + which + '。',
    denyReason:
      'agent-team 门禁需要 Node ' + MIN_NODE + ' 或更新，而' + which + '——门禁代码跑不起来，按安全边界拒绝。' +
      '升级 Claude Code 启动时 PATH 上的 Node，装完重开 Claude Code；没法升级的话，卸载本插件。',
    openNote:
      '检查项没有运行（Node 太旧），本次放行、没有拦截（它是 fail open 的）。升级 Node 到 ' + MIN_NODE + ' 或更新。',
    recorderNote:
      '检查项没有运行（Node 太旧），这次的回答记不下（批准记录器不拦任何东西）。升级 Node 到 ' + MIN_NODE + ' 或更新；' +
      '用户若是在批准再返工一轮或照现状交付，升级之后要再批准一次。',
  })
}

// 按失败策略表收尾：fail closed 的输出拒绝；fail open 的放行，但 exit 1——让平台记一条 hook error，
// 而不是装作判过了、结论是放行。
async function refuse(msg) {
  const spec = await specOf(CHECK)
  const input = readInput()
  // 失败策略表本身读不到时（checks.mjs 就是坏掉的那个），按 hook 输入自报的事件取安全方向：
  // PreToolUse 上的检查项除 readiness 外都是 fail closed，readiness 多拒一次也是安全方向；
  // 其它事件上的检查项全是 fail open。这是「表读不到时怎么办」，不是表的第二份拷贝。
  // 输入读得出、却既没有 hook_event_name 也没有 tool_name：一定不是工具事件（PreToolUse 的输入总带 tool_name），不按 PreToolUse 拒——
  // UserPromptSubmit 上写一份拒绝 JSON 会原样进模型上下文（M3z 复核 platform-4）。输入读不出来时照旧取 PreToolUse 这个安全方向。
  const event = spec
    ? spec.event
    : input && typeof input.hook_event_name === 'string'
      ? input.hook_event_name
      : input && typeof input.tool_name !== 'string'
        ? 'unknown'
        : 'PreToolUse'
  const failClosed = spec ? spec.failClosed : event === 'PreToolUse'

  if (failClosed) {
    const out = await denyShape(msg.denyReason, event)
    if (out) {
      process.stderr.write(msg.stderrHead + '\n')
      process[out.stream].write(out.text)
      process.exit(out.exitCode)
    }
  }
  // 放行那一句排第一（M3v，docs/30）：界面只显示「<事件>:<工具> hook error」加 stderr 的第一个非空行（docs/28），
  // 排在后面的话，用户看得见这行灰字，却看不出这次放行了——加载失败时它还排在整段栈之后。原因与补救都在这一句里，
  // 细节（版本、栈）跟在后面。
  // 返工批准的记录器（表里 recorder 为真）不放行任何东西，失败的后果是这次的回答记不下（M3z 复核 platform-5）。
  process.stderr.write('agent-team ' + CHECK + ' ' + (spec && spec.recorder === true ? msg.recorderNote : msg.openNote) + '\n')
  process.stderr.write(msg.stderrHead + '\n')
  process.exit(1)
}

async function specOf(check) {
  try {
    const mod = await import('./lib/checks.mjs')
    return Object.prototype.hasOwnProperty.call(mod.CHECKS, check) ? mod.CHECKS[check] : null
  } catch (e) {
    return null
  }
}

async function denyShape(reason, event) {
  try {
    const mod = await import('./lib/deny.mjs')
    return mod.denyOutput(reason, event)
  } catch (e) {
    // deny.mjs 自己也读不到（或者在旧 Node 上解析不了）：只认 PreToolUse 这一种形状——今天 fail
    // closed 的检查项全在这个事件上（checks.mjs）。逐字段与 denyOutput 相同，tests/boot.test.mjs
    // 拿真的 denyOutput 对账。别的事件在这里返回 null，落到 fail open 那一支。
    if (event !== 'PreToolUse') return null
    return {
      stream: 'stdout',
      text: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
      exitCode: 0,
    }
  }
}

function readInput() {
  try {
    const v = JSON.parse(readFileSync(0, 'utf8'))
    return v !== null && typeof v === 'object' ? v : null
  } catch (e) {
    return null
  }
}

// 按数值逐段比较 x.y.z（字符串比较会把 9.0.0 判得比 16.9.0 大）。解析不出来的一段当 0。
function atLeast(have, need) {
  const a = have.split('.')
  const b = need.split('.')
  for (let i = 0; i < 3; i++) {
    const x = parseInt(a[i], 10) || 0
    const y = parseInt(b[i], 10) || 0
    if (x !== y) return x > y
  }
  return true
}

function oneLine(s) {
  return String(s).replace(UNSAFE, function (c) {
    return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4)
  })
}

function summarize(err) {
  const kind = (err && (err.code || err.name)) || 'Error'
  const first = String(err && err.message !== undefined ? err.message : err).split('\n')[0]
  return kind + ': ' + first
}
