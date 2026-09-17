// 控制文件：编排层自己的账本，不是任何阶段的产物。
//
// 这份清单是**单一真源**（docs/09-M1b-入口决策.md 账一「实现约束」第 1 条）：
// hooks/lib/writepath.mjs、templates/、commands/ 都不许再各写一遍。
//
// ⚠️ 这条约束目前**没有任何测试在守**——templates/ 与 commands/ 还不存在（属 Task 8
// 与 Task 9）。落地它们时必须同时加上拿这里的 CONTROL_FILES 去对账的测试
// （tests/templates.test.mjs 的「模板里不得再抄一份控制文件清单」、
// tests/commands.test.mjs 的「命令正文里出现的每个 .agent-team 路径都是控制文件或
// run 目录下的产物」）。在那之前，「只有一处真源」靠的是别处还没写，不是靠机制。
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
