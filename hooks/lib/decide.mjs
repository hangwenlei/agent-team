// 纯函数决策核心。不读 stdin、不写 stdout、不调 process.exit，
// 因此可以脱离 Claude Code 直接单测。

export const MAIN = '__main__'

// 插件提供的 agent 在平台上的注册名带插件前缀（agent-team:at-pm），花名册用裸名书写。
// U3 实测的死结：裸名过得了 hook 但名称解析报 not found；带前缀的过得了名称解析
// 却被花名册拦下——两边对不上，合法派发会被自己的门禁全部拒掉。
// 只剥本插件自己的前缀：无差别剥会让别的插件的 otherplugin:at-product
// 被误认成我们的 at-product。
// 导出是为了让 tests/plugin-name-sync.test.mjs 能拿它与 plugin.json 的 name 对账。
// decide.mjs 必须保持纯函数（不读文件），所以插件名在这里是硬编码，
// 由那个测试负责在改名时报警——否则改名后归一化静默失效，门禁回退到
// 「一律拒绝」，而所有测试仍然是绿的。
export const PLUGIN_PREFIX = 'agent-team:'

export function stripPluginPrefix(name) {
  if (typeof name !== 'string' || !name.startsWith(PLUGIN_PREFIX)) return name
  const bare = name.slice(PLUGIN_PREFIX.length)
  // 退化输入（恰好等于前缀本身）剥完是空串。空串会让 target 被误判成
  // 「没写目标」、让 caller 被误判成未登记调用者而放行——两种语义都不对。
  // 剥出空串时当作没剥过，让它作为一个不匹配的名字走正常拒绝路径。
  return bare === '' ? name : bare
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
 * 派发白名单（门禁 H1）。这是层级的唯一强制手段——
 * 主线程的 tools: Agent(...) 白名单只声明整个会话可见的 agent 宇宙，
 * 且被所有子孙代理继承；它表达不了「谁能派给谁」这条边，边的约束全部由这里的花名册承担。
 */
export function decideDelegation(input, roster) {
  // 花名册本身的形状校验。门禁坏掉的方式不止「抛异常」一种——
  // 一个语法合法但语义空的花名册（{}、[]、null）同样是坏掉，而且更难发现：
  // 它会让每一条「查不到条目」的判断都走「未登记调用者放行」，整个门禁静默失效。
  if (
    roster === null ||
    typeof roster !== 'object' ||
    Array.isArray(roster) ||
    Object.keys(roster).length === 0
  ) {
    return deny(
      'agent-team 的 roster.json 不是有效的花名册对象' +
        '（应为至少含一个条目的 JSON 对象），无法判定派发权限，按安全边界拒绝。',
    )
  }

  const caller = callerOf(input)

  // 用 Object.hasOwn 而不是下标访问：后者会走原型链，使 constructor / toString /
  // valueOf 这类键看起来「在花名册里」，与闭包不变量对「花名册的键」的定义（own key）
  // 不一致。两个键空间不该出现在同一个判断里。
  if (!Object.hasOwn(roster, caller)) {
    // 真·未登记的调用者：不归本门禁管。本机可能还有别的插件或用户自己的
    // subagent 在跑，agent-team 无权干涉它们。这条放行之所以安全，靠的是
    // 花名册闭包不变量（见 tests/roster-closure.test.mjs）：can_delegate_to 里
    // 出现的每个名字本身也必须是花名册的键，所以受管辖角色永远派不出一个
    // 不受管辖的 agent。
    return allow()
  }

  const entry = roster[caller]
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return deny(
      `花名册中 ${caller} 的条目不是对象。这是 roster.json 的配置错误，不是这次调用的问题。`,
    )
  }

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
