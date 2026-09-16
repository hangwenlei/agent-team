// H3 写路径隔离（纯函数）。
//
// ⚠️ 已知边界（规格 §6.2）：这道闸只管 Edit/Write/NotebookEdit。
// 执行角色保留 Bash 以跑构建与测试，而 Bash 能写文件（echo >、sed -i），
// 那条路不在本函数的覆盖范围内，README 已明示本插件不是沙箱。
// 评审三轮 Important 1 定下的大小写/分隔符归一化，现在是 hooks/lib/path-norm.mjs
// 里的公共实现——H3 与 H4 必须用同一份（整理项 5：两边判错的方向相反，
// 各留一份的代价不对称，理由写在那个文件的头部）。
import { norm } from './path-norm.mjs'

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
  if (typeof filePath !== 'string' || !filePath) return { decision: 'allow' }

  const target = norm(filePath)

  // 全分支评审 I1：下面这整块 run 目录保护必须排在 project.paths 的整体放行
  // 之前。它只依赖 runDir 与 stages，跟 project.paths 没有任何关系——而旧版本
  // 把 `!project.paths → allow` 写在函数第一行，等于把整块保护挂在
  // "project.json 存在"之上。hooks/lib/runctx.mjs 明确允许 project.json 不
  // 存在（返回 project: null 且 ctx.ok 为 true，见那里第 126 行），于是
  // "run 正在跑、project.json 不在"这个合法状态下，H3 是一个彻底的空操作：
  // 下面注释里论证的那套威胁模型（伪造别人阶段的产物去满足 H2 的 requires、
  // 直接改 H4/H5 的状态来源 state.json）一条都不成立。而当时"证明"这块收紧
  // 生效的五条测试全部带着 project: PROJECT，没有一条覆盖缺席路径——它们在
  // 证明一件自己没在守的事。缺席路径的覆盖见 tests/writepath.test.mjs 里
  // "project 为 null 时，run 目录下…"那三条，以及 tests/gate-contract.test.mjs
  // 的子进程级对照。
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
      //
      // ⚠️ 已知缺口 I3（全分支评审，M1a 不在这条分支上解决）：这条规则在稳态
      // 下会把 PM 自己也挡住。被 settings.json 钉成主线程的 at-pm 不是
      // callerOf 判定的 MAIN（M0 实测：钉住时主会话的 hook 输入带裸的
      // agent_type: 'at-pm'），所以一旦进入稳态（project.json 存在、run 正在
      // 跑），它就是一个受完整 per-role 隔离约束的普通角色。实测（用仓库根
      // 真实 stages.json，role 取 'at-pm'）：
      //
      //   at-pm 写 runs/<id>/state.json              -> deny（不是任何阶段的 produces）
      //   at-pm 写 runs/<id>/00-contract.md（S1）    -> allow
      //   at-pm 写 runs/<id>/04-dispatch.md（S4）    -> allow
      //   at-pm 重写 .agent-team/project.json        -> 看 project.paths 里有没有 at-pm 这个键：
      //                                                 有 -> deny（"没有被任何角色认领"）
      //                                                 没有 -> allow（Object.hasOwn 那条早退，
      //                                                 H3 根本不管这个角色）
      //
      // 其中 state.json 那条是无条件的，且 I1 之后连"project.json 不存在"都
      // 兜不住了（这不是 I1 引入的新语义，是 I1 让原本就该生效的规则真的生效
      // 之后，这个缺口才从"有条件"变成"总是"）。project.json 那条则取决于
      // /at-init 生成的 paths 里写不写 at-pm——两种写法都合理，所以这个缺口
      // 现在是"一半已经踩上、一半取决于模板怎么写"。
      //
      // 与规格冲突的是：§7 的 templates/ 明确列了 project.json 与
      // state.json；§4.5 要求"计数写在 state.json，不交给模型自己数"；
      // /at-resume 从 state.json 续跑；/at-init 重跑勘察要重写 project.json。
      // 这些动作在稳态下会被这道闸拒掉——而且 project.json 那条的拒绝理由会说
      // "这条路径在 .agent-team/project.json 里没有被任何角色认领"，是一句会把
      // 排查方向完全带偏的话：真正的问题不是认领表漏了一行，是"PM 的运维动作
      // 该不该走角色认领这套判据"从来没有被决定过。
      //
      // 现有的自举豁免盖不住这个缺口：它们只覆盖"第一个 run 建出来之前"
      // （ctx.kind === 'no-run'）、"真 MAIN（无 agent_type）"、以及 I2 新加的
      // "ctx 读不出来时的 PM"（hooks/gate.mjs 的 writepath 分支）——三者都是
      // 异常/空白态，稳态不在其中。
      //
      // 什么时候会撞上：计划 B 的第一次 state.json 写入（谁来记 rework 计数、
      // /at-resume 怎么落盘），那一刻这道闸会直接拦住主会话。
      // 两个可选方向，到时候择一（不要在 M1a 里顺手做，两者都要改判定模型）：
      //   (a) 给 .agent-team/ 一条独立于 project.paths 的"PM 专属可写"规则，
      //       让 PM 的运维动作不走角色认领这套判据；
      //   (b) 在 project.json 模板里把 .agent-team/ 划给 at-pm，并给
      //       run 目录下的 state.json 单开一条例外（因为它不是任何阶段的
      //       produces，走不通上面 mine 那条路）。
      // 其中"同一角色的多个阶段 produces 都能写"（上面 S1/S4 那两条 allow）是
      // 这块唯一已经正确的行为，由 tests/writepath.test.mjs 与
      // tests/gate-writepath.test.mjs 各钉了一条，改 producesOf 时不要丢。
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

  // 以下是 project.paths 的 per-role 隔离。判据只有一个来源：
  // .agent-team/project.json 的 paths。它不存在、或者存在但没有 paths 字段
  // 时，这一段没有任何可用的判据，不表态——但这条早退只跳过这一段，跳不过
  // 上面的 run 目录保护（全分支评审 I1：它曾经排在函数第一行，把两件事绑成
  // 了一件）。
  if (!project || typeof project !== 'object' || !project.paths) return { decision: 'allow' }

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
