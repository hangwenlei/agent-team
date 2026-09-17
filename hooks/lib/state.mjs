// state.json 的 schema 与交叉校验（纯函数）。规格 §4.4。
//
// 这个模块存在的理由是 §4.2 ③ 的「返工预算硬上限且不可重置，计数写在 state.json，
// 不交给模型自己数」。如果 rework 只是一个孤立字段，模型把它改小没有任何东西会红，
// 「不可重置」就只是一句话。history 是阶段进入的追加日志，rework 必须等于它的派生量
// （某阶段出现 n 次 → n-1 次返工），计数于是变成**可交叉校验**的。
//
// ⚠️ 本模块只做校验，不做写时强制。拦住一次「把计数改小」的写入要看到改之前的那一版，
// PostToolUse 看不到。M1 的阶段链只到 S5，没有任何返工边（返工产生于 S6 失败回 S5 与
// S7 驳回），所以这条缺口在 M1 里不可达；它属于 M2，和 S6/S7 一起设计。同一条注记也
// 写在 stages.README.md 里。
//
// validateState 一次报全部问题而不是遇到第一个就返回：调用方是 ledger，它把 problems
// 一次性交给 PM；分次报会让 PM 改一条、再撞一条，来回好几轮。

const SHA_RE = /^sha256:[0-9a-f]{64}$/
const RUN_ID_RE = /^\d{8}-\d{4}-[a-z0-9][a-z0-9-]*$/

export const REWORK_LIMIT = 3

// 与规格 §5.1 的五类必须升级条件一一对应，顺序也照它：
// 1 敏感与不可逆 / 2 契约冲突 / 3 取舍 / 4 契约有洞 / 5 预算耗尽。
export const ESCALATION_KINDS = [
  'sensitive',
  'contract-conflict',
  'tradeoff',
  'contract-hole',
  'budget-exhausted',
]

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** history 里某阶段出现 n 次 → 该阶段返工 n-1 次。只有 n>1 的阶段进结果。 */
export function reworkFromHistory(history) {
  const out = {}
  if (!Array.isArray(history)) return out
  const count = {}
  for (const e of history) {
    if (!isPlainObject(e) || typeof e.stage !== 'string') continue
    count[e.stage] = (count[e.stage] ?? 0) + 1
  }
  for (const [stage, n] of Object.entries(count)) if (n > 1) out[stage] = n - 1
  return out
}

/** 按 stages 的**书写顺序**（Object.entries 的插入序）取下一个阶段。 */
export function nextStage(stages, current) {
  // 不按阶段 id 字符串排序：'S10'.localeCompare('S2') < 0，字典序会把 S10 排到 S2
  // 前面。readiness.mjs 与 deliverable.mjs 都为这一条留过注释，这是第三处。
  if (!isPlainObject(stages)) return null
  const ids = Object.keys(stages)
  const i = ids.indexOf(current)
  if (i < 0 || i === ids.length - 1) return null
  return ids[i + 1]
}

export function validateState(state, { stages } = {}) {
  const problems = []
  const p = (msg) => problems.push(msg)

  if (!isPlainObject(state)) {
    return { ok: false, problems: ['state.json 的内容不是一个 JSON 对象'] }
  }

  if (typeof state.run_id !== 'string' || !RUN_ID_RE.test(state.run_id)) {
    p(`run_id 不是 YYYYMMDD-HHmm-<slug> 形状（拿到 ${JSON.stringify(state.run_id)}）`)
  }
  if (typeof state.stage !== 'string' || !state.stage) {
    p('stage 缺失或不是字符串')
  } else if (isPlainObject(stages) && !Object.hasOwn(stages, state.stage)) {
    p(`stage 是 ${state.stage}，但 stages.json 里没有这个阶段`)
  }
  if (state.contract_sha !== 'PENDING' && !(typeof state.contract_sha === 'string' && SHA_RE.test(state.contract_sha))) {
    p(`contract_sha 既不是 "PENDING" 也不是 sha256:<64 位十六进制>（拿到 ${JSON.stringify(state.contract_sha)}）`)
  }
  if (!isStringArray(state.roster)) p('roster 不是字符串数组')
  if (!isStringArray(state.never_invoked)) p('never_invoked 不是字符串数组')

  if (!isPlainObject(state.artifacts)) {
    p('artifacts 不是对象')
  } else {
    for (const [k, v] of Object.entries(state.artifacts)) {
      if (typeof v !== 'string' || !SHA_RE.test(v)) p(`artifacts["${k}"] 不是 sha256:<64 位十六进制>`)
    }
  }

  if (!Array.isArray(state.escalations)) {
    p('escalations 不是数组')
  } else {
    state.escalations.forEach((e, i) => {
      if (!isPlainObject(e)) return p(`escalations[${i}] 不是对象`)
      for (const k of ['stage', 'kind', 'question', 'answer', 'at']) {
        if (typeof e[k] !== 'string') p(`escalations[${i}].${k} 缺失或不是字符串`)
      }
      if (typeof e.kind === 'string' && !ESCALATION_KINDS.includes(e.kind)) {
        p(`escalations[${i}].kind 是 ${JSON.stringify(e.kind)}，必须是规格 §5.1 的五类之一：${ESCALATION_KINDS.join('、')}`)
      }
    })
  }

  if (!Array.isArray(state.history) || state.history.length === 0) {
    p('history 缺失或为空——一个 run 至少进入过一个阶段，没有它 rework 就无法交叉校验')
  } else {
    state.history.forEach((e, i) => {
      if (!isPlainObject(e) || typeof e.stage !== 'string' || typeof e.at !== 'string') {
        return p(`history[${i}] 不是 { stage, at } 形状`)
      }
      if (isPlainObject(stages) && !Object.hasOwn(stages, e.stage)) {
        p(`history[${i}].stage 是 ${e.stage}，但 stages.json 里没有这个阶段`)
      }
    })
    const last = state.history[state.history.length - 1]
    if (isPlainObject(last) && last.stage !== state.stage) {
      p(`history 的最后一条是 ${last.stage}，但 stage 字段是 ${state.stage}——有人改了当前阶段却没记账`)
    }
  }

  if (!isPlainObject(state.rework)) {
    p('rework 不是对象')
  } else {
    for (const [k, v] of Object.entries(state.rework)) {
      if (!Number.isInteger(v) || v < 0) p(`rework["${k}"] 不是非负整数`)
      else if (v > REWORK_LIMIT) p(`rework["${k}"] 是 ${v}，超过硬上限 ${REWORK_LIMIT}（规格 §4.2 ③：第 ${REWORK_LIMIT} 轮终局，不过则升级）`)
      if (isPlainObject(stages) && !Object.hasOwn(stages, k)) p(`rework 里有 ${k}，但 stages.json 里没有这个阶段`)
    }
    // §4.2 ③「不可重置」的落点：rework 必须严格等于 history 的派生量。
    // 两个方向都查——改小是逃预算，改大是虚报返工把自己推进升级。
    if (Array.isArray(state.history)) {
      const derived = reworkFromHistory(state.history)
      const keys = new Set([...Object.keys(derived), ...Object.keys(state.rework)])
      for (const k of keys) {
        const have = state.rework[k] ?? 0
        const want = derived[k] ?? 0
        if (have !== want) {
          p(`rework["${k}"] 是 ${have}，但 history 里 ${k} 出现了 ${want + 1} 次，应当是 ${want}——` +
            `计数是 history 的派生量，不能单独改（规格 §4.2 ③）`)
        }
      }
    }
  }

  return { ok: problems.length === 0, problems }
}
