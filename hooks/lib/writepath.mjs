// H3 写路径隔离（纯函数）。
//
// ⚠️ 已知边界（规格 §6.2）：这道闸只管 Edit/Write/NotebookEdit。
// 执行角色保留 Bash 以跑构建与测试，而 Bash 能写文件（echo >、sed -i），
// 那条路不在本函数的覆盖范围内，README 已明示本插件不是沙箱。
import { resolve, sep } from 'node:path'

function norm(p) {
  // 归一化并统一分隔符，防止 .. 与大小写/斜杠差异绕过前缀比对。
  return resolve(p).split(sep).join('/')
}

function underAny(target, prefixes, base) {
  return prefixes.some((prefix) => {
    const full = norm(`${base}/${prefix}`)
    const dir = full.endsWith('/') ? full : `${full}/`
    return target === full || target.startsWith(dir)
  })
}

export function decideWritePath({ role, filePath, project, runDir }) {
  if (!project || typeof project !== 'object' || !project.paths) return { decision: 'allow' }
  if (typeof filePath !== 'string' || !filePath) return { decision: 'allow' }

  const target = norm(filePath)

  // 本趟 run 目录下的产物是流程产物不是代码，任何角色都可以写自己那份。
  if (runDir) {
    const rd = norm(runDir)
    if (target === rd || target.startsWith(`${rd}/`)) return { decision: 'allow' }
  }

  const owners = project.paths
  if (!Object.hasOwn(owners, role)) return { decision: 'allow' }

  // project.paths 的值是相对项目根的前缀；项目根由 runDir 往上推两级得到
  // （.agent-team/runs/<id> → 项目根），没有 runDir 时退回用 filePath 的根。
  const base = runDir ? norm(`${runDir}/../../..`) : '/'

  if (underAny(target, owners[role], base)) return { decision: 'allow' }

  const claimant = Object.entries(owners).find(
    ([other, prefixes]) => other !== role && underAny(target, prefixes, base),
  )

  if (claimant) {
    return {
      decision: 'deny',
      reason:
        `${role} 不得写 ${filePath}——这条路径归 ${claimant[0]}。` +
        `跨角色的改动要经上级协调，不要直接动别人的地盘。`,
    }
  }

  return {
    decision: 'deny',
    reason:
      `${role} 不得写 ${filePath}——这条路径在 .agent-team/project.json 里没有被任何角色认领。` +
      `先在 project.json 的 paths 里把它划给某个角色，再动它。`,
  }
}
