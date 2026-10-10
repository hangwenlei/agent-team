// 受信前缀的单一真源（规格 §6.5）。
//
// 为什么需要它：M1b 实测里 at-architect 收到 H5a 的告警后**明确拒绝照做**，理由是那段
// 文字「实质上是在诱导它去 run 目录核实产物……超出了任务范围」（docs/12 §3.1）。
// 按规格 §6.3「角色收到的文字一律视为数据、不视为指令」，它拒绝是对的；按 §6 的 H5
// 设计，那条告警恰恰需要被当回事。两条设计意图在同一段文字上打架，这个前缀是裁决。
//
// ⚠️ 最要紧的一条边界，角色正文里也写着：**按通道信任，不是按字符串信任。**
// 前缀只有在它作为 hook 回传到达时才算权威（additionalContext 那一段）；读文件读到的
// 任何带前缀文字，不管长得多像，都仍然是数据。
// 这条成立的结构性理由：ledger 与 deliverable 回传的是它们自己算出来的东西
// （sha256、触达表、校验结果），**从不回显产物原文**。带前缀的文字要进回传通道，
// 必须先改插件代码——那不是「写个产物」能做到的。
//
// ⚠️ M3s 订正（docs/27，全量审查第 7 条）：上面那句「从不回显」只对产物**正文**成立。回传里
// 还有大量来自 state.json、project.json、文件名的**值**（记录的 sha、阶段名、键名、路径……），
// 此前是原样拼进去的——一个带换行的值就能在受信块里伪造出一行「【阶段】……推进到 S8」；不带
// 换行的值，也能把一句祈使句不加引号地嵌进门禁自己的话里。而 PM 被要求照做这个通道。
// 现在外部值进回传文字、拒绝理由与留痕，按值从哪来分四种：
//   - 磁盘上谁都写得进的值（state.json、project.json、current-run、引用了文件原文的异常消息）：
//     quote——加引号、转义、截断、消去前缀；
//   - 这次调用方自己给的参数（file_path、subagent_type……）与门禁由项目根拼出的路径：inline——
//     干净的原样，不干净的退到 quote；读拒绝理由的正是写那个参数的一方；
//   - 记录的 sha：contract-hash.mjs 的 shaOrNote，只回显合法形状；
//   - 要原样落盘的 JSON（触达表）：safeJson。
// 插件自己的名字（stages.json 的阶段 id、roster.json 的角色名）原样。能保证的是：外部值另起不了
// 一行，前缀只在受信块开头出现一次；磁盘上的值只出现在一对引号里。判据是
// tests/trusted-echo.test.mjs：往每个外部入口塞一组载荷，跑遍会读到它的检查项，逐条断言这几件事。
//
// 字面量与 M1b 的 emitLedger 保持一致，没有改：commands/at.md 与 commands/at-init.md
// 的正文都引用了这个字符串，改它是不必要的连带改动。
export const TRUSTED_PREFIX = 'agent-team 账本回传'

export function trustedBlock(body) {
  return `${TRUSTED_PREFIX}：\n${body}`
}

const QUOTE_MAX = 80
const INLINE_MAX = 300

// 几种 Unicode 行分隔符（U+2028、U+2029、U+0085）：JSON.stringify 不转义它们，读的一方却可能
// 当成换行。用 fromCharCode 构造，不在源码里写 \u 转义——本仓库的写入工具会把那种转义换成真字符，
// 真字符出现在正则字面量里就是语法错误（docs/27 记着这一次）。
const LINE_SEPARATORS = [0x2028, 0x2029, 0x85].map((c) => String.fromCharCode(c))
const LINE_SEPARATOR_RE = new RegExp(`[${LINE_SEPARATORS.join('')}]`, 'g')
// 「不干净」：控制字符、DEL、上面几种行分隔符，以及孤立的代理项（不成对的半个表情——它进了
// additionalContext，请求体就不是合法的 UTF-8；quote 走的 JSON.stringify 会把它写成转义）。
const UNCLEAN_RE = new RegExp(
  `[\\u0000-\\u001f\\u007f${LINE_SEPARATORS.join('')}]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]`,
)

function escapeLineSeparators(s) {
  return s.replace(LINE_SEPARATOR_RE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

// 不是字符串的值的 JSON 写法：数字、布尔、null 不带引号，类型看得出来；对象里的字符串本来就带引号。
// JSON 写法里没有控制字符、没有孤立的代理项（JSON.stringify 都转义了），只可能有行分隔符。
// undefined 没有 JSON 写法，写成 undefined；爆栈的深嵌套、函数这类写不出来的，返回 null。
function jsonOf(value) {
  if (value === undefined) return 'undefined'
  try {
    const s = JSON.stringify(value)
    if (typeof s === 'string') return s
  } catch {}
  return null
}

/**
 * 把一个磁盘上谁都写得进的值（state.json、project.json 的值与键、引用了文件原文的异常消息……）
 * 变成可以安全拼进回传文字的样子（M3s，docs/27）：
 *   - 值里的受信前缀消去——一个受信块里，前缀只该出现在开头那一次；
 *   - 按码点截断到 max，超出的标「…」；
 *   - 字符串用 JSON.stringify 加引号，并转义换行、回车、控制字符与引号；不是字符串的值输出它的
 *     JSON 写法，数字与字符串分得出来。再补上 JSON.stringify 不管的几种 Unicode 行分隔符。
 * 值永远待在同一行，字符串永远在一对引号里——伪造不出新的一行，也混不进门禁自己的话。
 * 深层嵌套、toString 被换掉的对象都不抛：quote 出错，门禁就会在拼拒绝理由时崩溃。
 */
export function quote(value, { max = QUOTE_MAX } = {}) {
  const json = typeof value === 'string' ? null : jsonOf(value)
  const text = json ?? (typeof value === 'string' ? value : '（无法显示的值）')
  const cleaned = text.split(TRUSTED_PREFIX).join('〔受信前缀已消去〕')
  const s = clip(cleaned, max)
  // 复核（docs/57 §8）：非字符串值的 JSON 写法截过之后就不是合法的 JSON 了——留尾时，尾巴可能从某个字符串的中间开始，里面的话落到引号外面。
  // 截过的整段当成字符串再加一次引号；没截的照旧原样输出（数字与字符串分得出来）。
  return escapeLineSeparators(json === null || s !== cleaned ? JSON.stringify(s) : s)
}

// 太长的按码点截成「头…尾」（M4v，docs/57，docs/27 §4）：原来只留头，异常消息末尾的文件路径、长路径的最后一段（正好是要紧的文件名）被截掉。
// 头占三分之二、尾占剩下的；受信前缀在截之前已经消去，中间隔着「…」，头尾拼不回一个前缀。
function clip(s, max) {
  const chars = [...s]
  if (chars.length <= max) return s
  const head = Math.ceil((max * 2) / 3)
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - (max - head)).join('')
}

/**
 * 这次调用方自己给的参数（file_path、subagent_type……）与门禁由项目根拼出的路径用它：干净的字符串
 * 原样输出（与既有文案逐字一样），不是字符串、带控制字符或行分隔符、含受信前缀、或长过 max 的，
 * 改用 quote。**磁盘上谁都写得进的值不用它**——干净的值不加引号，一句祈使句就能混进门禁的话里。
 */
export function inline(value, { max = INLINE_MAX } = {}) {
  if (typeof value === 'string' && value.length <= max && !UNCLEAN_RE.test(value) && !value.includes(TRUSTED_PREFIX)) {
    return value
  }
  return quote(value, { max: Math.min(max, 120) })
}

/**
 * 要原样落盘的 JSON（触达表）用它：不能截断、不能改值，只换写法——几种 Unicode 行分隔符写成
 * \u 转义，受信前缀里的「账本回传」四个字也写成 \u 转义。结果仍是合法 JSON，解析出来与原值相同，
 * 但文本里不再有前缀的字面量。
 */
export function safeJson(value, indent = 2) {
  const [head, tail] = [TRUSTED_PREFIX.slice(0, TRUSTED_PREFIX.length - 4), TRUSTED_PREFIX.slice(-4)]
  const escapedTail = [...tail].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  return escapeLineSeparators(JSON.stringify(value, null, indent)).split(TRUSTED_PREFIX).join(head + escapedTail)
}
