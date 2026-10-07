// M4j（docs/45，审查第 20 条与 docs/39 §3「契约修订之后，验证段的结论不要求重出」）：门禁专属的契约基线 runs/<id>/contract-base.json。
//
// 契约第 1 节是用户原话（skills/at-contract-format），合法修订只写第 4 节；可第 1 节与用户原话之间没有任何旁证，PM 改写它门禁一声不出。
// 契约修订之后，已经写成的测试报告、验收结论、交付文档对着的是上一版契约，门禁照样当它们交了——M5h 里 haiku 版 PM 修订契约之后没有
// 重派验收，带着一份按旧契约判的验收结论收口。
//
// 门禁记下（hooks/gate.mjs 的 ledger，PM 写 state.json 与契约之后）：
//   - section1：推进出第一段之后门禁第一次见到 state.json 时，契约第 1 节的正文（之后不再变）；切不出来记 null，第 1 节就不核。
//   - body_sha：契约去掉第 1 节、不计行尾空白之后的指纹——一次修订是它变了（复核 F2：改第 1 节、照提示改回去都不算修订，第 1 节的变化
//     只归第 1 节那条判据管）。revisions：第 4 节里修订块的标题。
//   - verify_base、revised_at：一次改需求的修订那一刻，磁盘上验证段（stages.json 里 verifies: true 的段）各份产物的 sha，与那一刻（门禁的钟）。
//     新加的修订块全是不改需求的答复（ADMIN_KINDS，复核 F3：环境阻塞「照现状交付」、敏感操作批准、返工预算）的，只换指纹，不重拍。
// 对着上一版契约的结论（outdatedProducts）：内容跟 verify_base 一样的，或者修订之前就派出去、门禁没见它在修订之后再被派的（复核 F4：
// 修订那一刻还在跑的验证段角色，它交的同样是旧契约下的结论）。第 1 节变了、有对着上一版契约的结论：写契约的那一刻【契约】先说；H6 不放行
// 推进与收口（decideContractBase），【阶段】的收口阻碍里同样列它（复核 F6）。回退之后 rework_base 接手。
// 门禁专属：任何人的 Edit/Write 都拒（control-files.mjs 的 GATE_FILES）；Bash 照样写得进（与 delivered.json 同一档）。读不出、形状不对一律
// 当没有基线（少拦、不误拦），调用方留痕（复核 F7）。
import { SHA_RE, sha256OfContract } from './contract-hash.mjs'
import { isPlainObject, isStageChain, isVerifyStage, producerOfName, productsOfStage } from './stages.mjs'
import { closedAt } from './closing.mjs'
import { isContractWriter } from './contract-guard.mjs'
import { CONTRACT_BASE_FILE } from './control-files.mjs'
import { isBlankText } from './text-norm.mjs'

// 文件名的单一真源在 control-files.mjs（门禁专属文件的登记表）；这里原样再导出。
export { CONTRACT_BASE_FILE }

// 不改需求的答复：修订块标题里 kind 是这几类、而且这次新加的修订块全是这几类时，验证段的结论不用重出。都是 state.mjs 的
// ESCALATION_KINDS 里的类别（判据钉着）；用户主动提出、取舍、契约冲突与缺口的答复，以及认不出类别的，都算改需求。
export const ADMIN_KINDS = ['sensitive', 'env-blocked', 'budget-exhausted']

const BOM = String.fromCharCode(0xfeff)
// 编号节标题：「## 1. 用户原话」「## 4. 修订记录」。第 1 节只在下一个编号节标题处结束（复核 F8：原话里自带「## 安装」这样的行）。
const SECTION_RE = /^##\s*(\d+)\s*[.．、]/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const KIND_RE = /kind\s*[:：]\s*([A-Za-z-]+)/i

const names = (list) => list.join('、')

function linesOf(text) {
  const t = text.startsWith(BOM) ? text.slice(1) : text
  return t.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''))
}

/** 契约的行：剥 BOM、折 CRLF、每行去掉行尾空白。第 1 节、修订指纹与原话核对（user-words.mjs）共用这一份。 */
export function contractLines(text) {
  return linesOf(typeof text === 'string' ? text : '')
}

/** 编号节标题（「## 1. 用户原话」「## 4. 修订记录」）的编号；不是编号节标题回 null。 */
export function numberedHeading(line) {
  const m = typeof line === 'string' ? SECTION_RE.exec(line) : null
  return m ? Number(m[1]) : null
}

/** 第 n 节在 lines 里的 [标题行, 下一个编号节标题)；没有这一节回 null。 */
function sectionRange(lines, n) {
  const start = lines.findIndex((l) => {
    const m = SECTION_RE.exec(l)
    return m !== null && Number(m[1]) === n
  })
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && SECTION_RE.test(l))
  if (end < 0) end = lines.length
  return [start, end]
}

/** 契约第 1 节的正文：剥 BOM、折 CRLF、每行去掉行尾空白、去掉首尾空行。找不到这一节回 null。 */
export function section1Of(text) {
  if (typeof text !== 'string') return null
  const lines = linesOf(text)
  const r = sectionRange(lines, 1)
  if (!r) return null
  const body = lines.slice(r[0] + 1, r[1])
  while (body.length && body[0] === '') body.shift()
  while (body.length && body[body.length - 1] === '') body.pop()
  return body.join('\n')
}

/**
 * 修订指纹：去掉第 1 节的正文（标题行留着）、每行去掉行尾空白、去掉末尾空行之后的 sha。切不出第 1 节就整份算。
 * M4k 复核（中 1）：exclude 里的修订块（第 4 节里标题等于它们的那几块，连标题一起）不计——用掉照现状交付批准的那几块，之后只改它们不算修订。
 */
export function bodyShaOf(text, exclude = []) {
  const lines = linesOf(typeof text === 'string' ? text : '')
  const r = sectionRange(lines, 1)
  let kept = r ? [...lines.slice(0, r[0] + 1), ...lines.slice(r[1])] : lines
  if (Array.isArray(exclude) && exclude.length) kept = withoutBlocks(kept, new Set(exclude))
  while (kept.length && kept[kept.length - 1] === '') kept.pop()
  return sha256OfContract(Buffer.from(kept.join('\n'), 'utf8'))
}

/** 第 4 节里去掉标题在 headings 里的那几块（从它的 ### 行到下一个 ### 行或下一个编号节标题）。没有第 4 节原样返回。 */
function withoutBlocks(lines, headings) {
  const r = sectionRange(lines, 4)
  if (!r) return lines
  const out = lines.slice(0, r[0] + 1)
  let skipping = false
  for (let i = r[0] + 1; i < r[1]; i++) {
    if (lines[i].startsWith('### ')) skipping = headings.has(lines[i])
    if (!skipping) out.push(lines[i])
  }
  return [...out, ...lines.slice(r[1])]
}

/** 第 4 节里修订块的标题（### 开头的行，去掉行尾空白）。没有第 4 节回 []。 */
export function revisionHeadingsOf(text) {
  if (typeof text !== 'string') return []
  const lines = linesOf(text)
  const r = sectionRange(lines, 4)
  return r ? lines.slice(r[0] + 1, r[1]).filter((l) => l.startsWith('### ')) : []
}

/** 修订块标题的类别：模板里的「（kind: <类别>）」；「用户主动提出」记 user-change；认不出回 null。 */
export function headingKind(heading) {
  if (typeof heading !== 'string') return null
  const m = KIND_RE.exec(heading)
  if (m) return m[1].toLowerCase()
  return heading.includes('用户主动提出') ? 'user-change' : null
}

/** 门禁写下的基线；读不出、不是对象回 null。带 BOM 的照样读（复核 F7：PowerShell 5.1 的 Out-File 会写 BOM）。 */
export function readContractBase(bytes) {
  if (!bytes) return null
  let text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes)
  if (text.startsWith(BOM)) text = text.slice(1)
  let v
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlainObject(v)) return null
  const verify_base = {}
  if (isPlainObject(v.verify_base)) {
    for (const [k, s] of Object.entries(v.verify_base)) if (typeof s === 'string' && SHA_RE.test(s)) verify_base[k] = s
  }
  const rev = v.revised_at
  return {
    section1: typeof v.section1 === 'string' ? v.section1 : null,
    body_sha: typeof v.body_sha === 'string' && SHA_RE.test(v.body_sha) ? v.body_sha : null,
    revisions: Array.isArray(v.revisions) ? v.revisions.filter((h) => typeof h === 'string') : [],
    verify_base,
    revised_at: typeof rev === 'string' && ISO_RE.test(rev) && !Number.isNaN(Date.parse(rev)) ? rev : null,
    deliver_used: Array.isArray(v.deliver_used) ? v.deliver_used.filter((a) => typeof a === 'string' && SHA_RE.test(a)) : [],
    deliver_blocks: Array.isArray(v.deliver_blocks) ? v.deliver_blocks.filter((h) => typeof h === 'string') : [],
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

/** 推进出第一段之后第一次：记第 1 节、修订指纹与修订块标题，verify_base 为空。契约读不出来回 null（下一次再记）。 */
export function initialBase(contractBytes) {
  if (!contractBytes) return null
  const text = contractBytes.toString('utf8')
  return { section1: section1Of(text), body_sha: bodyShaOf(text), revisions: revisionHeadingsOf(text), verify_base: {}, revised_at: null, deliver_used: [], deliver_blocks: [] }
}

/**
 * 一次契约写入之后：修订指纹没变回 null（不用重写）。变了——新加的修订块全是不改需求的答复：只换指纹与标题（requirement: false）；
 * 别的（含没有新块却改了别的节、认不出类别的新块）：verify_base 换成 verifyShas、revised_at 记 now（requirement: true）。第 1 节不动。
 * M4k（docs/46，评审 F1、F2）：deliverSha 是验收结论现在这份的 sha——门禁记下了它的照现状交付批准、而 deliver_used 里还没有它时，调用方传进来。有它，
 * 这次修订就是记那条答复的那一次：不算改需求，只换指纹与标题，sha 记进 deliver_used（复核中 2：按 sha 记，同一份结论批两次也只盖一次修订），这次新加的
 * 修订块记进 deliver_blocks，之后修订指纹不计它们（复核中 1：往那几块里补一句不算修订；改别处、加新块照常判）。照现状交付接受没过的现状、不改需求；照标题分
 * 会把它算成改需求（它多半是在 contract-conflict 那一问里、或者用户主动说的），刚批准的那份验收结论成了「对着上一版契约」，重出之后 sha 变了、
 * 批准跟着作废，绕不出来。不靠 PM 在标题里写标记：漏写会绕圈，冒充只要一行字（设计评审 F1、F2）。
 * @returns {{ base: object, requirement: boolean, deliver?: string } | null}
 */
export function revisedBase(base, contractBytes, verifyShas, now, deliverSha = null) {
  if (!base || !contractBytes) return null
  const text = contractBytes.toString('utf8')
  const blocks = Array.isArray(base.deliver_blocks) ? base.deliver_blocks : []
  const body = bodyShaOf(text, blocks)
  if (body === base.body_sha) return null
  const headings = revisionHeadingsOf(text)
  const known = new Set(Array.isArray(base.revisions) ? base.revisions : [])
  const added = headings.filter((h) => !known.has(h))
  if (typeof deliverSha === 'string') {
    const used = Array.isArray(base.deliver_used) ? base.deliver_used : []
    const nextBlocks = [...blocks, ...added.filter((h) => !blocks.includes(h))]
    return {
      base: { ...base, body_sha: bodyShaOf(text, nextBlocks), revisions: headings, deliver_used: [...used, deliverSha], deliver_blocks: nextBlocks },
      requirement: false,
      deliver: deliverSha,
    }
  }
  if (added.length > 0 && added.every((h) => ADMIN_KINDS.includes(headingKind(h)))) {
    return { base: { ...base, body_sha: body, revisions: headings }, requirement: false }
  }
  return {
    base: { ...base, body_sha: body, revisions: headings, verify_base: { ...(isPlainObject(verifyShas) ? verifyShas : {}) }, revised_at: now },
    requirement: true,
  }
}

/** 第 1 节变了没有：记下的是字符串，磁盘上的第 1 节与它不同（切不出来了也算）。契约读不出来不算（不误拦）。 */
export function section1Drift(base, contractBytes) {
  if (!base || typeof base.section1 !== 'string' || !contractBytes) return false
  return section1Of(contractBytes.toString('utf8')) !== base.section1
}

/** 派发记录（completion.mjs 的 readDispatchLog）→ 产物名 → 它的产者在它那一段最后一次被派出去的时刻（门禁的钟）；没派过回 null。 */
export function lastDispatchAtOf(stages, log) {
  const dispatches = Array.isArray(log?.dispatches) ? log.dispatches : []
  return (name) => {
    const p = producerOfName(stages, name)
    if (!p) return null
    let best = null
    for (const d of dispatches) {
      if (d.role !== p.role || d.stage !== p.stageId || typeof d.at !== 'string') continue
      const t = Date.parse(d.at)
      if (!Number.isNaN(t) && (best === null || t > Date.parse(best))) best = d.at
    }
    return best
  }
}

/**
 * 对着上一版契约的验证段结论：在磁盘上，而且内容跟 verify_base 记的一样，或者它的产者在修订之前派出去、之后没再派过（修订那一刻还在跑、
 * 之后才交的也算——复核 F4）。项目经理自己的产物（交付文档）不经派发，只看内容。
 */
export function outdatedProducts({ stages, base, diskSha, lastDispatchAt = () => null }) {
  if (!base) return []
  const vb = isPlainObject(base.verify_base) ? base.verify_base : {}
  const rev = typeof base.revised_at === 'string' ? Date.parse(base.revised_at) : NaN
  return verificationProducts(stages).filter((name) => {
    const d = diskSha(name)
    if (!d || !d.exists) return false
    if (Object.hasOwn(vb, name) && d.sha === vb[name]) return true
    if (Number.isNaN(rev)) return false
    const at = lastDispatchAt(name)
    const t = typeof at === 'string' ? Date.parse(at) : NaN
    return !Number.isNaN(t) && t < rev
  })
}

// 第 1 节那一句的前半与出路（H6 的拒绝理由与写契约时的【契约】共用）。段 id 来自阶段链（插件自己的名字），原样。
export function driftHead(stages) {
  const first = isStageChain(stages) ? Object.keys(stages)[0] : '第一段'
  return `契约第 1 节是用户原话，推进出 ${first} 之后门禁记下了它（这一趟 run 目录里的 ${CONTRACT_BASE_FILE}，section1 那一项）`
}
export const DRIFT_FIX = '照它改回去——用户改了需求的，修订写进第 4 节「修订记录」，第 1 节原样留着'

/**
 * 对着上一版契约的那几份怎么重出，看当前在哪一段（复核 F1）：有早于当前段的，照「回退」记回到它们最早那一段；都在当前段的，同段重派
 * 它们的产者（同一段里重派不计返工），只剩项目经理自己的就重写；都在后面的段，这一轮走到那一段时照常重出。当前段认不出时按回退说。
 */
export function outdatedFix(stages, outdated, currentStage) {
  const ids = isStageChain(stages) ? Object.keys(stages) : []
  const cur = ids.indexOf(currentStage)
  const at = (n) => ids.indexOf(producerOfName(stages, n)?.stageId)
  const known = outdated.filter((n) => at(n) >= 0)
  const earlier = cur < 0 ? known : known.filter((n) => at(n) < cur)
  if (earlier.length) {
    const sid = ids[Math.min(...earlier.map(at))]
    return { kind: 'rollback', sid, text: `照 /agent-team:at 第 3 节的「回退」记回到 ${sid}，让产者对着这一版重出` }
  }
  const same = known.filter((n) => at(n) === cur)
  if (same.length) {
    if (same.some((n) => !isContractWriter(producerOfName(stages, n)?.role))) {
      return { kind: 'redo', sid: currentStage, text: `在 ${currentStage} 里同段重派它的产者重出（同一段里重派不计返工）` }
    }
    return { kind: 'own', sid: currentStage, text: `${names(same)} 是你自己的产物，对着这一版重写` }
  }
  return { kind: 'later', sid: null, text: `${names(known)} 在后面的段，这一轮走到那一段时照常重出，现在不用回退` }
}

/**
 * H6 的契约判据（M4j）：只管推进（stage 往阶段链后面挪）与收口（closed_at 新写上、写入前还没收口）这两种写入；回退、原地重写、补记别的
 * 字段不判。排在 H6 别的判据之后（缺、空、上一轮的、返工预算先说）。
 *   - 契约第 1 节与 section1 不同 → 拒。
 *   - 对着上一版契约的验证段结论：推进时，到达的那一段之前的验证段里有（复核 F5：更早段的过期结论不放到收口才说）；收口时任何一份 → 拒。
 *     出路看写入前所在的段（outdatedFix）。
 * diskSha(name) → { exists, sha }（与 decideReworkBase 同一个注入）；lastDispatchAt(name) → ISO 时刻或 null。段 id、产物名都是插件自己的名字。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideContractBase({ before, after, stages, base, contractBytes, diskSha, lastDispatchAt = () => null }) {
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
  const outdated = outdatedProducts({ stages, base, diskSha, lastDispatchAt })
  const at = (n) => ids.indexOf(producerOfName(stages, n)?.stageId)
  const blocking = closing ? outdated : outdated.filter((n) => at(n) >= 0 && at(n) < to)
  if (blocking.length) {
    const fix = outdatedFix(stages, blocking, before.stage)
    parts.push(`契约在 ${names(blocking)} 写成之后改过（门禁在那次修订时记下了它们）——它们对着的是上一版契约。${fix.text}，再${act}。`)
  }
  return parts.length ? { ok: false, reason: parts.join('\n') } : { ok: true }
}
