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
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { TRACE_ENV } from '../../hooks/lib/trace.mjs'

// GATE 是 hooks.json 真正注册的那个进程入口 boot.mjs，不是判定主体 gate.mjs（M3p）：子进程
// 判据要走平台走的那条路，boot.mjs 再把判定交给 gate.mjs。
export const GATE = fileURLToPath(new URL('../../hooks/boot.mjs', import.meta.url))

// M3t（docs/28，全量审查第 4 条）：门禁子进程用哪个 node。缺省是跑测试的这个 node；CI 的最低版本
// 作业把 AGENT_TEAM_GATE_NODE 设成 hooks/boot.mjs 的 MIN_NODE 那个版本——测试框架本身仍跑在新版本
// 上（它自己要 Node 22 起的行为），只有门禁子进程换成用户最旧可能用的那个。所有门禁子进程都经
// 下面的 run / runAsync 起，tests/gate-runner.test.mjs 钉着别处不许自己 spawn node。
export const GATE_NODE = process.env.AGENT_TEAM_GATE_NODE || process.execPath

// M3l：子进程的环境**默认剥掉门禁留痕那个开关**（hooks/lib/trace.mjs 的 TRACE_ENV）。
// 这一整套测试断言的是「开关关着时」的门禁——许多用例逐字比 stderr 是不是空的。
// 子进程不显式给 env 就继承跑测试那个 shell 的环境：谁在自己 shell 里开着留痕跑
// node --test，九条与留痕无关的既有用例会一起红（变异量出来的数：把开关改成默认开，
// 既有用例恰好红九条，docs/21 §8 的 M1），而红的原因不在它们测的东西里。
// 要测「开着」的用例（tests/gate-trace.test.mjs）自己传 env 进来。
//
// M3p：同一个理由再剥一个 CLAUDE_PROJECT_DIR。门禁现在优先用它当项目根
// （hooks/lib/runctx.mjs 的 projectRootFrom，docs/24 §2.1），而这一整套测试用子进程的
// cwd 指明夹具项目在哪——跑测试的 shell 若恰好带着这个变量（在 Claude Code 的 hook
// 或会话环境里跑 node --test 就会），每个夹具都会被悄悄指向那个真实项目。要测
// 「CLAUDE_PROJECT_DIR 生效」的用例（tests/project-root.test.mjs）自己把它加回来。
export function hermeticEnv(base = process.env) {
  const env = { ...base }
  delete env[TRACE_ENV]
  delete env.CLAUDE_PROJECT_DIR
  return env
}

// cwd 是可选的第四个参数（默认继承调用方进程的 cwd，与此前行为一致）。
// 门禁在没有 CLAUDE_PROJECT_DIR 时用 process.cwd() 当「用户项目根」去找 .agent-team
// （缺省 env 把那个变量剥掉了，所以这里的 cwd 就是夹具项目根）——
// 要单测「项目根没有进行中的 run」这条分支，必须能把子进程的 cwd 钉在一个
// 干净的临时目录上，不能依赖仓库根此刻恰好有没有 .agent-team（那是环境
// 状态，不是这条分支的契约）。
// env 是可选的第五个参数，缺省是「当前环境去掉留痕开关与 CLAUDE_PROJECT_DIR」（见上面 hermeticEnv）。
// 第六个参数：nodeArgs 放在入口之前，用来预加载（-r 一个 .cjs：--import 要 Node 18.18 起才有，
// 最低版本作业上会让子进程在「bad option」上直接退出）；node 换一个 node 来跑（tests/boot-old-node.test.mjs 用）。
export function run(check, input, gate = GATE, cwd = undefined, env = hermeticEnv(), { nodeArgs = [], node = GATE_NODE } = {}) {
  const result = spawnSync(node, [...nodeArgs, gate, check], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd,
    env,
  })
  const out = { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
  assertRan(out, gate, result.error, node)
  return out
}

// 异步版：同一个出口，给要并发跑几十个子进程的判据用（tests/trusted-echo.test.mjs）。
export function runAsync(check, input, { gate = GATE, cwd, env = hermeticEnv(), nodeArgs = [], node = GATE_NODE } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [...nodeArgs, gate, check], { cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (status) => {
      const out = { check, stdout, stderr, status }
      try {
        assertRan(out, gate, undefined, node)
        resolve(out)
      } catch (e) {
        reject(e)
      }
    })
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input))
  })
}

// 子进程根本没跑起来——node 找不到、被信号杀掉、退出码不在门禁会用的 0/1/2 里、入口文件本身
// 找不到——就不是「门禁判了什么」，直接抛。不抛的话，一个起不来的门禁进程 stdout 为空，许多
// 「应当放行」的判据会照样绿：门禁没跑和门禁放行，从输出上看一模一样（M3t 复核）。
function assertRan({ stderr, status }, gate, error, node) {
  if (error) throw new Error(`门禁子进程没起来（${node}）：${error.message}`)
  if (status === null) throw new Error(`门禁子进程被信号杀掉了（${gate}）：${stderr.slice(0, 300)}`)
  if (![0, 1, 2].includes(status)) throw new Error(`门禁子进程退出码 ${status} 不在 0/1/2 里：${stderr.slice(0, 300)}`)
  if (stderr.includes(`Cannot find module '${gate}'`)) throw new Error(`门禁入口本身找不到：${gate}`)
}

export function decisionOf(stdout) {
  if (!stdout.trim()) return null
  return JSON.parse(stdout).hookSpecificOutput
}
