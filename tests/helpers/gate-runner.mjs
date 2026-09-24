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
import { TRACE_ENV } from '../../hooks/lib/trace.mjs'

export const GATE = fileURLToPath(new URL('../../hooks/gate.mjs', import.meta.url))

// M3l：子进程的环境**默认剥掉门禁留痕那个开关**（hooks/lib/trace.mjs 的 TRACE_ENV）。
// 这一整套测试断言的是「开关关着时」的门禁——许多用例逐字比 stderr 是不是空的。
// 子进程不显式给 env 就继承跑测试那个 shell 的环境：谁在自己 shell 里开着留痕跑
// node --test，九条与留痕无关的既有用例会一起红（变异量出来的数：把开关改成默认开，
// 既有用例恰好红九条，docs/21 §8 的 M1），而红的原因不在它们测的东西里。
// 要测「开着」的用例（tests/gate-trace.test.mjs）自己传 env 进来。
export function envWithoutTrace(base = process.env) {
  const env = { ...base }
  delete env[TRACE_ENV]
  return env
}

// cwd 是可选的第四个参数（默认继承调用方进程的 cwd，与此前行为一致）。
// H2（readiness）用 process.cwd() 当「用户项目根」去找 .agent-team——
// 要单测「项目根没有进行中的 run」这条分支，必须能把子进程的 cwd 钉在一个
// 干净的临时目录上，不能依赖仓库根此刻恰好有没有 .agent-team（那是环境
// 状态，不是这条分支的契约）。
// env 是可选的第五个参数，缺省是「当前环境去掉留痕开关」（见上面 envWithoutTrace）。
export function run(check, input, gate = GATE, cwd = undefined, env = envWithoutTrace()) {
  const result = spawnSync(process.execPath, [gate, check], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd,
    env,
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

export function decisionOf(stdout) {
  if (!stdout.trim()) return null
  return JSON.parse(stdout).hookSpecificOutput
}
