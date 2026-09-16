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
import { resolve, sep } from 'node:path'
import { MAIN, callerOf } from './decide.mjs'

const CONTRACT = '00-contract.md'

function norm(p) {
  // 归一化并统一分隔符，防止 .. 与斜杠差异绕过路径比对——跟
  // hooks/lib/writepath.mjs 的同名函数逻辑完全一样。两份重复是有意的：
  // 这几行只是通用的 Windows 路径大小写/分隔符语义，不会因为"写路径隔离"
  // 和"契约保护"各自的业务规则演化而分叉；这个代码库里纯函数决策模块本来
  // 就不互相 import 对方的私有辅助函数（writepath.mjs 与 readiness.mjs
  // 之间也没有）。抽一个公共模块换来的解耦收益，抵不过多一层间接、多一个
  // 要维护的文件——对这三行不值得。
  const resolved = resolve(p).split(sep).join('/')
  // Windows 文件系统大小写不敏感，但 resolve() 保留调用方给的原始大小写；
  // runDir 最终来自 process.cwd()、filePath 来自工具调用方给的
  // file_path/notebook_path，两者不同源，大小写可能对不齐。不折叠大小写
  // 的后果方向比 writepath.mjs 那边更危险：那边判错是"多拦"（挡住自己人，
  // 见该文件 Important 1 的注释）；这里判错是"漏拦"——一次真实的契约写入
  // 因为盘符或路径段大小写没对齐，被误判成"目标不是契约文件"从而放行，
  // 等于这道闸自己被绕过去了。POSIX 文件系统大小写敏感，不对它做这个
  // 转换。
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function decideContractGuard({ agentType, filePath, runDir }) {
  // 没有 runDir 就没有"契约在哪"这件事可言，不表态——正常情况下 gate.mjs
  // 只会在 ctx.ok 为 true（这时才有真实 runDir）时调用到这里，这一行是
  // 纯函数自己的防线，不依赖调用方守规矩。
  if (!runDir) return { decision: 'allow' }
  if (typeof filePath !== 'string' || !filePath) return { decision: 'allow' }

  // 谁算"PM/主线程"：真正的主线程（没有 agent_type）、以及被 settings.json
  // 的 agent 键钉成主线程的 at-pm——本仓库自己的 settings.json 就是
  // {"agent": "at-pm"}，钉住时该会话自己的工具调用会带裸的
  // agent_type: 'at-pm'（M0 实测「次要事实」，docs/05-M0-结论.md 第 193
  // 行），不是真正意义上"没有 agent_type"，但语义上仍是同一个会话、同一个
  // PM，不是经 Agent 工具派出去的另一个执行上下文。H3 已经认了这一点：
  // stages.json 里 S1.role === 'at-pm'，钉住的 at-pm 写 00-contract.md 被
  // decideWritePath 判定为写自己阶段的 produces，允许（tests/gate-writepath.
  // test.mjs「被 settings.json 钉成主线程的 at-pm...写...00-contract.md
  // 不受阻」）。H4 若只认"无 agent_type"，本仓库这种钉住配置下契约会永远
  // 写不出来——规格 §5.3 连用户的升级答复都要"作为带日期的修订块追加进
  // 00-contract.md"，那也是 PM 转写的动作，同样会被堵死。这是真的功能
  // 断裂，不是更保守的选择。用 callerOf 而不是自己重写一遍"undefined/null
  // 才算主线程"，是为了跟 H1/H3 共用同一个权威定义，不在这里另开一份可能
  // 漂移的副本；callerOf 内部已经处理了插件前缀（裸 'at-pm' 与
  // 'agent-team:at-pm' 剥完是同一个值），这里不需要重复处理。
  const caller = callerOf({ agent_type: agentType })
  if (caller === MAIN || caller === 'at-pm') return { decision: 'allow' }

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
