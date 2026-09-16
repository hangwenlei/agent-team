// H4 契约保护（纯函数）。规格 §5.3：契约唯一写者是用户，经 PM（项目经理）
// 在主会话里转写；任何 subagent 不得写 00-contract.md。fail closed。
//
// 为什么这不是一条普通校验：S1 把用户原话固化进 00-contract.md，S7 验收前
// 拿它的哈希对账（规格 §4.2「① 契约冻结 + 哈希防漂移」）。如果执行角色能
// 自己改契约，"做出来的东西是否符合契约"这件事就永远查不出来——角色可以
// 悄悄把契约改成跟自己做出来的东西一致，制造出验收通过的假象。这是这个
// 插件存在的理由之一，不是一条普通校验。
//
// 判定只看两件事：调用者是不是"PM/主线程"、目标路径是不是契约文件本身——
// 不读 project.json、不读 stages.json，因此不依赖 H3（写路径隔离）的任何
// 前提。project.json 缺失时 decideWritePath 第一行就整体放行（见
// hooks/lib/writepath.mjs），H4 仍要独立拦住契约写入；两道闸挂在同一组
// matcher（Edit|Write|NotebookEdit）上，判据不同，不是重复
// （Task 5 简报「一个你必须自己想清楚的点」）。
// 路径归一化用公共实现，不在这里另留一份（整理项 5）。此前这里有一份与
// writepath.mjs 逐字相同的 norm()，附带一段"重复是有意的、不会分叉"的论证；
// I1 证明了那两个文件的假设确实会分叉，而这一侧判错的方向是**漏拦**（大小写
// 没对齐 → 真实的契约写入被判成"目标不是契约文件"而放行，这道闸自己被绕过），
// 是安全洞不是噪音。完整论证见 hooks/lib/path-norm.mjs 头部。
import { norm } from './path-norm.mjs'
import { MAIN, callerOf } from './decide.mjs'

const CONTRACT = '00-contract.md'

// 谁算"PM/主线程"，因而对 00-contract.md 没有约束：真正的主线程（没有
// agent_type）、以及被 settings.json 的 agent 键钉成主线程的 at-pm——
// 本仓库自己的 settings.json 就是 {"agent": "at-pm"}，钉住时该会话自己的
// 工具调用会带裸的 agent_type: 'at-pm'（M0 实测「次要事实」，
// docs/05-M0-结论.md 第 193 行），不是真正意义上"没有 agent_type"，但语义
// 上仍是同一个会话、同一个 PM，不是经 Agent 工具派出去的另一个执行上下文。
// H3 已经认了这一点：stages.json 里 S1.role === 'at-pm'，钉住的 at-pm 写
// 00-contract.md 被 decideWritePath 判定为写自己阶段的 produces，允许
// （tests/gate-writepath.test.mjs「被 settings.json 钉成主线程的
// at-pm...写...00-contract.md 不受阻」）。若只认"无 agent_type"，本仓库
// 这种钉住配置下契约会永远写不出来——规格 §5.3 连用户的升级答复都要"作为
// 带日期的修订块追加进 00-contract.md"，那也是 PM 转写的动作，同样会被
// 堵死。这是真的功能断裂，不是更保守的选择。
//
// 为什么可以把 at-pm 和 MAIN 同等对待（规格依据）：§5.3 原话是"契约唯一
// 写者是用户（经 PM 转写）"——PM 就是那个被授权写契约的人，钉住配置下
// at-pm 就是 PM 本人，不是另一个身份。
//
// 这条豁免的安全性依赖什么（评审 Task 5 顾虑 1）：hook 输入本身分不清
// "被钉成主线程的 at-pm"和"被别人派发出来的 at-pm 子代理"——两者的
// agent_type 都是裸的 'at-pm'，这个函数拿到的只是一个字符串，看不出
// 背后的调用形态。这条豁免因此不是自己成立的，靠的是花名册闭包这个
// 结构性不变量：当前 roster.json 里没有任何角色的 can_delegate_to 包含
// at-pm（tests/roster-closure.test.mjs「没有任何角色能把 at-pm 当作
// 派发目标」钉住这条），所以"at-pm 作为被派发出来的子代理出现"这条
// 路径在当前花名册下根本不存在——能带着 agent_type: 'at-pm' 走到这里的，
// 只可能是被钉住的主线程。**如果将来有人往某个角色的 can_delegate_to
// 里加了 at-pm，这条豁免就会同时放行一个真正的子代理，必须回来重新
// 评估**，不能继续假设 at-pm 只可能是 PM。
//
// 用 callerOf 而不是自己重写一遍"undefined/null 才算主线程"，是为了跟
// H1/H3 共用同一个权威定义，不在这里另开一份可能漂移的副本；callerOf
// 内部已经处理了插件前缀（裸 'at-pm' 与 'agent-team:at-pm' 剥完是同一个
// 值），这里不需要重复处理。
//
// 单独导出成一个谓词（不是写在 decideContractGuard 内联判断里），是因为
// hooks/gate.mjs 的入口路径需要在读运行上下文之前就做同一个判断（Task 5
// 评审顾虑 2）——调用者是 PM 时 H4 对这次调用根本没有意见，跟 ctx 读不读
// 得出来无关，这条短路必须排在 readRunContext 之前，不能等到 decideContract
// Guard 里才判。gate.mjs 与下面 decideContractGuard 内部都调用这同一个
// 函数：不这样做的话，"谁算 PM"这条判断——包括 'at-pm' 这个字面量和它背后
// 的花名册依赖——就要在两个文件里各写一份，将来改判断标准容易改一处、
// 漏一处（Task 5 评审 Important 1）。这不是说两处调用点本身多余：gate.mjs
// 的短路一旦命中就 exit(0)，decideContractGuard 内部这次调用从 gate.mjs
// 这条入口路径上确实永远走不到第二遍；但 decideContractGuard 是导出的
// 纯函数，任何调用方都可能不经过 gate.mjs 直接调用它——
// tests/contract-guard.test.mjs 的简报给定用例（`agentType: undefined` →
// allow）就是这样测的，不经过 gate.mjs 的短路——所以内部这次调用不是
// 摆设，是这个函数自身对"不管谁调用我都要给对答案"的契约，两处调用点
// 各自服务不同的调用面（gate.mjs 入口路径 vs. 直接单测/未来的其它调用方）。
export function isContractWriter(agentType) {
  const caller = callerOf({ agent_type: agentType })
  return caller === MAIN || caller === 'at-pm'
}

export function decideContractGuard({ agentType, filePath, runDir }) {
  // 没有 runDir 就没有"契约在哪"这件事可言，不表态——正常情况下 gate.mjs
  // 只会在 ctx.ok 为 true（这时才有真实 runDir）时调用到这里，这一行是
  // 纯函数自己的防线，不依赖调用方守规矩。
  if (!runDir) return { decision: 'allow' }
  if (typeof filePath !== 'string' || !filePath) return { decision: 'allow' }
  if (isContractWriter(agentType)) return { decision: 'allow' }

  if (norm(filePath) !== norm(`${runDir}/${CONTRACT}`)) return { decision: 'allow' }

  return {
    decision: 'deny',
    reason:
      `不得写 ${CONTRACT}。契约是这趟 run 唯一的需求基线，只能由用户改、经 PM（项目经理）` +
      `在主会话里转写——任何 subagent 都不能碰它。如果执行角色能自己改契约，"做出来的东西` +
      `是否符合契约"这件事就永远查不出来：契约可以被悄悄改成跟已经做出来的东西一致，制造出` +
      `验收通过的假象，S7 验收环节拿它的哈希对账也就失去意义。如果你认为契约本身有问题` +
      `（比如自相矛盾、有遗漏、需要取舍），把问题冒泡给上级，由 PM 决定是否要升级给用户` +
      `裁决，不要自己动手改契约。`,
  }
}
