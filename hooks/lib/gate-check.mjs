// 门禁自检（M3t，docs/28，全量审查第 4 条）。
//
// 门禁全是 command hook。hook 起不来——PATH 上没有 node、Node 旧到入口都解析不了、Claude Code
// 早于 2.1.139 丢掉 args、hooks 被关掉——平台一律放行，不拦任何调用；错误也不进模型的上下文，
// 用户那边只有一行灰字，缺 node 时整个会话只报第一次。PM 自己察觉不到门禁没在跑。
//
// 所以反过来查：PM 用 Write 写 GATE_CHECK_PATH，门禁在线时 H3 对它一律拒，理由里带着
// GATE_CHECK_ONLINE；写入成功就说明门禁没在跑。健康与不健康都是模型一定看得见的工具结果，
// 不需要它去注意「少了一条回传」。协议正文只在 agents/at-pm.md 的「门禁自检」一节。
//
// ⚠️ 它不是控制文件。CONTROL_FILES 的语义是「只有 PM 能写」，这里是「谁都不许写」。
import { norm } from './path-norm.mjs'
import { inline } from './trusted.mjs'

export const GATE_CHECK_PATH = '.agent-team/gate-check'
export const GATE_CHECK_ONLINE = 'agent-team 门禁自检：在线'

const [DIR, LEAF] = GATE_CHECK_PATH.split('/')

/**
 * norm() 之后末两段恰好是 .agent-team/gate-check（不分大小写）才算。不锚定项目根：用户 /cd 到别的
 * 目录再跑 /at-init 时，门禁认的项目根未必是那里，那边也还没有 .agent-team——锚定项目根会让门禁
 * 好好的时候自检拿不到「在线」。匹配过宽也不行：被误认的正当写入会收到「预期的拒绝」，悄悄丢掉。
 */
export function isGateCheck(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false
  const segs = norm(filePath).toLowerCase().split('/').filter(Boolean)
  return segs.length >= 2 && segs[segs.length - 2] === DIR && segs[segs.length - 1] === LEAF
}

/** 自检写入的拒绝理由：固定串打头，给人看的一句，再是门禁用的 node（路径由门禁自己取，过 inline）。 */
export function gateCheckReason({ version = process.version, execPath = process.execPath } = {}) {
  return (
    `${GATE_CHECK_ONLINE}——这条被拦下的写入是自检的预期结果，不是故障。` +
    `门禁用的 node 是 ${inline(version)}（${inline(execPath)}）。接着往下做。`
  )
}

// 自检提醒（hooks/hooks.json 的 UserPromptSubmit）：每轮往上下文里放一句，让 PM 在这一轮第一次派发
// 或写 .agent-team 之前自检——续会话之后直接说「继续」、压缩之后接着跑，都不经过任何命令。它故意不走
// node（shell 形式的一行 echo），好在 node 缺失、Claude Code 太旧时照样出现。纯 ASCII：Windows 没有
// Git Bash 时 shell 形式退到 PowerShell 5.1，中文会乱码；不含单引号：整句靠单引号括住。
export const REMINDER_EVENT = 'UserPromptSubmit'
export const REMINDER_TEXT =
  'agent-team reminder: before the first Agent dispatch or the first write under .agent-team in this turn, ' +
  'run the gate self-check from your role file. Earlier results do not count: this session may have been ' +
  'resumed in another process.'
export const REMINDER_COMMAND = `echo '${REMINDER_TEXT}'`
