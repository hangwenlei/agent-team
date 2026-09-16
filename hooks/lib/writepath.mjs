// H3 写路径隔离（纯函数）。
//
// ⚠️ 已知边界（规格 §6.2）：这道闸只管 Edit/Write/NotebookEdit。
// 执行角色保留 Bash 以跑构建与测试，而 Bash 能写文件（echo >、sed -i），
// 那条路不在本函数的覆盖范围内，README 已明示本插件不是沙箱。
import { resolve, sep } from 'node:path'

function norm(p) {
  // 归一化并统一分隔符，防止 .. 与斜杠差异绕过前缀比对。
  const resolved = resolve(p).split(sep).join('/')
  // 评审三轮 Important 1：Windows 文件系统大小写不敏感，但 resolve() 保留
  // 调用方给的原始大小写，而 base 的盘符来自 process.cwd()——两者不同源，
  // 大小写可能对不齐（C:\proj\... vs c:\proj\...，或 SRC vs src）。不统一
  // 大小写会把同一个文件误判成不同路径，方向是误 deny（把自己人挡在
  // 外面），而且拒绝理由会说"没有被任何角色认领"——这是一句错误指控，
  // 路径明明认领了，只是大小写没对齐，会把排查方向带偏到 project.json。
  // POSIX 文件系统大小写敏感，不能对它也做这个转换，否则会在真正大小写
  // 不同的两个文件之间造出误判（这条判断本身不需要测：分支只在
  // win32 触发，POSIX 上这行代码根本不会跑到）。
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function underAny(target, prefixes, base) {
  // 评审三轮 Minor 3：prefixes 理论上总是数组（project.paths 的值），但
  // project.json 是用户手写的配置文件，形状不该指望它总是对的——不是数组
  // 时 .some 会抛 TypeError，外层 try/catch 兜得住（fail closed）但用户
  // 看到的是一句不知所云的"prefixes.some is not a function"，而不是指向
  // 真正问题（project.json 配置形状不对）的消息。这里防一层，调用方
  // （decideWritePath 自己的 owners[role] 那次查找）另外给出更具体的理由。
  if (!Array.isArray(prefixes)) return false
  return prefixes.some((prefix) => {
    const full = norm(`${base}/${prefix}`)
    const dir = full.endsWith('/') ? full : `${full}/`
    return target === full || target.startsWith(dir)
  })
}

// 评审三轮 Important 2：run 目录下的合法写入集是"调用者自己阶段的
// produces"，不是"run 目录下任何东西"——见 decideWritePath 里的用法注释。
function producesOf(stages, role) {
  if (!stages || typeof stages !== 'object') return []
  const out = []
  for (const s of Object.values(stages)) {
    if (s && s.role === role && Array.isArray(s.produces)) out.push(...s.produces)
  }
  return out
}

// 反查一个 run 目录下的目标路径是不是某个阶段的 produces、产物归谁——
// 用于给拒绝理由点名"这条路径其实是谁的、哪个阶段的产物"，跟
// hooks/lib/readiness.mjs 的 producerOf 是同一种反查手法，但这里要连
// stageId 一起带出去。
function stageOwnerOfRunPath(stages, rd, target) {
  if (!stages || typeof stages !== 'object') return null
  for (const [stageId, s] of Object.entries(stages)) {
    if (!s || !Array.isArray(s.produces)) continue
    for (const p of s.produces) {
      if (norm(`${rd}/${p}`) === target) return { stageId, role: s.role, produces: p }
    }
  }
  return null
}

export function decideWritePath({ role, filePath, project, runDir, stages }) {
  if (!project || typeof project !== 'object' || !project.paths) return { decision: 'allow' }
  if (typeof filePath !== 'string' || !filePath) return { decision: 'allow' }

  const target = norm(filePath)

  if (runDir) {
    const rd = norm(runDir)
    if (target === rd || target.startsWith(`${rd}/`)) {
      // 评审三轮 Important 2：旧版本这里对整个 run 目录一律放行，注释说的
      // 是"自己那份"，代码做的是"任何一份"——两者不是取舍，是代码没实现
      // 它自己声明的意图。真实后果：runctx.mjs 的 artifactExists 就是在
      // runDir 下解析的，gate.mjs 把它交给 H2 就绪门禁当前置产物的判据；
      // 如果角色能在 run 目录下随便写，就能凭空伪造出别人阶段的产物去
      // 满足 H2 的 requires，H2 的判据变成可伪造的。state.json 更直接是
      // H4/H5 的状态来源，且它本来就不是"流程产物"。收紧成：只放行调用者
      // 自己阶段（stages[s].role === role）的 produces，run 目录下其余
      // 一切（别人的产物、state.json、任何非产物文件）一律 deny。
      const mine = producesOf(stages, role).some((p) => norm(`${rd}/${p}`) === target)
      if (mine) return { decision: 'allow' }

      const owner = stageOwnerOfRunPath(stages, rd, target)
      if (owner) {
        return {
          decision: 'deny',
          reason:
            `${role} 不得写 ${filePath}——这是 ${owner.stageId} 的产物（${owner.produces}），` +
            `归 ${owner.role}。跨角色的改动要经上级协调，不要直接动别人的地盘。`,
        }
      }
      return {
        decision: 'deny',
        reason:
          `${role} 不得写 ${filePath}——run 目录下只有自己阶段的产物可写，这条路径不是任何` +
          `阶段的 produces（比如运行状态文件 state.json 就不是流程产物，不能被角色直接改）。`,
      }
    }
  }

  const owners = project.paths
  if (!Object.hasOwn(owners, role)) return { decision: 'allow' }

  // 评审三轮 Minor 3：owners[role] 不是数组（比如手误写成字符串或 null）
  // 时提前给出指向 project.json 本身的理由，不要落到 underAny 的防御性
  // false 上——那样会落到"没人认领"的通用理由，掩盖了真正的配置错误。
  const myPaths = owners[role]
  if (!Array.isArray(myPaths)) {
    return {
      decision: 'deny',
      reason:
        `${role} 不得写 ${filePath}——.agent-team/project.json 里 paths.${role} 不是数组` +
        `（是 ${JSON.stringify(myPaths)}），这是配置错误，不是这次调用的问题。`,
    }
  }

  // project.paths 的值是相对项目根的前缀；项目根由 runDir 往上推三级得到
  // （.agent-team/runs/<id> → 项目根），没有 runDir 时退回用 filePath 的根。
  const base = runDir ? norm(`${runDir}/../../..`) : '/'

  if (underAny(target, myPaths, base)) return { decision: 'allow' }

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
