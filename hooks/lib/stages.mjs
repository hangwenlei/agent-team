// 派生自 stages.json 形状的小工具（纯函数）。
//
// 目前只有一个概念：**所有阶段 produces 的并集**——用来判断"这个名字是不是某个阶段的
// 产物"，不关心具体是哪个阶段。这个并集此前在 hooks/lib/state.mjs 的 validateState
// （校验 state.json 的 artifacts 的键）与 hooks/lib/artifact-drift.mjs 的
// compareArtifacts（账本比对要遍历的名字集合）各写了一份，两处都是 M1c 本轮新增
// （评审发现 4）。
//
// 两份**语义等价但写法不同**：validateState 那份构造的是 Set，compareArtifacts 那份
// 构造的是 Array——不是逐字相同的拷贝（这句话本身曾经写错，终审修复轮的定向复评发现 5
// 指出后改掉，别再往回抄）。统一成这里的 Set 顺带改变了一处边缘行为：compareArtifacts
// 那一侧如果同一个产物名出现在两个不同阶段的 produces 里，原来的 Array 会让下面的
// for 循环把它处理两次（重复的产物名在 drifted/missing/unrecorded 里重复上榜），改用
// Set 之后只处理一次。这个差**无害且当前不可达**：去重只能合并重复行、不可能把非空
// 列表变成空列表，而真实 stages.json 五个阶段的 produces 互不相同，这条边缘情形今天
// 走不到（复评已核实）。
//
// 两处实现没有 bug，但分叉的代价静默且不对称——若哪天只改了一份（比如"产物名允许带
// 路径分隔符"这类收紧/放宽），另一份不会有任何提示地继续用旧口径，两个"produces 并集"
// 就会答出不同的答案。本轮复评已经当场抓到过同族分叉复演一次（修复轮 3 (a)：同一条
// 正则写了两份，只放宽主判据那一份就全绿）——抽成单一真源，与本仓库已经做过的同类
// 抽法（hooks/lib/path-norm.mjs、hooks/lib/control-files.mjs、
// tests/helpers/agent-tools.mjs、tests/helpers/expected-agents.mjs）同一手法：多处
// 需要同一份知识时，只留一份，其余全部 import。
// Task 2 修复轮 1 · 修复 3：导出它——tests/stages.test.mjs 里判据「produces 是对象
// 形式」与它自己的正向自检锚各拼了一遍等价条件（`p !== null && typeof p === 'object'
// && !Array.isArray(p)` 等），拼法还彼此不一样。判据与它的自检锚不能是同一份知识的
// 第二份拷贝（docs/11 §3 点名过这条）——那样两处一旦改走样，谁都不会提示。让测试
// import 这里同一份，不是让它们各自再拼一次。
//
// M2b 终审 A2：上面那一轮**只接了测试那一侧**——导出了单一真源，却把 hooks/ 下的五份
// 私有拷贝原样留着（artifact-drift.mjs / reach.mjs / rework-guard.mjs / state.mjs 四份
// 逐字相同，hooks/gate.mjs 第五份叫 isValidInput、形参名 input，函数体形状等价）。
// 这与本分支 Task 2 修复轮 1 ③ 的裁定正面对照：那次判过「Array.isArray 是单一谓词、
// 没有第二种正确拼法可漂移，不值得抽；**而 isPlainObject 是手写的多条件布尔表达式，
// 那才有变体空间**」。按那条理由，该抽的恰恰是这几份。合并前逐份 md5 比对过：四份
// 私有拷贝声明逐字相同，五份（连同 gate.mjs 那份）函数体形状 md5 相同。
// 现在全部 import 这一份。本模块**不 import 任何东西**，所以没有环。
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// M2a：规格 §4 阶段表写的是 `05-impl/<role>.md`——一个**模式**。M1 期间 stages.json 把它
// 写成了字面量 ["05-impl/at-backend.md"]，后果是执行角色干完活写不进自己的实现记录
// （docs/11 §5.6，2026-09-19 的真实 run 里逼 PM 代笔）。这里把模式恢复成模式。
//
// ⚠️ producedNames 与 expectedArtifacts 答的是**不同的问题**，别合并：
//   - producedNames：这个名字是不是**任何一个**合法产者的产物（validateState 校验
//     artifacts 的键用它——账本里记着 05-impl/at-frontend.md 必须算合法）
//   - expectedArtifacts：**这一趟**该有哪些（compareArtifacts 的 drifted/missing 用它，整趟口径；isStageDone 从来没经过它，
//     它自己调 expandProduces + stageRolesInRun，M3x 起参与者由 participantsOf 按段取）
// 混用会重演 docs/11 §5.6 那个缺口。设计 §1.1 的表里写死了四个消费方各自的集合。
const ROLE_TOKEN = '<role>'

/** 这一阶段允许的产出角色。有 producers 用 producers，否则退回 [role]。 */
export function stageRoles(stage) {
  if (!isPlainObject(stage)) return []
  if (Array.isArray(stage.producers)) return stage.producers.filter((r) => typeof r === 'string')
  return typeof stage.role === 'string' ? [stage.role] : []
}

/** produces 的两种形式（规格 §4 的 M2b 注记）：
 *
 *   数组 `["05-impl/<role>.md"]`  —— 所有产者交同一个模式的东西（S5）。
 *                                    <role> 按 roles 逐个展开；不含占位符的条目
 *                                    原样保留**一次**（否则 S1 的 00-contract.md
 *                                    会随角色数量翻倍）。
 *   对象 `{"at-ui": ["02-ui-spec.md", ...]}` —— 各交各的（S2）。按 roles 取它们
 *                                    各自那几份，不在映射里的角色不产出。
 *
 * ⚠️ 这个函数是全部消费方的单一真源（清单见规格 §4 那张表）。两种形式都要有变异验证
 * 各自钉住——只钉一种的话，另一种可以被改坏而全绿。 */
export function expandProduces(stage, roles) {
  const out = []
  if (!isPlainObject(stage)) return out
  const list = Array.isArray(roles) ? roles.filter((r) => typeof r === 'string') : []

  // 对象形式：按角色取各自的产物。
  if (isPlainObject(stage.produces)) {
    for (const r of list) {
      const own = stage.produces[r]
      if (!Array.isArray(own)) continue
      for (const p of own) if (typeof p === 'string') out.push(p)
    }
    return out
  }

  // 数组形式：<role> 模式展开。
  if (!Array.isArray(stage.produces)) return out
  for (const p of stage.produces) {
    if (typeof p !== 'string') continue
    if (!p.includes(ROLE_TOKEN)) { out.push(p); continue }
    for (const r of list) out.push(p.split(ROLE_TOKEN).join(r))
  }
  return out
}

/** 这一阶段**在这一趟里**的产出角色：`stageRoles(stage) ∩ roster`。roster 不是数组时
 * （缺省、null、传错类型）退回全部 `stageRoles`——「没告诉我这趟派了谁」不等于「一个
 * 都没派」，退回更宽的集合，宁可多算不要漏算。
 *
 * ⚠️ 这一段逻辑当初有两个消费方（本文件的 expectedArtifacts、state.mjs 的 isStageDone），
 * Task 3 交付时它们各写了一份逐字同构的实现（一个用 Set.has、一个用 .includes）。
 * （今天还有 readiness.mjs 的 done；M3x 起 isStageDone 收到的不再是整趟 roster，是 participantsOf 取的这一段的人——
 * 求交仍在这里。）
 * 评审发现 1 点名了这一处，并预判 Task 4 接线 compareArtifacts 时会需要第三份——
 * 收敛在这里，第三份就不可能出现。这正是本文件头部那条「多处需要同一份知识时只留一份」
 * 的适用场景，不要再往回抄。 */
export function stageRolesInRun(stage, roster) {
  const roles = stageRoles(stage)
  if (!Array.isArray(roster)) return roles
  const inRun = new Set(roster.filter((r) => typeof r === 'string'))
  return roles.filter((r) => inRun.has(r))
}

/** 某一段**在这一趟里叫到了谁**——按段的消费方（isStageDone 的每一处调用、decideCoverage、at-status 与 at-resume 的展开口径；
 * at-qa 的自查在角色正文里照同一口径写）都从这里取（M3x，docs/32）。isStageDone 与 at-status、at-resume 再交给 stageRolesInRun
 * 与这一段的产者求交；decideCoverage 不经 stageRolesInRun，报的是这一段的产者减去这里给的人、再减去 trimmed 的全部键，
 * undefined 按空集算（coverage.mjs 那段「不学 stageRolesInRun」）。
 *
 * roster 不分段：at-ui 在 S2 进过 roster，S5 的展开就把它当成 S5 的产者——S5 不派它时永远不齐，它先交又提前判齐
 * （全量审查第 14 条）。state.json 从 M3x 起多一个 stage_roles：`{ 段 id: [角色...] }`，与 roster 同一个「叫到」
 * 口径、按段拆开，PM 在推进出那一段的同一次 Write 里记。
 *
 *   - state 不是对象 → undefined（stageRolesInRun 退回全部 producers，与 roster 读不出时同一口径）；
 *   - stage_roles 不是普通对象（缺失、null、数组、标量）→ 当它不在：退回 roster（数组时，只留字符串），否则 undefined。
 *     缺失是更早落盘的旧 run，v1.5.0 的行为原样保留；形状坏了由 validateState 报；
 *   - stage_roles 是对象：stageId 不是字符串、没有这个键（自有属性）、值不是数组 → []；否则只留字符串。
 *
 * ⚠️ 「有字段、没这一段的键」是空集，**不退回 roster**：那正是「这一段还没记账」——产物随参与者展开的段在 PM 记账之前
 * 判不齐（产物固定的段不受影响，照磁盘判），走过的段漏记由产者交代报出来。退回 roster 就把这一条要修的错原样请回来。
 * ⚠️ stageId 先判类型再查键（docs/27 §2.5）：它来自 state.json，{"toString":1} 拿去当属性键会抛。
 * ⚠️ 整趟口径的消费方（compareArtifacts、decideReadiness、never_invoked）**不经这里**，理由在 docs/11 §5.33 的收口。 */
export function participantsOf(state, stageId) {
  if (!isPlainObject(state)) return undefined
  if (!isPlainObject(state.stage_roles)) {
    return Array.isArray(state.roster) ? state.roster.filter((r) => typeof r === 'string') : undefined
  }
  if (typeof stageId !== 'string' || !Object.hasOwn(state.stage_roles, stageId)) return []
  const v = state.stage_roles[stageId]
  return Array.isArray(v) ? v.filter((r) => typeof r === 'string') : []
}

/** 这一趟**该有**的产物名。<role> 只按 roster ∩ producers 展开；不含占位符的条目不受
 * roster 影响（S1 的产物与谁被派了无关）。roster 缺省时退回全部 producers。 */
export function expectedArtifacts(stages, roster) {
  const out = new Set()
  if (!isPlainObject(stages)) return out
  for (const s of Object.values(stages)) {
    for (const n of expandProduces(s, stageRolesInRun(s, roster))) out.add(n)
  }
  return out
}

/** stages 里所有阶段 produces 的并集（<role> 按全部 stageRoles 展开），忽略形状不对的
 * 阶段条目。stages 本身形状不对（不是对象）时返回空集合——调用方各自决定"没有可判定的
 * 产物集合"该怎么处理，这里不表态、也不抛。 */
export function producedNames(stages) {
  const out = new Set()
  if (!isPlainObject(stages)) return out
  for (const s of Object.values(stages)) {
    for (const n of expandProduces(s, stageRoles(s))) out.add(n)
  }
  return out
}

/** 阶段链的最外一层形状：普通对象、至少一段、每一段都是普通对象。各段里面的字段由各个消费方自己防。
 * runctx 拿它判「插件装坏了」（M3v，docs/30 §3），H6 拿它判「读不出阶段链、跳过回退快照那几条」（M3y，docs/33）——
 * 同一个问题只留一份答案。 */
export function isStageChain(v) {
  if (!isPlainObject(v)) return false
  const values = Object.keys(v).map((k) => v[k])
  return values.length > 0 && values.every(isPlainObject)
}

/** 产物名 → 产出它的那一段与角色（链上第一个命中的；按全部 producers 展开）。不是任何一段的产物、阶段链读不出来：null。
 * 账本比对的「没记」那一行拿它认写者（M4g 复核，docs/42 §8）。 */
export function producerOfName(stages, name) {
  if (!isStageChain(stages) || typeof name !== 'string') return null
  for (const id of Object.keys(stages)) {
    for (const role of stageRoles(stages[id])) if (expandProduces(stages[id], [role]).includes(name)) return { stageId: id, role }
  }
  return null
}

/** 这一段**可能有**的全部产物：按全部 producers 展开，不按这一趟叫到了谁（M3y，docs/33）。回退那一刻的快照与「离开这一段时
 * 还有没有上一轮的产物」都问它——上一轮叫过、这一轮没叫的人留下的那份，同样是上一轮的。 */
export function productsOfStage(stage) {
  return expandProduces(stage, stageRoles(stage))
}

// M4b（docs/36）：执行段——produces 是「<role>」模式的段（每个产者交一份以自己命名的实现记录；插件自带的链里是 S5）。
// 按段的形状认，不写死段号（writepath.mjs 头部记过一次枚举段号写错的教训）。
export function isRolePatternStage(stage) {
  return isPlainObject(stage) && Array.isArray(stage.produces) && stage.produces.some((p) => typeof p === 'string' && p.includes('<role>'))
}

// M4s（docs/54）：这个角色在哪一段是执行段的产者（它有 paths、在别的段会被写路径隔离拒）。H5b 在规格段给它补「被拒了的写进这一段的产物」。
export function producesInRolePatternStage(stages, role) {
  return isStageChain(stages) && Object.values(stages).some((s) => isRolePatternStage(s) && stageRoles(s).includes(role))
}

// M4a（docs/35）：验证段——stages.json 里写着 "verifies": true 的段。它的产物是对上游当时那一版的结论（测试报告、验收报告、
// 交付报告）：返工轮里上游可能已经变了，上一轮那份不再对应现在的东西，所以一律重新出，rework_base 里不许标 "accepted"。
// 只认布尔 true——这是 H6 的判据，写成 "true" 或 1 的不算（stages.json 是插件自己的文件，判据钉着它的取值）。
export function isVerifyStage(stage) {
  return isPlainObject(stage) && stage.verifies === true
}

/** M4y（docs/60）：这个角色是哪一个验证段的产者（阶段链上第一个），不是回 null。H2 派它之前核契约的账。 */
export function verifyStageOf(stages, role) {
  if (!isStageChain(stages) || typeof role !== 'string') return null
  for (const id of Object.keys(stages)) {
    if (isVerifyStage(stages[id]) && stageRoles(stages[id]).includes(role)) return id
  }
  return null
}

/** 返工轮里这份产物能不能在 rework_base 里标 "accepted"：链上最早产出它的那一段不是验证段。不是任何一段的产物、阶段链读不出来：
 * 能（这一条不管它——坏条目怎么处理由 H6 的别的判据定）。H6 与每一处给出「标 accepted」出路的回传都问它，口径只此一份。 */
export function mayAcceptProduct(stages, name) {
  if (!isStageChain(stages) || typeof name !== 'string') return true
  for (const id of Object.keys(stages)) {
    if (productsOfStage(stages[id]).includes(name)) return !isVerifyStage(stages[id])
  }
  return true
}
