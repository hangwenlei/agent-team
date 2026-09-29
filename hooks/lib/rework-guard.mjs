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
// 拒绝理由会被模型读到；阶段名与计数值来自 state.json（磁盘或这次写入的内容），一律过 quote（M3s，docs/27）。
import { quote } from './trusted.mjs'

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
      return { ok: false, reason: `history 里 ${quote(stage)} 的出现次数从 ${n} 变成 ${ca[stage] ?? 0}——只许追加，不许删。` }
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
      return { ok: false, reason: `rework[${quote(stage)}] 写成 ${quote(raw)}，但 history 里 ${quote(stage)} 出现 ${n + 1} 次、派生值是 ${n}——返工计数不可重置（规格 §4.2 ③）。` }
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
      return { ok: false, reason: `rework[${quote(stage)}] 是 ${quote(raw)}，不是 0 到 ${REWORK_LIMIT} 之间的整数（规格 §4.2 ③：第 ${REWORK_LIMIT} 轮终局，不过则升级）。` }
    }
  }
  return { ok: true }
}

/**
 * 重放一次 Edit，得出平台写入之后 state.json 的文本（M3r，docs/26，全量审查第 6 条）。
 *
 * **只镜像平台的「精确命中」那一层**（平台实现见 docs/26 §5，本机 claude.exe 2.1.283）：
 *   - 读文件：只把 CRLF 折成 LF，UTF-8 BOM 原样留着；
 *   - 匹配：old_string 原样在文件里找；平台之后还有弯引号互认、两层 \uXXXX 转义互认，那几层会
 *     **改写 new_string**（把直引号换成弯引号、换转义写法），这里一概不认，返回 null；
 *   - 多处命中又没带 replace_all：平台报错、不落盘——返回 null；
 *   - 空 old_string：文件不在、或只有空白时整份写成 new_string；否则平台报错——返回 null；
 *   - new_string 原样放进去，一个字不改（平台精确命中时同样一个字不改）。
 * 写回时平台恢复原来的行尾；这里返回 LF 形式，只拿去 JSON.parse，行尾不影响语义。
 *
 * 为什么只镜像这一层：H6 放行的前提是「门禁算出的新内容就是真实落盘的内容」。第一版照「预测
 * 平台」写，剥了 new_string 的 BOM、做了弯引号互认却没做平台随之而来的改写——门禁算出合法 JSON，
 * 平台落盘的却是坏文件；下一次 Write 走「旧的读不出来」那条修复路放行，两步清零照样做成（复核
 * 实测）。只镜像平台一个字不改的那一层，这个落差就不存在；其余情形返回 null，由门禁拒、让它
 * 改用 Write——Write 的新内容是确定的。代价是多拒几种 Edit（用了弯引号或转义写法的 old_string）。
 *
 * @param {{ before: string|null, oldString: string, newString: string, replaceAll?: boolean }} args
 *   before：磁盘上的原文（文件不在时为 null）。
 * @returns {string|null}
 */
export function replayEdit({ before, oldString, newString, replaceAll = false }) {
  if (typeof oldString !== 'string' || typeof newString !== 'string') return null
  if (before === null || before === undefined) return oldString === '' ? newString : null
  if (typeof before !== 'string') return null
  const text = before.replace(/\r\n/g, '\n')
  if (oldString === '') return text.trim() === '' ? newString : null
  const parts = text.split(oldString)
  if (parts.length === 1) return null
  if (parts.length > 2 && !replaceAll) return null
  return parts.join(newString)
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
