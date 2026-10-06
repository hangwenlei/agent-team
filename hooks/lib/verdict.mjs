// M4k（docs/46，docs/35 §5 与 docs/39 §3「收口不读验收结论」）：验收结论的固定首行与「照现状交付」的规范标签——单一真源。纯函数。
//
// 正文（/agent-team:at 第 3、6 节，agents/at-pm.md 红线）一直写着验收没过不推进、不收口，门禁却只核验收结论在不在、空不空、是不是这一轮的——
// M5f 里 haiku 版 PM 带着一份「不通过」推进、收口。现在：
//   - 验收结论（插件自带的链上是 07-acceptance.md）的第一个非空行固定是「结论：通过」「结论：不通过」「结论：判不了」之一（agents/at-acceptance.md）；
//   - 推进出验收那一段与收口时 H6 读它：不是「通过」、又没有门禁记下的「照现状交付」批准，拒；
//   - 照现状交付是用户的决定：用户经规范标签批准（AskUserQuestion 里选「照现状交付」，或者在对话里单独发这一句），门禁记进 approvals.jsonl，
//     按 sha 绑在那一刻的验收结论上（approval-ask、approval-prompt 两个记录器）。
import { isPlainObject, isRolePatternStage, isStageChain, isVerifyStage, productsOfStage, stageRoles } from './stages.mjs'
import { DELIVER_LABEL, normalizeLabel } from './budget.mjs'
import { closedAt } from './closing.mjs'
import { wholeStageTrimmed } from './advance.mjs'
import { SHA_RE, sha256OfContract } from './contract-hash.mjs'
import { isBlankText, normalizeText } from './text-norm.mjs'

export const ACCEPTANCE_ROLE = 'at-acceptance'
// 规范标签的单一真源在 budget.mjs（返工批准的标签也在那里）；这里原样再导出。
export { DELIVER_LABEL }
// approvals.jsonl 里照现状交付那一行的 kind（返工批准的行没有 kind、带 covers；两类行互不认）。
export const DELIVER_KIND = 'deliver-as-is'

const VERDICT_WORDS = { pass: '通过', fail: '不通过', unknown: '判不了' }
export const VERDICT_LINES = Object.values(VERDICT_WORDS).map((w) => `结论：${w}`)

// NFKC 之后匹配（全角冒号、括号、叹号都成了半角）。行首容许的装饰与冒泡标记（deliverable.mjs 的 BUBBLE_HEAD）一路：# > * _ ` - 与「【；
// 「结论」前面可以带「验收」；冒号两侧容许空白与强调。评审（F9）：「不通过」「判不了」按前缀认——后面夹了话（「不通过（第 2、3 条没过）」）
// 拦的效果一样，不为一句格式白派一次；「通过」保持严格，之后只容许强调、空白、句末标点与」】——「通过（第 3 条判不了）」读不出，不猜。
const VERDICT_RE = /^[\s#>*_`\-「【]*(?:验收)?结论[\s*_`]*:[\s*_`]*(?:(不通过|判不了)|通过[\s*_`」】。.!]*$)/

/** 验收结论首行：'pass' | 'fail' | 'unknown'；读不出（第一个非空行不是三者之一、没有非空行、不是文字）回 null。BOM、CRLF 照读。 */
export function acceptanceVerdict(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : typeof bytes === 'string' ? bytes : null
  if (text === null) return null
  // BOM 不用另剥：trim() 与正则行首的空白类都认 U+FEFF（变异核过：另剥它的那几行打不红）。
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '')
  if (first === undefined) return null
  const m = VERDICT_RE.exec(first.normalize('NFKC'))
  if (!m) return null
  if (m[1] === undefined) return 'pass'
  return Object.keys(VERDICT_WORDS).find((k) => VERDICT_WORDS[k] === m[1]) ?? null
}

/** 验收那一段与它的产物：阶段链上第一个产者里有 at-acceptance 的验证段（verifies: true）。读不出、没有这一段回 null。 */
export function acceptanceOf(stages) {
  if (!isStageChain(stages)) return null
  for (const [stageId, stage] of Object.entries(stages)) {
    if (!isVerifyStage(stage) || !stageRoles(stage).includes(ACCEPTANCE_ROLE)) continue
    const name = productsOfStage(stage)[0]
    return typeof name === 'string' ? { stageId, name } : null
  }
  return null
}

/**
 * 一个回答是不是「照现状交付」：归一化（budget.mjs 的 normalizeLabel，与返工批准同一套）之后整条等于它给 { deliver: true }；含有它却夹了
 * 别的话（「照现状交付吧」「不要照现状交付」「（不推荐）」）给 { malformed: true }；不相干的给 null。
 */
export function deliverIntent(answer) {
  if (typeof answer !== 'string') return null
  const n = normalizeLabel(answer)
  if (n === DELIVER_LABEL) return { deliver: true }
  return n.includes(DELIVER_LABEL) ? { malformed: true } : null
}

/** approvals.jsonl 里照现状交付的一行（不带换行）：sha 是批准那一刻磁盘上那份验收结论的 sha。 */
export function deliverLine({ at, source, product, sha }) {
  return JSON.stringify({ at, source, kind: DELIVER_KIND, product, sha })
}

/**
 * 读 approvals.jsonl 的原文：那份产物上记过的照现状交付批准，{ at, sha }（at 不是字符串的给 null）。坏行、别的产物的、返工批准的行都不算；
 * 没有文件给空。评审（F1、F2）：契约基线按 at 记哪一条批准已经用掉了（contract-base.mjs 的 deliver_used）。
 */
export function readDeliverApprovalEntries(text, name) {
  if (typeof text !== 'string') return []
  const out = []
  for (const raw of normalizeText(text).split('\n')) {
    if (!raw.trim()) continue
    let v
    try {
      v = JSON.parse(raw)
    } catch {
      continue
    }
    if (!isPlainObject(v) || v.kind !== DELIVER_KIND || v.product !== name || typeof v.sha !== 'string' || !SHA_RE.test(v.sha)) continue
    out.push({ at: typeof v.at === 'string' ? v.at : null, sha: v.sha })
  }
  return out
}

/** 那份产物上记过的照现状交付批准的 sha（H6 与【阶段】核验收结论用）。 */
export function readDeliverApprovals(text, name) {
  return readDeliverApprovalEntries(text, name).map((e) => e.sha)
}

// 照现状交付的出路（H6 的拒绝理由与【阶段】的收口阻碍共用）。act 是「收口」或「推进出 S7」这样的动作；标签原样。评审（F7、F9）：按首行分情形写——
// 不通过、判不了各说在什么情形下才轮得到问用户、escalation 记哪一类 kind；首行读不出、还在验收那一段的不附（同段重派不花钱）。
export function deliverRoute({ act, verdict, here = false }) {
  const when =
    verdict === 'fail'
      ? '没过的那几条不修、要照现状交付的（返工预算耗尽，或者用户自己说不修），那是用户的决定——escalation 的 kind 照问的那一类记' +
        '（返工预算耗尽是 budget-exhausted，要用户在没过的条目与契约之间取舍的是 contract-conflict）：'
      : verdict === 'unknown'
        ? '判不了的那几条补不上、要照现状交付的（环境跑不起来、返工预算耗尽，或者用户自己说不补），那是用户的决定——escalation 的 kind 照问的那一类记' +
          '（环境跑不起来是 env-blocked，返工预算耗尽是 budget-exhausted）：'
        : here
          ? null
          : '不想回退重验、要照现状交付的，那是用户的决定——读过验收结论之后，escalation 的 kind 照问的那一类记：'
  if (when === null) return ''
  return (
    when +
    `照 /agent-team:at 第 4 节先往 escalations 记一条（answer 写空串），再用 AskUserQuestion 问：一道单选题（multiSelect 设 false），` +
    `交付那一项的标签逐字写「${DELIVER_LABEL}」（推荐写在问题正文或选项说明里，不写进标签）。用户选了它，门禁记下这条批准（只对现在这份验收结论有效），` +
    `再${act}。问不了用户的（工具面里没有 AskUserQuestion），请用户在对话里单独发一条只写「${DELIVER_LABEL}」的消息。`
  )
}

const VERDICT_SAID = { fail: '「结论：不通过」', unknown: '「结论：判不了」' }

/**
 * 验收没过时怎么办（不含照现状交付那一条）：按首行分。判不了的按原因分四条（评审 F6：契约或完成定义没写清楚的问用户，重测补不了它）；读不出的
 * 按当前在不在验收那一段分同段重派与回退，回退写明哪几段各记一轮返工（评审 F8）。段 id、角色名来自阶段链，原样。
 */
export function verdictFix({ stages, verdict, current }) {
  const acc = acceptanceOf(stages)
  if (!acc) return ''
  const ids = Object.keys(stages)
  const earlier = ids.slice(0, ids.indexOf(acc.stageId)).reverse()
  const testStage = earlier.find((id) => isVerifyStage(stages[id]))
  const implStage = earlier.find((id) => isRolePatternStage(stages[id]))
  if (verdict === 'fail') return '照 /agent-team:at 第 3 节的「回退」回到要重做的那一段，重新走到这里'
  if (verdict === 'unknown') {
    return (
      `判不了是因为要人补跑测试的，照第 3 节的「回退」回到 ${testStage ?? '测试那一段'}；因为新行为缺自动化测试的，回到 ${implStage ?? '实现那一段'}；` +
      '因为环境跑不起来的，照第 4 节 env-blocked 问用户；因为契约或完成定义没写清楚的，照第 4 节 contract-hole 问用户'
    )
  }
  if (current === acc.stageId) return `在 ${acc.stageId} 里同段重派 ${ACCEPTANCE_ROLE}，让它把第一行照格式写（同一段里重派不计返工）`
  const cur = ids.indexOf(current)
  const span = cur > ids.indexOf(acc.stageId) ? ids.slice(ids.indexOf(acc.stageId), cur + 1) : [acc.stageId]
  return `照第 3 节的「回退」回到 ${acc.stageId}（${span.join('、')} 各记一轮返工），重派 ${ACCEPTANCE_ROLE}，让它把第一行照格式写`
}

/** 【阶段】收口阻碍那一行括号里的话（closing.mjs 的 blockerLine 原样放进去）：首行怎么了、出路、照现状交付。 */
export function verdictBlockerText({ stages, verdict, current }) {
  const acc = acceptanceOf(stages)
  const head =
    verdict === 'fail' || verdict === 'unknown'
      ? `第一行是${VERDICT_SAID[verdict]}，验收没过不收口`
      : '第一行不是「结论：通过」「结论：不通过」「结论：判不了」之一，门禁读不出验收结论'
  return `${head}——${verdictFix({ stages, verdict, current })}。${deliverRoute({ act: '收口', verdict, here: acc !== null && current === acc.stageId })}`
}

/**
 * 【阶段】在验收那一段齐了时补的一句（评审 F5：原来只说「齐了…推进到 S8」，推进一做就被 H6 拒）。写者是验收角色自己、首行读不出的：叫它把第一行
 * 改好再停（它有 Write，省一次重派）；写者是验收角色、首行没过的：说推进会被拒、回报时照实说；别的写者（PM）：照 H6 的拒绝理由给出路。
 */
export function verdictStageNote({ stages, block, writer }) {
  const acc = acceptanceOf(stages)
  if (!acc || !block) return ''
  if (writer === ACCEPTANCE_ROLE && block.verdict === null) {
    return (
      `你写的 ${block.name} 第一行读不出验收结论：把第一行改成${VERDICT_LINES.map((l) => `「${l}」`).join('')}之一（第一行之前不写标题，` +
      `这一行也不夹别的话），改完再停下——不改，推进出 ${acc.stageId} 会被拒，项目经理要再派你一次。`
    )
  }
  const act = `推进出 ${acc.stageId}`
  if (writer === ACCEPTANCE_ROLE) {
    return `验收结论第一行是${VERDICT_SAID[block.verdict]}：${act} 会被拒，回退还是问用户照现状交付由项目经理定——回报时照实说。`
  }
  return (
    `${act} 会被 H6 拒：${verdictHead({ name: block.name, verdict: block.verdict, act })}` +
    verdictFix({ stages, verdict: block.verdict, current: acc.stageId }) +
    '。' +
    deliverRoute({ act, verdict: block.verdict, here: true })
  )
}

/** 验收结论那一句的前半（H6 的拒绝理由用）。 */
export function verdictHead({ name, verdict, act }) {
  return verdict === 'fail' || verdict === 'unknown'
    ? `验收结论（${name}）第一行是${VERDICT_SAID[verdict]}：验收没过不${act}。`
    : `验收结论（${name}）的第一行不是「结论：通过」「结论：不通过」「结论：判不了」之一，门禁读不出验收结论——读不出就不${act}。`
}

/**
 * 这一趟的验收结论现在拦不拦（H6 与【阶段】共用一份）：验收那一段整段裁掉、谁都没叫过的，没有结论，不拦；结论不在、空的、读不出来、还是上一轮的，
 * 交给别的判据（推进的 advance.mjs、收口的 closeBlockers），这里不拦；首行「结论：通过」、或者门禁记下的照现状交付批准的 sha 等于它现在的
 * sha，不拦。拦的给 { name, stageId, verdict }。state 是写入后的、prior 是写入前的（「叫过」取并集，同收口）。
 * @returns {{ name: string, stageId: string, verdict: 'fail'|'unknown'|null } | null}
 */
export function acceptanceBlock({ stages, state, prior, bytesOf, approvedShas = [], dispatched = null }) {
  const acc = acceptanceOf(stages)
  if (!acc || wholeStageTrimmed(stages, acc.stageId, state, prior, dispatched)) return null
  let bytes = null
  try {
    bytes = bytesOf(acc.name)
  } catch {
    bytes = null
  }
  if (!bytes || isBlankText(bytes)) return null
  const digest = sha256OfContract(bytes)
  const rb = isPlainObject(state?.rework_base) ? state.rework_base : {}
  if (rb[acc.name] === digest) return null
  const verdict = acceptanceVerdict(bytes)
  if (verdict === 'pass') return null
  if (Array.isArray(approvedShas) && approvedShas.includes(digest)) return null
  return { name: acc.name, stageId: acc.stageId, verdict }
}

/**
 * H6 的验收结论判据（M4k，排在 H6 最后——契约基线判据之后：对着上一版契约的结论先重出，读它的首行才有意义）。只管两种写入：推进（stage
 * 往阶段链后面挪，而且验收那一段在到达段之前）与收口（closed_at 新写上、写入前没收口）；回退、原地重写、补记别的字段不判。评审（F11）：写入前的
 * state.json 读不出、写入后收口的，照收口判（与 decideClosing「写入前读不出来也算」同一个口径）。
 * bytesOf(name) → Buffer | null（不在、读不出来）；approvedShas：门禁记下的照现状交付批准记的 sha（readDeliverApprovals）。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideAcceptance({ before, after, stages, bytesOf, approvedShas = [], dispatched = null }) {
  if (!isPlainObject(after) || !isStageChain(stages)) return { ok: true }
  const acc = acceptanceOf(stages)
  if (!acc) return { ok: true }
  const prior = isPlainObject(before) ? before : null
  const ids = Object.keys(stages)
  const from = prior ? ids.indexOf(prior.stage) : -1
  const to = ids.indexOf(after.stage)
  const closing = closedAt(after) !== null && closedAt(prior) === null
  const advancing = from >= 0 && to > from && ids.indexOf(acc.stageId) < to
  if (!closing && !advancing) return { ok: true }
  const block = acceptanceBlock({ stages, state: after, prior: prior ?? undefined, bytesOf, approvedShas, dispatched })
  if (!block) return { ok: true }
  const act = closing ? '收口' : `推进出 ${acc.stageId}`
  const current = prior ? prior.stage : after.stage
  return {
    ok: false,
    reason:
      verdictHead({ name: block.name, verdict: block.verdict, act }) +
      verdictFix({ stages, verdict: block.verdict, current }) +
      '。' +
      deliverRoute({ act, verdict: block.verdict, here: current === acc.stageId }),
  }
}
