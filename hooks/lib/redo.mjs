// 不记回退就重派、重做（M3z，docs/34，全量审查第 16 条）。纯函数，I/O 由 gate.mjs 注入。
//
// 驳回之后不记回退、直接派人重做，每一帧都放行：返工预算被绕过，第 15 条的回退快照与重走把关整条失效——它们都挂在「回退被
// 记下」这一前提上。派发那一刻分不出咨询、补派、重做（研究里的 L1–L9），所以只在分得出的两处拦：
//
//   - H2，只管叶子角色（花名册里派不出任何人）：按派发者选出的候选段（readiness.mjs 的 candidateStages，与 H2 选段同一个口径）
//     全都早于 state.stage，而且目标在这些段自己的产物都「交过」——再派它就是重做。协调者（at-architect、at-product）在派发时
//     不判：PM 在 S5 派架构师是正路，派协调者去问点什么也是正文写着的；它真动手重做，落到下面 H3 与它再往下派的那一跳。
//     不加「目标在当前段有活」这个豁免：at-product 在 S5 派 at-ui 重做 S2（at-ui 在 S5 也有活）照拒（P10）。
//   - H3：非 PM 写 run 目录里自己名下、早于 state.stage 那一段的产物，它在当前段没有活（不是当前段的 role 或产者、也派不到
//     当前段的 role），而且那份「交过」——改它就是重做那一段。架构师在 S5 改 03-arch.md、at-ui 在 S5 改 02-*：它们在 S5 有活，
//     放行（真实 run 里出现过，L2）。PM 自己的产物不判（契约修订块、04-dispatch.md 的增补都是正文明令，L3）。
//
// 「交过」= 交付快照（runs/<id>/delivered.json）里有它、磁盘内容与快照相同、而且不是上一轮的（freshness 的 isStale）。快照由门禁
// 在 PM 写 state.json、而 stage 变了（推进、回退）之后照磁盘拍（gate.mjs 的 ledger 分支，deliveredSnapshot；快照里记着拍它时的
// stage）：早于当前段的各段产物记 sha，当前段及之后的不记。于是：
//   - 推进之后才落盘的（补派、提前推进之后迟到的交付）、快照之后改过的、还是上一轮的（【返工】的出口）：不算交过，写几次都放行，
//     直到下一次推进或回退（O4：门禁自己指出去的两条路，第二次写不能拒；复核 redo-4：只记账、不动 stage 的写入不关这个窗口）；
//   - 不依赖 PM 把 sha 记进 artifacts（那条回传只发给写者，第 28 条）。
// 快照是门禁专属文件（H3 对 Edit/Write 一律拒，control-files.mjs 的 GATE_FILES）。读不出来、算不出 sha：一律当没交过——少拦一侧。
//
// ⚠️ 「是不是重做」看 state.stage。H2 只拿候选段与 stage 比先后：stage 落后（齐了没推进）只会少拦，超前（第 17 条的提前推进）会多拦，
//    出口是记回退。H3 还按 stage 判写者在当前段有没有活：stage 落后也会多拦（S4 齐了没推进、架构师已在做 S5 时改 03-*），那时的
//    出口是推进 stage，拒绝理由里说了（复核的文档核对）。docs/31 §2.2
//    「H2 选段不看 state.stage」不受影响：选段仍按派发者，这里只拿选出来的段与 stage 比先后。
import { isPlainObject, isStageChain, productsOfStage, stageRoles, expandProduces } from './stages.mjs'
import { SHA_RE } from './contract-hash.mjs'
import { normalizeText } from './text-norm.mjs'
import { isValidRoster } from './decide.mjs'
import { inline } from './trusted.mjs'

const isSha = (v) => typeof v === 'string' && SHA_RE.test(v)

function indexIn(stages, id) {
  return typeof id === 'string' && Object.hasOwn(stages, id) ? Object.keys(stages).indexOf(id) : -1
}

/**
 * 写 state.json 之后的交付快照：早于 stageId 的每一段、按全部产者展开的产物（productsOfStage），磁盘上在、读得出的记 sha。
 * stageId 不在链上、阶段链读不出来：null——调用方不动原来的快照。diskSha(name) → { exists, sha }，读不出来时 sha 为 null。
 */
export function deliveredSnapshot({ stages, stageId, diskSha }) {
  if (!isStageChain(stages)) return null
  const c = indexIn(stages, stageId)
  if (c < 0) return null
  const out = {}
  for (const id of Object.keys(stages).slice(0, c)) {
    for (const name of productsOfStage(stages[id])) {
      if (Object.hasOwn(out, name)) continue
      const d = diskSha(name)
      if (d && d.exists && isSha(d.sha)) out[name] = d.sha
    }
  }
  return out
}

/**
 * delivered.json 的原文 → { stage: 拍快照时的 state.stage, products: { 产物名: sha } }。坏文件、不是对象：{ stage: null, products: {} }；
 * 值不是 sha 的那一条不算。stage 用来判「这次写 state.json 要不要重拍」：stage 没变就不重拍（复核 redo-4）。
 */
export function readSnapshot(text) {
  const none = { stage: null, products: {} }
  if (typeof text !== 'string' && !Buffer.isBuffer(text)) return none
  let v
  try {
    v = JSON.parse(normalizeText(text))
  } catch {
    return none
  }
  if (!isPlainObject(v) || !isPlainObject(v.products)) return none
  const products = {}
  for (const [k, sha] of Object.entries(v.products)) if (isSha(sha)) products[k] = sha
  return { stage: typeof v.stage === 'string' ? v.stage : null, products }
}

/** 「交过」：快照里有、磁盘 sha 与快照相同、不是上一轮的。artifactSha(name) → sha 或 null；任何一步抛异常都算没交过。 */
export function makeDelivered({ snapshot, artifactSha, isStale }) {
  const snap = isPlainObject(snapshot) ? snapshot : {}
  return (name) => {
    if (typeof name !== 'string' || !Object.hasOwn(snap, name)) return false
    try {
      if (artifactSha(name) !== snap[name]) return false
      return !isStale(name)
    } catch {
      return false
    }
  }
}

/** 花名册里派不出任何人的角色。花名册读坏、不在花名册里：不是（不判，少拦一侧）。 */
export function isLeafRole(roster, role) {
  if (!isValidRoster(roster) || typeof role !== 'string' || !Object.hasOwn(roster, role)) return false
  const entry = roster[role]
  return isPlainObject(entry) && Array.isArray(entry.can_delegate_to) && entry.can_delegate_to.length === 0
}

/** role 在 stageId 那一段有没有活：是那一段的 role 或产者，或者（传递地）派得到那一段的 role（isCoordinatorFor 的口径甲）。 */
export function hasWorkIn({ stages, stageId, role, reachableRoles }) {
  if (!isPlainObject(stages) || typeof stageId !== 'string' || !Object.hasOwn(stages, stageId)) return false
  const s = stages[stageId]
  if (!isPlainObject(s)) return false
  if (s.role === role || stageRoles(s).includes(role)) return true
  return typeof s.role === 'string' && Array.isArray(reachableRoles) && reachableRoles.includes(s.role)
}

/**
 * H2：叶子角色的重派。candidates 是 candidateStages 选出的 [[段 id, 段]]；callerCanWriteState 决定出口说给谁（gate.mjs 用
 * isContractWriter 算，与 H3 同一个谓词）。target 是这次调用给的 subagent_type（剥过插件前缀），过 inline。
 * @returns {{ decision: 'allow' } | { decision: 'deny', reason: string }}
 */
export function decideRedispatch({ stages, stageId, target, roster, candidates, isDelivered, callerCanWriteState = false }) {
  if (!isLeafRole(roster, target) || !isStageChain(stages)) return { decision: 'allow' }
  const c = indexIn(stages, stageId)
  if (c < 0 || !Array.isArray(candidates) || candidates.length === 0) return { decision: 'allow' }
  const ids = candidates.map(([id]) => id)
  if (!ids.every((id) => indexIn(stages, id) >= 0 && indexIn(stages, id) < c)) return { decision: 'allow' }
  const own = [...new Set(candidates.flatMap(([, s]) => expandProduces(s, [target])))]
  if (own.length === 0 || !own.every((n) => isDelivered(n))) return { decision: 'allow' }
  const cur = Object.keys(stages)[c]
  const where = ids.join('、')
  const files = own.join('、')
  const head = `${inline(target)} 在 ${where} 的产物（${files}）这一轮已经交过，而 state.stage 是 ${cur}：再派它，就是不记回退重做 ${where}。`
  // M4a（docs/35）：stage 是阶段链最后一段时，这次派发多半是交付之后的新改动（问题 A）——只给「记回退」会把新需求塞进旧契约、
  // 吃旧 run 的返工额度。先给「收口、另起一趟」，记回退只留给这一趟的产物真有问题。
  const chainLength = Object.keys(stages).length
  const atEnd = c === chainLength - 1
    ? `state.stage 是阶段链最后一段：要是交付之后的新改动，先照 /agent-team:at 第 6 节收口、再另起一趟——不要记回退把新需求塞进这一趟；` +
      `要是这一趟的产物有问题要返工，才照下面记回退。`
    : ''
  const out = callerCanWriteState
    ? `${atEnd}要它返工：照 /agent-team:at 第 3 节的「回退」先记一次回退（回到 ${where}），再派它——返工计数照记，到上限会被要求先问用户。` +
      `只是要问它点什么：不要派它，自己读它的产物（run 目录里的 ${files}）与代码，或者问用户。`
    : `只是要问它点什么：不要派它，自己 Read/Glob 它的产物与代码。真要它重做，那是一次回退，记回退是项目经理的事：` +
      `把这一条冒泡给派你的人。`
  return { decision: 'deny', reason: head + out }
}

/**
 * H3：非 PM 写早段自己名下的产物。owner 是 writepath.mjs 的 stageOwnerOfRunPath 给的 { stageId, produces }（产物名是插件自己的
 * 名字）；filePath 是这次调用给的路径，过 inline。PM 不在这里判（调用方先排掉）。
 */
export function decideRedoWrite({ stages, stageId, role, owner, filePath, isDelivered, reachableRoles, artifactExists }) {
  if (!isStageChain(stages) || !isPlainObject(owner)) return { decision: 'allow' }
  const c = indexIn(stages, stageId)
  const x = indexIn(stages, owner.stageId)
  if (c < 0 || x < 0 || x >= c) return { decision: 'allow' }
  if (hasWorkIn({ stages, stageId, role, reachableRoles })) return { decision: 'allow' }
  // 复核（docs/34 §3，redo-3）：交了一半的补派——写者在那一段的另一份产物这一窗口刚补上（在磁盘上、却不算交过），这一次改已交的那份
  // 当补派的一部分放行（例：at-ui 补上线框图之后改 02-ui-spec.md 去引用它）。不用「整段都交过才算重做」：一份从没写过的兄弟产物
  // （常年缺席的 03-alignment.md）会让这一段的 H3 永久放开（核验者实测）。
  const siblings = expandProduces(stages[owner.stageId], [role]).filter((n) => n !== owner.produces)
  const supplementing = typeof artifactExists === 'function' && siblings.some((n) => artifactExists(n) && !isDelivered(n))
  if (supplementing || !isDelivered(owner.produces)) return { decision: 'allow' }
  const ids = Object.keys(stages)
  const cur = ids[c]
  const was = ids[x]
  return {
    decision: 'deny',
    reason:
      `${inline(role)} 不得改 ${inline(filePath)}——它是 ${was} 的产物 ${owner.produces}，这一轮已经交过；state.stage 是 ${cur}，` +
      `你在 ${cur} 没有活。改它就是不记回退重做 ${was}：把这一条冒泡给派你的人，由项目经理先记一次回退（回到 ${was}）再派你。` +
      '只是发现它有问题：写进你的回报里，不要改它。state.stage 若是停在旧阶段（当前段的产物已经齐了、其实已经在做后面的段），' +
      '回报里说清楚：该做的是推进 stage，不是记回退。',
  }
}
