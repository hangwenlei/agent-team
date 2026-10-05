// H6 返工预算写时强制（规格 §4.2 ③、M2a 设计 §1.2）。
//
// 为什么是 PreToolUse：docs/11 §1.2 记的是「拦住一次『把计数改小』的写入要看到改之前
// 那一版，PostToolUse 看不到」。这句话对，但它只排除了 PostToolUse——PreToolUse 触发时
// 磁盘上还是旧版、tool_input 里是新版，两边都在手上。
//
// ⚠️ 只拦**减少**，不碰增加。PM 每推进一个阶段都要正常重写 state.json，拦增加会把整条
// 链锁死。四条判据全部是「新的比旧的少」的形状。
// ⚠️ M3y（docs/33）订正这句话的适用范围：它说的是返工计数那四条（decideRework）。本文件末尾 M3y 一节的
// decideReworkBase 管 rework_base，那几条不是「新的比旧的少」的形状：没记回退就写快照、推进离开一段时那一段里还有
// 上一轮的产物，都拦。推进本身照样放行——离开的段里的产物都重写过或标了 "accepted" 就行，所以「拦增加会把整条链
// 锁死」那条理由不受影响。
// ⚠️ M3z（docs/34，全量审查第 16 条）再订正一次：返工计数那几条也不再全是「新的比旧的少」。判据④（超过上限）本来就是
// 「拦增加」的形状——上限内它从不触发，到了上限它让第 4 轮没有任何诚实的写法（与判据③互斥）。现在：判据④只罚「比写入前大、
// 又超过上限」（上限 = 3 + 门禁记下的、覆盖这一段的返工批准条数，hooks/lib/budget.mjs）；回退那一次写入先做预判（这一轮走完
// 会越限就拒，理由给用户批准的规范标签）；另加一条 stage 不变量（stage 与这次追加的 history 条目都在阶段链上、stage 等于
// history 末条），把「只改 stage 不记 history」与链外的段这两条绕路堵上。推进本身照样放行：上限内的推进与回退一个都不多拒，
// 「拦增加会把整条链锁死」那条理由针对的那种拦法仍然没有。
// ⚠️ M4d（docs/38，全量审查第 17 条）订正上面两处「推进本身照样放行」：推进那一次还核离开的那一段交齐了没有（这一段叫到的产者
// 各自那几份、这一段固定的产物；缺的、空文件都拒，裁掉的不算，标了 "accepted" 的算交了——hooks/lib/advance.mjs），并且一次只推进
// 一段。「拦增加会把整条链锁死」那条理由仍然不受影响：交齐了的推进一个都不多拒。
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
import { isPlainObject, isStageChain, productsOfStage, mayAcceptProduct, isVerifyStage } from './stages.mjs'
import { VERIFY_REDO, splitByAccept } from './freshness.mjs'
import { approvalTargetFor, askUserText, limitOf, overLimit } from './budget.mjs'
import { normalizeText } from './text-norm.mjs'
// 拒绝理由会被模型读到；阶段名与计数值来自 state.json（磁盘或这次写入的内容），一律过 quote（M3s，docs/27）。
import { quote, safeJson } from './trusted.mjs'
import { SHA_RE } from './contract-hash.mjs'
// 第 17 条（推进判据）：离开一段时核缺的、空文件、没记账；一次只推进一段。
import { decideSingleStep, departureBlockers, departureLines } from './advance.mjs'
import { EMPTY_SHA } from './closing.mjs'

function counts(history) {
  const c = {}
  if (!Array.isArray(history)) return c
  for (const e of history) {
    if (isPlainObject(e) && typeof e.stage === 'string') c[e.stage] = (c[e.stage] ?? 0) + 1
  }
  return c
}

// 同一段原地重来（history 末条之后再追加同一段）在门禁眼里就是回退；PM 把同段重派误记成回退时，这一句先说出来。
const SAME_STAGE_HINT =
  '如果这只是同一段里重派一个角色（它这一次没交齐，再派它一次），那不是回退：去掉新追加的这条 history，rework 也不加——' +
  '同段重派不计返工。'

const askUser = (target, grants) =>
  askUserText(target, grants, '再把这次写入连同那条 escalation（budget-exhausted）与新的 contract_sha 一起重写——同一次 Write。')

/**
 * H6 返工计数的写时判据。M3z（docs/34，全量审查第 16 条）多两个参数：stages 是插件自己的阶段链（gate.mjs 读 stages.json，读不出来
 * 给 null），grants 是门禁记下的返工批准（hooks/lib/budget.mjs 的 readGrants，读这份 state.json 同一个目录下的 approvals.jsonl）。
 * 判据按这个顺序：新内容是对象 → history 只许追加、各段出现次数不许少 → 回退预判 → ③ 不低于派生值 → ④ 类型与上限 → stage 不变量。
 * 回退预判排在③④之前：PM 第 4 轮不管把 rework 写成多少，拿到的都是带规范标签的那一条理由。
 * 预判与④的上限那一半拒的时候带 budget: true——gate.mjs 据此在理由末尾补一句「批准会不会记不下」的诊断。
 */
export function decideRework({ before, after, stages = null, grants = [] }) {
  // 新的必须是合法的 JSON 对象；旧的读不出来（第一次写、或者本来就坏了）才放行。理由见头部。
  if (!isPlainObject(after)) {
    return {
      ok: false,
      reason:
        'state.json 的新内容不是一个合法的 JSON 对象。写坏它会让门禁读不出这趟 run，也是把返工史' +
        '洗掉的第一步（先写坏、再写一份清零的）。写一份合法的 JSON 对象；要整份重写就用 Write。',
    }
  }
  const chain = isStageChain(stages) ? stages : null
  if (isPlainObject(before)) {
    const counted = decideCounts({ before, after, stages: chain, grants })
    if (!counted.ok) return counted
  }
  return chain ? decideChainInvariant({ before: isPlainObject(before) ? before : null, after, stages: chain }) : { ok: true }
}

function decideCounts({ before, after, stages, grants }) {
  const hb = Array.isArray(before.history) ? before.history : []
  const ha = Array.isArray(after.history) ? after.history : []

  if (ha.length < hb.length) {
    return { ok: false, reason: `history 从 ${hb.length} 条变成 ${ha.length} 条——阶段进入日志只许追加，不许删。返工计数是它的派生量（规格 §4.2 ③），删 history 等于改计数。` }
  }

  // 复核（docs/34 §3，budget-1，高）：「只许追加」此前只核条数与各段出现次数——把一条更早的 S5 改成还有额度的段、同时照常追加一条 S5，
  // 各段次数都不降，S5 的派生值却不涨，第 4、5、6 轮都不经批准做成；对调两条旧条目的段名还能把回退藏起来。写入前已有的条目，段名
  // 一个字都不许改（at 可以订正）。写入前就坏了的条目（不是 { stage 字符串 }）不管：计数本来就不数它。
  for (let i = 0; i < hb.length; i++) {
    const old = hb[i]
    if (!isPlainObject(old) || typeof old.stage !== 'string') continue
    const now = ha[i]
    if (isPlainObject(now) && now.stage === old.stage) continue
    return {
      ok: false,
      reason:
        `history[${i}] 是写入前就有的条目，段名是 ${quote(old.stage)}，这次写入把它改了——history 只许追加：已有的条目不许改段名、` +
        '不许删（at 可以订正）。返工计数是它的派生量（规格 §4.2 ③），改旧条目的段名等于改计数。',
    }
  }

  const cb = counts(hb)
  const ca = counts(ha)
  for (const [stage, n] of Object.entries(cb)) {
    if ((ca[stage] ?? 0) < n) {
      return { ok: false, reason: `history 里 ${quote(stage)} 的出现次数从 ${n} 变成 ${ca[stage] ?? 0}——只许追加，不许删。` }
    }
  }

  // M3z：回退预判。这次写入记了一次回退（restartInfo），就按「这一轮走完」算：阶段链上不早于回到的那一段、在最后那条回退条目
  // 之前出现过 n 次的段，这一轮重进它就是第 n 轮返工（hooks/lib/budget.mjs 的 overLimit，O5 的计数）。有一段超过上限就在这一次
  // 拒——此前要等到三段之后推进进那一段才撞上判据④，而【阶段】还指着那条会被拒的写法。
  if (stages) {
    const restart = restartInfo({ before, after, stages })
    if (restart) {
      const over = overLimit({ history: ha, restartIndex: restart.index, stages, grants })
      if (over.length && restart.index > hb.length) {
        // 复核（docs/34 §3，prose-2）：回退那一条之前、同一次写入里还追加了前进的条目（先推进、再回退）。预判把它们算进去（它们确是
        // 这一轮的），记录器却只能从磁盘现在的样子模拟「回到那一段」——批准盖不全，原样重写照样被拒，再问又说不需要。叫它拆开写：
        // 推进那一次单独写（它自己越限时判据④会给标签），回退那一次照常预判。
        return {
          ok: false,
          budget: true,
          reason:
            `这次写入在最后那条回退之前还往 history 追加了别的条目（先推进再回退，或者一次记了不止一轮），这一轮走完会越限。拆开写：` +
            '先单独写一次推进或较早那一轮（最后那条回退之前的部分），再单独写回退——回退那一次越限的话，拒绝理由会给你问用户用的标签。' +
            '门禁记批准时按磁盘上现在的样子算「回到那一段」，几样写在同一次里，批准盖不全。',
        }
      }
      if (over.length) {
        const target = Object.keys(stages).find((id) => id === restart.stage)
        const list = over.map((o) => `${o.stage}（第 ${o.rounds} 轮，上限 ${o.limit}）`).join('、')
        const head =
          `这次写入记了一次回退：这一轮回到 ${target}，走完会让 ${list} 的返工超过上限` +
          `（规格 §4.2 ③：第 ${REWORK_LIMIT} 轮终局，不过则升级；上限 = ${REWORK_LIMIT} + 门禁记下的、覆盖那一段的返工批准条数）。`
        const same = restart.index === hb.length && typeof before.stage === 'string' && before.stage === restart.stage ? `${SAME_STAGE_HINT}\n` : ''
        return { ok: false, budget: true, reason: `${same}${head}\n${askUser(target, grants)}` }
      }
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
    if (!isNonNegativeInteger(raw)) {
      return { ok: false, reason: `rework[${quote(stage)}] 是 ${quote(raw)}，不是非负整数——返工计数是 history 的派生量（规格 §4.2 ③）。` }
    }
    // M3z：上限按 limitOf（3 + 覆盖这一段的返工批准条数），而且只罚「比写入前大」——原样带着的旧值不重复拒：批准文件丢了、
    // 读不出来时，已经记好的第 4 轮不该让之后每一次记账都被拒（那会把整趟锁死，出路只剩改小计数，而那会被判据③拒）。
    // 写入前不是合法整数也算改大。
    const limit = limitOf(stage, grants)
    if (raw > limit) {
      const prev = isPlainObject(before.rework) ? before.rework[stage] : undefined
      if (!isNonNegativeInteger(prev) || raw > prev) {
        const head =
          `rework[${quote(stage)}] 写成 ${quote(raw)}，超过返工上限 ${limit}` +
          `（${REWORK_LIMIT} 轮，加上门禁这一趟记下的、覆盖它的返工批准 ${limit - REWORK_LIMIT} 条；规格 §4.2 ③：第 ${REWORK_LIMIT} 轮终局，不过则升级）。`
        if (!stages) {
          return {
            ok: false,
            budget: true,
            reason: `${head}阶段链读不出来，门禁这次既记不下也认不出返工批准：停下，告诉用户插件可能装坏了（重装或更新 agent-team 插件）。`,
          }
        }
        if (!Object.hasOwn(stages, stage)) {
          return { ok: false, budget: true, reason: `${head}它不是阶段链上的段：rework 只记链上各段的返工。` }
        }
        const target = Object.keys(stages).find((id) => id === approvalTargetFor({ history: ha, stages, stage }))
        return { ok: false, budget: true, reason: `${head}\n${askUser(target, grants)}` }
      }
    }
  }
  return { ok: true }
}

// M3z（O3）：stage 不变量。validateState 早就把「stage 不在链上」「history 条目不在链上」「history 末条不等于 stage」定义成问题，
// 这里把它们升成写时判据——事后告警挡不住的两条绕路：只改 stage、不追加 history（零代价地撤回一次推进、或者不记账就回到早段
// 重做，事后只报一次、改回去不留痕）；把 stage 或 history 写成链外的段（S5b、「需求驳回」、DONE——回退预判、回退快照、第 16 条
// 的重做判据都只认链上的段，一写全部失效）。
// 写入前读不出来（第一次写、修坏文件）时只核 stage 在链上：那是把坏文件修回去的路，原样保留的旧 history 不核（fail-open.mjs 的
// 修法叫 PM 照原样保留能认出来的 history）。
function decideChainInvariant({ before, after, stages }) {
  const ids = Object.keys(stages)
  const tail =
    // M4a（docs/35）：收口有了自己的标记，理由指过去（原来只说「最后一段就是终点」，PM 不知道收口该怎么记）。
    `收口不往 stage 或 history 里写「DONE」之类的标记：在最后一段（${ids[ids.length - 1]}）用同一次 Write 记 never_invoked 与 ` +
    'closed_at（/agent-team:at 第 6 节）；' +
    '返工是回到链上的某一段（照 /agent-team:at 第 3 节的「回退」）。'
  if (typeof after.stage !== 'string' || !Object.hasOwn(stages, after.stage)) {
    return { ok: false, reason: `state.json 的 stage 写成 ${quote(after.stage)}，它不是阶段链上的段（${ids.join('、')}）。${tail}` }
  }
  if (!before) return { ok: true }
  const hb = Array.isArray(before.history) ? before.history : []
  const ha = Array.isArray(after.history) ? after.history : []
  for (let j = hb.length; j < ha.length; j++) {
    const e = ha[j]
    if (isPlainObject(e) && typeof e.stage === 'string' && Object.hasOwn(stages, e.stage)) continue
    const what = isPlainObject(e) && Object.hasOwn(e, 'stage') ? `（stage 是 ${quote(e.stage)}）` : ''
    return {
      ok: false,
      reason:
        `history 新追加的第 ${j + 1} 条${what}不是 { "stage": 阶段链上的段, "at": "<ISO 时间>" } 的形状。` +
        `history 只记进入过阶段链上的哪一段。${tail}`,
    }
  }
  const last = ha.length ? ha[ha.length - 1] : undefined
  if (isPlainObject(last) && last.stage !== after.stage) {
    return {
      ok: false,
      reason:
        `stage 写成 ${quote(after.stage)}，history 的最后一条却是 ${quote(last.stage)}。推进与回退都是同一次 Write 改 stage、` +
        '往 history 追加同一段（回退还要记 rework 与 rework_base，照 /agent-team:at 第 3 节）；只改 stage 不记 history，' +
        '返工计数就漏记了（规格 §4.2 ③）。',
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

// ============================================================================
// M3y（docs/33，全量审查第 15 条）：rework_base 的写时判据。
//
// 回退之后上一轮的产物都还在磁盘上，交没交、齐没齐的判据（H5a/H5b、【阶段】、H2）原来只问文件在不在，于是全被它们满足。
// rework_base 记着回退那一刻各份产物的 sha；hooks/lib/freshness.mjs 拿它分辨哪些产物还是上一轮的。这里管它怎么写：
//
//   - 回退那一次写入（history 新追加的条目里有一条在链上不晚于它前一条；T = 最后那条的段）：rework_base 必须逐键逐值等于
//     「T 及之后各段在磁盘上的产物：现在的 sha」∪「写入前 rework_base 里 T 之前各段的合法条目（是阶段产物、值是 sha 或 "accepted"），原样」；
//     坏条目不带。读不出来的产物不核。
//     例外：所在段不晚于写入后 stage 的，sha 那一格这一次就可以写成 "accepted"（与回退落盘后紧接着再写一次等价）。
//   - 之后的每一次写入（到下一次回退为止）：原样带着它。只许把当前段及更早段的某一条从 sha 改成 "accepted"（这一轮接受它原样）；
//     写入前就坏了的条目（值不合法、或不是任何阶段的产物）可以删掉或标 "accepted"。没回退过（写入前缺失或 {}）：只许缺失或 {}。
//     下一次回退照上一条重拍：回到的那一段及之后各段按那一刻的磁盘，标过的 "accepted" 也换回 sha。
//   - 推进（after.stage 在链上晚于 before.stage）：离开的各段里，值是 sha、磁盘内容与它相同的产物不许留着——
//     要么已经重写，要么在同一次 Write 里标 "accepted"。
//
// ⚠️ 为什么用 "accepted" 而不是删掉那一条：删得掉的话，「原样带着」就只能核「不许加」，一次写入悄悄丢掉一条，那份上一轮的
//    产物就算这一轮的了。标记是显式的，H6 能核它只落在当前段及更早段。
// ⚠️ 快照按全部 producers 展开（stages.mjs 的 productsOfStage），不按这一趟叫到谁：上一轮叫过、这一轮没叫的人留下的那份
//    同样是上一轮的。
// ⚠️ 跳过：写入前读不出来（与 decideRework 的修复路同一条）；阶段链读不出来或形状不对；写入前的 rework_base 不是对象时
//    不核「原样带着」。都只是不核，不放宽 decideRework。后两种的原因进 notes，由 gate.mjs 写进 stderr；写入前读不出来时不留痕
//    （与 decideRework 的修复路一样静默）。
// ⚠️ 磁盘由调用方注入：diskSha(name) → { exists, sha }，读不出来时 sha 为 null。逐份 try 在 gate.mjs；这里不包 try——
//    判定代码抛异常时 H6 照旧 fail closed。

const ACCEPTED = 'accepted'

function stageIndexer(stages) {
  const ids = Object.keys(stages)
  const at = (s) => (typeof s === 'string' ? ids.indexOf(s) : -1)
  return { ids, at }
}

function historyOf(state) {
  return isPlainObject(state) && Array.isArray(state.history) ? state.history : []
}

/**
 * 这次写入是不是一次回退：history 新追加的条目（after.history 在写入前长度之后的部分）里，有一条所在段在链上不晚于它前一条。
 * 前一条可以是写入前就有的最后一条。两条都得是链上的段才比。
 * @returns {null | { stage: string, followedByForward: boolean }} stage 是最后那条回退条目的段；它之后还追加了别的条目时
 *   followedByForward 为 true（补记：回退记晚了，同一次写入又往前记了几段）。
 */
export function restartInfo({ before, after, stages }) {
  if (!isStageChain(stages)) return null
  const { at } = stageIndexer(stages)
  const hb = historyOf(before)
  const ha = historyOf(after)
  const stageAt = (j) => (isPlainObject(ha[j]) ? at(ha[j].stage) : -1)
  // 复核（docs/34 §3，budget-2）：与它之前最近一条在链上的条目比，链外条目跳过——停在 DONE 的旧 run 回退时要认得出（快照、预判）。
  let last = -1
  let prev = -1
  for (let j = 0; j < ha.length; j++) {
    const cur = stageAt(j)
    if (cur < 0) continue
    if (j >= hb.length && prev >= 0 && cur <= prev) last = j
    prev = cur
  }
  if (last < 0) return null
  // index（M3z）：回退预判按「这条回退条目之前」的出现次数算（hooks/lib/budget.mjs 的 overLimit）。
  return { stage: ha[last].stage, followedByForward: last < ha.length - 1, index: last }
}

// 每个产物名所在的段（链上最早的那一段）的下标。
function stageOfProduct(stages) {
  const { ids } = stageIndexer(stages)
  const out = new Map()
  ids.forEach((id, i) => {
    for (const n of productsOfStage(stages[id])) if (!out.has(n)) out.set(n, i)
  })
  return out
}

function isSha(v) {
  return typeof v === 'string' && SHA_RE.test(v)
}

function names(list) {
  return list.join('、')
}

// M4a 复核（B-1）：这次写入新追加的条目里有几条回退（在链上不晚于它前一条；链外条目跳过，与 restartInfo 同一个口径）。
function appendedRestarts({ before, after, stages }) {
  const { at } = stageIndexer(stages)
  const hb = historyOf(before)
  const ha = historyOf(after)
  let prev = -1
  let n = 0
  for (let j = 0; j < ha.length; j++) {
    const cur = isPlainObject(ha[j]) ? at(ha[j].stage) : -1
    if (cur < 0) continue
    if (j >= hb.length && prev >= 0 && cur <= prev) n++
    prev = cur
  }
  return n
}

/** 回退那一刻 rework_base 应当是什么。unchecked：在、但读不出来的产物（不核）。 */
function expectedAtRestart({ before, stages, stage, diskSha }) {
  const { ids, at } = stageIndexer(stages)
  const t = at(stage)
  const later = new Set()
  for (const id of ids.slice(t)) for (const n of productsOfStage(stages[id])) later.add(n)
  const carried = isPlainObject(before.rework_base) ? before.rework_base : {}
  const expected = {}
  const unchecked = []
  const seen = new Set()
  ids.forEach((id, i) => {
    for (const n of productsOfStage(stages[id])) {
      if (seen.has(n)) continue
      seen.add(n)
      if (!later.has(n)) {
        if (i < t && Object.hasOwn(carried, n) && (isSha(carried[n]) || carried[n] === ACCEPTED)) expected[n] = carried[n]
        continue
      }
      const d = diskSha(n)
      if (!d || !d.exists) continue
      if (isSha(d.sha)) expected[n] = d.sha
      else unchecked.push(n)
    }
  })
  return { expected, unchecked }
}

function decideAtRestart({ before, after, stages, diskSha, restart }) {
  const { expected, unchecked } = expectedAtRestart({ before, stages, stage: restart.stage, diskSha })
  const notes = unchecked.length ? [`rework_base：${names(unchecked)} 在磁盘上但读不出来，回退快照不核它们`] : []
  const ab = after.rework_base
  const want = Object.keys(expected)
  if (ab === undefined && want.length === 0) return { ok: true, notes }
  // 复核（真实会话）改的：所在段不晚于写入后 stage、在快照里的产物，回退这一次就可以标 "accepted"。原来只许照磁盘记 sha——
  // 可是回退落盘之后紧接着再写一次只改那一条是放行的（decideCarry），两条路落盘的状态一模一样，这条限制挡不住任何东西，
  // 只让「用户回退时就说了不用改」的那一次写入多被拒一次。口径与 decideCarry 的 accepted 同一个（写入后的 stage），补记也覆盖。
  const stageOf = stageOfProduct(stages)
  const cur = stageIndexer(stages).at(after.stage)
  // M4a（docs/35）：验证段的产物不论在哪一段都不许标——回退那一次写入与之后的写入同一条（mayAcceptProduct）。
  const mayAccept = (n) => {
    const i = stageOf.has(n) ? stageOf.get(n) : -1
    return i >= 0 && cur >= 0 && i <= cur && mayAcceptProduct(stages, n)
  }

  const missing = []
  const wrong = []
  const extra = []
  if (isPlainObject(ab)) {
    for (const n of want) {
      if (!Object.hasOwn(ab, n)) missing.push(n)
      else if (ab[n] !== expected[n] && !(ab[n] === ACCEPTED && isSha(expected[n]) && mayAccept(n))) wrong.push(n)
    }
    for (const k of Object.keys(ab)) {
      if (Object.hasOwn(expected, k)) continue
      if (unchecked.includes(k) && (isSha(ab[k]) || (ab[k] === ACCEPTED && mayAccept(k)))) continue
      extra.push(quote(k))
    }
    if (!missing.length && !wrong.length && !extra.length) return { ok: true, notes }
  } else {
    missing.push(...want)
  }

  const diff = []
  if (!isPlainObject(ab)) diff.push(ab === undefined ? 'rework_base 没写。' : 'rework_base 不是一个对象。')
  if (missing.length) diff.push(`缺：${names(missing)}。`)
  if (wrong.length) diff.push(`值不对：${names(wrong)}。`)
  if (extra.length) diff.push(`多出：${names(extra)}。`)
  const lines = [
    `这次写入记了一次回退（history 新追加的 ${quote(restart.stage)} 在阶段链上不晚于它前一条），同一次写入要在 rework_base ` +
      `里记下回退那一刻磁盘上各份产物的 sha——之后交没交、齐没齐，门禁靠它分辨哪些产物还是上一轮的。` +
      `${quote(restart.stage)} 及之后各段在磁盘上的产物按现在的内容算，更早各段的条目从写入前原样带过来；` +
      `这一轮接受原样的，回到的那一段及更早段（不晚于这次写入后的 stage）的产物这一次就可以写成 "accepted"，还没走到的段的不行，` +
      `验证段的产物也不行。`,
    diff.join(''),
    'rework_base 应当整份写成：',
    safeJson(expected),
  ]
  if (unchecked.length) lines.push(`${names(unchecked)} 在磁盘上但读不出来，不核：不写、或写成一个 sha 都行。`)
  const verifyMarked = isPlainObject(ab) ? Object.keys(ab).filter((k) => ab[k] === ACCEPTED && !mayAcceptProduct(stages, k)) : []
  if (verifyMarked.length) lines.push(`${names(verifyMarked.map((k) => quote(k)))}：${VERIFY_REDO}。`)
  if (typeof before.stage === 'string' && restart.stage === before.stage) {
    // 同一段再追加一条：原地重来，或者 PM 把同段重派误记成了回退。H6 分不出这两样，判定不变，只提醒一句（/at「回退」末尾）。
    lines.push(SAME_STAGE_HINT)
  }
  if (restart.followedByForward) {
    lines.push(
      '这次写入在回退那一条之后还追加了前进的条目（补记）：上面的值照磁盘现在的内容算，回退之后已经重写过的产物也会被记成' +
        '上一轮的；它们确是这一轮写的，就把它们的值写成 "accepted"（不晚于这次写入后 stage 的，这一次就可以；验证段的产物除外，' +
        '它们要再出一次）。这次写入还会照推进核回到的那一段到写入后 stage 之前的各段：那几段里还是上一轮的、没标的，同样会被拦；' +
        '补记跨过验证段的一律过不了——拆开写，先只记回退。',
    )
  }
  return { ok: false, reason: lines.join('\n') }
}

function decideCarry({ before, after, stages }) {
  const bb = before.rework_base
  const ab = after.rework_base
  if (bb !== undefined && !isPlainObject(bb)) {
    return { ok: true, notes: ['rework_base：写入前的值不是对象，这次不核「原样带着」'] }
  }
  if (bb === undefined || Object.keys(bb).length === 0) {
    if (ab === undefined || (isPlainObject(ab) && Object.keys(ab).length === 0)) return { ok: true, notes: [] }
    return {
      ok: false,
      reason:
        'rework_base 只在记回退的那一次写入里写（history 新追加一条在阶段链上不晚于它前一条的条目）。这次写入没有记回退，' +
        '写入前也没有快照，rework_base 只许不写或写成 {}。要回退，就在同一次写入里把回退记进 history。',
    }
  }
  const show = () => `写入前是：\n${safeJson(bb)}`
  const stageOf = stageOfProduct(stages)
  // 写入前就坏了的条目（值既不是 sha 也不是 "accepted"，或键不是任何阶段的产物）：只能经几条跳过路径落盘（写入前读不出来、
  // 阶段链读不出来、写入前不是对象），落了盘 validateState 每次记账都叫 PM 改掉它——这里再要求原样带着，两道门禁的指令就
  // 互相矛盾，只剩再记一次回退。它们让不了任何产物变成上一轮的（isStale 只认合法 sha、只对产物名问），删掉或标 "accepted"
  // 与现状等价，放开这两样；改成 sha 不开放（那是收紧，下一次回退自然会重拍）。
  const broken = (k) => !stageOf.has(k) || !(isSha(bb[k]) || bb[k] === ACCEPTED)
  const anyBroken = Object.keys(bb).some(broken)
  const head =
    'rework_base 记着回退快照里各份产物的 sha（最近一次回退回到的那一段及之后各段按那一刻的磁盘记，更早各段沿用更早那次快照），' +
    '回退之后、下一次回退之前的每一次写入都要原样带着它；只许把当前段及更早段的某一条从 sha 改成 "accepted"（这一轮接受它原样），' +
    '验证段的产物除外。' +
    (anyBroken ? '写入前就坏了的条目（值不合法、或不是任何阶段的产物）可以删掉或标 "accepted"。' : '')
  if (!isPlainObject(ab)) {
    if (ab === undefined && Object.keys(bb).every(broken)) return { ok: true, notes: [] }
    return { ok: false, reason: `${head}这次写入里它${ab === undefined ? '没写' : '不是一个对象'}。${show()}` }
  }
  const missing = Object.keys(bb).filter((k) => !Object.hasOwn(ab, k) && !broken(k))
  const extra = Object.keys(ab).filter((k) => !Object.hasOwn(bb, k))
  if (missing.length || extra.length) {
    const parts = []
    if (missing.length) parts.push(`少了 ${names(missing.map((k) => quote(k)))}`)
    if (extra.length) parts.push(`多了 ${names(extra.map((k) => quote(k)))}`)
    return { ok: false, reason: `${head}这次写入里它${parts.join('，')}。${show()}` }
  }
  const { at } = stageIndexer(stages)
  const cur = at(after.stage)
  const tooLate = []
  const verify = []
  const bad = []
  for (const k of Object.keys(bb)) {
    // 删掉的只剩坏条目（合法条目少了，上面已经拒了）。
    if (!Object.hasOwn(ab, k)) continue
    if (ab[k] === bb[k]) continue
    if (broken(k)) {
      if (ab[k] !== ACCEPTED) bad.push(quote(k))
      continue
    }
    if (isSha(bb[k]) && ab[k] === ACCEPTED) {
      // M4a（docs/35）：验证段的产物不许标——问题 B：回到 S5 修了后端，门禁自己把「06-test.md 标 accepted」列成出路，标了之后
      // at-qa 不重测就停下，没测过的改动进了验收。
      if (!mayAcceptProduct(stages, k)) {
        verify.push(quote(k))
        continue
      }
      const i = stageOf.has(k) ? stageOf.get(k) : -1
      if (i >= 0 && cur >= 0 && i <= cur) continue
      tooLate.push(quote(k))
      continue
    }
    bad.push(quote(k))
  }
  if (verify.length) return { ok: false, reason: `${head}${names(verify)}：${VERIFY_REDO}。${show()}` }
  if (tooLate.length) {
    return {
      ok: false,
      reason:
        `${head}${names(tooLate)} 不在当前段（${quote(after.stage)}）或更早的段里：还没走到的段，它的产物这一轮还没轮到，` +
        `不能先接受。${show()}`,
    }
  }
  if (bad.length) return { ok: false, reason: `${head}这次写入改了 ${names(bad)} 的值。${show()}` }
  return { ok: true, notes: [] }
}

function decideAdvance({ before, after, stages, diskSha, dispatched = null }) {
  const { ids, at } = stageIndexer(stages)
  const from = at(before.stage)
  const to = at(after.stage)
  if (from < 0 || to <= from) return { ok: true, notes: [] }
  const sids = ids.slice(from, to)
  // 第 17 条：离开的各段里要求在的产物（advance.mjs 的 departureNeeds：叫到的产者那几份、固定的产物，裁掉的不算）缺的、空文件的，
  // 与「有 stage_roles 却没记这一段」。读不出来的不拦，留痕。
  const probe = (name) => {
    const d = diskSha(name)
    if (!d || !d.exists) return 'missing'
    if (!isSha(d.sha)) return 'unreadable'
    if (d.blank || d.sha === EMPTY_SHA) return 'empty'
    return 'ok'
  }
  const dep = departureBlockers({ stages, sids, state: after, prior: before, probe, dispatched })
  const gone = new Set(dep.blockers.map((b) => b.name))
  const ab = after.rework_base
  const stale = []
  const unreadable = []
  const seen = new Set()
  if (isPlainObject(ab)) {
    for (const id of sids) {
      for (const n of productsOfStage(stages[id])) {
        if (seen.has(n)) continue
        seen.add(n)
        if (!Object.hasOwn(ab, n) || !isSha(ab[n]) || gone.has(n)) continue
        const d = diskSha(n)
        if (!d || !d.exists) continue
        if (!isSha(d.sha)) unreadable.push(n)
        else if (d.sha === ab[n]) stale.push(n)
      }
    }
  }
  const notes = unreadable.length ? [`rework_base：${names(unreadable)} 在磁盘上但读不出来，推进时不核它们新旧`] : []
  const depUnreadable = dep.unreadable.filter((n) => !unreadable.includes(n))
  if (depUnreadable.length) notes.push(`推进：${names(depUnreadable)} 在磁盘上但读不出来，推进时不核它们在不在`)
  if (!stale.length && !dep.blockers.length && !dep.unrecorded.length) return { ok: true, notes }
  // M4a（docs/35）：验证段的产物不给「标 accepted」这条路（splitByAccept / mayAcceptProduct，与 decideCarry 同一个口径）。
  const outs = []
  if (stale.length) {
    const { accept, redo } = splitByAccept(stages, stale)
    if (accept.length) {
      outs.push(
        `${names(accept)}：两条出路——让它的产者这一轮重写之后再推进；这一轮接受它原样，就在推进的同一次 Write 里把它在 ` +
          `rework_base 里的值改成 "accepted"。`,
      )
    }
    if (redo.length) outs.push(`${names(redo)}：${VERIFY_REDO}，之后再推进。`)
  }
  const staleText = stale.length
    ? `离开的段里还有上一轮的产物（磁盘内容与 rework_base 记的 sha 相同）：${names(stale)}。${outs.join('')}`
    : ''
  if (!dep.blockers.length && !dep.unrecorded.length) {
    // 只有还旧的：文案与第 17 条之前逐字相同。
    return {
      ok: false,
      stale: true,
      reason: `从 ${quote(before.stage)} 推进到 ${quote(after.stage)}，但${staleText}`,
    }
  }
  const lines = [
    `从 ${quote(before.stage)} 推进到 ${quote(after.stage)}，离开的 ${sids.join('、')} 还没交齐——推进要离开的那一段这一趟叫到的产者各自那几份、` +
      '这一段固定的产物都在、不是空文件（裁掉的不算，标了 "accepted" 的算交了）：',
    ...departureLines(stages, dep.blockers, dep.unrecorded),
  ]
  if (staleText) lines.push(staleText)
  lines.push('补齐之后再推进；这一段的账照常在推进的同一次 Write 里记。')
  return { ok: false, stale: stale.length > 0, reason: lines.join('\n') }
}

/**
 * H6 对 rework_base 的写时判据（M3y）。规则见上面这一节的说明。
 * @param {{ before: object|null, after: object, stages: object|null, diskSha: (name: string) => { exists: boolean, sha: string|null } }} args
 * @returns {{ ok: true, notes: string[] } | { ok: false, reason: string }}
 */
// dispatched：门禁派发记录里每一段派出去过的角色（{ 段: [角色] }，可选）——推进判「这一段叫过谁」时并上它（advance.mjs 的 calledIn）。
export function decideReworkBase({ before, after, stages, diskSha, dispatched = null }) {
  if (!isPlainObject(before) || !isPlainObject(after)) return { ok: true, notes: [] }
  if (!isStageChain(stages)) return { ok: true, notes: ['rework_base：阶段链读不出来或形状不对，回退快照的几条判据这次跳过'] }
  const restart = restartInfo({ before, after, stages })
  if (restart) {
    // M4a 复核（B-1）：一次写入追加了不止一条回退（[S5, S7, S7]）：快照只拍最后那条，前面那截往前记的不经任何推进核查。
    if (appendedRestarts({ before, after, stages }) > 1) {
      return {
        ok: false,
        reason:
          '一次 Write 只记一次回退：这次 history 新追加的条目里有不止一条在阶段链上不晚于它前一条。先单独记最早的那次回退' +
          '（stage 写成回到的那一段，rework_base 照那一刻的磁盘拍），之后要推进再分开写，每一段推进各一次 Write。',
      }
    }
    // M4d 复核（docs/38 §3）：回退（或原地重来）那一条之前，同一次写入先往前记了几段——「先推进、再原地重来」（[S6, S6]、[S6, S7, S8, S8]）
    // 被认成一次回退，一次只推一段与离开那一段的核查一起跳过；PM 无心把 S6 追加两遍、照判据③补 rework，也就这样推过去了。
    // 往前的那一截照推进核：从写入前的 stage 到那一截走到的最远段。
    {
      const idx = stageIndexer(stages)
      const from = idx.at(before.stage)
      const ha = historyOf(after)
      let reach = from
      for (let j = historyOf(before).length; j < restart.index; j++) {
        const k = isPlainObject(ha[j]) ? idx.at(ha[j].stage) : -1
        if (k > reach) reach = k
      }
      if (from >= 0 && reach > from) {
        const mid = { ...after, stage: idx.ids[reach] }
        const lead = `这次写入在回退（或原地重来）那一条之前，先往前记到了 ${quote(idx.ids[reach])}：往前那一截照推进核——`
        const single = decideSingleStep({ before, after: mid, stages })
        if (!single.ok) return { ok: false, reason: lead + single.reason }
        const fwd = decideAdvance({ before, after: mid, stages, diskSha, dispatched })
        if (!fwd.ok) return { ok: false, reason: lead + fwd.reason }
      }
    }
    const at = decideAtRestart({ before, after, stages, diskSha, restart })
    if (!at.ok || !restart.followedByForward) return at
    // M4a 复核（B-2、P8）：补记跨过验证段——快照照写入那一刻的磁盘拍，区间里的产物按定义都是「上一轮的」，验证段的又不能标
    // accepted：这样的写入永远过不了，照推进核的理由（「让产者重跑之后再推进」）照做是死循环。直接拒，叫它拆开。
    const ids = Object.keys(stages)
    const span = ids.slice(ids.indexOf(restart.stage), ids.indexOf(after.stage))
    // 复核二（G4）：只算快照里真有产物的验证段——整段裁掉了 at-qa、at-acceptance 的，那一段没有产物，交给推进核查。
    const snap = isPlainObject(after.rework_base) ? after.rework_base : {}
    const crossed = span.filter((id) => isVerifyStage(stages[id]) && productsOfStage(stages[id]).some((n) => isSha(snap[n])))
    if (crossed.length) {
      return {
        ok: false,
        reason:
          `这次写入记了回退（回到 ${quote(restart.stage)}）又往前记到了 ${quote(after.stage)}（补记），跨过了验证段 ${crossed.join('、')}：` +
          '快照照这一刻的磁盘拍，区间里的产物都算上一轮的，验证段的产物又不能标 "accepted"，这样的一次写入怎么写都过不了。' +
          `把它拆开——先只记回退（stage 写成 ${quote(restart.stage)}，history 只追加回退那一条，rework_base 照磁盘），` +
          '验证段的产者这一轮重跑、重写之后再逐段推进，每一段推进各一次 Write。',
      }
    }
    // M4a（docs/35）：补记（回退那一条之后同一次写入又往前记了几段）也是一次推进——离开回到的那一段到写入后 stage 之前的各段。
    // 原来这里不核，一次写入「回到 S3 再记到 S6」就把 S4、S5 这一轮整段跳过，推进把关再也不回头查它们（评审 restart-write-accepted）。
    const adv = decideAdvance({ before: { ...before, stage: restart.stage }, after, stages, diskSha, dispatched })
    if (!adv.ok) {
      return {
        ok: false,
        reason:
          `这次写入记了回退（回到 ${quote(restart.stage)}）又往前记到了 ${quote(after.stage)}（补记），照推进核离开的段：` +
          adv.reason +
          (adv.stale
            ? '补记这一次快照照磁盘拍，回退之后重写过的也算上一轮的：确是这一轮重写过的、或者这一轮接受原样的，同一次 Write 标 "accepted"；' +
              '要它的产者真改的，这次只记到它所在段之前（或者只记回退），重写之后再推进。'
            : ''),
      }
    }
    return { ok: true, notes: [...at.notes, ...adv.notes] }
  }
  const carry = decideCarry({ before, after, stages })
  if (!carry.ok) return carry
  // 第 17 条：一次只推进一段（advance.mjs）。排在「原样带着」之后：rework_base 的错（例：跳段时把验证段的产物标 accepted）先说。
  const single = decideSingleStep({ before, after, stages })
  if (!single.ok) return single
  const advance = decideAdvance({ before, after, stages, diskSha, dispatched })
  if (!advance.ok) return advance
  return { ok: true, notes: [...carry.notes, ...advance.notes] }
}
