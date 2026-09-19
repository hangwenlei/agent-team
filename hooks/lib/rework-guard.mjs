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

  // 修复轮 1 Major 1：这两条判据都要先把 rework[stage] 强制转成数字再比，不能只信
  // typeof。`<` 与 `>` 在两边类型不同的时候会各玩各的把戏——`'4' < 4` 走的是数值比较
  // （字符串先被转成数字，为 false，逃过判据③的"低于派生值"检查）；`typeof v ===
  // 'number'` 对字符串/数组/对象一律为 false，直接跳过判据④，硬上限形同虚设。两个
  // 洞合起来：把 rework 写成字符串或数组就能把第 4 轮返工也放行。Number() 统一转换
  // 之后，"转不成数字"本身（NaN）与"转成了但超上限"都在判据④一次性拦住，不再区分
  // 类型——规格 §4.2 ③要的是"第 3 轮终局"这个数值事实，不是"这个字段恰好是 number
  // 类型"这个 JS 实现细节。
  const derived = reworkFromHistory(ha)
  const rw = isPlainObject(after.rework) ? after.rework : {}
  for (const [stage, n] of Object.entries(derived)) {
    const raw = rw[stage] ?? 0
    const v = Number(raw)
    if (v < n) {
      return { ok: false, reason: `rework["${stage}"] 写成 ${JSON.stringify(raw)}，但 history 里 ${stage} 出现 ${n + 1} 次、派生值是 ${n}——返工计数不可重置（规格 §4.2 ③）。` }
    }
  }
  for (const [stage, raw] of Object.entries(rw)) {
    const v = Number(raw)
    if (!Number.isInteger(v) || v > REWORK_LIMIT) {
      return { ok: false, reason: `rework["${stage}"] 是 ${JSON.stringify(raw)}，不是合法整数或超过硬上限 ${REWORK_LIMIT}（规格 §4.2 ③：第 ${REWORK_LIMIT} 轮终局，不过则升级）。` }
    }
  }
  return { ok: true }
}
