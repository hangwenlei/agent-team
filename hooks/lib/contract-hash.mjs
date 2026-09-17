// 契约哈希（纯函数）。规格 §4.2 ①：S1 把用户原话固化为 00-contract.md 并记录
// sha256，S7 验收前校验哈希未变。防的是十角色链最隐蔽的失效——走到第八个角色时
// 无人记得用户当初要什么。
//
// 这个模块只做**算**与**比**。S7 的校验门禁属 M2（S7 在 M1 里不存在）；M1b 里哈希的
// 作用是记录与漂移告警，由 hooks/lib/ledger.mjs 消费。
//
// 为什么先归一化再哈希（剥 UTF-8 BOM、\r\n → \n）：00-contract.md 是一个会进 git、
// 会在 Windows 与 POSIX 之间来回的文本文件，core.autocrlf 一次 checkout 就能让字节变
// 而语义不变。不归一化的话哈希会在没有任何人改契约的情况下漂移，「哈希变了」这个信号
// 立刻贬值成噪音，真正的漂移就淹没在里面。代价是 CRLF↔LF 的变化检测不到——那不是语义
// 漂移，正是要忽略的。
//
// 只替换成对的 \r\n，不碰孤立的 \r：那种字符在正文里是真实内容（老 Mac 行尾在这个
// 项目里不会出现，但一个被当成数据粘进来的字符串可能含它），抹掉它就是抹掉语义。
import { createHash } from 'node:crypto'

export function normalizeContract(buf) {
  let s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  return s.replace(/\r\n/g, '\n')
}

export function sha256OfContract(buf) {
  return 'sha256:' + createHash('sha256').update(normalizeContract(buf), 'utf8').digest('hex')
}

/**
 * recorded：state.json 里记的值（'PENDING' 表示还没记）。
 * actual：磁盘上 00-contract.md 算出来的值，契约文件不存在时传 null。
 */
export function compareContractSha({ recorded, actual }) {
  if (actual === null || actual === undefined) {
    if (recorded === 'PENDING') return { ok: true }
    return {
      ok: false,
      problem:
        `state.json 记着 contract_sha ${recorded}，但磁盘上没有 00-contract.md。` +
        `契约是这趟 run 唯一的需求基线，它不在了，后面每一步都失去了对账的依据。`,
    }
  }
  if (recorded === 'PENDING') {
    return {
      ok: false,
      problem:
        `契约的 sha256 是 ${actual}，state.json 里还没有记（contract_sha 仍是 PENDING）。` +
        `把这个值原样写进 state.json 的 contract_sha——不要自己拼一个。`,
    }
  }
  if (recorded === actual) return { ok: true }
  return {
    ok: false,
    problem:
      `契约漂移：磁盘上 00-contract.md 的 sha256 是 ${actual}，state.json 记的是 ${recorded}。` +
      `契约可以改，但只能由用户改、经 PM 转写，而且按规格 §5.3，每次改动都要在 escalations[] ` +
      `里留一条记录、并作为带日期的修订块追加进契约。如果这次改动是合法的，把新值写进 ` +
      `contract_sha 并补上 escalations 记录；如果不是，把契约恢复原样。`,
  }
}
