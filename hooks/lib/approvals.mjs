// 门禁记返工批准（M3z，docs/34，全量审查第 16 条）——纯函数部分。I/O（读运行上下文、读写 approvals.jsonl、回传）在 gate.mjs 的
// approval-ask（PostToolUse:AskUserQuestion）与 approval-prompt（UserPromptSubmit）两个检查项里。标签、上限、需不需要的单一真源在
// budget.mjs，这里只管「这一次的回答里有没有批准」与「回传怎么说」。
//
// ⚠️ 只认 CLI 判为 answered 的回答（2.1.286 的 outcome 分类：afk_timeout、follow_up、responded、answered、unanswered）。tool_response
//    里带 afkTimeoutMs（离开键盘、对话框自动提交了已勾的选项）、followUp === true（用户要追问）、response 是非空字符串（用户另写了
//    一段话，模型只看得到那段话）的一律不记：那三种情况下模型收到的分别是「用户离开了，自行判断」「先别动手」「用户回复了……」，
//    门禁不能比模型看到的更宽（P6）。失效条件：tool_response 出现 questions、answers、annotations、response、afkTimeoutMs、followUp
//    之外的顶层键，就要重新核对这一条。
// ⚠️ 只认单选题（multiSelect 不是 true）上的字符串答案：多选的答案在不同宿主、不同版本上是数组或逗号串（P2），一个勾选不等于
//    「只选了这一项」。
// ⚠️ prompt 只认整条：UserPromptSubmit 也对 task-notification（子代理回报、后台 Bash 的说明）触发，那里的文字是模型写的（P1）；
//    用户贴回 PM 的问题原文也会带上标签（O7）。整条规范化之后等于标签，才是用户自己发的那一条批准。
import { approvalIntent, parseApprovalLabel, needOf } from './budget.mjs'
import { isPlainObject, isStageChain } from './stages.mjs'
import { quote } from './trusted.mjs'
import { runContextFix } from './fail-open.mjs'
import { closedAt } from './closing.mjs'

/**
 * PostToolUse:AskUserQuestion 的 tool_response 里有没有批准。items 里每一项是 { stage }（认出来的标签，还没核在不在链上）或
 * { why }（像批准却不记的形状原因）。整次被排除时 excluded 是原因、items 为空；回答里一个像批准的都没有时两样都空（门禁不出声）。
 */
export function askAnswers(toolResponse) {
  const none = { excluded: null, items: [] }
  if (!isPlainObject(toolResponse) || !isPlainObject(toolResponse.answers)) return none
  const questions = Array.isArray(toolResponse.questions) ? toolResponse.questions : []
  const items = []
  for (const [text, answer] of Object.entries(toolResponse.answers)) {
    const q = questions.find((x) => isPlainObject(x) && x.question === text)
    if (Array.isArray(answer)) {
      if (answer.some((a) => approvalIntent(a))) items.push({ why: 'array' })
      continue
    }
    const intent = approvalIntent(answer)
    if (!intent) continue
    if (q && q.multiSelect === true) items.push({ why: 'multi' })
    else if (intent.stage) items.push({ stage: intent.stage })
    else items.push({ why: 'malformed' })
  }
  if (!items.length) return none
  const tr = toolResponse
  // 复核（docs/34 §3，platform-7）：用户在批准那道题的选项旁写了备注（annotations[题].notes），模型看得到它；门禁不能比模型看到的更宽。
  const notes = Object.entries(tr.answers).some(
    ([text, answer]) =>
      approvalIntent(answer) &&
      isPlainObject(tr.annotations) &&
      isPlainObject(tr.annotations[text]) &&
      typeof tr.annotations[text].notes === 'string' &&
      tr.annotations[text].notes.trim() !== '',
  )
  const excluded =
    tr.afkTimeoutMs !== undefined ? 'afk'
      : tr.followUp === true ? 'follow-up'
        : typeof tr.response === 'string' && tr.response.trim() !== '' ? 'response'
          : notes ? 'notes'
            : null
  return excluded ? { excluded, items: [] } : { excluded: null, items }
}

/** UserPromptSubmit 的整条 prompt 是不是规范标签：是就给段，否则 null。 */
export function promptAnswer(prompt) {
  return parseApprovalLabel(prompt)
}

/**
 * 逐条判需不需要：前一条记下之后（grants 跟着长）再判下一条。返回每一项 { stage, covers }（要记）或 { stage?, why }（不记）。
 * state、stages 是当前 run 读出来的；读不出来的情形由调用方处理（不调这里）。
 */
export function planApprovals({ items, state, stages, grants }) {
  const known = [...(Array.isArray(grants) ? grants : [])]
  const out = []
  for (const item of Array.isArray(items) ? items : []) {
    if (!item.stage) {
      out.push(item)
      continue
    }
    // M4a（docs/35）：已收口的 run 不再回退、不再返工，批准记进去也用不上（H6 的冻结会拒那次回退）。
    if (closedAt(state) !== null) {
      out.push({ stage: item.stage, why: 'closed' })
      continue
    }
    if (!isStageChain(stages) || !Object.hasOwn(stages, item.stage)) {
      out.push({ stage: item.stage, why: 'off-chain' })
      continue
    }
    const covers = needOf({ state, stages, grants: known, target: item.stage })
    if (!covers.length) {
      out.push({ stage: item.stage, why: 'not-needed' })
      continue
    }
    known.push({ reworkTo: item.stage, covers })
    out.push({ stage: item.stage, covers })
  }
  return out
}

/** approvals.jsonl 的一行（不带换行）。 */
export function approvalLine({ at, source, stage, covers }) {
  return JSON.stringify({ at, source, rework_to: stage, covers })
}

const ASK_AGAIN =
  '要批准就重新问一次：一道单选题（multiSelect 设 false），两个选项的标签逐字写「再返工一轮：回到 <段>」与「停在这里」，' +
  '推荐写在问题正文或选项说明里，不写进标签。'

function whyText(why, name, cause) {
  switch (why) {
    case 'afk':
      return `用户离开了键盘、对话框超时自动提交了（不算用户确认过的回答）。用户回来之后${ASK_AGAIN}`
    case 'follow-up':
      return `用户要追问，没有确认。先回答用户的追问，${ASK_AGAIN}`
    case 'response':
      return `用户另写了一段话（以那段话为准，照原话办，它不算批准）。用户要再返工一轮的话，${ASK_AGAIN}`
    case 'notes':
      return `用户在选项旁写了备注（以备注为准，照它办，这一次不算批准）。用户确认要再返工一轮的话，${ASK_AGAIN}请用户不写备注直接选。`
    case 'multi':
    case 'array':
      return `这是一道多选题（或者答案是多选的形状），一个勾选不等于只选了这一项。${ASK_AGAIN}`
    case 'malformed':
      return `回答像是要再返工一轮，但标签认不出（带了别的后缀，或者夹了别的话）。${ASK_AGAIN}`
    case 'off-chain':
      return `标签里的段 ${name} 不在阶段链上。${ASK_AGAIN}`
    case 'not-needed':
      return (
        `现在回到 ${name} 不需要批准：它不是一次回退，或者这一轮走完不超过返工上限（上限内问的不记）。照常记回退就行；` +
        '门禁拒了某次回退、说要先问用户时再问。'
      )
    case 'closed':
      return '这一趟已经收口，批准记不进去：收口之后不再回退、不再返工。交付之后的新改动或修复另起一趟（/agent-team:at）。'
    case 'no-run':
      return '当前没有进行中的 run，批准无处可记。'
    case 'unreadable':
      return `门禁读不到这个项目的运行状态，批准记不下。修法：${runContextFix(cause)}修好之后重新问一次。`
    case 'write-failed':
      return (
        '门禁写不进批准记录（run 目录里的 approvals.jsonl）。把这件事告诉用户，请用户检查那个文件（是不是成了目录、有没有写权限、' +
        '磁盘满没满），修好之后再问一次——对话里单独发标签那一路写的是同一个文件，同样记不下。'
      )
    default:
      return ASK_AGAIN
  }
}

/**
 * approval-ask 的受信回传（每条结果一段）。results 是 planApprovals 的输出（或调用方按原因造的 { stage?, why }）；total 是记下之后
 * 这一趟共有的批准条数；cause 是读不到运行状态时 runctx 给的原因短码。stages 给了就用来判段名是不是插件自己的名字：记下的段与
 * covers 都核过在链上，原样；别的段名来自用户的回答，不在链上的加引号。
 */
export function approvalNotices({ results, total, cause, stages } = {}) {
  const out = []
  for (const r of Array.isArray(results) ? results : []) {
    if (Array.isArray(r.covers)) {
      out.push(
        `【门禁】已记下返工批准：回到 ${r.stage}（覆盖 ${r.covers.join('、')}；这一趟共 ${total} 条）。` +
          '照 /agent-team:at 第 4 节：契约追加修订块（回传给你新的 contract_sha）；之前那次被拒的写入（回退或推进），在原来的内容上' +
          '补进这条 escalation 与新的 contract_sha 再写一次。没有被拒的写入、是【阶段】或【返工预算】叫你问的：记上 escalation 与 ' +
          'contract_sha，照常往下走这一轮，不要为它再记一次回退。',
      )
      continue
    }
    const known = typeof r.stage === 'string' && isStageChain(stages) && Object.hasOwn(stages, r.stage)
    const name = known ? r.stage : quote(r.stage)
    out.push(`【门禁】这次的回答没有记成返工批准：${whyText(r.why, name, cause)}`)
  }
  return out
}
