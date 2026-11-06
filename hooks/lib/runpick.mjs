// 并行微调：门禁这一次该按哪一趟判（挑这一趟）。纯函数，I/O 由 gate.mjs 注入。
//
// 微调不写 current-run：几个会话可以同时各跑一趟微调。门禁的每一次判定先挑这一趟——
//   - 子代理（hook 输入带 agent_id）：哪一趟微调的派发记录里有它，就是那一趟。已经收口、放弃了的微调也找：它派出去的人可能还在跑，
//     照它判写路径比落到 current-run 或「没有 run」上对。找不到不再按会话找（子代理的会话 id 可能就是主会话那一个）。
//   - 主线程（项目经理、不带 agent_type 的主会话；不带 agent_id）：这个会话名下没收口的那一趟微调。
//   - 都不是：回 null，调用方照旧按 current-run。
// 「是不是一趟微调」只认门禁记过的：state.json 写着 tweak、run 目录里绑着 /agent-team:at-tweak 的原话记录（门禁专属）——state.json 里自己写一个 mode
// 换不来这一层（与 H1 换花名册、H6 认 mode 同一个口径）。
import { isPlainObject } from './stages.mjs'
import { modeOf, TWEAK_MODE } from './tweak.mjs'

/** 这一趟是不是门禁记过的微调。words：run 目录里绑上的原话记录（readWords 读出来的，读不出为 null）。 */
export function isTweakRun({ state, words }) {
  return modeOf(state) === TWEAK_MODE && isPlainObject(words) && words.command === 'at-tweak'
}

const isSid = (v) => typeof v === 'string' && v !== ''

/**
 * 挑这一趟。tweaks：[{ id, open, owner（会话 id 或 null）, agentIds（派发记录里的 agent_id） }]，只放门禁记过的微调。
 * @returns {{ runId: string, via: 'agent'|'session' } | null}
 */
export function pickRun({ agentId = null, mainThread = false, sessionId = null, tweaks = [] } = {}) {
  const list = Array.isArray(tweaks) ? tweaks.filter((t) => isPlainObject(t) && typeof t.id === 'string' && t.id !== '') : []
  if (isSid(agentId)) {
    const hit = list.find((t) => Array.isArray(t.agentIds) && t.agentIds.includes(agentId))
    return hit ? { runId: hit.id, via: 'agent' } : null
  }
  if (!mainThread || !isSid(sessionId)) return null
  const mine = list.filter((t) => t.open === true && t.owner === sessionId).map((t) => t.id).sort()
  return mine.length ? { runId: mine[mine.length - 1], via: 'session' } : null
}
