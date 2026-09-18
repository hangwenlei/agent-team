// 拒绝的输出契约按 hook 事件分派，不是同一个 JSON 换个事件名——三个事件在
// 平台上表达「拒绝」根本不是同一种机制：
//   PreToolUse    stdout 上 hookSpecificOutput.permissionDecision = 'deny' 的 JSON，exitCode 0（M0 实测）
//   SubagentStop  stderr 上的理由，exitCode 2（U5 实测：docs/07-U5-U6-U8-实测结论.md §1，
//                 九次 exit 2 全部把 subagent 顶回去；平台约 9 次后静默放行是它自己的
//                 重试上限，不是这个函数要处理的事）
//   其它事件      本插件目前没有检查项会在这些事件上调用它（PostToolUse／H5a
//                 按规格 §6 表格只记 warning、从不拒绝）——这条分支当前不可达，
//                 留着是为了万一将来误调用时它会出声，而不是静默吞掉。
//
// 纯函数、不做 I/O（不写流、不退出进程），单独成文件是为了能脱离 Claude Code
// 直接单测（tests/deny.test.mjs）。这是 Task 1 落地时风险最高的一处：
// SubagentStop 那条 exit 2 + stderr 分支，在 Task 6 给 stop-gate 接上判定
// 逻辑之前，从 hooks/gate.mjs 这条路径永远不会被真实调用到——留在 gate.mjs
// 里只做人工代码走读验证，就是「看起来健康、实际什么都不做」的失效形状
// （这个项目一路被咬的就是这个：M0 的 junction 守卫、Task 1 一轮评审的
// emitDeny 只换事件名不换形状）。抽成纯函数后，gate.mjs 的 denyAndExit 退化
// 成「拿结果、写流、退出」三行，这个契约本身则由 tests/deny.test.mjs 直接
// 执行验证过（Task 1 二轮评审）。Task 6 落地后，这条分支已经能经
// hooks/gate.mjs 的 CHECK === 'stop-gate' 分支被真实调用到了（回归见
// tests/gate-deliverable.test.mjs 的 exit 2 用例）——但这不代表这里的直接
// 单测变得多余：子进程级测试证明的是"传导链接对了"（gate.mjs 挖对了字段、
// 读对了 ctx、真的调用了 denyAndExit），这里的纯函数测试证明的是"契约本身
// 没错"（拿到 'SubagentStop' 就该产出 exit 2 + stderr 这个形状），两者答的
// 是不同的问题，不是同一件事测了两遍。

/**
 * @param {string} reason 拒绝理由
 * @param {string} event hook 事件名（CHECKS[name].event）
 * @returns {{ stream: 'stdout' | 'stderr', text: string, exitCode: number }}
 */
export function denyOutput(reason, event) {
  if (event === 'PreToolUse') {
    return {
      stream: 'stdout',
      text: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
      exitCode: 0,
    }
  }

  if (event === 'SubagentStop') {
    return { stream: 'stderr', text: reason + '\n', exitCode: 2 }
  }

  return {
    stream: 'stderr',
    text: `agent-team BUG: denyOutput 收到不支持拒绝表达的事件名 ${JSON.stringify(event)}，无法表达拒绝。\n`,
    exitCode: 0,
  }
}

// fail open 的检查项（readiness/deliverable/stop-gate/ledger，CHECKS 里
// failClosed: false 的那四个）在 main() 内部抛出未捕获异常时，hooks/gate.mjs
// 最外层 catch 此前对这类检查项只是 `process.exit(0)`——零 stdout、零
// stderr。这跟「判定逻辑正常跑完、结论恰好是放行」在外部观测上完全没有
// 区别，是这个项目一路被咬的静默放行形状（docs/08 §0；M0 的 junction 守卫、
// gate.mjs 里 failOpenNotice 已经覆盖的「判定完成后选择放行」那条路径）。
// 唯独「判定逻辑没能跑完」这条路漏了——这个函数补上它。
//
// 与 failOpenNotice（留在 gate.mjs，因为它要读 ctx.kind 这个只有主模块知道
// 的语义）不是同一件事：failOpenNotice 说的是「门禁判过了，判出来的是
// no-run / unreadable，按规则放行」；这里说的是「门禁根本没判完，异常中途
// 打断了判定逻辑本身（比如 roster.json 读到一半发现不是合法 JSON）」——
// 两种情形对读到这行字的人意味着不同的下一步，不能合并成一份文案。
//
// 纯函数、不做 I/O，抽出来的理由与 denyOutput 完全一样（见本文件顶部注释）：
// 这条分支此刻在 main() 的各条判定路径上都碰不到（内部纯函数对退化输入都很
// 防御，见各自的测试），只能靠人工代码走读验证，是「看起来健康、实际什么
// 都不做」的失效形状——抽成纯函数后由 tests/deny.test.mjs 直接单测，不需要
// 等一个真实能崩溃的输入出现。hooks/gate.mjs 最外层 catch 调用它之后紧跟着
// `process.exit(0)`，那条传导链（真的从 gate.mjs 走到这里、真的写了 stderr）
// 由一次性注入 throw 验证过，不留成永久测试——理由与 denyOutput 那段一致。
/**
 * @param {string} check 崩溃时的检查项名（CHECK，如 'deliverable'）
 * @param {Error} err main() 内部抛出的异常
 * @returns {string} 要写进 stderr 的那一行（含结尾换行）
 */
export function crashNotice(check, err) {
  return (
    `agent-team ${check} 检查项在判定过程中异常崩溃（${err.message}），本次放行、` +
    `没有拦截——这个检查项是 fail open 的。这类崩溃通常来自插件自带文件读坏或形状不对，` +
    `先检查 roster.json 与 stages.json 能否被 JSON.parse。\n`
  )
}
