#!/usr/bin/env node
// hook 单入口。第一个参数选择检查项。
// 约定：exit 0 + stdout 上的 JSON 决策 = 生效；无输出 = 走正常权限流程。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decideDelegation } from './lib/decide.mjs'
import { KNOWN_CHECKS } from './lib/checks.mjs'

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

function emitDeny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
}

function main() {
  if (!KNOWN_CHECKS.has(CHECK)) {
    process.stderr.write(
      `agent-team: 未知的检查项 ${JSON.stringify(CHECK)}；hooks.json 与 gate.mjs 已漂移。\n`,
    )
    emitDeny(
      `agent-team 门禁收到未知的检查项 ${JSON.stringify(CHECK)}，按安全边界拒绝。` +
        `hooks.json 注册的检查名与 gate.mjs 认得的不一致。`,
    )
    process.exit(0)
  }

  const input = readStdin()
  if (!isValidInput(input)) {
    // 读不到输入，或输入不是一个可用的 JSON 对象：安全边界类检查 fail closed。
    if (CHECK === 'delegation') {
      emitDeny('agent-team 门禁无法读取有效的 hook 输入，按安全边界拒绝。')
    }
    process.exit(0)
  }

  // 纵深防御：即便 hooks.json 的 matcher 配置有误导致这个 hook 在非 Agent
  // 工具上被触发，这里再断言一次工具名。目前完全信任 matcher——锚定的
  // "^Agent$" 已经很难误配，但这一步断言的成本接近零。
  // tool_name 不是字符串：门禁拿不到可依据的判定材料，按 §6 表格 fail closed。
  if (typeof input.tool_name !== 'string') {
    emitDeny(
      'agent-team 门禁无法从 hook 输入中读出 tool_name（缺失或不是字符串），按安全边界拒绝。',
    )
    process.exit(0)
  }
  // 是字符串但不是 Agent：这次调用确实与本门禁无关，保持沉默、不表态。
  if (input.tool_name !== 'Agent') {
    process.exit(0)
  }

  if (CHECK === 'delegation') {
    const result = decideDelegation(input, loadRoster())
    if (result.decision === 'deny') emitDeny(result.reason)
  }

  process.exit(0)
}

// gate.mjs 现在是纯粹的可执行入口，不再被任何测试或模块 import——
// KNOWN_CHECKS 已经拆到 ./lib/checks.mjs，需要它的测试从那里 import。
// 因此这里不需要「我是不是被当作 hook 直接执行」的守卫，main() 无条件跑。
//
// 历史教训（曾经加过这样一道守卫，已整体删除）：判断用的是
// `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`。
// resolve() 不解析 symlink/junction，而 Node 对主入口的 import.meta.url
// 做 realpath——经 symlink/junction 挂载执行时（本插件的开发期挂载方式，
// 见 scripts/dev-link.mjs）两侧路径必然不相等，守卫误判「被 import」，
// main() 永不执行，门禁静默 fail open（exit 0、零 stdout、零 stderr）。
try {
  main()
} catch (err) {
  // gate.mjs 自身异常：派发白名单是 fail closed。
  if (CHECK === 'delegation') {
    emitDeny(`agent-team 门禁异常，按安全边界拒绝：${err.message}`)
  }
  process.exit(0)
}
