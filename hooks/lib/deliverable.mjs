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
// 【M1b 改】这个函数此前与 decideReadiness 共用同一条迭代规则——「取该角色第一个
// produces 未齐的阶段」。那条规则对 H2 问的问题（「它接下来要做哪一段」）是对的，
// 对 H5 问的问题（「它刚做完的那一段交付了吗」）是错的：多阶段角色做完前一段之后，
// H5 会拿下一段的缺失产物把这一段顶回去，最多九次，然后平台静默放行——一次纯噪音的
// 拦截，还会把 H5b 唯一的重试预算消耗光。现在改成由调用方把阶段 id 传进来
// （gate.mjs 传 ctx.state.stage），不再自己猜。
//
// ⚠️ 这条修复引入的新失效形状：state.stage 停在旧阶段时，这个函数会对新阶段的角色
// 返回 { ok: true, skipped: 'role-not-in-stage' }——不是放行，是**哑掉**，而哑掉和
// 「通过了」在会话里长得一模一样（docs/08 §0 说的正是这种形状）。所以 skipped 必须
// 带出去：gate.mjs 的 H5a 在这种情形下发 warning，ledger 在当前阶段产物齐了时提示
// 推进阶段。两条对策缺一不可，改这里之前先读它们。
//
// 【M2a 补】S5 的 produces 是 `<role>` 模式（`["05-impl/<role>.md"]`），单一真源见
// hooks/lib/stages.mjs 头部。（下面这段写于 Task 4，当时归属判据还是 `stage.role !== role`，
// 所以原话是「走到这里的 role 必然等于 stage.role」——**Task 9 把归属判据改成
// `stageRoles(stage).includes(role)` 之后这句不再成立**：走到这里的 role 是 producers
// 里的任意一个。下面的分析不受影响，expandProduces(stage, [role]) 本来就是按「这一个
// 已经匹配上的角色」展开的。）但 `stage.produces` 本身仍然是那份**字面量**（含占位
// 符，不是展开过的路径），如果直接拿它去问 artifactExists，永远问的是字面意义上
// 名叫 "05-impl/<role>.md" 的文件，这个文件不可能存在。后果：H5b 会把 at-backend
// 永久拦在 S5 完不成的状态（stop-gate 一律 exit 2），H5a 永远报"缺 05-impl/<role>.md"
// ——跟磁盘上是否真的写出了 05-impl/at-backend.md 完全无关。这不是"多一个产者没被
// 照顾到"的边界情形，是**唯一被这个函数判定的那个角色**（role，此刻已等于
// stage.role）自己的交付也判不对，S5 本身就完不成。brief/设计文档都没提到这处
// 必须跟着 stages.json 的 <role> 模式一起改的地方，是 Task 4 落地时发现并补上的。
// 用 expandProduces(stage, [role]) 只展开这一个已经匹配上的角色——不展开
// producers 里的其它人，那些人走的是上面的 role-not-in-stage 分支，本函数不对
// 他们表态（H5 的静默集合另见 gate.mjs 的 isCoordinatorFor 与 stages.README.md）。
// 对没有 producers 的单产者阶段（S1–S4、S6–S8），expandProduces 对不含 <role> 的
// 条目原样保留一次，逐字等价于原来的 stage.produces，这条改动对它们是零行为差异
// （tests/deliverable.test.mjs 现有各条据此必须仍然全绿，不改签名）。
import { expandProduces, stageRoles } from './stages.mjs'

export function decideDeliverable({ role, stageId, stages, artifactExists }) {
  if (!stages || typeof stages !== 'object') return { ok: true, skipped: 'unknown-stage' }

  const stage = typeof stageId === 'string' && Object.hasOwn(stages, stageId) ? stages[stageId] : null
  // stageId 来自 state.json 的 stage 字段。查不到只有两种成因：state.json 缺字段，
  // 或者它指向一个 stages.json 里不存在的阶段——两者都是「门禁认不出该查哪一段」，
  // 不是「这个角色没有交付义务」。H5 是 fail open，所以不表态；但要把原因带出去，
  // 让 gate.mjs 能把它和「角色确实没义务」区分开。
  if (!stage) return { ok: true, skipped: 'unknown-stage' }

  // 这个角色不是当前阶段的执行者。同样不表态，但同样要带出原因：
  // 「派了一个在当前阶段没有交付义务的角色」本身是一件值得看一眼的事，而且它也是
  // 「state.stage 停在旧阶段」这个失效的表征——见 gate.mjs 的 H5a 分支。
  // M2a Task 9 实测发现：这里原本写的是 `stage.role !== role`（单数 role），而 S5 自 Task 4
  // 起是**多产者**阶段（producers: at-backend/at-frontend/at-ui/at-ios/at-android）。
  // 后果有两条，都不是理论推演：
  //   1. H5 **从不检查** at-frontend/at-ui/at-ios/at-android 在 S5 的交付物——它们是合法
  //      产者，却在这里就被判成「没有交付义务」直接跳过，下面那段 expandProduces
  //      对它们永远走不到
  //   2. H5a 会对它们发一条**假告警**：「刚返回的 X 不是当前阶段的执行者，而且它也派不到
  //      那个执行者」——第二句在拓扑上是真的（它们 reachableRoles 为空），但结论是错的，
  //      它们本来就该在这一段产出
  // Task 4 修了 produces 的展开（下面那行 expandProduces），漏了这道归属判据——与
  // 规格 §4 注记里记的「消费方不是四个是八个」同一族，这是第九处。
  if (!stageRoles(stage).includes(role)) return { ok: true, skipped: 'role-not-in-stage' }

  const produces = expandProduces(stage, [role])
  const missing = produces.filter((p) => !artifactExists(p))
  // produces 为空时 missing 必然也是空数组（filter 空数组恒得空数组），这一条顺带
  // 覆盖了「这个阶段没有产物义务」，不需要单独判 produces.length === 0——那样会多出
  // 一层两条分支永远同时成立或同时不成立的判断，删掉任何一层都测不出行为差异
  // （Task 5 的教训：变异测试要能证明每一层都必要）。
  if (missing.length === 0) return { ok: true }

  return {
    ok: false,
    stageId,
    missing,
    reason:
      `${role} 在 ${stageId} 应当产出 ${produces.join('、')}，但 ${missing.join('、')} 还没有写到磁盘上。` +
      `在结束之前把它写出来；如果这一段确实不需要产出，把理由写进你的回报，由上级判断。`,
  }
}
