// 子代理完成那一刻的交付物核验（M4d，docs/38，全量审查第 19 条）——纯函数部分。I/O 在 gate.mjs 的 deliverable（PostToolUse:Agent）、
// stop-gate（SubagentStop）与 completion（UserPromptSubmit）三个检查项里。
//
// 平台事实（CLI 2.1.286，docs/37 §1.2 与 m4c 调研的探针、源码）：
//   - 前台派发：PostToolUse:Agent 在子代理跑完之后才触发，tool_response.status 是 "completed"，content 是最终文本（前面可能插着
//     CLI 的注记，条数在 @internal 的 harnessNoteCount 里——不读它，逐块看）。
//   - 后台派发（默认）：PostToolUse:Agent 在子代理刚启动那一刻就跑完了，tool_response 是 { isAsync, status: "async_launched",
//     agentId, … }。完成时主会话收到一条 user 消息 <task-notification>，UserPromptSubmit 随之触发、prompt 就是那段 XML；这时 hook 的
//     additionalContext 进得了主会话的上下文。<task-id> 等于启动那一刻的 agentId，<tool-use-id> 等于那次 Agent 调用的 tool_use_id。
//   - 通知的头几行由 CLI 按固定顺序拼（task-id、tool-use-id、task-type、output-file、status、summary，有值才写）；summary 与 <result>
//     经 CLI 转义（& < >），模型写的文字拼不出一个真标签。同一个 task-id 可能通知不止一次（被续上、或者带着还在跑的后台子任务停下）；
//     进程重启之后的「孤儿汇总」一条通知里可能有好几个 <task-id>、没有 tool-use-id 与 <result>。
//
// 门禁专属文件 runs/<id>/dispatches.jsonl（control-files.mjs 的 GATE_FILES）：门禁自己追加，任何人的 Edit/Write 都拒。两种行：
//   - { kind: "dispatch", at, agent_id, tool_use_id, role, stage, caller, mode }：H5a 在团队角色的每一次派发返回时记（mode 是
//     "background"（启动那一刻）或 "foreground"（跑完那一刻））。stage 是那一刻的 state.stage——完成时按派它时的那一段核，不按完成时的。
//   - { kind: "block", at, agent_id, role, stage }：H5b 每拦一回记一行。完成时产物没交、又没冒泡、而这一行在：门禁拦过它，平台的续跑
//     上限到了、静默放行了它。
// 只追加、一行一次写入（O_APPEND，几百字节）：并发的几个门禁进程各写各的整行，不读后判，不用锁。读的一方跳过解析不出的行。
import { BUBBLE_MARK, bubbleReason } from './deliverable.mjs'
import { isPlainObject } from './stages.mjs'
import { quote } from './trusted.mjs'
import { CAP_FACT } from './retry-budget.mjs'

export const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const TOOL_USE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const OPEN = '<task-notification>'
const CLOSE = '</task-notification>'
const HEADER_RE = /^<(task-id|tool-use-id|task-type|output-file|status|summary)>(.*)<\/(task-id|tool-use-id|task-type|output-file|status|summary)>$/

/** tool_response 说的是哪一刻：启动（后台派发）、跑完（前台派发）、认不出（旧版 CLI、别的形状——照旧口径说）。 */
export function dispatchPhase(toolResponse) {
  if (!isPlainObject(toolResponse)) return 'unknown'
  if (toolResponse.status === 'async_launched') return 'launched'
  if (toolResponse.status === 'completed') return 'completed'
  return 'unknown'
}

/** 前台派发返回时 tool_response.content 里的文字块（注记与回报都在里面，逐块看）。 */
export function reportTexts(toolResponse) {
  if (!isPlainObject(toolResponse)) return []
  const c = toolResponse.content
  if (typeof c === 'string') return [c]
  if (!Array.isArray(c)) return []
  return c.filter((b) => isPlainObject(b) && b.type === 'text' && typeof b.text === 'string').map((b) => b.text)
}

/** 几段文字里第一段以冒泡标记开头的那一段的理由（标记之后、第一行剩下的话）；都不是返回 null。 */
export function bubbleOf(texts) {
  for (const t of Array.isArray(texts) ? texts : []) {
    const reason = bubbleReason(t)
    if (reason !== null) return reason
  }
  return null
}

/** CLI 对 summary 与 <result> 做的转义倒回来（& 最后换，免得把 &amp;lt; 换成 <）。 */
export function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * UserPromptSubmit 的 prompt 里的完成通知。只认行首的 <task-notification>（夹在一句话里的不是通知），头几行按 CLI 的固定格式逐行认，
 * 认到第一行不是头字段就停。返回 [{ taskIds, toolUseId, status, result }]，result 是反转义之后的 <result>（没有就是 null）。
 * 一个 prompt 里几段通知、一段里几个 task-id 都认。认不出 task-id 的（例如分离的工具调用，只有 tool-use-id）不返回。
 */
export function parseNotifications(prompt) {
  if (typeof prompt !== 'string' || !prompt.includes(OPEN)) return []
  const out = []
  let from = 0
  for (;;) {
    const i = prompt.indexOf(OPEN, from)
    if (i < 0) break
    if (i > 0 && prompt[i - 1] !== '\n') {
      from = i + OPEN.length
      continue
    }
    const j = prompt.indexOf(`\n${CLOSE}`, i)
    if (j < 0) break
    from = j + CLOSE.length + 1
    const block = prompt.slice(i + OPEN.length, j).replace(/\r/g, '')
    const lines = block.split('\n')
    const taskIds = []
    let toolUseId = null
    let status = null
    for (const line of lines.slice(1)) {
      const m = HEADER_RE.exec(line)
      if (!m || m[1] !== m[3]) break
      if (m[1] === 'task-id' && AGENT_ID_RE.test(m[2])) taskIds.push(m[2])
      if (m[1] === 'tool-use-id' && TOOL_USE_ID_RE.test(m[2])) toolUseId = m[2]
      if (m[1] === 'status') status = m[2]
    }
    if (!taskIds.length) continue
    const r = /<result>([\s\S]*?)<\/result>/.exec(block)
    out.push({ taskIds, toolUseId, status, result: r ? unescapeXml(r[1]) : null })
  }
  return out
}

export function dispatchLine({ at, agentId, toolUseId, role, stage, caller, callerId, mode }) {
  return JSON.stringify({ kind: 'dispatch', at, agent_id: agentId, tool_use_id: toolUseId ?? null, role, stage, caller, caller_id: callerId ?? null, mode })
}

export function blockLine({ at, agentId, role, stage }) {
  return JSON.stringify({ kind: 'block', at, agent_id: agentId, role, stage })
}

/**
 * dispatches.jsonl 的原文 → { dispatches: [行，按原顺序], blocks: Map(agent_id → 拦过几回) }。解析不出、形状不对的行跳过——这个文件
 * Edit/Write 写不进，Bash 写得进；角色名与段名照样不可信，用的一方再拿花名册与阶段链核（gate.mjs）。
 */
export function readDispatchLog(text) {
  const dispatches = []
  const blocks = new Map()
  if (typeof text !== 'string') return { dispatches, blocks }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let v
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (!isPlainObject(v) || typeof v.agent_id !== 'string' || !AGENT_ID_RE.test(v.agent_id)) continue
    if (typeof v.role !== 'string' || typeof v.stage !== 'string') continue
    if (v.kind === 'dispatch') dispatches.push(v)
    else if (v.kind === 'block') blocks.set(v.agent_id, (blocks.get(v.agent_id) ?? 0) + 1)
  }
  return { dispatches, blocks }
}

/** 这条通知对应的那次派发：agent_id 相同，通知带了 tool-use-id 时还要相同；同一个 agent_id 记过几次取最后一次。 */
export function dispatchOf(log, taskId, toolUseId) {
  const hits = log.dispatches.filter(
    (d) => d.agent_id === taskId && (toolUseId === null || d.tool_use_id === null || d.tool_use_id === toolUseId),
  )
  return hits.length ? hits[hits.length - 1] : null
}

const STATUS_PHRASE = { failed: '派发失败了', killed: '被停下了', stopped: '被停下了' }

/** 完成通知的 status 不是 completed 时怎么说它。已知的几种给固定说法，别的加引号（它来自通知原文）。 */
export function statusPhrase(status) {
  if (typeof status === 'string' && Object.hasOwn(STATUS_PHRASE, status)) return STATUS_PHRASE[status]
  return `结束状态是 ${quote(status)}`
}

/**
 * 产物没交时「为什么、接下来怎么办」那一段。why：
 *   - { kind: 'bubble', reason }：它冒泡了（回报第一行是标记）；
 *   - { kind: 'cap', blocks }：门禁拦过它、它没交也没冒泡——平台静默放行；
 *   - { kind: 'unblocked' }：它停下时门禁没拦它；
 *   - { kind: 'status', status }：通知说它没有正常结束。
 * redispatch：收件人照做时「再派一次」怎么说（PM 派得到它，还是要经派它的那一层）。
 */
export function explainMissing(why, { recipientIsPm, redispatch }) {
  const relay = recipientIsPm ? '' : '你定不了的，把这一条原样冒泡给派你的人，让它带到 PM。'
  if (why.kind === 'bubble') {
    return (
      `门禁认「${BUBBLE_MARK}」这一行、放它停下，产物照旧算没交。读它回报里写的缺什么、要谁定：` +
      (recipientIsPm
        ? '属于 /agent-team:at 第 4 节那几类的照第 4 节问用户；其余你来定——同一段里重派（不计返工），或者照第 3 节「回退」记回退。'
        : `定得了的你定（同一段里${redispatch}）；定不了的把这一条连同它的理由原样冒泡给派你的人。`)
    )
  }
  if (why.kind === 'cap') {
    return (
      `门禁拦过它（${why.blocks} 回），它没交、也没冒泡（回报第一行不是「${BUBBLE_MARK}…」）——是${CAP_FACT}。` +
      `先读它的回报弄清它卡在哪，照原样${redispatch}多半还会卡在同一处。${relay}`
    )
  }
  if (why.kind === 'status') {
    return `它没有正常结束（${statusPhrase(why.status)}）。要它交，就${redispatch}。${relay}`
  }
  // 只说「记录里没有」：H5b 拦了而派发记录没写成（写不进只留痕）时，「门禁没拦它」就是错话。
  return (
    '门禁这边没有拦过它的记录：它停下那一刻门禁可能没核（读不出运行状态；或者那时 state.stage 已经不是这一段，它不在那一段的名单上），' +
    `也可能它交了之后产物又被删掉或改空了。去 run 目录核实，没落盘的就${redispatch}。${relay}`
  )
}

/**
 * S5 这类段的协调者返回、而这一段还没齐时（审查第 19 条修法 3）：门禁记着它在这一段派出去的执行角色，各自的产物现在在不在。
 * 只说事实与接下来会发生什么，不下「缺」的断语——后台派发的执行角色可能还在跑。rows: [{ role, mode, items: [{ name, state }] }]，
 * state 是 ok、missing、blank、stale。rows 为空返回 null（门禁没记着它派过谁：照旧不说）。
 */
export function coordinatorProgress({ role, stageId, rows, recipientIsPm }) {
  if (!Array.isArray(rows) || !rows.length) return null
  const STATE = { ok: '在磁盘上', missing: '还没有', blank: '是空文件', stale: '还是上一轮的' }
  const lines = []
  for (const row of rows) {
    const facts = row.items.map((it) => `${it.name} ${STATE[it.state] ?? '读不出来'}`).join('，')
    const short = row.items.some((it) => it.state !== 'ok')
    const tail = !short
      ? ''
      : row.mode === 'background'
        ? '——后台派发的，还在跑的话缺是正常的：它完成时，完成通知到 PM 那里，门禁会单独核它'
        : '——它已经返回（前台派发），这一份就是没交：读架构师的回报看它为什么没交'
    lines.push(`  - ${row.role}（${row.mode === 'background' ? '后台派发' : '前台派发'}）：${facts}${tail}`)
  }
  return (
    `交付物核验（${stageId} 进度）：刚返回的 ${role} 是 ${stageId} 的协调者，这一段没有它自己的产物；门禁记着它这一趟在 ${stageId} 派出去的：\n` +
    `${lines.join('\n')}\n` +
    '不在上面的执行角色是它没派过的（或者门禁没记下）。' +
    (recipientIsPm
      ? `名单上的都交了，照 /agent-team:at 第 3 节核实（实现记录的「被写路径隔离拒绝」一节要读）再推进；这一条不是在催你推进，也不是在报缺。`
      : '这一条你不用处理：PM 会在执行角色各自完成时收到核验。')
  )
}
