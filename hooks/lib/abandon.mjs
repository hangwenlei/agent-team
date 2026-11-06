// 放弃收尾：完整的一趟与微调都能由门禁认的「放弃」冻结。纯函数，I/O 由 gate.mjs 注入。
//
// 用户说不做了：项目经理列出这一趟改过的文件、退不退回照 sensitive 问用户，再用 AskUserQuestion 单独问一道单选题，题面原样写着这一趟的 run id，
// 规范标签「放弃这一趟」。用户选了，批准记录器往那一趟的 approvals.jsonl 追加一行（kind: abandon）。之后项目经理一次写入记 closed_at（门禁此刻的时间）
// 与 abandoned: true，stage 与 history 原样带着；H6 在那一次核批准，不核产物（decideAbandon）。
//
// 放弃就是一次收口：closedAt 认它——冻结（abandoned 也不许再改，closing.mjs）、H2 拒派、归属不再挡、互斥与认领不再算它，这些现成的判定都不用改。
// 只认 AskUserQuestion：对话里打字不认（门禁看不到用户是对着哪一道题、哪一趟说的），与接手同一个口径。
import { isPlainObject } from './stages.mjs'
import { closedAt, gateClock } from './closing.mjs'
import { labelAnswer } from './owner.mjs'
import { quote } from './trusted.mjs'

export const ABANDON_LABEL = '放弃这一趟'
export const ABANDON_KIND = 'abandon'

/** PostToolUse:AskUserQuestion 的 tool_response 里有没有选「放弃这一趟」：null、{ question }（那道题的题面）或 { why }（像是选了、却不记）。 */
export function abandonAnswer(toolResponse) {
  const a = labelAnswer(toolResponse, [ABANDON_LABEL])
  if (!a) return null
  return a.why ? { why: a.why } : { question: a.question }
}

export function abandonLine({ at, runId }) {
  return JSON.stringify({ kind: ABANDON_KIND, at, run: runId })
}

/**
 * approvals.jsonl 的原文里有没有放弃这一趟的批准：kind 是 abandon、run 是这一趟（isThisRun(run) 为真；调用方按规范化之后的目录比）。
 * 绑 run id：批准记录 Edit/Write 写不进，Bash 拷得进——别的一趟的批准拷过来不算。
 */
export function readAbandoned(text, isThisRun) {
  if (typeof text !== 'string' || typeof isThisRun !== 'function') return false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const v = JSON.parse(line)
      if (isPlainObject(v) && v.kind === ABANDON_KIND && typeof v.run === 'string' && v.run !== '' && isThisRun(v.run)) return true
    } catch {}
  }
  return false
}

/** 这一次写入是不是放弃收尾：写入前没收口（读不出也算）、写入后收口、带 abandoned: true。 */
export function isAbandoning(before, after) {
  return isPlainObject(after) && after.abandoned === true && closedAt(after) !== null && closedAt(before) === null
}

const historyLength = (s) => (isPlainObject(s) && Array.isArray(s.history) ? s.history.length : -1)

/**
 * H6：abandoned 的形状与放弃那一次的条件。写入前已收口的交给 decideClosing 的冻结。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideAbandon({ before, after, approved }) {
  if (!isPlainObject(after)) return { ok: true }
  if (Object.hasOwn(after, 'abandoned') && typeof after.abandoned !== 'boolean') {
    return { ok: false, reason: `abandoned 是放弃收尾的标记，只能是 true 或 false（这次写成了 ${quote(after.abandoned)}）。没有放弃就写 false。` }
  }
  if (closedAt(before) !== null) return { ok: true }
  if (after.abandoned === true && closedAt(after) === null) {
    return { ok: false, reason: 'abandoned: true 只在放弃收尾的那一次与 closed_at 一起写（closed_at 写门禁此刻的时间）；还没放弃就写 false。' }
  }
  if (!isAbandoning(before, after)) return { ok: true }
  if (isPlainObject(before) && after.stage !== before.stage) {
    return { ok: false, reason: `放弃收尾那一次 stage 原样带着（写入前是 ${quote(before.stage)}，这次是 ${quote(after.stage)}）：放弃不推进、不回退，只加 closed_at 与 abandoned。` }
  }
  if (isPlainObject(before) && historyLength(after) !== historyLength(before)) {
    return { ok: false, reason: `放弃收尾那一次 history 原样带着（这次从 ${historyLength(before)} 条变成了 ${historyLength(after)} 条）：只加 closed_at 与 abandoned。` }
  }
  if (!approved) {
    return {
      ok: false,
      reason:
        `放弃这一趟要用户批准：照 /agent-team:at 第 1 节「放弃这一趟」用 AskUserQuestion 单独问一道单选题，题面原样写着这一趟的 run id，标签逐字「${ABANDON_LABEL}」；` +
        '门禁记下之后（回传【放弃】）再写这一次。',
    }
  }
  return { ok: true }
}

const WHY = {
  'no-run': '这个会话认不出要放弃的是哪一趟（没有挑出来的那一趟，current-run 也读不出来）',
  unbound: '题面里没有这一趟的 run id（门禁认不出用户批的是哪一趟）',
  closed: '那一趟已经收口或放弃了',
  'other-session': '那一趟归另一个会话',
  'write-failed': '门禁写不进批准记录',
  afk: '用户离开了键盘，对话框自动提交了',
  'follow-up': '用户要先追问',
  response: '用户另写了一段话',
  notes: '用户在选项旁写了备注',
  multi: '那道题是多选',
  array: '回答是好几项',
  malformed: `标签后面夹了别的话（要逐字是「${ABANDON_LABEL}」）`,
  unmatched: '回答对不上任何一道显示过的题',
  'not-alone': '这一次问里还有别的题',
}

/** 放弃记录器的回传。why 为 null 是记下了；now 是门禁的钟（测试注入）。run id 是磁盘上的值，过 quote。 */
export function abandonNotice({ runId, why = null, now = new Date() }) {
  if (why === null) {
    return (
      `【放弃】已记下：${quote(runId)} 这一趟可以放弃收尾了。用一次 Write 写它的 state.json：closed_at 写门禁此刻的时间 ${quote(gateClock(now))}，` +
      '加 "abandoned": true，stage 与 history 原样带着（不推进、不补产物）。之后这一趟冻结，不再挡别的微调或完整的一趟。'
    )
  }
  const reason = Object.hasOwn(WHY, why) ? WHY[why] : '门禁认不出原因'
  return `【放弃】这次的回答没有记成放弃：${reason}。要放弃的话，单独再问一次这一道单选题（题面原样写上那一趟的 run id，标签逐字「${ABANDON_LABEL}」），用户选了才算。`
}
