// hooks.json 注册的检查名、gate.mjs 认得的检查名、以及每个检查项的输入契约，
// 三者的唯一真源。单独成文件是为了让测试能 import 它而不必 import gate.mjs——
// 后者是可执行入口，一旦被 import 就需要「我是不是被直接执行」的守卫，
// 而那种守卫在 symlink/junction 挂载下会判错，使门禁静默失效（M0 实测）。
//
// toolNames 为 null 表示该 hook 事件不是工具调用事件，输入里没有 tool_name——
// SubagentStop 就是这种。不区分的话，PreToolUse 那套「非字符串就 deny」的
// 前置校验会让每次 subagent 收尾都被误拒（规格 §6 注记第 3 条）。
//
// failClosed 声明「读不到可判定的输入（stdin 解析失败、tool_name 缺失或非
// 字符串）时是否拒绝」，对应规格 §6 的失败策略表：H1/H3/H4 fail closed，
// H2/H5a/H5b fail open。这条字段本该和 event/toolNames 一样是检查项自己的
// 契约；评审前的版本把它写成 gate.mjs 里重复三遍的字符串比较
// （CHECK === 'delegation' || CHECK === 'writepath' || CHECK === 'contract'），
// 新增检查项时很容易漏改其中一处而不自知（Task 1 评审 Important 6）。
export const CHECKS = {
  delegation: { event: 'PreToolUse', toolNames: ['Agent'], failClosed: true },
  readiness: { event: 'PreToolUse', toolNames: ['Agent'], failClosed: false },
  writepath: { event: 'PreToolUse', toolNames: ['Edit', 'Write', 'NotebookEdit'], failClosed: true },
  contract: { event: 'PreToolUse', toolNames: ['Edit', 'Write', 'NotebookEdit'], failClosed: true },
  deliverable: { event: 'PostToolUse', toolNames: ['Agent'], failClosed: false },
  'stop-gate': { event: 'SubagentStop', toolNames: null, failClosed: false },
  // ledger 不是门禁——它永不拒绝，只在 PostToolUse 上用 additionalContext 把 PM
  // 算不出来的派生事实（契约 sha256、触达表、state.json 的校验结果）交回给 PM。
  // failClosed: false 因为它根本没有「拒绝」这个出口。
  ledger: { event: 'PostToolUse', toolNames: ['Edit', 'Write', 'NotebookEdit'], failClosed: false },
}

export const KNOWN_CHECKS = new Set(Object.keys(CHECKS))
