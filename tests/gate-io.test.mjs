// hooks/gate.mjs 的 I/O 层此前完全没有测试直接跑过——decide.test.mjs 只测
// 纯函数决策核心，从不经过 stdin 解析、CHECK 分派、stdout 写出这条真实路径。
// 这份测试用真实子进程驱动 gate.mjs 本体，覆盖它自己负责的那部分行为：
// 输入校验（fail closed）、未知检查名（fail closed）、tool_name 断言（不表态）、
// 以及经 symlink/junction 挂载路径执行时的行为（回归：曾经的入口守卫在
// 这条路径下误判「被 import」，main() 永不执行，门禁静默全放行）。
//
// 子进程驱动 helper 与 tests/gate-dispatch.test.mjs 共用（见
// tests/helpers/gate-runner.mjs）——两份独立拷贝曾经开始漂移：这份文件的
// run() 一度基于 execFileSync 且没有显式设置 stdio，未知检查名测试触发的
// stderr 会穿透进 node --test 的 TAP 输出（Task 1 评审 Important 4）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, decisionOf } from './helpers/gate-runner.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('合法放行的输入——stdout 为空，走正常权限流程', () => {
  const input = { tool_name: 'Agent', tool_input: { subagent_type: 'at-product' } }
  const { stdout } = run('delegation', input)
  assert.equal(stdout, '')
})

test('合法拒绝的输入——stdout 是 deny JSON，hookEventName 为 PreToolUse', () => {
  const input = { tool_name: 'Agent', tool_input: { subagent_type: 'at-outsider' } }
  const { stdout } = run('delegation', input)
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.match(out.permissionDecisionReason, /at-outsider/)
})

test('stdin 为空——deny（fail closed）', () => {
  const { stdout } = run('delegation', '')
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('stdin 非 JSON——deny（fail closed）', () => {
  const { stdout } = run('delegation', 'hello')
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('stdin 是 JSON null——deny（fail closed）', () => {
  const { stdout } = run('delegation', 'null')
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('stdin 是 JSON 字符串 "hello"——deny（fail closed，不是一个可用的对象）', () => {
  const { stdout } = run('delegation', '"hello"')
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
})

test('未知检查名——deny', () => {
  const input = { tool_name: 'Agent', tool_input: {} }
  const { stdout } = run('delegatoin', input)
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /检查项/)
})

test('tool_name 不是 Agent——stdout 为空，不表态', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'echo hi' } }
  const { stdout } = run('delegation', input)
  assert.equal(stdout, '')
})

// 空字符串是字符串，`typeof input.tool_name !== 'string'` 判它为假，
// 不落进 fail-closed 分支，径直落到下面的「不是 'Agent'」分支保持沉默。
// 这条单独钉住：如果有人把上面那个 typeof 判断误改成 `!input.tool_name`
// 之类的 falsy 判断，'' 会被两条分支都判定为「没有依据」而错误地 deny，
// 但现有覆盖 tool_name 的其它测试用的都是非空字符串/非字符串，全部照样绿。
test('tool_name 为空字符串——stdout 为空，不表态', () => {
  const input = { tool_name: '', tool_input: {} }
  const { stdout } = run('delegation', input)
  assert.equal(stdout, '')
})

// tool_name 缺失或不是字符串：门禁拿不到可依据的判定材料，必须 fail closed。
// 这四条钉住 R1——此前 `input.tool_name !== 'Agent'` 对这些值也成立，
// 结果是和上面「不是 Agent」同样的静默放行，但语义完全不同：那边是
// "确认这次调用与本门禁无关"，这里是"门禁根本看不出这次调用是什么"。

test('tool_name 缺失——deny（fail closed）', () => {
  const input = { tool_input: { subagent_type: 'at-worker-a' } }
  const { stdout } = run('delegation', input)
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /tool_name/)
})

test('tool_name 为 null——deny（fail closed）', () => {
  const input = { tool_name: null, tool_input: { subagent_type: 'at-worker-a' } }
  const { stdout } = run('delegation', input)
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /tool_name/)
})

test('tool_name 是数组——deny（fail closed）', () => {
  const input = { tool_name: ['Agent'], tool_input: { subagent_type: 'at-worker-a' } }
  const { stdout } = run('delegation', input)
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /tool_name/)
})

test('tool_name 是数字——deny（fail closed）', () => {
  const input = { tool_name: 42, tool_input: { subagent_type: 'at-worker-a' } }
  const { stdout } = run('delegation', input)
  const out = decisionOf(stdout)
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /tool_name/)
})

// 回归覆盖：曾经的入口守卫用
// `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`
// 判断「是否被直接执行」。resolve() 不解析 symlink/junction，而 Node 对
// 主入口的 import.meta.url 做 realpath——经 junction 挂载执行时两侧路径
// 必然不相等，守卫误判「被 import」，main() 永不执行：门禁 fail open 且
// 零 stdout/stderr，是所有失败方向里最危险的一种（静默、没有任何信号）。
// 该守卫已整体删除，这条测试钉住这条真实存在的执行路径——本插件的开发期
// 挂载方式（scripts/dev-link.mjs）本身就是 junction，hooks.json 里
// ${CLAUDE_PLUGIN_ROOT} 展开的正是这条路径。
test('经 junction 挂载路径执行仍然 deny（回归：入口守卫曾让 main() 在此路径下永不执行）', (t) => {
  const linkPath = join(tmpdir(), `agent-team-junction-test-${process.pid}-${Date.now()}`)

  try {
    execFileSync('cmd', ['/c', 'mklink', '/J', linkPath, ROOT], { encoding: 'utf8' })
  } catch (err) {
    t.skip(`无法创建 junction（权限或平台限制）：${err.stderr || err.message}`)
    return
  }

  try {
    const gateViaLink = join(linkPath, 'hooks', 'gate.mjs')
    const input = { tool_name: 'Agent', tool_input: { subagent_type: 'at-outsider' } }
    const { stdout } = run('delegation', input, gateViaLink)
    const out = decisionOf(stdout)
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /at-outsider/)
  } finally {
    // recursive 必须保持 false——同样的警告见 scripts/dev-link.mjs：
    // linkPath 是 junction 时这行只删链接本身，仓库内容完好；
    // 改成 recursive: true 会在「万一它不是 junction」时连内容一起删掉。
    rmSync(linkPath, { recursive: false, force: true })
  }
})
