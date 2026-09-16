#!/usr/bin/env node
// hook 单入口。第一个参数选择检查项。
// 约定：exit 0 + stdout 上的 JSON 决策 = 生效；无输出 = 走正常权限流程。
// SubagentStop 是例外——它的拒绝走 exit 2 + stderr，不是这套 JSON，
// 见 hooks/lib/deny.mjs 的 denyOutput（拒绝输出契约的唯一真源）。
//
// 入口只做「该检查项声明的前置校验」，不做统一校验——H1–H5 分布在三种
// hook 事件上，输入形状不同（规格 §6 注记）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHECKS, KNOWN_CHECKS } from './lib/checks.mjs'
import { decideDelegation } from './lib/decide.mjs'
import { denyOutput } from './lib/deny.mjs'

const CHECK = process.argv[2]
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return null
  }
}

// hook 输入必须是一个 JSON 对象（{tool_name, tool_input, agent_type, ...}）。
// null、数组、字符串、数字这些"能被 JSON.parse 解析但取不出字段"的输入，
// 语义上跟"读不到输入"是同一类坏——继续往下走只会在某次属性访问上悄悄
// 拿到 undefined，而不是被明确地拒绝。
function isValidInput(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}

function loadRoster() {
  return JSON.parse(readFileSync(join(ROOT, 'roster.json'), 'utf8'))
}

// 拒绝的输出契约（按 hook 事件分派 stdout/stderr/exitCode）抽在
// hooks/lib/deny.mjs 的 denyOutput 里，是纯函数，被 tests/deny.test.mjs
// 直接单测过三个分支——包括 SubagentStop 那条 exit 2 + stderr 分支，它在
// Task 6 给 stop-gate 接上判定逻辑之前，从这条路径永远不会被真实执行到
// （Task 1 二轮评审）。这里只做 I/O：拿到结果、写对应的流、退出，永不返回，
// 调用点之后不需要再写 exit。
function denyAndExit(reason, event) {
  const { stream, text, exitCode } = denyOutput(reason, event)
  process[stream].write(text)
  process.exit(exitCode)
}

function main() {
  if (!KNOWN_CHECKS.has(CHECK)) {
    process.stderr.write(
      `agent-team: 未知的检查项 ${JSON.stringify(CHECK)}；hooks.json 与 checks.mjs 已漂移。\n`,
    )
    // 未知检查项时事件名也不可知，按最常见的 PreToolUse 报，安全边界优先于精确。
    denyAndExit(
      `agent-team 门禁收到未知的检查项 ${JSON.stringify(CHECK)}，按安全边界拒绝。` +
        `hooks.json 注册的检查名与 checks.mjs 认得的不一致。`,
      'PreToolUse',
    )
  }

  const spec = CHECKS[CHECK]
  const input = readStdin()

  if (!isValidInput(input)) {
    // 读不到可判定的输入。fail closed 的检查项拒绝；fail open 的不表态。
    if (spec.failClosed) {
      denyAndExit('agent-team 门禁无法读取 hook 输入，按安全边界拒绝。', spec.event)
    }
    process.exit(0)
  }

  if (spec.toolNames !== null) {
    if (typeof input.tool_name !== 'string') {
      if (spec.failClosed) {
        denyAndExit(
          'agent-team 门禁无法从 hook 输入中读出 tool_name（缺失或不是字符串），按安全边界拒绝。',
          spec.event,
        )
      }
      process.exit(0)
    }
    if (!spec.toolNames.includes(input.tool_name)) {
      // 这次调用确实与本检查项无关，保持沉默、不表态。
      process.exit(0)
    }
  }

  if (CHECK === 'delegation') {
    const result = decideDelegation(input, loadRoster())
    if (result.decision === 'deny') denyAndExit(result.reason, spec.event)
  }

  // readiness / writepath / contract / deliverable / stop-gate 的判定
  // 分别在 Task 3–6 接入，此处先只做分派。

  process.exit(0)
}

// gate.mjs 现在是纯粹的可执行入口，不再被任何测试或模块 import——
// KNOWN_CHECKS/CHECKS 已经拆到 ./lib/checks.mjs，需要它们的测试从那里 import。
// 因此这里不需要「我是不是被当作 hook 直接执行」的守卫，main() 无条件跑。
//
// 历史教训（曾经加过这样一道守卫，已整体删除）：判断用的是
// `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`。
// resolve() 不解析 symlink/junction，而 Node 对主入口的 import.meta.url
// 做 realpath——经 symlink/junction 挂载执行时（本插件的开发期挂载方式，
// 见 scripts/dev-link.mjs）两侧路径必然不相等，守卫误判「被 import」，
// main() 永不执行，门禁静默 fail open（exit 0、零 stdout、零 stderr）。
// 回归覆盖见 tests/gate-io.test.mjs 里「经 junction 挂载路径执行仍然 deny」那条测试。
try {
  main()
} catch (err) {
  const spec = CHECKS[CHECK]
  const event = (spec && spec.event) || 'PreToolUse'
  // CHECK 此刻按理已经通过 main() 顶部的 KNOWN_CHECKS 校验，spec 应该总是存在；
  // 万一不存在（防御性兜底），按最严格的 fail closed 处理，安全边界优先于精确。
  if (!spec || spec.failClosed) {
    denyAndExit(`agent-team 门禁异常，按安全边界拒绝：${err.message}`, event)
  }
  process.exit(0)
}
