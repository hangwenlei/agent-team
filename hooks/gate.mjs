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
import { denyOutput } from './lib/deny.mjs'
import { readRunContext } from './lib/runctx.mjs'
import { decideReadiness } from './lib/readiness.mjs'
import { decideWritePath } from './lib/writepath.mjs'
import { decideContractGuard, isContractWriter } from './lib/contract-guard.mjs'
import { decideDeliverable } from './lib/deliverable.mjs'

const CHECK = process.argv[2]
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
// 门禁读的运行状态在**用户项目**里，不在插件目录里。
// hook 以用户项目为 cwd 运行，所以用 process.cwd()；
// 插件自身的文件（roster.json、stages.json）仍用 ROOT。
const ROOT_PROJECT = process.cwd()

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
function isValidInput(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}

function loadRoster() {
  return JSON.parse(readFileSync(join(ROOT, 'roster.json'), 'utf8'))
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

function main() {
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
      // Edit/Write；agents/at-pm.md 的工具面没有 Bash，规格 §6.2 那条「Bash 是
      // 软约束」的逃生口对 PM 不存在；触发条件又很廉价（project.json /
      // state.json 坏了、current-run 被截断成空文件，任意一条即可）。三点叠起来
      // 就是把插件唯一的运维人锁在门外，只能由用户离开 Claude 手工改文件——
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

    const r = decideDeliverable({ role, stages: ctx.stages, artifactExists: ctx.artifactExists })
    if (r.ok) process.exit(0)

    if (CHECK === 'stop-gate') {
      // H5b：真拦截。必须走 SubagentStop 契约（exit 2 + stderr），不是
      // PreToolUse 那套 permissionDecision JSON——U5 实测（docs/07 §1）拦住
      // subagent 停止靠的就是 exit 2，在这个事件上发 permissionDecision
      // 形状等于「平台不认 + exit 0」＝静默放行，H5b 会变成一个看起来健康
      // 的空操作。denyAndExit 按事件分派输出契约，永不返回，这里不需要、
      // 也不应该在它之后再写 process.exit。
      denyAndExit(r.reason, spec.event)
    } else {
      // H5a：权威记录。不 block，只把事实留在会话里——因为 H5b 到点会被
      // 平台静默放行，父级看到的是干净的一次通过，中间发生过的拦截不留
      // 任何痕迹。这条 warning 就是那个不能丢的痕迹：不能被误读成"子代理
      // 正常返回=这一段已经完成"。写完直接落到本函数末尾共用的
      // process.exit(0)，不需要在这里另写一次。
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: spec.event,
            additionalContext:
              `⚠️ agent-team 交付物校验：${role} 在 ${r.stageId} 应当产出 ${r.missing.join('、')}，` +
              `但磁盘上还没有。SubagentStop 已经尝试拦截过，但平台的重试有上限（约 9 次），到点会` +
              `静默放行——不要仅凭"子代理正常返回"就判断这一段已经完成，去 run 目录核实产物是否存在。`,
          },
        }),
      )
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
  process.exit(0)
}
