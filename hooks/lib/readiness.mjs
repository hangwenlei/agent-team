// H2 就绪门禁（纯函数）。不碰文件系统——artifactExists 由调用方注入，
// 这样它能脱离 Claude Code 与磁盘单测。
//
// 失败策略见规格 §6 表格：H2 是流程辅助，门禁自身无法判定时 fail open；
// 但「前置产物确实缺失」是门禁在正常工作并做出否决，那要 deny。

function producerOf(stages, artifact) {
  for (const [id, s] of Object.entries(stages)) {
    if (Array.isArray(s.produces) && s.produces.includes(artifact)) return id
  }
  return null
}

export function decideReadiness({ targetRole, stages, artifactExists }) {
  if (!stages || typeof stages !== 'object') return { decision: 'allow' }

  // 一个角色可能是多个阶段的执行者（如 at-pm 既是 S1 又是 S4）。
  // 按阶段 id 升序找第一个「产物尚未齐全」的阶段来判定——那就是它此刻要做的那一段。
  const mine = Object.entries(stages)
    .filter(([, s]) => s.role === targetRole)
    .sort(([a], [b]) => a.localeCompare(b))

  if (mine.length === 0) return { decision: 'allow' }

  for (const [stageId, stage] of mine) {
    const done = (stage.produces || []).every((p) => artifactExists(p))
    if (done) continue

    const missing = (stage.requires || []).filter((r) => !artifactExists(r))
    if (missing.length === 0) return { decision: 'allow' }

    const detail = missing
      .map((m) => {
        const from = producerOf(stages, m)
        return from ? `${m}（${from} 的产物）` : m
      })
      .join('、')

    return {
      decision: 'deny',
      reason:
        `${targetRole} 现在要做的是 ${stageId}，但它的前置产物还缺：${detail}。` +
        `先把产出这些产物的阶段跑完再回来，不要跳过。`,
    }
  }

  return { decision: 'allow' }
}
