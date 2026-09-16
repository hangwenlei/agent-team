// hooks.json 注册的检查名、gate.mjs 认得的检查名、以及每个检查项的输入契约，
// 三者的唯一真源。单独成文件是为了让测试能 import 它而不必 import gate.mjs——
// 后者是可执行入口，一旦被 import 就需要「我是不是被直接执行」的守卫，
// 而那种守卫在 symlink/junction 挂载下会判错，使门禁静默失效（M0 实测）。
//
// toolNames 为 null 表示该 hook 事件不是工具调用事件，输入里没有 tool_name——
// SubagentStop 就是这种。不区分的话，PreToolUse 那套「非字符串就 deny」的
// 前置校验会让每次 subagent 收尾都被误拒（规格 §6 注记第 3 条）。
export const CHECKS = {
  delegation: { event: 'PreToolUse', toolNames: ['Agent'] },
  readiness: { event: 'PreToolUse', toolNames: ['Agent'] },
  writepath: { event: 'PreToolUse', toolNames: ['Edit', 'Write', 'NotebookEdit'] },
  contract: { event: 'PreToolUse', toolNames: ['Edit', 'Write', 'NotebookEdit'] },
  deliverable: { event: 'PostToolUse', toolNames: ['Agent'] },
  'stop-gate': { event: 'SubagentStop', toolNames: null },
}

export const KNOWN_CHECKS = new Set(Object.keys(CHECKS))
