// tests/gate-io.test.mjs 与 tests/gate-dispatch.test.mjs 共用的子进程驱动
// helper——两份独立拷贝曾经开始漂移：gate-io 的版本用 execFileSync 且没有
// 显式设置 stdio，成功路径下拿不到 stderr，子进程写到 stderr 的内容会穿透
// 进 node --test 的 TAP 输出（Task 1 评审 Important 4）。
//
// 改用 spawnSync：它不像 execFileSync 那样在非零退出码时抛异常，而是始终
// 返回 { status, stdout, stderr }——三个 hook 事件的拒绝契约不一样
// （PreToolUse 用 stdout JSON + exit 0，SubagentStop 用 stderr + exit 2，
// 见 hooks/gate.mjs 的 denyAndExit），调用方必须能同时看到 stdout/stderr/
// status 三者，只看 stdout 会让 SubagentStop 的拒绝测试变成看不出差别的假阳性。
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const GATE = fileURLToPath(new URL('../../hooks/gate.mjs', import.meta.url))

export function run(check, input, gate = GATE) {
  const result = spawnSync(process.execPath, [gate, check], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

export function decisionOf(stdout) {
  if (!stdout.trim()) return null
  return JSON.parse(stdout).hookSpecificOutput
}
