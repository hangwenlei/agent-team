// H6 返工预算写时强制（规格 §4.2 ③、M2a 设计 §1.2）。
//
// 为什么是 PreToolUse：docs/11 §1.2 记的是「拦住一次『把计数改小』的写入要看到改之前
// 那一版，PostToolUse 看不到」。这句话对，但它只排除了 PostToolUse——PreToolUse 触发时
// 磁盘上还是旧版、tool_input 里是新版，两边都在手上。
//
// ⚠️ 只拦**减少**，不碰增加。PM 每推进一个阶段都要正常重写 state.json，拦增加会把整条
// 链锁死。四条判据全部是「新的比旧的少」的形状。
//
// ⚠️ parse 不出来就放行。一个写坏的 state.json 会被 ledger 的 kind:'state' 报出来；
// 在这里 deny 会让 PM 连「把写坏的文件修回去」都做不到——与 gate.mjs 里 I2 豁免同一个
// 理由（不要把运维人逼进死角）。
//
// ⚠️ 不豁免任何调用者。H3 只让 PM 写得了 state.json，但「能写」不等于「能把计数改小」——
// 这条要拦的恰恰是 PM 自己，规格 §4.2 ③「不可重置」没有对写者身份留口子，跟 H4 那种
// 「PM 自己不受约束」的豁免不是同一回事。
import { reworkFromHistory, REWORK_LIMIT } from './state.mjs'

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function counts(history) {
  const c = {}
  if (!Array.isArray(history)) return c
  for (const e of history) {
    if (isPlainObject(e) && typeof e.stage === 'string') c[e.stage] = (c[e.stage] ?? 0) + 1
  }
  return c
}

export function decideRework({ before, after }) {
  // 旧的读不出来（本趟第一次写）或新的 parse 不出来：放行，理由见头部。
  if (!isPlainObject(before) || !isPlainObject(after)) return { ok: true }

  const hb = Array.isArray(before.history) ? before.history : []
  const ha = Array.isArray(after.history) ? after.history : []

  if (ha.length < hb.length) {
    return { ok: false, reason: `history 从 ${hb.length} 条变成 ${ha.length} 条——阶段进入日志只许追加，不许删。返工计数是它的派生量（规格 §4.2 ③），删 history 等于改计数。` }
  }

  const cb = counts(hb)
  const ca = counts(ha)
  for (const [stage, n] of Object.entries(cb)) {
    if ((ca[stage] ?? 0) < n) {
      return { ok: false, reason: `history 里 ${stage} 的出现次数从 ${n} 变成 ${ca[stage] ?? 0}——只许追加，不许删。` }
    }
  }

  const derived = reworkFromHistory(ha)
  const rw = isPlainObject(after.rework) ? after.rework : {}
  for (const [stage, n] of Object.entries(derived)) {
    const v = rw[stage] ?? 0
    if (v < n) {
      return { ok: false, reason: `rework["${stage}"] 写成 ${v}，但 history 里 ${stage} 出现 ${n + 1} 次、派生值是 ${n}——返工计数不可重置（规格 §4.2 ③）。` }
    }
  }
  for (const [stage, v] of Object.entries(rw)) {
    if (typeof v === 'number' && v > REWORK_LIMIT) {
      return { ok: false, reason: `rework["${stage}"] 是 ${v}，超过硬上限 ${REWORK_LIMIT}（规格 §4.2 ③：第 ${REWORK_LIMIT} 轮终局，不过则升级）。` }
    }
  }
  return { ok: true }
}
