#!/usr/bin/env node
// 门禁的进程入口——hooks/hooks.json 注册的每一条 hook 都跑这个文件。判定全在 ./gate.mjs；
// 这里只做一件事：把「判定模块根本没加载起来」也纳入 ./lib/checks.mjs 的失败策略表
// （M3p，docs/24 §2.2）。
//
// 为什么要单独一层：gate.mjs 的静态 import 在 ESM 链接期解析。任何一个 lib 缺失、有语法
// 错误、或在模块顶层抛错，都发生在 gate.mjs 自己那层 try/catch 建立之前——进程 exit 1、
// stdout 为空，平台把它当 non-blocking error、工具照常执行，声明 fail closed 的那几道
// 门禁就这样整体消失。动态 import 把这类失败变成一个接得住的 rejected promise。
//
// 硬约束：本文件的静态 import 只许 node: 内建模块（tests/boot.test.mjs 钉着）。它是「别的
// 东西坏了」时唯一还在跑的代码，自己不能再依赖任何可能坏掉的文件。
//
// gate.mjs 正常加载时这里什么都不做：gate.mjs 顶层直接跑 main()，自己读 stdin、写决策、
// 退出。加载失败时 stdin 还没被读过——链接期与顶层求值期的失败都发生在 main() 之前——
// 所以这一支还能自己把 hook 输入读出来。

import { readFileSync } from 'node:fs'

const CHECK = process.argv[2]

try {
  await import('./gate.mjs')
} catch (err) {
  await failedToLoad(err)
}

async function failedToLoad(err) {
  const spec = await specOf(CHECK)
  const input = readInput()
  // 失败策略表本身读不到时（checks.mjs 就是坏掉的那个），按 hook 输入自报的事件取安全方向：
  // PreToolUse 上的检查项除 readiness 外都是 fail closed，readiness 多拒一次也是安全方向；
  // 其它事件上的检查项全是 fail open。这是「表读不到时怎么办」，不是表的第二份拷贝。
  const event = spec
    ? spec.event
    : typeof input?.hook_event_name === 'string'
      ? input.hook_event_name
      : 'PreToolUse'
  const failClosed = spec ? spec.failClosed : event === 'PreToolUse'

  process.stderr.write(
    `agent-team 门禁代码加载失败（检查项 ${JSON.stringify(CHECK)}）：\n${err?.stack ?? err}\n`,
  )
  if (failClosed) {
    const out = await denyShape(
      `agent-team 门禁代码加载失败（${summarize(err)}），无法判定这次调用，按安全边界拒绝。` +
        `插件安装可能不完整或已损坏：重装或更新 agent-team 插件后再试。`,
      event,
    )
    if (out) {
      process[out.stream].write(out.text)
      process.exit(out.exitCode)
    }
  }
  // fail open：放行，但 exit 1——让平台记一条 hook error，而不是装作判过了、结论是放行。
  process.stderr.write(
    `agent-team ${CHECK} 检查项加载失败，本次放行、没有拦截（它是 fail open 的）。` +
      `重装或更新 agent-team 插件。\n`,
  )
  process.exit(1)
}

async function specOf(check) {
  try {
    const { CHECKS } = await import('./lib/checks.mjs')
    return Object.hasOwn(CHECKS, check) ? CHECKS[check] : null
  } catch {
    return null
  }
}

async function denyShape(reason, event) {
  try {
    const { denyOutput } = await import('./lib/deny.mjs')
    return denyOutput(reason, event)
  } catch {
    // deny.mjs 自己也读不到：只认 PreToolUse 这一种形状——今天 fail closed 的检查项全在
    // 这个事件上（checks.mjs）。逐字段与 denyOutput 相同，tests/boot.test.mjs 拿真的
    // denyOutput 对账。别的事件在这里返回 null，落到下面 fail open 那一支。
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
  } catch {
    return null
  }
}

function summarize(err) {
  const kind = err?.code ?? err?.name ?? 'Error'
  const first = String(err?.message ?? err).split('\n')[0]
  return `${kind}: ${first}`
}
