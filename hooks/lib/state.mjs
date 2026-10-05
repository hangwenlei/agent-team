// state.json 的 schema 与交叉校验（纯函数）。规格 §4.4。
//
// 这个模块存在的理由是 §4.2 ③ 的「返工预算硬上限且不可重置，计数写在 state.json，
// 不交给模型自己数」。如果 rework 只是一个孤立字段，模型把它改小没有任何东西会红，
// 「不可重置」就只是一句话。history 是阶段进入的追加日志，rework 必须等于它的派生量
// （某阶段出现 n 次 → n-1 次返工），计数于是变成**可交叉校验**的。
//
// ⚠️ 本模块只做校验，不做写时强制——写时强制由 H6（hooks/lib/rework-guard.mjs）承担，
// M2a 补。理由见那个文件头部：PostToolUse 看不到改之前那一版，PreToolUse 看得到。
// validateState 的同名校验降为第二道（事后告警），两道都要在。同一条注记也更新在
// stages.README.md 里——那份文件此前记的是"还没做"，M2a 之后要跟着改成"已实现"，
// 不能只改一处、留另一处停在过期状态（这个仓库为「同一份知识写两份」栽过四次）。
//
// validateState 一次报全部问题而不是遇到第一个就返回：调用方是 ledger，它把 problems
// 一次性交给 PM；分次报会让 PM 改一条、再撞一条，来回好几轮。

// isPlainObject 也从这里来（M2b 终审 A2），原先是本模块的私有拷贝。
// stageRoles 是 M3a 的 trimmed 键校验用的——「这一段的产者」的单一真源就是它，
// 这里不另写一份角色集合（理由与下面 trimmed 那一段的注释同源）。
import { producedNames, expandProduces, stageRoles, stageRolesInRun, isPlainObject } from './stages.mjs'
import { SHA_RE } from './contract-hash.mjs'
import { quote } from './trusted.mjs'
// M3z（docs/34）：上限的单一真源挪到 budget.mjs（limitOf 要它，留在这里就成了环）；这里原样再导出，既有的 import 不用改。
import { REWORK_LIMIT, limitOf } from './budget.mjs'
import { closedAt, lastStageId } from './closing.mjs'

// validateState 的问题文案会进受信回传【state.json】；state.json 是写得进它的任何人都能写的，
// 键名与值一律过 quote（M3s，docs/27）——阶段名也一样：它在这里是 state.json 里写着的那个值，
// 不是 stages.json 的名字，干净的值不加引号，一句祈使句就能混进门禁的话里。数字经 quote 仍是数字。

// SHA_RE 的单一真源在 contract-hash.mjs（M3s）。
const RUN_ID_RE = /^\d{8}-\d{4}-[a-z0-9][a-z0-9-]*$/

export { REWORK_LIMIT }

// 「返工计数是个合法的数」——H6 写时闸（hooks/lib/rework-guard.mjs 判据④）与下面
// validateState 的事后校验**共用这一份**。
//
// M2b 终审 A5：两边原本各拼各的，而且方向是反的——写时闸先 `Number(raw)` 再判，
// `Number(true) === 1`、`Number(' 1 ') === 1`，于是 `rework: {"S5": true}` 与
// `{"S5": " 1 "}` 被**放行**，落盘之后 validateState 对同一份 state 报「不是非负整数」。
// **fail-closed 的写时闸比 fail-open 的事后告警宽松**，与本模块自己已经修过一次的
// 那条不对称（判据④缺下界、`rework:{"S5":-1}` 被放行）完全同族，只是换了个入口。
// 不是预算绕过（`Number('4') = 4 > 3` 仍然 deny），但方向错了就是错了。
//
// 只抽「非负整数」这一半，**不把 `v > REWORK_LIMIT` 一起包进来**：那一边两处都是
// 拿同一个导出常量 REWORK_LIMIT 做的单次比较，没有第二种正确拼法可漂移——正是
// Task 2 修复轮 1 ③ 判过「不值得抽」的那一类。有变体空间的是这个手写的多条件布尔
// 表达式，抽的就是它。validateState 还要靠这一半把两种认知状态分开报（「不是非负
// 整数」/「超过硬上限」），合成一个谓词会把那个区分抹平。
// ⚠️ M3z（docs/34）订正：上限那一边不再是「拿 REWORK_LIMIT 做的单次比较」——两处都改经 budget.mjs 的 limitOf（3 + 门禁记下的、
// 覆盖那一段的返工批准条数），这正是上面那条「单一真源」的另一处落点。而且两处比的不再是同一个东西：H6 比写着的值（只罚
// 改大），validateState 比 history 的派生值、报进单列的 budget。「不是非负整数」这一半仍然共用本函数。
export function isNonNegativeInteger(v) {
  return Number.isInteger(v) && v >= 0
}

// 与规格 §5.1 的必须升级条件一一对应，顺序也照它：
// 敏感与不可逆 / 契约冲突 / 取舍 / 契约有洞 / 预算耗尽 / 环境阻塞。
// M4c（docs/37，全量审查第 37 条后半）：加 env-blocked——缺工具、服务或权限，构建或测试跑不起来，这一段交不出来或验证不了。收口门禁
// 自己就把「测试跑不起来」指向 /agent-team:at 第 4 节，原来照做如实记它会被报成状态不合法。user-change（用户主动改需求）没加：
// 记不记回退、吃不吃返工额度还没定（docs/37 §5）。正文与判据不写总数，从这里派生（tests/commands.test.mjs、tests/readme-sync.test.mjs）。
export const ESCALATION_KINDS = [
  'sensitive',
  'contract-conflict',
  'tradeoff',
  'contract-hole',
  'budget-exhausted',
  'env-blocked',
]

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** history 里某阶段出现 n 次 → 该阶段返工 n-1 次。只有 n>1 的阶段进结果。 */
export function reworkFromHistory(history) {
  const out = {}
  if (!Array.isArray(history)) return out
  const count = {}
  for (const e of history) {
    if (!isPlainObject(e) || typeof e.stage !== 'string') continue
    count[e.stage] = (count[e.stage] ?? 0) + 1
  }
  for (const [stage, n] of Object.entries(count)) if (n > 1) out[stage] = n - 1
  return out
}

/** 按 stages 的**书写顺序**（Object.entries 的插入序）取下一个阶段。 */
export function nextStage(stages, current) {
  // 不按阶段 id 字符串排序：'S10'.localeCompare('S2') < 0，字典序会把 S10 排到 S2
  // 前面。readiness.mjs 与 deliverable.mjs 都为这一条留过注释，这是第三处。
  if (!isPlainObject(stages)) return null
  const ids = Object.keys(stages)
  const i = ids.indexOf(current)
  if (i < 0 || i === ids.length - 1) return null
  return ids[i + 1]
}

// 规格 §4.3 驳回路由。这张表此前只活在规格里，没有任何代码消费它。
//
// contract-conflict 返回 null 是**有意的**：规格 §4.3 的原话是「唯一升级情形：驳回暴露
// 00-contract.md 自身存在内在矛盾——非执行错误，只有用户能裁」。那一类不由代码决定回哪，
// 走 §5.1 的升级路径（ESCALATION_KINDS 已含同名的一类）。
export const REJECTION_KINDS = ['requirement', 'design', 'implementation', 'contract-conflict']

const REJECT_TARGET = {
  requirement: 'S2',
  design: 'S3',
  implementation: 'S5',
  'contract-conflict': null,
}

/**
 * 驳回路由：kind → 应回退到的阶段 id，或 null。
 *
 * 回退本身**不在这个函数里发生**——调用方（未来的 M2b/M2c）把返回值追加进
 * `history` 一条新记录、把 `stage` 改成这个值，`reworkFromHistory` 会照常从出现
 * 次数算出返工计数，不需要为「回退」单独开一套计数逻辑（详见 state.mjs 头部与
 * reworkFromHistory 的注释）。`validateState` 也不需要为回退改一行——它现在不
 * 校验阶段前后关系，见 tests/state.test.mjs 里钉住这条的回归测试。
 */
export function rejectTo(kind) {
  return typeof kind === 'string' && Object.hasOwn(REJECT_TARGET, kind) ? REJECT_TARGET[kind] : null
}

/**
 * 当前阶段的 produces 是否已经全部齐了。artifactExists 由调用方注入——与
 * hooks/lib/readiness.mjs 的 decideReadiness、hooks/lib/deliverable.mjs 的
 * decideDeliverable 同一个理由：I/O 留在调用方，这里保持纯函数、可脱离磁盘单测。
 *
 * ⚠️ 这段判定原来是 hooks/gate.mjs 的 ledger 分支里一行内联的
 * `current.produces.every((p) => ctx.artifactExists(p))`（Task 6 brief Step 7
 * 原样给的代码）。抽成这里独立成一个可单测的纯函数，是 Task 6 变异验证第 4 项
 * 实测后补的：gate.mjs 从不被任何测试 import（只子进程级跑），而它读的
 * stages.json 是仓库根真实那份——M1 里每一个阶段的 produces 都只有一个元素，
 * `.every` 与 `.some` 在单元素数组上永远同值，任何子进程级测试都不可能把两者判出
 * 行为差异。实测：把 gate.mjs 内联那行的 `.every` 换成 `.some`，全量
 * `node --test` 仍然 pass、fail 0，没有任何测试变红——brief 的变异表以为
 * tests/ledger.test.mjs「无事可报时返回空数组」那条会因此变红，但那条测试传的
 * `stageDone` 是字面量布尔值，从不经过这一行，这个预期本身就不成立（该值在
 * ledger.test.mjs 的 `base` 里写死是 `false`，不受这里怎么算的影响）。抽成这里
 * 之后能用一份完全合成的、有多个 produces 元素的 stages 夹具单测，**当时**不再受
 * 仓库根真实 stages.json 的形状限制。
 *
 * ⚠️ M2b 终审收口轮（2026-09-20）：上面那句原来结尾是「不再受仓库根真实 stages.json
 * **「每个阶段只有一个产物」**这个形状限制」——**今天那个形状限制已经不存在了**
 * （S2/S3/S5 都是多产物，去 stages.json 看）。同一段里上方那句「M1 里每一个阶段的
 * produces 都只有一个元素」带着「M1 里」这个时态标记、至今为真；结尾这句**没有标记**，
 * 读的人会当成对今天的断言。裁定「认知状态分开标」在同一段注释里
 * 的实物——补上「当时」两个字，把它标回叙述。
 *
 * **这一处是裁定「词形表的上限」的「按改动穷举」当场找出来的第八处**：它与 gate-ledger.test.mjs
 * 那处是同一个事实（S3 多了 03-alignment.md，`9ffcad2`），但一个写「produces」、一个
 * 写「产物」——**词形不同，原因相同**。详见 docs/11 §5.18 裁定「词形表的上限」。
 *
 * M2a：加可选 roster。S5 的产物集合取决于这一趟派了谁（producers × roster），静态列全
 * 五个执行角色会让只派了两个角色的 run 永远不 done、整条链卡死。roster 缺省时退回全部
 * producers；**没有 producers 的阶段**行为完全不变，tests/state.test.mjs 现有的
 * isStageDone 测试因此不需要改签名、必须仍然全绿。
 *
 * ⚠️ M2b 终审 B2（2026-09-20）：上面那半句原来写的是「**S1–S4/S6–S8** 没有 producers，
 * 行为完全不变」——**假**。M2b 给 S2 加了 producers: ["at-product","at-ui"] 与对象形式的
 * produces，而 S2 就在枚举的「S1–S4」里面：传了 roster 的那一趟，S2 的 isStageDone 走的
 * 正是 roster ∩ producers。改成按条件说、不枚举阶段号——哪些阶段没有 producers，
 * 去 stages.json 看。同族另外三处（deliverable/writepath/artifact-drift）一并改了。
 *
 * M3x（docs/32，全量审查第 14 条）：形参名仍叫 roster，门禁的两处调用传的却不再是整趟 roster，是
 * participantsOf(state, state.stage)——state.json 的 stage_roles 在当前段记着的人，没有 stage_roles 的旧 run 退回 roster。
 * 整趟 roster 不分段：at-ui 在 S2 进过 roster，S5 就去等 05-impl/at-ui.md。本函数一个字没改，判据在调用点
 * （tests/stage-done-call-site.test.mjs）。当前段还没记账时传进来的是 []：produces 每一条都随参与者展开的段（对象形式，
 * 或数组里每条都含 <role>）展开为空、答 false；不含 <role> 的条目与传进来的是谁无关，原样保留，照磁盘判。
 */
export function isStageDone({ stage, stages, artifactExists, roster }) {
  // stage 来自 state.json：不是字符串、或者不是 stages 自己的键，就不算完成（M3s，docs/27 §3）。
  // 此前拿它直接做属性键，{"toString":1} 这样的对象会让 ToPropertyKey 抛异常——ledger 与
  // deliverable 整条崩掉，本该报出这个坏值的【state.json】也跟着消失。
  if (typeof stage !== 'string' || !isPlainObject(stages) || !Object.hasOwn(stages, stage)) return false
  const current = stages[stage]
  if (!current) return false
  // 「这一阶段在这一趟里的产出角色」走 stages.mjs 的 stageRolesInRun，不在这里自己
  // 再写一遍 roster 过滤——Task 3 评审发现 1：这段逻辑原本在这里和 expectedArtifacts
  // 各有一份逐字同构的实现，现已收敛成一处。
  const names = expandProduces(current, stageRolesInRun(current, roster))
  if (names.length === 0) return false
  return names.every((p) => artifactExists(p))
}

// M3z（docs/34，全量审查第 16 条）：多一个 grants（门禁记下的返工批准，budget.mjs 的 readGrants）与一个返回值 budget——按 history 的
// 派生值超过上限（limitOf）的段，{ stage, rounds, limit }。它不进 problems：problems 那一块的抬头是「改完再继续」，越限的唯一出路却是
// 问用户（把计数改小会被 H6 以「不可重置」拒，O6），ledger 把它单列成【返工预算】。ok 在两样都空时才为真。
// 复核（docs/34 §3，budget-3）：还多一个 legacy——history 里不在阶段链上的条目（v1.7.0 及更早写进去的 DONE 之类）。H6 现在不许改也
// 不许删已有的条目，它们永远在；报进 problems 会让【state.json】每次都叫「改完再继续」，而那是改不了的。只单列，ledger 不发。
export function validateState(state, { stages, grants } = {}) {
  const problems = []
  const budget = []
  const legacy = []
  const p = (msg) => problems.push(msg)

  if (!isPlainObject(state)) {
    return { ok: false, problems: ['state.json 的内容不是一个 JSON 对象'], budget, legacy }
  }

  if (typeof state.run_id !== 'string' || !RUN_ID_RE.test(state.run_id)) {
    p(`run_id 不是 YYYYMMDD-HHmm-<slug> 形状（拿到 ${quote(state.run_id)}）`)
  }
  if (typeof state.stage !== 'string' || !state.stage) {
    p('stage 缺失或不是字符串')
  } else if (isPlainObject(stages) && !Object.hasOwn(stages, state.stage)) {
    p(`stage 是 ${quote(state.stage)}，但 stages.json 里没有这个阶段`)
  }
  if (state.contract_sha !== 'PENDING' && !(typeof state.contract_sha === 'string' && SHA_RE.test(state.contract_sha))) {
    p(`contract_sha 既不是 "PENDING" 也不是 sha256:<64 位十六进制>（拿到 ${quote(state.contract_sha)}）`)
  }
  // M4a（docs/35）：收口标记 closed_at（hooks/lib/closing.mjs 的 closedAt 是单一谓词）。H6 写时就拒这两样，这里是事后那一道。
  if (Object.hasOwn(state, 'closed_at') && state.closed_at !== null) {
    const last = lastStageId(stages)
    if (closedAt(state) === null) {
      const got = typeof state.closed_at === 'string' ? `是 ${quote(state.closed_at)}` : '是别的类型'
      p(`closed_at ${got}：它要么是 null（还没收口），要么是收口那一刻的 ISO 时间（例："2026-10-01T15:00:00Z"）——收口照 /agent-team:at 第 6 节`)
    } else if (last && state.stage !== last) {
      p(`closed_at 在，但 stage 不是阶段链最后一段（${last}）——收口只在最后一段`)
    }
  }
  if (!isStringArray(state.roster)) p('roster 不是字符串数组')
  if (!isStringArray(state.never_invoked)) p('never_invoked 不是字符串数组')

  // ——— trimmed（M3a 新加的字段，与 roster 是一对）———
  //
  // roster 答的是「这一趟叫到了谁」，trimmed 答的是「这一趟**主动不叫**谁，在哪一段」。
  // 两个字段合起来才覆盖得住一个阶段的全部产者：M2b 的真实 run 里 at-product 自决不派
  // at-ui、PM 复核后同意并把裁决写进了 04-dispatch.md——那是一份磁盘文件，一条**已经
  // 存在**的决定，只是没有任何判据读得到它，于是 at-ui 那两份产物整趟缺席，而当时在场的
  // 判据一条都没响。trimmed 把那个决定变成可机器读的。
  //
  // ⚠️ 不要求写理由。理由已经在 04-dispatch.md 里，再要一份就是同一份知识的第二处。
  // trimmed 只回答「谁、在哪一段」。
  //
  // ⚠️ 缺失不报错，这是**向后兼容**：M3a 之前落盘的 state.json 没有这个字段，而
  // /agent-team:at-resume 会去读它们。模板里有，此后每一趟新 run 都带着。
  //
  // ⚠️ 这里只校验形状，**没有写时强制**（H6 rework-guard 那一档）。M3a 设计明写排除：
  // 先让这个字段存在、被判据读到，写时强制要等下一次真实 run 的误报率数据。
  //
  // ⚠️ 键的合法集合取的是「stages 里全部阶段 stageRoles 的并集」，**不是 roster.json 的
  // 键集合**——这一条与 Task 1 brief 的字面措辞（「花名册里的角色名」）不同，两个理由：
  //   1. validateState 的签名是 (state, { stages })，它手上没有 roster.json；要把它传进来
  //      就得改 hooks/gate.mjs 的调用点，而那是本轮另一条任务的文件。
  //   2. 更要紧的是**这个集合才是 trimmed 真正被读的那个口径**：读它的判据问的是
  //      「这一段的产者有没有交代」，一个不产出任何东西的角色被写进 trimmed 是一条没有
  //      意义的记录，按 roster.json 校验会放它过去。收窄到产者集合是**更紧**的那一条，
  //      不是更松的。
  //   今天在 roster.json 里而不是任何阶段产者的，是 `__main__` 与 `at-outsider`
  //   （重算：roster.json 的键集合减去 stages 全部 stageRoles 的并集）——
  //   **这是今天的数据，不是理由**，理由是上面那两条。
  //
  // stages 缺省时键与值的归属都不表态，与本函数其余按 stages 的检查（stage、artifacts
  // 的键、rework 的键）同一口径。
  if (Object.hasOwn(state, 'trimmed')) {
    if (!isPlainObject(state.trimmed)) {
      p('trimmed 不是对象——它是 { 角色名: 阶段 id } 的映射，记这一趟主动裁掉了谁')
    } else {
      const trimmable = isPlainObject(stages)
        ? new Set(Object.values(stages).flatMap((s) => stageRoles(s)))
        : null
      for (const [role, stage] of Object.entries(state.trimmed)) {
        if (typeof stage !== 'string') {
          p(`trimmed[${quote(role)}] 不是字符串——值要写这个角色是在哪一段被裁掉的（阶段 id）`)
        } else if (isPlainObject(stages) && !Object.hasOwn(stages, stage)) {
          p(`trimmed[${quote(role)}] 是 ${quote(stage)}，但 stages.json 里没有这个阶段`)
        }
        if (trimmable && !trimmable.has(role)) {
          p(`trimmed 里有 ${quote(role)}，但它不是任何阶段的产者——裁掉一个本来就什么都不产出的角色不构成交代`)
        }
      }
    }
  }

  // ——— stage_roles（M3x，docs/32）：roster 按段拆开 ———
  //
  // roster 不分段，按段判「齐了没」「谁没交代」的消费方从这里取这一段叫到了谁（hooks/lib/stages.mjs 的 participantsOf）。
  // 口径与 roster 同一个「叫到」，所以两条不变量是双向的：值里的每个角色都在 roster 里；roster 里的每个角色都在某一段里
  // ——后一条接住「累加了 roster、忘了记 stage_roles」，那一格按段判时这个角色的产物不被期待，提前判齐。
  //
  // ⚠️ 不要求是那一段的产者：架构师在 S5 被叫去分发（agents/at-architect.md）、PM 在 S3 叫 at-product 澄清需求、返工轮回到
  //    S3 时架构师叫执行角色调研，都是如实的叫到。（首轮 S3 时 04-dispatch.md 还不在，架构师派执行角色会被 H2 按 S5 的前置拒掉。）
  // ⚠️ 不与 trimmed 比：叫到之后又裁掉（预算耗尽）两样都是真事；拿 trimmed 的值当匹配键还会撞上 §5.22 那条
  //    「值是出处」，返工轮叫回首轮裁掉的角色也会误报。
  // ⚠️ 缺失不报，与 trimmed 同一个向后兼容：更早落盘的 run 没有它，门禁对它们按 roster 判。
  if (Object.hasOwn(state, 'stage_roles')) {
    if (!isPlainObject(state.stage_roles)) {
      p('stage_roles 不是对象——它是 { 阶段 id: [这一段叫到的角色] } 的映射，按段记这一趟叫到了谁')
    } else {
      const rosterSet = isStringArray(state.roster) ? new Set(state.roster) : null
      const recorded = new Set()
      for (const [stage, roles] of Object.entries(state.stage_roles)) {
        if (isPlainObject(stages) && !Object.hasOwn(stages, stage)) {
          p(`stage_roles 里有 ${quote(stage)}，但 stages.json 里没有这个阶段`)
        }
        if (!isStringArray(roles)) {
          p(`stage_roles[${quote(stage)}] 不是字符串数组`)
          continue
        }
        for (const role of roles) {
          recorded.add(role)
          if (rosterSet && !rosterSet.has(role)) {
            p(`stage_roles[${quote(stage)}] 里有 ${quote(role)}，roster 里却没有它——stage_roles 是 roster 按段拆开，叫到的角色两边都要记`)
          }
        }
      }
      if (rosterSet) {
        for (const role of rosterSet) {
          if (!recorded.has(role)) {
            p(`roster 里有 ${quote(role)}，但 stage_roles 没有任何一段记着它——把它并进它被叫到的那一段`)
          }
        }
      }
    }
  }

  // ——— rework_base（M3y，docs/33）：回退快照里各份产物的 sha ———
  //
  // { 产物名: sha | "accepted" }。回退那一次写入里记下回退那一刻磁盘上的 sha（更早各段沿用更早那次快照），之后原样带着，只许把当前段及更早段的某一条
  // 改成 "accepted"——这些写时规则在 H6（hooks/lib/rework-guard.mjs 的 decideReworkBase），这里只核形状。
  // ⚠️ 缺失不报，与 trimmed、stage_roles 同一个向后兼容：更早落盘的 run 没有它。
  // ⚠️ 值不回显：写错的 sha 回显出来只是 64 位十六进制的噪声，点名是哪一条就够了。
  if (Object.hasOwn(state, 'rework_base')) {
    if (!isPlainObject(state.rework_base)) {
      p('rework_base 不是对象——它是 { 产物名: sha 或 "accepted" } 的映射，记回退快照里各份产物的 sha')
    } else {
      const produced = producedNames(stages)
      for (const [k, v] of Object.entries(state.rework_base)) {
        if (!(typeof v === 'string' && (SHA_RE.test(v) || v === 'accepted'))) {
          p(`rework_base[${quote(k)}] 既不是 sha256:<64 位十六进制> 也不是 "accepted"`)
        }
        if (isPlainObject(stages) && !produced.has(k)) {
          p(`rework_base 里有 ${quote(k)}，但它不是任何阶段的 produces——rework_base 只记阶段产物`)
        }
      }
    }
  }

  if (!isPlainObject(state.artifacts)) {
    p('artifacts 不是对象')
  } else {
    // produces 并集抽到 hooks/lib/stages.mjs（评审发现 4）：此前这里与
    // hooks/lib/artifact-drift.mjs 的 compareArtifacts 各写一份——语义等价但写法
    // 不同（这里原来就是 Set，那边原来是 Array；不是逐字相同的拷贝，完整差异与
    // 为什么无害见 stages.mjs 头部）。stages 形状不对时 producedNames 返回空集合，
    // 下面 isPlainObject(stages) 的前置判断继续保留——语义与改之前完全一致：
    // stages 不是对象时这条问题不表态。
    const produced = producedNames(stages)
    for (const [k, v] of Object.entries(state.artifacts)) {
      if (typeof v !== 'string' || !SHA_RE.test(v)) p(`artifacts[${quote(k)}] 不是 sha256:<64 位十六进制>`)
      if (isPlainObject(stages) && !produced.has(k)) {
        p(`artifacts 里有 ${quote(k)}，但它不是任何阶段的 produces——artifacts 只记阶段产物的哈希`)
      }
    }
  }

  if (!Array.isArray(state.escalations)) {
    p('escalations 不是数组')
  } else {
    state.escalations.forEach((e, i) => {
      if (!isPlainObject(e)) return p(`escalations[${i}] 不是对象`)
      for (const k of ['stage', 'kind', 'question', 'answer', 'at']) {
        if (typeof e[k] !== 'string') p(`escalations[${i}].${k} 缺失或不是字符串`)
      }
      if (typeof e.kind === 'string' && !ESCALATION_KINDS.includes(e.kind)) {
        p(`escalations[${i}].kind 是 ${quote(e.kind)}，必须是规格 §5.1 列的这几类之一：${ESCALATION_KINDS.join('、')}`)
      }
    })
  }

  if (!Array.isArray(state.history) || state.history.length === 0) {
    p('history 缺失或为空——一个 run 至少进入过一个阶段，没有它 rework 就无法交叉校验')
  } else {
    state.history.forEach((e, i) => {
      if (!isPlainObject(e) || typeof e.stage !== 'string' || typeof e.at !== 'string') {
        return p(`history[${i}] 不是 { stage, at } 形状`)
      }
      if (isPlainObject(stages) && !Object.hasOwn(stages, e.stage)) {
        legacy.push(`history[${i}].stage 是 ${quote(e.stage)}，不在阶段链上`)
      }
    })
    const last = state.history[state.history.length - 1]
    if (isPlainObject(last) && last.stage !== state.stage) {
      p(`history 的最后一条是 ${quote(last.stage)}，但 stage 字段是 ${quote(state.stage)}——有人改了当前阶段却没记账`)
    }
  }

  if (!isPlainObject(state.rework)) {
    p('rework 不是对象')
  } else {
    for (const [k, v] of Object.entries(state.rework)) {
      if (!isNonNegativeInteger(v)) p(`rework[${quote(k)}] 不是非负整数`)
      if (isPlainObject(stages) && !Object.hasOwn(stages, k)) p(`rework 里有 ${quote(k)}，但 stages.json 里没有这个阶段`)
    }
    // §4.2 ③「不可重置」的落点：rework 必须严格等于 history 的派生量。
    // 两个方向都查——改小是逃预算，改大是虚报返工把自己推进升级。
    if (Array.isArray(state.history)) {
      const derived = reworkFromHistory(state.history)
      const keys = new Set([...Object.keys(derived), ...Object.keys(state.rework)])
      for (const k of keys) {
        const have = state.rework[k] ?? 0
        const want = derived[k] ?? 0
        if (have !== want) {
          p(`rework[${quote(k)}] 是 ${quote(have)}，但 history 里 ${quote(k)} 出现了 ${want + 1} 次，应当是 ${want}——` +
            `计数是 history 的派生量，不能单独改（规格 §4.2 ③）`)
        }
      }
    }
  }

  // 上限按派生值判，不按写着的值：写着的值与派生值对不上由上面那一条报（改成派生值，H6 放行）；派生值越限只能问用户。
  if (Array.isArray(state.history)) {
    for (const [stage, rounds] of Object.entries(reworkFromHistory(state.history))) {
      const limit = limitOf(stage, grants)
      if (rounds > limit) budget.push({ stage, rounds, limit })
    }
  }

  return { ok: problems.length === 0 && budget.length === 0, problems, budget, legacy }
}
