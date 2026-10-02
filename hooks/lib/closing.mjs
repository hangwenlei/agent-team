// 收口标记 closed_at（M4a，docs/35；全量审查第 24 条的修法 2）。纯函数，I/O 由 gate.mjs 注入。
//
// 一趟走完之后，同一会话里用户要求改一处，门禁原来把它当成旧 run 的重做：派人被拒、理由只给「记回退」，不提「这一趟已经走完，
// 新改动另起一趟」——照理由做，新需求塞进旧契约、吃旧 run 的返工额度；不照做，最省事的路是 PM 自己写代码。没有收口标记，
// 【阶段】对走完的 run 反复说「该收口了」，收口本身也不经任何门禁（交付文档缺了没人发现，docs/33 §4）。
//
//   - closedAt(state)：state.json 的 closed_at 是非空字符串就返回它，否则 null。「这一趟收没收口」只问它——H6、H2、ledger、
//     validateState、返工批准的记录器都经它，不各自判 truthy / typeof。模板里它的初值是 null（没收口）；缺键（更早落盘的 run）
//     同样是没收口。
//   - decideClosing（H6，排在返工预算与快照判据之前）：
//       形状：写入后带 closed_at 键、值既不是 null 也不是非空字符串 → 拒。
//       冻结：写入前已收口 → closed_at 原样、stage 不变、history 不追加；不依赖阶段链。
//       关上：写入后收口、写入前没有（写入前读不出来也算）→ 阶段链读得出；stage 是最后一段；写入前读得出时这次不往 history 追加
//         （推进与收口拆成两次写）；最后一段的 requires 与 produces 都在、读得出、不是上一轮的（closeBlockers）。
//   - decideClosedDispatch（H2，排在就绪判据之前）：收口之后派花名册里的任何角色 → 拒；最后一段、没收口时派协调者 → 拒。
//     最后一段是 PM 自己收口的段，正路上没有要派协调者的时候；叶子角色交给 redo.mjs（补收口缺的前置要能派）。
//
// ⚠️ 收口是一道单向门：判不了（阶段链读不出来、产物在却读不出来）就不放。冻结之后要改，只有另起一趟——或者 Bash（登记为边界）。
// ⚠️ 「还旧」与 decideAdvance（rework-guard.mjs）同一个口径：写入后 rework_base 里那一条是 sha、磁盘内容的 sha 与它相同。
import { isPlainObject, isStageChain, expandProduces, stageRoles, stageRolesInRun, participantsOf, productsOfStage, mayAcceptProduct } from './stages.mjs'
import { SHA_RE } from './contract-hash.mjs'
import { isValidRoster } from './decide.mjs'
import { inline, quote } from './trusted.mjs'
import { VERIFY_REDO } from './freshness.mjs'

const isSha = (v) => typeof v === 'string' && SHA_RE.test(v)

export function closedAt(state) {
  if (!isPlainObject(state)) return null
  const v = state.closed_at
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

export function lastStageId(stages) {
  if (!isStageChain(stages)) return null
  const ids = Object.keys(stages)
  return ids[ids.length - 1]
}

// 产物所在的段（链上最早产出它的那一段）。
function stageIdOf(stages, name) {
  for (const id of Object.keys(stages)) if (productsOfStage(stages[id]).includes(name)) return id
  return null
}

// 前置由整段裁掉的段产出：那一段的产者都在 trimmed 里、记的就是那一段（PM 照「班底裁剪自决」裁掉了 S6、S7 的人）。
function trimmedAway(stages, state, name) {
  const sid = stageIdOf(stages, name)
  if (!sid) return false
  const roles = stageRoles(stages[sid])
  const trimmed = isPlainObject(state?.trimmed) ? state.trimmed : {}
  return roles.length > 0 && roles.every((r) => Object.hasOwn(trimmed, r) && trimmed[r] === sid)
}

/**
 * 收口的阻碍：最后一段的 requires（整段裁掉的段产出的除外）与 produces（按 participantsOf 展开），probe 不答 'ok' 的那些。
 * probe(name) → 'ok' | 'missing' | 'stale' | 'unreadable'。顺序：前置在前、产物在后，各自照 stages.json 的书写顺序。
 * @returns {{ name: string, why: 'missing'|'stale'|'unreadable' }[]}
 */
export function closeBlockers({ stages, state, probe }) {
  const last = lastStageId(stages)
  if (!last) return []
  const stage = stages[last]
  const requires = Array.isArray(stage.requires) ? stage.requires.filter((r) => typeof r === 'string') : []
  const produces = expandProduces(stage, stageRolesInRun(stage, participantsOf(state, last)))
  const out = []
  const seen = new Set()
  for (const name of [...requires.filter((r) => !trimmedAway(stages, state, r)), ...produces]) {
    if (seen.has(name)) continue
    seen.add(name)
    const why = probe(name)
    if (why !== 'ok') out.push({ name, why })
  }
  return out
}

// 一条阻碍的出路。产物名都是插件自己的名字（stages.json），原样。H6 的收口拒绝理由与 ledger 的【阶段】共用。
export function blockerLine(stages, b) {
  const sid = stageIdOf(stages, b.name)
  const roles = sid ? stageRoles(stages[sid]) : []
  const own = roles.includes('at-pm')
  if (b.why === 'missing') {
    return own
      ? `${b.name}（缺：这是你自己的产物，你自己写）`
      : `${b.name}（缺：派它的产者 ${roles.join('、')} 补交——这一段它还没交过，不用记回退）`
  }
  if (b.why === 'stale') {
    return mayAcceptProduct(stages, b.name)
      ? `${b.name}（还是上一轮的：让它的产者这一轮重写，或者在 rework_base 里把它标 "accepted"）`
      : `${b.name}（还是上一轮的：${VERIFY_REDO}）`
  }
  return `${b.name}（在磁盘上但读不出来：修好再收口）`
}

const NEW_RUN =
  '交付之后的新改动或修复另起一趟：请用户用 /agent-team:at <改动>，或者照 /agent-team:at 第 0–2 节自己建新 run' +
  '（契约第 1 节逐字照抄用户提出这次改动的那几条消息）。'

function historyLength(state) {
  return isPlainObject(state) && Array.isArray(state.history) ? state.history.length : -1
}

/**
 * H6 的收口判据（M4a）。diskSha(name) → { exists, sha }（读不出来时 sha 为 null），与 decideReworkBase 同一个注入。
 * @param {{ before: object|null, after: object, stages: object|null, diskSha: Function }} args
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideClosing({ before, after, stages, diskSha }) {
  if (!isPlainObject(after)) return { ok: true }
  if (Object.hasOwn(after, 'closed_at') && after.closed_at !== null && closedAt(after) === null) {
    return {
      ok: false,
      reason:
        'closed_at 是收口标记：还没收口时是 null，收口时写成收口那一刻的 ISO 时间字符串（例："2026-10-01T15:00:00Z"）；' +
        '这次写成了空串或者别的类型（收口照 /agent-team:at 第 6 节）。',
    }
  }

  const was = closedAt(before)
  if (was !== null) {
    const what = []
    if (closedAt(after) === null) what.push('去掉了 closed_at')
    else if (closedAt(after) !== was) what.push('改了 closed_at')
    if (after.stage !== before.stage) what.push('改了 stage')
    if (historyLength(after) !== historyLength(before)) what.push('改了 history 的条数')
    if (!what.length) return { ok: true }
    return {
      ok: false,
      reason:
        `这一趟已经收口（closed_at ${quote(was)}）：不再推进、回退或重开——stage、history 与 closed_at 都不许再改，这次写入${what.join('、')}。` +
        `别的记账字段照常能补。${NEW_RUN}`,
    }
  }

  if (closedAt(after) === null) return { ok: true }
  const last = lastStageId(stages)
  if (!last) {
    return {
      ok: false,
      reason: '阶段链（插件的 stages.json）读不出来，判不了收口条件：插件可能装坏了——重装或更新 agent-team 插件之后再收口。',
    }
  }
  const lastProduces = expandProduces(stages[last], stageRolesInRun(stages[last], participantsOf(after, last))).join('、')
  if (after.stage !== last) {
    return {
      ok: false,
      reason:
        `收口只在阶段链最后一段（${last}）：这次写入后 stage 是 ${quote(after.stage)}。先单独一次 Write 推进进 ${last}` +
        `（history 追加、离开的那一段照常记账），写完 ${lastProduces}，再单独一次 Write 收口。`,
    }
  }
  if (isPlainObject(before) && historyLength(after) !== historyLength(before)) {
    return {
      ok: false,
      reason:
        `收口那一次写入不往 history 追加：先单独一次 Write 推进进 ${last}（history 追加、离开的那一段照常记账），` +
        `再单独一次 Write 记 never_invoked 与 closed_at。`,
    }
  }
  const rb = isPlainObject(after.rework_base) ? after.rework_base : {}
  const probe = (name) => {
    const d = diskSha(name)
    if (!d || !d.exists) return 'missing'
    if (!isSha(d.sha)) return 'unreadable'
    return isSha(rb[name]) && rb[name] === d.sha ? 'stale' : 'ok'
  }
  const blockers = closeBlockers({ stages, state: after, probe })
  if (!blockers.length) return { ok: true }
  return {
    ok: false,
    reason:
      `收口要最后一段（${last}）的前置与产物都在、而且是这一轮的（整段裁掉的段产出的前置不要求）。还不行的：\n` +
      blockers.map((b) => `  - ${blockerLine(stages, b)}`).join('\n') +
      '\n补齐之后再收口。',
  }
}

/**
 * H2 的收口判据（M4a）：收口之后派花名册里的任何角色、最后一段没收口时派协调者 → 拒。roster 是 roster.json；runId 来自
 * current-run（磁盘上的值），atPath 是插件里 /agent-team:at 正文的路径（由插件根拼出）。
 * @returns {{ decision: 'allow' } | { decision: 'deny', reason: string }}
 */
export function decideClosedDispatch({ stages, state, target, roster, callerCanWriteState = false, runId, atPath }) {
  if (!isValidRoster(roster) || typeof target !== 'string' || !Object.hasOwn(roster, target)) return { decision: 'allow' }
  const closed = closedAt(state)
  if (closed !== null) {
    return {
      decision: 'deny',
      reason: callerCanWriteState
        ? `这一趟 run（${quote(runId)}）已经收口（closed_at ${quote(closed)}）：不再派人、不记回退、不重开。` +
          `交付之后的新改动或修复另起一趟：请用户用 /agent-team:at <改动>，或者先 Read ${inline(atPath)}、照第 0–2 节自己建新 run` +
          '（契约第 1 节逐字照抄用户提出这次改动的那几条消息）——新的那一趟会把 .agent-team/current-run 指过去；已经另起了的话，' +
          '核对 current-run 指着新的那一趟。只是要问点什么：不要派人，自己读这一趟的产物与代码。'
        : '这一趟 run 已经收口，不再派人：把这一条原样回报给派你的人。',
    }
  }
  const last = lastStageId(stages)
  const entry = roster[target]
  const coordinator = isPlainObject(entry) && Array.isArray(entry.can_delegate_to) && entry.can_delegate_to.length > 0
  if (!last || !isPlainObject(state) || state.stage !== last || !coordinator) return { decision: 'allow' }
  return {
    decision: 'deny',
    reason: callerCanWriteState
      ? `state.stage 是阶段链最后一段（${last}），这一段由你自己收口，不再派协调者（${inline(target)}）。` +
        '交付之后的新改动：先照 /agent-team:at 第 6 节收口，再另起一趟；这一趟的产物有问题要返工：先记一次回退' +
        '（回到要重做的那一段，照第 3 节的「回退」——stage 一变就不再拦）；只是要问它点什么：自己读产物与代码。'
      : `state.stage 是阶段链最后一段（${last}），不再派协调者：把这一条原样回报给派你的人。`,
  }
}
