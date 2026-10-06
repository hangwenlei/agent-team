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
import { VERIFY_REDO, splitByAccept } from './freshness.mjs'

function producerOf(stages, artifact) {
  for (const [id, s] of Object.entries(stages)) {
    // 归属查询问的是「这个名字是不是**任何一个**合法产者的产物」，所以按全部
    // stageRoles 展开，不按 roster 收窄——与 validateState 用 producedNames 同一个口径。
    if (expandProduces(s, stageRoles(s)).includes(artifact)) return id
  }
  return null
}

/**
 * 这次派发要按哪几段判（M3w，docs/31，全量审查第 13 条）：目标是产者的那些段（按书写顺序），再按派发者收窄。
 *
 * 派发边本身不带段；但「派发者是某段的 role、或者能（传递地）派到它」这个组合，在今天的拓扑下恰好把多段角色的每一段分开：
 * at-product 派 at-ui 是 S2 的活，at-architect 派它是 S5 的活（agents/at-ui.md「冒泡给谁」一节）。这与 gate.mjs 的
 * isCoordinatorFor（H5a 认协调者）是同一个口径，读的也是 stages[X].role 单数——docs/11 §5.12 的口径甲，改一处要连另一处。
 * 不按 producers 剪：S5 的 producers 里有 at-ui，而 at-product 派得到 at-ui，按 producers 剪会把 S5 留给 at-product。
 *
 * caller 是派发者（hook 输入的 agent_type，经 callerOf），callerReach 是它沿花名册派发边传递派得到的角色（computeReach 的
 * reachableRoles，不含它自己）。两者缺一不剪：caller 缺失、空串或不是字符串，派发者不在花名册里（callerReach 为 null——别的插件
 * 的代理、用户自己的 subagent，H1 对它们放行，前置只有 H2 在查），花名册读坏。剪空时也不剪（派发者派不到目标任何一段的 role：
 * 今天只有 H1 会拒的派发；花名册加一条这样的边之后就不止了），退回全部候选段，不因为剪枝放行。
 * 不看 state.stage：那会让 H2 也依赖 stage 准不准（stage 没推进时，架构师为 S5 派 at-ui 会按 S2 放行，docs/31 §2 有两种方案的
 * 对照）。派发者由平台随调用给出；CLI 自己起的分叉带的是主线程的身份或空串（docs/22），那时候选段或者是主线程的、或者剪空，
 * 都退回老规则，是安全的一侧。
 * ⚠️ M3z（docs/34，全量审查第 16 条）：选段仍不看 state.stage，但 H2 多了一条看它的判据——叶子角色的候选段全都早于 state.stage、
 * 它在这些段的产物都交过，就是不记回退的重做（hooks/lib/redo.mjs 的 decideRedispatch，gate.mjs 在本函数放行之后调）。那条判据
 * 只拿这里选出的段与 stage 比先后：stage 落后只会少拦，超前（第 17 条的提前推进）会多拦，出口是记回退。（H3 的同名判据还看写者在
 * 当前段有没有活，stage 落后时也会多拦，见 redo.mjs 头部。）
 *
 * 失效条件（docs/31 §4）：某个角色 R 的 can_delegate_to 里直接有一个多段角色 X，而 X 的各段中「role 是 R、或 R 传递派得到它」
 * 的段不恰好一段——多于一段时仍按「第一个没齐」猜，零段时剪空、退回老规则。tests/readiness.test.mjs 的「M3w 前提」遍历真实
 * 花名册的每一条直接边钉着它。
 */
export function candidateStages(stages, targetRole, caller, callerReach) {
  if (!stages || typeof stages !== 'object') return []
  const mine = Object.entries(stages).filter(([, s]) => stageRoles(s).includes(targetRole))
  const reachable = typeof caller === 'string' && caller && Array.isArray(callerReach) ? callerReach : null
  const byCaller = reachable
    ? mine.filter(([, s]) => typeof s.role === 'string' && (s.role === caller || reachable.includes(s.role)))
    : []
  return byCaller.length ? byCaller : mine
}

// caller 是这次的派发者（hook 输入的 agent_type，经 callerOf），callerReach 是它沿花名册的派发边（传递地）派得到的角色
// （hooks/lib/reach.mjs 的 computeReach 算的 reachableRoles）。两者缺一时不按派发者剪枝，见 candidateStages。
// M3y（docs/33，全量审查第 15 条）：调用方把 artifactExists 换成 freshness 的 artifactCurrent，另传 artifactStale。「齐了没」与
// 「前置在不在」都按 current 判——回退之后上一轮的产物不让一段判齐、不算前置在。还是上一轮的前置与「缺」分开说，出口按收件人分：
// callerCanWriteState（派发者写得了 state.json，gate.mjs 用 isContractWriter 算）为真给「标 accepted」，否则（含缺省）叫它冒泡。
// 没有上一轮的前置时，文案与 v1.6.0 逐字相同。
export function decideReadiness({
  targetRole,
  stages,
  artifactExists,
  artifactStale = () => false,
  roster,
  caller,
  callerReach,
  callerCanWriteState = false,
  // M4h（docs/43，审查第 38 条）：这一段是不是整段裁掉了（调用方用 advance.mjs 的 wholeStageTrimmed 判）。缺的前置是它的产物时，拒绝理由说清。
  trimmedAway = () => false,
}) {
  if (!stages || typeof stages !== 'object') return { decision: 'allow' }

  // 一个角色可能是多个阶段的执行者（如 at-pm 既是 S1 又是 S4，at-ui 既是 S2 又是 S5）。先按派发者把候选段收窄（M3w，
  // 见下），再在候选段里找第一个「产物尚未齐全」的阶段来判定。
  // ⚠️ M3w 订正（docs/31，全量审查第 13 条）：这里原来写的是「找第一个产物尚未齐全的阶段——那就是它此刻要做的那一段」。
  // 对 at-ui 这不成立：S2 已齐之后 at-product 让它返修，这条规则按 S5 的前置拒它；S2 被裁或只交了一半时架构师为 S5 派它，
  // 这条规则按 S2 放行、S5 的前置从不查。「此刻要做的那一段」由派发者决定，不由哪一段没齐决定。
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
  // 已知边界（Task 3 评审 Minor 3，与下面 produces 那条同类）：某个没有 producers 的阶段条目
  // 手误漏写 role（s.role 是 undefined）时，candidateStages 里那个 filter 会让它匹配不上任何
  // 真实 targetRole，整段既不属于任何角色、也就没人会替它跑这条门禁——
  // 是配置错误，不是这个函数的职责；今天 stages.json 里每个阶段的 role 都是非空字符串（范围
  // 读 stages.json 核，这里不写段数），未做改动。有 producers 的段不看 role 认产者，漏写 role
  // 只会让它进不了按派发者剪出的候选段，剪空时退回老规则（M3w）。
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
  const candidates = candidateStages(stages, targetRole, caller, callerReach)

  if (candidates.length === 0) return { decision: 'allow' }

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

  for (const [stageId, stage] of candidates) {
    // 已知边界（Task 3 评审 Minor 3）：produces 为空/缺失的阶段，这里会被
    // 判定为"已完成"，它的 requires 永远不会被检查——纯评审类、不产出
    // 文件的阶段会因此完全不设防。今天 stages.json 里每个阶段的 produces 都
    // 非空（范围读 stages.json 核，这里不写段数——写下来的数字会漂：原文的「五个阶段」
    // 在链扩到 S8 之后就假了，M3w 顺手改），暂不触发；一旦出现这类阶段，这里需要重新设计
    // "已完成"的判定方式，不能简单沿用"produces 都存在"这条标准。
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

    const requires = stage.requires || []
    const stale = requires.filter((r) => artifactStale(r))
    const missing = requires.filter((r) => !artifactExists(r) && !stale.includes(r))
    if (missing.length === 0 && stale.length === 0) return { decision: 'allow' }

    const named = (list) =>
      list
        .map((m) => {
          const from = producerOf(stages, m)
          return from ? `${m}（${from} 的产物）` : m
        })
        .join('、')

    if (stale.length === 0) {
      // M4h（docs/43，审查第 38 条）：缺的前置是整段裁掉的那一段的产物（例：S2 整段裁掉之后在 S3 派架构师，缺 01-prd.md）——那一段是 PM 自己
      // 裁掉的，「先跑完」走不通。说清是整段裁掉，给两条路（补回来，或者把要它当前置的段一起裁掉）；派发者改不了 state.json 的冒泡。
      const away = [...new Set(missing.map((m) => producerOf(stages, m)).filter((sid) => sid && trimmedAway(sid)))]
      const rest = missing.filter((m) => !away.includes(producerOf(stages, m)))
      const awayOut = away.length
        ? `${away.join('、')} 整段裁掉了（那一段的产者都记在 trimmed 里、这一趟在那一段谁都没叫过），它的产物不会有了：` +
          (callerCanWriteState
            ? '要么把那一段补回来（把它的产者从 trimmed 里拿掉、派它补交，叫到的人补记进 stage_roles 那一段），要么把要它当前置的段也整段裁掉、' +
              '交付文档里写明少了哪几段（/agent-team:at 第 3 节第 4 条）。'
            : '这要项目经理定，把这一点写进你的回报冒泡给派你的人。')
        : ''
      return {
        decision: 'deny',
        reason:
          `${targetRole} 现在要做的是 ${stageId}，但它的前置产物还缺：${named(missing)}。` +
          (rest.length ? `先把产出这些产物的阶段跑完再回来，不要跳过。` : '') +
          awayOut,
      }
    }

    const staleNames = named(stale)
    const gap = staleNames.endsWith('）') ? '' : ' '
    const stalePart = `${staleNames}${gap}还是上一轮的（返工轮里回退之后还没有重写，内容与回退那一刻一样）`
    const what = missing.length ? `还缺：${named(missing)}；${stalePart}` : ` ${stalePart}`
    // M4a（docs/35）：还旧的前置按「能不能标 accepted」分开说——验证段的产物（例：at-acceptance 的前置 06-test.md）只给「派它的产者
    // 重跑之后重写」，不给标 accepted（H6 会拒）。
    const { accept, redo } = splitByAccept(stages, stale)
    const both = accept.length && redo.length
    const acceptOut = !accept.length
      ? ''
      : callerCanWriteState
        ? `${both ? `${named(accept)}：` : ''}这一轮接受上一轮那份原样，就在 state.json 的 rework_base 里把它的值改成 "accepted"（只许当前段及更早段的产物），再派发。`
        : `rework_base 只有项目经理改得了：你判断上一轮那份${both ? `（${accept.join('、')}）` : ''}这一轮不用重写，就把这一点写进你的回报冒泡给派你的人，由项目经理裁定。`
    const redoOut = !redo.length
      ? ''
      : callerCanWriteState
        ? `${named(redo)}：${VERIFY_REDO}；之后再派发。`
        : `${named(redo)}：${VERIFY_REDO}——把这一点写进你的回报冒泡给派你的人。`
    const out = acceptOut + redoOut
    return {
      decision: 'deny',
      reason: `${targetRole} 现在要做的是 ${stageId}，但它的前置产物${what}。先把产出这些产物的阶段跑完再回来，不要跳过。${out}`,
    }
  }

  return { decision: 'allow' }
}
