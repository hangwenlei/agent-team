// 返工预算的批准（M3z，docs/34，全量审查第 16 条）。纯函数，单一真源。
//
// 规格 §4.2 ③「第 3 轮终局，不过则升级」此前没有续一轮的诚实写法：rework[S] 要不低于 history 的派生值（H6 判据③），又要
// 不超过 3（判据④），派生值到 4 时两条互斥；用户在升级里批准了再来一轮，PM 只剩「不记账就派人」一条路。现在：
//   - 用户经规范标签批准——AskUserQuestion 里选了「再返工一轮：回到 T」，或者在对话里单独发一条整条只写它的消息；
//   - 门禁自己把批准记进 runs/<当前 run>/approvals.jsonl（PostToolUse:AskUserQuestion 与 UserPromptSubmit 两个检查项，
//     hooks/gate.mjs）。PM 写不了它（H3 把它登记为门禁专属文件），也不用写：模型预填的答案到 PostToolUse 时已被宿主的真实
//     答案覆盖（docs/34 §1 的平台实测）；
//   - 一条批准只在记录那一刻「回到 T」会让某些段越限时才记，covers 就是那几段（O1、O2：上限内顺手说的、重复说的、换目标
//     再说的，都不多给额度；还没走到的段不预支）。上限 limitOf(S) = REWORK_LIMIT + 覆盖 S 的批准条数；
//   - H6 判据④、回退预判、validateState 的【返工预算】、【阶段】都从这里取上限与标签。
//
// ⚠️ 标签的认法（approvalIntent）：先 NFKC、删掉全部空白，再剥一次末尾的「(Recommended)」或「(推荐)」——平台的
//    AskUserQuestion 说明叫模型给推荐项加「(Recommended)」，转录里 PM 写进标签的推荐后缀很常见，模型也会把全角冒号写成
//    半角（docs/34 §1）。闭集，不剥「（不推荐）」「（最快，推荐）」这类：宽泛地剥会把相反的意思也收进来。
// ⚠️ 回退预判的计数（overLimit）：写入后 history 里、最后那条回退条目之前 S 的出现次数（O5）。按写入后整份计数会拒掉预算内的
//    补记，按写入前计数会放过一次写入记两轮。
import { isPlainObject, isStageChain } from './stages.mjs'
import { normalizeText } from './text-norm.mjs'

// 返工预算的硬上限（规格 §4.2 ③：第 3 轮终局，不过则升级）。原来定义在 state.mjs，M3z 挪到这里：state.mjs 要从本模块取
// limitOf，常量留在那边就成了环。state.mjs 原样再导出它，既有的 import 不用改。
export const REWORK_LIMIT = 3

export const APPROVAL_PREFIX = '再返工一轮：回到 '
export const STOP_LABEL = '停在这里'
// M4k（docs/46）：照现状交付的规范标签（验收结论没过时，用户批准带着它交付；verdict.mjs 原样再导出，记录器与 H6 从那边用）。
export const DELIVER_LABEL = '照现状交付'

/** 规范标签。stageId 是阶段链上的 id（插件自己的名字），原样。 */
export function approvalLabel(stageId) {
  return `${APPROVAL_PREFIX}${stageId}`
}

const RECOMMENDED_RE = /\((?:recommended|推荐)\)$/i
// 段 id 只认字母、数字、下划线与连字符（stages.json 的键都是这个形状）：写宽了，「回到 S5（不推荐）」会被认成段「S5(不推荐)」。
const LABEL_RE = /^再返工一轮:回到([A-Za-z0-9_-]+)$/

// 规范标签的归一化（M4k 起「照现状交付」也用它，verdict.mjs 的 deliverIntent）：两个标签一套认法。
export function normalizeLabel(s) {
  return s.normalize('NFKC').replace(/\s+/g, '').replace(RECOMMENDED_RE, '')
}

/**
 * 一个回答是不是规范标签：是就给它说的段 { stage }（还没核在不在链上）；像是要批准、却认不出（带了别的后缀、夹了别的话）
 * 给 { malformed: true }，好让门禁回传说清没记下的原因；不相干的给 null。
 */
export function approvalIntent(answer) {
  if (typeof answer !== 'string') return null
  const n = normalizeLabel(answer)
  const m = LABEL_RE.exec(n)
  if (m) return { stage: m[1] }
  return n.includes('再返工一轮') ? { malformed: true } : null
}

/** 认得出就给段，否则 null。 */
export function parseApprovalLabel(answer) {
  const intent = approvalIntent(answer)
  return intent && intent.stage ? intent.stage : null
}

/**
 * 读 approvals.jsonl 的原文。只认 covers 是「阶段链上段 id 组成的非空数组」的行，坏行、带一个坏元素的行整行不算；rework_to
 * 只留给人读（不是链上的段就给 null）。没有文件、阶段链读不出来：一条都不算——更严的一侧。
 * @returns {{ reworkTo: string|null, covers: string[] }[]}
 */
export function readGrants(text, stages) {
  if (typeof text !== 'string' || !isStageChain(stages)) return []
  const onChain = (s) => typeof s === 'string' && Object.hasOwn(stages, s)
  const out = []
  for (const raw of normalizeText(text).split('\n')) {
    if (!raw.trim()) continue
    let v
    try {
      v = JSON.parse(raw)
    } catch {
      continue
    }
    if (!isPlainObject(v) || !Array.isArray(v.covers) || v.covers.length === 0 || !v.covers.every(onChain)) continue
    out.push({ reworkTo: onChain(v.rework_to) ? v.rework_to : null, covers: [...v.covers] })
  }
  return out
}

/** 某一段的返工上限：REWORK_LIMIT 加上覆盖它的批准条数。 */
export function limitOf(stageId, grants) {
  const list = Array.isArray(grants) ? grants : []
  return REWORK_LIMIT + list.filter((g) => Array.isArray(g.covers) && g.covers.includes(stageId)).length
}

/** 拒绝理由里那一句「门禁这一趟记下的返工批准」。段 id 都是核过在链上的，原样。 */
export function grantsSummary(grants) {
  const list = Array.isArray(grants) ? grants : []
  if (!list.length) return '0 条'
  const parts = list.map((g) => `${g.reworkTo ? `回到 ${g.reworkTo}，` : ''}覆盖 ${g.covers.join('、')}`)
  return `${list.length} 条（${parts.join('；')}）`
}

/**
 * 越限之后怎么办（H6 的回退预判与判据④、【返工预算】、【阶段】共用）：问用户、用户叫停怎么办、问不了怎么办，再加门禁这一趟记下
 * 了几条批准。target 是阶段链上的 id（插件自己的名字），原样。then 是用户批准之后紧接着要做的那一步。
 * 推荐写进问题正文或选项说明、不写进标签：平台会叫模型往推荐项标签上加「(Recommended)」，门禁认得出这一个后缀，别的认不出。
 */
export function askUserText(target, grants, then) {
  const label = approvalLabel(target)
  return [
    `先往 escalations 记一条 budget-exhausted（answer 先写空串），再用 AskUserQuestion 问用户：一道单选题（multiSelect 设 false），两个选项的标签逐字写「${label}」与「${STOP_LABEL}」——` +
      '推荐写在问题正文或选项说明里，不要加进标签。用户选了前者，门禁会记下这条批准（回传里会说记没记下）。之后照 ' +
      `/agent-team:at 第 4 节：契约追加修订块（回传给你新的 contract_sha），${then}`,
    // M4k（docs/46，评审 F4）：验收没过而返工用尽，用户可能要照现状交付——这三处门禁文字原来只给两个选项，PM 照它问，用户得自己知道要打那几个字。
    `验收结论已经写成、第一行不是「结论：通过」的（验收没过），可以加第三个选项，标签逐字写「${DELIVER_LABEL}」：用户选了它，门禁记下照现状交付的` +
      '批准，不再回退，照 /agent-team:at 第 4 节「照现状交付」那一段往下走。',
    `用户选「${STOP_LABEL}」：不回退也不推进，把那一条的 answer 写成用户原话，` +
      '把现状、run id 与续跑的办法告诉用户，停下等用户。',
    `问不了用户（工具面里没有 AskUserQuestion，例如不带权限提示工具的 -p、--bg）：停下，告诉用户在对话里单独发一条消息、整条只写「${label}」也算批准。`,
    `门禁这一趟记下的返工批准：${grantsSummary(grants)}。`,
  ].join('\n')
}

function chainIndex(stages) {
  const ids = Object.keys(stages)
  return (s) => (typeof s === 'string' && Object.hasOwn(stages, s) ? ids.indexOf(s) : -1)
}

function entryStage(e) {
  return isPlainObject(e) && typeof e.stage === 'string' ? e.stage : undefined
}

/**
 * history 里最后一条回退条目的下标：在阶段链上不晚于它之前最近一条在链上的条目。链外条目（v1.7.0 及更早写进去的 DONE 之类）
 * 跳过，不打断比较（复核 budget-2：停在 DONE 的旧 run 回退时要认得出）。没有就是 -1。与 rework-guard.mjs 的 restartInfo 同一个口径。
 */
export function lastRestart(history, stages) {
  if (!Array.isArray(history) || !isStageChain(stages)) return -1
  const at = chainIndex(stages)
  let prev = -1
  let last = -1
  history.forEach((e, j) => {
    const cur = at(entryStage(e))
    if (cur < 0) return
    if (prev >= 0 && cur <= prev) last = j
    prev = cur
  })
  return last
}

/**
 * 这一轮（回到 history[restartIndex] 那一段）走完会越限的段：阶段链上不早于回到的那一段、在回退条目之前出现过 rounds 次、
 * rounds > 上限。rounds 就是这一轮重进它之后的返工轮数。按链序。
 * @returns {{ stage: string, rounds: number, limit: number }[]}
 */
export function overLimit({ history, restartIndex, stages, grants }) {
  if (!Array.isArray(history) || !isStageChain(stages)) return []
  const at = chainIndex(stages)
  const t = at(entryStage(history[restartIndex]))
  if (t < 0) return []
  const count = {}
  for (const e of history.slice(0, restartIndex)) {
    const s = entryStage(e)
    if (at(s) >= t) count[s] = (count[s] ?? 0) + 1
  }
  const out = []
  for (const id of Object.keys(stages)) {
    const rounds = count[id] ?? 0
    const limit = limitOf(id, grants)
    if (rounds > limit) out.push({ stage: id, rounds, limit })
  }
  return out
}

/**
 * 假如现在回退到 target：会越限的段（批准的 covers）。不是回退（target 晚于 history 末条、末条不在链上）、target 不在链上、
 * 读不出来、不越限：空数组——这条批准不需要，门禁不记。
 */
export function needOf({ state, stages, grants, target }) {
  if (!isPlainObject(state) || !Array.isArray(state.history) || !isStageChain(stages)) return []
  const at = chainIndex(stages)
  const t = at(target)
  if (t < 0 || state.history.length === 0) return []
  // 与最近一条在链上的条目比（链外条目跳过，同 lastRestart）。
  const onChain = state.history.map((e) => at(entryStage(e))).filter((i) => i >= 0)
  const last = onChain.length ? onChain[onChain.length - 1] : -1
  if (last < 0 || t > last) return []
  const history = [...state.history, { stage: target }]
  return overLimit({ history, restartIndex: history.length - 1, stages, grants }).map((o) => o.stage)
}

/**
 * 某一段越限时，标签里写回到哪一段：history 里最后一次回退回到的那一段（不晚于越限的段）；没有回退就写越限的段本身。
 * 照它问、照 needOf 记下的批准盖得住越限的那一段（推进进越限的段、批准丢了之后补批准，都一样）。
 */
export function approvalTargetFor({ history, stages, stage }) {
  if (!isStageChain(stages)) return stage
  const j = lastRestart(history, stages)
  if (j < 0) return stage
  const at = chainIndex(stages)
  const t = entryStage(history[j])
  return at(t) <= at(stage) ? t : stage
}
