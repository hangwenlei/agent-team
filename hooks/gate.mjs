#!/usr/bin/env node
// 门禁的判定主体。第一个参数选择检查项。
// 进程入口是 ./boot.mjs（hooks.json 注册的是它）：它动态 import 本文件，本文件任何一个
// 静态依赖加载失败时，由它按 checks.mjs 的失败策略表收尾（M3p，docs/24 §2.2）。本文件
// 被 import 时顶层照常跑 main()，直接 `node gate.mjs <检查项>` 也照常能跑。
// 约定：exit 0 + stdout 上的 JSON 决策 = 生效；无输出 = 走正常权限流程。
// SubagentStop 是例外——它的拒绝走 exit 2 + stderr，不是这套 JSON，
// 见 hooks/lib/deny.mjs 的 denyOutput（拒绝输出契约的唯一真源）。
//
// 入口只做「该检查项声明的前置校验」，不做统一校验——H1–H5 分布在三种
// hook 事件上，输入形状不同（规格 §6 注记）。

import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHECKS, KNOWN_CHECKS } from './lib/checks.mjs'
import { MAIN, callerOf, decideDelegation, malformedCaller, malformedCallerReason, stripPluginPrefix } from './lib/decide.mjs'
import { denyOutput, crashNotice } from './lib/deny.mjs'
import { projectRootFrom, readProjectConfig, readRunContext } from './lib/runctx.mjs'
import { candidateStages, decideReadiness } from './lib/readiness.mjs'
import { decideWritePath, stageOwnerOfRunPath } from './lib/writepath.mjs'
import { decideContractGuard, isContractWriter } from './lib/contract-guard.mjs'
import { decideRework, decideReworkBase, parseStateText, replayEdit } from './lib/rework-guard.mjs'
import { makeFreshness, staleByStage, splitByAccept, VERIFY_REDO } from './lib/freshness.mjs'
import { isBlankText } from './lib/text-norm.mjs'
import { normalizeText } from './lib/text-norm.mjs'
import { decideDeliverable, isBubbleStop, isKnownStage } from './lib/deliverable.mjs'
import {
  AGENT_ID_RE,
  bubbleOf,
  coordinatorProgress,
  dispatchLine,
  dispatchOf,
  dispatchPhase,
  dispatchedByStage,
  explainMissing,
  lastStop,
  missingCause,
  parseNotifications,
  readDispatchLog,
  reportTexts,
  stopLine,
} from './lib/completion.mjs'
import { mayWaive, dispatchedIn, wholeStageTrimmed } from './lib/advance.mjs'
import { SUBAGENT_STOP_RETRY_NOTE } from './lib/retry-budget.mjs'
import { APPROVALS_FILE, DELIVERED_FILE, DISPATCHES_FILE, isControlFile, isGateFile, leafName, mayBeGateFile, mayBeStateFile } from './lib/control-files.mjs'
import {
  CONTRACT_BASE_FILE,
  DRIFT_FIX,
  bodyShaOf,
  decideContractBase,
  driftHead,
  initialBase,
  lastDispatchAtOf,
  outdatedFix,
  outdatedProducts,
  readContractBase,
  revisedBase,
  section1Drift,
  verifyShasOf,
} from './lib/contract-base.mjs'
import { readGrants } from './lib/budget.mjs'
import { askAnswers, promptAnswer, promptDeliver, planApprovals, approvalLine, approvalNotices } from './lib/approvals.mjs'
import { acceptanceBlock, acceptanceOf, acceptanceVerdict, decideAcceptance, deliverLine, readDeliverApprovalEntries, readDeliverApprovals, verdictBlockerText, verdictStageNote } from './lib/verdict.mjs'
import { deliveredSnapshot, readSnapshot, makeDelivered, decideRedispatch, decideRedoWrite } from './lib/redo.mjs'
import { closedAt, lastStageId, closeBlockers, decideClosing, decideClosedDispatch } from './lib/closing.mjs'
import { computeReach } from './lib/reach.mjs'
import { validateState, isStageDone } from './lib/state.mjs'
import { CONTRACT_FILE, compareContractSha, sha256OfContract, shaOrNote } from './lib/contract-hash.mjs'
import { buildLedgerNotices, brokenProjectNotice, contractCheckNotice, reachCheckNotice, IMPL_RECORD_NOTE } from './lib/ledger.mjs'
import { validateProject } from './lib/project.mjs'
import { compareArtifacts } from './lib/artifact-drift.mjs'
import { decideCoverage } from './lib/coverage.mjs'
import { exoticPath, norm, underDir } from './lib/path-norm.mjs'
import { isPlainObject, isStageChain, isVerifyStage, participantsOf, isRolePatternStage, expandProduces, productsOfStage, stageRoles, producerOfName } from './lib/stages.mjs'
import { inline, quote } from './lib/trusted.mjs'
import { installTrace } from './lib/trace.mjs'
import { GATE_CHECK_PATH, gateCheckReason, isGateCheck, selfCheckIdentity } from './lib/gate-check.mjs'
import {
  SECOND_WRITE_NOTE,
  crashContext,
  dispatchNoRunNotice,
  dispatchUnreadableNotice,
  hookOutput,
  ledgerUnreadableNotice,
  runContextFix,
  selfCheckAppendix,
  systemMessage,
  unknownStageNotice,
} from './lib/fail-open.mjs'

const CHECK = process.argv[2]
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
// 门禁读的运行状态在**用户项目**里，不在插件目录里。项目根是从 cwd 往上最近的那个
// .agent-team，cwd 在启动项目（CLAUDE_PROJECT_DIR）里时不越过它——hook 进程的 cwd 是会话
// **当前**的 cwd，主线程 Bash 做过 cd 就停在子目录里，直接拿它当项目根会让 H2–H6 全部
// fail open；只拿 CLAUDE_PROJECT_DIR 又会在用户 /cd 到别的项目后看丢那边的 run
// （M3p，docs/24 §2.1；口径与理由在 hooks/lib/runctx.mjs 的 projectRootFrom）。
// 插件自身的文件（roster.json、stages.json）仍用 ROOT。
const ROOT_PROJECT = projectRootFrom(process.env, process.cwd())

// 门禁留痕（M3l，默认关）：打开时每次 exit 0 往 stderr 多写一行，让静默放行在转录里
// 留下 CLI 自己写的记录。纯旁路——不碰 stdout、不碰退出码、exit 2 那一支一个字不加、
// 绝不抛异常；四条硬约束与「它能证明什么、不能证明什么」写在 hooks/lib/trace.mjs 头部，
// 不在这里重复。注册放在 main() 之外、调用之前：这样 main() 一行都没跑的那种退出
// （M0 junction 守卫那个形状，见本文件末尾）也会留下一行 main=not-entered，而不是沉默。
const TRACE_STATE = { entered: false }
installTrace({ env: process.env, check: CHECK, proc: process, state: TRACE_STATE })

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return null
  }
}

// hook 输入必须是一个 JSON 对象（{tool_name, tool_input, agent_type, ...}）。
// null、数组、字符串、数字这些"能被 JSON.parse 解析但取不出字段"的输入，
// 语义上跟"读不到输入"是同一类坏——继续往下走只会在某次属性访问上悄悄
// 拿到 undefined，而不是被明确地拒绝。
//
// M2b 终审 A2：这里原来是逐字重拼的第五份判别式（形参名 input，函数体形状与
// hooks/lib/stages.mjs 的 isPlainObject 的 md5 相同）。改成调那一份。
// **名字留着**：`isValidInput` 说的是「hook 入口这一层对输入的要求」，与「什么叫
// 平凡对象」不是同一件事，而且 tests/writepath.test.mjs 的一段注释按名字指着它——
// 删名字会把那条指引变成悬空引用。留的是名字，不是第二份知识：判别式只剩一处。
function isValidInput(input) {
  return isPlainObject(input)
}

// docs/11 §1.4：roster.json 是插件自带文件，读坏概率低，但 isCoordinatorFor 与
// CHECK === 'delegation'/'ledger' 分支都靠它读出来的东西判定。不就地兜底的话，
// 读坏会一路抛到 gate.mjs 最外层 try/catch（见文件末尾），那层兜底是给「判定
// 逻辑中途崩溃」这整类问题用的通用 crashNotice（hooks/lib/deny.mjs），不专门
// 认 roster.json——而且它会让这次检查项的其余逻辑跟着一起放弃，比如
// deliverable 分支里已经算好但还没来得及发出去的账本比对（buildDriftNotice）。
// 这里就地捕获、留一行更具体的痕、退回空花名册：
// - decideDelegation（H1）已经把空对象花名册当一种已知的退化形状处理
//   （I-1 修复，Object.keys(roster).length === 0 时 deny，理由讲清楚是
//   roster.json 本身不合法，不是随便一条通用崩溃消息）；
// - computeReach（isCoordinatorFor 用它）对空对象同样安全：Object.keys({})
//   是空数组，算出的 reach 对任何角色都是「够不到任何人」，不会抛。安全，但那份触达表是假的
//   （「没有角色的触达超出」）——M3u 起 ledger 在花名册读坏时不发它（hooks/lib/ledger.mjs）。
// 退回空花名册不是「假装没事」，是把「读不出来」换算成这两处已经设计好的
// 「最保守」退化路径，而不是让整个检查项的判定半途而废。
// ⚠️ M3u：H3（decideWritePath）与 validateProject 也消费它。对 H3 来说空花名册**不是**天然保守的——H3 对
// 「不在花名册里」的调用者放行，{} 会让所有人都「不在花名册里」。所以 decideWritePath 先用 decide.mjs 的
// isValidRoster（与 H1 同一份）核花名册：读坏时，除 PM 之外一律拒（没有键的 at-qa、at-acceptance 在那之前的第 2 步就被拒了，
// M4f），不走那条放行。validateProject 读坏时不核对角色名，单列一条【插件】（其余键上的问题照报）。
// ⚠️ M3v：deliverable 分支没有 run 时判「这次派发派不派得动」（decideDelegation，读坏时判拒，于是不发「有意的放行」那一段）。
// ⚠️ M3w：H2（readiness）也消费它——按派发者给多段角色选段，要派发者沿派发边的触达（computeReach）。读坏时触达是空的、
// callerReach 传 null，按派发者选段退回老规则：既可能多拒（S2 已齐后返修 at-ui）也可能少查（S2 被裁时架构师派 at-ui），
// 但同一次派发 H1 对一切派发都拒（花名册不合法），所以结果不受影响。
function loadRoster() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'roster.json'), 'utf8'))
  } catch (e) {
    process.stderr.write(
      `agent-team：roster.json 读不出来（${quote(e?.message ?? e, { max: 120 })}），本次按空花名册处理——` +
        `派发白名单与协调者判定都会失效，请检查插件安装。\n`,
    )
    return {}
  }
}

// 拒绝的输出契约（按 hook 事件分派 stdout/stderr/exitCode）抽在
// hooks/lib/deny.mjs 的 denyOutput 里，是纯函数，被 tests/deny.test.mjs
// 直接单测过三个分支——包括 SubagentStop 那条 exit 2 + stderr 分支。单独抽
// 出来测是 Task 1 定下的：当时 stop-gate 还没有判定逻辑，这条分支从
// gate.mjs 这条路径永远走不到，只能靠人工代码走读，是「看起来健康、实际
// 什么都不做」的失效形状（Task 1 二轮评审）。Task 6 给 stop-gate 接上判定
// 逻辑之后，这条分支已经能被真实执行到了（下面 CHECK === 'stop-gate' 分支
// 的 denyAndExit 调用，回归见 tests/gate-deliverable.test.mjs 的 exit 2
// 用例），但 denyOutput 仍然保持纯函数、仍然被直接单测——子进程级测试证明
// "传导链接对了"，纯函数测试证明"契约本身没错"，两层不冲突，答的是不同的
// 问题。这里只做 I/O：拿到结果、写对应的流、退出，永不返回，调用点之后
// 不需要再写 exit。
function denyAndExit(reason, event) {
  const { stream, text, exitCode } = denyOutput(reason, event)
  DECIDED = exitCode
  process[stream].write(text)
  process.exit(exitCode)
}

// 这次进程已经写出的结果要以哪个退出码收尾（M3v）；没写出过是 null。只有最外层 catch 读它：写出结果之后再崩（只有注入走得
// 到——每个出口写完都紧跟 process.exit），再写一份就是两份 JSON，拒绝失效、回传全丢；SubagentStop 的拒绝是 stderr + exit 2，
// 不写 stdout，崩溃之后要照样以 2 退出，不能被改判成放行（docs/30 §3 的复核）。
let DECIDED = null
// 这次的 hook 输入。只有最外层 catch 读它：崩溃时按「收件人是不是 PM」选措辞。
let INPUT = null

// 「这次写的是不是 .agent-team/project.json」。抽成一个谓词是因为 ledger 分支现在
// 要在两条路径上问同一个问题（ctx.ok 的正常路径，以及 ctx 读不出来时那条只为触达表
// 留的通道），而它对 filePath 的类型防御也只该写一遍：norm() 内部是 resolve()，
// 传非字符串会同步抛。
function isProjectJson(filePath, agentTeamDir) {
  if (typeof filePath !== 'string' || !filePath) return false
  if (typeof agentTeamDir !== 'string' || !agentTeamDir) return false
  return norm(filePath) === norm(`${agentTeamDir}/project.json`)
}

// 「这次写的是不是 .agent-team/reach.json」（M4g）。与上面那个谓词同一个理由：ledger 的两条路径（ctx.ok、没有 run 的那条缝）问同一个问题。
function isReachJson(filePath, agentTeamDir) {
  if (typeof filePath !== 'string' || !filePath) return false
  if (typeof agentTeamDir !== 'string' || !agentTeamDir) return false
  return norm(filePath) === norm(`${agentTeamDir}/reach.json`)
}

// M4g（docs/42，审查第 28 条）：PM 写完 .agent-team/reach.json，按当前 project.json 与花名册重算一遍、与写进去的比（措辞在
// hooks/lib/ledger.mjs 的 reachCheckNotice）。project.json 不在、有阻断或插件问题（花名册读不出）时不核：那时【触达表】本来就叫 PM
// 先别写，「正确的那一份」也算不准。写进去的文件读不出来（被删、被占用）也不核。
// M4h（docs/43，审查第 24-1 条）：PM 写 current-run 时，别的、没收口的 run 里「派出去了、门禁还没见它停下」的派发——指针一改，门禁就按新的
// 这一趟判它们（停下行记进这一趟的派发记录、交付物核验按这一趟的段判），那一趟的产物没人核。按派发记录认：最后一回停下是「拦」的也算没停
// （拦了它会接着跑）；门禁没见它停下的，可能还在跑，也可能早就被中断了、平台没报——两种都照实说，不按时间猜。角色与段只在花名册、阶段链认得
// 它们时说出来（派发记录 Bash 写得进），run 目录名加引号（docs/27 §2.1）。按 agent_id 把停下认回派它的那一趟是另一件事（M，docs/39 往后放）。
// 复核（docs/43 §8）：停下行按 agent_id 在所有 run 的派发记录里认——这一趟、收了口的也算（指针切走之后，停下行记进当时指针指着的那一趟；
// agent_id 本身唯一），见过它不是「拦」的停下就算停了。runs 下的链接与 runctx 认 run 的口径一样算一个 run，同一个目录的别名只算一次，
// 「这一趟自己」按规范化之后的路径认。state.json 读不出的那一趟照样列：判不出收没收口，宁可多报。
function inflightElsewhere(ctx) {
  if (typeof ctx.agentTeamDir !== 'string' || typeof ctx.runDir !== 'string') return []
  const runsDir = join(ctx.agentTeamDir, 'runs')
  let ids
  try {
    ids = readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name)
  } catch {
    return []
  }
  const here = norm(ctx.runDir)
  const seen = new Set()
  const finished = new Set()
  const runs = []
  for (const id of ids.sort()) {
    const dir = join(runsDir, id)
    const key = norm(dir)
    if (seen.has(key)) continue
    seen.add(key)
    let text
    try {
      text = readFileSync(join(dir, DISPATCHES_FILE), 'utf8')
    } catch {
      continue
    }
    const log = readDispatchLog(text)
    for (const [agentId, outcomes] of log.stops) if (outcomes.some((o) => o !== 'block')) finished.add(agentId)
    if (key !== here) runs.push({ id, dir, log })
  }
  const roster = loadRoster()
  const out = []
  for (const { id, dir, log } of runs) {
    let state = null
    try {
      state = parseStateText(readFileSync(join(dir, 'state.json'), 'utf8'))
    } catch {}
    if (state && closedAt(state) !== null) continue
    for (const d of log.dispatches) {
      if (finished.has(d.agent_id)) continue
      const known = isPlainObject(roster) && Object.hasOwn(roster, d.role) && isKnownStage(ctx.stages, d.stage)
      out.push({ runId: id, role: known ? d.role : null, stage: known ? d.stage : null })
    }
  }
  return out
}

function inflightNotice(list) {
  if (!list.length) return null
  const lines = list.map((x) => `  - ${quote(x.runId)}：${x.role ? `${x.role}（${x.stage}）` : '一条认不出角色或段的派发'}`)
  return (
    `【派发】current-run 指向这一趟之前，下面这些派发门禁还没见它们停下：\n${lines.join('\n')}\n` +
    '指针一改，门禁就按这一趟判它们：它们停下时，停下行记进这一趟的派发记录、交付物核验按这一趟的段判，那一趟的产物没人核。还在跑的，先等它们停下' +
    '（完成通知到了）再在这一趟里派人；门禁没见它停下、其实早已中断的（会话断过、被停掉），照实告诉用户那一趟哪几份没人核。'
  )
}

// 写的人不是 PM（没有 run 时 H3 对谁都放行）：那一段改成叫它原样冒泡——reach.json 是控制文件，只有 PM 该改它（M4g 复核，低-8）。
function reachNoticeFor(filePath, project, writerIsPm = true) {
  if (!isPlainObject(project)) return null
  const roster = loadRoster()
  const report = validateProject(project, { roster })
  if (report.block.length || report.plugin.length) return null
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const notice = reachCheckNotice({ writtenText: text, expected: computeReach({ roster, paths: project.paths }) })
  return notice && !writerIsPm ? `${notice}\nreach.json 是编排层的控制文件，只有项目经理该改它：把这一段原样冒泡给派你的人，不要自己重写。` : notice
}

// ledger 那两处「project.json 是不是写坏了」要读它的原文（M3u）。最多读 3 次，两次之间停 25ms：Windows 上杀毒软件、
// 索引器的短暂占用，以及读到别人正写到一半的内容，停一下再读多半就好了——只读一次的话，一次占用就会让合法的文件
// 被说成「写坏了」，两次连着占用就退成只留痕（/agent-team:at-init 会按「门禁没在跑」叫停）。读到能解析成对象的
// 就返回它（剥 BOM、要普通对象，与 runctx 的 readJson 同一口径）；3 次都解析不出，返回最后读到的原文；都读不到，
// text 为 null。文件不在（ENOENT）不重读：没有收益，只会在 project.json 缺失时让每次写 .agent-team 多停约 50ms。
function readProjectText(file) {
  let text = null
  for (let i = 0; i < 3; i++) {
    if (i > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    let t = null
    try {
      t = readFileSync(file, 'utf8')
    } catch (e) {
      if (e && e.code === 'ENOENT') break
    }
    if (t === null) continue
    text = t
    const value = parseStateText(t)
    if (value !== null) return { value, text }
  }
  return { value: null, text }
}

// 读得到、却解析不出的 project.json 是不是 UTF-16 编码（Windows PowerShell 5.1 的 Out-File、> 的默认编码）。按 UTF-8
// 读出来，UTF-16 的 BOM 是开头的 U+FFFD，先跳过；之后 ASCII 内容的每个字符旁边都跟着一个 NUL——奇数位（LE）或偶数位
// （BE）绝大多数是 NUL、另一半几乎没有才算。尾部补 NUL（断电后常见）、整份清零、UTF-32、夹着一个裸 NUL 的 UTF-8 都
// 不算，落回泛说的口径（「常见原因：……」），不把编码当成事实说错。去掉 BOM 后不足 4 个码元（含 0 字节的空文件）也
// 不算：空串的奇偶计数全是 0，不设下限就会判成 UTF-16。开头有较多非 ASCII 字符的 UTF-16 文件判不出来（按 UTF-8 解
// 码时字节会并成一个字符、奇偶错开），落回泛说的口径——方向安全，docs/29 §5 登记着。
function looksUtf16(text) {
  if (typeof text !== 'string') return false
  const replacement = String.fromCharCode(0xfffd)
  let start = 0
  while (text[start] === replacement) start += 1
  const head = text.slice(start, start + 64)
  if (head.length < 4) return false
  const nul = [0, 0]
  const total = [0, 0]
  for (let i = 0; i < head.length; i += 1) {
    total[i % 2] += 1
    if (head.charCodeAt(i) === 0) nul[i % 2] += 1
  }
  const mostly = (p) => nul[p] >= total[p] * 0.8
  const hardly = (p) => nul[p] <= total[p] * 0.2
  return (mostly(1) && hardly(0)) || (mostly(0) && hardly(1))
}

// 刚返回的这个角色，是不是当前阶段执行角色的一个**合法协调者**？
//
// 【M1b 终审 C4】commands/at.md 的 S5 正路是「派 at-architect，由它去分发执行角色」
// ——那是对的，花名册里 at-pm 派不动 at-backend，执行角色在第三层。而 stages.json
// 的 S5.role 是 at-backend（那是对的：S5 的 produces 是 05-impl/at-backend.md，
// 那就是 at-backend 的交付物；同一个 role 字段还要喂 H2「这个角色开工前需要什么」
// 与 H3「run 目录下这条路径归谁」，三个语义下 at-backend 都是对的）。
// 两者不冲突，但撞在一起会让 H5a 在这条**正路**上必然误报：at-architect 返回时
// decideDeliverable 给 skipped:'role-not-in-stage'，原来的 warning 说「两种可能：
// 这次派发本身不该发生；或者 state.stage 停在旧阶段」——在 S5 正路上两种都是假的。
// 更糟的是最坏的一种「修复」：PM 把 state.stage 改回 S3 去消警告，那会真的让 H5
// 对整个 S5 全程哑火 —— **这条告警有能力制造它自己警告的那个失效。**
//
// 判据用 hooks/lib/reach.mjs 的传递闭包：能（传递地）派发到当前阶段执行角色的，
// 就是协调者。paths 传 {} 是有意的——这里只要拓扑可达性，不关心路径归属。
// 不另写一份闭包：computeReach 已经处理环与自引用，且已有 14 条测试。
//
// ⚠️ 是不是协调者，只回答「这次返回本身合不合法」——判不判定为要静默，还要看当前阶段
// 是否已经 done（M2a 补，见调用点 stageDone 那段与 docs/11 §5.8）：这个函数本身不变，
// 变的是调用它的地方怎么用它的结果。
//
// ⚠️ 只改**告警条件**，没有削弱 H5 本身：H5a 这条 warning 是「H5 哑掉」的两条对策
// 之一（另一条是 ledger 在当前阶段产物齐了时的阶段推进提示），
// hooks/lib/deliverable.mjs 头部与 stages.README.md 都写着缺一不可，**不能因为噪音
// 就整条删掉**。这里排掉的只是「它其实是一次合法的层级协调」这一类，剩下的两类
// 照发。
//
// ⚠️⚠️ **M2b Task 3 之后，S5 的静默面只剩 at-architect。** 这段上一版写的是「被静默的
// 不止 at-architect——`state.stage === 'S5'` 时 at-product 返回同样落在协调者一侧（它的
// can_delegate_to 含 at-backend），这是判据的固有代价、不是漏网」。那段话**整段不再
// 成立**：M2b Task 3 按规格 §4 把 at-product 的 can_delegate_to 从 ["at-backend"] 改成
// ["at-ui"]（S2 是「at-product → at-ui」，S5 的分发是 at-architect 的事），at-product
// 因此不再传递派得到 at-backend。**这不是判据变了，是花名册变了**——判据一个字没动，
// 同一条判据在新拓扑上算出的集合小了一个角色。
//
// 「PM 在 S5 误派 at-product」这个场景现在由 H5a 正常报出来（at-product 不是协调者，
// 走 !coordinator 那半）。曾经要认下来的那笔代价，随那条边一起没了。
//
// 判据是「返回角色能传递派到 stages[state.stage].role」——这只是 M2a 新判据的一半，
// 另一半（当前阶段是否已经 done）在调用点算，不在这个函数里。
// 扩链到 S6–S8 之后重算出的静默集合（M2b Task 3 第三次重算，八行逐段）见
// stages.README.md 的「H5a 的静默集合」一节，tests/gate-deliverable.test.mjs 逐行钉着它。
//
// ⚠️ 下面读的是 `stages[stageId].role`（**单数**）。M2b Task 3 实测过另一种口径
// （「派得到该段任意一个 producer」）：两者在当前拓扑下**不等价**，S2 与 S5 两段的
// 协调者集合都会变。**裁定「保留 .role 单数」，这里不动**——这条判据问的不是「谁能
// 让这一段的产物出现」，是「这次返回的角色有没有可能就是跑这一段的那个人」；
// at-product → at-ui 这条边是为 S2 存在的（委托 UI 规格），不是 S5 的实现分发，而
// can_delegate_to 里没有阶段这一维、分不清一条边是为哪一段存在的。借 computeReach 来算
// 只是实现上的便利，不是在主张这条判据与规格 §6.4 的触达语义是同一个问题——§6.4 答的是
// 「这个角色实际能写到哪」（reach.mjs 开头写明是审计产物、不是安全边界），两者问的不同。
// 失效条件不是「有人派得到某个 producer 却派不到该段 role」（那就是被否掉的那种口径），
// 而是：**某一段的真协调者派不到那一段的 role**。今天八段都不满足。完整裁定见 docs/11 §5.12。
function isCoordinatorFor(ctx, role, stageId = ctx.state?.stage) {
  const stages = ctx.stages
  if (!stages || typeof stages !== 'object') return false
  if (typeof stageId !== 'string' || !Object.hasOwn(stages, stageId)) return false
  const stageRole = stages[stageId]?.role
  if (typeof stageRole !== 'string' || !stageRole) return false
  const reach = computeReach({ roster: loadRoster(), paths: {} })
  return (reach[role]?.reachableRoles ?? []).includes(stageRole)
}
// M4h（docs/43，审查第 14 条）：自己也是这一段产者的协调者——能派到这一段别的产者（S2 的 at-product 派 at-ui）。isCoordinatorFor 认的是
// 「能派到这一段的 role」，at-product 本身就是 S2 的 role，那一条认不出它；这一个只给协调者进度用，不改 isCoordinatorFor 的口径。
function dispatchesOtherProducers(ctx, role, stageId = ctx.state?.stage) {
  const stage = ctx.stages?.[stageId]
  if (!isPlainObject(stage)) return false
  const reach = computeReach({ roster: loadRoster(), paths: {} })
  const producers = stageRoles(stage)
  return (reach[role]?.reachableRoles ?? []).some((r) => r !== role && producers.includes(r))
}
// ⚠️ M3w（docs/31）：H2 按派发者给多段角色选段（hooks/lib/readiness.mjs 的 candidateStages）用的是同一个口径——「是那一段的
// role、或能传递派到它」，读 stages[X].role 单数。两处都靠 docs/11 §5.12 的口径甲；改一处要连另一处。

// 放行一侧写 stdout 的唯一出口（M3v，docs/30）：受信回传（contexts，并成一份受信块）与给用户的一行（systemMessage）。
// 输出长什么样由纯函数 hookOutput（hooks/lib/fail-open.mjs）定：PreToolUse 上不发受信块，SubagentStop 上什么都不发，
// 永不带 permissionDecision、decision、continue。这里只做 I/O，**写完就退出**：同一次进程只写一份，两份 JSON 会让
// 回传全丢（上一版的 emitLedger 不退出，靠每个调用点自己紧跟 exit）。要一起发的话在调用点并进同一次调用。
// 不变式：fail closed 的检查项只经 denyAndExit 写 stdout，不调用这里（tests/gate-fail-open.test.mjs 按源码钉着）。
function emitHookJson(event, parts) {
  const { stdout, bug } = hookOutput(event, parts, CHECK)
  if (bug) process.stderr.write(bug)
  if (stdout) {
    DECIDED = 0
    process.stdout.write(stdout)
  }
  process.exit(0)
}

// 输入读不出来（stdin 不是一个 JSON 对象、缺 tool_name）时 fail open 的那一支（M3v）：往 stderr 留一行，Pre/Post 上再
// 给用户一行。不进模型——模型做不了什么，这多半是 Claude Code 改了 hook 输入的形状，要更新的是插件或 Claude Code。
// M3z（docs/34）：给用户的那一行只在 PreToolUse、PostToolUse 上发——SubagentStop 上 stdout 等于拦截，UserPromptSubmit 上 stdout
// 进模型上下文（hookOutput 对这两种事件有东西要发就报 BUG）。
function inputUnreadable(spec, what) {
  const outcome = spec.recorder === true ? '这次的回答没有记下' : '没有做校验、放行'
  process.stderr.write(`agent-team ${CHECK}：读不出这次的 hook 输入（${what}），${outcome}。\n`)
  emitHookJson(spec.event, userFacing(spec.event) ? { systemMessage: systemMessage('input', { check: CHECK }) } : {})
}

function userFacing(event) {
  return event === 'PreToolUse' || event === 'PostToolUse'
}

// 门禁自检理由末尾的追加句（M3v）：只在调用者是 PM、自检写在门禁认的项目根下时追加——丢指针时 PM 在 /agent-team:at-resume
// 里只读不写、/agent-team:at 建新 run 只写控制文件，别处都开不了口（措辞与理由在 hooks/lib/fail-open.mjs 的
// selfCheckAppendix）。多读一次运行上下文；出任何意外都只是不追加——自检本身的「在线」不能因为它丢掉。
function selfCheckTail(input, checked) {
  try {
    if (!isContractWriter(input?.agent_type)) return ''
    if (norm(checked) !== norm(join(ROOT_PROJECT, GATE_CHECK_PATH))) return ''
    return selfCheckAppendix(readRunContext(ROOT_PROJECT, ROOT))
  } catch {
    return ''
  }
}

// fail open 时往 stderr 留的那行痕迹（整理项 10）。四个检查项此前各写一份
// 近似拷贝，而且同一个 kind:'no-run' 在 H3/H4 被说成「当前没有进行中的 run」、
// 在 H2/H5 被说成「读不到运行上下文」——这不是重复，是口径分叉：对读到这行字
// 的人，两者意味着完全不同的下一步（前者是门禁做出了有依据的判定"本次调用不
// 归它管"，后者是门禁自己判不出来，说明有东西坏了）。措辞按 ctx.kind 选，各
// 检查项只提供自己的名字。
//
// 为什么留痕本身是硬要求（Task 3 评审 Minor 4 / Task 1 起就在的先例）：静默的
// 放行和门禁彻底坏掉长得一模一样（exit 0、零输出）——这个项目一路被咬的就是
// 这个失效形状。文案只说一次"放行"，剩下的篇幅换成一句可执行的下一步：
// ctx.reason 的大多数取值本身就是 current-run / run 目录的问题，那是最先该查
// 的地方。
//
// ⚠️ M3v（docs/30，全量审查第 12 条）：这一行只进转录——模型看不到，用户在默认界面上也看不到。PM 自己发起的派发
// （H5a）与写入（ledger）上，判不出来时另有一段受信回传与给用户的一行，措辞与理由在 hooks/lib/fail-open.mjs；这一行
// 照旧写，两者并存。
function failOpenNotice(label, ctx) {
  const what = ctx.kind === 'no-run' ? '当前没有进行中的 run' : '读不到运行上下文'
  return (
    `agent-team ${label}：${what}（${ctx.reason}），本次放行、不拦截。` +
    `若你以为有进行中的 run，检查 .agent-team/current-run。\n`
  )
}

// M3b：**一条回传落在一个改不了它的收件人手里**时，往 stderr 留的那一行痕。
//
// 为什么留痕：这两条回传都**只走 additionalContext**，收件人不转述就没有第二条通道。
// 账本比对那一条尤其重——它的 unrecorded 是「Bash 绕过 H3 的直接表征」
// （hooks/lib/artifact-drift.mjs 头部那张表）。
//
// 为什么共用一份（M3b 修复轮 1）：两处要说的**路由事实是同一份知识**——additionalContext
// 只发给这次 hook 事件所属的那个上下文，而要动的东西住在控制文件里。账本比对那一条先
// 写出来、产者交代那一条后补，正是本仓库 docs/11 §5.15 记的「一边解决过、另一边不知道」
// 那个形状的入口；抽成一份、各自只提供自己的名字与通道名，与 failOpenNotice 同一个手法、
// 同一个理由（那一族此前四处各写一份近似拷贝，同一个 kind 在两个检查项里被说成两个意思）。
//
// ⚠️ **这不是 fail open，措辞不要写成 fail open**，所以不复用 failOpenNotice：那一族说的是
// 「运行上下文读不到、本次放行」；这里运行上下文是好的、判据照常算了、回传照常发了，
// **没有放行任何东西**——错的是收件人，不是判定。混用同一句话就是上面那种口径分叉。
// M4c：holds 说「它要动的东西在哪、谁拦」——契约那一条要动的可能是 contract_sha，也可能是契约本身（H4）。
function misroutedNotice(label, channel, recipient, holds = '它要动的东西住在 state.json 里，H3 写路径门禁在 PreToolUse 上把非 PM 对控制文件的 Edit/Write 拒掉') {
  return (
    `agent-team ${label}：这次的回传落在 ${inline(recipient)} 手里——${channel} 只发给这次工具调用` +
    `所属的那个上下文，而${holds}。告警照发、判据没有放行任何东西，发错的是收件人` +
    `不是判定；这一条要被处理，得靠 ${inline(recipient)} 把那段回传原样冒泡上去，一路带到 PM。\n`
  )
}

// Task 4：账本比对的措辞组装。compareArtifacts（hooks/lib/artifact-drift.mjs）本身是
// 纯函数、只回结构化数据；拼成人话、决定要不要发，同 buildLedgerNotices 一样放在调用
// 它的这一层，不在纯函数模块里掺 I/O 或文案。
//
// 三个清单都空时返回 null——调用方据此决定要不要往这次的 notices 里塞一条（M1c 设计
// §1.2：「每次子代理返回都刷一段会把真正要看的东西淹掉」）。
//
// 措辞上两条硬要求（M1c 设计 §1.2 / Task 4 简报）：不得出现「限制」「越权」——这不是一道
// 闸，它从不拒绝任何调用；要说明这是审计、对不上账，并写明它不阻止伪造、只留痕迹——与
// hooks/lib/reach.mjs 的触达表同一个性质，完整理由见 hooks/lib/artifact-drift.mjs 头部，
// 不在这里重复第二遍。
//
// ---
//
// M3b：**收尾按「收件人改不改得了它」分支**（docs/11 §5.23 二）。
//
// 这条回传挂在 CHECK === 'deliverable'，也就是 PostToolUse:Agent，而 additionalContext
// **发给发起那次 Agent 调用的人**。子代理派子代理时（at-product 派 at-ui）收件人就是
// at-product——M3a Task 5 在活会话里实测过那一趟：unrecorded 落在 at-product 的
// sidechain 里，PM 从头到尾零命中（docs/18 §3.6 末尾那条边）。
//
// **而上一版的收尾是「需要的话把 artifacts 改成与磁盘一致」**，同一条回传的上一句自己
// 就写着「state.json 对 Edit/Write 只对 PM 开」——**先告诉收件人你改不了，再让他去改**。
// 这正是本仓库记过的「失败文案把人指向错误修法」那一族的一个变体：文案没指错路，
// **是路由指错了人**（buildCoverageNotice 上方那段注释记的是同一族的另一种形状）。
//
// 分量不在「措辞不好看」：账本比对的 unrecorded 是 **Bash 绕过 H3 的直接表征**
// （hooks/lib/artifact-drift.mjs 头部那张表逐字这么定义它）。它发不到能处理的人手里，
// 这个机制在子代理场景下就形同虚设。
//
// **「谁算 PM」复用 isContractWriter，不在这里另写一遍 role === 'at-pm'。**
// 理由与 hooks/lib/writepath.mjs 的控制文件豁免同一条——那里用的**就是它**：
// 这条文案断言的「你改不了 state.json」与 H3 真实会不会拒，由**同一个谓词**决定，
// 不让文案自己再读一遍「谁是 PM」。调用点因此照抄 H3 的那组合（callerOf → isContractWriter）。
//
// ⚠️ **isDriverRole 上方那条失效条件对这一处同样适用，不抄第二份**：isContractWriter
// 一旦为**它自己的**理由放宽（那段注释点名的那一种：有人往某个角色的 can_delegate_to
// 里加 at-pm），这里要回来重核两者是否还重合。两处有一个差别值得写下来：那一处借它答的
// 是**另一个**问题（谁是不参与统计的驱动者），今天只是外延重合；**这一处借的是 H3 自己
// 调用的那同一个谓词**，所以 isContractWriter 放宽时 H3 与这条文案会**一起**放宽，断言
// 不会因此变假。真正要重核的是另一半：isContractWriter 为假**不等于**一定写不成——H3
// 在 ctx.kind === 'no-run' 那一支对**所有角色** fail open（gate.mjs 的 writepath 分支）。
// 这条回传只在 ctx.ok 时才算得出来，那个窗口从这个调用点够不到；**哪天这条回传被挪到
// 一个 ctx 不保证 ok 的触发点上，这个差额就落地了。**
//
// ⚠️ **M3b「坏指针的窗口」把这个差额的口径收窄了一次，但没有把它消掉。** 上面那句
// 「no-run 那一支对所有角色 fail open」今天仍然成立，变的是 no-run **是什么**：
// 「current-run 指向的 run 目录不存在」已经从 no-run 挪去 unreadable（论证在
// hooks/lib/runctx.mjs 头部），所以 no-run 今天只剩「pointer 根本不在」一种。
// 差额因此变窄：那种状态下写 runs/<id>/state.json 不会顺手把 pointer 造出来，
// PostToolUse 那一帧 ctx 仍然不 ok。**但这仍然不是「写不成」**——H3 照样放行了那次
// 写入，只是这个调用点看不见它。别把收窄读成消除。
//
// ⚠️ 参数缺省（判不出收件人）时落**改不了**那一支：多一次转述的代价，远小于再一次
// 指挥一个改不了它的人去改——那正是这一轮要修的形状。
// M4g 复核（docs/42 §8，中-2）：「没记」那一行注明门禁知道的写者——派发记录里写它的那个角色在那一段被派出去过，或者它是项目经理自己的
// 产物。收尾按注明的分开说：原来只认「写它的人回报里报过同一个值」，下级的下级写的（值报给的是协调者）照字面只能去问用户或者一直不记。
// 产物名、段名、角色名都来自插件自己的 stages.json；派发记录（Bash 写得进）只拿来判「在不在里面」，不往文字里拼。
function driftNoteFor(stages, dispatched) {
  return (name) => {
    const p = producerOfName(stages, name)
    if (!p) return ''
    if (isContractWriter(p.role)) return '项目经理自己的产物'
    return dispatchedIn(p.stageId, dispatched).includes(p.role) ? `门禁的派发记录里 ${p.role} 在 ${p.stageId} 被派出去过` : ''
  }
}

function buildDriftNotice(cmp, recipientCanWriteState, noteFor = () => '') {
  if (!cmp) return null
  const { drifted, missing, unrecorded } = cmp
  if (!drifted.length && !missing.length && !unrecorded.length) return null

  const lines = []
  for (const d of drifted) {
    lines.push(`  - ${d.name}：记录的是 ${shaOrNote(d.recorded)}，门禁按磁盘算出来是 ${d.actual}——记账之后被改过`)
  }
  for (const m of missing) {
    lines.push(`  - ${m.name}：记录的是 ${shaOrNote(m.recorded)}，但磁盘上没有——被删了，或者从没真的写成`)
  }
  // M4g（docs/42，审查第 28 条）：两种行都带门禁按磁盘算出来的值，PM 照它记、不自己算（收尾那一句）。
  for (const u of unrecorded) {
    const note = noteFor(u.name)
    lines.push(`  - ${u.name}：磁盘上有这份文件，但 artifacts 里没记（门禁按磁盘算出来是 ${u.actual}${note ? `；${note}` : ''}）`)
  }

  // 两支收尾。前面那一整段（审计边界）两支共用，一个字不改：它对谁都成立。
  // M4g（docs/42，审查第 28 条）：PM 那一支原来是「去 run 目录核实磁盘内容，需要的话把 artifacts 改成与磁盘一致」——行里不带值，PM 只好
  // 自己算 sha（M5f 里 haiku 版 PM 真的去调了 Get-FileHash），带 BOM、CRLF 的产物上造出假漂移；照着磁盘改账还会把一次真漂移洗成合法
  // （与契约那一条同一个理由，contractCheckNotice 上方）。现在先弄清是谁写的、照上面给的值记、不自己算。
  const tail = recipientCanWriteState
    ? '「没记」的：注明了「门禁的派发记录里……被派出去过」的，是那一段派出去的人交的，照上面的值记（它的回报里报过值的，两个应当相同；不同就先弄清' +
      '是谁改过）；注明「项目经理自己的产物」的，照上面的值记；什么都没注明的（门禁没见过谁被派去写它），先弄清是谁写的，再决定记不记。' +
      '「记账之后被改过」的：你自己改过的、返工与同一段里重派重写的，照上面的值改记；说不清的，告诉用户，不要为了消掉这一条照着磁盘改账。' +
      '值一律用上面给的，不要自己算——门禁先剥 BOM、把 CRLF 折成 LF 再算，自己算的会对不上。'
    : relayTail('artifacts 住在 state.json 里，它是编排层的控制文件，H3 写路径门禁在 PreToolUse 上把非 PM 对它的 Edit/Write 拒掉')

  return (
    `【账本比对】以下产物对不上账：\n${lines.join('\n')}\n` +
    `这是审计产物，不是安全边界——它不阻止任何人伪造产物，只让伪造留下痕迹。真要伪造的人` +
    `可以连 artifacts 一起改（任何持有 Bash 的角色都写得了——state.json 对 Edit/Write 只对` +
    `PM 开，但 Bash 不经任何 hook），但那时它不再是顺手绕过，而是一次需要同时改两处的刻意` +
    `行为。${tail}`
  )
}

// 收件人改不了这一条时的收尾（M3b 起在 buildDriftNotice 里；M4c 抽出来，契约那一段共用——同一个收件人分支只留一份实现）。
// swallowed：咽掉的后果。账本比对那一条咽掉了就没人再看见；契约那一条 PM 下一次派发返回或写 state.json 时还会再报（复核）。
function relayTail(why, swallowed = '咽掉之后没有任何人会再看见它') {
  return (
    `⚠️ **这一条你改不了**：${why}。而这条回传只发给` +
    `发起这次派发的人——**也就是你，PM 不会同时收到一份**。` +
    `**把上面这几行原样冒泡给派你的人**，让它继续往上带到 PM；` +
    `**不要自己把它咽掉**——${swallowed}。`
  )
}

// M4c（docs/37，全量审查第 37 条前半）：派发返回时拿 contract_sha 对磁盘上的契约（账本比对已经不看契约，见
// hooks/lib/artifact-drift.mjs）。措辞在 hooks/lib/ledger.mjs 的 contractCheckNotice（写 state.json 时同一句）；收件人改不了
// state.json 时接上 relayTail，误投痕由调用点留，与账本比对同一个分工。
// 复核（docs/37 §3）：契约在、这一次却读不出，说读不出、没核，不说它不在。
function contractNoticeFor(ctx, recipientCanWriteState) {
  const bytes = ctx.artifactBytes(CONTRACT_FILE)
  const recorded = ctx.state?.contract_sha
  const cmp =
    bytes === null && ctx.artifactExists(CONTRACT_FILE)
      ? { ok: false, kind: 'unreadable' }
      : compareContractSha({ recorded, actual: bytes ? sha256OfContract(bytes) : null })
  const notice = contractCheckNotice(cmp, recorded)
  if (!notice) return null
  return recipientCanWriteState
    ? notice
    : notice +
        relayTail(
          'contract_sha 住在 state.json 里、契约只有 PM 写得了：state.json 与契约，H3、H4 在 PreToolUse 上都把非 PM 拒掉',
          '咽掉了，PM 要到它自己下一次派发返回或写 state.json 时才会再看到它',
        )
}

// M3a Task 2：「已经走过的那几段，产者有没有交代」的措辞组装。decideCoverage
// （hooks/lib/coverage.mjs）本身是纯函数、只回结构化数据；拼成人话、决定要不要发，
// 放在调用它的这一层，与上面 buildDriftNotice 同一个手法、同一个理由。
// gaps 为空时返回 null，调用方据此决定要不要往这次的 notices 里塞一条。
//
// ⚠️ **报，不拦**（M3a 设计 §3.2 末尾），与 H5a 同一档。裁剪是合法动作，这条判据只
// 负责把沉默变成一句话；做成 deny 会在「PM 还没来得及写 trimmed」时卡死整条链。
//
// ⚠️ 文案必须按触发逐个给出路，而且要把它们和各自的触发对上：这条提示的触发判据分辨
// 不了、而读的人分辨得了——真的裁了（→ trimmed）/ 真的漏了（→ 派出去）；带 stage_roles 的 run 还有第三种：那一段
// 真被叫到过、只是 stage_roles 漏记了（→ 补记，M3x）。少给一条出路就等于替读的人做了那个判断，而判据恰恰是做不了
// 这个判断的那一方。
//
// ⚠️ 这里要防的错误修法很具体：**把名字写进 roster 让提示消失**。roster 记的是「这一趟
// 真的叫到过谁」，只写名字不派人，产物照样不存在——提示没了，洞还在，而且门禁不会再报它。
// （M3x 订正：这里原来写的是「下一次账本比对会把它报成 missing」——从 M3a 写下起就不成立：compareArtifacts 只比对
// 记过账的产物，没记账的名字直接跳过。还看得见它的只剩 at-qa 对 S5 的自查与 /agent-team:at-status，文案照实说。）本仓库为「失败文案把人
// 指向错误修法」栽过一次（ledger 的【阶段】那条：提示让一个做不到这件事的角色去做
// 它），这条是同一族的第二种形状：能做到，但做的是错的那件事。
// 同理，trimmed 那一条给的是**形状**、用当前第一条 gap 举例，不是一份可以整批粘贴的
// JSON——整批写进 trimmed 就是另一种「让它闭嘴」。
//
// ⚠️ **这里原来写着一条已经被实测证伪的理由，M3b 修复轮 1 就地改对**（代码注释不是带
// 日期的记录，不在旁边另加一段；记录那一份在 docs/11 §5.23 的收口块）。原文两处假：
// ① 它把 writepath 写成「H4」——writepath 是 **H3**，H4 是 contract（本文件两条分支各自
// 的注释写着）；② 它据此断言「对非 PM 一律拒绝——写不成就没有 PostToolUse，这条提示到
// 不了非 PM 手里」，**那个全称量词不成立**，而那句话是「不点名这个动作只能由 PM 做」
// 那个决定的全部支撑。
//
// 真实机制（子进程级探针实测）：
//   · ctx.ok 时 H3 按控制文件规则拒非 PM（decideWritePath 顶部那一段，谓词是 isContractWriter）；
//   · **但 readRunContext 把「current-run 存在且非空、指向的 run 目录不存在」判成
//     kind:'no-run'，而 H3 在 no-run 那一支对所有角色 fail open**（本文件 writepath 分支）。
//     非 PM 在那个窗口里**写得成** runs/<id>/state.json，PostToolUse 照常发；而此刻
//     ctx 已经 ok（文件刚落盘），ledger 于是走到 kind === 'state'——**这条提示真的到得了
//     非 PM 手里**；
//   · **窗口在同一刻关上**：他的下一次写入就被 H3 拒了。所以收件人拿到这条提示时，
//     他已经改不了它——与 buildDriftNotice 那条**同一个形状，只是门更窄**；
//   · 只有这一种 no-run 走得通：current-run **完全不存在**时，PostToolUse 那一帧 ctx 仍是
//     no-run，ledger 在 !ctx.ok 那条分支就退出了（只留 fail open 痕迹），这条提示压根不发。
//
// **所以那个决定换掉了**：收尾按「收件人改不改得了 state.json」分两支，谓词与手法与
// buildDriftNotice 同一份（callerOf → isContractWriter，在调用点算），见下面 outs 那一段。
//
// ⚠️ **M3b「坏指针的窗口」把上面那个窗口关上了——上面这段机制描述因此过期了一半，
// 就地标出来，不抹掉**（它记的是那个决定当时的依据，抹掉就看不出这条分支为什么在）。
// 今天的真值：「current-run 指向的 run 目录不存在」已经归 kind:'unreadable'，H3 在那一支
// 对非 PM fail **closed**（hooks/lib/runctx.mjs 头部是论证，本文件 writepath 分支是落点）。
// 于是上面第二、三条描述的那条路**已经走不通**：非 PM 写不成 runs/<id>/state.json，
// 就没有 PostToolUse，这条提示到不了他手里。而第四条今天覆盖了 no-run 的全部——
// no-run 只剩「pointer 根本不在」，那一帧 ctx 不 ok，ledger 提前退出。
//
// **两支照留，理由不是「万一」**：
//   · 这里的 recipientCanWriteState 算的是**这一帧真实的收件人**，不是「谁到得了这里」
//     那个理论。把分支删掉等于让这一层去替 H3 断言「非 PM 结构上到不了」——**上一轮
//     正是这条断言被实测打假的**，而它当时也是从另一个模块的分类推出来的。
//   · 参数缺省（判不出收件人）时落的是「改不了」那一支；删掉分支，那个缺省就退回
//     「你去改」的口吻——M3b 要修的正是这个形状。
//   · 同一份谓词还服务着 buildDriftNotice，**那一条的非 PM 收件人照样到得了**
//     （PostToolUse:Agent，收件人是发起派发的那个子代理，与本窗口无关）。
// 钉这两支的子进程用例（tests/gate-ledger.test.mjs「M3b 修复轮 1」那一组）**不受影响**：
// 它们构造的是 ctx.ok + 非 PM agent_type 这一帧本身，而 ledger 从不判「这次写入当初该不该
// 被放行」——那是 H3 在 PreToolUse 上的事，另一个 hook。那组用例上方已经把这条写下来了。
// **诊断那一半对谁都成立，两支共用、一个字不动**：哪一段的哪个角色没交代、口径宽不宽、
// 驱动者那条护栏——分支的只是「你去把它改了」这个假设。
//
// ⚠️ Ruling 2：narrowed 为假时文案要**自己说出口径比平时宽**。读的人凭这一句才知道
// 这批 gap 里可能混着「这个项目根本用不上的角色」与「PM 自己那几段」——不说的话，
// 同一条提示在两种完全不同的口径下长得一模一样，而这正是本仓库反复栽的那个形状
// （「静默的放行和门禁彻底坏掉长得一模一样」）。stderr 那一行痕迹是另一半，在调用点。
// ⚠️ **修复轮 F1**：护栏原来挂在「没收窄」那一支上，那是挂错了地方——
// `{"at-pm": "S1"}` 这个错示例**恰恰只在收窄成功时才产生**。实跑过整条链：
// 真实 project.json 的 available_roles 里写了 at-pm（/agent-team:at-init 明令不要写，
// 但**没有任何运行时判据拦它**）→ 收窄成功（stderr 无痕、文案里那段「口径比平时宽」
// 与它带的护栏全都不出现）→ S1 是每趟 history 的第一段、而 at-pm 做自己那几段时没有
// 「派发」这个动作所以不在 roster → gaps[0] 就是 {S1, at-pm} → 文案逐字给出
// {"at-pm": "S1"} → validateState 放过（at-pm 真的是 S1/S4/S8 的产者，形状挑不出毛病）
// → gap 消失、洞留着，而且这一趟从此声明「把自己的驱动者裁掉了」。
//
// 所以护栏不挂在口径上，**挂在「这批 gap 里出现了不该被裁的角色」这件事上**：
// 举例跳过它们，并且无条件多发一句点名它、指向真修法（去 available_roles 里删掉它，
// 不是写进 trimmed）。
//
// 「谁算这一趟的驱动者」复用 isContractWriter，不在这里另写一遍 role === 'at-pm'
// ——hooks/lib/writepath.mjs 已经为另一个问题（谁能写控制文件）复用过同一个谓词，
// 它自己的注释写着「不另写一遍 role === at-pm」。这里是第三个问题、同一份知识。
//
// ⚠️ **上面这句只论证了「为什么复用而不是另写」，没说这次复用的代价。**
// 复用把两个**概念上不同**的问题绑在了一起：
//   isContractWriter 答的是「**谁能写契约**」（契约守卫的授权问题）；
//   这里借它答的是「**谁是不参与「有没有被叫到」统计的驱动者**」（覆盖判据的统计口径）。
// 今天两者**外延重合**，核法是（不报总数，报判据——docs/16 那条「列举，不报总数」）：
// 拿 roster.json 里**除 __main__ 之外的每一个键**、以及 stages.json 里 stageRoles
// **出现过的每一个角色**，逐个喂给 isContractWriter，为真的只有 at-pm。
// ⚠️ roster.json 的**键数**不等于**角色数**：__main__ 是主线程的镜像、不是角色。
// **但没有任何机制保证将来还重合**：isContractWriter 哪天为
// **它自己的**理由放宽（它头部那段注释已经点名了一种：有人往某个角色的
// can_delegate_to 里加 at-pm，那条豁免就会同时放行一个真正的子代理），
// **这条护栏会跟着静默放宽**——而这里没有任何东西会提示它变了。
//
// 「不是同一份知识」有一处现成的实物：isContractWriter 为真的条件是
// `caller === MAIN || caller === 'at-pm'`，**MAIN 那一支与「这一趟的驱动者」毫无关系**，
// 它答的是「调用者是被钉住的主线程」。这一支在这里今天到不了（gaps 的 role 全部来自
// stageRoles，必然是非空字符串），所以不影响判断——但它说明这个谓词的「真」里，
// 本来就含着一块不属于这个问题的东西。
//
// 现在不拆（外延重合时拆出第二份 role === 'at-pm' 就是本仓库反复裁过的那种分叉）。
// **要记的是失效条件**：isContractWriter 一旦为它自己的理由改动，这里要回来重核两者
// 是否还重合；不重合就该在这里写一个独立的谓词，而不是继续借。
const isDriverRole = (role) => isContractWriter(role)

// ⚠️ M3x（docs/32）：带 stage_roles 的 run 按段判（decideCoverage 回 perStage: true）。那时点名的角色可能就在 roster 里
// ——at-ui 在 S2 叫过、S5 没记——所以三处跟着变：头一句不说「这一趟既没叫到它们」（假话），改说 state.json 没记着它在
// 那一段被叫到；多一条出路「它在那一段真干过活、只是 stage_roles 漏记了 → 补记」（这时「把它派出去」会让它重做一遍）；
// 「不要为了让提示消失就写进 roster」那条护栏扩到 stage_roles——补记与「只写名字」长得一样，分界是它真被叫到过没有。
// 旧 run（perStage 为假）的产者交代文案只有护栏那一句换了（PM 与非 PM 两支都换了，见上面那段 M3x 订正，与 perStage 无关），其余
// 一个字不变：那里没有 stage_roles 可补，判据也还是整趟口径。
// M4a（docs/35）：closed 为真（这一趟已经收口）时，② 不再叫 PM 派人——H2 收口之后拒派一切团队角色（评审 F9）。
// M4a 复核（P7）：viaCoordinator 是最后一段、没收口时 PM 派不到的缺口角色——② 补一句它只能经协调者派、最后一段不再派协调者。
// M4g（docs/42，docs/39 §3）：门禁的派发记录里有它在那一段被派出去过、state.json 却没记的（decideCoverage 标 dispatched）——不是漏派
// （下级派出去的也算叫到），出路只有补记。原来与真漏派报成同一句「是漏了：把它派出去」，PM 把「叫到」读窄时会去重派一个已经交过产物的人。
// M4g 复核（docs/42 §8，低-3、低-6）：补记之前看一眼磁盘——派发记录被加过一行、或者推进那一刻派发记录读不出时，真漏派也会落到这一段；
// 「下级派出去的也算叫到」对你亲手派、只是忘了记的段（S3、S6）不对题，改说门禁记着它被派出去过；收口之后补记连 never_invoked 一起重算。
function loggedCoverageNotice(logged, perStage, recipientCanWriteState, closed = false) {
  const where = perStage ? 'stage_roles' : 'roster'
  return (
    `【产者交代】下面这些角色在门禁的派发记录里、在那一段被派出去过，state.json 却没记着这一趟在那一段叫到过它们（${where}）：\n` +
    `${logged.map((g) => `  - ${g.stage} 的 ${g.role}`).join('\n')}\n` +
    `这不是漏派：门禁记着它在那一段被派出去过，只是没记账（下级派出去的也算叫到）。` +
    (recipientCanWriteState
      ? `补记之前去磁盘看一眼它那一段的产物：在，就把它们并进 state.json 的 ${perStage ? 'stage_roles 那一段，roster 里没有就一起累加' : 'roster'}` +
        `——不用重派，也不要写进 trimmed；不在（派了没交），照真漏派处理：派它补交，或者照「回退」回到那一段。` +
        (closed ? '这一趟已经收口：补进 roster 时连 never_invoked 一起重算。' : '') +
        '这条只报不拦。'
      : `补记是 PM 的动作（${where} 住在 state.json，H3 写路径门禁把非 PM 对它的 Edit/Write 拒掉）——带上它那一段的产物在不在；不用重派，也不要建议写进 trimmed。` +
        `**把上面这几行原样冒泡给派你的人**，让它继续往上带到 PM；**不要自己把它咽掉**——咽掉之后没有任何人会再看见它。`)
  )
}

function buildCoverageNotice({ gaps, narrowed, perStage } = {}, recipientCanWriteState, closed = false, viaCoordinator = []) {
  if (!Array.isArray(gaps) || !gaps.length) return null
  // M4g：派发记录里有的单列（loggedCoverageNotice），下面这一整段只说真没叫到、也没声明裁掉的。
  const logged = gaps.filter((g) => g.dispatched === true)
  const loggedOut = logged.length ? loggedCoverageNotice(logged, perStage, recipientCanWriteState, closed) : ''
  gaps = gaps.filter((g) => g.dispatched !== true)
  if (!gaps.length) return loggedOut
  const lines = gaps.map((g) => `  - ${g.stage} 的 ${g.role}`)
  const drivers = [...new Set(gaps.filter((g) => isDriverRole(g.role)).map((g) => g.role))]
  // 举例要同时满足两条才用真实的那一条：① 这一批是收窄过的（没收窄时这批名字里混着
  // 「这个项目根本用不上的角色」，拿它们举例同样是指向错的修法）；② 那一条不是驱动者
  // 本人。两条里缺一条就给占位形状——宁可让人多填两个尖括号，也不要递给他一条错的。
  const safe = gaps.find((g) => !isDriverRole(g.role))
  const shape = narrowed && safe ? `{"${safe.role}": "${safe.stage}"}` : '{"<角色名>": "<阶段 id>"}'
  const driverWarning = drivers.length
    ? `⚠️ 上面点名的 ${drivers.join('、')} 是**这一趟的驱动者本人**，它不参与「有没有被叫到」` +
      `的统计，**不要把它写进 trimmed**——state.json 的校验会放它过去（它确实是那几段的产者，` +
      `形状挑不出毛病），写进去等于声明这一趟把自己的驱动者裁掉了。它被点到名只有两种原因：` +
      `.agent-team/project.json 的 available_roles 里写了它（/agent-team:at-init 明令不要写` +
      `——去把它删掉），或者这一批根本没能按 available_roles 收窄。\n`
    : ''
  const widened = narrowed
    ? ''
    : `⚠️ 这一批**没能按「这个项目用得上哪些角色」收窄**（读不到 .agent-team/project.json ` +
      `的 available_roles），所以口径比平时宽：这个项目根本用不上的角色、以及 PM 自己做的` +
      `那几段（S1/S4/S8 那一类），都会算进来。**先把 available_roles 补上再判这批名字**` +
      `——它是 /agent-team:at-init 写的那一份；在补上之前不要照着下面${perStage ? '几' : '两'}条出路动手。\n`
  // 出路按触发列举：①真裁了、②真漏了，带 stage_roles 的 run 再加 ③那一段真被叫到过、只是漏记。**两支都要保留它们**
  // （③ 在两支里都有）：判据分辨不了这几种触发而读的人分辨得了，
  // 这件事不随收件人变（那正是这几条出路存在的全部理由，见上面那段）。变的只是
  // **谁动手**——写不了的那一支把动作换成「带着事实往上冒泡」，不是把信息删掉。
  const listed = perStage ? ' 或 stage_roles' : ''
  const outs = recipientCanWriteState
    ? `${perStage ? '三' : '两'}条出路，逐个按事实选一条：\n` +
      `  ① 本来就不打算用它（按需组队的主动裁剪）：把它写进 state.json 的 trimmed，` +
      `形状是 ${shape}——键是角色名，值是它在哪一段被裁掉的。` +
      `理由不用写在这里，它已经在 04-dispatch.md 里。` +
      `已经写过却还在报的话，先核字段名拼对了没有：state.json 的校验不拒未知键，` +
      `trimmed 拼错了不会有任何别的提示。\n` +
      (closed
        ? `  ② 不是裁剪，是漏了：这一趟已经收口，补不了派——照实告诉用户那一段漏了谁。\n`
        : viaCoordinator.length
          ? (() => {
              const direct = [...new Set(gaps.map((g) => g.role))].filter((r) => !viaCoordinator.includes(r) && !isDriverRole(r))
              return (
                `  ② 不是裁剪，是漏了：` +
                (direct.length ? `把它派出去（${direct.join('、')}），让它自己写出那一段的产物；` : '') +
                `${viaCoordinator.join('、')} 在最后一段派不出去（协调者不再派，它又是协调者、或者只能经协调者派）：真漏了，` +
                `就记一次回退、回到那一段补派（照 /agent-team:at 第 3 节「回退」），或者照实告诉用户。\n`
              )
            })()
          : `  ② 不是裁剪，是漏了：把它派出去，让它自己写出那一段的产物。\n`) +
      (perStage
        ? `  ③ 它在那一段真的被叫到过、只是 stage_roles 没记（去磁盘看那一段它的产物在不在，` +
          `04-dispatch.md 里怎么分的工）：把它并进 state.json 的 stage_roles 那一段，roster 里没有就一起累加——不用重派。\n`
        : '') +
      `⚠️ 不要为了让这条提示消失就把名字写进 roster${listed}：${perStage ? '它们' : 'roster '}记的是这一趟真的叫到过谁，` +
      `只写名字不派人，产物照样不存在——提示没了，洞还在，而且门禁不会再报它：账本比对只比对已经记过账的产物，` +
      `还看得见它的只剩 at-qa 开工前对 S5 实现记录的自查（只管 S5）与 /agent-team:at-status 的 ✗。同样，没真裁就别写进 trimmed。\n` +
      `这条只报不拦：选哪条都不会卡住你往下走，不选也不会。`
    : `⚠️ **这一条你改不了**：trimmed 与 roster 都住在 state.json 里，它是编排层的控制` +
      `文件，H3 写路径门禁在 PreToolUse 上把非 PM 对它的 Edit/Write 拒掉。而这条回传只` +
      `发给刚做完这次写入的那个上下文——**也就是你，PM 不会同时收到一份**。\n` +
      `**但你很可能正是知道答案的那个人**（判据分辨不了真裁剪还是真漏派，你分辨得了），` +
      `所以不要只把这几行转上去，带上事实：\n` +
      `  ① 本来就不打算用它（按需组队的主动裁剪）：它要写进 state.json 的 trimmed，` +
      `形状是 ${shape}——键是角色名，值是它在哪一段被裁掉的；**落盘是 PM 的动作**，` +
      `你把「是哪几条、为什么」说清楚就够了。\n` +
      `  ② 不是裁剪，是漏了：**派它出去这一半你可能真的做得到**（看花名册里你的 ` +
      `can_delegate_to 含不含它），做得到就派、让它自己写出那一段的产物；` +
      `**但记账那一半仍然在 PM 那边**——roster 记的是这一趟真的叫到过谁，同样住在 state.json。\n` +
      (perStage
        ? `  ③ 它在那一段真的被叫到过、只是 stage_roles 没记：说清是哪一段、它交了什么——补记是 PM 的动作，` +
          `stage_roles 同样住在 state.json。\n`
        : '') +
      `⚠️ 往上带的时候不要把它说成「把名字写进 roster${listed} 就行」：只写名字不派人，产物照样` +
      `不存在——提示没了，洞还在，而且门禁不会再报它：账本比对只比对已经记过账的产物，` +
      `还看得见它的只剩 at-qa 开工前对 S5 实现记录的自查（只管 S5）与 /agent-team:at-status 的 ✗。同样，没真裁就别建议写进 trimmed。\n` +
      `**把上面这几行原样冒泡给派你的人**，让它继续往上带到 PM；` +
      `**不要自己把它咽掉**——咽掉之后没有任何人会再看见它。\n` +
      `这条只报不拦：它没有卡住你往下走。`

  return (
    `【产者交代】下面这些角色是**已经走过的阶段**的产者，` +
    (perStage
      ? `而 state.json 既没记着这一趟在那一段叫到过它们（stage_roles）、`
      : `而这一趟既没叫到它们、`) +
    `也没声明裁掉它们——它们的缺席今天不会被任何别的判据看见：\n${lines.join('\n')}\n` +
    widened +
    driverWarning +
    outs +
    (loggedOut ? `\n${loggedOut}` : '')
  )
}

// M3z（docs/34）：「交过」——交付快照里有、磁盘与快照相同、不是上一轮的（hooks/lib/redo.mjs）。H2、H3 的重做判据共用。
function deliveredOf(ctx, fresh) {
  return makeDelivered({
    snapshot: readSnapshot(ctx.artifactBytes(DELIVERED_FILE)).products,
    // M4a 复核二（G1）：空文件不算交过（旧快照里记着它的空内容也一样）。
    artifactSha: (name) => {
      const bytes = ctx.artifactBytes(name)
      return bytes && !isBlankText(bytes) ? sha256OfContract(bytes) : null
    },
    isStale: fresh.isStale,
  })
}

// M3z：PM 写完 state.json 之后拍交付快照。只做 I/O；拍什么由 deliveredSnapshot 定。出错只留痕（少拦一侧）。
// 复核（redo-4）：只在 stage 变了（推进、回退）或者还没有快照时重拍——补记 stage_roles、记 escalation、标 accepted 这些写入不关补派
// 与【返工】出口的窗口。快照里记着拍它时的 stage。
function writeDeliveredSnapshot(ctx) {
  try {
    const prev = ctx.artifactBytes(DELIVERED_FILE)
    if (prev && readSnapshot(prev).stage === ctx.state?.stage) return
    const snapshot = deliveredSnapshot({
      stages: ctx.stages,
      stageId: ctx.state?.stage,
      diskSha: (name) => {
        const bytes = ctx.artifactBytes(name)
        return bytes ? { exists: true, sha: sha256OfContract(bytes), blank: isBlankText(bytes) } : { exists: ctx.artifactExists(name), sha: null }
      },
    })
    if (!snapshot) return
    writeFileSync(join(ctx.runDir, DELIVERED_FILE), `${JSON.stringify({ stage: ctx.state.stage, products: snapshot }, null, 2)}\n`)
  } catch (err) {
    process.stderr.write(`agent-team ledger 回传：交付快照没有写成（${quote(err?.message ?? err, { max: 120 })}），不记回退的重做这次少拦。\n`)
  }
}

// M3z：门禁专属文件的拒绝理由。路径是这次调用给的，过 inline。
// M4j（docs/45，审查第 20 条）：契约基线（hooks/lib/contract-base.mjs）。推进出第一段之后门禁第一次见到 state.json 时记下第 1 节、修订指纹与
// 修订块标题；已经有了就不动——在却读不出来的也不动（复核 F7：读坏就重记，会把改过的第 1 节洗成基线），留一行痕。切不出第 1 节的，记下
// 之后说一句【契约】（复核 F8）。写不进只是少拦，留一行痕。返回要追加的回传。
function ensureContractBase(ctx) {
  try {
    if (!isStageChain(ctx.stages) || !isPlainObject(ctx.state)) return []
    if (Object.keys(ctx.stages).indexOf(ctx.state.stage) <= 0) return []
    if (ctx.artifactExists(CONTRACT_BASE_FILE)) {
      if (!readContractBase(ctx.artifactBytes(CONTRACT_BASE_FILE))) {
        process.stderr.write('agent-team ledger：契约基线在却读不出来，这一趟第 1 节与对着上一版契约的结论不核（不重记，免得把改过的第 1 节记成基线）。\n')
      }
      return []
    }
    const base = initialBase(ctx.artifactBytes(CONTRACT_FILE))
    if (!base) return []
    writeFileSync(join(ctx.runDir, CONTRACT_BASE_FILE), `${JSON.stringify(base, null, 2)}\n`)
    return base.section1 === null
      ? ['【契约】契约里切不出第 1 节（「## 1. 用户原话」那一节，到下一个「## 2.」这样的编号节标题为止）：门禁这一趟不锁第 1 节，改了它也不会拦。' +
          '契约的格式见 at-contract-format：第 1 节逐字照抄用户原话。']
      : []
  } catch (e) {
    process.stderr.write(`agent-team ledger：契约基线写不进（${quote(e?.message ?? e, { max: 120 })}），这一次不记，下一次写 state.json 时再试。\n`)
    return []
  }
}

// M4k（docs/46，评审 F1、F2）：验收结论现在这份的 sha——approvals.jsonl 里有它的照现状交付批准、契约基线还没把它记成用过（复核中 2：按 sha 记，
// 同一份结论批两次也只盖一次修订）；没有给 null。
function unusedDeliverApproval(ctx, base) {
  const acc = acceptanceOf(ctx.stages)
  if (!acc) return null
  const accBytes = ctx.artifactExists(acc.name) ? ctx.artifactBytes(acc.name) : null
  const ab = ctx.artifactBytes(APPROVALS_FILE)
  if (!accBytes || !ab) return null
  const now = sha256OfContract(accBytes)
  if (Array.isArray(base.deliver_used) && base.deliver_used.includes(now)) return null
  return readDeliverApprovalEntries(ab.toString('utf8'), acc.name).some((e) => e.sha === now) ? now : null
}

// 修订那一刻还在跑的验证段角色（复核 F4）：这一趟派发记录里，验证段的派发、门禁没见它停下（最后一回是「拦」也算没停）的。角色与段只认
// 花名册与阶段链认得的（派发记录 Bash 写得进），说出来的都是插件自己的名字。
function runningVerifiers(ctx) {
  const bytes = ctx.artifactBytes(DISPATCHES_FILE)
  if (!bytes || !isStageChain(ctx.stages)) return []
  const log = readDispatchLog(bytes.toString('utf8'))
  const roster = loadRoster()
  const out = []
  for (const d of log.dispatches) {
    if (!Object.hasOwn(ctx.stages, d.stage) || !isVerifyStage(ctx.stages[d.stage])) continue
    if (!isPlainObject(roster) || !Object.hasOwn(roster, d.role)) continue
    const last = lastStop(log, d.agent_id)
    if (last !== null && last !== 'block') continue
    const label = `${d.role}（${d.stage}）`
    if (!out.includes(label)) out.push(label)
  }
  return out
}

// 写契约之后（复核 docs/45 §8）：修订指纹变了就按修订块标题分——不改需求的答复只换指纹；改需求的重拍验证段的快照、记下时刻，【契约】列出
// 对着上一版契约的结论与出路（看当前段），以及修订那一刻还在跑的验证段角色。第 1 节变了另说一段。已经收口的 run 只说一句另起一趟（复核
// F11：收口之后不再推进、不再回退）。没有基线（还在第一段）不说；在却读不出来留痕。
function contractBaseNotices(ctx) {
  const out = []
  try {
    const raw = ctx.artifactBytes(CONTRACT_BASE_FILE)
    const base = readContractBase(raw)
    if (raw && !base) {
      process.stderr.write('agent-team ledger：契约基线在却读不出来，这一次不核第 1 节与修订。\n')
      return out
    }
    const bytes = ctx.artifactBytes(CONTRACT_FILE)
    if (!base || !bytes) return out
    if (closedAt(ctx.state) !== null) {
      if (section1Drift(base, bytes) || bodyShaOf(bytes.toString('utf8'), base.deliver_blocks) !== base.body_sha) {
        out.push('【契约】这一趟已经收口：收口之后改契约，验证段的结论不再重出、门禁也不再核——交付之后的新改动另起一趟（/agent-team:at）。')
      }
      return out
    }
    const shas = verifyShasOf({ stages: ctx.stages, artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes })
    // M4k（docs/46，评审 F1、F2）：门禁记下的、绑着验收结论现在这份、还没用过的照现状交付批准——有它，这次修订就是记那条答复的那一次，不算改需求。
    const rev = revisedBase(base, bytes, shas, new Date().toISOString(), unusedDeliverApproval(ctx, base))
    if (rev) writeFileSync(join(ctx.runDir, CONTRACT_BASE_FILE), `${JSON.stringify(rev.base, null, 2)}\n`)
    if (rev && rev.deliver) {
      out.push(
        '【契约】这次修订记的是用户照现状交付的答复：门禁用掉了那条批准（一条批准只盖一次修订），这次不算改需求，验证段的结论不用重出。' +
          '之后再改需求，照常重拍。',
      )
    }
    if (section1Drift(base, bytes)) {
      out.push(`【契约】${driftHead(ctx.stages)}；这次写入之后磁盘上的第 1 节跟它不一样。${DRIFT_FIX}。改回去之前，推进与收口都会被拒。`)
    }
    if (rev && rev.requirement) {
      const snap = Object.keys(rev.base.verify_base)
      const running = runningVerifiers(ctx)
      const parts = []
      if (snap.length) {
        const fix = outdatedFix(ctx.stages, snap, ctx.state?.stage)
        parts.push(
          `验证段已经写成的 ${snap.join('、')} 对着的是上一版契约（门禁记下了它们这一刻的样子）。推进出验证段与收口之前，它们要对着这一版重出——${fix.text}。`,
        )
      }
      if (running.length) parts.push(`还在跑的 ${running.join('、')}：门禁没见它停下，它交的结论同样算对着上一版契约——停下之后在那一段同段重派它重出。`)
      if (parts.length) out.push(`【契约】契约改了：${parts.join('')}`)
    }
  } catch (e) {
    process.stderr.write(`agent-team ledger：契约基线读写出错（${quote(e?.message ?? e, { max: 120 })}），这一次不核第 1 节与验证段的新旧。\n`)
  }
  return out
}

// M4k（docs/46）：记录器判「照现状交付要不要记」时读的验收结论——在不在、空不空、sha、首行（approvals.mjs 的 planApprovals 那一支）；评审 F3：
// 对不对着上一版契约（与 H6 的契约判据同一份 outdatedProducts）——复核（低 4）：验证段里不是项目经理自己写的那几份（测试报告、验收结论）有一份对着
// 上一版就算（测试报告对着上一版，收口要回退重测，验收结论跟着重出，批准白记）；契约基线读不出来就当不对着（少拦）。复核（中 2）：这份验收结论已经
// 记过的照现状交付批准（approved）。
function acceptanceOnDisk(ctx, name) {
  const bytes = ctx.artifactExists(name) ? ctx.artifactBytes(name) : null
  let outdated = false
  try {
    const base = readContractBase(ctx.artifactBytes(CONTRACT_BASE_FILE))
    if (base && bytes) {
      const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
      const log = logBytes ? readDispatchLog(logBytes.toString('utf8')) : null
      const diskSha = (n) => {
        const b = ctx.artifactExists(n) ? ctx.artifactBytes(n) : null
        return b ? { exists: true, sha: sha256OfContract(b) } : { exists: false, sha: null }
      }
      outdated = outdatedProducts({ stages: ctx.stages, base, diskSha, lastDispatchAt: lastDispatchAtOf(ctx.stages, log) }).some(
        (n) => !isContractWriter(producerOfName(ctx.stages, n)?.role),
      )
    }
  } catch {}
  const ab = ctx.artifactBytes(APPROVALS_FILE)
  return {
    name,
    exists: Boolean(bytes),
    blank: bytes ? isBlankText(bytes) : false,
    sha: bytes ? sha256OfContract(bytes) : null,
    verdict: bytes ? acceptanceVerdict(bytes) : null,
    outdated,
    approved: readDeliverApprovals(ab ? ab.toString('utf8') : null, name),
  }
}

function gateFileReason(checked, exotic) {
  const leafIs = (name) => leafName(checked) === name || (typeof checked === 'string' && leafName(norm(checked)) === name)
  const approvals = leafIs(APPROVALS_FILE)
  const what = approvals
    ? '这是门禁自己记的用户批准：返工批准（用户在 AskUserQuestion 里选了「再返工一轮：回到 <段>」、或者在对话里单独发了这一条，而这一轮真的' +
      '需要批准时）与照现状交付的批准（用户选了「照现状交付」、或者单独发了这一条，而验收结论没过时），门禁自己记下它；照门禁拒绝理由里的问法去问用户。'
    : leafIs(DISPATCHES_FILE)
      ? '这是门禁自己记的派发记录（谁在哪一段被派出去、谁派的、交付物核验拦过它几回），子代理完成时门禁靠它核产物，不用、也不许改。'
      : leafIs(CONTRACT_BASE_FILE)
        ? '这是门禁记下的契约基线（推进出第一段时契约第 1 节的原文，每一次改需求的修订那一刻验证段各份结论的样子），门禁自己维护，不用、也不许改。'
        : '这是门禁自己拍的交付快照，PM 推进或回退之后由门禁照磁盘重拍，不用、也不许改。'
  return (
    `agent-team 门禁：不得写 ${inline(checked)}——${exotic ? `${exotic}；它可能就是门禁专属文件。` : ''}${what}` +
    '任何人（包括项目经理与主线程）都不用 Edit/Write 写它。'
  )
}

// M3z：H6 因为返工预算拒绝时，补一句「用户的批准会不会记不下」——记录器记在 current-run 指向的那一趟 run 里，读不到运行状态、
// 或者这份 state.json 不在那一趟里时，照拒绝理由问了也白问。出任何意外都只是不补。
function approvalDiagnostic(stateFile) {
  try {
    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    if (!ctx.ok) {
      return ctx.kind === 'no-run'
        ? '\n另外：门禁现在找不到进行中的 run（.agent-team/current-run 不在），用户的回答会记不下——先把 current-run 指回这一趟 run。'
        : `\n另外：门禁现在读不到这个项目的运行状态，用户的回答会记不下——先修：${runContextFix(ctx.cause)}`
    }
    if (norm(ctx.runDir) !== norm(dirname(stateFile))) {
      return (
        `\n另外：这份 state.json 不在 current-run 指向的那一趟 run 里（current-run 指向 ${quote(ctx.runId)}）——用户的回答会记到那一趟，` +
        '不算这一趟的批准。先把 current-run 指回这一趟。'
      )
    }
    return ''
  } catch {
    return ''
  }
}

// M3z 复核（platform-3）：批准记录的排他锁。run 目录里一个 approvals.jsonl.lock，open 'wx' 拿得到才算拿到；拿不到每 25ms 再试，
// 最多约 5 秒；锁文件比 5 秒还旧就当是崩掉的进程留下的，删了再拿。到头还拿不到就不加锁照做——记录器 fail open，宁可在极端情形下
// 多记一条，也不让一条真的批准因为锁丢掉。锁文件在 run 目录里不是任何阶段的产物，H3 不让角色碰它。
function withApprovalsLock(runDir, body) {
  const lock = join(runDir, `${APPROVALS_FILE}.lock`)
  let fd = null
  for (let i = 0; i < 200 && fd === null; i++) {
    try {
      fd = openSync(lock, 'wx')
    } catch (err) {
      if (err?.code !== 'EEXIST') break
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5000) {
          unlinkSync(lock)
          continue
        }
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try {
    return body()
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {}
      try {
        unlinkSync(lock)
      } catch {}
    }
  }
}

// M4d（docs/38，全量审查第 19 条）：往当前 run 的派发记录（runs/<id>/dispatches.jsonl，门禁专属）追加一行。只追加、一次写一整行（O_APPEND）：
// 并发的几个门禁进程各写各的，不读后判、不加锁。末字节不是换行（手改过、被截断）时先补一个。写不进只留痕——完成核验这一次少核。
function appendDispatchLog(runDir, line, label) {
  try {
    const file = join(runDir, DISPATCHES_FILE)
    let sep = ''
    // 复核：只读最后一个字节（原来整份读进来，只为看它）。
    try {
      const fd = openSync(file, 'r')
      try {
        const { size } = fstatSync(fd)
        if (size > 0) {
          const last = Buffer.alloc(1)
          readSync(fd, last, 0, 1, size - 1)
          if (last[0] !== 0x0a) sep = '\n'
        }
      } finally {
        closeSync(fd)
      }
    } catch {}
    appendFileSync(file, `${sep}${line}\n`)
  } catch (err) {
    process.stderr.write(`agent-team ${label}：派发记录没有写成（${quote(err?.message ?? err, { max: 120 })}），完成核验这一次少核。\n`)
  }
}

// M4d（docs/38，全量审查第 19 条）：产物没交时 H5a（前台派发跑完、认不出前台还是后台）与完成核验（后台派发完成）共用的那一段。why 为 null 是认不出
// 派发是前台还是后台的那一格（tool_response 没有 status）：文案与改之前逐字相同。其余按 why 说成因（hooks/lib/completion.mjs 的
// explainMissing）：冒泡了、门禁拦过它而平台静默放行、门禁没拦它、通知说它没正常结束。还旧那一段各格照旧带——知道它已经跑完的几格
// 不再说「等它写完（异步派发时）」。
// M4d 复核：这几份能靠 trimmed 免掉时（advance.mjs 的 mayWaive：S2、S5 这类按叫到的人展开产物的段里，不在任何前置里、不是验证段的），
// 给 PM 的出路带上写法（与推进那一次 H6 的拒绝理由同一条路）。不能免就是空串。段与角色是插件自己的名字（已经核过）。
function trimHintFor(stages, stageId, role, names) {
  if (!names.length || !names.every((n) => mayWaive(stages, stageId, n))) return ''
  return `这一趟确实不要它这几份的，推进出 ${stageId} 的那一次把 {"${role}": "${stageId}"} 写进 trimmed（理由记进 04-dispatch.md）。`
}

function missingNotice({ ctx, r, role, recipientCanWriteState, why = null, redispatch = `再派 ${role} 一次`, trimHint = '' }) {
  const wait = why === null
  const { accept: staleAccept, redo: staleRedo } = splitByAccept(ctx.stages, r.stale)
  const bothKinds = staleAccept.length && staleRedo.length
  const acceptPart = !staleAccept.length
    ? ''
    : recipientCanWriteState
      ? `${bothKinds ? `${staleAccept.join('、')}：` : ''}这一轮接受上一轮那份原样，就在 state.json 的 rework_base 里把它的值改成 "accepted"；` +
        (wait ? `否则等 ${role} 写完（异步派发时），或者重派它这一轮重写。` : '否则重派它这一轮重写。')
      : (wait
          ? `rework_base 只有项目经理改得了：它这一轮还没重写，就等它写完（异步派发时），或者重派 ${role} 让它这一轮重写；`
          : `rework_base 只有项目经理改得了：重派 ${role} 让它这一轮重写；`) +
        `你判断上一轮那份${bothKinds ? `（${staleAccept.join('、')}）` : ''}这一轮不用改，就把这一点冒泡给派你的人，由项目经理标 "accepted"。`
  const redoPart = !staleRedo.length
    ? ''
    : `${staleRedo.join('、')}：${VERIFY_REDO}——` + (wait ? `等 ${role} 重跑写完（异步派发时），或者重派它。` : '重派它。')
  const staleOut =
    acceptPart + redoPart + (recipientCanWriteState ? '推进出这一段时，H6 会拦住还是上一轮的产物。' : '')
  const staleText = r.stale.length
    ? `${r.stale.join('、')} 还是上一轮的（返工轮：磁盘内容与回退那一刻 rework_base 记的 sha 相同，这一轮还没有重写）`
    : ''
  // M4a 文档核对（docs/35）：空文件单列（r.blank），没有它时文案与原来逐字相同。
  const blankList = Array.isArray(r.blank) ? r.blank : []
  const blankText = blankList.length ? `${blankList.join('、')} 是空文件（空文件不算交了）` : ''
  const tail = [blankText, staleText].filter(Boolean).join('；')
  if (wait) {
    return !r.stale.length && !blankList.length
      ? `⚠️ 交付物校验：${role} 在 ${r.stageId} 应当产出 ${r.missing.join('、')}，` +
          `但磁盘上还没有。${SUBAGENT_STOP_RETRY_NOTE}` +
          `。不要仅凭"子代理正常返回"就判断这一段已经完成，去 run 目录核实产物是否存在。`
      : (r.missing.length
          ? `⚠️ 交付物校验：${role} 在 ${r.stageId} 应当产出 ${r.missing.join('、')}，但磁盘上还没有；${tail}。`
          : `⚠️ 交付物校验：${role} 在 ${r.stageId} 的 ${tail}。`) +
          `${SUBAGENT_STOP_RETRY_NOTE}。不要仅凭"子代理正常返回"就判断这一段已经完成，去 run 目录核实。` +
          (r.stale.length ? staleOut : '')
  }
  const facts = [r.missing.length ? `${r.missing.join('、')} 还没有` : '', tail].filter(Boolean).join('；')
  // 冒泡的理由是子代理写的文字：外部值，过 quote（一对引号里、截断、转义、消去受信前缀；docs/27 §2.1）。
  const head =
    why.kind === 'bubble'
      ? `⚠️ 交付物校验：${role} 在 ${r.stageId} 冒泡了` +
        (why.reason ? `：${quote(why.reason, { max: 160 })}。` : '（理由写在它回报的下文里）。') +
        `它这一段该交的没交齐：${facts}。`
      : `⚠️ 交付物校验：${role} 在 ${r.stageId} 没交齐：${facts}。`
  return head + explainMissing(why, { recipientIsPm: recipientCanWriteState, redispatch, trimHint }) + (r.stale.length ? staleOut : '')
}

// M4d（docs/38，全量审查第 19 条修法 3）：协调者返回、它协调的那一段还没齐时，列出门禁记着它（这一次运行，按 agent_id）在这一段派出去的执行角色、
// 各自产物现在的样子与门禁见没见它停下（lastStop）。复核：认不出协调者这次运行的 agent_id 就不报——原型退回按角色名认，同一段里派过几次
// 架构师，会把上一次运行派的人也列进来。
// M4d 复核：账本比对的「没记」里剔掉当前段的产物——前台跑完时它自己与同一段的兄弟刚交、PM 还没记的那几份（见 deliverable 分支 ownFresh 上方）。
function withoutOwn(cmp, own) {
  if (!Array.isArray(own) || !own.length || !isPlainObject(cmp) || !Array.isArray(cmp.unrecorded)) return cmp
  return { ...cmp, unrecorded: cmp.unrecorded.filter((u) => !own.includes(u.name)) }
}

// M4h（docs/43，审查第 14 条的 S2 进度）：selfDone——返回的协调者自己也是这一段的产者、它那几份交了（S2 的 at-product）。
function progressOf({ ctx, fresh, log, coordinator, coordinatorId, stageId, recipientIsPm, selfDone = false }) {
  const stage = ctx.stages?.[stageId]
  if (!isPlainObject(stage) || !coordinatorId) return null
  const producers = stageRoles(stage)
  const byRole = new Map()
  for (const d of log.dispatches) {
    if (d.stage !== stageId || !producers.includes(d.role) || d.caller_id !== coordinatorId) continue
    byRole.set(d.role, d)
  }
  const rows = [...byRole.values()].map((d) => ({
    role: d.role,
    mode: d.mode === 'foreground' ? 'foreground' : 'background',
    stop: lastStop(log, d.agent_id),
    items: expandProduces(stage, [d.role]).map((name) => ({
      name,
      state: !ctx.artifactExists(name) ? 'missing' : fresh.isBlank(name) ? 'blank' : fresh.isStale(name) ? 'stale' : 'ok',
    })),
  }))
  return coordinatorProgress({ role: coordinator, stageId, rows, recipientIsPm, selfDone, impl: isRolePatternStage(stage) })
}

function main() {
  // 门禁留痕用：只是一个标记，不参与任何判定（见上面 TRACE_STATE 那段）。
  TRACE_STATE.entered = true
  if (!KNOWN_CHECKS.has(CHECK)) {
    process.stderr.write(
      `agent-team: 未知的检查项 ${JSON.stringify(CHECK)}；hooks.json 与 checks.mjs 已漂移。\n`,
    )
    // 未知检查项时事件名也不可知，按最常见的 PreToolUse 报，安全边界优先于精确。
    denyAndExit(
      `agent-team 门禁收到未知的检查项 ${JSON.stringify(CHECK)}，按安全边界拒绝。` +
        `hooks.json 注册的检查名与 checks.mjs 认得的不一致。`,
      'PreToolUse',
    )
  }

  const spec = CHECKS[CHECK]
  const input = readStdin()
  INPUT = input

  if (!isValidInput(input)) {
    // 读不到可判定的输入。fail closed 的检查项拒绝；fail open 的放行，但不静默（M3v：此前这里零输出，与「判过了、
    // 结论是放行」分不出来）。
    if (spec.failClosed) {
      denyAndExit('agent-team 门禁无法读取 hook 输入，按安全边界拒绝。', spec.event)
    }
    inputUnreadable(spec, 'stdin 不是一个 JSON 对象')
  }

  if (spec.toolNames !== null) {
    if (typeof input.tool_name !== 'string') {
      if (spec.failClosed) {
        denyAndExit(
          'agent-team 门禁无法从 hook 输入中读出 tool_name（缺失或不是字符串），按安全边界拒绝。',
          spec.event,
        )
      }
      inputUnreadable(spec, 'tool_name 缺失或不是字符串')
    }
    if (!spec.toolNames.includes(input.tool_name)) {
      // 这次调用确实与本检查项无关，保持沉默、不表态。
      process.exit(0)
    }
  }

  if (CHECK === 'delegation') {
    const result = decideDelegation(input, loadRoster())
    // M4i 复核（docs/44 §8）：被设置或 --agent 换掉的主会话（带 agent_type、不是项目经理、没有 agent_id）被拒时，理由末尾说身份——H1 的
    // 「冒泡给上级」对它不成立（M10e：架构师被 --agent 换成主会话）。别的调用者 selfCheckIdentity 返回空串。
    if (result.decision === 'deny') denyAndExit(result.reason + selfCheckIdentity(input, '派发'), spec.event)
  }

  if (CHECK === 'readiness') {
    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    // H2 是流程辅助：读不到运行上下文时 fail open，但规格 §6 写的是
    // allow + warning，不是静默放行——必须留痕，不能一声不吭就 exit(0)。
    // M3v（docs/30）：这里只往 stderr 留痕，告诉 PM 与用户的那一段在 H5a（PostToolUse:Agent）上说。理由两条，都实测过：
    // PreToolUse 上几道 hook 的 additionalContext 被平台并成一段、不标来源，受信块放在这里会让别家插件的文字读起来像
    // 它的续行（会话 ccf48d1e）；H1 拒掉的派发不跑 PostToolUse:Agent（会话 df24bc74），挪到 H5a 就不会对一次被拒的派发
    // 说「这次派发没有做校验」。时机上两者等价：默认的后台派发下，两处的回传都紧跟在「Async agent launched」之后。
    if (!ctx.ok) {
      // 文案与措辞口径统一在 failOpenNotice 里，见那里的注释。H2 不按
      // ctx.kind 分派行为（两种 kind 都放行），但留痕的措辞要分——
      // "没有 run"和"读不到上下文"对读到它的人不是同一件事。
      process.stderr.write(failOpenNotice('H2 就绪门禁', ctx))
      process.exit(0)
    }
    const target = stripPluginPrefix(input?.tool_input?.subagent_type)
    if (!target) {
      // Task 3 评审 Minor 5：这也是一次 fail open——门禁认不出目标角色，
      // 不是"这次调用与本检查项无关"（那种情况在上面 toolNames 那道前置
      // 校验里已经处理并保持沉默）。按 §6 的 allow + warning 对齐，同样留痕。
      process.stderr.write(
        'agent-team H2 就绪门禁：这次调用没有可判定的目标角色（subagent_type 缺失或为空），跳过本次校验、放行。\n',
      )
      process.exit(0)
    }
    // M3w（docs/31，全量审查第 13 条）：多段角色（at-ui 在 S2 与 S5）此刻做哪一段由派发者决定——at-product 派的是 S2 的活，
    // at-architect 派的是 S5 的活。把派发者与它沿花名册派得到的角色传进去，判定在 decideReadiness 里（口径与理由在那里）。
    // 派发者不在花名册里时 reach 里没有它，传 null，decideReadiness 退回不剪。
    // M4a（docs/35）：收口之后派花名册里的任何角色、最后一段没收口时派协调者 → 拒（hooks/lib/closing.mjs）。排在就绪判据之前：
    // 已收口的 run 上，「前置还缺」「记一次回退」都是走不通的出路。
    const closedRd = decideClosedDispatch({
      stages: ctx.stages,
      state: ctx.state,
      target,
      roster: loadRoster(),
      callerCanWriteState: isContractWriter(input?.agent_type),
      runId: ctx.runId,
      atPath: join(ROOT, 'commands', 'at.md'),
    })
    if (closedRd.decision === 'deny') denyAndExit(closedRd.reason, spec.event)
    const caller = callerOf(input)
    const reach = computeReach({ roster: loadRoster(), paths: {} })
    // M3y（docs/33，全量审查第 15 条）：「齐了没」与「前置在不在」按 freshness 判——返工轮里磁盘内容与 rework_base 记的 sha
    // 相同的产物是上一轮的，不让一段判齐、不算前置在。还是上一轮的前置单独说，出口按派发者分（写得了 state.json 的给
    // 「标 accepted」，别的叫它冒泡；谓词与 H3 同一个 isContractWriter）。
    const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base })
    // M4h（docs/43，审查第 38 条）：整段裁掉的段——与推进、收口同一份 wholeStageTrimmed，「叫过」并上门禁的派发记录。
    const readinessDispatched = (() => {
      const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
      return logBytes ? dispatchedByStage(readDispatchLog(logBytes.toString('utf8'))) : null
    })()
    const r = decideReadiness({
      targetRole: target,
      stages: ctx.stages,
      artifactExists: fresh.artifactCurrent,
      artifactStale: fresh.isStale,
      // M2a：与 deliverable 分支那次 compareArtifacts 同一个口径——undefined 而不是 []，state.json 坏掉时
      // 退回「全部 producers」这个更宽的集合，宁可多判一次未完成，不要漏。
      // ⚠️ M3x：这里**有意**仍传整趟 roster，不按段取（participantsOf）——H2 放行与否取决于「齐了没」，整趟口径是更严的一侧；
      // 按段取在当前段记账之前只剩目标自己那一份，重派时它在就判齐、前置不查。整趟口径多等的只有别段叫到过、还没交的 S5 产者
      // （有界面的项目里是 S2 的 at-ui），其余情形两种口径一样放行——那是 H2「齐了就跳过前置」的既有设计（docs/11 §5.33 的收口；
      // 判据在 tests/gate-readiness.test.mjs 的「readiness（M3x）」）。
      roster: Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined,
      caller,
      callerReach: Object.hasOwn(reach, caller) ? reach[caller].reachableRoles : null,
      callerCanWriteState: isContractWriter(input?.agent_type),
      trimmedAway: (sid) => wholeStageTrimmed(ctx.stages, sid, ctx.state, null, readinessDispatched),
    })
    if (r.decision === 'deny') denyAndExit(r.reason, spec.event)

    // M3z（docs/34，全量审查第 16 条）：不记回退就重派。叶子角色（花名册里派不出任何人）按派发者选出的候选段全都早于 state.stage、
    // 它在这些段的产物都交过（交付快照里有、磁盘与快照相同、不是上一轮的）→ 再派它就是重做，拒。判定与理由在 hooks/lib/redo.mjs。
    const roster = loadRoster()
    const rd = decideRedispatch({
      stages: ctx.stages,
      stageId: ctx.state?.stage,
      target,
      roster,
      candidates: candidateStages(ctx.stages, target, caller, Object.hasOwn(reach, caller) ? reach[caller].reachableRoles : null),
      isDelivered: deliveredOf(ctx, fresh),
      callerCanWriteState: isContractWriter(input?.agent_type),
    })
    if (rd.decision === 'deny') denyAndExit(rd.reason, spec.event)
  }

  if (CHECK === 'writepath') {
    // 门禁自检（M3t，docs/28，全量审查第 4 条）：写 .agent-team/gate-check 一律拒，理由带着
    // 「在线」固定串。排在一切之前——主线程豁免、读运行上下文都在它后面：自检要在没有
    // .agent-team 的项目里、坏掉的 run 里、由主线程发起时都拿得到回答。协议在 agents/at-pm.md。
    // M3v：调用者是 PM 时，理由末尾可能追加一句运行状态的说明（selfCheckTail）。
    const checked = input.tool_name === 'NotebookEdit' ? input?.tool_input?.notebook_path : input?.tool_input?.file_path
    if (isGateCheck(checked)) denyAndExit(gateCheckReason() + selfCheckTail(input, checked) + selfCheckIdentity(input), spec.event)

    // M3z（docs/34，全量审查第 16 条）：门禁专属文件（返工批准记录、交付快照）任何人都不用 Edit/Write 改，PM 与主线程也不行——
    // 排在主线程豁免与读运行上下文之前，与门禁自检同一个位置。按路径形状认任何项目的 runs/<id>/ 下的这两个名字；写法认不出
    // （流后缀、结尾带点）时末段先规范化（control-files.mjs 的 leafName），.agent-team 在的项目里认不出的写法一律拒（与 H6 认
    // state.json 同一个口径）。
    // 复核（platform-1）：上一版先拿字面末段筛一道，8.3 短名、末段是 `.` 的写法、指向它的链接都从筛子里漏过去，而主线程豁免就在
    // 后面。isGateFile 走 norm()（解析 .、..、链接、8.3 短名），每一次 Edit/Write 都认一遍；字面末段只用来决定要不要先查认不出的写法。
    const exotic =
      mayBeGateFile(checked) && existsSync(join(ROOT_PROJECT, '.agent-team')) ? exoticPath(checked, ROOT_PROJECT) : null
    if (exotic || isGateFile(checked)) denyAndExit(gateFileReason(checked, exotic), spec.event)

    // MAIN（无 agent_type）不受 per-role 隔离约束——H3 隔离的是
    // project.paths 里登记的各角色之间的边，主线程不是参与路径认领的
    // 一方。callerOf 对 agent_type 缺失/为 null 统一归为 MAIN，跟 H1
    // 判定调用者身份用的是同一个函数，口径不重复定义。这一步排在读运行
    // 上下文之前，因为它完全不需要上下文就能判定，没必要为了判它去多读
    // 一次磁盘。
    //
    // 注意：这条豁免解决不了自举死锁——见下面 ctx.kind 的注释。带
    // agent_type 的调用不算这里的"主线程"，哪怕值恰好是 at-pm：
    // settings.json 的 agent 键把 at-pm 钉成主线程 agent 时，主线程的
    // hook 输入照样带 agent_type（docs/05-M0-结论.md「次要事实」），这种
    // 配置下 at-pm 会作为一个有名有姓的角色继续往下走 per-role 判定，
    // 不享受这条豁免（Task 4 复审 1）。
    // M4i 复核（docs/44 §8，低-7）：与 H1 同一个形状检查——agent_type 在却认不出，就判不出它归不归本插件管，按安全边界拒（原来走
    // 下面「花名册外的调用者放行」）。
    if (malformedCaller(input)) denyAndExit(malformedCallerReason('写入'), spec.event)
    const role = callerOf(input)
    if (role === MAIN) process.exit(0)

    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    // ctx.ok 为 false 时按 ctx.kind 分派，不能笼统 fail closed。两种 kind
    // 的定义、为什么要分、不分会怎样自举死锁——权威解释在
    // hooks/lib/runctx.mjs 头部注释，不在这里重复第二遍：'no-run' 按 H2
    // 先例 fail open + stderr 留痕（不能静默，静默的放行和门禁坏掉长得
    // 一模一样）；'unreadable' 继续 denyAndExit。
    if (!ctx.ok) {
      if (ctx.kind === 'no-run') {
        process.stderr.write(failOpenNotice('H3 写路径门禁', ctx))
        process.exit(0)
      }
      // 全分支评审 I2：'unreadable' 对子代理继续 fail closed，但 PM 要放行。
      // 上面 role === MAIN 那条豁免盖不住这种情形——settings.json 的 agent 键
      // 把 at-pm 钉成主线程时，主会话自己的调用带 agent_type（原始值是全名 "agent-team:at-pm"，docs/22），落不进
      // MAIN。而这里的 deny 发生在看路径之前，拒的是这个会话的**每一次**
      // Edit/Write；agents/at-pm.md 现在有 Bash（M1c 设计 §1.1 的上界要求——M4b 订正：那条「上界」的前提，主线程的
      // tools: 封顶子代理的工具，P4 实测不成立；M4b 裁定保留，理由是跑构建与测试（docs/36 §2.9）。这条
      // 注释此前写的是「PM 的工具面没有 Bash」，commit 2d0147c 给 at-pm.md 加上
      // Bash 之后这句话就不成立了，评审发现 5 指出没人回来改），但逼 PM 用
      // `echo >` 去修一个坏掉的 run 不是可接受的运维路径；触发条件又很廉价
      // （project.json / state.json 坏了、current-run 被截断成空文件，任意一条
      // 即可）。三点叠起来就是把插件唯一的运维人锁在门外，只能由用户离开 Claude 手工改文件——
      // 而修复一个坏掉的 run 恰恰要 PM 动手。这跟 H4 在 contract 分支里已经做的
      // 是同一件事、同一个死锁形状（见下面那段注释），谓词也复用同一个
      // isContractWriter，不另写一份 role === 'at-pm'：那个谓词的安全性依赖
      // （当前花名册里没有角色能派发给 at-pm，由 tests/roster-closure.test.mjs
      // 钉住）写在 hooks/lib/contract-guard.mjs 里，只该有一处。
      //
      // 只免除 unreadable 这一支，不像 H4 那样提到读 ctx 之前：ctx 读得出来时
      // at-pm 在 run 目录内仍只能写自己阶段的产物，**控制文件**那一类由 decideWritePath
      // 顶部单独放行（docs/09 账一 / 规格 §6.2.1），run 目录之外由它的按角色隔离第 1 步放行（M3u）。
      // ⚠️ 这两条路径不要混：PM 第一次建 run 时 state.json 还不存在，ctx 是
      // unreadable，放行它的是**这条 I2 豁免**；run 建好之后（ctx.ok）放行它的才是
      // 控制文件规则。tests/gate-writepath.test.mjs 两条都钉住了，别把其中一条的
      // 通过当成另一条生效。
      if (isContractWriter(role)) {
        process.stderr.write(
          `agent-team H3 写路径门禁：读不到运行上下文（${ctx.reason}），但调用者是 PM` +
            `（项目经理），本次放行、不拦截——修复一个坏掉的 run 恰恰要 PM 动手。` +
            `若你不是在修 run，先检查 .agent-team/current-run 与 .agent-team/project.json。\n`,
        )
        process.exit(0)
      }
      // M4i 复核（docs/44 §8，M10f）：被换掉的主会话自举到一半（runs 下非空、指针还没写）就落到这里，理由只说「有人建过 run 而指针不在」，
      // 它会当成别人留下的坏 run——末尾接上身份那一句（别的调用者返回空串）。
      denyAndExit(
        `agent-team 写路径门禁读不到运行上下文（${ctx.reason}），按安全边界拒绝。` + selfCheckIdentity(input, '写入'),
        spec.event,
      )
    }

    // Edit/Write 的路径字段是 tool_input.file_path；NotebookEdit 的路径字段
    // 是 tool_input.notebook_path，它的工具 schema 里根本没有 file_path。
    // 按 tool_name 精确分派，不用 ?? 兜底——?? 依赖"两个字段互斥"这个对
    // 工具 schema 的假设，而门禁自己没有办法验证这个假设成立；tool_name
    // 在这里已经确定是 Edit/Write/NotebookEdit 之一（main() 顶部
    // toolNames 校验过），按它分派更严格，成本只有一行（评审三轮 Minor 2）。
    const filePath =
      input.tool_name === 'NotebookEdit'
        ? input?.tool_input?.notebook_path
        : input?.tool_input?.file_path
    const r = decideWritePath({
      role,
      filePath,
      project: ctx.project,
      runDir: ctx.runDir,
      stages: ctx.stages,
      agentTeamDir: ctx.agentTeamDir,
      roster: loadRoster(),
    })
    // M4i 复核（docs/44 §8，低-8）：主会话被设置或 --agent 换掉时（带 agent_type、不是项目经理、没有 agent_id），拒绝理由末尾说身份——
    // 它没有上级，「冒泡给上级」对它不成立；它第一次撞上的往往就是写控制文件这一下（selfCheckIdentity 对别的调用者返回空串）。
    if (r.decision === 'deny') denyAndExit(r.reason + selfCheckIdentity(input, '写入'), spec.event)

    // M3z（docs/34，全量审查第 16 条）：不记回退就重做。非 PM 写 run 目录里自己名下、早于 state.stage 那一段的产物，它在当前段
    // 又没有活、那份已经交过 → 拒（hooks/lib/redo.mjs）。PM 自己的产物不判（契约修订块、04-dispatch.md 的增补都是正文明令）。
    if (!isContractWriter(role) && typeof filePath === 'string' && ctx.runDir && underDir(filePath, ctx.runDir)) {
      const owner = stageOwnerOfRunPath(ctx.stages, norm(ctx.runDir), norm(filePath))
      if (owner && owner.role === role) {
        const reach = computeReach({ roster: loadRoster(), paths: {} })
        const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base })
        const rd = decideRedoWrite({
          stages: ctx.stages,
          stageId: ctx.state?.stage,
          role,
          owner,
          filePath,
          isDelivered: deliveredOf(ctx, fresh),
          reachableRoles: Object.hasOwn(reach, role) ? reach[role].reachableRoles : null,
          // M4a 文档核对（docs/35）：空的兄弟产物不算「刚补上」——否则一份空文件就让补派豁免一直开着（1.8.0 拒这一写入）。
          artifactExists: (n) => ctx.artifactExists(n) && !fresh.isBlank(n),
          closed: closedAt(ctx.state) !== null,
        })
        if (rd.decision === 'deny') denyAndExit(rd.reason, spec.event)
      }
    }
  }

  if (CHECK === 'contract') {
    // Task 5 评审顾虑 2：H4 的规则是"任何 subagent 不得写契约"——调用者是
    // PM（MAIN 或被钉住的 at-pm）时，H4 对这次调用根本没有意见，跟运行
    // 上下文读不读得出来无关。短路排在读 ctx 之前，跟 writepath 的 MAIN
    // 短路同构，理由却不同：不是"没必要为了判它去多读一次磁盘"，而是
    // unreadable 时如果连 PM 都被拦住，后果比"多拒一次"更糟——修复一个
    // 坏掉的 run（比如这里的 project.json 本身就是坏的）恰恰要 PM 动手，
    // 门禁会把自己需要的人也锁在门外，跟 H3 已经修过的自举死锁是同一个
    // 形状。at-pm 单独列出的安全性依赖什么、为什么不怕子代理冒充，见
    // hooks/lib/contract-guard.mjs 里 isContractWriter 上方的完整注释（不
    // 在这里重复第二遍）：同一条判断提前到读 ctx 之前，从 isContractWriter
    // 里 import，不在这里另写一份；decideContractGuard 内部那份调用是这个
    // 函数自身对任意调用方（不只是 gate.mjs）的契约，从这条入口路径上走
    // 不到第二遍——两处调用点服务的是不同的调用面，不是同一件事测了两遍
    // （Task 5 评审 Important 1）。
    //
    // unreadable 对子代理继续 fail closed，这条不放松——读不到 runDir 就
    // 算不出哪个文件是契约，那时拒绝是对的；这条短路只免除 PM 自己。
    if (isContractWriter(input?.agent_type)) process.exit(0)

    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    // ctx.kind 的处理照抄 writepath：'no-run' fail open + stderr 留痕，
    // 'unreadable' 才 denyAndExit——权威解释见 hooks/lib/runctx.mjs 头部
    // 注释，不在这里重复第二遍。没有 run 就没有契约文件可保护，H4 的全部
    // 前提也是"一个 run 正在跑"。
    if (!ctx.ok) {
      if (ctx.kind === 'no-run') {
        process.stderr.write(failOpenNotice('H4 契约保护', ctx))
        process.exit(0)
      }
      denyAndExit(
        `agent-team 契约保护读不到运行上下文（${ctx.reason}），按安全边界拒绝。` + selfCheckIdentity(input, '写入'),
        spec.event,
      )
    }

    // 路径字段按 tool_name 分派，原因与上面 writepath 那段完全相同：
    // NotebookEdit 用 notebook_path，Edit/Write 用 file_path，不能用 ??
    // 互相兜底（tool_name 此刻已确定是三者之一，main() 顶部校验过）。
    const filePath =
      input.tool_name === 'NotebookEdit'
        ? input?.tool_input?.notebook_path
        : input?.tool_input?.file_path
    const r = decideContractGuard({
      agentType: input?.agent_type,
      filePath,
      runDir: ctx.runDir,
    })
    if (r.decision === 'deny') denyAndExit(r.reason + selfCheckIdentity(input, '写入'), spec.event)
  }

  if (CHECK === 'rework') {
    // H6 返工预算写时强制（规格 §4.2 ③；docs/11 §1.2 的缺口；完整论证见
    // hooks/lib/rework-guard.mjs 头部，不在这里重复）。判定本身（"新的比旧的少"）
    // 是纯函数 decideRework；这一段只做三件事：认出目标是不是 runs/*/state.json、
    // 把 Edit/Write 的 tool_input 拆成 before/after 两份 JSON、deny 时 fail closed。
    // M3y（docs/33）起多一件：给 decideReworkBase 读阶段链、逐份读产物算 sha（rework_base 的几条，见下面 decideRework 之后那一段）。
    // M3z（docs/34）起再多一件：读同一个 run 目录里的返工批准，返工计数的上限按它放宽（hooks/lib/budget.mjs）。
    //
    // ⚠️ 不经过 readRunContext。这条判据结构上就是「任意 run 的 state.json」——
    // isControlFile 的 runs/*/state.json 模式本来就是"不只是当前那个"语义（一个
    // 角色去写别的 run 的 state.json 同样是在动编排层的账本，见
    // hooks/lib/control-files.mjs 头部），不依赖"当前是哪个 run"。挂 ctx 会平白
    // 多出 no-run/unreadable 两支要分派，而这条检查根本用不上：agentTeamDir 只是
    // .agent-team 在哪，跟 readRunContext(projectDir, ...) 内部算出来的 base 是
    // 同一条路径（join(projectDir, '.agent-team')），这里直接算一遍，不必先读
    // current-run/state.json/stages.json 一整套只为了拿这一个字符串。
    //
    // ⚠️ 不豁免任何调用者（不像 H4 豁免 PM）。state.json 只有 PM 写得了是 H3 的
    // 事；但"能写"不等于"能把计数改小"，这条要拦的恰恰是 PM 自己——规格 §4.2 ③
    // 的"不可重置"没有对写者身份留口子，理由同样写在 rework-guard.mjs 头部。
    //
    // 判据只认「runs/*/state.json」这一个模式，不认另外三个控制文件
    // （current-run/project.json/reach.json）——复用 isControlFile（已经确认这次
    // 写入落在四个已登记控制文件模式之一），再叠一个 endsWith('/state.json') 去
    // 消歧：四个模式里只有 runs/*/state.json 以它结尾，不需要另写一份路径匹配
    // （brief 明令：这个仓库为「同一份知识写两份」栽过四次）。
    const filePath =
      input.tool_name === 'NotebookEdit'
        ? input?.tool_input?.notebook_path
        : input?.tool_input?.file_path

    const agentTeamDir = join(ROOT_PROJECT, '.agent-team')

    // M3q（docs/25）：认不出是哪个文件的写法（流后缀、结尾带点或空格、网络路径），可能正是
    // 某个 run 的 state.json——H6 认不出来就等于放行一次清零。只在这个项目确实用着这支团队
    // （.agent-team 在）、且最后一段可能就是 state.json（含 8.3 短名）时拦：H6 挂在每一次
    // Edit/Write 上，主线程写网络上一个不相干的文件不归它管。排在 norm() 之前，网络路径不能碰。
    const exotic =
      existsSync(agentTeamDir) && mayBeStateFile(filePath) ? exoticPath(filePath, ROOT_PROJECT) : null
    if (exotic) {
      denyAndExit(
        `agent-team H6 返工预算：不得写 ${inline(filePath)}——${exotic}。门禁认不出它是不是 state.json，` +
          `按安全边界拒绝；请用普通的本地绝对路径。`,
        spec.event,
      )
    }

    const target = typeof filePath === 'string' ? norm(filePath) : null

    if (
      input.tool_name !== 'NotebookEdit' &&
      target &&
      isControlFile(filePath, agentTeamDir) &&
      target.endsWith('/state.json')
    ) {
      let beforeText
      try {
        beforeText = readFileSync(filePath, 'utf8')
      } catch {
        // 读不到（本趟第一次写、或者别的 I/O 问题）：当 before = null，decideRework
        // 自己会把"旧版本不存在"判成放行——见该函数头部注释。
        beforeText = null
      }

      // 算新内容。Write 的新全文就是 tool_input.content；Edit 由 replayEdit 照平台的口径重放
      // 同一次替换（剥 BOM、折 CRLF、弯引号互认，见 hooks/lib/rework-guard.mjs）。
      //
      // M3r（docs/26，全量审查第 6 条）：算不出新内容时**拒**，不再按「parse 不出来」放行。
      // 此前按字节重放，CRLF 的 state.json 上任何多行 Edit 都匹配不上、放行、真实落盘——
      // 一次 Edit 就能把返工史清零。算不出来就让它改用 Write 整份重写：那条路的新内容是确定的。
      // NotebookEdit 不适用：它的 schema 里没有 file_path/content/old_string 这套字段，上面的
      // 外层条件已经把它整个排除。
      let afterText = null
      if (input.tool_name === 'Write') {
        afterText = typeof input?.tool_input?.content === 'string' ? input.tool_input.content : null
      } else if (input.tool_name === 'Edit') {
        const { old_string, new_string, replace_all } = input?.tool_input ?? {}
        afterText = replayEdit({
          before: beforeText,
          oldString: old_string,
          newString: new_string,
          replaceAll: replace_all === true,
        })
      }
      if (afterText === null) {
        denyAndExit(
          `agent-team H6 返工预算：算不出这次 ${input.tool_name} 之后 state.json 会变成什么` +
            `（Edit 的 old_string 在文件里找不到、出现不止一处又没带 replace_all、用了弯引号或转义写法，` +
            `或者参数不全），门禁没法判断它有没有改小返工计数，` +
            `按安全边界拒绝。改用 Write 把完整的 state.json 整份重写。`,
          spec.event,
        )
      }

      // 旧的读不出来（第一次写、或者本来就坏了）时放行、新的必须是合法 JSON 对象——判定在
      // decideRework 里，理由见 hooks/lib/rework-guard.mjs 头部。parseStateText 剥 BOM，
      // 与 runctx 读 state.json 同一份归一化。
      const before = parseStateText(beforeText)
      const after = parseStateText(afterText)

      // M3y（docs/33）读阶段链；M3z（docs/34，全量审查第 16 条）起返工计数那几条也要它（回退预判、stage 不变量），提到 decideRework
      // 之前。返工批准读这份 state.json 同一个目录下的 approvals.jsonl（门禁专属，hooks/lib/budget.mjs 的 readGrants）：读不出来
      // 当一条都没有——更严的一侧；拒绝理由末尾的诊断会说批准为什么可能记不下。
      let stagesForRework = null
      try {
        stagesForRework = JSON.parse(normalizeText(readFileSync(join(ROOT, 'stages.json'), 'utf8')))
      } catch {
        stagesForRework = null
      }
      let approvalsText = null
      try {
        approvalsText = readFileSync(join(dirname(filePath), APPROVALS_FILE), 'utf8')
      } catch {
        approvalsText = null
      }
      // M3y（docs/33）读产物的 I/O（见下面 decideReworkBase 那一段的说明）。M4a 起收口判据也要它，提到这里。
      const runDir = dirname(filePath)
      const diskSha = (name) => {
        let st
        try {
          st = statSync(join(runDir, name))
        } catch (err) {
          const absent = err?.code === 'ENOENT' || err?.code === 'ENOTDIR'
          return { exists: !absent, sha: null }
        }
        if (!st.isFile()) return { exists: false, sha: null }
        try {
          const bytes = readFileSync(join(runDir, name))
          return { exists: true, sha: sha256OfContract(bytes), blank: isBlankText(bytes) }
        } catch {
          return { exists: true, sha: null }
        }
      }

      // M4a（docs/35）：收口标记 closed_at——形状、已收口之后的冻结、关上那一次的条件（hooks/lib/closing.mjs）。排在返工预算与回退
      // 快照之前：已收口的 run 上记回退，先拿到的要是「已经收口、另起一趟」，不是「先问用户批准」「补快照」（评审 CF-3）。
      // M4d 复核（docs/38 §3）：门禁自己记的派发记录——推进与收口判「这一段叫过谁」时并上它（hooks/lib/advance.mjs 的 calledIn）：PM 少记、
      // 漏记进 stage_roles 的人，照样要它交、整段裁掉也不算。读不出来、没有这份文件就当没有，退回只看 stage_roles。
      let dispatched = null
      let dispatchLog = null
      try {
        dispatchLog = readDispatchLog(readFileSync(join(runDir, DISPATCHES_FILE), 'utf8'))
        dispatched = dispatchedByStage(dispatchLog)
      } catch {}
      const closing = decideClosing({ before, after, stages: stagesForRework, diskSha, atPath: join(ROOT, 'commands', 'at.md'), dispatched })
      if (!closing.ok) denyAndExit(closing.reason, spec.event)

      const r = decideRework({ before, after, stages: stagesForRework, grants: readGrants(approvalsText, stagesForRework) })
      if (!r.ok) denyAndExit(r.reason + (r.budget ? approvalDiagnostic(filePath) : ''), spec.event)

      // M3y（docs/33，全量审查第 15 条）：rework_base——回退那一次写入照磁盘记下各份产物的 sha，之后原样带着，推进离开一段时
      // 那一段里不许还有上一轮的产物。规则在 decideReworkBase（hooks/lib/rework-guard.mjs 的 M3y 一节），这里只做 I/O：
      //   - 阶段链读插件自己那份 stages.json，读不出来给 null，由判定那边跳过、留痕（不走 readRunContext，理由同上）；
      //   - 产物逐份读：run 目录就是 state.json 所在的目录。stat 不到（ENOENT、ENOTDIR）算不在，别的错与读、算 sha 出错都算
      //     「在、但读不出来」——判定那边对它不核。逐份 try，一份读不出来不让整次判定 fail closed；
      //   - 判定本身不包 try：它抛异常时照旧落进最外层 catch，H6 fail closed。
      // diskSha 在上面（M4a 起收口判据也用它）。
      const rb = decideReworkBase({ before, after, stages: stagesForRework, diskSha, dispatched })
      if (!rb.ok) denyAndExit(rb.reason, spec.event)
      for (const note of rb.notes) process.stderr.write(`agent-team H6 返工预算：${note}\n`)

      // M4j（docs/45，审查第 20 条）：契约基线（门禁专属的 contract-base.json，hooks/lib/contract-base.mjs）——推进与收口时，契约第 1 节
      // 跟推进出第一段时记下的不同、验证段的结论对着上一版契约，拒。排在最后：缺、空、上一轮的、返工预算这些先说。读不出来当没有基线。
      // 复核（docs/45 §8）：修订那一刻还在跑的验证段角色交的结论也算对着上一版契约——按派发记录里它那一段最后一次派出去的时刻认（F4）；
      // 基线在却读不出来留一行痕（F7）。
      let contractBaseRaw = null
      let contractBytes = null
      try {
        contractBaseRaw = readFileSync(join(runDir, CONTRACT_BASE_FILE))
      } catch {}
      try {
        contractBytes = readFileSync(join(runDir, CONTRACT_FILE))
      } catch {}
      const contractBase = readContractBase(contractBaseRaw)
      if (contractBaseRaw && !contractBase) process.stderr.write('agent-team H6 契约基线：在却读不出来，这一次不核第 1 节与对着上一版契约的结论。\n')
      const cb = decideContractBase({
        before,
        after,
        stages: stagesForRework,
        base: contractBase,
        contractBytes,
        diskSha,
        lastDispatchAt: lastDispatchAtOf(stagesForRework, dispatchLog),
      })
      if (!cb.ok) denyAndExit(cb.reason, spec.event)

      // M4k（docs/46，docs/35 §5「收口不读验收结论」）：验收结论首行——推进出验收那一段与收口时，不是「结论：通过」、又没有门禁记下的
      // 照现状交付批准（approvals.jsonl 里 sha 等于它现在的 sha），拒（hooks/lib/verdict.mjs）。排在最后：对着上一版契约的结论先重出，
      // 读它的首行才有意义。批准读同一个目录下的 approvals.jsonl（上面读过；读不出来当一条都没有——更严的一侧）。
      const acceptanceDef = acceptanceOf(stagesForRework)
      // 评审 F11：阶段链读得出、却认不出验收那一段（插件的 stages.json 改坏了）：这一次不读验收结论，留一行痕。
      if (isStageChain(stagesForRework) && !acceptanceDef) process.stderr.write('agent-team H6 验收结论：阶段链上认不出验收那一段，这一次不读验收结论。\n')
      const ac = decideAcceptance({
        before,
        after,
        stages: stagesForRework,
        bytesOf: (name) => {
          try {
            return readFileSync(join(runDir, name))
          } catch {
            return null
          }
        },
        approvedShas: acceptanceDef ? readDeliverApprovals(approvalsText, acceptanceDef.name) : [],
        dispatched,
      })
      // 评审 F10：照理由问用户之前，补一句批准会不会记不下（与返工预算那一支同一份诊断）。
      if (!ac.ok) denyAndExit(ac.reason + approvalDiagnostic(filePath), spec.event)
    }
  }

  if (CHECK === 'ledger') {
    // ledger 不是门禁：它没有 deny 这个出口，只往 stdout 写 additionalContext。
    // 执行面裁定（为什么算在 hook 侧而不是让 PM 跑脚本）写在 hooks/lib/ledger.mjs
    // 头部，不在这里重复。
    // filePath 提到读 ctx 之前：下面 !ctx.ok 那条分支要靠它判断这次写的是不是
    // project.json，它本身不依赖运行上下文。
    const filePath =
      input.tool_name === 'NotebookEdit'
        ? input?.tool_input?.notebook_path
        : input?.tool_input?.file_path

    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    if (!ctx.ok) {
      // ⚠️ 这里**不能**无条件 fail open（M1b 终审 C1）。
      //
      // 触达表的判据只有两样：插件侧的 roster.json，和刚写完的
      // .agent-team/project.json。两者都与 run 无关——computeReach 是纯数据推导，
      // 不看 state、不看 runDir。而 /at-init **按设计就跑在没有 run 的时候**
      // （commands/at-init.md 末尾明令「不要在这条命令里建 run、写 state.json 或
      // current-run」）。把整条通道挂在 ctx.ok 上，等于让它在它唯一该发声的场合
      // 永远沉默：全新项目上 PM 写完 project.json 之后什么都收不到，
      // .agent-team/reach.json（控制文件之一、规格 §6.2.1、docs/09 账二 ③ 的唯一
      // 交付物）因此永远不存在，而 /at-status 让用户「重跑 /at-init」是个死循环。
      //
      // 只放这一条缝，不放宽别的：这次写的必须正好是 project.json 本身。别的写入
      // （包括 run 目录下的阶段产物）在没有运行上下文时照旧 fail open + 留痕。
      // ctx.agentTeamDir 取不到时（runctx 最外层兜底 catch 那一支，连 .agent-team
      // 在哪都不知道）也照原路 fail open —— 见 hooks/lib/runctx.mjs 那里的注释。
      if (isProjectJson(filePath, ctx.agentTeamDir)) {
        let project = readProjectConfig(ROOT_PROJECT)
        // 读不出来时自己再读原文（M3u，readProjectText）：readProjectConfig 可能只是撞上了短暂的占用，再读就是合法
        // 的——那就照正常路径发报告与触达表，不对一份合法的文件说「写坏了」。
        let text = null
        if (!project.ok) {
          const again = readProjectText(filePath)
          text = again.text
          if (again.value !== null) project = { ok: true, value: again.value }
        }
        if (project.ok) {
          // ⚠️ ctx.kind 的两支在这条缝上**不是**二选一（终审复评 a）：
          //   - 'no-run' 是 /at-init 的正常形态（那条命令按设计就不建 run），不留痕
          //     ——在正路上刷一行「当前没有进行中的 run，本次放行、不拦截」只会把人
          //     指向 current-run 去查一个根本不存在的问题。
          //   - 'unreadable' 是门禁**自己判不出来**（current-run 被截断成空文件、
          //     current-run 指向的 run 目录不存在、run 目录缺 state.json、project.json
          //     之外的东西坏了……）。触达表照发
          //     ——它的判据只有 roster.json + 刚写完的 project.json，跟那个坏掉的 run
          //     无关，而「在一个坏掉的 run 上重跑 /at-init」恰恰是要支持的动作——
          //     但**留痕照留**。「fail open 必须留痕」是这个仓库的硬规矩：静默的放行
          //     和门禁彻底坏掉长得一模一样。hooks/lib/runctx.mjs 头部写着 unreadable
          //     「这条边界不能因为上面那条放宽」，这里就是不放宽它：这条缝放行的是
          //     触达表这一条通道，不是那个坏掉的 run 的可判定性，两件事分开表述。
          // kind 取不到时也留痕（往安全的那一侧偏）：留一行多余的痕迹，代价远小于
          // 丢掉唯一一次「门禁判不出来」的信号。
          if (ctx.kind !== 'no-run') process.stderr.write(failOpenNotice('ledger 回传', ctx))
          const roster = loadRoster()
          emitHookJson(spec.event, {
            contexts: buildLedgerNotices({
              kind: 'project',
              reach: computeReach({ roster, paths: project.value.paths }),
              // M3u（docs/29）：形状问题三档全报，排在【触达表】之前。
              projectReport: validateProject(project.value, { roster }),
            }),
          })
        }
        // project.json 刚写进去却读不出来。M3u（docs/29）：文件在、只是解析不出或不是对象时，照 state.json
        // 那一支（M3r）回传一句固定的话——此前这里只往 stderr 留痕，模型看不到，/agent-team:at-init 会把它
        // 误当成「门禁没在跑」。不回显文件内容，不造空触达表。读不到（被删、被占用）时照旧只留痕（落到最后那行）。
        if (text !== null) {
          if (ctx.kind !== 'no-run') process.stderr.write(failOpenNotice('ledger 回传', ctx))
          emitHookJson(spec.event, {
            contexts: [brokenProjectNotice({ runInProgress: ctx.kind !== 'no-run', utf16: looksUtf16(text) })],
          })
        }
      }
      // M4g（docs/42，审查第 28 条）：/agent-team:at-init 写 reach.json 时按设计没有 run——触达表的判据只有花名册与 project.json，与
      // run 无关，照上面 project.json 那条缝的理由核它（对不上才说话）。project.json 读不出时落到下面那条缝（它在别处被弄坏）。
      if (isReachJson(filePath, ctx.agentTeamDir)) {
        const project = readProjectConfig(ROOT_PROJECT)
        const reachNotice = project.ok ? reachNoticeFor(filePath, project.value, isContractWriter(input.agent_type)) : null
        if (reachNotice) {
          if (ctx.kind !== 'no-run') process.stderr.write(failOpenNotice('ledger 回传', ctx))
          emitHookJson(spec.event, { contexts: [reachNotice] })
        }
      }
      // M3r（docs/26，全量审查第 5 条）：刚写的正是某个 run 的 state.json、而它读不出来——这趟
      // run 此刻在门禁眼里是坏的（readRunContext 判 unreadable），此前这里只往 stderr 写一句，
      // 模型和用户都看不见，docs/11 §5.31 说的「写坏会被 ledger 报出来」在代码里并不存在。
      // 自己再 parse 一遍，只在确实是这份文件坏了时回传；不回显文件内容（审查第 7 条：受信
      // 通道原样回显 state.json 字段会被拿来注入）。H6 现在拒掉「合法 → 坏」的写入，走到这里的
      // 是第一次就写坏、或者坏了之后又写坏的。
      if (
        typeof filePath === 'string' &&
        isControlFile(filePath, ctx.agentTeamDir) &&
        norm(filePath).endsWith('/state.json')
      ) {
        let text = null
        try {
          text = readFileSync(filePath, 'utf8')
        } catch {}
        if (parseStateText(text) === null) {
          process.stderr.write(failOpenNotice('ledger 回传', ctx))
          emitHookJson(spec.event, {
            contexts: buildLedgerNotices({
              kind: 'state',
              stateProblems: [
                '刚写进去的 state.json 不是一个合法的 JSON 对象，门禁读不出这趟 run——H2 到 H6 此刻都按' +
                  '「读不出运行上下文」处理。用 Write 写回一份合法的完整 state.json，再继续。',
              ],
            }),
          })
        }
      }
      // M3u 复核轮（docs/29）：project.json 在别处被弄坏（用户在两趟 run 之间手改，加了注释或尾逗号）——run 在时
      // readRunContext 判 unreadable，落到这里的每一次写入此前都只往 stderr 留痕：PM 写 state.json、current-run、
      // 契约都收不到任何东西，契约哈希拿不到，commands/at.md 的「没收到就停下：门禁没在跑」把用户引去排查一个
      // 不存在的问题。写 .agent-team 下任何文件时（PM 这一趟会写的都在那下面），自己读一遍 project.json：读得到、
      // 解析不出或不是对象，就回传那句固定的话的变体；读不到（被删、被占用）照旧只留痕。不回显文件内容。写的正是
      // project.json 时不走这里：上面那条缝已经读过它（读不到才落到这里），不再用「在别处被弄坏」的口径说它。
      // .agent-team 之外的写入保持沉默，同下面 ctx.ok 那一支：project.json 坏着的项目里，主会话与执行角色每写一个
      // 业务文件都刷一遍这段话，会把真正要看的东西淹掉。
      if (
        typeof filePath === 'string' &&
        underDir(filePath, ctx.agentTeamDir) &&
        !isProjectJson(filePath, ctx.agentTeamDir)
      ) {
        const { value, text } = readProjectText(join(ctx.agentTeamDir, 'project.json'))
        if (text !== null && value === null) {
          // no-run 不留痕，与上面那条缝同一个理由：不把人指向 current-run 去查一个不存在的问题。
          if (ctx.kind !== 'no-run') process.stderr.write(failOpenNotice('ledger 回传', ctx))
          emitHookJson(spec.event, {
            contexts: [
              brokenProjectNotice({ runInProgress: ctx.kind !== 'no-run', justWritten: false, utf16: looksUtf16(text) }),
            ],
          })
        }
      }
      // fail open + 留痕，与 H2/H5 同一先例。措辞按 ctx.kind 分派，共用 failOpenNotice。
      process.stderr.write(failOpenNotice('ledger 回传', ctx))
      // M3v（docs/30，全量审查第 12 条）：run 在、却读不出来（丢指针、坏指针、state.json 或插件文件坏了……），PM 写 run
      // 目录下的契约与产物，此前只有上面这行 stderr——契约哈希拿不到，commands/at.md 的「没收到就停下」把它误诊成「门禁
      // 没在跑」。现在按原因回传一段【门禁】，给用户一行。只在这几格说：
      //   - 调用者是 PM（isContractWriter）：unreadable 下非 PM 的写入在 PreToolUse 上就被 H3 拒了，走到这里的非 PM 只能是
      //     「Pre 时好、Post 时坏」的竞态，它修不了，说给它听只是多一个转述环节；
      //   - 写的在 .agent-team/runs/ 下、不是控制文件：契约与产物都在那下面；.agent-team/ 下别的文件本来就没有回传，
      //     跟它说「重写一次拿回传」是假话。控制文件（state.json）是 PM 在建 run、修 run——第一趟建 run 时写
      //     runs/<id>/state.json 的那一刻指针还没写，这里判丢指针，说一句就是在正路上刷屏；
      //   - 不是 no-run：没有 run 就没有哈希可拿。偏离 /agent-team:at 第 1 节的顺序、直接写契约的那一格，落盘之后 runs/
      //     非空、指针不在，这里判丢指针——契约的哈希确实丢了，该出声（tests/gate-fail-open.test.mjs 钉着）。
      // 上面三条缝（project.json 本身、坏 state.json、在别处被弄坏的 project.json）先说完就退出了，不叠这一段。
      if (
        ctx.kind !== 'no-run' &&
        isContractWriter(input.agent_type) &&
        typeof filePath === 'string' &&
        typeof ctx.agentTeamDir === 'string' &&
        underDir(filePath, join(ctx.agentTeamDir, 'runs')) &&
        !isControlFile(filePath, ctx.agentTeamDir)
      ) {
        emitHookJson(spec.event, {
          contexts: [ledgerUnreadableNotice(ctx.cause)],
          systemMessage: systemMessage('ledger-unreadable', { cause: ctx.cause }),
        })
      }
      process.exit(0)
    }

    // 不在 .agent-team/ 下的写入与本检查项无关，保持沉默——角色写业务代码是常态，
    // 每次都刷一段 additionalContext 会把真正要看的东西淹掉。ledger 关心两类
    // 路径：控制文件，以及 run 目录下的阶段产物（后者用来判断当前阶段的产物齐
    // 没齐）；underDir 判的是后一类，写在 hooks/lib/path-norm.mjs 里（评审 I-2：
    // 这段比较与 writepath.mjs 里同一处判定曾经是两份逐字符相同的拷贝）。
    if (!isControlFile(filePath, ctx.agentTeamDir) && !underDir(filePath, ctx.runDir)) {
      process.exit(0)
    }

    const target = norm(filePath)
    let kind = 'other'
    if (target === norm(`${ctx.runDir}/${CONTRACT_FILE}`)) kind = 'contract'
    // project.json 这一问复用上面那个谓词，不在这里再写一遍同样的等式——
    // 上面 !ctx.ok 那条分支问的是同一个问题，两处分叉就是 C1 的复发形状。
    else if (isProjectJson(filePath, ctx.agentTeamDir)) kind = 'project'
    else if (target === norm(`${ctx.runDir}/state.json`)) kind = 'state'
    else if (isReachJson(filePath, ctx.agentTeamDir)) kind = 'reach'

    // 写的是 run 目录下某个阶段的 produces —— 算它的哈希回传，PM 写进 artifacts。
    // 这条排在最后：上面三条都是控制文件或契约，命中它们就不会落到这里。
    //
    // 反查逻辑与 hooks/lib/writepath.mjs 的 decideWritePath 问的是同一个问题（"run
    // 目录下这条路径是不是某个阶段的 produces、归哪个阶段"），此前这里各写了一份逐字符
    // 相同的拷贝（评审发现 4）。现在从 writepath.mjs 导出 stageOwnerOfRunPath，两边共用
    // 同一份实现——分叉的代价是 sha 漏回传、产物永远卡在账本比对的 unrecorded 清单里。
    let produceName = null
    if (kind === 'other' && ctx.stages) {
      const owner = stageOwnerOfRunPath(ctx.stages, ctx.runDir, target)
      if (owner) { produceName = owner.produces; kind = 'produce' }
    }
    const produceBytes = produceName ? ctx.artifactBytes(produceName) : null

    // M4c（docs/37）：写 state.json 时也读契约——buildLedgerNotices 拿 contract_sha 比它（契约那一处的注释）；在却读不出的单说。
    const bytes = kind === 'contract' || kind === 'state' ? ctx.artifactBytes(CONTRACT_FILE) : null
    const reach =
      kind === 'project' && ctx.project
        ? computeReach({ roster: loadRoster(), paths: ctx.project.paths })
        : null
    // M3z（docs/34，全量审查第 16 条）：返工批准（runs/<id>/approvals.jsonl，门禁专属）。validateState 按它放宽上限、把按 history
    // 派生值越限的段单列成 budget（【返工预算】）；【阶段】按它判推进会不会越限。
    const approvalsBytes = ctx.artifactBytes(APPROVALS_FILE)
    const grants = readGrants(approvalsBytes ? approvalsBytes.toString('utf8') : null, ctx.stages)
    const validation = kind === 'state' ? validateState(ctx.state, { stages: ctx.stages, grants }) : null
    const stateProblems = validation ? validation.problems : []

    // M3z：交付快照。PM 写 state.json、而 stage 变了之后照磁盘拍：早于当前段的各段产物记 sha（hooks/lib/redo.mjs 的 deliveredSnapshot）。
    // H2、H3 拿它分辨「交过」——不依赖 PM 把 sha 记进 artifacts（那条回传只发给写者，第 28 条）。写不进、读不出都只是少拦，
    // 留一行痕。内容没变就不写。
    if (kind === 'state') writeDeliveredSnapshot(ctx)
    // M4j（docs/45）：契约基线——推进出第一段之后第一次见到 state.json 时记下（contract-base.mjs）；写契约之后按它说【契约】。
    const contractBaseLines = kind === 'state' ? ensureContractBase(ctx) : kind === 'contract' ? contractBaseNotices(ctx) : []

    // M3u（docs/29）：project.json 的形状问题只有 PM 改得了，在它写控制文件的几个时机说出来——写 project.json
    // 本身（三档全报）；每趟 run 开头写 current-run（三档全报，已装用户的旧配置在 S1 就露面，不等 S5 撞上拒绝）；
    // 写 state.json（只报阻断与插件问题：覆盖升级前开始、升级后续跑的 run，不报要改与请确认免得每次记账都刷一遍）。解析不出的
    // project.json 走不到这里（ctx 判 unreadable），由上面 !ctx.ok 那一支回传。
    let projectReport = null
    const isPointer = target === norm(`${ctx.agentTeamDir}/current-run`)
    if (kind === 'project' || isPointer || kind === 'state') {
      if (!ctx.project) {
        projectReport = {
          block: [
            '.agent-team/project.json 不在——run 已经建起来，执行角色写 run 目录之外的任何地方都会被拒；先跑 /agent-team:at-init 写好它',
          ],
        }
      } else {
        const full = validateProject(ctx.project, { roster: loadRoster() })
        projectReport = kind === 'state' ? { block: full.block, plugin: full.plugin } : full
      }
    }

    // 【阶段】那条提示的判据。roster 传**当前段的参与者** participantsOf(ctx.state, ctx.state?.stage)（M3x，docs/32）：
    // state.json 的 stage_roles[当前段]——这一段叫到了谁；没有 stage_roles 的旧 run 退回 roster，roster 不是数组时
    // 给 undefined、退回全部 producers。写法与 deliverable 分支里那次 isStageDone 一致；那次 compareArtifacts、readiness
    // 分支里那次 decideReadiness **有意**仍传整趟 roster（理由在 docs/11 §5.33 的收口：按段取会让账本比对在当前段记账之前
    // 漏报 S2 那几份的漂移；H2 那边整趟口径在别段叫到过的 S5 产者还没交时多查一次前置，按段取就把这一次也放过了）。
    //
    // ⚠️ M3x：此前这里传整趟 roster。roster 不分段：at-ui 在 S2 进过 roster，S5 就去等 05-impl/at-ui.md——S5 不派它时
    // 永远不齐、这条提示永远不发；它先交又提前宣布齐（全量审查第 14 条）。当前段在 PM 记账之前，参与者是空集：产物每一条
    // 都随参与者展开的段（今天的 stages.json 里是 S2、S5）展开为空、判不齐，正路上（先派、核实，再在推进的同一次 Write 里
    // 记账）这条提示对它们只在「记了账没推进」时发——产者落盘那一刻判不出整段齐没齐，是登记的边界（docs/32 §4）。
    // 产物固定的段与参与者无关，照磁盘判，记没记账都一样发（与基线相同）。基线在 S2 首轮同样不发；S5 上 at-ui 在 S2 进过
    // roster 时，基线从它的实现记录落盘起每次写入都发——之后还有人没交时是提前宣布，最后一份落盘起碰巧是对的，这几条
    // 现在一律不发。
    //
    // ⚠️ M3k：**这个参数此前不在这里**，而这一处正是 M2a §1.1 裁定（docs/11 §5.7：
    // 「让 isStageDone 与 compareArtifacts 按 roster ∩ producers 展开」）本来要落地的
    // 第一个调用点——那条裁定写下的时候，isStageDone 在本文件里只有这一处调用。
    // 不传它的后果不是误报，**是哑掉**：stageRolesInRun(stage, undefined) 退回全部
    // producers，于是任何有产者被裁剪的阶段**结构上永远不 done**，这条提示对那些阶段
    // 一次也不发。实测（docs/20 §7.8，S1→S8 整链那一趟：roster 六个、at-ui 被裁、
    // at-ios/at-android 不在 available_roles）：S2 与 S5 整趟【阶段】零条，PM 把
    // S2→S3、S5→S6 两次推进完全无提示地做掉了——而这条提示逐字是「H5 哑掉」的两条
    // 对策之一（理由在 hooks/lib/deliverable.mjs 头部与 stages.README.md）。
    //
    // ⚠️ 判据在 tests/stage-done-call-site.test.mjs，它钉的是**本文件里每一处
    // isStageDone 调用都按段取参与者**（M3x 之前是「按 roster 收窄」），不是「这一行长什么样」。上一轮守这件事的
    // 是 deliverable 分支那段注释末尾那句「两处都改，改一处的时候去看另一处」，
    // **而它点名的那一处正是没改的那一处**——一条注释不是一条判据，这件事现在有实物
    // 了（docs/11 §5.33）。
    //
    // ⚠️ M3y（docs/33，全量审查第 15 条）：「齐了没」按 freshness 判——返工轮里磁盘内容与 rework_base 记的 sha 相同的产物是
    // 上一轮的，不算这一段齐了。此前回退那一次写入一落盘，这条提示就催推进（上一轮的产物都还在）。判据在
    // tests/freshness-call-site.test.mjs（每一处 isStageDone、decideDeliverable、decideReadiness 都经 freshness）。
    const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base })
    const stageDone = isStageDone({
      stage: ctx.state?.stage,
      stages: ctx.stages,
      artifactExists: fresh.artifactCurrent,
      roster: participantsOf(ctx.state, ctx.state?.stage),
    })
    // 【返工】：写 state.json 时，当前段与更早段还是上一轮的产物（hooks/lib/ledger.mjs 那一段）。
    const reworkStale = kind === 'state' ? staleByStage({ stages: ctx.stages, stageId: ctx.state?.stage, isStale: fresh.isStale }) : null
    // M4a（docs/35）：最后一段齐了、还没收口时，【阶段】要说收不收得了口——与 H6 的收口判据同一份 closeBlockers（还旧按 freshness）。
    // M4d 复核：「叫过」并上派发记录，与 H6 的收口同一个口径（否则这里说「该收口了」、H6 却拒）。
    const dispatchedNow = (() => {
      const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
      return logBytes ? dispatchedByStage(readDispatchLog(logBytes.toString('utf8'))) : null
    })()
    // M4j 复核（docs/45 §8，F6）：对着上一版契约的验证段结论也是收口阻碍——与 H6 的契约判据同一份 outdatedProducts，【阶段】不说「该收口了」，
    // 出路与 H6 同一份 outdatedFix（看当前段）。
    const outdatedNow = (() => {
      try {
        const base = readContractBase(ctx.artifactBytes(CONTRACT_BASE_FILE))
        if (!base) return new Set()
        const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
        const log = logBytes ? readDispatchLog(logBytes.toString('utf8')) : null
        const diskSha = (n) => {
          if (!ctx.artifactExists(n)) return { exists: false, sha: null }
          const b = ctx.artifactBytes(n)
          return { exists: true, sha: b ? sha256OfContract(b) : null }
        }
        return new Set(outdatedProducts({ stages: ctx.stages, base, diskSha, lastDispatchAt: lastDispatchAtOf(ctx.stages, log) }))
      } catch {
        return new Set()
      }
    })()
    const blockers0 =
      stageDone && closedAt(ctx.state) === null && ctx.state?.stage === lastStageId(ctx.stages)
        ? closeBlockers({
            stages: ctx.stages,
            state: ctx.state,
            dispatched: dispatchedNow,
            probe: (name) => {
              if (!ctx.artifactExists(name)) return 'missing'
              const bytes = ctx.artifactBytes(name)
              if (!bytes) return 'unreadable'
              if (isBlankText(bytes)) return 'empty'
              return fresh.isStale(name) ? 'stale' : outdatedNow.has(name) ? 'outdated' : 'ok'
            },
          })
        : null
    // M4k（docs/46）：验收结论首行没过、又没有门禁记下的照现状交付批准，也是收口阻碍——与 H6 的 decideAcceptance 同一份 acceptanceBlock，
    // 出路同一份（verdictBlockerText）。验收结论已经因为缺、空、上一轮的、对着上一版契约列在阻碍里的，不重复列。
    const verdictNow = (() => {
      try {
        const acc = acceptanceOf(ctx.stages)
        if (!acc) return null
        const ab = ctx.artifactBytes(APPROVALS_FILE)
        return acceptanceBlock({
          stages: ctx.stages,
          state: ctx.state,
          prior: undefined,
          bytesOf: (n) => (ctx.artifactExists(n) ? ctx.artifactBytes(n) : null),
          approvedShas: readDeliverApprovals(ab ? ab.toString('utf8') : null, acc.name),
          dispatched: dispatchedNow,
        })
      } catch {
        return null
      }
    })()
    // M4k 评审 F5：验收那一段齐了、首行没过或读不出——【阶段】那一句补上（与 H6 同一份 acceptanceBlock）。写者分验收角色与别人。
    const acceptanceNote = (() => {
      try {
        const acc = acceptanceOf(ctx.stages)
        // 复核（低 4）：验收结论对着上一版契约的，H6 先按契约判据拒（出路是重出），记录器也不记照现状交付——这一句不说。
        if (!acc || !stageDone || ctx.state?.stage !== acc.stageId || closedAt(ctx.state) !== null || outdatedNow.has(acc.name)) return null
        const ab = ctx.artifactBytes(APPROVALS_FILE)
        const block = acceptanceBlock({
          stages: ctx.stages,
          state: ctx.state,
          prior: undefined,
          bytesOf: (n) => (ctx.artifactExists(n) ? ctx.artifactBytes(n) : null),
          approvedShas: readDeliverApprovals(ab ? ab.toString('utf8') : null, acc.name),
          dispatched: dispatchedNow,
        })
        return block ? verdictStageNote({ stages: ctx.stages, block, writer: callerOf(input) }) || null : null
      } catch {
        return null
      }
    })()
    const blockers = (() => {
      if (!Array.isArray(blockers0)) return blockers0
      const od = blockers0.filter((b) => b.why === 'outdated').map((b) => b.name)
      const fix = od.length ? outdatedFix(ctx.stages, od, ctx.state?.stage).text : null
      const list = blockers0.map((b) => (b.why === 'outdated' ? { ...b, fix } : b))
      if (verdictNow && !list.some((b) => b.name === verdictNow.name)) {
        list.push({ name: verdictNow.name, why: 'verdict', require: true, fix: verdictBlockerText({ stages: ctx.stages, verdict: verdictNow.verdict, current: ctx.state?.stage }) })
      }
      return list
    })()

    const notices = buildLedgerNotices({
      kind,
      contractSha: bytes ? sha256OfContract(bytes) : null,
      state: ctx.state,
      reach,
      stages: ctx.stages,
      stageDone,
      stateProblems,
      produceName,
      produceSha: produceBytes ? sha256OfContract(produceBytes) : null,
      projectReport,
      reworkStale,
      closeBlockers: blockers,
      acceptanceNote,
      budget: validation ? validation.budget : [],
      grants,
      // M4b 第二轮复核：执行段「齐了」那句按写者分（谓词与 H3 同一个 isContractWriter）。
      writerIsPm: isContractWriter(input.agent_type),
      writer: callerOf(input),
      contractUnreadable: kind === 'state' && bytes === null && ctx.artifactExists(CONTRACT_FILE),
      dispatched: dispatchedNow,
    })
    // M4g（docs/42，审查第 28 条）：run 进行中 PM 补了 paths、照【触达表】重写 reach.json 时也核（没有 run 的那条缝在上面）。
    if (kind === 'reach') {
      const reachNotice = reachNoticeFor(filePath, ctx.project, isContractWriter(input.agent_type))
      if (reachNotice) notices.push(reachNotice)
    }
    for (const line of contractBaseLines) notices.push(line)
    // M4h（docs/43，审查第 24-1 条）：写 current-run 时，别的、没收口的 run 里门禁还没见它停下的派发（inflightElsewhere 上方）。
    if (isPointer) {
      const inflight = inflightNotice(inflightElsewhere(ctx))
      if (inflight) notices.push(inflight)
    }

    // M3a Task 2：产者交代判据的触发点是「state.stage 推进出去时」（设计 §3.2），
    // 而推进这个动作落盘的形式就是写 runs/*/state.json —— kind === 'state' 就是它，
    // 不另找一个触发点。
    //
    // ⚠️ 为什么不是每次 ledger 都算一遍：同一条理由在本文件的 buildDriftNotice、
    // ledger 分支开头那条路径过滤、以及 hooks/lib/ledger.mjs 的【产物】分支各留过一次
    // 注释——每次子代理返回 / 每写一个产物都刷一段 additionalContext 会把真正要看的
    // 东西淹掉。写产物那一刻 roster 对这一段本来就还不完整（commands/at.md 第 4 步在
    // 派发并核实之后才累加它），在那里算等于专挑形状 B 那个窗口报，是稳定的误报。
    //
    // ⚠️ 不塞进 buildLedgerNotices：那个函数的入参全是调用方算好的派生值，这一层
    // 才是持有 ctx.stages / ctx.state / ctx.project 的地方；措辞组装与 buildDriftNotice 同址。
    //
    // ⚠️ Ruling 2：判据的宇宙收窄到 project.json 的 available_roles。ctx.project 在
    // readRunContext 里已经过 readJson 那一关（null / 数组 / 标量都会被判成读不出来），
    // 所以这里要么是一个普通对象、要么是 null（文件不在）；available_roles 本身是不是
    // 可用的一份，由 decideCoverage 自己判并回一个 narrowed。
    //
    // ⚠️ 收窄不成时**留痕**，这是本仓库的硬规矩：静默的放行和门禁彻底坏掉长得一模一样。
    // 这一行与 failOpenNotice 那一族不是同一件事，所以不复用它——那一族说的是「运行上下文
    // 读不到、本次放行」，而这里运行上下文是好的、判据也照常报了，只是口径比平时宽。
    // 两件事混用同一句话就是本仓库记过的那种口径分叉（同一个 kind 在不同检查项里被说成
    // 两个意思）。文案那一半在 buildCoverageNotice 里，两半都要有。
    if (kind === 'state') {
      // M4g（docs/42）：并上门禁的派发记录（与 H6 判「叫过」同一份 dispatchedNow）——派发记录里有的单列成「漏记」。
      const cov = decideCoverage({
        stages: ctx.stages, state: ctx.state, availableRoles: ctx.project?.available_roles, dispatched: dispatchedNow,
      })
      if (!cov.narrowed) {
        process.stderr.write(
          `agent-team 产者交代：读不到 .agent-team/project.json 的 available_roles（可用班底），` +
            `本次判据没能按它收窄，报出来的口径比平时宽。跑 /agent-team:at-init 把它写上。\n`,
        )
      }
      // M3b 修复轮 1：收尾按「收件人改不改得了 state.json」分支。
      //
      // 收件人是**刚做完这次 Edit/Write 的那个上下文**——PostToolUse 的 additionalContext
      // 发给它。这里的 input.agent_type 与 writepath 分支读的是同一个字段、同一个含义
      // （不像 deliverable 分支那样还有一个 tool_input.subagent_type 要区分）。
      //
      // 组合（callerOf → isContractWriter）与 hooks/lib/writepath.mjs 控制文件豁免那一处
      // 逐字同构，与 deliverable 分支那一处同一份：**文案断言的「你改不了」与 H3 真会不会
      // 拒，由同一个谓词决定**。为什么这一支到得了非 PM 手里（它曾经被断言到不了），
      // 完整机制写在 buildCoverageNotice 上方，不在这里重复第二遍。
      const recipient = callerOf(input)
      const recipientCanWriteState = isContractWriter(recipient)
      // M4a 复核（P7）：最后一段、没收口时，PM 派不到（只能经协调者派）的缺口角色——H2 在最后一段拒派协调者，② 要说清这一点。
      // 复核二（G3、G6）：「派不出去」= PM 派不到它（只能经协调者派），或者 PM 派它被 decideClosedDispatch 拒（它自己就是协调者）——
      // 与 H2 同一个判定，不另写一份。驱动者本人不算；花名册读不出来时不说（那时 H2 也不判）。
      const covRoster = loadRoster()
      const pmCan = isPlainObject(covRoster?.['at-pm']) && Array.isArray(covRoster['at-pm'].can_delegate_to) ? covRoster['at-pm'].can_delegate_to : null
      const atLastOpen = pmCan !== null && closedAt(ctx.state) === null && ctx.state?.stage === lastStageId(ctx.stages)
      const viaCoordinator = atLastOpen
        ? [...new Set((cov.gaps ?? []).filter((g) => g.dispatched !== true).map((g) => g.role))].filter(
            (r) =>
              !isDriverRole(r) &&
              (!pmCan.includes(r) ||
                decideClosedDispatch({ stages: ctx.stages, state: ctx.state, target: r, roster: covRoster, callerCanWriteState: true }).decision === 'deny'),
          )
        : []
      const coverage = buildCoverageNotice(cov, recipientCanWriteState, closedAt(ctx.state) !== null, viaCoordinator)
      if (coverage) {
        notices.push(coverage)
        // 痕迹这一半，与账本比对那一条共用 misroutedNotice。⚠️ 它与上面那条
        // 「没能按 available_roles 收窄」不是同一件事，两条可以同时出现：
        // 前者说口径宽了，这一条说它发错了人。
        if (!recipientCanWriteState) {
          process.stderr.write(
            misroutedNotice('产者交代', 'PostToolUse 的 additionalContext', recipient),
          )
        }
      }
    }

    emitHookJson(spec.event, { contexts: notices })
  }

  if (CHECK === 'approval-ask' || CHECK === 'approval-prompt') {
    // M3z（docs/34，全量审查第 16 条）：返工批准的两个记录器。不是门禁：不拒任何东西，只在用户选了（approval-ask）或单独发了
    // （approval-prompt）规范标签、而这一轮真的需要批准时，往当前 run 的 approvals.jsonl 追加一行。认回答、判需不需要、回传怎么说
    // 在 hooks/lib/approvals.mjs；标签与上限在 hooks/lib/budget.mjs。
    // approval-ask 在 PostToolUse 上：记下了、没记下（像批准却不记）都回一段【门禁】，给用户一行；一个像批准的回答都没有时不出声。
    // approval-prompt 在 UserPromptSubmit 上：stdout 会进模型上下文，一个字都不写（hookOutput 对这个事件恒给空），只往 stderr 留痕。
    const ask = CHECK === 'approval-ask'
    // M4k（docs/46）：两个记录器也认「照现状交付」（候选 { deliver: true }，按 sha 绑在那一刻的验收结论上）。
    const found = ask
      ? askAnswers(input.tool_response)
      : { excluded: null, items: promptAnswer(input.prompt) ? [{ stage: promptAnswer(input.prompt) }] : promptDeliver(input.prompt) ? [{ deliver: true }] : [] }
    if (!found.excluded && !found.items.length) process.exit(0)
    let results
    let total = 0
    let cause = null
    let stages = null
    if (found.excluded) {
      results = [{ why: found.excluded, ...(found.deliver ? { deliver: true } : {}) }]
    } else {
      const ctx = readRunContext(ROOT_PROJECT, ROOT)
      if (!ctx.ok) {
        cause = ctx.cause ?? null
        const why = ctx.kind === 'no-run' ? 'no-run' : 'unreadable'
        results = found.items.map((item) => (item.stage ? { stage: item.stage, why } : item.deliver && !item.why ? { deliver: true, why } : item))
      } else {
        stages = ctx.stages
        // 复核（platform-3）：读批准、判需不需要、追加，三步在一把锁里做——插件被加载了两份时，同一个事件上会并行起几个记录器，
        // 各自读到「还没有批准」、各记一条，额度凭空多出几轮。拿锁之后重读。
        results = withApprovalsLock(ctx.runDir, () => {
          const file = join(ctx.runDir, APPROVALS_FILE)
          const bytes = ctx.artifactBytes(APPROVALS_FILE)
          const grants = readGrants(bytes ? bytes.toString('utf8') : null, ctx.stages)
          total = grants.length
          // 复核（platform-2）：末行没有换行（手改过、echo -n 写过）时先补一个，否则新的一行会和它粘在一起、两条一起失效。
          let sep = bytes && bytes.length && bytes[bytes.length - 1] !== 0x0a ? '\n' : ''
          const out = []
          const acceptanceDef = acceptanceOf(ctx.stages)
          const acceptance = acceptanceDef ? acceptanceOnDisk(ctx, acceptanceDef.name) : null
          for (const p of planApprovals({ items: found.items, state: ctx.state, stages: ctx.stages, grants, acceptance })) {
            if (p.deliver && typeof p.sha === 'string') {
              try {
                appendFileSync(file, sep + deliverLine({ at: new Date().toISOString(), source: ask ? 'ask' : 'prompt', product: p.name, sha: p.sha }) + '\n')
                sep = ''
                out.push(p)
              } catch {
                out.push({ deliver: true, why: 'write-failed' })
              }
              continue
            }
            if (!p.covers) {
              out.push(p)
              continue
            }
            try {
              appendFileSync(file, `${sep}${approvalLine({ at: new Date().toISOString(), source: ask ? 'ask' : 'prompt', stage: p.stage, covers: p.covers })}\n`)
              sep = ''
              total += 1
              out.push(p)
            } catch {
              out.push({ stage: p.stage, why: 'write-failed' })
            }
          }
          return out
        })
      }
    }
    // M4k：照现状交付那几条的留痕（返工批准那一句在下面）。
    for (const r of results.filter((x) => x.deliver)) {
      process.stderr.write('agent-team ' + CHECK + '：' + (r.sha ? '已记下照现状交付的批准（' + r.name + '）。' : '没有记成照现状交付的批准（' + r.why + '）。') + '\n')
    }
    for (const r of results.filter((x) => !x.deliver)) {
      process.stderr.write(
        `agent-team ${CHECK}：` +
          (r.covers ? `已记下返工批准：回到 ${r.stage}（覆盖 ${r.covers.join('、')}）。` : `没有记成返工批准（${r.why}${r.stage ? `，${quote(r.stage)}` : ''}）。`) +
          '\n',
      )
    }
    if (!ask) process.exit(0)
    emitHookJson(spec.event, {
      contexts: approvalNotices({ results, total, cause, stages }),
      systemMessage: systemMessage(
        results.some((r) => r.covers) ? 'approval-recorded' : results.some((r) => r.deliver && r.sha) ? 'deliver-recorded' : results.some((r) => r.deliver) ? 'deliver-skipped' : 'approval-skipped',
      ),
    })
  }

  if (CHECK === 'completion') {
    // M4d（docs/38，全量审查第 19 条）：后台派发的子代理完成时，主会话收到一条 <task-notification>、UserPromptSubmit 随之触发。认出通知，按门禁记的
    // 派发记录对回「谁、哪一段、谁派的」，核它这一段的产物；没交齐的说成因（冒泡了、门禁拦过它而平台静默放行、门禁没拦它、没正常结束），
    // 协调者返回而那一段还没齐的报进度。交齐了的不出声（与 H5a 同一个口径）。
    // 不认识的通知（别的 agent、后台 Bash、别的 run、门禁没记下的派发）不出声：门禁只对它记过的团队派发表态。
    // 读不出运行状态只留痕：PM 派发那一刻 H5a 已经说过「交付物核验不会做」。这个事件上 exit 2 会把这条消息吞掉——这一项永不拒。
    const notes = parseNotifications(input.prompt)
    if (!notes.length) process.exit(0)
    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    if (!ctx.ok) {
      if (ctx.kind !== 'no-run') process.stderr.write(failOpenNotice('完成核验', ctx))
      process.exit(0)
    }
    const roster = loadRoster()
    const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
    const log = readDispatchLog(logBytes ? logBytes.toString('utf8') : null)
    const recipientIsPm = isContractWriter(callerOf(input))
    const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base })
    const pmCan = isPlainObject(roster?.['at-pm']) && Array.isArray(roster['at-pm'].can_delegate_to) ? roster['at-pm'].can_delegate_to : []
    const contexts = []
    const seen = new Set()
    for (const n of notes) {
      for (const taskId of n.taskIds) {
        if (seen.has(taskId)) continue
        seen.add(taskId)
        const d = dispatchOf(log, taskId, n.toolUseId)
        // 记录里的角色与段来自磁盘：只认花名册里的角色、阶段链上的段（之后原样拼进文字，是插件自己的名字）。
        if (!d || !isPlainObject(roster) || !Object.hasOwn(roster, d.role) || !isKnownStage(ctx.stages, d.stage)) continue
        if (closedAt(ctx.state) !== null) {
          if (recipientIsPm) {
            contexts.push(
              `交付物核验：${d.role}（${d.stage}）在这一趟收口之后才完成——收口时它还在跑。门禁不再核它的产物，它这次写的东西不计入这一趟；` +
                '要用，另起一趟（/agent-team:at）。',
            )
          }
          continue
        }
        const r = decideDeliverable({
          role: d.role,
          stageId: d.stage,
          stages: ctx.stages,
          artifactExists: fresh.artifactCurrent,
          artifactStale: fresh.isStale,
          artifactBlank: fresh.isBlank,
        })
        if (r.ok) {
          // 协调者的进度只在它协调的那一段还是当前段时报：PM 已经推进出去了的，那一段齐没齐归推进那一刻的判据（第 17 条）。
          // 判齐照 tests/stage-done-call-site.test.mjs 的口径取当前段的参与者。
          // M4h（docs/43，审查第 14 条）：自己也是这一段产者的协调者（S2 的 at-product），它那几份交了（r.ok 而不是跳过）也报进度。
          const coordinates =
            r.skipped === 'role-not-in-stage' ? isCoordinatorFor(ctx, d.role, d.stage) : r.skipped === undefined && dispatchesOtherProducers(ctx, d.role, d.stage)
          if (d.stage === ctx.state?.stage && coordinates) {
            const done = isStageDone({
              stage: ctx.state?.stage,
              stages: ctx.stages,
              artifactExists: fresh.artifactCurrent,
              roster: participantsOf(ctx.state, ctx.state?.stage),
            })
            if (!done) {
              const p = progressOf({ ctx, fresh, log, coordinator: d.role, coordinatorId: taskId, stageId: d.stage, recipientIsPm, selfDone: r.skipped === undefined })
              if (p) contexts.push(p)
            }
          }
          continue
        }
        // 复核（docs/38 §3）：成因按这个子代理最后一回停下的结果判（completion.mjs 的 missingCause）；<result> 先剥掉 CLI 插的注记再认冒泡。
        const why = missingCause({
          status: n.status,
          last: lastStop(log, taskId),
          bubble: n.result === null ? null : bubbleOf([n.result]),
          blocks: log.blocks.get(taskId) ?? 0,
        })
        const caller = typeof d.caller === 'string' && Object.hasOwn(roster, d.caller) && !isContractWriter(d.caller) ? d.caller : null
        const direct = !recipientIsPm || pmCan.includes(d.role)
        const redispatch = direct
          ? `再派 ${d.role} 一次`
          : caller
            ? `经 ${caller} 再派 ${d.role} 一次（你派不到它）`
            : `经派得到 ${d.role} 的那一层再派它一次（你派不到它）`
        const trimHint = trimHintFor(ctx.stages, d.stage, d.role, [...r.missing, ...(Array.isArray(r.blank) ? r.blank : [])])
        contexts.push(missingNotice({ ctx, r, role: d.role, recipientCanWriteState: recipientIsPm, why, redispatch, trimHint }))
      }
    }
    if (!contexts.length) process.exit(0)
    emitHookJson(spec.event, { contexts })
  }

  if (CHECK === 'stop-gate' || CHECK === 'deliverable') {
    // 两道 H5 共用这一整段，差别只有这个名字。同一句三元此前在下面相隔 16 行
    // 写了两遍（整理项 9），提到分支外算一次。
    const label = CHECK === 'stop-gate' ? 'H5b 交付物拦截' : 'H5a 交付物记录'

    // H5b（stop-gate）判的是"正在停止的这个 subagent 自己"：SubagentStop 是
    // 生命周期事件，agent_type 就是这次事件所属的那个 subagent——
    // docs/07-U5-U6-U8-实测结论.md §4 实测过，平台真实发的是全限定名
    // "agent-team:at-xxx"，必须 stripPluginPrefix。
    //
    // H5a（deliverable）判的是"刚被派发、已经返回的那个目标角色"，不是发起
    // 这次 Agent 调用的调用者。PostToolUse 保留同一次调用的 tool_input：
    // 调用者是 agent_type，目标是 tool_input.subagent_type——跟 H1
    // （decideDelegation）、H2（上面 readiness 分支）在 PreToolUse/Agent 上
    // 读的是同一套字段，同一个字段在两个事件里含义不同，不能混用。这里如果
    // 也读 agent_type，H5a 查的会是调用者而不是刚返回的那个角色：主线程
    // 发起的顶层派发（agent_type 缺失）会被整段跳过，PM 发起的派发会查成
    // PM 自己的阶段——H5a 作为权威记录这件事就形同虚设。这是 Task 6 落地
    // 时发现的、简报没写对的地方，不在简报明确列出的"已经过时的地方"那
    // 四条里。
    const rawTarget =
      CHECK === 'stop-gate' ? input?.agent_type : input?.tool_input?.subagent_type
    if (!rawTarget) {
      // 没有可判定的目标角色——跟 H2 的 !target 分支同一类情形（Task 3
      // 评审 Minor 5）：不是"这次调用与本检查项无关"（那种情况在 toolNames
      // 前置校验里已经处理并保持沉默），是"这次事件确实归本检查项管，但
      // 认不出该查谁"，同样要放行 + 留痕，不能悄悄放行。
      process.stderr.write(
        `agent-team ${label}：这次事件没有可判定的目标角色（agent_type 或 ` +
          `tool_input.subagent_type 缺失），跳过本次校验、放行。\n`,
      )
      process.exit(0)
    }
    const role = stripPluginPrefix(rawTarget)

    // M3n：SubagentStop 带着 PM 的身份时，H5b 不表态——那不是一个被派出去的角色在收尾。
    // 实测（docs/22 §3）：CLI 自己起的内部分叉（agent_summary、prompt_suggestion、compact……）
    // 停下时也发 SubagentStop，而它们带的 agent_type 是**主线程**的身份，不是父代理的；
    // 本插件用 settings.json 的 agent 键把主线程钉成 at-pm，于是它们一律是 "agent-team:at-pm"。
    // at-pm 是 S1 / S4 / S8 的产者：没有这一行时，H5b 在这几段、PM 的产物落盘之前会对每一个
    // 分叉 exit 2（docs/22 §5 是实物：一个写进度摘要的分叉被要求交出 04-dispatch.md）。
    // 这一行的前提有两半：
    //   ① 平台侧：分叉恒带主线程身份。node --test 钉不住它，三样付在 docs/22 §9。
    //   ② 插件侧：花名册里没有任何角色能派 at-pm，所以真的 at-pm 从来不以子代理身份停下
    //      ——**由 tests/roster-closure.test.mjs 钉着，这里不另抄一份判据**：那条判据变红的那天，
    //      就是这一行的前提失效的那天，连这一行一起重判。
    // 谓词复用 isContractWriter（与 H3 的 I2 豁免、H4 的短路同一个），不另写一份 role === 'at-pm'。
    // 它的 MAIN 那一半在这里够不着：agent_type 缺失或为空时，上面 !rawTarget 那一支已经放行并留痕。
    // （唯一的例外是字面量字符串 "__main__"——callerOf 的哨兵值，H3/H4 同样把它当主线程；
    // 它在这一支上改判前后都是静默 exit 0，只少了读不到上下文时那行痕，docs/22 §14.1。）
    // 只对 stop-gate：H5a 读的是 tool_input.subagent_type，它那条告警不归这一行管。
    // 排在读运行上下文之前，与 H4 对 PM 的短路同构：这是「这次事件不归本检查项管」，不是
    // fail open，所以不写 failOpenNotice；但走的是 process.exit(0)，门禁留痕开着时照样留下
    // 那一行（hooks/lib/trace.mjs），不比别的放行更不可见。
    // 盖不住的一格：用户用 --agent 把主线程钉成别的团队角色时，分叉带的是那个角色的名字
    // （docs/11 §5.35 的收口）。
    if (CHECK === 'stop-gate' && isContractWriter(rawTarget)) process.exit(0)

    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    // H5 两道都是 fail open（规格 §6：流程辅助，坏了不该把整趟跑卡死）——
    // 且不像 H3/H4 要按 ctx.kind 分派：H5 从头到尾没有 fail closed 的那
    // 一半，no-run 与 unreadable 在这里一视同仁放行。但不能静默：跟着
    // H2/H3/H4 的先例，读不到运行上下文时要往 stderr 留一行痕迹，否则
    // "放行"和"门禁坏了"长得一模一样。
    //
    // M3v（docs/30，全量审查第 12 条）：H5a 在 PM（含主线程）发起的派发上再回传一段【门禁】、给用户一行——这一次
    // 前置就绪没做（H2 同一刻读的是同一份磁盘，只留了 stderr），交付物核验也不会做：
    //   - unreadable：按原因给修法（hooks/lib/fail-open.mjs 的 runContextFix）。协调者发起的派发只留 stderr：它派的角色
    //     写入时会被 H3 以同一个原因拒掉，拒绝理由会冒泡上去；再发一段只是多一个转述环节。
    //   - no-run：只在目标是调用者派得动的团队角色时说（decideDelegation 放行，与 H1 同一个函数、同一份花名册）——
    //     团队在干活而门禁看不见 run：要么是用户要的临时派发，要么门禁看的项目根不是 PM 以为的那个。
    //     H1 拒掉的派发不跑 PostToolUse:Agent，这里不必另判；这一条只排除「派不动的目标」，挡不住别的插件或设置里的
    //     deny 规则拒掉的派发——那种派发同样不跑 PostToolUse。
    // H5b 照旧只 stderr：SubagentStop 上没有到父级或用户的通道（exit 0 带 additionalContext 等于拦截）。
    if (!ctx.ok) {
      process.stderr.write(failOpenNotice(label, ctx))
      if (CHECK === 'deliverable' && isContractWriter(input.agent_type)) {
        if (ctx.kind !== 'no-run') {
          emitHookJson(spec.event, {
            contexts: [dispatchUnreadableNotice(ctx.cause)],
            systemMessage: systemMessage('dispatch-unreadable', { cause: ctx.cause }),
          })
        } else {
          const roster = loadRoster()
          // decideDelegation 排在前面：花名册读坏（null、数组）时它先判拒，不去对一个不是对象的值调 Object.hasOwn。
          if (decideDelegation(input, roster).decision === 'allow' && Object.hasOwn(roster, role)) {
            emitHookJson(spec.event, { contexts: [dispatchNoRunNotice()], systemMessage: systemMessage('dispatch-no-run') })
          }
        }
      }
      process.exit(0)
    }

    // stageId 来自 state.json，不再让 decideDeliverable 自己猜——理由见
    // hooks/lib/deliverable.mjs 头部的【M1b 改】那一段。ctx.state 在这里必然
    // 存在（ctx.ok 为 true 意味着 state.json 读出来且是对象），但 stage 字段
    // 本身可能缺，那种情形由 decideDeliverable 归成 skipped:'unknown-stage'。
    //
    // M3y（docs/33，全量审查第 15 条）：交没交按 freshness 判——返工轮里磁盘内容与 rework_base 记的 sha 相同的产物是上一轮的，
    // 不算这一轮交了；它与「没写」分开报（r.missing / r.stale）。此前零改动停下 H5b 放行、H5a 一声不吭。
    const fresh = makeFreshness({ artifactExists: ctx.artifactExists, artifactBytes: ctx.artifactBytes, reworkBase: ctx.state?.rework_base })
    const r = decideDeliverable({
      role,
      stageId: ctx.state?.stage,
      stages: ctx.stages,
      artifactExists: fresh.artifactCurrent,
      artifactStale: fresh.isStale,
      artifactBlank: fresh.isBlank,
    })

    // M4d（docs/38，全量审查第 19 条）：H5a 这一刻是派发的哪一刻（tool_response.status）。launched：后台派发刚启动，子代理还没干活，不判产物（它完成时
    // 由完成核验判）；completed：前台派发跑完了；unknown：tool_response 没有 status（旧版 CLI），照改之前的口径说。
    // 团队角色的每一次派发记一行派发记录：完成核验按它对回角色与段，协调者的进度按 caller_id 认它派过谁。已收口的 run 不记。
    // M4d 复核（docs/38 §3）：H5b 每一回停下都记一行结果——放行（pass）、冒泡（bubble）、拦（block）。完成核验与协调者进度按「这个子代理
    // 最后一回停下的结果」说成因、说它停没停：只记拦截时，「拦过一回」被当成「平台静默放行」（冒泡之前必然先被拦一回），进度也分不出
    // 「还在跑」与「已经停了」。只记团队角色、阶段链上的段、没收口的 run；写不进只留痕，拦不拦与记不记无关。
    const stopId = CHECK === 'stop-gate' && typeof input?.agent_id === 'string' && AGENT_ID_RE.test(input.agent_id) ? input.agent_id : null
    const recordStop = (outcome) => {
      if (!stopId || closedAt(ctx.state) !== null || !isKnownStage(ctx.stages, ctx.state?.stage)) return
      const rosterNow = loadRoster()
      if (!isPlainObject(rosterNow) || !Object.hasOwn(rosterNow, role)) return
      appendDispatchLog(ctx.runDir, stopLine({ at: new Date().toISOString(), agentId: stopId, role, stage: ctx.state.stage, outcome }), label)
    }

    const phase = CHECK === 'deliverable' ? dispatchPhase(input?.tool_response) : null
    const launchedId = CHECK === 'deliverable' ? input?.tool_response?.agentId : null
    if (
      CHECK === 'deliverable' &&
      phase !== 'unknown' &&
      typeof launchedId === 'string' &&
      AGENT_ID_RE.test(launchedId) &&
      closedAt(ctx.state) === null &&
      isKnownStage(ctx.stages, ctx.state?.stage)
    ) {
      const rosterNow = loadRoster()
      if (isPlainObject(rosterNow) && Object.hasOwn(rosterNow, role)) {
        appendDispatchLog(
          ctx.runDir,
          dispatchLine({
            at: new Date().toISOString(),
            agentId: launchedId,
            toolUseId: typeof input.tool_use_id === 'string' ? input.tool_use_id : null,
            role,
            stage: ctx.state.stage,
            caller: callerOf(input),
            mode: phase === 'launched' ? 'background' : 'foreground',
            callerId: typeof input.agent_id === 'string' && AGENT_ID_RE.test(input.agent_id) ? input.agent_id : null,
          }),
          label,
        )
      }
    }

    // 账本比对（Task 4，规格 §6.2 的内容比对补偿）：排在 r.ok 分支判断之前算，因为不管
    // r 落进下面哪一支，比对结果都要并进**同一条** additionalContext——两份 JSON 写进
    // stdout，平台一份都不认（M3v 订正：上一版这里写的是「会让 PM 只看见后一条」，实测是两段都丢；下面统一交给
    // emitHookJson 拼成一份）。只在 CHECK === 'deliverable' 时算：H5b（stop-gate）在 SubagentStop 上，exit 0 带
    // additionalContext 等于拦截，这条通道不能用，算了也没地方发。
    // M3b：**这条回传的收件人不是 role**。role 是刚被派出去的那个目标
    // （tool_input.subagent_type）；additionalContext 发给**发起这次 Agent 调用的人**，
    // 也就是 agent_type——主线程发起时它缺失，callerOf 归成 MAIN。两个字段在这个事件上
    // 含义不同这件事，上面 rawTarget 那段注释已经写过一次，这里只是用它的另一半。
    //
    // 组合（callerOf → isContractWriter）与 hooks/lib/writepath.mjs 的控制文件豁免逐字
    // 同构，是有意的：文案断言的「收件人改不改得了 state.json」与 H3 真实会不会拒，
    // 由同一个谓词决定。完整理由与失效条件写在 buildDriftNotice 上方，不在这里重复。
    const recipient = callerOf(input)
    const recipientCanWriteState = isContractWriter(recipient)
    // M4d 复核（docs/38 §3）：前台派发跑完那一刻，它自己这一段刚交的那几份当然还没记进 artifacts（PM 读过回报、核过磁盘才记）——
    // 那一条「没记」每一次都会出现、还要协调者原样冒泡上去，是噪声；完成核验因为同一个理由整段不带账本比对。复核那一版只剔它自己的那几份；
    // stage 不是阶段链上的段（坏 state.json、对象当键）时不展开：拿它当属性键会崩（tests/trusted-echo.test.mjs 的非字符串那一格）。
    // M4d 实测（M5）：前台并发派发时，后返回的那个收到的账本比对里还有先返回的兄弟刚交的那一份「没记」——剔掉这一段所有的产物，不只是它自己的。
    const ownFresh = phase === 'completed' && isKnownStage(ctx.stages, ctx.state?.stage) ? productsOfStage(ctx.stages[ctx.state.stage]) : []
    const driftNotice =
      CHECK === 'deliverable'
        ? buildDriftNotice(
            withoutOwn(compareArtifacts({
              artifacts: ctx.state?.artifacts,
              stages: ctx.stages,
              artifactBytes: ctx.artifactBytes,
              // M2a：undefined 而不是 []——expectedArtifacts 把 undefined 当"退回全部
              // producers"，把 [] 当"这一趟一个执行角色都没派"。state.json 的 roster
              // 字段坏掉（不是数组）时应当退回更宽的集合，多报几条不要漏报。
              // ⚠️ M3x：这里**有意**仍传整趟 roster，不按段取（participantsOf）——当前段记账之前按段取是空集，
              // S2/S5 的产物整体掉出 drifted/missing 的范围（docs/11 §5.33 的收口；判据在 tests/gate-deliverable.test.mjs
              // 的「M3x 整趟口径」）。
              roster: Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined,
            }), ownFresh),
            recipientCanWriteState,
            // M4g 复核：「没记」那一行注明门禁知道的写者（driftNoteFor 上方）。
            driftNoteFor(ctx.stages, (() => {
              const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
              return logBytes ? dispatchedByStage(readDispatchLog(logBytes.toString('utf8'))) : null
            })()),
          )
        : null

    // M3b：收件人改不了它时，**往 stderr 留一行痕**。文案那一半在 buildDriftNotice 里，
    // 痕迹这一半在调用点，两半都要有；这个分工与 buildCoverageNotice 那条收窄失效的痕迹
    // 逐字同构。措辞与完整理由在 misroutedNotice 上方，产者交代那一条共用同一份。
    //
    // ⚠️ 只在收件人改不了时留。PM（含主线程）收到时那条路径本来就通，留痕只是噪音。
    if (driftNotice && !recipientCanWriteState) {
      process.stderr.write(
        misroutedNotice('账本比对', 'PostToolUse:Agent 的 additionalContext', recipient),
      )
    }
    // M4c（docs/37）：契约那一段（contractNoticeFor 上方）。与账本比对一样只在 deliverable 上算、收件人改不了时留误投痕。
    const contractNotice = CHECK === 'deliverable' ? contractNoticeFor(ctx, recipientCanWriteState) : null
    if (contractNotice && !recipientCanWriteState) {
      process.stderr.write(
        misroutedNotice('契约', 'PostToolUse:Agent 的 additionalContext', recipient, '它要动的是 state.json 的 contract_sha 或契约本身，H3、H4 在 PreToolUse 上把非 PM 对它们的 Edit/Write 拒掉'),
      )
    }

    if (r.ok) {
      // M4d 实测（docs/38 §4 的 M5）：产物在、回复第一行却是冒泡标记的（执行角色把「卡在哪」写进了实现记录再冒泡），记成 bubble——门禁照旧算它交了
      // （只看在不在、空不空），但协调者进度不能因此说「名单上的都交了」。
      if (CHECK === 'stop-gate') recordStop(bubbleOf([input?.last_assistant_message]) !== null ? 'bubble' : 'pass')
      // ⚠️ ok 有三种成因，只有一种是真的「交付了」。skipped 的两种是门禁**哑掉**：
      // 它没有意见，不是它检查过了没问题。H5a 是权威记录，这种区别必须留痕，
      // 否则和 docs/08 §0 说的「看起来通过了」完全无法区分。
      // 'role-not-in-stage' 尤其值得看一眼：它要么说明这次派发本身不该发生，要么
      // 说明 state.stage 停在旧阶段没推进——后者会让 H5 对整个新阶段全程哑火。
      // 但它还有**第三种**成因：返回的是一个合法的层级协调者，且当前阶段确实还没做完
      // （S5 派 at-architect 去分发 at-backend）。那一种由 isCoordinatorFor 排掉，理由
      // 见那个函数上方（M1b 终审 C4）。
      //
      // M2a（docs/11 §1.1）：「能传递派到当前阶段执行角色」这条近似接上 S6–S8 之后不再
      // 充分——S6 里 state.stage 还停在 S5 时，at-architect/at-product 的一次合法返回，
      // 与「压根没推进」在 isCoordinatorFor 眼里长一个样，都落在它为真这一侧。补一条
      // 独立信号：当前阶段的产物是不是已经全部齐了（isStageDone）。协调者返回本身不假，
      // 但只要产物已经齐了、state.stage 却没跟着推进，就改判成「停在旧阶段」。
      //
      // ⚠️ 这是**新增**一处 isStageDone 调用，跟上面 ledger 分支里那处不是同一处（这里是
      // deliverable 分支，两处互不共享调用点）。roster 传当前段的参与者
      // participantsOf(ctx.state, ctx.state?.stage)（M3x，docs/32）——与 ledger 分支里那次 isStageDone 逐字相同。
      // M3x 之前这里传整趟 roster：at-ui 在 S2 进过 roster，S5 正常收尾、PM 还没记账时架构师一返回，S5 就只等
      // 05-impl/at-ui.md、判成齐了，被报成「停在旧阶段」（全量审查第 14 条的 D4）。按段取，产物随参与者展开的段在 PM
      // 记账之前不齐，那几段的「停在旧阶段」只在「记了账没推进」时报；产物固定的段照磁盘判，与基线相同（比如 S6 的
      // 06-test.md 已在、stage 还停在 S6，非本段角色返回照报）。
      // ⚠️ 上一版这里列着「传参的写法与本文件这几处逐字相同：……那次 compareArtifacts、readiness 分支里那次
      // decideReadiness」——M3x 起不再相同：那两处有意仍传整趟 roster，理由在 docs/11 §5.33 的收口。
      //
      // ⚠️ **M3k：ledger 分支里那次 isStageDone 是这一轮才进这张清单的**——在那之前它
      // 是本文件里唯一**不**传这个参数的一处，后果是有产者被裁剪的阶段那条【阶段】提示
      // 结构上永远不发（实测 docs/20 §7.8、收口 docs/11 §5.33）。**下面那句「两处都改，
      // 改一处的时候去看另一处」当时就写在这里，而它点名的那一处正是没改的那一处**：
      // 从此这件事由 tests/stage-done-call-site.test.mjs 钉着——它按源码派生，
      // 本文件里任何一处 isStageDone 调用不按段取参与者（M3x 起整趟 roster 也算），它当场红。
      //
      // ⚠️ M3a Task 4 同时改掉了这句话里的**位置指代**：上一版写的是「与**下面**
      // compareArtifacts、**上面** readiness 分支」——**两个方位词里有一个是错的**，
      // compareArtifacts 那次调用在本文件里排在这一处**上面**，不是下面。
      // 按 Ruling 11 同一条（文档与注释里不写 file:line，写符号名）：**方位词和行号是同一族
      // ——靠位置定位，被下一次插入或搬动静默弄假，而且没有任何东西会红。** 改成点名。
      //
      // ⚠️ M3a Task 4：上一版这里写的是「口径与下面 compareArtifacts、上面 readiness
      // **分支一致**」——M3a Task 3 之后那句只剩一半真，改成上面那样分两层说。
      // **写法一致是真的**（上面列举的那几处当时都是 Array.isArray(...) ? ... : undefined；M3x 起两处 isStageDone
      // 改传 participantsOf，见上）；
      // **假的是「传进去之后退回全部 producers」这个效果对 compareArtifacts 整体成立**：
      // 那个函数里三个清单已经不共用一个宇宙，drifted/missing 吃这个参数，
      // **unrecorded 根本不看它**（hooks/lib/artifact-drift.mjs 的 M3a 注释块）。
      // 传 undefined 还是传一份真 roster，对 unrecorded 一个字的差别都没有。
      // **那几处的写法一致，不等于它们拿它干同一件事。**
      //
      // ⚠️ 这句话在 stages.README.md 的「H5a 的静默集合」那一节末尾有**逐字同族的
      // 一份**（讲的就是上面这处 isStageDone 调用），同一轮一起改的——两处都改，
      // 是因为本仓库最稳定的那个失败模式就是「更正只作用到它逐字点名的那一句上」。
      // 改一处的时候去看另一处。
      const coordinator = isCoordinatorFor(ctx, role)
      // M3y：「齐了没」与 ledger 那一处同样按 freshness 判——上一轮的产物不让当前段判齐、把协调者的返回报成停在旧阶段。
      const stageDone = isStageDone({
        stage: ctx.state?.stage,
        stages: ctx.stages,
        artifactExists: fresh.artifactCurrent,
        roster: participantsOf(ctx.state, ctx.state?.stage),
      })
      // 'unknown-stage'：state.stage 缺失、不是字符串，或不在阶段链里——交付物核验这一次没做，在它改对之前每一次都不做。
      // M3v（docs/30）订正：上一版这里写的是「ledger 那条路径会给出细节」「SubagentStop 上没有 additionalContext 这条
      // 通道」。前一句只有一半真——ledger 只在写 state.json 那一刻报，Bash 改坏 stage、插件升级改了阶段链时一次都不经过它；
      // 后一句不准——通道在，只是在那里发等于拦截。现在：H5a 回传一段【门禁】（按 history 末条给两支修法，收件人改不了
      // state.json 时冒泡），PM 收件时给用户一行；H5b 只往 stderr 留痕。痕迹不复用 misroutedNotice——那一句断言「判据没有
      // 放行任何东西」，而这一格恰恰放行了。
      const notices = []
      let message = null
      if (r.skipped === 'unknown-stage') {
        process.stderr.write(
          `agent-team ${label}：state.stage 不在阶段链里，这次没有做交付物核验、放行。` +
            (CHECK === 'deliverable' && !recipientCanWriteState
              ? `回传落在 ${inline(recipient)} 手里——它改不了 state.json，要靠它原样冒泡到 PM。`
              : '') +
            '\n',
        )
        if (CHECK === 'deliverable') {
          notices.push(unknownStageNotice({ state: ctx.state, stages: ctx.stages, recipientCanWriteState }))
          if (recipientCanWriteState) message = systemMessage('unknown-stage')
        }
      }
      // M4a 复核（REAL-1）：已收口的 run 上整格不发——H6 冻结了 stage，「停在旧阶段」不可能是成因，「记一次回退」也走不通。账本比对照发。
      if (CHECK === 'deliverable' && r.skipped === 'role-not-in-stage' && (!coordinator || stageDone) && closedAt(ctx.state) === null) {
        const stageLabel = quote(ctx.state?.stage)
        // M4d 复核：后台派发启动那一刻它还没返回，说「刚派出去的」。
        const justNow = phase === 'launched' ? '刚派出去的' : '刚返回的'
        // 两支措辞不能共用同一份文案："而且它也派不到那个执行者"在 coordinator 为真时
        // 是假话——它明明是合法的协调者，只是这一阶段的产物已经齐了、state.stage 没
        // 跟着推进。
        // 文档核对（PG-6）：最后一段、没收口、PM 收件时，这一格多半是照收口拒绝理由补交缺的前置——先说这条正路，不先断言「两种可能」
        // （停在旧阶段、派发不该发生，两样都不对）。
        const lastOpenForPm = !coordinator && recipientCanWriteState && ctx.state?.stage === lastStageId(ctx.stages) && closedAt(ctx.state) === null
        const notice = lastOpenForPm
          ? `⚠️ 交付物校验：${justNow} ${inline(role)} 不是当前阶段（state.stage = ${stageLabel}，阶段链最后一段）的执行者。` +
            `这次若是在补收口缺的前置（收口时 H6 点过名的），不是返工、不用记回退——等它交完，照 /agent-team:at 第 6 节从第一步` +
            `重走一遍再收口（补交的验收结论要读，交付文档要照它改）。交付之后的新改动：先照第 6 节收口、再另起一趟；这一趟的产物` +
            `有问题要返工：照「回退」一节记一次回退，同一次 Write 追加 history、记 rework 与 rework_base。` +
            `⚠️ **不要靠把 state.stage 改回旧阶段来消掉这条**。`
          : coordinator
          ? `⚠️ 交付物校验：${justNow} ${inline(role)} 不是当前阶段（state.stage = ${stageLabel}）的` +
            `执行者，但它能（传递地）派到当前阶段的执行角色——这原本是合法的层级协调。` +
            `只是当前阶段的产物已经全部齐备，state.stage 大概率没有随之推进到下一阶段：` +
            `这正是**停在旧阶段**，H5 会对新阶段全程哑火。去 run 目录核实产物是否真的都已` +
            `完成，确认后照 /agent-team:at 第 3 节记推进的账：stage 与 history 用同一次 Write 推进，roster、stage_roles、trimmed 一起记。` +
            (isRolePatternStage(ctx.stages?.[ctx.state?.stage]) ? IMPL_RECORD_NOTE : '')
          : `⚠️ 交付物校验：${justNow} ${inline(role)} 不是当前阶段（state.stage = ${stageLabel}）的` +
            `执行者，**而且它也派不到那个执行者**（所以不是一次层级协调），所以这次校验` +
            `**没有意见**——不是它查过了没问题。两种可能：state.stage 停在旧阶段没推进，` +
            `那样 H5 会对整个新阶段全程哑火；或者这次派发本身不该发生。去 run 目录核实。` +
            // M4b 第二轮复核：执行段已经齐了、PM 收件时同样带上「先读被拒那一节」（例：旧 run 的 S5 齐了，PM 先派了 at-qa）。
            (recipientCanWriteState && stageDone && isRolePatternStage(ctx.stages?.[ctx.state?.stage]) ? IMPL_RECORD_NOTE : '') +
            `⚠️ **不要靠把 state.stage 改回旧阶段来消掉这条**——那正好制造前一种失效。` +
            // M3y（docs/33）：驳回之后的返工也会落进这一格（回退没记就重派）。记回退不是「把 stage 改回去」：history 追加、
            // rework 与 rework_base 同一次 Write 记上。按收件人分：改得了 state.json 的照「回退」一节记，改不了的冒泡。
            // M4a（docs/35）：最后一段、没收口、PM 收件那一种挪到最前面单独说（lastOpenForPm）。
            (recipientCanWriteState
              ? `这次派发若是驳回之后的返工，那不是把 stage 改回去，是记一次回退：照 /agent-team:at 的「回退」一节，` +
                `同一次 Write 追加 history、记 rework 与 rework_base。这一次已经重写过的产物会被快照记成上一轮的，` +
                `记完之后把它们标 "accepted"，不必再派一遍（验证段的产物除外：测试、验收、交付报告要再出一次）；` +
                `被门禁拦下、没写成的，记完回退之后照常再派。`
              : `这次派发若是驳回之后的返工，记回退是项目经理的事：把这一条原样冒泡给派你的人。`)
        notices.push(notice)
      }
      // M4d（docs/38，全量审查第 19 条修法 3）：协调者返回、当前段还没齐（S5 正路上架构师返回时，执行角色可能还在后台跑）——原来这一格整段静默。
      // 现在报门禁记着它派出去的执行角色与各自产物的现状，只说事实、不下「缺」的断语（措辞在 hooks/lib/completion.mjs 的
      // coordinatorProgress）。后台派发启动那一刻不报：它还没开始派。
      // M4h（docs/43，审查第 14 条）：自己也是这一段产者的协调者（S2 的 at-product），它那几份交了（r.skipped 为 undefined）也报进度。
      const coordinates = r.skipped === 'role-not-in-stage' ? coordinator : r.skipped === undefined && dispatchesOtherProducers(ctx, role)
      if (CHECK === 'deliverable' && phase !== 'launched' && coordinates && !stageDone && closedAt(ctx.state) === null) {
        const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
        const p = progressOf({
          ctx,
          fresh,
          log: readDispatchLog(logBytes ? logBytes.toString('utf8') : null),
          coordinator: role,
          coordinatorId: typeof launchedId === 'string' && AGENT_ID_RE.test(launchedId) ? launchedId : null,
          stageId: ctx.state?.stage,
          recipientIsPm: recipientCanWriteState,
          selfDone: r.skipped === undefined,
        })
        if (p) notices.push(p)
      }
      // 账本比对：不管上面那条哑火告警发不发，只要三个清单有一个非空就并进同一条——
      // 见上面 driftNotice 计算处的注释。emitHookJson 什么都没有时不写 stdout，两条
      // 告警都不适用时这里保持原来的完全沉默。账本比对不受这条静默表约束（docs/11
      // §5.8）：它审的是产物内容对不对得上账，跟阶段有没有推进是两件独立的事。
      if (driftNotice) notices.push(driftNotice)
      if (contractNotice) notices.push(contractNotice)
      emitHookJson(spec.event, { contexts: notices, systemMessage: message })
    }

    if (CHECK === 'stop-gate') {
      // H5b：真拦截。必须走 SubagentStop 契约（exit 2 + stderr），不是
      // PreToolUse 那套 permissionDecision JSON——U5 实测（docs/07 §1）拦住
      // subagent 停止靠的就是 exit 2，在这个事件上发 permissionDecision
      // 形状等于「平台不认 + exit 0」＝静默放行，H5b 会变成一个看起来健康
      // 的空操作。denyAndExit 按事件分派输出契约，永不返回，这里不需要、
      // 也不应该在它之后再写 process.exit。
      //
      // M4c（docs/37，全量审查第 18 条）：冒泡的出口——被拦过一回、最后一条回复的第一行以「冒泡：」开头，就放它停下
      // （判定与理由在 ./lib/deliverable.mjs 的 isBubbleStop 上方）。放行走 exit 0、什么都不写：SubagentStop 上 stdout 与
      // additionalContext 都等于拦截。只在要拦的时候才读它——产物齐了的照上面 r.ok 那一支放行，与标记无关。
      if (isBubbleStop({ stopHookActive: input?.stop_hook_active, lastMessage: input?.last_assistant_message })) {
        recordStop('bubble')
        process.exit(0)
      }
      // M4d（docs/38，全量审查第 19 条）：拦之前记一行（recordStop 上方）——完成时它最后一回停下是拦、它却结束了，多半是平台的续跑上限到了。
      recordStop('block')
      denyAndExit(r.reason, spec.event)
    } else {
      // H5a：权威记录。不 block，只把事实留在会话里——不能被误读成"子代理正常返回
      // =这一段已经完成"。写完直接落到本函数末尾共用的 process.exit(0)，不需要在
      // 这里另写一次。
      //
      // ⚠️ 解释「为什么会这样」那一整段来自 ./lib/retry-budget.mjs 的
      // SUBAGENT_STOP_RETRY_NOTE，**不要在这里把它的计数写成字面量**：它的单一真源在那里（M4c 起是源码核过的
      // 可配置默认值，原来几次观测彼此不等是数法不同），而且同一份知识此前在八句话里
      // 各写了一份。判据见 tests/retry-budget-single-source.test.mjs，它会拦住第二份。
      //
      // ⚠️ M3k：**这个模板上一版自己写着「SubagentStop 已经尝试拦截过，但」，
      // 而那句话在异步派发下是假的**——H5a 挂在 PostToolUse:Agent 上，那个事件在
      // 子代理刚被启动那一刻就跑完了，那一刻 SubagentStop 一次都还没发生过
      // （实测 docs/20 §7.10：告警 00:12:53、产物落盘 00:15:20）。
      // 上一版这段注释开头写的理由（「因为 H5b 到点会被平台静默放行，父级看到的是
      // 干净的一次通过」）**是同一个归因的另一份**：它只覆盖同步那一种。
      // 两种情形各自为什么都不足以放心，现在由那个常量一并说清；收口 docs/11 §5.33。
      //
      // M3y（docs/33）：r.stale 是返工轮里还是上一轮的产物（在磁盘上，内容与回退那一刻一样）。没有它时文案与 v1.6.0 逐字
      // 相同；有它时与「没有」分开说，出路按收件人分——改得了 state.json 的给「标 accepted」，改不了的冒泡。
      // M4a（docs/35）：还旧的按「能不能标 accepted」分开说——验证段的产物（问题 B 里异步派 at-qa 那一刻的 06-test.md）只给
      // 「重跑之后重写」，不给标 accepted。
      // M4d（docs/38，全量审查第 19 条）：后台派发启动那一刻（launched）子代理才刚起来，产物当然还没有——不判、不说；它完成时由完成核验按派发记录核。
      // 账本比对与【契约】审的是整趟 run、不是这个子代理，照发。前台派发跑完了（completed）：回报第一行是冒泡标记就说它冒泡了；不是的话，
      // 门禁拦过它（派发记录里有它的拦截行）就是平台静默放行，没拦过就照实说门禁没核。认不出是哪一刻（unknown）：照改之前的口径。
      const notices = []
      if (phase !== 'launched') {
        let why = null
        let trimHint = ''
        if (phase === 'completed') {
          const logBytes = ctx.artifactBytes(DISPATCHES_FILE)
          const log = readDispatchLog(logBytes ? logBytes.toString('utf8') : null)
          const id = typeof launchedId === 'string' && AGENT_ID_RE.test(launchedId) ? launchedId : null
          why = missingCause({
            last: id ? lastStop(log, id) : null,
            bubble: bubbleOf(reportTexts(input.tool_response)),
            blocks: id ? log.blocks.get(id) ?? 0 : 0,
          })
          trimHint = trimHintFor(ctx.stages, r.stageId, role, [...r.missing, ...(Array.isArray(r.blank) ? r.blank : [])])
        }
        notices.push(missingNotice({ ctx, r, role, recipientCanWriteState, why, trimHint }))
      }
      // 交付物本身还缺产物时，账本比对一样并进同一条——它审计的是全部阶段的
      // produces，不只是刚被判定缺失的这一段（比如更早的阶段被 Bash 绕过写过）。
      if (driftNotice) notices.push(driftNotice)
      if (contractNotice) notices.push(contractNotice)
      emitHookJson(spec.event, { contexts: notices })
    }
  }

  process.exit(0)
}

// 测试不 import gate.mjs——KNOWN_CHECKS/CHECKS 已经拆到 ./lib/checks.mjs，需要它们的
// 测试从那里 import。唯一 import 它的是进程入口 ./boot.mjs（M3p），而它 import 就是为了
// 让这里跑。因此 main() 无条件跑，不加「我是不是被当作 hook 直接执行」的守卫——现在
// 更不能加：argv[1] 是 boot.mjs，按 argv[1] 判断的守卫在任何路径下都会判成「被 import」。
//
// 历史教训（曾经加过这样一道守卫，已整体删除）：判断用的是
// `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`。
// resolve() 不解析 symlink/junction，而 Node 对主入口的 import.meta.url
// 做 realpath——经 symlink/junction 挂载执行时（本插件的开发期挂载方式，
// 见 scripts/dev-link.mjs）两侧路径必然不相等，守卫误判「被 import」，
// main() 永不执行，门禁静默 fail open（exit 0、零 stdout、零 stderr）。
// 回归覆盖见 tests/gate-io.test.mjs 里「经 junction 挂载路径执行仍然 deny」那条测试。
try {
  main()
} catch (err) {
  const spec = CHECKS[CHECK]
  const event = (spec && spec.event) || 'PreToolUse'
  // M3v：这次进程已经写出结果（拒绝或回传）之后才崩——只有注入走得到：每个出口写完都紧跟 process.exit。再写一份就是
  // 两份 JSON，拒绝失效、回传全丢；已经写出去的那一份照样有效，这里只留痕，照那个结果的退出码退出（SubagentStop 的拒绝是 2）。
  if (DECIDED !== null) {
    process.stderr.write(
      `agent-team ${CHECK} 检查项在写出结果之后异常（${quote(err?.message ?? err, { max: 120 })}）。${SECOND_WRITE_NOTE}\n`,
    )
    process.exit(DECIDED)
  }
  // CHECK 此刻按理已经通过 main() 顶部的 KNOWN_CHECKS 校验，spec 应该总是存在；
  // 万一不存在（防御性兜底），按最严格的 fail closed 处理，安全边界优先于精确。
  if (!spec || spec.failClosed) {
    // err?.message：throw 出来的不一定是 Error，这一层自己再抛就会掉进 boot.mjs 的加载失败退路。
    denyAndExit(`agent-team 门禁异常，按安全边界拒绝：${quote(err?.message ?? err, { max: 120 })}`, event)
  }
  // fail open 的检查项（spec.failClosed === false，此刻 spec 必然存在，见上面
  // 那条分支）此前这里直接 process.exit(0)——零 stdout、零 stderr，跟「判定
  // 逻辑正常跑完、结论恰好是放行」在外部观测上完全没有区别，是这个项目一路
  // 被咬的静默放行形状（docs/08 §0；M1b 遗留与已知边界 1.4）。文案抽成纯
  // 函数 crashNotice（hooks/lib/deny.mjs），跟 denyAndExit 用的 denyOutput
  // 是同一种抽法、同一个理由：那份注释里写的先例这里不重复。
  //
  // 这条分支目前从外部没有任何输入能真正触发到（main() 内部各纯函数对退化
  // 输入都很防御）——文案本身由 tests/deny.test.mjs 直接单测验证过；这里到
  // stderr 的传导链（真的从这个 catch 走到 crashNotice、真的写了 stderr、
  // 真的 exit 0）由一次性注入 throw 验证过，不留成永久测试，做法与
  // hooks/lib/deny.mjs 头部对 denyOutput 的同类说明保持一致。
  //
  // ⚠️ M3s 订正（docs/27 §3）：上面「从外部没有任何输入能真正触发到」不成立。复核找到过三种：
  // state.stage 写成 {"toString":1} 这样的对象、project.json 的 paths 元素写成这样的对象（这两种
  // 已在 isStageDone 与 computeReach 挡掉），以及一份大到转不成字符串的产物（还开着，docs/27 §4）。
  // ⚠️ M3v 订正（docs/30）：「不留成永久测试」也不再成立——注入现在是永久判据（tests/helpers/inject-throw.cjs 预加载，
  // tests/gate-fail-open.test.mjs 的「崩溃」那几条）。
  //
  // M3v：stderr 那一行只进转录。PostToolUse 上（deliverable、ledger）再回传一段【门禁】：这一次哪样没做完、去核实
  // 什么。不按调用者门控——ctx 正常时崩溃，只有这次调用的发起者看得见；非 PM 收到冒泡句。PM 收件时给用户一行。
  // readiness 在 PreToolUse 上只给用户一行（那里不发受信块），stop-gate 在 SubagentStop 上什么都不发（hookOutput 定）。
  // 这一段自己再抛就会掉进 boot.mjs 的「加载失败」退路、说错原因，所以整段兜住：兜不住就只剩上面那行 stderr。
  process.stderr.write(crashNotice(CHECK, err, spec?.recorder === true))
  try {
    const pm = isPlainObject(INPUT) && isContractWriter(INPUT.agent_type)
    const notification = isPlainObject(INPUT) && typeof INPUT.prompt === 'string' && INPUT.prompt.includes('<task-notification>')
    const context = CHECK === 'completion' && !notification ? null : crashContext(CHECK, err, pm)
    emitHookJson(event, {
      contexts: context ? [context] : [],
      systemMessage: pm && userFacing(event) ? systemMessage('crash', { check: CHECK }) : null,
    })
  } catch {
    process.exit(0)
  }
}
