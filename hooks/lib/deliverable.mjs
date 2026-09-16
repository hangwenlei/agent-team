// H5 交付物校验（纯函数）。不碰文件系统——artifactExists 由调用方注入，
// 这样它能脱离 Claude Code 与磁盘单测（跟 hooks/lib/readiness.mjs 的
// decideReadiness 是同一个理由）。
//
// 同一份判定喂两条 hook：
//   H5b（SubagentStop）拿它做真拦截，把角色顶回去补产物；
//   H5a（PostToolUse）拿它记权威 warning。
// 两道缺一不可——平台对 SubagentStop 的重试有上限，实测约 9 次后会静默
// 放行且父级无感（M1·U5 实测，docs/07-U5-U6-U8-实测结论.md §1），单靠
// H5b 会在平台放弃那一刻制造一个假的「一次通过」信号。失败策略见规格
// §6：H5 两道都是流程辅助、fail open，不做安全边界。
//
// 这个函数与 decideReadiness 面对同一份 stages.json，实现也用同一条迭代
// 规则：取该角色**第一个 produces 未齐的阶段**。三条边界里有两条确实对齐：
//   - 角色不在任何阶段里：mine 为空，视为没有交付物义务，ok。跟
//     decideReadiness 的 mine.length === 0 → allow 一致。
//   - produces 为空/缺失的阶段视为跳过（不检查）：跟 decideReadiness 的
//     已知边界（Task 3 评审 Minor 3）一致——纯评审类、不产出文件的阶段
//     两边都不设防，是同一个已知边界，不是这个函数单独引入的新缺口。
//
// ⚠️ 第三条不对齐，且这段注释此前正好反向担保了它（全分支评审 I4）。
// 「同一角色多个阶段」这条，两个函数**实现一致、行为不一致**——因为它们问的
// 不是同一个问题：
//   - H2 问"它接下来要做哪一段"。第一个未完成的阶段正是答案，规则对。
//   - H5 问"它刚做完的那一段交付了吗"。第一个未完成的阶段**不是**那一段：
//     多阶段角色做完前一段之后，H5 会拿**下一段**的缺失产物把**这一段**顶
//     回去。
// 阶段顺序本身没有问题（按 stages 的书写顺序，即 Object.entries 的插入序，
// 不按阶段 id 字符串排序——"S10".localeCompare("S2") < 0，字典序会把 S10 排到
// S2 前面；decideReadiness 曾经这样排过，Task 3 评审 Minor 2 改成了插入序，
// 这里没有重蹈覆辙）。错的是"用未完成阶段代替刚结束的阶段"这一步。
//
// 今天不可达：stages.json 里唯一的多阶段角色是 at-pm（S1 + S4），而
// roster.json 里没有任何角色能派发它（tests/roster-closure.test.mjs 钉住），
// 它也不会触发 SubagentStop。所以这条错误规则当前一次也走不到。
//
// 扩 stages.json 之前必须先改：规格 §4 的完整链把 at-architect 同时写进 S3
// 与 S5。链一扩到 S8，at-architect 交完 S3 就会被 H5b 用 exit 2 反复顶回去
// 要 S5 的产物——最多九次（U5 实测的平台重试上限），然后平台静默放行。一次
// 纯噪音的拦截，还会把 H5b 唯一的重试预算消耗光，真正该拦的下一次拦不住了。
//
// 为什么不在 M1a 顺手改：改对了要让调用方把"刚结束的阶段 id"传进来，那是
// 计划 B 的事（ctx.state.stage 现在正好被 readRunContext 读出来却没有人用，
// 它很可能就是那个入参）。同一条注记也留在 stages.README.md 里，因为撞上
// 这个问题的人多半是在改 stages.json、不是在读这个文件。
export function decideDeliverable({ role, stages, artifactExists }) {
  if (!stages || typeof stages !== 'object') return { ok: true }

  const mine = Object.entries(stages).filter(([, s]) => s.role === role)

  for (const [stageId, stage] of mine) {
    const produces = stage.produces || []
    const missing = produces.filter((p) => !artifactExists(p))
    // produces 为空时 missing 必然也是空数组（filter 一个空数组恒得空
    // 数组），下面这一条 continue 本身就顺带覆盖了"这个阶段没有产物义务"
    // 的情形——不需要单独判 produces.length === 0 再 continue 一次，那样
    // 会多出一层两条分支永远同时成立或同时不成立的判断，删掉其中任何一层
    // 都测不出行为差异（Task 5 的教训：变异测试要能证明每一层都必要）。
    if (missing.length === 0) continue
    // 只报第一个未完成的阶段——角色一次只做一段。
    return {
      ok: false,
      stageId,
      missing,
      reason:
        `${role} 在 ${stageId} 应当产出 ${produces.join('、')}，但 ${missing.join('、')} 还没有写到磁盘上。` +
        `在结束之前把它写出来；如果这一段确实不需要产出，把理由写进你的回报，由上级判断。`,
    }
  }

  return { ok: true }
}
