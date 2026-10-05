// 推进判据（M4d，docs/38，全量审查第 17 条）。纯函数，I/O 由调用方注入。H6 在推进那一次写入里调（rework-guard.mjs 的 decideAdvance）。
//
// 推进原来只核「还是上一轮的」（rework_base），不核「缺」：PM 能从 S2 一次写到 S8，S3→S4 时 03-alignment.md 不在、S5→S6 时某个
// 参与者的实现记录不在或是空文件、S2 里叫到的 at-ui 没交 02-*，都照样推得过去。不在任何前置里的产物（02-*、03-alignment.md、
// 05-impl/*）离开那一段之后再没有门禁查它（H2 只查 requires，收口只查最后一段）。
//
//   - 一次只推进一段（不是回退的写入里，写入后的 stage 在链上恰好是写入前的下一段）。补记（回退那一条之后同一次写入又往前记了
//     几段）不归这一条：它走回退那一路，离开的各段照下面逐段核。
//   - 离开一段时，这一段要求在的产物（departureNeeds）都在、不是空文件：
//       · 产物随参与者展开的段（对象形式、<role> 模式）：这一段叫到的产者（participantsOf，写入后与写入前取并集）各自那几份。
//         裁掉的不算：trimmed 里记着这个角色、值就是这一段，而且那份产物不在任何一段的 requires 里（叫到之后又裁掉的正当出口；
//         后面要它当前置的，裁了也走不下去，不给这条路）。state.json 有 stage_roles、却没有这一段的键：这一段还没记账，核不了，拒。
//       · 产物固定的段：不论叫没叫谁都要。整段裁掉的不要求——这一段的产者都在 trimmed 里、值是这一段，这一趟在这一段一个都没
//         叫过（与收口的 trimmedAway 同一个口径），而且不是你自己的段（at-pm 不裁自己）。
//   - 已经标了 "accepted" 的算交了（在、不是空的就行）；还是上一轮的由 rework-guard.mjs 原来那条判据管，两样并在同一条理由里。
//   - 读不出来的不拦（推进不是单向门，与「还旧」那一条同一个 fail open），留痕。
import { isPlainObject, isStageChain, stageRoles, expandProduces, productsOfStage, participantsOf, isVerifyStage } from './stages.mjs'
import { isContractWriter } from './contract-guard.mjs'
import { quote } from './trusted.mjs'

/** 这一段的产物是不是随参与者展开：按空名单展开得出的少于按全部产者展开的。 */
export function dependsOnParticipants(stage) {
  return expandProduces(stage, []).length < productsOfStage(stage).length
}

/** 有哪几段的 requires 列着它（要它当前置）。插件自己的名字，按书写顺序。 */
export function requiredBy(stages, name) {
  if (!isStageChain(stages)) return []
  return Object.keys(stages).filter((id) => Array.isArray(stages[id].requires) && stages[id].requires.includes(name))
}

// 这一趟在 sid 那一段叫到过的产者：写入后与写入前 participantsOf 的并集（同一次写入挪走 stage_roles 里的人翻不成「没叫过」，
// 与 closing.mjs 的 calledIn 同一个口径），再与这一段的产者求交。participantsOf 给 undefined（roster 不是数组的坏 state）按空集算。
// 旧 run 半路加上 stage_roles（/agent-team:at 第 3 节明令不要）时写入前那一边是整趟 roster，S2 叫过的 at-ui 会被算成 S5 的参与者——
// 照收口那一处（复核二 G2）的取舍不剔掉它：剔掉的话「新加 stage_roles」就能把叫过的人翻成没叫过。出路是 trimmed（值写那一段）。
export function calledIn(stages, sid, state, prior) {
  const set = new Set()
  for (const s of [state, prior]) {
    const who = isPlainObject(s) ? participantsOf(s, sid) : undefined
    for (const r of Array.isArray(who) ? who : []) set.add(r)
  }
  return stageRoles(stages[sid]).filter((r) => set.has(r))
}

const trimmedAt = (state, role, sid) => isPlainObject(state?.trimmed) && Object.hasOwn(state.trimmed, role) && state.trimmed[role] === sid

// 整段裁掉：这一段的产者都在 trimmed 里、记的就是这一段（PM 照「班底裁剪自决」裁掉了它们），这一趟在这一段一个都没叫过（calledIn，
// 写入前后取并集），而且没有一个是 PM——PM 不裁自己的段。推进（departureNeeds）与收口（closing.mjs 的 trimmedAway）共用这一份：
// 「整段裁掉」此前在两处各写一份，收口那一份没有「PM 不裁自己」这一条（收口的前置不是 PM 的产物，所以两份当时行为相同）。
export function wholeStageTrimmed(stages, sid, state, prior) {
  if (!isStageChain(stages) || typeof sid !== 'string' || !Object.hasOwn(stages, sid)) return false
  const roles = stageRoles(stages[sid])
  return roles.length > 0 && roles.every((r) => !isContractWriter(r) && trimmedAt(state, r, sid)) && calledIn(stages, sid, state, prior).length === 0
}

/** 叫到之后又裁掉，能不能免掉它在 sid 的这一份：值就是这一段、不是验证段、没有哪一段要它当前置。 */
export function mayWaive(stages, sid, name) {
  return !isVerifyStage(stages[sid]) && dependsOnParticipants(stages[sid]) && requiredBy(stages, name).length === 0
}

/**
 * 离开 sid 这一段时要求在的产物。state 是写入后的、prior 是写入前的。
 * @returns {{ needs: { name: string, role: string, called: boolean }[], keyMissing: boolean, excused: { name: string, role: string }[] }}
 */
export function departureNeeds({ stages, sid, state, prior }) {
  const out = { needs: [], keyMissing: false, excused: [] }
  if (!isStageChain(stages) || typeof sid !== 'string' || !Object.hasOwn(stages, sid)) return out
  const stage = stages[sid]
  const roles = stageRoles(stage)
  const called = calledIn(stages, sid, state, prior)
  const seen = new Set()
  const need = (name, role) => {
    if (seen.has(name)) return
    seen.add(name)
    out.needs.push({ name, role, called: called.includes(role) })
  }
  const excuse = (name, role) => {
    if (seen.has(name)) return
    seen.add(name)
    out.excused.push({ name, role })
  }
  if (!dependsOnParticipants(stage)) {
    const whole = wholeStageTrimmed(stages, sid, state, prior)
    for (const r of roles) for (const n of expandProduces(stage, [r])) (whole ? excuse : need)(n, r)
    return out
  }
  out.keyMissing = isPlainObject(state?.stage_roles) && !Object.hasOwn(state.stage_roles, sid)
  // 不含 <role> 的条目（插件自带的链里没有）不随参与者变，照固定产物要。
  for (const n of expandProduces(stage, [])) need(n, roles[0])
  for (const r of called) {
    for (const n of expandProduces(stage, [r])) (trimmedAt(state, r, sid) && mayWaive(stages, sid, n) ? excuse : need)(n, r)
  }
  return out
}

/**
 * 一次只推进一段：不是回退的写入里，写入后的 stage 在链上晚于写入前的下一段 → 拒。写入前后有一边不在链上、不往后走：不管。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideSingleStep({ before, after, stages }) {
  if (!isStageChain(stages) || !isPlainObject(before) || !isPlainObject(after)) return { ok: true }
  const ids = Object.keys(stages)
  const from = typeof before.stage === 'string' ? ids.indexOf(before.stage) : -1
  const to = typeof after.stage === 'string' ? ids.indexOf(after.stage) : -1
  if (from < 0 || to <= from + 1) return { ok: true }
  const skipped = ids.slice(from + 1, to)
  return {
    ok: false,
    reason:
      `一次只推进一段：这次写入从 ${quote(before.stage)} 推进到 ${quote(after.stage)}，跨过了 ${skipped.join('、')}。先只推进到 ` +
      `${ids[from + 1]}（离开 ${ids[from]} 的账同一次记掉），之后每一段推进各一次 Write（/agent-team:at 第 3 节）——每一次推进，` +
      '门禁都核离开的那一段交齐了没有。跨过去的段要是确实不做，走到它、推进出它的那一次把它的产者写进 trimmed。',
  }
}

/**
 * 离开的各段（sids）里还不行的：缺、空文件，以及「这一段还没记账」。probe(name) → 'ok' | 'missing' | 'empty' | 'unreadable'。
 * 还旧的不在这里判（rework-guard.mjs 的 decideAdvance）。
 * @returns {{ blockers: { sid, name, role, called, why }[], unrecorded: string[], unreadable: string[] }}
 */
export function departureBlockers({ stages, sids, state, prior, probe }) {
  const blockers = []
  const unrecorded = []
  const unreadable = []
  for (const sid of sids) {
    const { needs, keyMissing } = departureNeeds({ stages, sid, state, prior })
    if (keyMissing) unrecorded.push(sid)
    for (const n of needs) {
      const why = probe(n.name)
      if (why === 'missing' || why === 'empty') blockers.push({ sid, ...n, why })
      else if (why === 'unreadable') unreadable.push(n.name)
    }
  }
  return { blockers, unrecorded, unreadable }
}

/**
 * 拒绝理由里逐条的那几行与出路。产物名、段 id、角色名都是插件自己的名字（stages.json），原样。
 * 按（段、角色）合成一行；叫过的另起「出路」一段，裁掉那条路只给 mayWaive 的。
 */
export function departureLines(stages, blockers, unrecorded) {
  const groups = []
  for (const b of blockers) {
    let g = groups.find((x) => x.sid === b.sid && x.role === b.role)
    if (!g) groups.push((g = { sid: b.sid, role: b.role, called: b.called, items: [] }))
    g.items.push(b)
  }
  const what = (b) => `${b.name} ${b.why === 'empty' ? '是空文件' : '缺'}`
  const lines = []
  const waivable = []
  const fixed = []
  for (const g of groups) {
    const items = g.items.map(what).join('、')
    if (isContractWriter(g.role)) {
      lines.push(`  - ${items}：这是你自己的产物，你自己写。`)
    } else if (g.called) {
      lines.push(`  - ${g.role} 在 ${g.sid} 被叫到过：${items}。`)
      if (g.items.every((b) => mayWaive(stages, g.sid, b.name))) waivable.push(g)
      else fixed.push(g)
    } else {
      const later = [...new Set(g.items.flatMap((b) => requiredBy(stages, b.name)))]
      lines.push(
        `  - ${items}：${g.sid} 这一趟还没叫过 ${g.role}——派它；这一趟不叫它（项目不用它，或者你裁掉了它）：同一次 Write 把 ` +
          `{"${g.role}": "${g.sid}"} 写进 trimmed，整段裁掉${later.length ? `（${later.join('、')} 要它当前置，那几段也就要它不着）` : ''}。`,
      )
    }
  }
  for (const sid of unrecorded) {
    lines.push(
      `  - state.json 有 stage_roles，却没有 ${sid} 这一段：${sid} 的产物随这一段叫到的人展开，没记账门禁核不了。同一次 Write 把这一段` +
        `真正叫到的每一个记进 stage_roles 的 ${sid}（含下级派出去的、被叫去分发的；一个都没叫就写 []），决定不叫的产者写进 trimmed。`,
    )
  }
  const called = [...waivable, ...fixed]
  if (called.length) {
    lines.push(
      '叫过却没交齐的：还在跑的（后台派发还没返回）等它返回、去磁盘核过再推进；返回了的读它的回复——第一行是「冒泡：」的，照 ' +
        '/agent-team:at 第 3 节「核实」那一条定（同一段里重派、照第 4 节问用户，或者记回退），没冒泡就是漏了，同一段里重派它（不计返工）。' +
        '你派不到的（at-ui、S5 的执行角色），经这一段派得到它的那个协调者去派。',
    )
    if (waivable.length) {
      lines.push(
        `这一趟确实不要 ${waivable.map((g) => g.role).join('、')} 在那一段的那几份：同一次 Write 把 ` +
          `${waivable.map((g) => `{"${g.role}": "${g.sid}"}`).join('、')} 写进 trimmed（理由写进 04-dispatch.md）。`,
      )
    }
    if (fixed.length) {
      const why = (g) => {
        const later = [...new Set(g.items.flatMap((b) => requiredBy(stages, b.name)))]
        if (later.length) return `${later.join('、')} 要它当前置`
        return isVerifyStage(stages[g.sid]) ? '验证段的产物' : `${g.sid} 只有它一个产者`
      }
      lines.push(`${fixed.map((g) => `${g.role}（${why(g)}）`).join('、')}：叫过却没交，trimmed 不是出路。`)
    }
  }
  return lines
}
