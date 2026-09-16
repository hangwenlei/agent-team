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
// 「同一角色多个阶段」「角色不在任何阶段里」这两条边界，decideReadiness
// 面对的是同一份 stages.json、同一组情形——两边的语义不能打架，否则 H2
// 与 H5 会对"角色这一刻该看哪个阶段"给出不一致的答案：
//   - 角色不在任何阶段里：mine 为空，视为没有交付物义务，ok。跟
//     decideReadiness 的 mine.length === 0 → allow 一致。
//   - 同一角色多个阶段：按 stages 的书写顺序（Object.entries 的插入序）
//     找第一个没完成的，不按阶段 id 字符串排序——"S10".localeCompare("S2")
//     < 0，字典序会把 S10 排到 S2 前面。decideReadiness 曾经这样排过序，
//     Task 3 评审 Minor 2 改成了插入序，这里不重蹈覆辙。
//   - produces 为空/缺失的阶段视为跳过（不检查）：跟 decideReadiness 的
//     已知边界（Task 3 评审 Minor 3）一致——纯评审类、不产出文件的阶段
//     两边都不设防，是同一个已知边界，不是这个函数单独引入的新缺口。
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
