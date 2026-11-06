// 一趟只归一个会话。纯函数，I/O 由 gate.mjs 注入。
//
// 每一趟 run 记下归哪个会话（runs/<id>/owner.json，门禁专属）：建它的那个会话是主人（账本在建 run 的那一次写，via: 'create'），用户在别的
// 会话里经规范标签明确接手之后改归那个会话（批准记录器写，via: 'takeover'）。主线程（项目经理、不带 agent_type 的主会话；不带 agent_id）
// 对一趟有归属、没收口、主人不是自己的 run——写它的文件、另建一趟、把 current-run 从它切走或指到它、以它的名义派人——门禁拒；子代理照旧
// 按派发记录认回派它的那一趟，不归这里管。没有归属记录的 run（升级之前建的、用 Bash 建的、hook 输入里没有会话 id 时建的）一切照旧。
//
// 命令展开那一刻（/agent-team:at、at-resume、at-status），门禁用 sessionNotice 告诉项目经理这一趟归另一个会话，正文照它问用户：是不是要补充
// 给那一趟、要不要在这个会话接手。标签是这里的单一真源，正文与判据都从这里取。
import { isPlainObject } from './stages.mjs'
import { normalizeText } from './text-norm.mjs'
import { normalizeLabel } from './budget.mjs'
import { quote } from './trusted.mjs'

export { OWNER_FILE } from './control-files.mjs'

// 规范标签。前两个是「别的会话里起 /agent-team:at、那一趟还在跑」时的两个选项；后两个是接手（门禁只记这两个）；最后一个是「回那个会话」。
export const SUPPLEMENT_LABEL = '是，回那个会话补充'
export const END_LABEL = '不是，结束这次'
export const TAKEOVER_LABEL = '在这个会话接手'
export const TAKEOVER_CLOSE_LABEL = '接手并收口，再开始这次'
export const BACK_LABEL = '回那个会话'

const VIAS = new Set(['create', 'takeover'])
const isSid = (v) => typeof v === 'string' && v !== ''

/** 归属记录的样子。previous：接手之前的主人（建的那一次为 null）。 */
export function ownerRecord({ sessionId, at, via, previous = null }) {
  return { session_id: sessionId, at, via, previous: isSid(previous) ? previous : null }
}

/** owner.json 的原文 → 记录；读不出、不是对象、session_id 不是非空字符串、via 认不得：null（当没有归属）。 */
export function readOwner(bytes) {
  if (bytes === null || bytes === undefined) return null
  let v
  try {
    v = JSON.parse(normalizeText(bytes))
  } catch {
    return null
  }
  if (!isPlainObject(v) || !isSid(v.session_id) || !VIAS.has(v.via)) return null
  return { session_id: v.session_id, at: typeof v.at === 'string' ? v.at : null, via: v.via, previous: isSid(v.previous) ? v.previous : null }
}

/** 这一趟挡不挡这个会话：有主人、没收口、主人不是这个会话。会话 id 不是非空字符串时判不出来，不挡。 */
export function blocksMe(info, sessionId) {
  if (!isSid(sessionId) || !isPlainObject(info) || info.closed === true) return false
  return isPlainObject(info.owner) && isSid(info.owner.session_id) && info.owner.session_id !== sessionId
}

const blockOf = (runId, info, kind) => ({ runId, kind, via: info.owner.via === 'takeover' ? 'takeover' : 'create' })

/**
 * 主线程这一次写入碰不碰别的会话的一趟。
 * target：{ kind: 'run-file', runId, creatingState }（写 runs/<id>/ 下的文件；creatingState：写的是那一趟的 state.json、写之前它不在）、
 * { kind: 'pointer' }（写 current-run）或 null（不归这一道管）。infoOf(id) → { closed, owner } | null；same(a, b) 判两个 run id 是不是同一个目录。
 * 写 current-run 只看它现在指着的那一趟挡不挡这个会话（切走）；改成指向哪一趟不看：指针空着（丢了、指着已收口或自己的一趟）时指到别的会话的一趟放行——
 * 单是指过去什么都拿不到（写与派照旧被拒），而丢了指针、放弃了的那一趟要在别的会话里接回，正得先把指针指过去，接手才认得到它。
 * @returns {null | { runId: string, kind: 'run'|'create'|'pointer', via: 'create'|'takeover' }}
 */
export function ownerWriteBlock({ sessionId, target, pointerId, infoOf, same }) {
  if (!isSid(sessionId) || !isPlainObject(target)) return null
  const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && same(a, b)
  const check = (id, kind) => {
    if (typeof id !== 'string' || id === '') return null
    const info = infoOf(id)
    return blocksMe(info, sessionId) ? blockOf(id, info, kind) : null
  }
  if (target.kind === 'run-file') {
    const own = check(target.runId, 'run')
    if (own) return own
    if (target.creatingState === true && typeof pointerId === 'string' && !eq(pointerId, target.runId)) return check(pointerId, 'create')
    return null
  }
  if (target.kind === 'pointer') return check(pointerId, 'pointer')
  return null
}

/** 主线程这一次派发碰不碰别的会话的一趟（current-run 指着的那一趟）。 */
export function ownerDispatchBlock({ sessionId, pointerId, infoOf }) {
  if (!isSid(sessionId) || typeof pointerId !== 'string' || pointerId === '') return null
  const info = infoOf(pointerId)
  return blocksMe(info, sessionId) ? blockOf(pointerId, info, 'dispatch') : null
}

// 同一个窗口里用过 /clear 的，会话 id 已经换了一个：那也算原来那个会话关了。
const OUT_WAY =
  '照 /agent-team:at 第 1 节「别的会话的一趟」办：问用户这次是不是要补充给那一趟；原来那个会话已经关了的（同一个窗口里用过 /clear 也算），' +
  '用 /agent-team:at-resume 在这个会话接手。'

/** H3、H2 的拒绝理由。run id 是磁盘上的值，过 quote。 */
export function ownerDenyReason(block) {
  const R = quote(block.runId)
  const whose =
    block.via === 'takeover' ? `${R} 这一趟已经被另一个会话接手、还没收口` : `${R} 这一趟归另一个会话（建它的那个会话）、还没收口`
  let what
  if (block.kind === 'create') what = `current-run 指着的 ${whose}，这个会话不能另建一趟。`
  else if (block.kind === 'pointer') what = `${whose}，这个会话不能把 current-run 从它切走。`
  else if (block.kind === 'dispatch') what = `current-run 指着的 ${whose}，这个会话不能以它的名义派人。`
  else what = `${whose}，这个会话不能写它。`
  return `agent-team 会话归属：${what}${OUT_WAY}`
}

const RUN_ID_CHAR = /[A-Za-z0-9._-]/

/**
 * 题面里有没有原样写着这一趟的 run id（前后不能紧挨着 run id 里能出现的字符：r1 不算写了 r10）。接手要绑在用户看到的那一趟上——问和答之间指针
 * 换了、问的是别的一趟，都不能落到 current-run 现在指着的这一趟。
 */
export function mentionsRunId(text, runId) {
  if (typeof text !== 'string' || typeof runId !== 'string' || runId === '') return false
  for (let i = text.indexOf(runId); i >= 0; i = text.indexOf(runId, i + 1)) {
    const before = i > 0 ? text[i - 1] : ''
    const after = text[i + runId.length] ?? ''
    if (!RUN_ID_CHAR.test(before) && !RUN_ID_CHAR.test(after)) return true
  }
  return false
}

/**
 * PostToolUse:AskUserQuestion 的 tool_response 里有没有选接手：一个像样的都没有回 null；认上了回 { label, question }（两个接手标签之一、那道题的题面）；像是接手、却不记
 * 回 { why }。不记的形状与需求稿批准同一套：离开键盘自动提交、要追问、另写了一段话、带备注、多选、答案是数组、标签后面夹了别的话、对不上显示过的题、
 * 这一次问里还有别的题。
 */
export function takeoverAnswer(toolResponse) {
  if (!isPlainObject(toolResponse) || !isPlainObject(toolResponse.answers)) return null
  const tr = toolResponse
  const questions = Array.isArray(tr.questions) ? tr.questions : []
  // 用到时才归一化：加载这个模块时不调任何会被注入异常的内建。
  const keys = [TAKEOVER_LABEL, TAKEOVER_CLOSE_LABEL].map((l) => [l, normalizeLabel(l)])
  const labelOf = (a) => (typeof a === 'string' ? keys.find(([, k]) => normalizeLabel(a).startsWith(k)) : undefined)
  const hits = []
  for (const [text, answer] of Object.entries(tr.answers)) {
    if (Array.isArray(answer)) {
      if (answer.some((a) => labelOf(a))) hits.push({ why: 'array' })
      continue
    }
    const hit = labelOf(answer)
    if (!hit) continue
    const q = questions.find((x) => isPlainObject(x) && x.question === text)
    if (!q) hits.push({ why: 'unmatched' })
    else if (normalizeLabel(answer) !== hit[1]) hits.push({ why: 'malformed' })
    else if (q.multiSelect === true) hits.push({ why: 'multi' })
    else if (isPlainObject(tr.annotations) && isPlainObject(tr.annotations[text]) && typeof tr.annotations[text].notes === 'string' && tr.annotations[text].notes.trim() !== '')
      hits.push({ why: 'notes' })
    else hits.push({ label: hit[0], question: text })
  }
  if (!hits.length) return null
  if (tr.afkTimeoutMs !== undefined) return { why: 'afk' }
  if (tr.followUp === true) return { why: 'follow-up' }
  if (typeof tr.response === 'string' && tr.response.trim() !== '') return { why: 'response' }
  if (Math.max(questions.length, Object.keys(tr.answers).length) > 1) return { why: 'not-alone' }
  return hits[0]
}

/**
 * 命令展开那一刻给项目经理的【会话】一段：current-run 指着的那一趟归另一个会话。command：'at' | 'at-resume' | 'at-status'。
 * startedAt（那一趟 history 第一条的时间）、wordsHead（原话开头）都是磁盘上的值，过 quote；读不出来为 null，不说那一样。
 */
export function sessionNotice({ command, runId, startedAt = null, wordsHead = null, delivered = false, via = 'create' }) {
  const who = via === 'takeover' ? '归另一个会话（是那个会话接手过去的）' : '归另一个会话'
  const facts = [
    typeof startedAt === 'string' && startedAt !== '' ? `${quote(startedAt)} 起` : null,
    typeof wordsHead === 'string' && wordsHead !== '' ? `原话开头 ${quote(wordsHead)}` : null,
  ].filter(Boolean)
  const head =
    `【会话】current-run 指着的 ${quote(runId)} 这一趟${who}${facts.length ? `（${facts.join('，')}）` : ''}，还没收口` +
    (delivered ? '——停在最后一段、交付文档已经写了，只差收口。' : '。')
  if (command === 'at-resume') return `${head}这个会话不能接着跑它：照 /agent-team:at-resume 第 1 节「别的会话的一趟」问用户。`
  if (command === 'at-status') return `${head}报进度时说明它归另一个会话；这个会话只能看，不能接着跑它。`
  return `${head}这个会话不能另起一趟，也不能写它、以它的名义派人：照 /agent-team:at 第 1 节「别的会话的一趟」问用户，不读别的、不写任何文件。`
}

const TAKEOVER_WHY = {
  'no-run': 'current-run 没有指着一趟读得出来的 run（指针不在、读不出来，或者指着的那一趟目录不在）',
  closed: '那一趟已经收口，不用接手',
  'already-mine': '那一趟本来就归这个会话',
  'no-session': '读不到这个会话的 id',
  'write-failed': '门禁写不进归属记录',
  afk: '用户离开了键盘，对话框自动提交了',
  'follow-up': '用户要先追问',
  response: '用户另写了一段话',
  notes: '用户在选项旁写了备注',
  multi: '那道题是多选',
  array: '回答是好几项',
  malformed: `标签后面夹了别的话（要逐字是「${TAKEOVER_LABEL}」或「${TAKEOVER_CLOSE_LABEL}」）`,
  unmatched: '回答对不上任何一道显示过的题',
  'not-alone': '这一次问里还有别的题',
  unbound: '题面里没有 current-run 现在指着的那一趟的 run id（门禁认不出用户批的是哪一趟：问的可能是别的一趟，或者问和答之间指针换了）',
}
const ANSWER_SIDE = new Set(['afk', 'follow-up', 'response', 'notes', 'multi', 'array', 'malformed', 'unmatched', 'not-alone'])

/** 接手记录器的回传。why 为 null 是记下了。 */
export function takeoverNotice({ runId, why = null }) {
  if (why === null) {
    return `【会话】已记下：${quote(runId)} 这一趟改归这个会话。原来那个会话再写它、以它的名义派人，门禁会拒。接着照命令正文往下做。`
  }
  const reason = Object.hasOwn(TAKEOVER_WHY, why) ? TAKEOVER_WHY[why] : '门禁认不出原因'
  let way
  if (why === 'unbound') way = '要接手的话，先重读 current-run，再单独问一次这一道单选题，题面里原样写上那一趟的 run id（标签逐字），用户选了才算。'
  else if (ANSWER_SIDE.has(why)) way = '要接手的话，单独再问一次这一道单选题（题面里原样写上那一趟的 run id，标签逐字），用户选了才算。'
  else if (why === 'no-run')
    way = '要接回的那一趟还没收口的话，先照命令正文把 current-run 指到它（指针空着、或者指着已收口或这个会话自己的一趟时门禁放行），再单独问一次（题面带它的 run id）。'
  else if (why === 'already-mine' || why === 'closed') way = '照命令正文往下做，不用接手。'
  else way = '这一趟仍归原来那个会话：告诉用户这次接手没有成，这个会话不写它、不以它的名义派人。'
  return `【会话】这次的回答没有记成接手：${reason}。${way}`
}
