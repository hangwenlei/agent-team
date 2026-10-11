// docs/66（docs/46 §4「测试报告的结论不读」）：测试报告的固定首行与推进出测试那一段时读它——单一真源。纯函数。
//
// /agent-team:at 第 3 节一直写着「推进之前读结论：06-test.md 判不通过的照回退处理，不要推进」，门禁只核测试报告在不在、空不空、是不是这一轮的。现在：
//   - 测试报告（插件自带的链上是 06-test.md）的第一个非空行固定是「结论：通过」「结论：不通过」「结论：跑不起来」之一（agents/at-qa.md）；不通过、跑不起来
//     后面可以接冒号写原因（「结论：不通过：缺测试」）；
//   - 推进出测试那一段的那一次 H6 读它：不通过的拒（回退到实现那一段），除非用户经「照现状交付」批准过这一份（门禁记下、按 sha 绑在测试报告上——
//     项目里本来就挂着的用例、不稳定的用例、返工预算耗尽，那是用户的决定；复核 docs/66 §8）；读不出的拒（同段重派 at-qa 照格式写）；跑不起来的放行——
//     那是正文里 env-blocked 那一问，用户定；
//   - 只在推进出测试那一段的那一次读，不在之后的推进、收口读：之后由验收结论管，已经走过测试那一段的旧 run 不受牵连。
import { isPlainObject, isRolePatternStage, isStageChain, isVerifyStage, productsOfStage, stageRoles } from './stages.mjs'
import { wholeStageTrimmed } from './advance.mjs'
import { sha256OfContract } from './contract-hash.mjs'
import { DELIVER_LABEL } from './budget.mjs'

export const TEST_ROLE = 'at-qa'
const TEST_WORDS = { pass: '通过', fail: '不通过', env: '跑不起来' }
export const TEST_VERDICT_LINES = Object.values(TEST_WORDS).map((w) => `结论：${w}`)
const LINES = TEST_VERDICT_LINES.map((l) => `「${l}」`).join('')

// NFKC 之后匹配（全角冒号成了半角）。行首容许的装饰与验收结论那一条（verdict.mjs 的 VERDICT_RE）一路；「结论」前面可以带「测试」。「不通过」「跑不起来」
// 按前缀认（后面接原因）；「通过」严格——「通过（有一条没跑）」读不出，不猜。
const TEST_RE = /^[\s#>*_`\-「【]*(?:测试)?结论[\s*_`]*:[\s*_`]*(?:(不通过|跑不起来)|通过[\s*_`」】。.!]*$)/

/** 测试报告首行：'pass' | 'fail' | 'env'；读不出（第一个非空行不是三者之一、没有非空行、不是文字）回 null。BOM、CRLF 照读。 */
export function testVerdict(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : typeof bytes === 'string' ? bytes : null
  if (text === null) return null
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '')
  if (first === undefined) return null
  const m = TEST_RE.exec(first.normalize('NFKC'))
  if (!m) return null
  if (m[1] === undefined) return 'pass'
  return m[1] === TEST_WORDS.fail ? 'fail' : 'env'
}

/** 测试那一段：阶段链上第一个产者里有 at-qa 的验证段，它的第一份产物，与它之前最近的执行段（测试没过回到那里）。读不出、没有这一段回 null。 */
export function testStageOf(stages) {
  if (!isStageChain(stages)) return null
  const ids = Object.keys(stages)
  for (const [i, stageId] of ids.entries()) {
    const stage = stages[stageId]
    if (!isVerifyStage(stage) || !stageRoles(stage).includes(TEST_ROLE)) continue
    const name = productsOfStage(stage)[0]
    if (typeof name !== 'string') return null
    const implStage = ids.slice(0, i).reverse().find((id) => isRolePatternStage(stages[id])) ?? null
    return { stageId, name, implStage }
  }
  return null
}

/**
 * 测试报告现在拦不拦（H6 与【阶段】共用一份）：测试那一段整段裁掉、谁都没叫过的，不拦；报告不在、读不出来，交给别的判据（空的、还是上一轮的，H6 里
 * 推进判据排在前面先拒，【阶段】那一侧也不判齐，走不到这里）；首行「通过」「跑不起来」、或者门禁记下的照现状交付批准的 sha 等于它现在的 sha，不拦。
 * 拦的给 { name, stageId, implStage, verdict }（verdict 是 'fail' 或 null——读不出）。approvedShas：readDeliverApprovals 按这份报告的名字读出来的。
 */
export function testBlock({ stages, state, prior, bytesOf, dispatched = null, approvedShas = [] }) {
  const ts = testStageOf(stages)
  if (!ts || wholeStageTrimmed(stages, ts.stageId, state, prior, dispatched)) return null
  let bytes = null
  try {
    bytes = bytesOf(ts.name)
  } catch {
    bytes = null
  }
  if (!bytes) return null
  const verdict = testVerdict(bytes)
  if (verdict === 'pass' || verdict === 'env') return null
  if (Array.isArray(approvedShas) && approvedShas.includes(sha256OfContract(bytes))) return null
  return { ...ts, verdict }
}

/** 测试报告那一句：首行怎么了、出路。段 id、角色名、产物名来自阶段链，原样。 */
export function testBlockText(block) {
  if (block.verdict === 'fail') {
    return (
      `${block.name} 第一行是「结论：不通过」，测试没过不能推进出 ${block.stageId}：照 /agent-team:at 第 3 节的「回退」记回到 ${block.implStage ?? '实现那一段'}` +
      '（测试没过、缺测试都回那里；根因在更早一段的，回到那一段），修好之后重新走到这里。没过的那几条不修、要带着它们往下走的（项目里本来就挂着的用例、' +
      '不稳定的用例、返工预算耗尽），那是用户的决定：照 /agent-team:at 第 4 节先往 escalations 记一条（answer 写空串；kind 照问的那一类记——返工预算耗尽是' +
      ' budget-exhausted，要用户在没过的用例与契约之间取舍的是 contract-conflict），再用 AskUserQuestion 问——一道单选题' +
      `（multiSelect 设 false），那一项的标签逐字写「${DELIVER_LABEL}」；用户选了它，门禁记下这条批准（只对现在这份 ${block.name} 有效），再推进。` +
      `问不了用户的（工具面里没有 AskUserQuestion），请用户在对话里单独发一条只写「${DELIVER_LABEL}」的消息`
    )
  }
  return (
    `${block.name} 第一行不是${LINES}之一，门禁读不出测试结论：在 ${block.stageId} 里同段重派 ${TEST_ROLE}，让它把第一行照格式写` +
    '（同一段里重派不计返工）'
  )
}

/**
 * H6 的测试报告判据（docs/66）：只管推进出测试那一段的那一次（写入前停在测试那一段、写入后到了后面的段）。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function decideTestVerdict({ before, after, stages, bytesOf, dispatched = null, approvedShas = [] }) {
  if (!isPlainObject(before) || !isPlainObject(after) || !isStageChain(stages)) return { ok: true }
  const ts = testStageOf(stages)
  if (!ts) return { ok: true }
  const ids = Object.keys(stages)
  if (before.stage !== ts.stageId || ids.indexOf(after.stage) <= ids.indexOf(ts.stageId)) return { ok: true }
  const block = testBlock({ stages, state: after, prior: before, bytesOf, dispatched, approvedShas })
  if (!block) return { ok: true }
  return { ok: false, reason: `agent-team H6 返工预算：${testBlockText(block)}。` }
}

/**
 * 【阶段】在测试那一段齐了时补的一句，与 H5b 的拒绝理由共用写者那一支：写者是 at-qa、首行读不出——叫它把第一行改好再停；写者是 at-qa、首行不通过——
 * 说推进会被拒、回报时照实说；别的写者（项目经理）——照 H6 的拒绝理由给出路。
 */
export function testStageNote({ block, writer }) {
  if (!block) return ''
  if (writer === TEST_ROLE && block.verdict === null) {
    return (
      `你写的 ${block.name} 第一行读不出测试结论：把第一行改成${LINES}之一（第一行之前不写标题；通过这一行不夹别的话，不加表情、括号、条数；` +
      `不通过、跑不起来后面可以接冒号写原因，例如「结论：不通过：缺测试」），改完再停下——不改，你停下时门禁会拦回来，推进出 ${block.stageId} 也会被拒。`
    )
  }
  if (writer === TEST_ROLE) {
    return `测试结论是「结论：不通过」：推进出 ${block.stageId} 会被拒，项目经理会回退到 ${block.implStage ?? '实现那一段'}、或者问用户要不要照现状交付——回报时照实说` +
      '（这一趟之前就挂着的用例逐条注明）。'
  }
  return `推进出 ${block.stageId} 会被 H6 拒：${testBlockText(block)}。`
}
