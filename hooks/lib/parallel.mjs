// 并行微调：微调与完整的一趟互斥、命令展开时告诉项目经理开着哪些微调。纯函数，I/O 由 gate.mjs 注入。
//
// 互斥（H6，建 run 的那一次判）：
//   - 「完整的一趟」只认 current-run 指着的、没收口也没放弃的那一趟（不论有没有归属记录）。同一个会话里「放弃它、另起这一趟」切走指针的旧 run
//     指针不在它们身上，不算——门禁不用扫 runs/ 下所有完整的 run。
//   - 开着那样一趟完整需求时不能起微调（不论归哪个会话）：作为补充交给它，或者先放弃它。
//   - 开着微调时不能起完整的一趟：完整一趟的执行角色认领整个目录，必然撞上。
//   - 一个会话同一时刻只做一趟微调；微调和微调之间可以并行。
//   - 微调按会话认，读不到会话 id 建不了微调。
import { quote } from './trusted.mjs'
import { TWEAK_MODE } from './tweak.mjs'
import { isPlainObject } from './stages.mjs'
import { TAKEOVER_LABEL } from './owner.mjs'

const isSid = (v) => typeof v === 'string' && v !== ''
const HEAD = 'agent-team H6 互斥：'

/**
 * H6 建 run 那一次的互斥。pointerRun：current-run 指着的、不是这次建的那一趟 { id, open, tweak } 或 null；openTweaks：没收尾的微调 [{ id, owner }]（不含这次建的）。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideExclusion({ creating, mode, sessionId, pointerRun = null, openTweaks = [] }) {
  if (creating !== true) return { ok: true }
  const tweaks = Array.isArray(openTweaks) ? openTweaks.filter((t) => isPlainObject(t) && typeof t.id === 'string') : []
  if (mode === TWEAK_MODE) {
    if (!isSid(sessionId)) {
      return { ok: false, reason: `${HEAD}hook 输入里读不到这个会话的 id，建不了微调（微调按会话认：之后的派发、写入都靠会话 id 认回这一趟）。告诉用户这次起不了微调，改走 /agent-team:at <需求>。` }
    }
    if (isPlainObject(pointerRun) && pointerRun.open === true && pointerRun.tweak !== true) {
      return {
        ok: false,
        reason:
          `${HEAD}current-run 指着的 ${quote(pointerRun.id)} 是一趟还没收口的完整需求，开着它的时候不能起微调。照 /agent-team:at-tweak 第 1 节问用户：` +
          '把这次的话作为补充交给那一趟，还是先放弃那一趟（/agent-team:at 第 1 节「放弃这一趟」）再起微调。',
      }
    }
    const mine = tweaks.find((t) => t.owner === sessionId)
    if (mine) {
      return {
        ok: false,
        reason:
          `${HEAD}这个会话已经有一趟没收口的微调 ${quote(mine.id)}：一个会话同一时刻只做一趟。照 /agent-team:at-tweak 第 1 节问用户：先收尾那一趟，` +
          '还是把这次的话当成那一趟的下一轮。',
      }
    }
    return { ok: true }
  }
  if (tweaks.length) {
    return {
      ok: false,
      reason:
        `${HEAD}还有微调没收口（${tweaks.map((t) => quote(t.id)).join('、')}）：开着微调的时候不能起完整的一趟（完整一趟的执行角色认领整个目录，会撞上）。` +
        '照 /agent-team:at 第 1 节「有微调开着」告诉用户，等它们收尾，或者在各自的会话里放弃。',
    }
  }
  return { ok: true }
}

// 一趟微调的说法：run id、起的时间、原话开头（都是磁盘上的值，过 quote；读不出的那一样不说）。
function describe(t, mine = false) {
  const facts = [
    mine ? '这个会话的' : null,
    typeof t.startedAt === 'string' && t.startedAt !== '' ? `${quote(t.startedAt)} 起` : null,
    typeof t.wordsHead === 'string' && t.wordsHead !== '' ? `原话开头 ${quote(t.wordsHead)}` : null,
  ].filter(Boolean)
  return `${quote(t.id)}${facts.length ? `（${facts.join('，')}）` : ''}`
}

/**
 * 命令展开那一刻给项目经理的【微调】一段（session-notice）。mine：这个会话名下没收口的那一趟 { id, startedAt, wordsHead } 或 null；others：别的会话名下没收口的。
 * 都空回 null。command：'at' | 'at-tweak' | 'at-resume' | 'at-status'。
 */
export function tweaksNotice({ command, mine = null, others = [] }) {
  const rest = Array.isArray(others) ? others.filter((t) => isPlainObject(t) && typeof t.id === 'string') : []
  const own = isPlainObject(mine) && typeof mine.id === 'string' ? mine : null
  if (!own && !rest.length) return null
  const all = [...(own ? [describe(own, true)] : []), ...rest.map((t) => describe(t))].join('、')
  if (command === 'at') {
    return `【微调】这个项目里还有微调没收口：${all}。开着微调的时候不能起完整的一趟：照 /agent-team:at 第 1 节「有微调开着」办，不读别的、不写任何文件。`
  }
  if (command === 'at-tweak') {
    if (own) {
      return (
        `【微调】这个会话已经有一趟没收口的微调 ${describe(own)}：一个会话同一时刻只做一趟。照 /agent-team:at-tweak 第 1 节问用户：先收尾那一趟，` +
        '还是把这次的话当成那一趟的下一轮。'
      )
    }
    return `【微调】别的会话开着这几趟微调：${all}。可以并行，照常往下起这一趟；碰到它们认领的文件，门禁会拒你派出去的人。`
  }
  if (command === 'at-resume') {
    const parts = []
    if (own) parts.push(`这个会话的那一趟微调 ${describe(own)} 还没收口：照 /agent-team:at-tweak 接着走它（不看 current-run）。`)
    if (rest.length) {
      parts.push(
        `别的会话名下还开着这几趟微调：${rest.map((t) => describe(t)).join('、')}。原来的会话关了、要在这个会话接手其中一趟的，` +
          `照 /agent-team:at-resume 第 1 节「别的会话的一趟」问用户，题面原样写那一趟的 run id，标签「${TAKEOVER_LABEL}」。`,
      )
    }
    return `【微调】${parts.join('')}`
  }
  if (command === 'at-status') return `【微调】没收口的微调：${all}。报进度时一并列出，说明各归哪个会话。`
  return null
}
