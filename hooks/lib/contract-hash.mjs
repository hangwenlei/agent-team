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
import { normalizeText } from './text-norm.mjs'

// 归一化本身在 text-norm.mjs（M3r 抽出去的单一真源，理由见那里）；这个名字留着，是契约这一侧的调用点。
export function normalizeContract(buf) {
  return normalizeText(buf)
}

// sha 串长什么样的单一真源——sha256OfContract 产出的就是这个形状。state.mjs 的 validateState
// 拿它校验，shaOrNote 拿它决定能不能回显（M3s 从 state.mjs 挪过来：回显侧要用、又不能反过来
// 让 state.mjs 与 trusted.mjs 互相引用）。
export const SHA_RE = /^sha256:[0-9a-f]{64}$/

// M4c（docs/37，全量审查第 37 条前半）：契约文件名的单一真源（H4 的契约门禁、ledger 认契约、H5a 与写 state.json 时的契约核对、账本
// 比对把它排除在外，都从这里取）。判据钉着它等于 stages.json 第一段唯一的产物。
export const CONTRACT_FILE = '00-contract.md'

/**
 * 记录下来的 sha 值要进回传文字时用它（M3s，docs/27，全量审查第 7 条）：合法的 sha256 与
 * 'PENDING' 原样回显，其余一概不回显原值，只说它不合法——那个值是写得进 state.json 的任何人
 * 都能写的，原样回显就是让他往受信通道里塞字。
 */
export function shaOrNote(value) {
  if (value === 'PENDING' || (typeof value === 'string' && SHA_RE.test(value))) return value
  return '（不是合法的 sha256，原值不回显）'
}

export function sha256OfContract(buf) {
  return 'sha256:' + createHash('sha256').update(normalizeContract(buf), 'utf8').digest('hex')
}

/**
 * recorded：state.json 里记的值（'PENDING' 表示还没记）。
 * actual：磁盘上 00-contract.md 算出来的值，契约文件不存在时传 null。
 *
 * M4c（docs/37）：「contract_sha 与磁盘」唯一的比较函数，多返回一个结构化的 kind（ok / unstarted / pending / missing / drift）。
 * problem 是写契约那一刻的【契约】用的（带磁盘上的新值：合法修订记账的唯一来源）；派发返回与写 state.json 时的【契约】按 kind
 * 另组措辞、不报磁盘上的值（hooks/lib/ledger.mjs 的 contractCheckNotice）。
 */
export function compareContractSha({ recorded, actual }) {
  if (actual === null || actual === undefined) {
    if (recorded === 'PENDING') return { ok: true, kind: 'unstarted' }
    return {
      ok: false,
      kind: 'missing',
      problem:
        `state.json 记着 contract_sha ${shaOrNote(recorded)}，但磁盘上没有 00-contract.md。` +
        `契约是这趟 run 唯一的需求基线，它不在了，后面每一步都失去了对账的依据。`,
    }
  }
  if (recorded === 'PENDING') {
    return {
      ok: false,
      kind: 'pending',
      problem:
        `契约的 sha256 是 ${actual}，state.json 里还没有记（contract_sha 仍是 PENDING）。` +
        `把这个值原样写进 state.json 的 contract_sha——不要自己拼一个。`,
    }
  }
  if (recorded === actual) return { ok: true, kind: 'ok' }
  return {
    ok: false,
    kind: 'drift',
    problem:
      `契约漂移：磁盘上 00-contract.md 的 sha256 是 ${actual}，state.json 记的是 ${shaOrNote(recorded)}。` +
      `契约可以改，但只能由用户改、经 PM 转写，而且按规格 §5.3，每次改动都要在 escalations[] ` +
      `里留一条记录、并作为带日期的修订块追加进契约。如果这次改动是合法的，把新值写进 ` +
      `contract_sha 并补上 escalations 记录；如果不是，把契约恢复原样。`,
  }
}
