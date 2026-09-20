// 「实际写入触达」的纯函数（规格 §6.4 / docs/09-M1b-入口决策.md 账二）。
//
// 角色 R 的实际写入触达 = R 自己认领的路径 ∪ R 能（传递地）派发到的所有角色认领的
// 路径。实测来源是 docs/04 §9 ①：at-product 被 H3 拒绝写 src/web/x.ts 之后，没有
// 任何人要求它这么做，它当场把同一个写入转手派发给那条路径的合法拥有者
// at-frontend——挡住它的是 H1（花名册里没有那条边），不是 H3。
//
// ⚠️ 这是**审计产物，不是安全边界**。它不拦任何东西，也不该被说成「限制」。
// 输出的措辞一律是「当前配置下，各角色实际能写到哪些地方」。加一道闸为什么不对，
// 三条理由见 docs/09 账二（会拦掉正当的层级协调；判据在派发那一刻不存在；闸越多
// 越容易互相拆台）。这里缺的不是拦截，是**可见性**：没人算过这个数，所以没人发现
// 它变了。
//
// 纯数据推导，不碰文件系统——跟 decideDelegation / decideWritePath 同一层，能脱离
// Claude Code 单测。
//
// ⚠️ 这一段原本写的是「**不 import 任何东西**、不碰文件系统」。M2b 终审 A2 把本模块
// 私有的那份 isPlainObject 换成了 import，那半句当场变假，所以一并改掉——不留一句
// 「活过了自己的更正」的旧话（本分支为这个形状开过六轮）。换来的性质没有变：
// stages.mjs 自己不 import 任何东西、也不碰文件系统，这里仍然是纯数据推导。
import { isPlainObject } from './stages.mjs'

export function computeReach({ roster, paths }) {
  const out = {}
  if (!isPlainObject(roster)) return out
  const owners = isPlainObject(paths) ? paths : {}
  // project.json 是用户手写的配置，形状不该指望它总是对的——某个角色的值写成字符串
  // 或 null 时当作「没认领任何路径」，不抛（与 writepath.mjs 的 underAny 同一种防御）。
  const ownOf = (role) => (Array.isArray(owners[role]) ? owners[role] : [])

  for (const role of Object.keys(roster)) {
    const own = ownOf(role)
    const reach = new Set(own)
    const widenedBy = {}
    const reachableRoles = []

    // BFS。visited 一开始就放进 role 自己，于是同时挡住了两件事：
    //   - 环（A → B → A）不会死循环；
    //   - 自引用（A → A）不会把自己算成「被自己扩大」。
    // 用 BFS 而不是 DFS 是为了 widenedBy 记的是**最短**那条派发链——/at-status 要
    // 「指明是经哪条派发边扩大的」，给最短的那条最有用。
    const visited = new Set([role])
    const queue = [{ name: role, path: [role] }]
    while (queue.length) {
      const { name, path } = queue.shift()
      const entry = roster[name]
      const edges = isPlainObject(entry) && Array.isArray(entry.can_delegate_to)
        ? entry.can_delegate_to
        : []
      for (const next of edges) {
        if (visited.has(next)) continue
        visited.add(next)
        const nextPath = [...path, next]
        reachableRoles.push(next)
        for (const prefix of ownOf(next)) {
          // 已经在 reach 里的前缀不记 widenedBy：可能是自己认领的（那就不是扩大），
          // 也可能是更短的一条链先带进来的（那条才是该报的）。
          if (reach.has(prefix)) continue
          reach.add(prefix)
          widenedBy[prefix] = nextPath.join(' → ')
        }
        // 花名册里查不到的目标照样入队——闭包不变量（tests/roster-closure.test.mjs）
        // 本该禁止这种边，但这个函数不假设那条不变量成立。下一轮 roster[next] 取不到
        // 条目，edges 为空，自然终止。
        queue.push({ name: next, path: nextPath })
      }
    }

    out[role] = {
      own,
      reachableRoles,
      reach: [...reach],
      widenedBy,
      widened: Object.keys(widenedBy).length > 0,
    }
  }
  return out
}
