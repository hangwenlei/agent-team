// 纯函数决策核心。不读 stdin、不写 stdout、不调 process.exit，
// 因此可以脱离 Claude Code 直接单测。

export const MAIN = '__main__'

/** hook 输入里 agent_type 只在 subagent 中出现；缺失即主线程。 */
export function callerOf(input) {
  return input?.agent_type ?? MAIN
}

function allow() {
  return { decision: 'allow' }
}

function deny(reason) {
  return { decision: 'deny', reason }
}

/**
 * 派发白名单（门禁 H1）。补的是平台的空缺：
 * 主线程的 tools: Agent(...) 白名单是硬的，subagent 定义里的括号列表被忽略。
 */
export function decideDelegation(input, roster) {
  const target = input?.tool_input?.subagent_type
  if (!target) return allow()

  const caller = callerOf(input)
  const entry = roster?.[caller]
  if (!entry) return allow()

  if (entry.can_delegate_to.includes(target)) return allow()

  const allowed = entry.can_delegate_to.length
    ? entry.can_delegate_to.join('、')
    : '（无，这是叶子角色）'
  return deny(
    `角色 ${caller} 不得派发给 ${target}。它可以派发的角色是：${allowed}。` +
      `如果这项工作确实需要 ${target}，把它冒泡给上级，不要绕过花名册。`,
  )
}
