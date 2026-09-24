// 门禁留痕（M3l）：**默认关**。打开之后，每一次门禁进程以 exit 0 退出时，往 stderr
// 多写**一行**，让「这道门禁这一次真的跑过」在会话转录里留下一条 CLI 自己写的记录。
//
// 为什么需要它（docs/20 §7.3，量法与全部原始输出在 docs/21）：
// **一道静默 exit 0 的 hook 在转录里不留任何记录。** 整链那一趟的九份转录里，八道门禁
// 只有三道留下过足迹；另外五道（H1 / H2 / H4 / H6 / H5b）的正常路径恰好就是「判定为
// 放行、无话可说」——于是一趟干净的 run **既证明不了它们跑过，也证明不了它们没跑**。
// 静默的放行和门禁彻底坏掉长得一模一样，这是本仓库一路被咬的那个形状（gate.mjs 里
// failOpenNotice 上方那段写的就是它）。
//
// 为什么不是「用 CLI 现成的通道、门禁一个字不改」：先量过，逐个不行（docs/21 §2）。
// CLI 2.1.278 上，静默 exit 0 的 hook 在转录里被 CLI 自己的过滤丢掉；调试日志里只剩一行
// 不带任何身份的「Hook output does not start with {」；OTel 事件只有「这一批几个 hook、
// 成功几个」的计数。**计数说不出是哪一道**，而本仓库要证明的恰恰是「哪一道」。
//
// 为什么是 **stderr + exit 0**（同一轮实测；「不进模型上下文」那一条是读 CLI 源码得的）：
//   · 只写 stderr、exit 0 → 转录里留一条 `hook_success`，它的 `command` 字段就是
//     hooks/hooks.json 里那条 statusMessage（每道门禁一句、互不相同），`stderr` 原文在。
//     **身份由 CLI 自己写下**，不靠这一行自报。
//   · **它不进模型上下文**：PreToolUse / PostToolUse / SubagentStop 上的 `hook_success`
//     不会被转成发给模型的消息（只有 SessionStart / UserPromptSubmit 那一族会）。
//     这一行的收件人是**转录**，不是模型，也不是用户。
//   · 落在哪一份转录：谁发起的那次工具调用，就落在谁的转录里；SubagentStop 落在
//     **停下来的那个子代理自己**的 `subagents/agent-*.jsonl` 里。核一趟 run 要扫全部。
//     CLI 自己的内部分叉代理（给界面写摘要的那种）停下时 H5b 也跑、这一行也写，
//     **但那几次不进任何转录**——转录数出来的是下限（docs/21 §5.5）。
//
// 硬约束，逐条：
//   ① **默认关**。只有 AGENT_TEAM_GATE_TRACE **恰好是 '1'** 才开；'0'、'true'、空串一律算关。
//      关着的时候**什么都不注册、什么都不写**——零噪声、零额外磁盘写入：本仓库记过
//      「每次都刷一段会把真正要看的东西淹掉」（gate.mjs ledger 分支那条路径过滤）。
//   ② **纯旁路，不改变任何一道门禁的判定。** 只在 exit 0 时写、只写 stderr：
//      PreToolUse 的判定走 stdout 上的 JSON，这里一个字节都不碰；SubagentStop 的拒绝是
//      exit 2 + stderr，**exit 2 那一支一个字都不加**——那段 stderr 就是平台原样发回给
//      子代理的 Stop hook feedback，加一行就改了发给模型的话。
//   ③ **绝不抛异常，绝不把一次放行变成失败。** 注册与写入各包一层 try/catch，写失败就吞掉。
//      理由与 hooks/lib/runctx.mjs 头部那条「绝不抛异常」同一个：门禁自己坏掉，不能替
//      调用方做决定。'exit' 监听里漏出去的异常会把一次 exit 0 变成非零退出——那就是把
//      一次放行改判成了失败。
//   ④ **插件自己不写任何文件。** 落盘的是 CLI 自己本来就在写的那份转录。所以它碰不到
//      .agent-team/ 下的任何东西：不会被账本比对的 unrecorded 当成来路不明的产物，
//      也不经过 H3 / H4 的路径判定（为什么没选「写进 runs/<id>/」，docs/21 §3.4 有账）。
//
// ⚠️ **它能证明的，只有这么多**：平台为这一次事件调起了这道门禁（`command` 字段），
// 进程进入了 main()（`main=entered`），并且以 exit 0 结束。**它不说走的是哪一支**：
// 「判定之后放行」「与本检查项无关、提前退出」「输入读不出来、fail open 静默退出」三者
// 在这一行上长得一样。要分支级的证据，今天只能从夹具状态推（docs/21 §5.2 把一次真实会话里
// 每一格的推断摆在明处；为什么不在各出口标分支，docs/21 §7 第 6 条）。
//
// ⚠️ **main=not-entered 是一条专门留给「入口守卫误判」的信号**：M0 那次 junction 守卫
// 误判（gate.mjs 末尾那段历史教训）的形状，就是进程正常 exit 0、main() 一行都没跑。
// 这一行照样会写，但写的是 not-entered——**不会被读成一次判过的放行**。
//
// ⚠️ 怎么打开（docs/21 §2.5 实测，§4 是操作步骤）：`claude --bg` 下，**在发起命令的 shell 里设这个变量
// 传不到 hook 子进程**（后台服务起会话，不继承那个 shell）；
// `--settings '{"env":{"AGENT_TEAM_GATE_TRACE":"1"}}'` 传得到，含子代理里的 SubagentStop。

export const TRACE_ENV = 'AGENT_TEAM_GATE_TRACE'

// 这一行的固定前缀。全 ASCII 是有意的：转录是 JSONL，核的人最顺手的工具是 grep，
// 而这一行在转录里是被 JSON 转义过的一段字符串——ASCII 的前缀在转义前后逐字相同。
export const TRACE_PREFIX = 'agent-team gate-trace'

export function traceEnabled(env) {
  try {
    return env?.[TRACE_ENV] === '1'
  } catch {
    return false
  }
}

// 检查项名只留 [A-Za-z0-9_-]：它来自 argv，真实值由 hooks.json 写死、全是小写字母加连字符；
// 收窄是为了让这一行**永远是一行**、永远 grep 得到，不管调用方传进来什么。
export function traceLine(check, entered) {
  const name = String(check).replace(/[^A-Za-z0-9_-]/g, '_')
  return `${TRACE_PREFIX} check=${name} main=${entered ? 'entered' : 'not-entered'} exit=0\n`
}

// state.entered 由 gate.mjs 在 main() 第一行置真；监听在进程退出那一刻才读它。
// 返回值只说「注册了没有」，调用方不需要、也不应该据此做任何判定。
export function installTrace({ env, check, proc, state }) {
  try {
    if (!traceEnabled(env)) return false
    proc.on('exit', (code) => {
      try {
        if (code !== 0) return
        proc.stderr.write(traceLine(check, state?.entered === true))
      } catch {
        // 写不出去就算了：留痕是旁路，它失败不能影响门禁本身的任何结果。
      }
    })
    return true
  } catch {
    return false
  }
}
