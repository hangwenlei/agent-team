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
// 直接单测过三个分支——包括 SubagentStop 那条 exit 2 + stderr 分支，它在
// Task 6 给 stop-gate 接上判定逻辑之前，从这条路径永远不会被真实执行到
// （Task 1 二轮评审）。这里只做 I/O：拿到结果、写对应的流、退出，永不返回，
// 调用点之后不需要再写 exit。
function denyAndExit(reason, event) {
  const { stream, text, exitCode } = denyOutput(reason, event)
  process[stream].write(text)
  process.exit(exitCode)
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
      // Task 3 评审 Minor 4：原文案里"按规格 §6 fail open"是内部黑话，
      // 读到它的人手上未必有 §6；"本次放行，不拦截这次调用"又把同一件事
      // 说了两遍。改成只说一次「放行」，把省下的篇幅换成一句可执行的
      // 下一步——ctx.reason 的大多数取值本身就是 current-run/run 目录的
      // 问题（找不到、指向的 run 不存在、内容非法等），这是最先该查的地方。
      process.stderr.write(
        `agent-team H2 就绪门禁：读不到运行上下文（${ctx.reason}），本次放行、不拦截。` +
          `若你以为有进行中的 run，检查 .agent-team/current-run。\n`,
      )
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
    // Task 4 复审 2：ctx.ok 为 false 时不能笼统 fail closed——readRunContext
    // 用 ctx.kind 区分了两种性质完全不同的失败（定义见 hooks/lib/runctx.mjs
    // 头部注释）：
    //   'no-run'     压根没有进行中的 run。这不是「判不出来」，是门禁做出
    //                了一个有依据的判定："这次调用不归我管"——H3 的前提是
    //                「一个 run 正在跑，角色各自认领了地盘」，没有 run 就
    //                没有地盘。按 H2 的先例 fail open + stderr 留痕，不能
    //                静默（静默的放行和门禁坏掉长得一模一样）。不这样区分
    //                的话，建第一个 run 之前 .agent-team 还不存在，ctx.ok
    //                必然是 false；如果笼统 fail closed，从主线程（或被
    //                settings.json 钉成主线程的具名角色，比如 at-pm）写
    //                .agent-team/project.json 这个自举动作永远做不成，
    //                第一个 run 永远建不出来，门禁把自己锁在门外——这才是
    //                自举死锁真正的解法，上面的 MAIN 豁免只覆盖了"确实没有
    //                agent_type"这一种情形，覆盖不了被钉成具名角色的主线程。
    //   'unreadable' run 存在但读不出来（state.json/project.json 坏了、
    //                runId 含穿越字符等）。门禁真的判不出来，规格 §6 fail
    //                closed 说的是这种情形，继续拒绝。这条边界不能放松：
    //                一个被写坏的 project.json 必须继续落在这里，否则把
    //                project.json 写坏就成了绕过 H3 per-role 隔离的办法。
    if (!ctx.ok) {
      if (ctx.kind === 'no-run') {
        process.stderr.write(
          `agent-team H3 写路径门禁：当前没有进行中的 run（${ctx.reason}），本次放行、不拦截。` +
            `若你以为有进行中的 run，检查 .agent-team/current-run。\n`,
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
    // 只读 file_path 的话，每一次 NotebookEdit 调用都会拿到 undefined，
    // 命中 decideWritePath「没有可判定路径」那条分支而无条件放行——
    // checks.mjs 的 toolNames 把 NotebookEdit 列进 H3 的覆盖范围就白列了，
    // 这道闸对它会静默失效。两个字段互斥（同一次调用只会有其中一个），
    // 用 ?? 兜底取到真正存在的那个。
    const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path
    const r = decideWritePath({
      role,
      filePath,
      project: ctx.project,
      runDir: ctx.runDir,
    })
    if (r.decision === 'deny') denyAndExit(r.reason, spec.event)
  }

  // contract / deliverable / stop-gate 的判定分别在 Task 5–6 接入，
  // 此处先只做分派。

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
