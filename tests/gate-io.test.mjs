// hooks/gate.mjs 的 I/O 层此前完全没有测试直接跑过——decide.test.mjs 只测
// 纯函数决策核心，从不经过 stdin 解析、CHECK 分派、stdout 写出这条真实路径。
// 这份测试用真实子进程驱动 gate.mjs 本体，覆盖它自己负责的那部分行为：
// 输入校验（fail closed）、未知检查名（fail closed）、tool_name 断言（不表态）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const GATE = fileURLToPath(new URL('../hooks/gate.mjs', import.meta.url))

// gate.mjs 无论决策如何都 exit 0，所以子进程正常返回就是唯一路径；
// execFileSync 只在非零退出码或启动失败时才抛异常。
function run(check, input) {
  return execFileSync(process.execPath, [GATE, check], {
    input,
    encoding: 'utf8',
  })
}

function parseDeny(stdout) {
  const parsed = JSON.parse(stdout)
  return parsed.hookSpecificOutput
}

test('合法放行的输入——stdout 为空，走正常权限流程', () => {
  const input = JSON.stringify({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'at-product' },
  })
  const stdout = run('delegation', input)
  assert.equal(stdout, '')
})

test('合法拒绝的输入——stdout 是 deny JSON，hookEventName 为 PreToolUse', () => {
  const input = JSON.stringify({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'at-outsider' },
  })
  const stdout = run('delegation', input)
  const out = parseDeny(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.match(out.permissionDecisionReason, /at-outsider/)
})

test('stdin 为空——deny（fail closed）', () => {
  const stdout = run('delegation', '')
  const out = parseDeny(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('stdin 非 JSON——deny（fail closed）', () => {
  const stdout = run('delegation', 'hello')
  const out = parseDeny(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('stdin 是 JSON null——deny（fail closed）', () => {
  const stdout = run('delegation', 'null')
  const out = parseDeny(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('stdin 是 JSON 字符串 "hello"——deny（fail closed，不是一个可用的对象）', () => {
  const stdout = run('delegation', '"hello"')
  const out = parseDeny(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('未知检查名——deny', () => {
  const input = JSON.stringify({ tool_name: 'Agent', tool_input: {} })
  const stdout = run('delegatoin', input)
  const out = parseDeny(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /检查项/)
})

test('tool_name 不是 Agent——stdout 为空，不表态', () => {
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  })
  const stdout = run('delegation', input)
  assert.equal(stdout, '')
})
