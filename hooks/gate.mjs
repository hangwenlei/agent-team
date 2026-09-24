#!/usr/bin/env node
// hook 单入口。第一个参数选择检查项。
// 约定：exit 0 + stdout 上的 JSON 决策 = 生效；无输出 = 走正常权限流程。
// SubagentStop 是例外——它的拒绝走 exit 2 + stderr，不是这套 JSON，
// 见 hooks/lib/deny.mjs 的 denyOutput（拒绝输出契约的唯一真源）。
//
// 入口只做「该检查项声明的前置校验」，不做统一校验——H1–H5 分布在三种
// hook 事件上，输入形状不同（规格 §6 注记）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHECKS, KNOWN_CHECKS } from './lib/checks.mjs'
import { MAIN, callerOf, decideDelegation, stripPluginPrefix } from './lib/decide.mjs'
import { denyOutput, crashNotice } from './lib/deny.mjs'
import { readProjectConfig, readRunContext } from './lib/runctx.mjs'
import { decideReadiness } from './lib/readiness.mjs'
import { decideWritePath, stageOwnerOfRunPath } from './lib/writepath.mjs'
import { decideContractGuard, isContractWriter } from './lib/contract-guard.mjs'
import { decideRework } from './lib/rework-guard.mjs'
import { decideDeliverable } from './lib/deliverable.mjs'
import { SUBAGENT_STOP_RETRY_NOTE } from './lib/retry-budget.mjs'
import { isControlFile } from './lib/control-files.mjs'
import { computeReach } from './lib/reach.mjs'
import { validateState, isStageDone } from './lib/state.mjs'
import { sha256OfContract } from './lib/contract-hash.mjs'
import { buildLedgerNotices } from './lib/ledger.mjs'
import { compareArtifacts } from './lib/artifact-drift.mjs'
import { decideCoverage } from './lib/coverage.mjs'
import { norm, underDir } from './lib/path-norm.mjs'
import { isPlainObject } from './lib/stages.mjs'
import { TRUSTED_PREFIX, trustedBlock } from './lib/trusted.mjs'
import { installTrace } from './lib/trace.mjs'

const CHECK = process.argv[2]
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
// 门禁读的运行状态在**用户项目**里，不在插件目录里。
// hook 以用户项目为 cwd 运行，所以用 process.cwd()；
// 插件自身的文件（roster.json、stages.json）仍用 ROOT。
const ROOT_PROJECT = process.cwd()

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
//   是空数组，算出的 reach 对任何角色都是「够不到任何人」，不会抛。
// 退回空花名册不是「假装没事」，是把「读不出来」换算成这两处已经设计好的
// 「最保守」退化路径，而不是让整个检查项的判定半途而废。
function loadRoster() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'roster.json'), 'utf8'))
  } catch (e) {
    process.stderr.write(
      `agent-team：roster.json 读不出来（${e?.message ?? e}），本次按空花名册处理——` +
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
  process[stream].write(text)
  process.exit(exitCode)
}

// 「这次写的是不是 .agent-team/project.json」。抽成一个谓词是因为 ledger 分支现在
// 要在两条路径上问同一个问题（ctx.ok 的正常路径，以及 ctx 读不出来时那条只为触达表
// 留的通道），而它对 filePath 的类型防御也只该写一遍：norm() 内部是 resolve()，
// 传非字符串会同步抛。
function isProjectJson(filePath, agentTeamDir) {
  if (typeof filePath !== 'string' || !filePath) return false
  if (typeof agentTeamDir !== 'string' || !agentTeamDir) return false
  return norm(filePath) === norm(`${agentTeamDir}/project.json`)
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
function isCoordinatorFor(ctx, role) {
  const stageId = ctx.state?.stage
  const stages = ctx.stages
  if (!stages || typeof stages !== 'object') return false
  if (typeof stageId !== 'string' || !Object.hasOwn(stages, stageId)) return false
  const stageRole = stages[stageId]?.role
  if (typeof stageRole !== 'string' || !stageRole) return false
  const reach = computeReach({ roster: loadRoster(), paths: {} })
  return (reach[role]?.reachableRoles ?? []).includes(stageRole)
}

// ledger 的输出契约：notices 非空才写 stdout。抽出来同样是因为有两个调用点。
function emitLedger(event, notices) {
  if (!notices.length) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: trustedBlock(notices.join('\n\n')),
      },
    }),
  )
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
function misroutedNotice(label, channel, recipient) {
  return (
    `agent-team ${label}：这次的回传落在 ${recipient} 手里——${channel} 只发给这次工具调用` +
    `所属的那个上下文，而它要动的东西住在 state.json 里，H3 写路径门禁在 PreToolUse 上把` +
    `非 PM 对控制文件的 Edit/Write 拒掉。告警照发、判据没有放行任何东西，发错的是收件人` +
    `不是判定；这一条要被处理，得靠 ${recipient} 把那段回传原样冒泡上去，一路带到 PM。\n`
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
function buildDriftNotice(cmp, recipientCanWriteState) {
  if (!cmp) return null
  const { drifted, missing, unrecorded } = cmp
  if (!drifted.length && !missing.length && !unrecorded.length) return null

  const lines = []
  for (const d of drifted) {
    lines.push(`  - ${d.name}：记录的是 ${d.recorded}，磁盘上算出来是 ${d.actual}——记账之后被改过`)
  }
  for (const m of missing) {
    lines.push(`  - ${m.name}：记录的是 ${m.recorded}，但磁盘上没有——被删了，或者从没真的写成`)
  }
  for (const name of unrecorded) {
    lines.push(`  - ${name}：磁盘上有这份文件，但 artifacts 里没记`)
  }

  // 两支收尾。前面那一整段（审计边界）两支共用，一个字不改：它对谁都成立。
  const tail = recipientCanWriteState
    ? `去 run 目录核实磁盘内容，需要的话把 artifacts 改成与磁盘一致。`
    : `⚠️ **这一条你改不了**：artifacts 住在 state.json 里，它是编排层的控制文件，` +
      `H3 写路径门禁在 PreToolUse 上把非 PM 对它的 Edit/Write 拒掉。而这条回传只发给` +
      `发起这次派发的人——**也就是你，PM 不会同时收到一份**。` +
      `**把上面这几行原样冒泡给派你的人**，让它继续往上带到 PM；` +
      `**不要自己把它咽掉**——咽掉之后没有任何人会再看见它。`

  return (
    `【账本比对】以下产物对不上账：\n${lines.join('\n')}\n` +
    `这是审计产物，不是安全边界——它不阻止任何人伪造产物，只让伪造留下痕迹。真要伪造的人` +
    `可以连 artifacts 一起改（任何持有 Bash 的角色都写得了——state.json 对 Edit/Write 只对` +
    `PM 开，但 Bash 不经任何 hook），但那时它不再是顺手绕过，而是一次需要同时改两处的刻意` +
    `行为。${tail}`
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
// ⚠️ 文案必须给**两条**出路，而且要把它们和各自的触发对上：这条提示有两个判据分辨
// 不了、而读的人分辨得了的触发——真的裁了 / 真的漏了。只写一条出路就等于替读的人
// 做了那个判断，而判据恰恰是做不了这个判断的那一方。
//
// ⚠️ 这里要防的错误修法很具体：**把名字写进 roster 让提示消失**。roster 记的是「这一趟
// 真的叫到过谁」，只写名字不派人，产物照样不存在——提示没了，洞还在，而且下一次账本
// 比对会把它报成 missing，那时看起来像是产物丢了，不像是没派。本仓库为「失败文案把人
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

function buildCoverageNotice({ gaps, narrowed } = {}, recipientCanWriteState) {
  if (!Array.isArray(gaps) || !gaps.length) return null
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
      `——它是 /agent-team:at-init 写的那一份；在补上之前不要照着下面两条出路动手。\n`
  // 两条出路。**两支都要保留它们**：判据分辨不了「真裁了 / 真漏了」而读的人分辨得了，
  // 这件事不随收件人变（那正是这两条出路存在的全部理由，见上面那段）。变的只是
  // **谁动手**——写不了的那一支把动作换成「带着事实往上冒泡」，不是把信息删掉。
  const outs = recipientCanWriteState
    ? `两条出路，逐个按事实选一条：\n` +
      `  ① 本来就不打算用它（按需组队的主动裁剪）：把它写进 state.json 的 trimmed，` +
      `形状是 ${shape}——键是角色名，值是它在哪一段被裁掉的。` +
      `理由不用写在这里，它已经在 04-dispatch.md 里。` +
      `已经写过却还在报的话，先核字段名拼对了没有：state.json 的校验不拒未知键，` +
      `trimmed 拼错了不会有任何别的提示。\n` +
      `  ② 不是裁剪，是漏了：把它派出去，让它自己写出那一段的产物。\n` +
      `⚠️ 不要为了让这条提示消失就把名字写进 roster：roster 记的是这一趟真的叫到过谁，` +
      `只写名字不派人，产物照样不存在——提示没了，洞还在，而且下一次账本比对会把它报成 ` +
      `missing，那时看起来像是产物丢了，不像是没派。同样，没真裁就别写进 trimmed。\n` +
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
      `⚠️ 往上带的时候不要把它说成「把名字写进 roster 就行」：只写名字不派人，产物照样` +
      `不存在——提示没了，洞还在，而且下一次账本比对会把它报成 missing，那时看起来像是` +
      `产物丢了，不像是没派。同样，没真裁就别建议写进 trimmed。\n` +
      `**把上面这几行原样冒泡给派你的人**，让它继续往上带到 PM；` +
      `**不要自己把它咽掉**——咽掉之后没有任何人会再看见它。\n` +
      `这条只报不拦：它没有卡住你往下走。`

  return (
    `【产者交代】下面这些角色是**已经走过的阶段**的产者，而这一趟既没叫到它们、` +
    `也没声明裁掉它们——它们的缺席今天不会被任何别的判据看见：\n${lines.join('\n')}\n` +
    widened +
    driverWarning +
    outs
  )
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

  if (!isValidInput(input)) {
    // 读不到可判定的输入。fail closed 的检查项拒绝；fail open 的不表态。
    if (spec.failClosed) {
      denyAndExit('agent-team 门禁无法读取 hook 输入，按安全边界拒绝。', spec.event)
    }
    process.exit(0)
  }

  if (spec.toolNames !== null) {
    if (typeof input.tool_name !== 'string') {
      if (spec.failClosed) {
        denyAndExit(
          'agent-team 门禁无法从 hook 输入中读出 tool_name（缺失或不是字符串），按安全边界拒绝。',
          spec.event,
        )
      }
      process.exit(0)
    }
    if (!spec.toolNames.includes(input.tool_name)) {
      // 这次调用确实与本检查项无关，保持沉默、不表态。
      process.exit(0)
    }
  }

  if (CHECK === 'delegation') {
    const result = decideDelegation(input, loadRoster())
    if (result.decision === 'deny') denyAndExit(result.reason, spec.event)
  }

  if (CHECK === 'readiness') {
    const ctx = readRunContext(ROOT_PROJECT, ROOT)
    // H2 是流程辅助：读不到运行上下文时 fail open，但规格 §6 写的是
    // allow + warning，不是静默放行——必须留痕，不能一声不吭就 exit(0)。
    // stderr 是这个代码库已有的告警通道（未知检查项那条路径也走它），
    // 跟着用；不改用 additionalContext，因为 PreToolUse 是否支持那个
    // 字段本项目没有实测过，换一个同样没验过的通道不会让告警更可靠。
    // 这条告警在会话里是否可见，本项目也没有实测过，留给 Task 7 核实。
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
    const r = decideReadiness({
      targetRole: target,
      stages: ctx.stages,
      artifactExists: ctx.artifactExists,
      // M2a：与 deliverable 分支同一个口径——undefined 而不是 []，state.json 坏掉时
      // 退回「全部 producers」这个更宽的集合，宁可多判一次未完成，不要漏。
      roster: Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined,
    })
    if (r.decision === 'deny') denyAndExit(r.reason, spec.event)
  }

  if (CHECK === 'writepath') {
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
      // 把 at-pm 钉成主线程时，主会话自己的调用带 agent_type: 'at-pm'，落不进
      // MAIN。而这里的 deny 发生在看路径之前，拒的是这个会话的**每一次**
      // Edit/Write；agents/at-pm.md 现在有 Bash（M1c 设计 §1.1 的上界要求——这条
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
      // at-pm 仍然是受完整 per-role 隔离约束的角色，只是**控制文件**那一类已经由
      // decideWritePath 顶部单独放行了（docs/09 账一 / 规格 §6.2.1）。
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
      denyAndExit(
        `agent-team 写路径门禁读不到运行上下文（${ctx.reason}），按安全边界拒绝。`,
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
    })
    if (r.decision === 'deny') denyAndExit(r.reason, spec.event)
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
        `agent-team 契约保护读不到运行上下文（${ctx.reason}），按安全边界拒绝。`,
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
    if (r.decision === 'deny') denyAndExit(r.reason, spec.event)
  }

  if (CHECK === 'rework') {
    // H6 返工预算写时强制（规格 §4.2 ③；docs/11 §1.2 的缺口；完整论证见
    // hooks/lib/rework-guard.mjs 头部，不在这里重复）。判定本身（"新的比旧的少"）
    // 是纯函数 decideRework；这一段只做三件事：认出目标是不是 runs/*/state.json、
    // 把 Edit/Write 的 tool_input 拆成 before/after 两份 JSON、deny 时 fail closed。
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

      // 算新内容。Write 的新全文就是 tool_input.content；Edit 的语义是"对旧文本
      // 套用一次 old_string → new_string 的替换"，磁盘上的旧文本已经拿到手，这里
      // 确定性地重放同一次替换，不去猜——replace_all 缺省当 false，与真实 Edit
      // 工具的默认语义一致（只替换第一次出现，且要求 old_string 在文件里存在）。
      // old_string 在磁盘原文里找不到时算不出确定的新内容，按"parse 不出来"同一个
      // 理由放行，不猜第二种可能。NotebookEdit 不适用：它的 schema 里没有
      // file_path/content/old_string 这套字段，上面的外层条件已经把它整个排除。
      let afterText = null
      if (input.tool_name === 'Write') {
        afterText = typeof input?.tool_input?.content === 'string' ? input.tool_input.content : null
      } else if (input.tool_name === 'Edit' && typeof beforeText === 'string') {
        const { old_string, new_string, replace_all } = input?.tool_input ?? {}
        if (typeof old_string === 'string' && typeof new_string === 'string') {
          if (replace_all) {
            afterText = beforeText.split(old_string).join(new_string)
          } else {
            const i = beforeText.indexOf(old_string)
            afterText =
              i === -1 ? null : beforeText.slice(0, i) + new_string + beforeText.slice(i + old_string.length)
          }
        }
      }

      const parseOrNull = (text) => {
        if (typeof text !== 'string') return null
        try {
          return JSON.parse(text)
        } catch {
          // 写坏的 state.json 不归这里管——parse 不出来就放行，deny 会让 PM 连
          // "把文件修回去"都做不到，与 gate.mjs 里 I2 豁免同一个理由。写坏的内容
          // 由 ledger 的 kind:'state' 报出来（事后告警，不是这里的事）。
          return null
        }
      }

      const r = decideRework({ before: parseOrNull(beforeText), after: parseOrNull(afterText) })
      if (!r.ok) denyAndExit(r.reason, spec.event)
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
        const project = readProjectConfig(ROOT_PROJECT)
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
          emitLedger(
            spec.event,
            buildLedgerNotices({
              kind: 'project',
              reach: computeReach({ roster: loadRoster(), paths: project.value.paths }),
            }),
          )
          process.exit(0)
        }
        // project.json 刚写进去却读不出来（写坏了、或者被并发占用）——没有判据，
        // 继续往下走原来的 fail open 留痕，不要凭空造一张空触达表回传。
      }
      // fail open + 留痕，与 H2/H5 同一先例。措辞按 ctx.kind 分派，共用 failOpenNotice。
      process.stderr.write(failOpenNotice('ledger 回传', ctx))
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
    if (target === norm(`${ctx.runDir}/00-contract.md`)) kind = 'contract'
    // project.json 这一问复用上面那个谓词，不在这里再写一遍同样的等式——
    // 上面 !ctx.ok 那条分支问的是同一个问题，两处分叉就是 C1 的复发形状。
    else if (isProjectJson(filePath, ctx.agentTeamDir)) kind = 'project'
    else if (target === norm(`${ctx.runDir}/state.json`)) kind = 'state'

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

    const bytes = kind === 'contract' ? ctx.artifactBytes('00-contract.md') : null
    const reach =
      kind === 'project' && ctx.project
        ? computeReach({ roster: loadRoster(), paths: ctx.project.paths })
        : null
    const stateProblems =
      kind === 'state' ? validateState(ctx.state, { stages: ctx.stages }).problems : []

    // 【阶段】那条提示的判据。roster 传 ctx.state?.roster——不是数组时传 undefined 退回
    // 全部 producers，写法与本文件另外三处一致（deliverable 分支里那次 isStageDone、
    // 那次 compareArtifacts、readiness 分支里那次 decideReadiness）。
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
    // isStageDone 调用都按 roster 收窄**，不是「这一行长什么样」。上一轮守这件事的
    // 是 deliverable 分支那段注释末尾那句「两处都改，改一处的时候去看另一处」，
    // **而它点名的那一处正是没改的那一处**——一条注释不是一条判据，这件事现在有实物
    // 了（docs/11 §5.33）。
    const stageDone = isStageDone({
      stage: ctx.state?.stage,
      stages: ctx.stages,
      artifactExists: ctx.artifactExists,
      roster: Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined,
    })

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
    })

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
      const cov = decideCoverage({
        stages: ctx.stages, state: ctx.state, availableRoles: ctx.project?.available_roles,
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
      const coverage = buildCoverageNotice(cov, recipientCanWriteState)
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

    emitLedger(spec.event, notices)
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
    if (!ctx.ok) {
      process.stderr.write(failOpenNotice(label, ctx))
      process.exit(0)
    }

    // stageId 来自 state.json，不再让 decideDeliverable 自己猜——理由见
    // hooks/lib/deliverable.mjs 头部的【M1b 改】那一段。ctx.state 在这里必然
    // 存在（ctx.ok 为 true 意味着 state.json 读出来且是对象），但 stage 字段
    // 本身可能缺，那种情形由 decideDeliverable 归成 skipped:'unknown-stage'。
    const r = decideDeliverable({
      role,
      stageId: ctx.state?.stage,
      stages: ctx.stages,
      artifactExists: ctx.artifactExists,
    })

    // 账本比对（Task 4，规格 §6.2 的内容比对补偿）：排在 r.ok 分支判断之前算，因为不管
    // r 落进下面哪一支，比对结果都要并进**同一条** additionalContext——两条 stdout.write
    // 会让 PM 只看见后一条（下面统一交给 emitLedger 拼成一条）。只在 CHECK === 'deliverable'
    // 时算：H5b（stop-gate）走 SubagentStop 的 stderr 契约，没有 additionalContext 这条
    // 通道，算了也没地方发。
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
    const driftNotice =
      CHECK === 'deliverable'
        ? buildDriftNotice(
            compareArtifacts({
              artifacts: ctx.state?.artifacts,
              stages: ctx.stages,
              artifactBytes: ctx.artifactBytes,
              // M2a：undefined 而不是 []——expectedArtifacts 把 undefined 当"退回全部
              // producers"，把 [] 当"这一趟一个执行角色都没派"。state.json 的 roster
              // 字段坏掉（不是数组）时应当退回更宽的集合，多报几条不要漏报。
              roster: Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined,
            }),
            recipientCanWriteState,
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

    if (r.ok) {
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
      // deliverable 分支，两处互不共享调用点）。roster 传 ctx.state?.roster——不是数组时
      // 传 undefined 退回全部 producers：state.json 的 roster 字段本身坏掉时，宁可多判
      // 一次未推进，不要漏判。**传参的写法**与本文件这几处逐字相同（按 docs/16 §3.1
      // 列举，不报总数）：ledger 分支里那次 isStageDone、deliverable 分支里那次
      // compareArtifacts、readiness 分支里那次 decideReadiness。
      //
      // ⚠️ **M3k：ledger 分支里那次 isStageDone 是这一轮才进这张清单的**——在那之前它
      // 是本文件里唯一**不**传这个参数的一处，后果是有产者被裁剪的阶段那条【阶段】提示
      // 结构上永远不发（实测 docs/20 §7.8、收口 docs/11 §5.33）。**下面那句「两处都改，
      // 改一处的时候去看另一处」当时就写在这里，而它点名的那一处正是没改的那一处**：
      // 从此这件事由 tests/stage-done-call-site.test.mjs 钉着——它按源码派生，
      // 本文件里任何一处 isStageDone 调用不带 roster，它当场红。
      //
      // ⚠️ M3a Task 4 同时改掉了这句话里的**位置指代**：上一版写的是「与**下面**
      // compareArtifacts、**上面** readiness 分支」——**两个方位词里有一个是错的**，
      // compareArtifacts 那次调用在本文件里排在这一处**上面**，不是下面。
      // 按 Ruling 11 同一条（文档与注释里不写 file:line，写符号名）：**方位词和行号是同一族
      // ——靠位置定位，被下一次插入或搬动静默弄假，而且没有任何东西会红。** 改成点名。
      //
      // ⚠️ M3a Task 4：上一版这里写的是「口径与下面 compareArtifacts、上面 readiness
      // **分支一致**」——M3a Task 3 之后那句只剩一半真，改成上面那样分两层说。
      // **写法一致是真的**（上面列举的那几处都是 Array.isArray(...) ? ... : undefined）；
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
      const stageDone = isStageDone({
        stage: ctx.state?.stage,
        stages: ctx.stages,
        artifactExists: ctx.artifactExists,
        roster: Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined,
      })
      // 'unknown-stage' 是 state.json 自己坏了，ledger 那条路径会给出细节。
      // H5b（stop-gate）不发这条：SubagentStop 上没有 additionalContext 这条通道，
      // 而且真拦截不该因为「无话可说」就往 stderr 刷字。
      const notices = []
      if (CHECK === 'deliverable' && r.skipped === 'role-not-in-stage' && (!coordinator || stageDone)) {
        const stageLabel = JSON.stringify(ctx.state?.stage)
        // 两支措辞不能共用同一份文案："而且它也派不到那个执行者"在 coordinator 为真时
        // 是假话——它明明是合法的协调者，只是这一阶段的产物已经齐了、state.stage 没
        // 跟着推进。
        const notice = coordinator
          ? `⚠️ 交付物校验：刚返回的 ${role} 不是当前阶段（state.stage = ${stageLabel}）的` +
            `执行者，但它能（传递地）派到当前阶段的执行角色——这原本是合法的层级协调。` +
            `只是当前阶段的产物已经全部齐备，state.stage 大概率没有随之推进到下一阶段：` +
            `这正是**停在旧阶段**，H5 会对新阶段全程哑火。去 run 目录核实产物是否真的都已` +
            `完成，确认后把 state.stage 推进到正确的阶段。`
          : `⚠️ 交付物校验：刚返回的 ${role} 不是当前阶段（state.stage = ${stageLabel}）的` +
            `执行者，**而且它也派不到那个执行者**（所以不是一次层级协调），所以这次校验` +
            `**没有意见**——不是它查过了没问题。两种可能：state.stage 停在旧阶段没推进，` +
            `那样 H5 会对整个新阶段全程哑火；或者这次派发本身不该发生。去 run 目录核实。` +
            `⚠️ **不要靠把 state.stage 改回旧阶段来消掉这条**——那正好制造前一种失效。`
        notices.push(notice)
      }
      // 账本比对：不管上面那条哑火告警发不发，只要三个清单有一个非空就并进同一条——
      // 见上面 driftNotice 计算处的注释。emitLedger 空数组时天然不写 stdout，两条
      // 告警都不适用时这里保持原来的完全沉默。账本比对不受这条静默表约束（docs/11
      // §5.8）：它审的是产物内容对不对得上账，跟阶段有没有推进是两件独立的事。
      if (driftNotice) notices.push(driftNotice)
      emitLedger(spec.event, notices)
      process.exit(0)
    }

    if (CHECK === 'stop-gate') {
      // H5b：真拦截。必须走 SubagentStop 契约（exit 2 + stderr），不是
      // PreToolUse 那套 permissionDecision JSON——U5 实测（docs/07 §1）拦住
      // subagent 停止靠的就是 exit 2，在这个事件上发 permissionDecision
      // 形状等于「平台不认 + exit 0」＝静默放行，H5b 会变成一个看起来健康
      // 的空操作。denyAndExit 按事件分派输出契约，永不返回，这里不需要、
      // 也不应该在它之后再写 process.exit。
      denyAndExit(r.reason, spec.event)
    } else {
      // H5a：权威记录。不 block，只把事实留在会话里——不能被误读成"子代理正常返回
      // =这一段已经完成"。写完直接落到本函数末尾共用的 process.exit(0)，不需要在
      // 这里另写一次。
      //
      // ⚠️ 解释「为什么会这样」那一整段来自 ./lib/retry-budget.mjs 的
      // SUBAGENT_STOP_RETRY_NOTE，**不要在这里把它的计数写成字面量**：那个计数不是
      // 常数（本仓库的几次观测彼此不等，数法也不同），而且同一份知识此前在八句话里
      // 各写了一份。判据见 tests/retry-budget-single-source.test.mjs，它会拦住第二份。
      //
      // ⚠️ M3k：**这个模板上一版自己写着「SubagentStop 已经尝试拦截过，但」，
      // 而那句话在异步派发下是假的**——H5a 挂在 PostToolUse:Agent 上，那个事件在
      // 子代理刚被启动那一刻就跑完了，那一刻 SubagentStop 一次都还没发生过
      // （实测 docs/20 §7.10：告警 00:12:53、产物落盘 00:15:20）。
      // 上一版这段注释开头写的理由（「因为 H5b 到点会被平台静默放行，父级看到的是
      // 干净的一次通过」）**是同一个归因的另一份**：它只覆盖同步那一种。
      // 两种情形各自为什么都不足以放心，现在由那个常量一并说清；收口 docs/11 §5.33。
      const notices = [
        `⚠️ 交付物校验：${role} 在 ${r.stageId} 应当产出 ${r.missing.join('、')}，` +
          `但磁盘上还没有。${SUBAGENT_STOP_RETRY_NOTE}` +
          `。不要仅凭"子代理正常返回"就判断这一段已经完成，去 run 目录核实产物是否存在。`,
      ]
      // 交付物本身还缺产物时，账本比对一样并进同一条——它审计的是全部阶段的
      // produces，不只是刚被判定缺失的这一段（比如更早的阶段被 Bash 绕过写过）。
      if (driftNotice) notices.push(driftNotice)
      emitLedger(spec.event, notices)
    }
  }

  process.exit(0)
}

// gate.mjs 现在是纯粹的可执行入口，不再被任何测试或模块 import——
// KNOWN_CHECKS/CHECKS 已经拆到 ./lib/checks.mjs，需要它们的测试从那里 import。
// 因此这里不需要「我是不是被当作 hook 直接执行」的守卫，main() 无条件跑。
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
  // CHECK 此刻按理已经通过 main() 顶部的 KNOWN_CHECKS 校验，spec 应该总是存在；
  // 万一不存在（防御性兜底），按最严格的 fail closed 处理，安全边界优先于精确。
  if (!spec || spec.failClosed) {
    denyAndExit(`agent-team 门禁异常，按安全边界拒绝：${err.message}`, event)
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
  process.stderr.write(crashNotice(CHECK, err))
  process.exit(0)
}
