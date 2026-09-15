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
  const input = readStdin()
  if (!input) {
    // 读不到输入：安全边界类检查 fail closed。
    if (CHECK === 'delegation') {
      emitDeny('agent-team 门禁无法读取 hook 输入，按安全边界拒绝。')
    }
    process.exit(0)
  }

  if (CHECK === 'delegation') {
    const result = decideDelegation(input, loadRoster())
    if (result.decision === 'deny') emitDeny(result.reason)
  }

  process.exit(0)
}

try {
  main()
} catch (err) {
  // gate.mjs 自身异常：派发白名单是 fail closed。
  if (CHECK === 'delegation') {
    emitDeny(`agent-team 门禁异常，按安全边界拒绝：${err.message}`)
  }
  process.exit(0)
}
