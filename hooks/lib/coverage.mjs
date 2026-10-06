// M3a：阶段推进之后，这一段的产者有没有交代（纯函数，不碰文件系统）。
//
// 这个模块回答 docs/15 §5.1 记下的那个洞。原文形状：at-product 自决不派 at-ui，
// PM 复核后同意，并把裁决写进了 04-dispatch.md（磁盘文件，不是转述）。然后：
//
//   stageRolesInRun(S2, roster) = ["at-product"]  ← roster ∩ producers
//   expandProduces(S2, …)       = ["01-prd.md"]   ← 只剩一份
//   isStageDone(S2)             = true
//   expectedArtifacts 里根本没有 02-ui-spec.md / 02-wireframe.html 这两个名字 →
//   账本比对的三个清单一个都接不住它们。
//
// ⚠️ **M3a Task 3 改了上面最后一句，别照旧版抄。** 原文写的是「compareArtifacts 只遍历
// expectedArtifacts → 那两份既不算 missing 也不算 unrecorded，**连查都没被查**」——
// **那个机制已经不成立了**：unrecorded 现在走 producedNames(stages)、不按 roster 收窄
// （hooks/lib/artifact-drift.mjs 的 M3a 注释块），这两个名字**是被查了的**。
//
// **结论一个字没变，而且从此不再依赖那个已经不成立的前提**：形状 A 里那两份
// **从来没被写出来**，磁盘上没有 → artifactBytes 返回 null → 仍然什么都不是。
// 换句话说：**问「磁盘上多了什么」的判据，结构上就照不到「从来没写」——不管它的宇宙
// 有多宽。** 把 unrecorded 的宇宙放宽到全部 producers 之后形状 A 依然漏，这件事现在
// 是实测过的，不是推的。
// 所以接住形状 A 的**必须**是一条问「**谁没被交代**」的判据，这个模块因此存在。
//
// 根在于：roster 决定「这一趟该有什么」，而 roster 是 PM 在**派发并核实之后**才写的
// ——从来没被派的角色，就从来不被期待，它的缺席因此不可见。
//
// ⚠️ 这条判据**不是** M3a 设计 §2 排除掉的「不管 roster、所有 producers 一律期待」。
// 那一条会打死「按需组队」这个有意的设计（只派两个执行角色的 run 不该被要求交五份
// 实现记录）。差别有两处：认 trimmed（已经**声明过**的裁剪就是交代），以及下面
// Ruling 2 那条把宇宙收窄到 available_roles。问题从来不在「裁剪」，在「裁剪不可机器读」。
//
// ⚠️ 失败策略是**报，不拦**（设计 §3.2 末尾）：调用方 hooks/gate.mjs 把 gaps 拼成
// 一条 additionalContext，与 H5a 同一档，不是 deny。裁剪是合法动作，这条判据只负责
// 把沉默变成一句话；做成 deny 会在「PM 还没来得及写 trimmed」时卡死整条链。
//
// ⚠️ 本模块**不改 isStageDone**（设计 §5 明写排除）。isStageDone 按 roster 收窄是对的
// ——它答的是「这一趟这一段齐了没」；形状 A 由这条判据接住，不是由它。
// ⚠️ M3x（docs/32）订正上一句的前提：「按 roster 收窄」对多段角色不对——at-ui 在 S2 进过 roster，S5 就把它当成 S5 的产者。
// 现在两边都按段：isStageDone 的每一处调用与本模块都经 participantsOf 取「那一段叫到了谁」（state.json 的 stage_roles，
// 旧 run 退回 roster）。分工没变：齐没齐归 isStageDone，谁没交代归这里。
import { stageRoles, isPlainObject, participantsOf } from './stages.mjs'
import { dispatchedIn } from './advance.mjs'

/**
 * 「已经走过的阶段」里，有没有哪个**这个项目用得上**的产者，既不在那一段叫到的人里（participantsOf：带 stage_roles
 * 时取 stage_roles[那一段]，旧 run 退回 roster），也不在 trimmed 里。
 *
 * 返回 `{ gaps, narrowed, perStage }`。`narrowed` 说的是「这一次到底有没有按 available_roles
 * 收窄」——调用方要靠它决定留不留痕、要不要在文案里说清口径比平时宽。`perStage` 说的是这一次有没有按段判
 * （state.stage_roles 是普通对象时为真，与 participantsOf 的开关同一个）——文案据此决定头一句怎么说、给不给补记那条出路。
 *
 * ---
 *
 * **走过的阶段**（判据的定义，先定义后写代码）：出现在 state.history 里、**且不等于
 * state.stage** 的阶段。返工会让一个阶段重新成为当前阶段，那时它不算走过——它正在
 * 被重做，这一段的班底还没定下来。
 * M3y（docs/33）再加一条：**当前段在阶段链上时，链上晚于它的段也不算走过**。回退之后那些段要重走，这一轮的班底同样
 * 还没定下来；一段没走完就回退（S5 里发现设计错回 S3）时，那一段还没派到的产者否则会在 S3、S4 每写一次 state.json 就被
 * 点一次名，而三条出路一条都不对。等重走过它、推进出去，照常查。首轮 history 只往前走，没有晚于当前段的段，不受影响。
 *
 * ⚠️ 「不等于 state.stage」这一条，在真实数据上是承重的而不是理论上的：docs/15 §3.8
 * 记的那一趟 history 是 S1→S2→S3→S4→S5→S6→S5→S6→S7→S8，**S5 与 S6 各出现两次**
 * （两轮自发返工，rework 是 {"S5":1,"S6":1}）。所以同一个阶段 id 会在 history 里重复
 * 出现——下面按 seen 去重，否则同一条 gap 会照 history 里的出现次数重复上榜。
 * 【M3y 订正（docs/33 §1）：上面括号里「两轮」不对，那一趟只有一次返工（S6 测试没过回 S5）。rework.S6 是 1，是因为回到 S6
 *  时 S6 在 history 里第二次出现、H6 按派生量要它加 1——转录里 PM 推进时 rework 里没写 S6，被 H6 按 0 拒掉，补上 S6: 1 才通过。同一个阶段 id
 *  在 history 里重复出现这件事照样成立。】
 *
 * ⚠️ 同一条口径还有**第二个后果，上面那段没说**（M3a 全分支终审 Minor-1）：
 * **链尾那一段永远不算走过**——它停下来的时候自己就是 state.stage，之后没有下一段把它
 * 推出去。所以 stageRoles(链尾) 里的角色**结构上进不了这条判据的宇宙**。
 * 今天零可观测：链尾是 S8，它只写了 role: "at-pm"，而 at-pm 本来就被 available_roles
 * 挡在宇宙外。**哪天链尾那一段有了 at-pm 以外的产者，它们会整段静默掉出去**
 * ——完整记录与可观测的失效条件见 docs/11 §5.25。
 *
 * ⚠️ **本函数为这件事一个字都没改，也不该改**（零可观测差异的改动没有测试能钉住它，
 * docs/16 §3.3 第三行）。**钉着的是那条边界的前提**：tests/coverage.test.mjs 末尾那一组
 * 从 stages.json 派生链尾（走 state.mjs 的 nextStage），断言它除 at-pm 外没有别的产出
 * 角色。**它红不是要你改那条断言，是 §5.25 记的那条边界刚从「零可观测」变成「真的在漏」。**
 *
 * **宇宙**（Ruling 2）：`stageRoles(S) ∩ availableRoles`。
 * availableRoles 就是 .agent-team/project.json 的 `available_roles`——「**这个项目用得上
 * 哪些执行角色**」，由 /agent-team:at-init 写。它把**项目配置**与**运行时决定**分开：
 *
 *   - 一个不在 available_roles 里的角色（真实那一趟的 at-ios / at-android）**从来没上过队**，
 *     不存在一个关于它的「裁剪」决定。要求 PM 为它写一条 trimmed，等于要求把一个不存在
 *     的决定写下来——而设计 §3.1 的立论恰恰是「把**已经存在**的决定变成可机器读的」。
 *     不收窄的话，真实终局数据上报出来的那几条里，**at-ios 与 at-android 是这一类**
 *     （那一趟的 available_roles 里没有它们）；收窄之后剩下的全是**同一个角色 at-ui 的
 *     同一个决定**（S2 与 S5 各一条，因为它在两段都是产者），写一行 trimmed 一起消失。
 *
 *     ⚠️ 这里**不报总数**（docs/16「列举，不报总数」）。上一版写的是「四条里有三条是
 *     这种；收窄之后是两条」——**自相矛盾**（4 − 3 = 1 ≠ 2），而且实测那一类是**两个**
 *     角色不是三条。M3a Task 4 的定向复评抓出来的，而本轮一度把那句原话逐字搬进了
 *     tracked 的设计与计划**而没有重核**。列举 at-ios / at-android 就够，
 *     它们才是「不是决定」的那一类。
 *   - `at-pm` 因此**自动退出宇宙**，不需要为它开特例：
 *     `commands/at-init.md` 明令「不要写 at-pm：它是每一趟的驱动者，不参与『有没有被叫到』
 *     的统计」，`tests/templates.test.mjs` 对模板钉着同一句话。
 *
 * ⚠️ **这条注释要留下的那个事实**（收窄之后它不再是问题，但它解释了为什么下面这件事
 * 看起来别扭）：`roster` 不是「这一趟有谁在」，是「**叫到过谁**」。`commands/at.md`
 * 第 4 步写的是「把这一段真正**叫到**的角色累加进 roster」，而 **S1 / S4 / S8 是 PM
 * 自己做的、没有「派发」这个动作**——所以在真实 run 里，S2 推到 S3 那一刻 `roster`
 * 逐字就是 `["at-product"]`，**不含 at-pm**（docs/15 §5.1 第 3 点，记录级）。
 * 下一个人看到「at-pm 是 S1 的产者却不在 roster 里」会先愣一下：不是记漏了，是 roster
 * 答的本来就不是那个问题。
 *
 * **交代**（那一段叫到的人 ∪ trimmed）：
 *   - 在那一段叫到的人里 = 这一段真的叫到过它（旧 run 就是 roster：这一趟真的叫到过它）；
 *     ⚠️ M3x（docs/32）：带 stage_roles 的 run 按段取——在 stage_roles[这一段] 里 = 这一段真的叫到过它。at-ui 在 S2
 *     叫过，不替它在 S5 交代（整趟 roster 下那一格看不见，docs/11 §5.22 B 格）。取法是 participantsOf：没有
 *     stage_roles 的旧 run 退回 roster；有字段、没这一段的键 = 这一段没记账 = 空集，不退回 roster。返回值的
 *     perStage 说的就是这一次按没按段判，文案据此决定给不给「补记 stage_roles」那条出路。
 *   - 在 trimmed 里 = 这一趟主动不叫它，而且这个决定被写下来了。
 * 两边都不在 = 静默漏掉 → 一条 gap。
 *
 * ⚠️ trimmed 按**键**判，不按「值等于这一段」判。一个角色可能是好几段的产者
 * （去 stages.json 看 at-ui：S2 与 S5 都有它）；按值逐段匹配的话，一次「本趟不用它」
 * 的裁剪会在它出现的每一段各报一次，而那个决定只有一个。trimmed 的值答的是
 * 「在哪一段被裁掉的」，是给人读的出处，不是这条判据的匹配键——M3a 设计 §3.2 的原话
 * 就是「必须在 roster ∪ trimmed 里」。
 *
 * ---
 *
 * **两种退化，方向相同：宁可多算不要漏算，一次都不要因为读不到东西而闭嘴。**
 *
 * ⚠️ availableRoles 不是可用的非空字符串数组时（project.json 不在、读不出、没有这个
 * 键、写成了别的类型、或者是空数组）→ **不收窄**，`narrowed: false`，按全部 stageRoles
 * 算。不是「收窄成空集合、于是永不报」：那会让「把 available_roles 删掉」成为一条静默
 * 通道，而这条判据存在的全部理由就是不要静默。空数组同理——「没告诉我这个项目有谁可用」
 * 不等于「这个项目一个角色都没有」。调用方**必须**据此留痕并在文案里说明口径变宽了。
 *
 * ⚠️ roster 不是数组时按**空集合**算（没有人被记成叫到过），不学 stages.mjs 的
 * stageRolesInRun「退回更宽的集合」那一手。两处的「更宽」方向相反而用意相同——
 * 那边更宽 = 期待更多产物，这边更宽 = 报更多 gap。反过来（roster 坏掉就闭嘴）同样是
 * 一条静默通道。roster 形状本身不合法这件事，hooks/lib/state.mjs 的 validateState 会在
 * 同一次回传里另外报一条。
 *
 * gaps 的顺序：按 history 里首次出现的顺序，段内按 stageRoles 的顺序。确定性的，
 * 调用方可以直接 deepEqual。
 *
 * stages / state 形状不对时返回空 gaps，不抛——与本仓库其余纯函数同一口径
 * （「没有可判定的输入」不表态）。
 */
// M4g（docs/42，docs/39 §3「产者交代不并派发记录」）：dispatched 是门禁派发记录按段归的角色（{ 段: [角色] }，可选）。H6 判「叫过」时
// 早就并上了它，这里原来只看 stage_roles（旧 run 是 roster）与 trimmed：PM 把「叫到」读窄（只记自己亲手派的）时，被下级派出去、真交了
// 产物的角色报出来的话与真漏派逐字相同（docs/11 §5.24）。派发记录里有它在那一段被派出去过的，gap 标 dispatched: true——它被叫到过，
// 只是没记账，调用方单列成「漏记」，出路只有补记；别的段派过不算。不并进 invoked 一声不吭：那样 stage_roles 永远记窄，
// /agent-team:at-status 与 at-qa 按它展开产物时就漏了这个人。
export function decideCoverage({ stages, state, availableRoles, dispatched = null } = {}) {
  const gaps = []
  const perStage = isPlainObject(state) && isPlainObject(state.stage_roles)
  const usable = Array.isArray(availableRoles)
    ? availableRoles.filter((r) => typeof r === 'string')
    : []
  const narrowed = usable.length > 0
  const universe = narrowed ? new Set(usable) : null

  if (!isPlainObject(stages) || !isPlainObject(state)) return { gaps, narrowed, perStage }

  const current = typeof state.stage === 'string' ? state.stage : null
  // M3y：链上晚于当前段的段不算走过（头部「走过的阶段」那一段）。当前段不在链上时不按链序剪。
  const ids = Object.keys(stages)
  const currentAt = current !== null && Object.hasOwn(stages, current) ? ids.indexOf(current) : -1
  // 「这一段叫到了谁」逐段取（participantsOf）。它给 undefined（旧 run 的 roster 不是数组）时按空集合算——下面那段
  // 「roster 不是数组时按空集合算」的理由原样适用。
  const invokedIn = (id) => {
    const who = participantsOf(state, id)
    return new Set(Array.isArray(who) ? who : [])
  }
  // trimmed 缺失是合法的（向后兼容 M3a 之前落盘的 run，见 validateState 里那一段）：
  // 缺失 = 没有任何声明过的裁剪 = 空集合，不是「判不了、别报」。
  const declared = isPlainObject(state.trimmed) ? new Set(Object.keys(state.trimmed)) : new Set()

  const seen = new Set()
  for (const entry of Array.isArray(state.history) ? state.history : []) {
    if (!isPlainObject(entry) || typeof entry.stage !== 'string') continue
    const id = entry.stage
    if (id === current || seen.has(id)) continue
    if (currentAt >= 0 && ids.indexOf(id) > currentAt) continue
    seen.add(id)
    const invoked = invokedIn(id)
    const logged = new Set(dispatchedIn(id, dispatched))
    // stages[id] 不存在时 stageRoles 返回空数组（它自己有 isPlainObject 守卫），
    // 这一段就不产生 gap——history 里有个不存在的阶段 id 这件事由 validateState 报。
    for (const role of stageRoles(stages[id])) {
      if (universe && !universe.has(role)) continue
      if (invoked.has(role) || declared.has(role)) continue
      gaps.push(logged.has(role) ? { stage: id, role, dispatched: true } : { stage: id, role })
    }
  }

  return { gaps, narrowed, perStage }
}
