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
  // 找第一个「产物尚未齐全」的阶段来判定——那就是它此刻要做的那一段。
  //
  // Task 3 评审 Minor 2：这里不能按阶段 id 字符串排序（原先用过
  // localeCompare）——"S10".localeCompare("S2") < 0，字典序会把 S10 排到
  // S2 前面，S10 requires 一旦是空的就会被提前判定成"已完成"，漏过 S2
  // 真正缺失的前置。stages.json 里各阶段的书写顺序（Object.entries 的
  // 插入序）本来就是流水线顺序，直接用它，不重新排序。当前到 S5、规格
  // §4 的阶段链到 S8，届时同样成立，因为插入序不取决于数值宽度。
  //
  // 已知边界（Task 3 评审 Minor 3，与下面 produces 那条同类）：某个阶段条目
  // 手误漏写 role（s.role 是 undefined）时，这个 filter 会让它匹配不上任何
  // 真实 targetRole，整段既不属于任何角色、也就没人会替它跑这条门禁——
  // 是配置错误，不是这个函数的职责，当前 stages.json 五个阶段 role 都是
  // 非空字符串，未做改动。
  const mine = Object.entries(stages).filter(([, s]) => s.role === targetRole)

  if (mine.length === 0) return { decision: 'allow' }

  for (const [stageId, stage] of mine) {
    // 已知边界（Task 3 评审 Minor 3）：produces 为空/缺失的阶段，这里会被
    // 判定为"已完成"，它的 requires 永远不会被检查——纯评审类、不产出
    // 文件的阶段会因此完全不设防。当前 stages.json 五个阶段 produces 都
    // 非空，暂不触发；一旦出现这类阶段，这里需要重新设计"已完成"的判定
    // 方式，不能简单沿用"produces 都存在"这条标准。
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
