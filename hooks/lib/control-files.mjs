// 控制文件：编排层自己的账本，不是任何阶段的产物。
//
// 这份清单是**单一真源**（docs/09-M1b-入口决策.md 账一「实现约束」第 1 条）：
// hooks/lib/writepath.mjs、templates/、commands/ 都不许再各写一遍。
//
// 这条约束现在由两条测试对账，两条都从这里 import CONTROL_FILES，不在 templates/
// 或 commands/ 里另写一份字面量清单：
// - tests/commands.test.mjs 的「命令正文里出现的每个 .agent-team 路径都是控制文件或
//   run 目录下的产物」（Task 9）——这条会真感知 CONTROL_FILES 的改动：改名、增删都会
//   让命令正文里对应的路径引用重新落到「合法/不合法」的判定上。
// - tests/templates.test.mjs 的「模板里不得再抄一份控制文件清单」（Task 8）——这条
//   抓的是另一种更窄的形状：「同一个模板文件里并列抄了 ≥2 个控制文件名」，不是对
//   CONTROL_FILES 改动本身的通用对账，清单改名/增删大多数情况下不会让它变色。
//
// 为什么控制文件不走「角色认领产物」那套判据（完整论证见 docs/09 账一，这里只记
// 要点）：被 settings.json 钉成主线程的 at-pm 不是 callerOf 判定的 MAIN，稳态下它
// 是一个受完整 per-role 隔离约束的普通角色，写不了 state.json——而 §4.2 ③ 的计数、
// /at-resume、/at-init 都要它写。反过来把整个 .agent-team/ 放给 PM 又太宽：PM 会
// 因此能在 run 目录下凭空造出 01-prd.md，而 artifactExists 在 runDir 下解析、H2 拿
// 它当前置产物的判据，H2 的判据就此可伪造。分两类之后，PM 的运维动作不走角色认领，
// H2 的判据对所有角色（含 PM）继续不可伪造。
//
// 它比「给 state.json 单开一条例外」准的地方在于：这是一个**闭集合且可枚举**的
// 概念，不是一条没有判据来源的例外。
import { norm } from './path-norm.mjs'

// 相对 .agent-team/ 的路径模式。`*` 恰好匹配**一个**路径段，不跨分隔符——
// runs/*/state.json 要匹配任意 run 的状态文件（不只是当前那个：一个角色去写别的
// run 的 state.json 同样是在动编排层的账本），但不能匹配 runs/r1/x/state.json
// 那种更深的路径。
export const CONTROL_FILES = [
  'current-run',
  'project.json',
  'reach.json',
  'runs/*/state.json',
]

function matchesPattern(relSegments, pattern) {
  const pat = pattern.split('/')
  if (relSegments.length !== pat.length) return false
  return pat.every((seg, i) => (seg === '*' ? relSegments[i].length > 0 : seg === relSegments[i]))
}

export function isControlFile(filePath, agentTeamDir) {
  if (typeof filePath !== 'string' || !filePath) return false
  if (typeof agentTeamDir !== 'string' || !agentTeamDir) return false
  // 两边都过 norm：它会先 resolve（所以 ../ 穿越不出去，比对的是解析后的绝对路径
  // 而不是原始字符串），并在 win32 上折成小写。上面 CONTROL_FILES 的字面量全部是
  // 小写，两个平台上都对得齐。
  const base = norm(agentTeamDir)
  const target = norm(filePath)
  if (!target.startsWith(`${base}/`)) return false
  const rel = target.slice(base.length + 1).split('/')
  return CONTROL_FILES.some((p) => matchesPattern(rel, p))
}


/**
 * 路径最后一段规范化之后的名字：剥掉流后缀（冒号之后的部分）与结尾的点、空格，转小写——Windows 上这些写法落盘时指向的
 * 是同一个文件。mayBeStateFile 与 mayBeGateFile、isGateFile 共用这一份（M3z，docs/34 的 P5：门禁专属文件还不存在时，
 * `approvals.jsonl::$DATA` 的字面末段与 norm() 给的末段都认不出它，Node 往这个路径写建出来的正是 approvals.jsonl）。
 */
export function leafName(filePath) {
  if (typeof filePath !== 'string' || !filePath) return ''
  return filePath.split(/[\\/]/).pop().split(':')[0].replace(/[. ]+$/, '').toLowerCase()
}

/**
 * 这条路径的最后一段可能就是某个 run 的 state.json 吗——按名字判，不管在哪个目录下。
 * 给 H6 用（M3q，docs/25）：门禁认不出的写法（网络路径、流后缀、结尾带点……）拿 norm() 比不出
 * 是不是 state.json，只能看名字。先剥掉流后缀与结尾的点、空格，再看是 state.json，或者像它的
 * 8.3 短名（带 ~ 且扩展名是 .JSO）。宁可多认：多认只是多拦一次认不出的写法。
 */
export function mayBeStateFile(filePath) {
  const leaf = leafName(filePath)
  return leaf === 'state.json' || (leaf.includes('~') && leaf.endsWith('.jso'))
}

// ——— 门禁专属文件（M3z，docs/34，全量审查第 16 条）———
//
// 门禁自己写、任何人的 Edit/Write/NotebookEdit 都拒，PM 与主线程也拒（hooks/gate.mjs 的 writepath 分支，排在主线程豁免之前，
// 与门禁自检同一个位置）。它们不是控制文件：控制文件是 PM 记的账，这两份是门禁记的账——
//   - runs/*/approvals.jsonl：用户批准的返工轮（hooks/lib/budget.mjs）。PM 写得进它，就能给自己批第 4 轮；
//   - runs/*/delivered.json：交付快照（hooks/lib/redo.mjs）。改得了它，不记回退的重做就拦不住。
// Bash 照样写得进（与 state.json 同一档：那是一次需要刻意去做的伪造，不是顺手绕过）。
//   - runs/*/dispatches.jsonl（M4d，docs/38，全量审查第 19 条）：派发记录——H5a 记团队角色的每一次派发（谁、哪一段、谁派的、前台还是后台），
//     H5b 每拦一回记一行。完成核验（UserPromptSubmit）靠它把完成通知对回角色与段、认出「平台静默放行」。改得了它，完成核验就会核错人、
//     说错成因（只是说错，不放行任何东西）。
export const GATE_FILES = ['runs/*/approvals.jsonl', 'runs/*/delivered.json', 'runs/*/dispatches.jsonl']
export const APPROVALS_FILE = 'approvals.jsonl'
export const DELIVERED_FILE = 'delivered.json'
export const DISPATCHES_FILE = 'dispatches.jsonl'

/** 按规范化之后的字面末段认：门禁认不出的写法（流后缀、结尾带点）也认——gate.mjs 拿它决定要不要先查 exoticPath。不认 8.3 短名：
 * 短名只在文件已经存在时才有，那时 isGateFile 经 norm() 的 realpath 认得出，而 gate.mjs 对每一次写入都调 isGateFile（复核 platform-1：
 * 上一版只在这里命中时才调它，短名、末段是 `.` 的写法都从这一筛漏过去）。照抄 mayBeStateFile 的 `~` 规则会把 state.json 的短名
 * 也当成它。 */
export function mayBeGateFile(filePath) {
  const leaf = leafName(filePath)
  return leaf === APPROVALS_FILE || leaf === DELIVERED_FILE || leaf === DISPATCHES_FILE
}

/** 任何项目的 .agent-team/runs/<id>/ 下的门禁专属文件——按路径形状认，不只认门禁这一刻认的项目根：写别的项目的批准记录
 * 同样是伪造。路径先过 norm()（解析 ..、软链接，Windows 上折小写），末段再过 leafName。 */
export function isGateFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false
  const segs = norm(filePath).split('/')
  if (segs.length < 4) return false
  const [dot, runs, id, leaf] = segs.slice(-4)
  if (dot.toLowerCase() !== '.agent-team' || runs.toLowerCase() !== 'runs' || !id) return false
  return GATE_FILES.some((p) => matchesPattern(['runs', id, leafName(leaf)], p))
}
