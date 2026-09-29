// H6 返工预算写时强制（规格 §4.2 ③、M2a 设计 §1.2）。
//
// 为什么是 PreToolUse：docs/11 §1.2 记的是「拦住一次『把计数改小』的写入要看到改之前
// 那一版，PostToolUse 看不到」。这句话对，但它只排除了 PostToolUse——PreToolUse 触发时
// 磁盘上还是旧版、tool_input 里是新版，两边都在手上。
//
// ⚠️ 只拦**减少**，不碰增加。PM 每推进一个阶段都要正常重写 state.json，拦增加会把整条
// 链锁死。四条判据全部是「新的比旧的少」的形状。
//
// ⚠️ 只有**旧的**读不出来（本趟第一次写、或者文件本来就坏了）才放行——那是 PM 把坏文件修回去
// 的路，与 gate.mjs 里 I2 豁免同一个理由（不要把运维人逼进死角）。**新的**必须永远是合法的
// JSON 对象（M3r，docs/26，全量审查第 5 条）：原先这条对两侧同样放行，于是返工史能用两次 Write
// 洗掉——先写一份垃圾（新的一侧 parse 不出来，放行），再写一份清零的合法版本（旧的一侧 parse 不
// 出来，放行），落盘之后 validateState 挑不出任何问题。拒掉第一步，PM 也锁不死：它总写得出一份
// 合法的 JSON。
//
// ⚠️ 不豁免任何调用者。H3 只让 PM 写得了 state.json，但「能写」不等于「能把计数改小」——
// 这条要拦的恰恰是 PM 自己，规格 §4.2 ③「不可重置」没有对写者身份留口子，跟 H4 那种
// 「PM 自己不受约束」的豁免不是同一回事。
// isNonNegativeInteger 与 validateState 共用同一份（M2b 终审 A5）。
import { reworkFromHistory, REWORK_LIMIT, isNonNegativeInteger } from './state.mjs'
// isPlainObject 走 stages.mjs 同一份（M2b 终审 A2），原先是这里的私有拷贝。
import { isPlainObject } from './stages.mjs'
import { normalizeText } from './text-norm.mjs'

function counts(history) {
  const c = {}
  if (!Array.isArray(history)) return c
  for (const e of history) {
    if (isPlainObject(e) && typeof e.stage === 'string') c[e.stage] = (c[e.stage] ?? 0) + 1
  }
  return c
}

export function decideRework({ before, after }) {
  // 新的必须是合法的 JSON 对象；旧的读不出来（第一次写、或者本来就坏了）才放行。理由见头部。
  if (!isPlainObject(after)) {
    return {
      ok: false,
      reason:
        'state.json 的新内容不是一个合法的 JSON 对象。写坏它会让门禁读不出这趟 run，也是把返工史' +
        '洗掉的第一步（先写坏、再写一份清零的）。写一份合法的 JSON 对象；要整份重写就用 Write。',
    }
  }
  if (!isPlainObject(before)) return { ok: true }

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

  // 修复轮 1 Major 1：判据③要先把 rework[stage] 强制转成数字再比，不能只信 typeof。
  // `<` 与 `>` 在两边类型不同的时候会各玩各的把戏——`'4' < 4` 走的是数值比较（字符串
  // 先被转成数字，为 false，逃过判据③的"低于派生值"检查）；而判据④原来的
  // `typeof v === 'number'` 对字符串/数组/对象一律为 false，直接跳过，硬上限形同虚设。
  // 两个洞合起来：把 rework 写成字符串或数组就能把第 4 轮返工也放行。
  //
  // ⚠️ M2b 终审 A5 改了判据④那一半，**这段话的后半句也跟着改了**（原文写的是
  // 「Number() 统一转换之后…判据④不再区分类型」——那句话现在是假的，不留着让它活过
  // 自己的更正）：判据④现在**先验类型**，与 validateState 共用 state.mjs 导出的
  // isNonNegativeInteger。理由见那个函数上方——`Number(true) === 1`、
  // `Number(' 1 ') === 1` 让写时闸比事后告警宽松，方向反了。
  //
  // 判据③**保留 Number()**，这是有意的：它问的是"这个计数低不低于派生值"这个数值
  // 事实，强制转换在这里是**收紧**（NaN 之外的怪形状照样被它算出一个数来比），而且
  // 它先返回、给出的是"不可重置"这条更贴题的理由。类型本身由紧随其后的判据④兜。
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
    // 下界是修复轮复评补的：原来这里只有上界，而第二道 validateState（state.mjs，
    // 事后告警）连类型带下界一起查——**fail-closed 的写时闸比 fail-open 的事后告警
    // 更宽松，方向是反的**。实测 rework:{"S5":-1} 在该阶段没有返工史时被这里放行、
    // 被 validateState 报出来。M2b 终审 A5 把这道不对称的**剩下半边**也补上了：
    // 判据从 `Number(raw)` 改成直接验 raw 的类型，两边共用同一个谓词，
    // `{"S5": true}` 与 `{"S5": " 1 "}` 不再从这里溜过去。
    if (!isNonNegativeInteger(raw) || raw > REWORK_LIMIT) {
      return { ok: false, reason: `rework["${stage}"] 是 ${JSON.stringify(raw)}，不是 0 到 ${REWORK_LIMIT} 之间的整数（规格 §4.2 ③：第 ${REWORK_LIMIT} 轮终局，不过则升级）。` }
    }
  }
  return { ok: true }
}

// 弯引号折成直引号：平台的 Edit 在精确匹配不上时，把 “ ” ‘ ’ 与 " ' 当成同一个字符再找一遍。
// 一对一替换，长度不变，所以在折过的文本里找到的下标就是原文里的下标。
function straightQuotes(s) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
}

/**
 * 照平台 Edit 的口径重放一次替换，得出写入之后的文本（M3r，docs/26，全量审查第 6 条）。
 *
 * 平台的 Edit 匹配之前先剥 BOM、把 CRLF 折成 LF；精确匹配不上时再把弯引号与直引号当成同一个
 * 字符找一遍；写回时恢复原来的行尾。H6 此前按字节重放，CRLF 的 state.json 上任何多行 Edit 都
 * 匹配不上、算不出新内容、按「parse 不出来」放行——在 Windows 上，core.autocrlf、编辑器、
 * PowerShell 都会写出 CRLF 的 state.json。
 *
 * 返回的是 LF 形式的新文本（只拿去 JSON.parse，行尾不影响语义）；匹配不上、参数不对时返回
 * null，由调用方拒——不去猜第二种可能。门禁与平台的口径若在别处还有差别，差别只会让这里
 * 返回 null（多拒一次、让它改用 Write），而不会算出一份与真实落盘不同的新内容：平台要求
 * old_string 在文件里恰好出现一次（replace_all 除外），两边先精确、后弯引号，命中的是同一处。
 *
 * @param {{ before: string|null, oldString: string, newString: string, replaceAll?: boolean }} args
 *   before：磁盘上的原文（文件不在时为 null）。
 * @returns {string|null}
 */
export function replayEdit({ before, oldString, newString, replaceAll = false }) {
  if (typeof oldString !== 'string' || typeof newString !== 'string') return null
  const oldN = normalizeText(oldString)
  const newN = normalizeText(newString)
  // 文件不在：平台的 Edit 只在 old_string 为空时新建文件，内容就是 new_string。
  if (before === null || before === undefined) return oldN === '' ? newN : null
  if (typeof before !== 'string' || oldN === '') return null
  const text = normalizeText(before)

  for (const [hay, needle] of [[text, oldN], [straightQuotes(text), straightQuotes(oldN)]]) {
    const first = hay.indexOf(needle)
    if (first === -1) continue
    if (!replaceAll) return text.slice(0, first) + newN + text.slice(first + needle.length)
    let out = ''
    let from = 0
    for (let i = first; i !== -1; i = hay.indexOf(needle, from)) {
      out += text.slice(from, i) + newN
      from = i + needle.length
    }
    return out + text.slice(from)
  }
  return null
}

/**
 * 把 state.json 的原文解析成对象；剥掉 BOM，解析不出来或不是对象时返回 null。
 * 与 runctx.mjs 读 state.json 走同一份归一化（hooks/lib/text-norm.mjs）——带 BOM 的文件此前
 * 在这里被当成「旧的读不出来」，任何清零都放行。
 */
export function parseStateText(text) {
  if (typeof text !== 'string') return null
  try {
    const v = JSON.parse(normalizeText(text))
    return isPlainObject(v) ? v : null
  } catch {
    return null
  }
}
