// 账本比对（纯函数）。规格 §6.2 的「内容比对」补偿。
//
// ⚠️ 这是**审计产物，不是安全边界**，与 hooks/lib/reach.mjs 的触达表同一个性质。
// 它**不阻止**任何人伪造产物，只让伪造**留下痕迹**。
//
// 为什么需要它：规格 §6.2 要求执行角色保留 Bash 跑构建与测试，而 §3.3.1 的上界模型意味着
// 给执行角色就必须同时给 at-pm（M1c 设计 §1.1）。PM 因此能经 §6.2 那条「Bash 是软约束」
// 的口子 echo > 01-prd.md 绕过 H3——docs/09 账一 #2「它没有放开伪造」自此不再完整成立
// （规格 §6.2.1 记了这次论证降级）。
//
// 拦不住，所以不拦：**把「谁写的」这个拦不住的问题，换成「写出来的东西对不对得上账」
// 这个算得出来的问题。** 三个清单各对应一种对不上：
//   drifted     记录了、磁盘上也有，但内容变了 —— 产物在记账之后被改过
//   missing     记录了、磁盘上没有         —— 产物被删了或从没写成
//   unrecorded  磁盘上有、账本里没有       —— **Bash 绕过 H3 的直接表征**
//
// 真要伪造的人可以连 artifacts 一起改（任何持有 Bash 的角色都写得了——state.json 对
// Edit/Write 只对 PM 开，但 Bash 不经任何 hook；本轮 at-backend/at-frontend 也拿到了
// Bash，不再是只有 PM 一个人做得到，见评审发现 1）。但那时它不再是「顺手绕过」，而是一次
// 需要同时改两处的刻意行为。**这条边界必须如实说，不要把它说成防护。**
//
// 哈希用 contract-hash.mjs 的 sha256OfContract，不另写一个：它的归一化（剥 BOM、
// CRLF → LF）对所有文本产物都是对的，同一份文件在 Windows 与 POSIX 之间来回时不该产生
// 假漂移。两份逐字相同的哈希实现真的会分叉，这个仓库为此开过好几轮循环（见 path-norm.mjs
// 头部）。
import { sha256OfContract } from './contract-hash.mjs'
import { expectedArtifacts } from './stages.mjs'

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function compareArtifacts({ artifacts, stages, artifactBytes, roster }) {
  const empty = { drifted: [], missing: [], unrecorded: [] }
  if (typeof artifactBytes !== 'function') return empty
  const recorded = isPlainObject(artifacts) ? artifacts : {}
  if (!isPlainObject(stages)) return empty

  // M2a：从 producedNames（全部可能的产物名，<role> 按全部 producers 展开）换成
  // expectedArtifacts（这一趟该有的，<role> 只按 roster ∩ producers 展开）。两者
  // 答的是不同的问题，见 stages.mjs 头部；用错会让没派到的角色的产物被报成
  // missing——S5 只派了 at-backend 一个人的 run，账本比对不该因为
  // 05-impl/at-frontend.md 不存在就报它 missing，那个角色这一趟压根没被派。
  // roster 缺省时 expectedArtifacts 退回全部 producers，与旧行为（producedNames）
  // 一致——S1–S4/S6–S8 没有 producers，不受这次改动影响。
  const produced = expectedArtifacts(stages, roster)

  const out = { drifted: [], missing: [], unrecorded: [] }
  for (const name of produced) {
    const bytes = artifactBytes(name)
    const has = Object.hasOwn(recorded, name)
    if (!has) {
      // 磁盘上有、账本里没记。磁盘上也没有的话什么都不是——那只是还没做到这一段。
      if (bytes !== null) out.unrecorded.push(name)
      continue
    }
    if (bytes === null) {
      out.missing.push({ name, recorded: recorded[name] })
      continue
    }
    const actual = sha256OfContract(bytes)
    if (actual !== recorded[name]) out.drifted.push({ name, recorded: recorded[name], actual })
  }
  return out
}
