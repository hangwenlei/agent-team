// 门禁自检（M3t，docs/28，全量审查第 4 条）。
//
// 门禁全是 command hook。hook 起不来——PATH 上没有 node、Node 旧到入口都解析不了、Claude Code
// 早于 2.1.139 丢掉 args、hooks 被关掉——平台一律放行，不拦任何调用；错误也不进模型的上下文。
// 用户那边最多是对应调用下面几行灰字（缺 node 时每道只在第一次出现，hooks 被关掉时一个字都没有）。
// PM 自己察觉不到门禁没在跑。
//
// 所以反过来查：PM 用 Write 写 GATE_CHECK_PATH，门禁在线时 H3 对它一律拒，理由里带着
// GATE_CHECK_ONLINE；写入成功就说明门禁没在跑。健康与不健康都是模型一定看得见的工具结果，
// 不需要它去注意「少了一条回传」。协议正文只在 agents/at-pm.md 的「门禁自检」一节。
//
// ⚠️ 它不是控制文件。CONTROL_FILES 的语义是「只有 PM 能写」，这里是「谁都不许写」。
import { resolve, sep } from 'node:path'
import { norm } from './path-norm.mjs'
import { inline } from './trusted.mjs'

export const GATE_CHECK_PATH = '.agent-team/gate-check'
export const GATE_CHECK_ONLINE = 'agent-team 门禁自检：在线'

const [DIR, LEAF] = GATE_CHECK_PATH.split('/')

/**
 * 末两段恰好是 .agent-team/gate-check（不分大小写）才算，字面路径与物理路径任一命中都行：
 *   - 字面：resolve() 之后按本平台的分隔符切，不碰文件系统。.agent-team 是指向别名目录的链接时，
 *     物理路径的末两段不是它——只认物理路径的话，门禁好好的，自检却永远拿不到「在线」（M3t 复核）。
 *     POSIX 上反斜杠不是分隔符，`.agent-team\gate-check` 是一个字面名字的文件，不算。
 *   - 物理：norm()，经别的链接写到 .agent-team 里的也认得。
 * 不锚定项目根：用户 /cd 到别的目录再跑 /at-init 时，门禁认的项目根未必是那里，那边也还没有
 * .agent-team。匹配过宽也不行：被误认的正当写入会收到「预期的拒绝」，悄悄丢掉。
 */
export function isGateCheck(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false
  return endsWithGateCheck(resolve(filePath).split(sep)) || endsWithGateCheck(norm(filePath).split('/'))
}

function endsWithGateCheck(parts) {
  const segs = parts.filter(Boolean).map((s) => s.toLowerCase())
  return segs.length >= 2 && segs[segs.length - 2] === DIR && segs[segs.length - 1] === LEAF
}

/**
 * 自检写入的拒绝理由：固定串打头，给人看的一句，门禁用的 node（门禁自己取，过 inline），再是这个结果的
 * 有效期——复核实测，续会话之后没有提醒时，PM 会拿上一个进程的「在线」对用户说自检通过（0/4）；
 * 理由里写明只管这一轮之后 4/4 重新自检（docs/28 §3）。
 */
export function gateCheckReason({ version = process.version, execPath = process.execPath } = {}) {
  return (
    `${GATE_CHECK_ONLINE}——这条被拦下的写入是自检的预期结果，不是故障。` +
    `门禁用的 node 是 ${inline(version)}（${inline(execPath)}）。` +
    '这个结果只管到这一轮用户消息结束：之后的每一轮——包括用户说「继续」、续会话之后——在第一次派发或写 ' +
    '.agent-team 之前都要重新自检，不能引用这一条。接着往下做。'
  )
}

// 自检提醒（hooks/hooks.json 的 UserPromptSubmit）：每轮往上下文里放一句，让 PM 在这一轮第一次派发
// 或写 .agent-team 之前自检——续会话之后直接说「继续」、压缩之后接着跑，都不经过任何命令。它故意不走
// node（shell 形式的一行 echo），好在 node 缺失时照样出现；Claude Code 早于 2.1.139 时，只在它把 args
// 当未知键丢掉的那一支成立（推断，docs/28 §1）。纯 ASCII：Windows 没有
// Git Bash 时 shell 形式退到 PowerShell 5.1，中文会乱码；不含单引号：整句靠单引号括住。
export const REMINDER_EVENT = 'UserPromptSubmit'
export const REMINDER_TEXT =
  'agent-team reminder: before the first Agent dispatch or the first write under .agent-team in this turn, ' +
  'run the gate self-check from your role file. Earlier results do not count: this session may have been ' +
  'resumed in another process.'
export const REMINDER_COMMAND = `echo '${REMINDER_TEXT}'`
