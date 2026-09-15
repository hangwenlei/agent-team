#!/usr/bin/env node
// hook 单入口。第一个参数选择检查项。
// 约定：exit 0 + stdout 上的 JSON 决策 = 生效；无输出 = 走正常权限流程。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decideDelegation } from './lib/decide.mjs'

const CHECK = process.argv[2]
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

// hooks.json 里注册的检查名、gate.mjs 认得的检查名是同一个字面量的两处硬编码。
// 两者漂移（改名漏改一处、手滑打错字）此前会让 main() 对未知检查名直接
// 走到底部 exit 0、不输出任何东西——把"门禁正常工作但这次无事可做"与
// "注册已经漂移、门禁对这个检查项形同虚设"这两种截然不同的情况静默合并成
// 同一个观测（无输出），选了看起来人畜无害、实际最危险的那个解读。
// 导出是为了让 tests/hooks-registration.test.mjs 能拿它与 hooks.json 对账。
export const KNOWN_CHECKS = new Set(['delegation'])

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
  if (input.tool_name !== 'Agent') {
    process.exit(0)
  }

  if (CHECK === 'delegation') {
    const result = decideDelegation(input, loadRoster())
    if (result.decision === 'deny') emitDeny(result.reason)
  }

  process.exit(0)
}

// 只在本文件被当作 hook 直接执行时才跑 main()。gate.mjs 现在同时是可执行入口
// 和可导入模块（tests/hooks-registration.test.mjs 需要 import KNOWN_CHECKS），
// 被 import 时绝不能因为 CHECK 是 undefined 就触发一整套输出与 process.exit(0)
// 的副作用。Node 24 没有 import.meta.main，用 argv[1] 判断是否为直接执行的入口。
if (process.argv[1] && process.argv[1].endsWith('gate.mjs')) {
  try {
    main()
  } catch (err) {
    // gate.mjs 自身异常：派发白名单是 fail closed。
    if (CHECK === 'delegation') {
      emitDeny(`agent-team 门禁异常，按安全边界拒绝：${err.message}`)
    }
    process.exit(0)
  }
}
