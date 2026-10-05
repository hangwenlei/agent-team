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
import { CHECKS } from '../../hooks/lib/checks.mjs'
import { SECOND_WRITE_NOTE } from '../../hooks/lib/fail-open.mjs'

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
export function run(check, input, gate = GATE, cwd = undefined, env = hermeticEnv(), { nodeArgs = [], node = GATE_NODE, contract = true } = {}) {
  const result = spawnSync(node, [...nodeArgs, gate, check], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd,
    env,
  })
  const out = { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
  // M4b 第二轮复核：子进程在读完 stdin 之前退出时，写 stdin 报 EPIPE（Windows 上报 EOF），spawnSync 把它放进 result.error——
  // 子进程是起来了的，退出码与输出照常判；只有退出码也没有时才算没起来。
  const pipeClosed = result.error && (result.error.code === 'EPIPE' || result.error.code === 'EOF') && result.status !== null
  assertRan(out, gate, pipeClosed ? undefined : result.error, node)
  if (contract) assertContract(check, out)
  return out
}

// 异步版：同一个出口，给要并发跑几十个子进程的判据用（tests/trusted-echo.test.mjs）。
export function runAsync(check, input, { gate = GATE, cwd, env = hermeticEnv(), nodeArgs = [], node = GATE_NODE, contract = true } = {}) {
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
        if (contract) assertContract(check, out)
        resolve(out)
      } catch (e) {
        reject(e)
      }
    })
    // M4b 第一轮复核：子进程在读完 stdin 之前退出时，写 stdin 会报 EPIPE（Windows 上报 EOF，第二轮复核实测）——退出码与输出
    // 由上面的 close 处理器判，这两种不算失败。
    child.stdin.on('error', (e) => {
      if (e && e.code !== 'EPIPE' && e.code !== 'EOF') reject(e)
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

// M3v（docs/30，全量审查第 12 条）：每一次门禁子进程的输出都要守平台契约——钉在出口上，不只钉形状表列举的那几格，
// 以后新增的出口不在任何表里也跑不掉。违反任何一条，平台上的后果都是静默的：
//   - stdout 不是恰好一份 JSON 对象：两份 JSON 让拒绝失效、回传全丢；
//   - 顶层 decision / continue、permissionDecision 不是 deny：allow 绕过权限确认，continue:false 停整轮；
//   - hookEventName 与这次事件不符：整份输出作废；
//   - SubagentStop 上 stdout 非空：additionalContext 在那里等于拦截（拒绝走 exit 2 + stderr，stdout 永远是空的）；
//   - UserPromptSubmit 上 stdout 非空（M3z）：那里的 stdout 会原样进模型上下文（approval-prompt 一个字都不写）；
//   - PreToolUse 上的 additionalContext：本插件在那里不发受信块（hooks/lib/fail-open.mjs 头部）；
//   - 有 JSON 却不是 exit 0：exit 1 时平台照样处理它，与文档相反，别依赖；
//   - stderr 里的 BUG 行与「已经写过一份」那句：兜底触发了——它们只该在注入用例里出现，那种用例传 contract: false。
export function outputContractViolations(check, { stdout, stderr, status }) {
  const out = []
  const spec = Object.hasOwn(CHECKS, check) ? CHECKS[check] : null
  const event = spec ? spec.event : 'PreToolUse'
  // M4d（docs/38，全量审查第 19 条）：UserPromptSubmit 上只有标了 speaks 的检查项（completion）可以发 additionalContext，别的照旧不许写 stdout。
  const speaks = event === 'UserPromptSubmit' && spec?.speaks === true
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (stdout.trim() !== '') {
    if (event !== 'PreToolUse' && event !== 'PostToolUse' && !speaks) out.push(`${event} 上 stdout 非空`)
    if (status !== 0) out.push(`stdout 上有输出，退出码却是 ${status}`)
    let v
    try {
      v = JSON.parse(stdout)
    } catch {
      out.push('stdout 不是恰好一份 JSON')
      return out
    }
    if (!isObj(v)) return [...out, 'stdout 不是一个 JSON 对象']
    if ('decision' in v) out.push('顶层有 decision')
    if ('continue' in v) out.push('顶层有 continue')
    if ('systemMessage' in v && typeof v.systemMessage !== 'string') out.push('systemMessage 不是字符串')
    if (speaks && 'systemMessage' in v) out.push('UserPromptSubmit 上发了 systemMessage')
    const h = v.hookSpecificOutput
    if (h !== undefined) {
      if (!isObj(h)) {
        out.push('hookSpecificOutput 不是对象')
      } else {
        if (h.hookEventName !== event) out.push(`hookEventName 是 ${JSON.stringify(h.hookEventName)}，这次事件是 ${event}`)
        if ('permissionDecision' in h && h.permissionDecision !== 'deny') out.push(`permissionDecision 是 ${JSON.stringify(h.permissionDecision)}`)
        if ('additionalContext' in h) {
          if (typeof h.additionalContext !== 'string') out.push('additionalContext 不是字符串')
          if (event !== 'PostToolUse' && !speaks) out.push(`${event} 上发了 additionalContext`)
        }
      }
    }
  }
  if (stderr.includes('agent-team BUG:')) out.push('stderr 里有 BUG 行')
  if (stderr.includes(SECOND_WRITE_NOTE)) out.push('stderr 里有「已经写过一份」那句')
  return out
}

function assertContract(check, out) {
  const bad = outputContractViolations(check, out)
  if (bad.length) {
    throw new Error(
      `门禁输出违反平台契约（检查项 ${check}）：${bad.join('；')}。` +
        `stdout：${out.stdout.slice(0, 300)}；stderr：${out.stderr.slice(0, 300)}`,
    )
  }
}

export function decisionOf(stdout) {
  if (!stdout.trim()) return null
  return JSON.parse(stdout).hookSpecificOutput
}
