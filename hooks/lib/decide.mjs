// 纯函数决策核心。不读 stdin、不写 stdout、不调 process.exit，
// 因此可以脱离 Claude Code 直接单测。

// 拒绝理由里模型给的目标名、isolation 值过 inline / quote（M3s，docs/27）。
import { inline, quote } from './trusted.mjs'

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

// 项目经理的裸名：主会话（插件 settings.json 的 agent），也是唯一的契约写者（exemptFromPaths）。
const PM_ROLE = 'at-pm'

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

// 在 run 目录之外不受 project.json 的 paths 管的身份：项目经理（at-pm）与主线程（MAIN）。写路径隔离（writepath.mjs 第 1 步）与
// 触达表（reach.mjs 的 unrestricted）共用这一个判断（M4f，docs/41，审查第 27 条）：两处各写一份会分叉——触达表原来就把
// 项目经理报成「只够得到别人认领的那几个前缀」，而写路径隔离对它整段放行。契约守卫的 isContractWriter 也就是它（同一个
// 函数，M4f 复核）：契约写者与不受 paths 管的是同一个身份；这条豁免的安全性依赖什么，论证在 contract-guard.mjs 那段注释里。
export function exemptFromPaths(role) {
  const caller = callerOf({ agent_type: role })
  return caller === MAIN || caller === PM_ROLE
}

// 花名册有没有用：null、不是对象、数组、空对象都算坏。H1 与 H3（M3u）共用这一份——H3 拿到一个坏花名册
// 时若照「不在花名册里就不归我管」放行，就对所有人全开（loadRoster 读坏时退回的正是 {}）。
export function isValidRoster(roster) {
  return roster !== null && typeof roster === 'object' && !Array.isArray(roster) && Object.keys(roster).length > 0
}

/**
 * 派发白名单（门禁 H1）。这是**派发路径**的唯一强制手段——但派发不是获得 agent
 * 的唯一路径：`context: fork` 的 skill 不经 Agent 工具就能起一个 subagent，这里看不见
 * （M1 · U7 实测，见 docs/06；对策是不给角色 Skill 工具，规格 §6.1，由
 * tests/tool-surface.test.mjs 钉住）。
 * 主线程的 tools: Agent(...) 白名单只声明整个会话可见的 agent 宇宙，
 * 且被所有子孙代理继承；它表达不了「谁能派给谁」这条边，边的约束全部由这里的花名册承担。
 */
export function decideDelegation(input, roster) {
  // 花名册本身的形状校验。门禁坏掉的方式不止「抛异常」一种——
  // 一个语法合法但语义空的花名册（{}、[]、null）同样是坏掉，而且更难发现：
  // 它会让每一条「查不到条目」的判断都走「未登记调用者放行」，整个门禁静默失效。
  if (!isValidRoster(roster)) {
    return deny(
      'agent-team 的 roster.json 不是有效的花名册对象' +
        '（应为至少含一个条目的 JSON 对象），无法判定派发权限，按安全边界拒绝。',
    )
  }

  // M4i（docs/44，审查第 35 条）：agent_type 在、却不是非空字符串——callerOf 会把它原样当名字，花名册里查不到，走下面「未登记的调用者
  // 放行」，一个畸形字段就绕过了整个 H1。认不出是谁在派就按安全边界拒；缺失与 null 照旧是主线程（callerOf）。
  const rawCaller = input?.agent_type
  if (rawCaller !== undefined && rawCaller !== null && (typeof rawCaller !== 'string' || rawCaller === '')) {
    return deny(
      '门禁认不出发起这次派发的是谁：hook 输入里的 agent_type 在，却不是非空字符串，按安全边界拒绝。' +
        '这不是改派发参数能解决的——停下来把这一条原样告诉用户（多半是 Claude Code 改了 hook 输入的形状，或者别的插件改写了它）。',
    )
  }

  // M4i（docs/44，审查第 22 条）：项目经理只能是主会话。任何调用者派 at-pm 一律拒，花名册外的也拒——主会话被设置里别的 agent 盖住时，
  // 它就是花名册外的调用者；子代理里的 at-pm 带着项目经理的写权限（契约、控制文件），却不是主会话。裸名也拒：门禁按剥前缀的名字认
  // 项目经理，起出来的子代理同样会被当成它。别的插件的同名 agent（带别的前缀）不归本门禁管。
  if (stripPluginPrefix(input?.tool_input?.subagent_type) === PM_ROLE) {
    return deny(
      `项目经理只能是主会话，${PM_ROLE} 不能被派成子代理：子代理里的项目经理带着写契约与控制文件的权限，却不是主会话。` +
        `要跑这支团队，主会话本身得是 ${PLUGIN_PREFIX}${PM_ROLE}——插件的 settings.json 这样设，用户、项目或本地设置里写了别的 agent 会盖掉它` +
        `（也可以用 claude --agent ${PLUGIN_PREFIX}${PM_ROLE} 起会话）。停下来把这一条告诉用户。`,
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

  if (allowed.includes(target)) {
    // M3p（docs/24 §2.1）：isolation 把子代理搬进另一份检出（'worktree'）或另一台机器
    // （'remote'）。团队的全部判据都建立在「所有角色共用一棵工作树、一个 .agent-team」上——
    // 隔离出去的子代理那边要么找不到 run、门禁整体 fail open，要么写回的路径被判成无人
    // 认领；它交的产物也落不进 run 目录。排在白名单之后：目标本身不许派时，那条理由更根本。
    const isolation = input?.tool_input?.isolation
    if (isolation) {
      return deny(
        `角色 ${caller} 派发 ${target} 时带了 isolation: ${quote(isolation)}。` +
          `团队角色必须在同一棵工作树里干活：隔离出去的子代理写的是另一份检出，门禁读不到` +
          `这趟 run，它的产物也落不回 run 目录。去掉 isolation 参数重新派发。` +
          `如果加它是因为平台说后台会话不能写共享检出：这支团队在那种会话里跑不起来，` +
          `停下来告诉用户——出路是用户在项目设置里把 worktree.bgIsolation 设为 "none"，` +
          `或者换成前台会话；不要自己去改设置。`,
      )
    }
    // M4i（docs/44，审查第 42 条）：开了 agent teams 时，带 name 的 Agent 调用起的是 teammate，不是子代理——H5a 把它当旧版 CLI 那一格
    // （派出去那一刻就报缺、不记派发记录），它停下时门禁也看不见。与 isolation 同形：排在白名单之后，花名册外的调用者不管。
    const name = input?.tool_input?.name
    if (name !== undefined && name !== null && name !== '') {
      return deny(
        `角色 ${caller} 派发 ${target} 时带了 name: ${inline(name)}。开了 agent teams 时，带 name 的派发起的是 teammate，不是子代理：` +
          `门禁按子代理的返回与停下核它交没交、记派发记录，teammate 不走这一条，它停下时门禁看不见。去掉 name 参数重新派发。`,
      )
    }
    return allow()
  }

  // M4i（docs/44，审查第 35 条）：项目经理（与主线程）没有上级，「冒泡给上级」对它不成立——说这个角色由谁派（从花名册现算）。
  if (caller === MAIN || caller === PM_ROLE) {
    const by = Object.keys(roster).filter(
      (k) => k !== MAIN && k !== caller && Array.isArray(roster[k]?.can_delegate_to) && roster[k].can_delegate_to.includes(target),
    )
    const how = !by.length
      ? `花名册里没有哪个角色能派 ${inline(target)}，它不是这支团队里干活的人。`
      : `${inline(target)} 由 ${by.join('、')} 派：要它干活，派${by.length > 1 ? '其中一个' : ` ${by[0]}`}，在派发提示里写明要 ${inline(target)} 做什么；` +
        '不要绕过花名册。'
    return deny(`角色 ${caller} 不得派发给 ${inline(target)}。它可以派发的角色是：${fmt(allowed)}。${how}`)
  }

  return deny(
    `角色 ${caller} 不得派发给 ${inline(target)}。它可以派发的角色是：${fmt(allowed)}。` +
      `如果这项工作确实需要 ${inline(target)}，把它冒泡给上级，不要绕过花名册。`,
  )
}
