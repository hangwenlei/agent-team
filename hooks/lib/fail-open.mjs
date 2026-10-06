// 门禁判不出来而放行时，说给谁听、说什么（M3v，docs/30，全量审查第 12 条）。纯函数，不做 I/O：gate.mjs 只拿结果写流、退出。
//
// 此前这一族只往 stderr 写一行（gate.mjs 的 failOpenNotice）：模型看不到，用户在默认界面上也看不到。丢了 current-run 的
// 那一趟里，PM 写契约拿不到哈希，commands/at.md 让它按「门禁没在跑」叫停——门禁明明在跑，只是读不出 run。现在：
//   - PM 自己发起的调用上（isContractWriter），PostToolUse 的受信回传里说一段【门禁】：哪道没做、为什么、怎么修；
//     同时给用户一行 systemMessage。
//   - PreToolUse 上不发受信块：几道 hook 的 context 在那里被平台并成一段、不标来源，本插件的受信块排在前面时，后面
//     紧跟的别家文字读起来就是它的续行（会话 ccf48d1e）。PostToolUse 上各家各成一条（会话 df24bc74）。
//   - SubagentStop 上什么都不发：exit 0 带 additionalContext 等于拦截（续跑、计入 CLAUDE_CODE_STOP_HOOK_BLOCK_CAP、换掉
//     子代理的回报），systemMessage 只进子代理自己的转录。
// 这三条由 hookOutput 在结构上保证，不靠调用点记得。平台依据与会话号在 docs/30 §1。
//
// ⚠️ systemMessage 只给用户看、不进模型，画在界面上：只许固定文字，用 README 的门禁名，不拼 reason、stage 或任何磁盘值
// （docs/27 §1 的第四条通道）。受信块里的外部值照 docs/27 的规矩引：stage 用 quote，异常消息用 quote；reason 不拼进来
// ——它带绝对路径，修法用原因短码（runctx 的 cause）选。
import { isKnownStage } from './deliverable.mjs'
import { CHECKS } from './checks.mjs'
import { quote, trustedBlock } from './trusted.mjs'

// 最外层 catch 发现这次进程已经写出结果（拒绝或回传）时，往 stderr 补的那一句：再写一份，两份 JSON 会让拒绝失效、回传
// 全丢；照那个结果的退出码退出。只有注入（process.exit 被换成抛异常）走得到，tests/helpers/gate-runner.mjs 的出口契约见到它就红。
export const SECOND_WRITE_NOTE = 'agent-team：这次进程已经写出过结果，崩溃之后照那个结果退出，不再写第二份。'

// hooks/lib/runctx.mjs 的 unreadable 出口带的 cause。
export const CAUSES = ['pointer', 'runs', 'state', 'project', 'plugin']

// README 里的门禁名（「顺序由门禁强制」那一条）；ledger 不是门禁，用户那一侧叫它账本。
// M3z（docs/34）：两个返工批准记录器（approval-ask、approval-prompt）用户那一侧叫「返工批准」。
export const GATE_NAME = {
  readiness: '前置就绪',
  deliverable: '交付物核验',
  'stop-gate': '交付物核验',
  ledger: '账本',
  'approval-ask': '返工批准',
  'approval-prompt': '返工批准',
  completion: '交付物核验',
}
// 记录器不放行任何东西：它读不出输入、自己出错，后果是「这次的回答没有记下」，通用文案里的「放行」会说错后果（P3）。
const RECORDERS = new Set(Object.keys(CHECKS).filter((c) => CHECKS[c].recorder === true))

const CAUSE_PHRASE = {
  pointer: 'current-run 指针丢了或坏了',
  runs: '.agent-team/runs 读不出来',
  state: '当前 run 的 state.json 读不出来',
  project: '.agent-team/project.json 读不出来',
  plugin: '插件自己的文件读不出来',
}
const causePhrase = (cause) => CAUSE_PHRASE[cause] ?? '运行状态读不出来'

const POINTER_FIND =
  '用 Glob 找 `.agent-team/runs/*/state.json`（只 Glob `runs/*` 列不出目录）。只有一趟，就把它的目录名写回 ' +
  '`.agent-team/current-run`；不止一趟时，指针原本指向最后建的那一趟（run id 以日期时刻开头）：读各自的 state.json ' +
  '核实，拿不准就问用户，不要把较早、没走完的那一趟当成当前 run；'

const FIX = {
  // 「一趟都没有」那半句在派发与写入时这么说：PM 正在干活，多半是偏离了 /agent-team:at 第 1 节的顺序（先写了契约）。
  pointer: POINTER_FIND + '一趟都没有 state.json，就照 /agent-team:at 第 1 节先写 state.json，再写 current-run。',
  runs: '`.agent-team/runs` 读不出来（比如它是一个文件，不是目录）：把这件事告诉用户，由用户处理，不要自己删改它。',
  // 写明它在哪：真实会话里只说「当前 run 的 state.json」时，模型把它写到了项目根（docs/30 §3）。
  // 认不出来的 contract_sha：真实会话里 PM 用 Bash 自己算，LF 的契约上碰巧对得上，CRLF 签出的就对不上（门禁先统一行尾）。
  state:
    '用 Write 写回一份合法的完整 `.agent-team/runs/<current-run 里的 run id>/state.json`（顶层键照 /agent-team:at 第 1 节）；' +
    '能从原文认出来的 history、rework、artifacts、rework_base、closed_at 照原样保留——返工计数只许增；认不出来的 contract_sha 写 PENDING，' +
    '写回之后原样重写一次 00-contract.md、从回传里拿 sha，不要用 Bash 自己算（门禁先统一行尾再算，自己算的对不上）。' +
    '写回之后告诉用户 state.json 是重建的、哪些字段是照猜补的。',
  project: '用 Write 写回一份合法的完整 `.agent-team/project.json`（照 /agent-team:at-init 第 2、3 节）。',
  plugin: '改 `.agent-team` 修不好它：停下，告诉用户重装或更新 agent-team 插件，不要去改插件目录下的文件。',
}
const FALLBACK = '把这件事告诉用户：门禁读不出这个项目的运行状态，原因不明。'

// 命令开头（门禁自检的追加句）按命令分（docs/30 §3 的两轮复核）：
//   - /agent-team:at 要建新 run，不该碰原来那趟：第二轮真实会话里，通用修法排在前、「照建」排在后时，8 次里 3 次先改了旧 run，
//     两次还用新需求覆盖了旧契约（旧 state 读不出来时 H6 没有基线，H3、H4 对 PM 放行，门禁挡不住）。所以这一支排第一、明写不写
//     原来那趟 run 目录；告诉用户不挂在「收尾」上——那个词撞上 commands/at.md 第 6 节的标题，停在 S1 时到不了，0/4 生效。
//   - /agent-team:at-resume 才修；那里没有用户的需求，「一趟都没有 state.json」时补建 run 连契约的「用户原话」都填不了。
//   - /agent-team:at-init 不在那里修 run（project.json 坏了例外：at-init 就是修它的）。
const AT_BRANCH =
  '这条命令是 /agent-team:at 的话：不要写原来那趟 run 目录下的任何文件，照第 1 节另起一个 run id 建新 run；' +
  '这一轮回复用户时（不论停在哪一步）把原来那趟 run 的问题与它的 run id 告诉用户。'
const atResume = (fix) => `这条命令是 /agent-team:at-resume 的话：${fix}`
const POINTER_NONE_AT_RESUME =
  '一趟都没有 state.json 的话，照 /agent-team:at-resume 第 1 节告诉用户没有可续的 run，并照实说 runs/ 下那几个目录里有什么' +
  '（空目录、只有契约……），不要自己补 state.json，也不要删目录。'
const AT_START_PLUGIN =
  '改 `.agent-team` 修不好它：告诉用户重装或更新 agent-team 插件，不要去改插件目录下的文件；要建或续 run 的命令在这里停下。'
const AT_INIT = '这条命令是 /agent-team:at-init 的话，不在这里修，收尾时告诉用户。'

/**
 * 按原因给的修法。H5a、ledger 与门禁自检共用这一份。atStart：门禁自检的追加句用，那时 PM 在一条命令的开头，按命令分（见上）；
 * 丢指针、state.json 坏了时返回的整段自带命令的分支，不以「修法：」开头。project.json 坏了照样要先修（写路径隔离靠它），
 * runs 读不出来、插件坏了本来就建不了 run。
 */
export function runContextFix(cause, { atStart = false } = {}) {
  if (!atStart) return FIX[cause] ?? FALLBACK
  if (cause === 'pointer') return AT_BRANCH + atResume(POINTER_FIND + POINTER_NONE_AT_RESUME) + AT_INIT
  if (cause === 'state') return AT_BRANCH + atResume(FIX.state) + AT_INIT
  if (cause === 'project') return FIX.project
  if (cause === 'plugin') return AT_START_PLUGIN + AT_INIT
  return (FIX[cause] ?? FALLBACK) + AT_INIT
}

const BUBBLE = '⚠️ 这一条你处理不了：把它原样冒泡给派你的人，让它一路带到 PM；不要自己把它咽掉——咽掉之后没有任何人会再看见它。'

/** H5a：PM 发起的派发，门禁读不到运行状态。 */
export function dispatchUnreadableNotice(cause) {
  const fixable = cause !== 'plugin' && cause !== 'runs'
  return (
    `【门禁】这次派发没有做前置就绪校验，交付物核验也不会做——门禁读不到这个项目的运行状态（${causePhrase(cause)}）。` +
    '修好之前，被派角色的每一次 Edit/Write（包括 run 目录里它自己的产物）都会被拒。' +
    `修法：${runContextFix(cause)}` +
    (fixable
      ? '派发在后台跑的话，现在修好，它后面的写入就能过；它返回之后去磁盘核实产物，没落盘的再派一次。'
      : '它返回之后去磁盘核实产物。')
  )
}

/** H5a：PM 在没有 run 时派发一个团队角色——有意的放行，说一次。 */
export function dispatchNoRunNotice() {
  return (
    '【门禁】这次派发没有做前置就绪校验，交付物核验也不会做——当前没有进行中的 run（找不到 .agent-team/current-run，' +
    'runs/ 下也没有 run）。这是有意的放行：没有 run 时，团队角色写文件不受写路径隔离、契约保护与交付物核验约束。' +
    '用户只是要一次临时派发的话照常做完，并把这一点告诉用户；要按团队流程走，告诉用户可以用 /agent-team:at 起一趟 run。' +
    '你以为这里有进行中的 run 的话：门禁从会话当前目录往上找 .agent-team，核对当前目录在不在那个项目里；在的话，看 .agent-team/current-run ' +
    '与 .agent-team/runs/ 还在不在——没进版本库的这几份会被 git clean、git stash -u 这类命令一起清掉或藏起：告诉用户（藏起的他能用 ' +
    'git stash pop 找回，清掉的找不回），这些 git 命令你不要自己跑。'
  )
}

/** ledger：PM 写 run 目录下的文件，门禁读不到运行状态——契约与产物的哈希拿不到。 */
export function ledgerUnreadableNotice(cause) {
  return (
    `【门禁】这次写入没有回传（契约与产物的哈希、账本校验）——门禁读不到这个项目的运行状态（${causePhrase(cause)}）。` +
    `修法：${runContextFix(cause)}` +
    '若这是契约或你自己阶段的产物：修好之后用 Write 把它原样再写一次，哈希只从那次回传里拿，不要自己算（门禁先统一行尾' +
    '再算，自己算的对不上）；是契约的话第 1 节照旧逐字不动。写的是别的角色的产物的话，修好之后写路径门禁不让你再写它：' +
    '派它的产者重交一次；它不在你的派发名单上的话，经派得到它的那一层转派。别的文件本来就没有回传。'
  )
}

/** stage 缺失、不是字符串、不在阶段链里时怎么说它。与 validateState 同一口径：不写 quote(undefined)。 */
export function unknownStageDesc(stage) {
  return typeof stage === 'string' ? `state.stage 是 ${quote(stage)}，不在阶段链里` : 'state.stage 缺失或不是字符串'
}

/**
 * unknown-stage 的修法，按 history 末条分两支。H6 不许删 history、不许让任何阶段的出现次数变少，所以末条也坏着时
 * 「把末条改成真实阶段」会被拒；追加一个出现过的阶段又要记一次返工（critique semantics 3、testability 2 的实测）。
 * history 本身不是由对象组成的数组时，H6 的计数不认它（非对象的条目不计次数），「会拒」「出现过就记返工」都不成立——
 * 那一格不给具体改法，叫 PM 照写 state.json 时的回传改（docs/30 §3 的复核：照「写一个只含当前阶段的数组」做，会撞上
 * rework 与 history 对不上）。
 */
export function unknownStageFix({ state, stages }) {
  const raw = state && typeof state === 'object' ? state.history : undefined
  const isEntry = (e) => e !== null && typeof e === 'object' && !Array.isArray(e)
  if (!Array.isArray(raw) || !raw.every(isEntry)) {
    return (
      'history 的形状也不对（写 state.json 时的回传会逐条列出）：先照那份回传改；返工计数只许增、不许改小；' +
      '拿不准就停下，把 state.json 的情况告诉用户。'
    )
  }
  const lastStage = raw.length ? raw[raw.length - 1].stage : undefined
  if (isKnownStage(stages, lastStage)) {
    // lastStage 等于 stages.json 的一个键——插件自己的名字，原样。更早的条目里还有坏阶段时（支 2 修完留下的正是这种形状），
    // 照做之后写 state.json 的回传仍会报它，而 H6 不许改：说在前面，免得 PM 去改、撞上拒绝。
    const residue = raw.some((e) => !isKnownStage(stages, e.stage))
    return (
      `把 state.stage 改回 history 末条的 ${lastStage}，history 不动（用 Write 整份重写 state.json）。` +
      (residue
        ? 'history 里更早还有不在阶段链里的条目：是已知残留，不要改也不要删（返工预算门禁会拒），写 state.json 时的回传不再报它。'
        : '')
    )
  }
  return (
    'history 末条也不在阶段链里（或者 history 是空的）。不要改、也不要删 history 里已有的条目——返工预算门禁会拒；' +
    '往 history 追加一条真实的当前阶段，同时把 state.stage 设成它。这个阶段要是在 history 里出现过，追加会记一次返工：' +
    '那就停下，把取舍告诉用户，不要自己追加。history 里那条坏阶段是已知残留，不用再修，写 state.json 时的回传不再报它。'
  )
}

/** H5a：stage 不在阶段链里，交付物核验这次没做。收件人改不了 state.json 时照 buildDriftNotice 的先例冒泡，修法照带。 */
export function unknownStageNotice({ state, stages, recipientCanWriteState }) {
  const head =
    `【门禁】交付物核验这次没有做——${unknownStageDesc(state?.stage)}。在它改对之前，交付物核验对每一次派发都不做。`
  const fix = unknownStageFix({ state, stages })
  return recipientCanWriteState
    ? `${head}修法：${fix}`
    : `${head}${BUBBLE.replace('这一条你处理不了', '这一条你改不了：state.json 是编排层的控制文件，只有 PM 写得了')}` +
        `PM 的修法：${fix}`
}

/**
 * 最外层 catch：fail open 的检查项中途崩了。只有 deliverable 与 ledger 有这一段（PostToolUse）；readiness 在
 * PreToolUse 上不发受信块，stop-gate 在 SubagentStop 上什么都不发。ctx 正常时崩溃，只有这次调用的发起者看得见，
 * 所以不按调用者门控，非 PM 收到冒泡句（critique semantics 5）。
 */
export function crashContext(check, err, recipientIsPm) {
  const msg = quote(err && typeof err === 'object' && 'message' in err ? err.message : err, { max: 120 })
  let text
  if (check === 'ledger') {
    text =
      `【门禁】这次写入的回传没有算完——门禁自己出了错（${msg}）：契约与产物的哈希、账本校验这次都没有。` +
      '若这是契约或阶段产物，先核实它落了盘；要哈希就用 Write 原样再写一次它，哈希只从回传里拿、不要自己算；' +
      '再出错就停下，把这一段原样告诉用户。'
  } else if (check === 'deliverable') {
    text =
      `【门禁】交付物核验这次没有做完——门禁自己出了错（${msg}）：这次派发的交付物核验与账本比对都没有。` +
      '等被派角色返回后，自己去 run 目录核实它该交的产物在不在；再出错就把这一段原样告诉用户。'
  } else if (check === 'completion') {
    text =
      `【门禁】这次完成通知的交付物核验没有做完——门禁自己出了错（${msg}）。` +
      '去 run 目录核实刚完成的那个角色该交的产物在不在；再出错就把这一段原样告诉用户。'
  } else if (check === 'approval-ask') {
    // M3z（docs/34）：approval-prompt 在 UserPromptSubmit 上，什么都发不了（hookOutput），这里只有 approval-ask。
    text =
      `【门禁】这次的回答没有记下——门禁自己出了错（${msg}）：用户选的若是「再返工一轮」，它没有记成返工批准。` +
      '重新问一次；再出错就停下，把这一段原样告诉用户。'
  } else {
    return null
  }
  return recipientIsPm ? text : text + BUBBLE
}

/**
 * 门禁自检（writepath 对 .agent-team/gate-check 的拒绝）理由末尾的追加句。只在调用者是 PM、自检写在门禁认的项目根下
 * 时由 gate.mjs 调用。丢指针时 PM 在 /agent-team:at-resume 里只读不写、/agent-team:at 只写控制文件，别的落点都开不了口，
 * 旧 run 会无声地变成孤儿（critique behavior 0）。no-run 不追加：那是「没有 run」，不是「判不出来」。
 */
export function selfCheckAppendix(ctx) {
  if (!ctx || typeof ctx !== 'object') return ''
  if (!ctx.ok) {
    if (ctx.kind !== 'unreadable') return ''
    const guide = runContextFix(ctx.cause, { atStart: true })
    // 丢指针、state.json 坏了那两支自带命令的分支（以「这条命令是」开头），不再冠「修法：」。
    return `另外，门禁读不到这个项目的运行状态（${causePhrase(ctx.cause)}）。${guide.startsWith('这条命令是') ? '' : '修法：'}${guide}`
  }
  if (isKnownStage(ctx.stages, ctx.state?.stage)) return ''
  return (
    `另外，交付物核验在 state.stage 改对之前不做——${unknownStageDesc(ctx.state?.stage)}。` +
    `${AT_BRANCH}${atResume(unknownStageFix({ state: ctx.state, stages: ctx.stages }))}${AT_INIT}`
  )
}

/** 给用户看的那一行。只许固定文字（见文件头）。 */
export function systemMessage(kind, { cause, check } = {}) {
  const tail = cause === 'plugin' ? '需要重装或更新 agent-team 插件。' : '项目经理已收到修法。'
  switch (kind) {
    case 'dispatch-unreadable':
      return `agent-team 前置就绪、交付物核验：这次派发没有做——${causePhrase(cause)}。${tail}`
    case 'dispatch-no-run':
      return 'agent-team 前置就绪、交付物核验：当前没有进行中的 run，这次派发不受门禁约束（有意的放行）。'
    case 'ledger-unreadable':
      return `agent-team 账本：这次写入没有回传哈希——${causePhrase(cause)}。${tail}`
    case 'unknown-stage':
      return 'agent-team 交付物核验：这次派发没有做——state.stage 不在阶段链里。项目经理已收到修法。'
    case 'approval-recorded':
      return 'agent-team 返工批准：已记下，项目经理已收到。'
    case 'approval-skipped':
      return 'agent-team 返工批准：这次的回答没有记成批准，项目经理已收到原因。'
    case 'input':
      if (RECORDERS.has(check)) {
        return 'agent-team 返工批准：读不出这次的 hook 输入，这次的回答没有记下。Claude Code 与插件的版本可能不匹配，两者都更新后再试。'
      }
      return (
        `agent-team ${GATE_NAME[check] ?? '门禁'}：读不出这次的 hook 输入，没有做校验、放行。` +
        'Claude Code 与插件的版本可能不匹配，两者都更新后再试。'
      )
    case 'crash':
      if (RECORDERS.has(check)) return 'agent-team 返工批准：门禁这次出错，这次的回答没有记下。'
      return check === 'readiness'
        ? 'agent-team 前置就绪：门禁这次出错，这次派发没有做前置产物校验、放行。'
        : `agent-team ${GATE_NAME[check] ?? '门禁'}：门禁这次出错，没有做完校验、放行。`
    default:
      return null
  }
}

/**
 * 一次 fail open 输出的形状（M3v）。gate.mjs 的 emitHookJson 只做 I/O：写 stdout、有 bug 就写 stderr、退出。
 * 永不产出 permissionDecision、顶层 decision、continue：allow 会绕过权限确认，continue:false 会停整轮。
 * - PostToolUse：contexts 并成一份受信块，进 hookSpecificOutput.additionalContext；systemMessage 在顶层。
 * - PreToolUse：只许 systemMessage；有 contexts 就丢掉并报 BUG（见文件头）。
 * - SubagentStop 与其它事件：stdout 为空；有东西要发就报 BUG。
 * - UserPromptSubmit（M4d，docs/38，全量审查第 19 条）：只有 checks.mjs 里标了 speaks 的检查项（completion）能发受信块，进
 *   hookSpecificOutput.additionalContext；systemMessage 不发（这一行会画在用户自己的消息底下）。别的检查项（approval-prompt）照旧恒为空。
 * @returns {{ stdout: string, bug: string | null }}
 */
export function hookOutput(event, { contexts = [], systemMessage: sm = null } = {}, check = null) {
  const parts = (Array.isArray(contexts) ? contexts : []).filter((c) => typeof c === 'string' && c)
  const message = typeof sm === 'string' && sm ? sm : null
  const bug = (what) => `agent-team BUG: ${JSON.stringify(event)} 上不能发${what}，这一段没有发出。\n`
  if (event === 'PostToolUse') {
    const out = {}
    if (parts.length) {
      out.hookSpecificOutput = { hookEventName: event, additionalContext: trustedBlock(parts.join('\n\n')) }
    }
    if (message) out.systemMessage = message
    return { stdout: Object.keys(out).length ? JSON.stringify(out) : '', bug: null }
  }
  if (event === 'PreToolUse') {
    return {
      stdout: message ? JSON.stringify({ systemMessage: message }) : '',
      bug: parts.length ? bug('受信回传') : null,
    }
  }
  if (event === 'UserPromptSubmit' && typeof check === 'string' && CHECKS[check]?.event === event && CHECKS[check]?.speaks === true) {
    return {
      stdout: parts.length ? JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: trustedBlock(parts.join('\n\n')) } }) : '',
      bug: message ? bug('systemMessage') : null,
    }
  }
  return { stdout: '', bug: parts.length || message ? bug('回传或 systemMessage') : null }
}
