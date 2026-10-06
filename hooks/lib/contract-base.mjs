// M4j（docs/45，审查第 20 条与 docs/39 §3「契约修订之后，验证段的结论不要求重出」）：门禁专属的契约基线 runs/<id>/contract-base.json。
//
// 契约第 1 节是用户原话（skills/at-contract-format），合法修订只写第 4 节；可第 1 节与用户原话之间没有任何旁证，PM 改写它门禁一声不出。
// 契约修订之后，已经写成的测试报告、验收结论、交付文档对着的是上一版契约，门禁照样当它们交了——M5h 里 haiku 版 PM 修订契约之后没有
// 重派验收，带着一份按旧契约判的验收结论收口。
//
// 门禁记三样（hooks/gate.mjs 的 ledger，PM 写 state.json 与契约之后）：
//   - section1：推进出第一段之后门禁第一次见到 state.json 时，契约第 1 节的正文（之后不再变）；切不出来记 null，第 1 节就不核。
//   - contract_sha：那一刻整份契约的 sha（剥 BOM、折 CRLF，与【产物】同一个算法）。
//   - verify_base：之后 PM 每写一次契约、整份 sha 变了（一次修订），换成那一刻磁盘上验证段（stages.json 里 verifies: true 的段）各份
//     产物的 sha。
// 第 1 节与 section1 不同、验证段的产物与 verify_base 相同（对着上一版契约的结论）：写契约的那一刻【契约】先说；H6 不放行推进与收口
// （decideContractBase）。回退之后 rework_base 接手——回退那一刻的快照会把同样那几份记成上一轮的，现成的判据要它们重出。
// 门禁专属：任何人的 Edit/Write 都拒（control-files.mjs 的 GATE_FILES）；Bash 照样写得进（与 delivered.json 同一档）。读不出、形状不对一律
// 当没有（少拦、不误拦）。
import { SHA_RE, sha256OfContract } from './contract-hash.mjs'
import { isPlainObject, isStageChain, isVerifyStage, producerOfName, productsOfStage } from './stages.mjs'
import { closedAt } from './closing.mjs'
import { isContractWriter } from './contract-guard.mjs'
import { CONTRACT_BASE_FILE } from './control-files.mjs'
import { isBlankText } from './text-norm.mjs'

// 文件名的单一真源在 control-files.mjs（门禁专属文件的登记表）；这里原样再导出。
export { CONTRACT_BASE_FILE }

const BOM = String.fromCharCode(0xfeff)
const HEAD_RE = /^##\s*1[.．、]/
const NEXT_RE = /^##\s/

/** 契约第 1 节（「## 1.」那一行之后、下一个「## 」之前）的正文：剥 BOM、折 CRLF、每行去掉行尾空白、去掉首尾空行。找不到这一节回 null。 */
export function section1Of(text) {
  if (typeof text !== 'string') return null
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/)
  const start = lines.findIndex((l) => HEAD_RE.test(l))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && NEXT_RE.test(l))
  if (end < 0) end = lines.length
  const body = lines.slice(start + 1, end).map((l) => l.replace(/\s+$/, ''))
  while (body.length && body[0] === '') body.shift()
  while (body.length && body[body.length - 1] === '') body.pop()
  return body.join('\n')
}

/** 门禁写下的基线：{ section1: string|null, contract_sha: string|null, verify_base: { 产物名: sha } }；读不出、不是对象回 null。 */
export function readContractBase(bytes) {
  if (!bytes) return null
  let v
  try {
    v = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes))
  } catch {
    return null
  }
  if (!isPlainObject(v)) return null
  const verify_base = {}
  if (isPlainObject(v.verify_base)) {
    for (const [k, s] of Object.entries(v.verify_base)) if (typeof s === 'string' && SHA_RE.test(s)) verify_base[k] = s
  }
  return {
    section1: typeof v.section1 === 'string' ? v.section1 : null,
    contract_sha: typeof v.contract_sha === 'string' && SHA_RE.test(v.contract_sha) ? v.contract_sha : null,
    verify_base,
  }
}

/** 验证段（verifies: true）的产物，按阶段链的书写顺序。 */
export function verificationProducts(stages) {
  if (!isStageChain(stages)) return []
  const out = []
  for (const stage of Object.values(stages)) {
    if (!isVerifyStage(stage)) continue
    for (const n of productsOfStage(stage)) if (!out.includes(n)) out.push(n)
  }
  return out
}

/** 推进出第一段之后第一次：记第 1 节与整份 sha，verify_base 为空。契约读不出来回 null（下一次再记）。 */
export function initialBase(contractBytes) {
  if (!contractBytes) return null
  return { section1: section1Of(contractBytes.toString('utf8')), contract_sha: sha256OfContract(contractBytes), verify_base: {} }
}

/** 一次契约写入之后：整份 sha 没变回 null（不用重写）；变了（一次修订）——verify_base 换成 verifyShas（那一刻磁盘上验证段各份产物的
 * sha，调用方只给在、不是空白的），contract_sha 换新。第 1 节不动。 */
export function revisedBase(base, contractBytes, verifyShas) {
  if (!base || !contractBytes) return null
  const sha = sha256OfContract(contractBytes)
  if (sha === base.contract_sha) return null
  return { section1: base.section1, contract_sha: sha, verify_base: { ...(isPlainObject(verifyShas) ? verifyShas : {}) } }
}

/** 第 1 节变了没有：记下的是字符串，磁盘上的第 1 节与它不同（切不出来了也算）。契约读不出来不算（不误拦）。 */
export function section1Drift(base, contractBytes) {
  if (!base || typeof base.section1 !== 'string' || !contractBytes) return false
  return section1Of(contractBytes.toString('utf8')) !== base.section1
}

const names = (list) => list.join('、')

/** 那一刻磁盘上验证段各份产物的 sha：在、不是空白的才记（空白的本来就不算交了）。读不出来的跳过。 */
export function verifyShasOf({ stages, artifactExists, artifactBytes }) {
  const out = {}
  for (const name of verificationProducts(stages)) {
    try {
      if (!artifactExists(name)) continue
      const bytes = artifactBytes(name)
      if (bytes && !isBlankText(bytes)) out[name] = sha256OfContract(bytes)
    } catch {}
  }
  return out
}

// 第 1 节那一句的前半与出路（H6 的拒绝理由与写契约时的【契约】共用）。段 id 来自阶段链（插件自己的名字），原样。
export function driftHead(stages) {
  const first = isStageChain(stages) ? Object.keys(stages)[0] : '第一段'
  return `契约第 1 节是用户原话，推进出 ${first} 之后门禁记下了它（这一趟 run 目录里的 ${CONTRACT_BASE_FILE}，section1 那一项）`
}
export const DRIFT_FIX = '照它改回去——用户改了需求的，修订写进第 4 节「修订记录」，第 1 节原样留着'

/** 对着上一版契约的那几份怎么重出：有别人的产物，照「回退」记回到它们最早那一段；只剩项目经理自己的（交付文档），重写。 */
export function outdatedFix(stages, outdated) {
  const others = outdated.filter((n) => !isContractWriter(producerOfName(stages, n)?.role))
  if (!others.length) return { rollback: null, text: `${names(outdated)} 是你自己的产物，对着这一版重写` }
  const sid = Object.keys(stages).find((id) => others.some((n) => productsOfStage(stages[id]).includes(n)))
  return { rollback: sid, text: `照 /agent-team:at 第 3 节的「回退」记回到 ${sid}` }
}

/**
 * H6 的契约判据（M4j）：只管推进（stage 往阶段链后面挪）与收口（closed_at 新写上）这两种写入；回退、原地重写、补记别的字段不判。
 *   - 契约第 1 节与 section1 不同 → 拒。
 *   - 对着上一版契约的验证段结论（磁盘内容与 verify_base 记的 sha 相同）：推进时离开的段里有、收口时任何一份还在 → 拒。出路按产者分：
 *     有别人的产物，照「回退」记回到它们最早那一段（回退之后 rework_base 接手）；只剩项目经理自己的（交付文档），对着这一版重写。
 * diskSha(name) → { exists, sha }（与 decideReworkBase 同一个注入）。段 id、产物名都是插件自己的名字（stages.json），原样。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideContractBase({ before, after, stages, base, contractBytes, diskSha }) {
  if (!base || !isPlainObject(before) || !isPlainObject(after) || !isStageChain(stages)) return { ok: true }
  const ids = Object.keys(stages)
  const from = ids.indexOf(before.stage)
  const to = ids.indexOf(after.stage)
  const closing = closedAt(after) !== null && closedAt(before) === null
  const advancing = from >= 0 && to > from
  if (!closing && !advancing) return { ok: true }
  const act = closing ? '收口' : '推进'
  const parts = []
  if (section1Drift(base, contractBytes)) {
    parts.push(`${driftHead(stages)}；现在磁盘上的第 1 节跟它不一样。${DRIFT_FIX}——再${act}。`)
  }
  const vb = isPlainObject(base.verify_base) ? base.verify_base : {}
  const outdated = verificationProducts(stages).filter((name) => {
    if (!Object.hasOwn(vb, name)) return false
    const d = diskSha(name)
    return !!d && d.exists && d.sha === vb[name]
  })
  const departing = closing ? null : new Set(ids.slice(from, to).filter((id) => isVerifyStage(stages[id])).flatMap((id) => productsOfStage(stages[id])))
  const blocking = closing ? outdated : outdated.filter((n) => departing.has(n))
  if (blocking.length) {
    const fix = outdatedFix(stages, outdated)
    parts.push(
      fix.rollback
        ? `契约在 ${names(outdated)} 写成之后改过（门禁在那次修订时记下了它们）——它们对着的是上一版契约。${fix.text}，让它们的产者对着这一版重出，再${act}。`
        : `契约在 ${names(outdated)} 写成之后改过——${fix.text}，再${act}。`,
    )
  }
  return parts.length ? { ok: false, reason: parts.join('\n') } : { ok: true }
}
