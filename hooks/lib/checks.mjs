// hooks.json 注册的检查名、gate.mjs 认得的检查名、以及每个检查项的输入契约，
// 三者的唯一真源。单独成文件是为了让测试能 import 它而不必 import gate.mjs——
// 后者一被 import 就在顶层跑 main()（读 stdin、退出进程），要让测试能 import 就得加
// 「我是不是被直接执行」的守卫，而那种守卫在 symlink/junction 挂载下会判错，使门禁
// 静默失效（M0 实测）。hooks/boot.mjs 也读这张表：gate.mjs 加载失败时，它靠这里的
// failClosed 决定拒绝还是放行（M3p）。
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
  // H6 返工预算写时强制（Task 5，M2a）。挂在与 writepath/contract 同一组 matcher 上，
  // 同样 fail closed——decideRework 判出 ok:false 时必须真的挡住这次写入，理由见
  // hooks/lib/rework-guard.mjs 头部。
  rework: { event: 'PreToolUse', toolNames: ['Edit', 'Write', 'NotebookEdit'], failClosed: true },
  deliverable: { event: 'PostToolUse', toolNames: ['Agent'], failClosed: false },
  'stop-gate': { event: 'SubagentStop', toolNames: null, failClosed: false },
  // ledger 不是门禁——它永不拒绝，只在 PostToolUse 上用 additionalContext 把 PM
  // 算不出来的派生事实（契约 sha256、触达表、state.json 的校验结果）交回给 PM。
  // failClosed: false 因为它根本没有「拒绝」这个出口。
  ledger: { event: 'PostToolUse', toolNames: ['Edit', 'Write', 'NotebookEdit'], failClosed: false },
  // M3z（docs/34，全量审查第 16 条）：返工批准的两个记录器，不是门禁——它们不拒任何东西，只在用户选了（或单独发了）规范标签
  // 「再返工一轮：回到 <段>」、而这一轮真的需要批准时，往当前 run 的 approvals.jsonl 追加一条。失败的后果只是「没有记下」
  // （H6 照样拒那次回退），方向安全，所以 fail open。一个检查项只挂一个事件（本表的契约），两个来源拆成两个检查名。
  // approval-prompt 在 UserPromptSubmit 上：stdout 会进模型上下文、exit 2 会拦掉用户的话——它两样都不做（hookOutput 对这个事件
  // 恒给空 stdout，denyOutput 对它写 stderr、exit 0）。
  // recorder：失败的后果是「这次的回答没有记下」，不是「放行」——boot.mjs、deny.mjs 的 crashNotice、gate.mjs 与 fail-open.mjs 在
  // 失败路径上照它选说法（复核 platform-5）。
  'approval-ask': { event: 'PostToolUse', toolNames: ['AskUserQuestion'], failClosed: false, recorder: true },
  'approval-prompt': { event: 'UserPromptSubmit', toolNames: null, failClosed: false, recorder: true },
  // M4d（docs/38，全量审查第 19 条）：完成核验。后台派发的子代理完成时，主会话收到一条 <task-notification>，UserPromptSubmit 随之触发；这一项认出
  // 通知、按门禁记的派发记录（runs/<id>/dispatches.jsonl）对回角色与段，核它的产物，用 additionalContext 告诉收件人（PM）。不是门禁：
  // 不拦任何东西（exit 2 会把这条消息吞掉）。speaks：这个事件上它可以发受信回传——hookOutput 与 tests/helpers/gate-runner.mjs 的
  // 出口契约只放它，approval-prompt 照旧一个字都不写。
  completion: { event: 'UserPromptSubmit', toolNames: null, failClosed: false, speaks: true },
  // M4o（docs/50，审查第 20 条修法 A）：原话记录。/agent-team:at 展开时（UserPromptExpansion）把用户写在命令后面的那段话记进项目一级的
  // .agent-team/user-words.json（hooks/lib/user-words.mjs）。不是门禁：不拦任何东西——这个事件上 exit 2 会把用户的命令拦掉；stdout 一个字都
  // 不写（hookOutput 对它恒给空）。matcher：生命周期事件里唯一带 matcher 的一项，只放本插件的 at 这一条命令——锚定，不锚定的「agent-team:at」
  // 会被平台当正则、连 at-init、at-resume 一起放进来（docs/50 §1）；插件名与 decide.mjs 的 PLUGIN_PREFIX 对得上（tests/plugin-name-sync.test.mjs）。
  // records：记录器记的是什么，失败时的说法按它分——这里记不下的是原话，不是批准。
  'user-words': { event: 'UserPromptExpansion', toolNames: null, matcher: '^agent-team:at$', failClosed: false, recorder: true, records: 'user-words' },
}

export const KNOWN_CHECKS = new Set(Object.keys(CHECKS))
