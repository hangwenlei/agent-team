// M3a：阶段推进之后，这一段的产者有没有交代（纯函数，不碰文件系统）。
//
// 这个模块回答 docs/15 §5.1 记下的那个洞。原文形状：at-product 自决不派 at-ui，
// PM 复核后同意，并把裁决写进了 04-dispatch.md（磁盘文件，不是转述）。然后：
//
//   stageRolesInRun(S2, roster) = ["at-product"]  ← roster ∩ producers
//   expandProduces(S2, …)       = ["01-prd.md"]   ← 只剩一份
//   isStageDone(S2)             = true
//   expectedArtifacts 里根本没有 02-ui-spec.md / 02-wireframe.html 这两个名字，
//   compareArtifacts 只遍历 expectedArtifacts → 那两份既不算 missing 也不算
//   unrecorded，连查都没被查。
//
// 根在于：roster 决定「这一趟该有什么」，而 roster 是 PM 在**派发并核实之后**才写的
// ——从来没被派的角色，就从来不被期待，它的缺席因此不可见。
//
// ⚠️ 这条判据**不是** M3a 设计 §2 排除掉的「不管 roster、所有 producers 一律期待」。
// 那一条会打死「按需组队」这个有意的设计（只派两个执行角色的 run 不该被要求交五份
// 实现记录）。差别在于：这里认 trimmed —— 已经**声明过**的裁剪就是交代，不报。
// 问题从来不在「裁剪」，在「裁剪不可机器读」。
//
// ⚠️ 失败策略是**报，不拦**（设计 §3.2 末尾）：调用方 hooks/gate.mjs 把 gaps 拼成
// 一条 additionalContext，与 H5a 同一档，不是 deny。裁剪是合法动作，这条判据只负责
// 把沉默变成一句话；做成 deny 会在「PM 还没来得及写 trimmed」时卡死整条链。
//
// ⚠️ 本模块**不改 isStageDone**（设计 §5 明写排除）。isStageDone 按 roster 收窄是对的
// ——它答的是「这一趟这一段齐了没」；形状 A 由这条判据接住，不是由它。
import { stageRoles, isPlainObject } from './stages.mjs'

/**
 * 「已经走过的阶段」里，有没有哪个产者既不在 roster、也不在 trimmed。
 *
 * **走过的阶段**（判据的定义，先定义后写代码）：出现在 state.history 里、**且不等于
 * state.stage** 的阶段。返工会让一个阶段重新成为当前阶段，那时它不算走过——它正在
 * 被重做，这一段的班底还没定下来。
 *
 * ⚠️ 「不等于 state.stage」这一条，在真实数据上是承重的而不是理论上的：docs/15 §3.8
 * 记的那一趟 history 是 S1→S2→S3→S4→S5→S6→S5→S6→S7→S8，**S5 与 S6 各出现两次**
 * （两轮自发返工，rework 是 {"S5":1,"S6":1}）。所以同一个阶段 id 会在 history 里重复
 * 出现——下面按 seen 去重，否则同一条 gap 会照 history 里的出现次数重复上榜。
 *
 * **交代**（roster ∪ trimmed）：
 *   - 在 roster 里 = 这一趟真的叫到过它；
 *   - 在 trimmed 里 = 这一趟主动不叫它，而且这个决定被写下来了。
 * 两边都不在 = 静默漏掉 → 一条 gap。
 *
 * ⚠️ trimmed 按**键**判，不按「值等于这一段」判。一个角色可能是好几段的产者
 * （去 stages.json 看 at-ui：S2 与 S5 都有它）；按值逐段匹配的话，一次「本趟不用它」
 * 的裁剪会在它出现的每一段各报一次，而那个决定只有一个。trimmed 的值答的是
 * 「在哪一段被裁掉的」，是给人读的出处，不是这条判据的匹配键——M3a 设计 §3.2 的原话
 * 就是「必须在 roster ∪ trimmed 里」。
 *
 * ⚠️ roster 不是数组时按**空集合**算（没有人被记成叫到过），不学 stages.mjs 的
 * stageRolesInRun「退回更宽的集合」那一手。两处的「更宽」方向相反而用意相同——
 * 那边更宽 = 期待更多产物，这边更宽 = 报更多 gap，都是「宁可多算不要漏算」。反过来
 * （roster 坏掉就闭嘴）会给出一条静默通道：把 roster 写成一个非数组就能让这条判据
 * 对整趟失声，而这条判据存在的全部理由就是不要静默。roster 形状本身不合法这件事，
 * hooks/lib/state.mjs 的 validateState 会在同一次回传里另外报一条。
 *
 * gaps 的顺序：按 history 里首次出现的顺序，段内按 stageRoles 的顺序。确定性的，
 * 调用方可以直接 deepEqual。
 *
 * stages / state 形状不对时返回空 gaps，不抛——与本仓库其余纯函数同一口径
 * （「没有可判定的输入」不表态）。
 */
export function decideCoverage({ stages, state } = {}) {
  const gaps = []
  if (!isPlainObject(stages) || !isPlainObject(state)) return { gaps }

  const current = typeof state.stage === 'string' ? state.stage : null
  const invoked = new Set(
    Array.isArray(state.roster) ? state.roster.filter((r) => typeof r === 'string') : [],
  )
  // trimmed 缺失是合法的（向后兼容 M3a 之前落盘的 run，见 validateState 里那一段）：
  // 缺失 = 没有任何声明过的裁剪 = 空集合，不是「判不了、别报」。
  const declared = isPlainObject(state.trimmed) ? new Set(Object.keys(state.trimmed)) : new Set()

  const seen = new Set()
  for (const entry of Array.isArray(state.history) ? state.history : []) {
    if (!isPlainObject(entry) || typeof entry.stage !== 'string') continue
    const id = entry.stage
    if (id === current || seen.has(id)) continue
    seen.add(id)
    // stages[id] 不存在时 stageRoles 返回空数组（它自己有 isPlainObject 守卫），
    // 这一段就不产生 gap——history 里有个不存在的阶段 id 这件事由 validateState 报。
    for (const role of stageRoles(stages[id])) {
      if (invoked.has(role) || declared.has(role)) continue
      gaps.push({ stage: id, role })
    }
  }

  return { gaps }
}
