// 返工轮里「这份产物还是上一轮的」怎么判（M3y，docs/33，全量审查第 15 条）。纯函数工厂，I/O 由调用方注入。
//
// 交没交、齐没齐的几个判据（H5a/H5b 的 decideDeliverable、【阶段】与 H5a「停在旧阶段」的 isStageDone、H2 的 decideReadiness）
// 原来都只问文件在不在。回退之后上一轮的产物都还在：回退那一刻【阶段】就催推进，零改动停下 H5b 放行，H2 被旧产物满足、
// 前置都不查。state.json 的 rework_base 记着回退那一刻磁盘上各份产物的 sha（H6 对着磁盘核过，hooks/lib/rework-guard.mjs）；
// 某份产物的磁盘内容与它记的 sha 还相同，就是上一轮的。
//
//   isStale(name)         = rework_base 是普通对象、自有键 name、值是合法 sha、磁盘那份读得出且 sha 与它相同。
//   artifactCurrent(name) = artifactExists(name) && !isStale(name)。
//
// ⚠️ 值是 "accepted" 的不旧：PM 声明这一轮接受它原样（H6 只许当前段及更早段这样标）。
// ⚠️ 读不出来（artifactBytes 给 null、或读与算 sha 任一步抛异常）一律不旧：与 H2、H5 的 fail open 一致。不能拿
//    sha256OfContract(null) 去比——normalizeText 把 null 当成字符串 "null"，算出来的 sha 形状合法。
// ⚠️ 只在 rework_base 里有这一条时才读字节：首轮（没有快照）与快照外的产物一个字节都不多读。
// ⚠️ sha 的口径与 artifacts 同一个（sha256OfContract：归一化 BOM 与 CRLF），只改行尾不算重写。
import { isPlainObject, isStageChain, productsOfStage, mayAcceptProduct } from './stages.mjs'
import { SHA_RE, sha256OfContract } from './contract-hash.mjs'

export const ACCEPTED = 'accepted'

// M4a（docs/35）：验证段（stages.json 的 "verifies": true）的产物在返工轮里的出路——不许标 "accepted"（H6 拒），也不能只追加一句。
// H6 与每一处给出「标 accepted」这条出路的回传（H5a、H5b、H2 前置、【返工】、补记提示）共用这一句；能不能标，问 stages.mjs 的
// mayAcceptProduct。
export const VERIFY_REDO =
  '验证段（stages.json 里 "verifies": true）的产物记的是对上游当时那一版的结论，返工轮里一律重新出：让它的产者这一轮重跑之后重写——' +
  '不能标 "accepted"，也不能只在末尾追加一句「核过」'

// 复核（F9、B-5）：H5b 是对产者本人说的——不说「让它的产者」；重跑结果与上一轮相同时，报告要写明这一轮在哪一版上跑的、跑了哪些，
// 否则内容逐字相同，门禁分不出跑没跑。
export const VERIFY_REDO_SELF =
  '验证段（stages.json 里 "verifies": true）的产物记的是对上游当时那一版的结论，返工轮里一律重新出：你这一轮重跑之后重写——' +
  '只在末尾追加一句「核过」不算；结果与上一轮相同也要写明这一轮在哪一版实现上跑的、跑了哪些'

/** 把一组还是上一轮的产物按「能不能标 accepted」分成两组（mayAcceptProduct）。顺序照原样。 */
export function splitByAccept(stages, list) {
  const accept = []
  const redo = []
  for (const n of list) (mayAcceptProduct(stages, n) ? accept : redo).push(n)
  return { accept, redo }
}

export function makeFreshness({ artifactExists, artifactBytes, reworkBase } = {}) {
  const base = isPlainObject(reworkBase) ? reworkBase : null
  const isStale = (name) => {
    if (!base || typeof name !== 'string' || !Object.hasOwn(base, name)) return false
    const recorded = base[name]
    if (typeof recorded !== 'string' || !SHA_RE.test(recorded)) return false
    try {
      const bytes = artifactBytes(name)
      if (bytes === null || bytes === undefined) return false
      return sha256OfContract(bytes) === recorded
    } catch {
      return false
    }
  }
  const artifactCurrent = (name) => !!artifactExists(name) && !isStale(name)
  return { isStale, artifactCurrent }
}

/** 【返工】回传列的那两样（M3y）：当前段还是上一轮的产物，与更早各段还是上一轮的（带所在段）。更晚的段还旧是返工轮的常态
 * （回退到 S5 时 S6 那份还是上一轮的），不列也不问。更早的段还旧，多半是回退记晚了（补记）、或者文件被改回了旧内容——
 * 推进出那一段时 H6 本该拦下它。stageId 不在链上、阶段链形状不对时两样都空；stage 是链上那一段的 id（插件自己的名字）。
 * 每份产物只问一次 isStale（在链上最早出现的那一段）。 */
export function staleByStage({ stages, stageId, isStale }) {
  const out = { stage: null, current: [], earlier: [] }
  if (!isStageChain(stages) || typeof stageId !== 'string' || !Object.hasOwn(stages, stageId)) return out
  const ids = Object.keys(stages)
  const t = ids.indexOf(stageId)
  out.stage = ids[t]
  const seen = new Set()
  ids.slice(0, t + 1).forEach((id, i) => {
    for (const name of productsOfStage(stages[id])) {
      if (seen.has(name)) continue
      seen.add(name)
      if (!isStale(name)) continue
      if (i === t) out.current.push(name)
      else out.earlier.push({ name, stage: id })
    }
  })
  return out
}
