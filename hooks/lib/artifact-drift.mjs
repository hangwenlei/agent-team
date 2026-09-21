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
// isPlainObject 也走 stages.mjs 同一份（M2b 终审 A2）——它原来是这里的私有拷贝，与
// reach.mjs / rework-guard.mjs / state.mjs / gate.mjs 共五份。理由与上面那段哈希实现
// 一字不差：手写的多条件布尔表达式有变体空间，两份逐字相同的实现真的会分叉。
import { expectedArtifacts, isPlainObject, producedNames } from './stages.mjs'

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
  // roster 缺省时 expectedArtifacts 退回全部 producers，与旧行为（producedNames）一致；
  // **没有 producers 的阶段**在任何 roster 下都不受这次改动影响。
  //
  // ⚠️ M2b 终审 B2（2026-09-20）：上面那半句原来写的是「**S1–S4/S6–S8** 没有 producers，
  // 不受这次改动影响」——**假**，而且是承重的假。M2b 给 S2 加了
  // producers: ["at-product","at-ui"]，S2 就在枚举的「S1–S4」里面：roster 一旦真的传进来，
  // S2 的产物集合当场变成 roster ∩ producers 驱动的。M2b Task 2 报告记着这件事的实物
  // ——makeRun() 的 roster 缺省值 [] 让四条测试当场变红，正是因为 S2 不再「不受影响」。
  // 改成按条件说、不枚举阶段号。同族另外三处（deliverable/writepath/state）一并改了。
  //
  // ⚠️ M3a Task 3（2026-09-20）：上面这整段理由**只管 drifted / missing 了**，不再管
  // 第三个清单。它们问的是「**这一趟**该有的对不对得上」，roster 就是对的口径，
  // 这一支一个字没改。
  const expected = expectedArtifacts(stages, roster)

  // M3a Task 3（设计 §3.3）：**unrecorded 脱离 roster 收窄，三个清单不再共用一个宇宙。**
  //
  // 理由全部写在本文件头部那张表里，它给 unrecorded 的定义逐字是：
  //
  //     unrecorded  磁盘上有、账本里没有       —— **Bash 绕过 H3 的直接表征**
  //
  // 而一个按 roster 收窄的 unrecorded **看不见一个还没进 roster 的角色写出来的任何
  // 东西**——commands/at.md 第 4 步在**派发并核实之后**才累加 roster，所以产物落盘的
  // 那一刻，roster 必然还不含写它的那个人。**判据与它自己声明的用途矛盾。**
  // 真实形状见 docs/11 的「同一条洞在 S5 上的第二种形状」：S5 两份实现记录已经落盘、
  // 角色还没被写进 roster，这个清单对它们是瞎的。
  //
  // **所以这不是加功能，是让它回到已经写明的用途**：它问的是「磁盘上有谁没交代的
  // 东西」，而这个问题从来就不该被 roster 闸住。
  //
  // ⚠️ 一个循环、每个名字最多读一次磁盘，**不是两个循环各扫一遍**：两遍扫是重复 I/O，
  // 而且「哪些名字算数」会分成两份各自漂。能这么写是因为
  // **expectedArtifacts(stages, roster) ⊆ producedNames(stages)**——两者走同一个
  // expandProduces，前者的角色集合（stageRolesInRun = stageRoles ∩ roster）是后者
  // （stageRoles）的子集。于是宽的那个当唯一的遍历面，收窄退化成循环里的一个判定。
  const out = { drifted: [], missing: [], unrecorded: [] }
  for (const name of producedNames(stages)) {
    if (!Object.hasOwn(recorded, name)) {
      // 磁盘上有、账本里没记。磁盘上也没有的话什么都不是——那只是还没做到这一段。
      // 这一支**不看 roster**，就是上面那段的全部内容。
      if (artifactBytes(name) !== null) out.unrecorded.push(name)
      continue
    }
    // 记了。下面两支是 drifted / missing，**roster 口径在这里没变**：账本里记着一份
    // 这一趟没派的角色的产物，不算「对不上账」——那正是 M2a 那段注释防的东西。
    if (!expected.has(name)) continue
    const bytes = artifactBytes(name)
    if (bytes === null) {
      out.missing.push({ name, recorded: recorded[name] })
      continue
    }
    const actual = sha256OfContract(bytes)
    if (actual !== recorded[name]) out.drifted.push({ name, recorded: recorded[name], actual })
  }
  return out
}
