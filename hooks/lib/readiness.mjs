// H2 就绪门禁（纯函数）。不碰文件系统——artifactExists 由调用方注入，
// 这样它能脱离 Claude Code 与磁盘单测。
//
// 失败策略见规格 §6 表格：H2 是流程辅助，门禁自身无法判定时 fail open；
// 但「前置产物确实缺失」是门禁在正常工作并做出否决，那要 deny。

// M2a：`<role>` 展开。这两处原来直接读字面量 `s.produces`，S5 改成
// `["05-impl/<role>.md"]` 之后会答错——`producerOf` 查 `05-impl/at-backend.md` 会
// 找不到归属（错误文案里丢掉「（S5 的产物）」那半句），`done` 会因为
// `artifactExists('05-impl/<role>.md')` 恒假而永远判 S5 未完成。
//
// 这是 Task 4 之后做穷举 grep 才找出来的**第三处**隐藏消费方：实现者当时抓到了
// `writepath.mjs` 的 `producesOf` 与 `deliverable.mjs` 的 `decideDeliverable`
// 两处，并建议「回头看还有没有第三处没被穷举到」——有，就是这里。设计文档 §1.1
// 那张「四个消费方」的表**数少了**，真实数目是六。
import { stageRoles, stageRolesInRun, expandProduces } from './stages.mjs'

function producerOf(stages, artifact) {
  for (const [id, s] of Object.entries(stages)) {
    // 归属查询问的是「这个名字是不是**任何一个**合法产者的产物」，所以按全部
    // stageRoles 展开，不按 roster 收窄——与 validateState 用 producedNames 同一个口径。
    if (expandProduces(s, stageRoles(s)).includes(artifact)) return id
  }
  return null
}

export function decideReadiness({ targetRole, stages, artifactExists, roster }) {
  if (!stages || typeof stages !== 'object') return { decision: 'allow' }

  // 一个角色可能是多个阶段的执行者（如 at-pm 既是 S1 又是 S4）。
  // 找第一个「产物尚未齐全」的阶段来判定——那就是它此刻要做的那一段。
  //
  // Task 3 评审 Minor 2：这里不能按阶段 id 字符串排序（原先用过
  // localeCompare）——"S10".localeCompare("S2") < 0，字典序会把 S10 排到
  // S2 前面，S10 requires 一旦是空的就会被提前判定成"已完成"，漏过 S2
  // 真正缺失的前置。stages.json 里各阶段的书写顺序（Object.entries 的
  // 插入序）本来就是流水线顺序，直接用它，不重新排序。这条与阶段链有几段无关，
  // 因为插入序不取决于数值宽度——S10 那天同样成立。
  // （修复轮 1：这里原来写「当前到 S5、规格 §4 的阶段链到 S8，届时同样成立」，
  // 而 stages.json 的链早已是 S1–S8，那个「当前」是假的。改成不报范围：范围可以
  // 读 stages.json 核，写下来的数字不能。）
  //
  // 已知边界（Task 3 评审 Minor 3，与下面 produces 那条同类）：某个阶段条目
  // 手误漏写 role（s.role 是 undefined）时，这个 filter 会让它匹配不上任何
  // 真实 targetRole，整段既不属于任何角色、也就没人会替它跑这条门禁——
  // 是配置错误，不是这个函数的职责，当前 stages.json 八个阶段 role 都是
  // 非空字符串，未做改动。
  //
  // M2a 整分支终审发现：这里原本写的是 `s.role === targetRole`（单数），是 `<role>`
  // 消费方里的**第十处**，也是两轮穷举都没照到的那一处——前两轮 grep 的是 `.produces`，
  // 而这一行读的是 `.role`。后果：`at-frontend`/`at-ui`/`at-ios`/`at-android` 是 S5 的
  // 合法产者，但 `mine` 对它们恒为空数组 → 下一行直接放行 → **它们的 requires
  // （03-arch.md、04-dispatch.md）一次都不会被检查**。真实子进程实测：04-dispatch.md
  // 缺失时，派 at-backend 被 deny，派其余四个全部零输出放行——H2 存在的理由就是
  // 「不要跳过前置」，这四个角色对它完全免疫，而同一趟里 at-backend 会被拦，
  // 行为不对称，排查时极易误判成「H2 好着呢」。
  //
  // 与 Task 9 修掉的第九处（deliverable.mjs 的归属判据）是同一族、同一修法。
  const mine = Object.entries(stages).filter(([, s]) => stageRoles(s).includes(targetRole))

  if (mine.length === 0) return { decision: 'allow' }

  // 修复 1（Task 2 修复轮 1，F1 承重发现）：mine 的构造条件就是
  // `targetRole ∈ stageRoles(stage)`，所以进入下面这个循环的每一个 stage，
  // targetRole 本身必然是它的合法产者之一——即便 roster 里还没有它。
  //
  // roster 记的是「这一趟已经叫到过谁」，而 commands/at.md 第 4 步是在派发**并核实之后**
  // 才累加它 —— 也就是说 H2 跑的这一刻，state.json 的 roster 必然还不含 targetRole
  // （templates/state.json 的初始值就是 []）。但 targetRole 正在被派进来，它当然在这一趟里。
  // 不把它并进去的后果：mine 里 stageRolesInRun 为空 ⟺ roster 不含 targetRole，
  // 于是下面的 .every() 在空数组上恒真 → 这一段被判「已完成」→ requires 整段跳过。
  // 实测（磁盘全空、roster: []）：S2 的 at-product/at-ui 与 S5 的 at-backend/at-frontend
  // 全部静默放行，而 S3/S6 这类字面量阶段照拦 —— 同一趟里行为不对称，排查时极易
  // 误判成「H2 好着呢」。这与 M2a 终审在 `.role` 上抓到的第十处是同一个形状。
  //
  // ⚠️ 只在这里并 targetRole，不要往 stageRolesInRun / expectedArtifacts / isStageDone
  // 那边搬：那几处答的是「这一趟该有哪些产物」，没有 targetRole 这个概念，roster 为空
  // 时「还没人被叫到、所以还没有产物该在」是诚实的。
  const inRun = Array.isArray(roster) ? [...roster, targetRole] : roster

  for (const [stageId, stage] of mine) {
    // 已知边界（Task 3 评审 Minor 3）：produces 为空/缺失的阶段，这里会被
    // 判定为"已完成"，它的 requires 永远不会被检查——纯评审类、不产出
    // 文件的阶段会因此完全不设防。当前 stages.json 五个阶段 produces 都
    // 非空，暂不触发；一旦出现这类阶段，这里需要重新设计"已完成"的判定
    // 方式，不能简单沿用"produces 都存在"这条标准。
    // 修复 1 更正：M2a 曾在这里写过「按 roster ∩ producers 展开（与 isStageDone
    // 同一个口径，共用 stageRolesInRun）……展开后为空数组时 `.every` 仍然返回
    // true、判为『已完成』——对 <role> 阶段那恰好是对的（这一趟没有任何人是它的
    // 产者，这一段就没有待办）」——这句话在 decideReadiness 里从不成立：上面已经
    // 算过，mine 保证 targetRole 就是这个 stage 的合法产者之一，「roster 里没有
    // 别人在场」从不等于「没有人是它的产者」。传 inRun（roster 并入 targetRole
    // 之后的集合），展开后的集合对 mine 里的每个 stage 恒非空，不再会被空数组
    // 恒真的 `.every` 误判成「已完成」。这句话只在 stageRolesInRun /
    // expectedArtifacts / isStageDone 那几处——没有 targetRole 概念、只答「这一趟
    // 该有哪些产物」——才继续成立。produces 本身为空的阶段那条已知边界不受影响，
    // 仍是上面 Minor 3 那条，本次没有改动它。
    const done = expandProduces(stage, stageRolesInRun(stage, inRun)).every((p) => artifactExists(p))
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
