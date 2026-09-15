// 纯函数决策核心。不读 stdin、不写 stdout、不调 process.exit，
// 因此可以脱离 Claude Code 直接单测。

export const MAIN = '__main__'

// 插件提供的 agent 在平台上的注册名带插件前缀（agent-team:at-pm），花名册用裸名书写。
// U3 实测的死结：裸名过得了 hook 但名称解析报 not found；带前缀的过得了名称解析
// 却被花名册拦下——两边对不上，合法派发会被自己的门禁全部拒掉。
// 只剥本插件自己的前缀：无差别剥会让别的插件的 otherplugin:at-product
// 被误认成我们的 at-product。
const PLUGIN_PREFIX = 'agent-team:'

function stripPluginPrefix(name) {
  return typeof name === 'string' && name.startsWith(PLUGIN_PREFIX)
    ? name.slice(PLUGIN_PREFIX.length)
    : name
}

/** hook 输入里 agent_type 只在 subagent 中出现；缺失即主线程。 */
export function callerOf(input) {
  const raw = input?.agent_type
  return raw === undefined || raw === null ? MAIN : stripPluginPrefix(raw)
}

function allow() {
  return { decision: 'allow' }
}

function deny(reason) {
  return { decision: 'deny', reason }
}

function fmt(list) {
  return list.length ? list.join('、') : '（无，这是叶子角色）'
}

/**
 * 派发白名单（门禁 H1）。补的是平台的空缺：
 * 主线程的 tools: Agent(...) 白名单是硬的，subagent 定义里的括号列表被忽略。
 */
export function decideDelegation(input, roster) {
  const caller = callerOf(input)
  const entry = roster?.[caller]

  // 未登记的调用者不归本门禁管：本机可能还有别的插件或用户自己的 subagent 在跑，
  // agent-team 无权干涉它们。这条放行之所以安全，靠的是花名册闭包不变量
  // （见 tests/roster-closure.test.mjs）：can_delegate_to 里出现的每个名字
  // 本身也必须是花名册的键，所以受本门禁管辖的角色永远派不出一个不受管辖的 agent。
  if (!entry) return allow()

  const allowed = entry.can_delegate_to
  if (!Array.isArray(allowed)) {
    return deny(
      `花名册中 ${caller} 的条目缺少 can_delegate_to 数组，无法判定派发权限。` +
        `这是 roster.json 的配置错误，不是这次调用的问题。`,
    )
  }

  // Agent 工具的 subagent_type 是可选字段，省略即得到 general-purpose 代理。
  // 所以对受管辖的调用者来说，"没写目标"是一次真实的、拿到全套工具的派发，
  // 而不是"这次调用与本门禁无关"。必须拒，否则整个花名册可被一个省略的字段绕过。
  const target = stripPluginPrefix(input?.tool_input?.subagent_type)
  if (!target) {
    return deny(
      `角色 ${caller} 调用 Agent 时未指定 subagent_type。省略该字段会得到 general-purpose ` +
        `代理，从而绕过花名册。请显式写明目标角色，它必须是：${fmt(allowed)}。`,
    )
  }

  if (allowed.includes(target)) return allow()

  return deny(
    `角色 ${caller} 不得派发给 ${target}。它可以派发的角色是：${fmt(allowed)}。` +
      `如果这项工作确实需要 ${target}，把它冒泡给上级，不要绕过花名册。`,
  )
}
