#!/usr/bin/env node
// hook 单入口。第一个参数选择检查项。
// 约定：exit 0 + stdout 上的 JSON 决策 = 生效；无输出 = 走正常权限流程。
//
// 入口只做「该检查项声明的前置校验」，不做统一校验——H1–H5 分布在三种
// hook 事件上，输入形状不同（规格 §6 注记）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHECKS, KNOWN_CHECKS } from './lib/checks.mjs'
import { decideDelegation } from './lib/decide.mjs'

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

function loadRoster() {
  return JSON.parse(readFileSync(join(ROOT, 'roster.json'), 'utf8'))
}

function emitDeny(reason, event) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
}

function main() {
  if (!KNOWN_CHECKS.has(CHECK)) {
    process.stderr.write(
      `agent-team: 未知的检查项 ${JSON.stringify(CHECK)}；hooks.json 与 checks.mjs 已漂移。\n`,
    )
    // 未知检查项时事件名也不可知，按最常见的 PreToolUse 报，安全边界优先于精确。
    emitDeny(
      `agent-team 门禁收到未知的检查项 ${JSON.stringify(CHECK)}，按安全边界拒绝。` +
        `hooks.json 注册的检查名与 checks.mjs 认得的不一致。`,
      'PreToolUse',
    )
    process.exit(0)
  }

  const spec = CHECKS[CHECK]
  const input = readStdin()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    // 读不到可判定的输入。安全边界类检查 fail closed；流程辅助类不表态。
    if (CHECK === 'delegation' || CHECK === 'writepath' || CHECK === 'contract') {
      emitDeny('agent-team 门禁无法读取 hook 输入，按安全边界拒绝。', spec.event)
    }
    process.exit(0)
  }

  if (spec.toolNames !== null) {
    if (typeof input.tool_name !== 'string') {
      if (CHECK === 'delegation' || CHECK === 'writepath' || CHECK === 'contract') {
        emitDeny(
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
    if (result.decision === 'deny') emitDeny(result.reason, spec.event)
  }

  // readiness / writepath / contract / deliverable / stop-gate 的判定
  // 分别在 Task 3–6 接入，此处先只做分派。

  process.exit(0)
}

try {
  main()
} catch (err) {
  const event = (CHECKS[CHECK] && CHECKS[CHECK].event) || 'PreToolUse'
  if (CHECK === 'delegation' || CHECK === 'writepath' || CHECK === 'contract') {
    emitDeny(`agent-team 门禁异常，按安全边界拒绝：${err.message}`, event)
  }
  process.exit(0)
}
