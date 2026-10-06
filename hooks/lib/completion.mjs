// 子代理完成那一刻的交付物核验（M4d，docs/38，全量审查第 19 条）——纯函数部分。I/O 在 gate.mjs 的 deliverable（PostToolUse:Agent）、
// stop-gate（SubagentStop）与 completion（UserPromptSubmit）三个检查项里。
//
// 平台事实（CLI 2.1.286，docs/38 §1.3）：
//   - 前台派发：PostToolUse:Agent 在子代理跑完之后才触发，tool_response.status 是 "completed"，content 是最终文本（前面可能插着
//     CLI 的注记，条数在 @internal 的 harnessNoteCount 里——不读它，逐块看）。
//   - 后台派发（默认；交互模式下是唯一的一种）：PostToolUse:Agent 在子代理刚启动那一刻就跑完了，tool_response 是
//     { isAsync, status: "async_launched", agentId, … }。完成时主会话收到一条 user 消息 <task-notification>，UserPromptSubmit 随之触发、
//     prompt 就是那段 XML；这时 hook 的 additionalContext 进得了主会话的上下文。<task-id> 等于启动那一刻的 agentId；<tool-use-id> 第一条
//     通知里等于那次 Agent 调用的 tool_use_id，同一个 task-id 之后的通知里会换掉或没有。
//   - 通知的头几行由 CLI 按固定顺序拼（task-id、tool-use-id、task-type、output-file、status、summary，有值才写）；summary 与 <result>
//     经 CLI 转义（& < >），模型写的文字拼不出一个真标签。回报里有指令形状的字样时，CLI 在 <result> 最前面插一段 [harness: …]。
//     同一个 task-id 可能通知不止一次（被续上、或者带着还在跑的后台子任务停下）；进程重启之后的「孤儿汇总」一条通知里可能有好几个
//     <task-id>、没有 tool-use-id 与 <result>。
//   - 嵌套派发的通知路由按模式分：-p 下协调者还在跑，孙代理的通知送给协调者、不触发任何 hook；交互模式下协调者停车、被孙代理的通知
//     唤醒。所以协调者返回时，它派出去的人的完成通知不一定会到 PM 那里——进度那一段不许诺「之后门禁会单独核它」。
//
// 门禁专属文件 runs/<id>/dispatches.jsonl（control-files.mjs 的 GATE_FILES）：门禁自己追加，任何人的 Edit/Write 都拒。两种行：
//   - { kind: "dispatch", at, agent_id, tool_use_id, role, stage, caller, caller_id, mode }：H5a 在团队角色的每一次派发返回时记（mode 是
//     "background"（启动那一刻）或 "foreground"（跑完那一刻））。stage 是那一刻的 state.stage——完成时按派它时的那一段核，不按完成时的。
//   - { kind: "stop", at, agent_id, role, stage, outcome }：H5b 每一回停下记一行，outcome 是 pass（放它停下）、bubble（认冒泡、放它停下）、
//     block（拦）。复核（docs/38 §3）：原型只记拦截，「拦过一回」就被当成「平台静默放行」——可冒泡之前必然先被拦一回；进度也分不出
//     「还在跑」与「已经停了」。现在成因按这个子代理最后一回停下的结果判。
// 只追加、一行一次写入（O_APPEND，几百字节）：并发的几个门禁进程各写各的整行，不读后判，不用锁。读的一方跳过解析不出的行。
import { BUBBLE_MARK, bubbleReason } from './deliverable.mjs'
import { isPlainObject } from './stages.mjs'
import { quote } from './trusted.mjs'
import { CAP_FACT } from './retry-budget.mjs'

export const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const TOOL_USE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const OPEN = '<task-notification>'
const CLOSE = '</task-notification>'
// 头字段：一行一个 <标签>值</标签>。认得的几个（task-id、tool-use-id、status）取值，别的跳过——平台以后在 status 之前加一个字段，不能让
// status 跟着丢（复核）。<result> 是正文、不是头字段：认到它、或者认到第一行不是这种形状的，就停。
const HEADER_RE = /^<([a-z][a-z-]*)>(.*)<\/([a-z][a-z-]*)>$/
const OUTCOMES = new Set(['pass', 'bubble', 'block'])

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

/**
 * CLI 插在回报最前面的注记（一条或几条 [harness: …]）剥掉，冒泡标记在它们后面（复核：后台派发的 <result> 是一整串，原型只看第一行，
 * 带注记的冒泡被说成「也没冒泡、平台续跑上限到了」）。一条注记从以「[harness:」开头的那一行起，到以「]」结尾的那一行止；找不到结尾
 * 就到第一个空行为止。只剥开头的，夹在正文里的不动。
 */
export function stripHarnessNotes(text) {
  if (typeof text !== 'string') return text
  const lines = text.split('\n')
  let i = 0
  for (;;) {
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length || !lines[i].trimStart().startsWith('[harness:')) break
    let j = i
    while (j < lines.length && !lines[j].trimEnd().endsWith(']') && lines[j].trim() !== '') j++
    i = j + 1
  }
  return lines.slice(i).join('\n')
}

/** 几段文字里第一段（剥掉开头的 CLI 注记之后）以冒泡标记开头的那一段的理由（标记之后、第一行剩下的话）；都不是返回 null。 */
export function bubbleOf(texts) {
  for (const t of Array.isArray(texts) ? texts : []) {
    const reason = bubbleReason(stripHarnessNotes(t))
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
 * UserPromptSubmit 的 prompt 里的完成通知。只认行首的 <task-notification>（夹在一句话里的不是通知），头几行逐行认，认到 <result> 或者
 * 第一行不是头字段就停。返回 [{ taskIds, toolUseId, status, result }]，result 是反转义之后的 <result>（没有就是 null）。
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
    const body = prompt.slice(i + OPEN.length, j).replace(/\r/g, '')
    const lines = body.split('\n')
    const taskIds = []
    let toolUseId = null
    let status = null
    for (const line of lines.slice(1)) {
      const m = HEADER_RE.exec(line)
      if (!m || m[1] !== m[3] || m[1] === 'result') break
      if (m[1] === 'task-id' && AGENT_ID_RE.test(m[2])) taskIds.push(m[2])
      if (m[1] === 'tool-use-id' && TOOL_USE_ID_RE.test(m[2])) toolUseId = m[2]
      if (m[1] === 'status') status = m[2]
    }
    if (!taskIds.length) continue
    const r = /<result>([\s\S]*?)<\/result>/.exec(body)
    out.push({ taskIds, toolUseId, status, result: r ? unescapeXml(r[1]) : null })
  }
  return out
}

export function dispatchLine({ at, agentId, toolUseId, role, stage, caller, callerId, mode }) {
  return JSON.stringify({ kind: 'dispatch', at, agent_id: agentId, tool_use_id: toolUseId ?? null, role, stage, caller, caller_id: callerId ?? null, mode })
}

/** H5b 一回停下的结果：pass（放它停下）、bubble（认冒泡、放它停下）、block（拦）。 */
export function stopLine({ at, agentId, role, stage, outcome }) {
  return JSON.stringify({ kind: 'stop', at, agent_id: agentId, role, stage, outcome })
}

/**
 * dispatches.jsonl 的原文 → { dispatches: [派发行，按原顺序], stops: Map(agent_id → [结果，按原顺序]), blocks: Map(agent_id → 拦过几回) }。
 * 解析不出、形状不对的行跳过——这个文件 Edit/Write 写不进，Bash 写得进；角色名与段名照样不可信，用的一方再拿花名册与阶段链核（gate.mjs）。
 */
export function readDispatchLog(text) {
  const dispatches = []
  const stops = new Map()
  const blocks = new Map()
  if (typeof text !== 'string') return { dispatches, stops, blocks }
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
    else if (v.kind === 'stop' && OUTCOMES.has(v.outcome)) {
      if (!stops.has(v.agent_id)) stops.set(v.agent_id, [])
      stops.get(v.agent_id).push(v.outcome)
      if (v.outcome === 'block') blocks.set(v.agent_id, (blocks.get(v.agent_id) ?? 0) + 1)
    }
  }
  return { dispatches, stops, blocks }
}

/** 这个子代理最后一回停下的结果（pass、bubble、block）；门禁没见它停下过返回 null。 */
export function lastStop(log, agentId) {
  const s = log?.stops?.get(agentId)
  return Array.isArray(s) && s.length ? s[s.length - 1] : null
}

/** 派发记录里，每一段派出去过的角色：{ 段: [角色] }。推进与收口判「这一段叫过谁」时并上它（advance.mjs 的 calledIn）。 */
export function dispatchedByStage(log) {
  const out = {}
  for (const d of Array.isArray(log?.dispatches) ? log.dispatches : []) {
    if (!Object.hasOwn(out, d.stage)) out[d.stage] = []
    if (!out[d.stage].includes(d.role)) out[d.stage].push(d.role)
  }
  return out
}

/**
 * 这条通知对应的那次派发：按 agent_id 认（它本身唯一）。同一个 agent_id 记过几次时，挑 tool_use_id 与通知相同的那一条，挑不出就取最后
 * 一条——复核：原型要求 tool-use-id 也相同，被续上之后再通知（tool-use-id 换了）就不出声了。
 */
export function dispatchOf(log, taskId, toolUseId) {
  const hits = log.dispatches.filter((d) => d.agent_id === taskId)
  if (!hits.length) return null
  const same = toolUseId === null ? [] : hits.filter((d) => d.tool_use_id === toolUseId)
  return (same.length ? same : hits)[(same.length ? same : hits).length - 1]
}

const STATUS_PHRASE = { failed: '派发失败了', killed: '被停下了', stopped: '被停下了' }

/** 完成通知的 status 不是 completed 时怎么说它。已知的几种给固定说法，别的加引号（它来自通知原文）。 */
export function statusPhrase(status) {
  if (typeof status === 'string' && Object.hasOwn(STATUS_PHRASE, status)) return STATUS_PHRASE[status]
  return `结束状态是 ${quote(status)}`
}

/**
 * 没交齐的成因，依次：通知说它没正常结束（status）；它最后一回停下是冒泡、或者回报（剥掉 CLI 注记之后）第一行是冒泡标记（bubble）；
 * 它最后一回停下门禁拦了它、它却结束了（cap）；它最后一回停下门禁放行了（pass：那一刻它不在那一段的名单上——PM 推进或回退了；或者
 * 那时交了、之后又没了）；门禁没见它停下过（nostop）。
 */
export function missingCause({ status = null, last = null, bubble = null, blocks = 0 }) {
  if (status !== null && status !== 'completed') return { kind: 'status', status }
  if (last === 'bubble' || bubble !== null) return { kind: 'bubble', reason: bubble }
  if (last === 'block') return { kind: 'cap', blocks }
  if (last === 'pass') return { kind: 'pass' }
  return { kind: 'nostop' }
}

/**
 * 产物没交时「为什么、接下来怎么办」那一段（成因见 missingCause）。redispatch：收件人照做时「再派一次」怎么说（PM 派得到它，还是要经
 * 派它的那一层）。trimHint：这几份能靠 trimmed 免掉时（advance.mjs 的 mayWaive）给出的写法，不能免就是空串。
 */
export function explainMissing(why, { recipientIsPm, redispatch, trimHint = '' }) {
  const relay = recipientIsPm ? '' : '你定不了的，把这一条原样冒泡给派你的人，让它带到 PM。'
  const trim = recipientIsPm && trimHint ? trimHint : ''
  if (why.kind === 'bubble') {
    return (
      `门禁认「${BUBBLE_MARK}」这一行、放它停下，产物照旧算没交。读它回报里写的缺什么、要谁定：` +
      (recipientIsPm
        ? `属于 /agent-team:at 第 4 节那几类的照第 4 节问用户；其余你来定——同一段里${redispatch}（不计返工），或者照第 3 节「回退」记回退。${trim}`
        : `定得了的你定（同一段里${redispatch}）；定不了的、为红线里的敏感操作冒泡的，把这一条连同它的理由原样冒泡给派你的人。`)
    )
  }
  if (why.kind === 'cap') {
    return (
      `门禁最后一回拦了它（一共拦过 ${why.blocks} 回），它却结束了、没交，回报第一行也不是「${BUBBLE_MARK}…」——多半是${CAP_FACT}。` +
      `先读它的回报弄清它卡在哪，照原样${redispatch}多半还会卡在同一处。${trim}${relay}`
    )
  }
  if (why.kind === 'status') {
    return `它没有正常结束（${statusPhrase(why.status)}）。要它交，就${redispatch}。${trim}${relay}`
  }
  if (why.kind === 'pass') {
    return (
      '它最后一回停下时门禁放行了：那一刻它不在那一段的名单上（PM 推进或回退了），或者那时交了、之后产物又被删掉或改空了。' +
      `去 run 目录核实，没落盘的就${redispatch}。${trim}${relay}`
    )
  }
  // 只说「记录里没有」：派发记录没写成（写不进只留痕）时，「门禁没核它」就是错话。
  return (
    '门禁这边没有它停下的记录：它停下那一刻门禁可能没核（读不出运行状态），也可能记录没写成。' +
    `去 run 目录核实，没落盘的就${redispatch}。${trim}${relay}`
  )
}

const STOP_TAIL = {
  bubble: '它停下时冒泡了：读协调者的回报，它缺什么、要谁定写在那里',
  block: '门禁最后一回拦了它，它却结束了（多半是平台的续跑上限到了）',
  pass: '它停下时门禁放行了（那一刻它不在这一段的名单上，或者那时交了、之后又没了）',
}

/**
 * S5 这类段的协调者返回时（审查第 19 条修法 3）：门禁记着它这一次运行在这一段派出去的执行角色，各自的产物现在怎样、门禁见没见它停下。
 * rows: [{ role, mode, stop, items: [{ name, state }] }]——state 是 ok、missing、blank、stale；stop 是那个执行角色最后一回停下的结果
 * （lastStop），没见它停下是 null。rows 为空返回 null（门禁没记着它派过谁：照旧不说）。
 * 复核（docs/38 §3）：不许诺「它完成时，完成通知到 PM 那里，门禁会单独核它」——交互模式下、-p 下协调者还在跑时，那条通知都不到 PM；
 * 收尾那一句按各行的状态说，不再无条件说「名单上的都交了」。
 */
// M4h（docs/43，审查第 14 条）：selfDone——协调者自己也是这一段的产者、它那几份交了（S2 的 at-product）；impl——这一段是执行段（产物是实现记录）。
export function coordinatorProgress({ role, stageId, rows, recipientIsPm, selfDone = false, impl = true }) {
  if (!Array.isArray(rows) || !rows.length) return null
  const STATE = { ok: '在磁盘上', missing: '还没有', blank: '是空文件', stale: '还是上一轮的' }
  const lines = []
  let running = false
  let stoppedShort = false
  for (const row of rows) {
    const facts = row.items.map((it) => `${it.name} ${STATE[it.state] ?? '读不出来'}`).join('，')
    const short = row.items.some((it) => it.state !== 'ok')
    let tail = ''
    if (!short && row.stop === 'bubble') {
      // M4d 实测：产物在，它停下时却冒泡了——那一份可能只写了它卡在哪（M5 的前端），也可能交齐了、只是借标记转述别人的问题
      // （M5b 的后端）。门禁不读内容，不下结论，叫 PM 读。
      stoppedShort = true
      tail = '——但它停下时冒泡了：那一份可能只写了它卡在哪，读它（或协调者的回报）再定'
    } else if (short) {
      if (row.stop && Object.hasOwn(STOP_TAIL, row.stop)) {
        stoppedShort = true
        tail = `——${STOP_TAIL[row.stop]}`
      } else if (row.mode === 'background') {
        running = true
        tail = '——门禁还没见它停下：可能还在跑'
      } else {
        stoppedShort = true
        tail = '——它已经返回（前台派发），门禁却没有它停下的记录：去 run 目录核实'
      }
    }
    lines.push(`  - ${row.role}（${row.mode === 'background' ? '后台派发' : '前台派发'}）：${facts}${tail}`)
  }
  let close
  if (!recipientIsPm) {
    close = '这一条你不用处理：交没交，PM 推进出这一段时门禁会核。'
  } else if (!running && !stoppedShort) {
    close = `名单上的都交了：照 /agent-team:at 第 3 节核实${impl ? '（实现记录的「被写路径隔离拒绝」一节要读）' : ''}再推进。`
  } else {
    close =
      (running ? '还在跑的，等它停下再核——它的完成通知不一定到你这里（交互模式下送回派它的协调者）；' : '') +
      (stoppedShort ? '停下了却没交齐、或者交了却冒泡的，照 /agent-team:at 第 3 节「核实」定：同一段里经协调者重派、照第 4 节问用户，或者推进那一次照出路写 trimmed；' : '') +
      '推进出这一段时门禁会核每一份。这一条不是在催你推进。'
  }
  return (
    `交付物核验（${stageId} 进度）：刚返回的 ${role} 是 ${stageId} 的协调者，${selfDone ? '它自己的那几份交了' : '这一段没有它自己的产物'}；门禁记着它这一次在 ${stageId} 派出去的：\n` +
    `${lines.join('\n')}\n` +
    `不在上面的${impl ? '执行角色' : '产者'}是它这一次没派过的（或者门禁没记下）。` +
    close
  )
}
