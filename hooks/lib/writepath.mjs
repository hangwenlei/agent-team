// H3 写路径隔离（纯函数）。
//
// ⚠️ 已知边界（规格 §6.2）：这道闸只管 Edit/Write/NotebookEdit。
// 执行角色保留 Bash 以跑构建与测试，而 Bash 能写文件（echo >、sed -i），
// 那条路不在本函数的覆盖范围内，README 已明示本插件不是沙箱。
// 评审三轮 Important 1 定下的大小写/分隔符归一化，现在是 hooks/lib/path-norm.mjs
// 里的公共实现——H3 与 H4 必须用同一份（整理项 5：两边判错的方向相反，
// 各留一份的代价不对称，理由写在那个文件的头部）。
import { norm, underDir } from './path-norm.mjs'
import { isControlFile } from './control-files.mjs'
import { isContractWriter } from './contract-guard.mjs'
import { stageRoles, expandProduces } from './stages.mjs'

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

// M2a：run 目录下的合法写入集与"这条路径归谁"曾经分别由 producesOf（只按
// s.role === role 字面量比对，不认识 <role> 占位符）与 stageOwnerOfRunPath 各自
// 回答（评审三轮 Important 2 引入 producesOf 时如此）。producers/<role> 模式落地
// 后 producesOf 会对每一个 S5 产者——**包括 s.role 本身的 at-backend**——恒答
// "不是我的"：它拿字面量 05-impl/<role>.md 去比已经展开过的目标路径，永远比不出
// 相等。这不是一条没触发到的边界，是 H3 从此拒绝任何人写 S5 的实现记录，M2a 想
// 解决的那个缺口（docs/11 §5.6）会以另一种方式原样卡住。删掉 producesOf，
// "是不是我的"与"是谁的"现在统一由 stageOwnerOfRunPath 回答——它已经按 <role>
// 展开到具体产者，owner.role === role 即为"我的"，不留第二套判据（hooks/lib/
// deliverable.mjs 的 decideDeliverable 有同一场缺口的姊妹修法，理由写在那边）。

// 反查一个 run 目录下的目标路径是不是某个阶段的 produces、产物归谁——
// 用于给拒绝理由点名"这条路径其实是谁的、哪个阶段的产物"，跟
// hooks/lib/readiness.mjs 的 producerOf 是同一种反查手法，但这里要连
// stageId 一起带出去。
//
// 导出（评审发现 4）：hooks/gate.mjs 的 ledger 分支（CHECK === 'ledger'）要回答的是
// 同一个问题——"这次写的 run 目录下的路径，是不是某个阶段的 produces、该按哪个名字
// 回传哈希"——此前在那里内联写了一份逐字符相同的双层循环。两份拷贝分叉的代价不对称：
// 若某一份哪天停止认出某条路径、另一份仍然认得，sha 就会漏回传给 PM，该产物永远落在
// H5a 账本比对的 unrecorded 清单里，变成设计 §1.3 明确要消灭的「恒假告警」（这正是
// hooks/lib/path-norm.mjs 头部记的那类重复分叉，本轮复评又当场抓到一次同族复演）。
// 现在只留这一份，gate.mjs 从这里 import。
//
// M2a：<role> 逐个角色展开，返回的 role 是**匹配上的那个具体产者**，不是 s.role。
// H3 要回答的是「这条路径归谁」，S5 的 05-impl/at-frontend.md 归 at-frontend，
// 不归 s.role（at-backend）。单产者阶段没有 producers，stageRoles 退回 [s.role]，
// 这条对 S1–S4/S6–S8 是逐字不变的行为——expandProduces 对不含 <role> 的条目原样
// 保留一次，不随 roles 列表长度变化。
export function stageOwnerOfRunPath(stages, rd, target) {
  if (!stages || typeof stages !== 'object') return null
  for (const [stageId, s] of Object.entries(stages)) {
    for (const role of stageRoles(s)) {
      for (const p of expandProduces(s, [role])) {
        if (norm(`${rd}/${p}`) === target) return { stageId, role, produces: p }
      }
    }
  }
  return null
}

export function decideWritePath({ role, filePath, project, runDir, stages, agentTeamDir }) {
  if (typeof filePath !== 'string' || !filePath) return { decision: 'allow' }

  const target = norm(filePath)

  // docs/09 账一（规格 §6.2.1）：控制文件与阶段产物是两类东西，判据不同。
  // 这一段必须排在下面 run 目录那块**之前**，也必须排在再下面 project.paths 那段
  // 之前——两头的既有判据对控制文件都是错的，而且错的方向相反：
  //   - runs/<id>/state.json 在 runDir 里，落到下面那块会被「不是你这个阶段的
  //     produces」**无条件**拒掉，连 PM 也拒（M1a 记的 I3 死锁）；
  //   - .agent-team/project.json 与 current-run 不在 runDir 里，落到 project.paths
  //     那段会因为 Object.hasOwn(owners, role) 早退而被**静默放行**——任何不在 paths
  //     里登记的角色都能重写项目配置。
  // 一个太紧、一个太松，所以这不是「在某一段里加个 if」能解决的，必须自成一段。
  //
  // 「谁算 PM」复用 isContractWriter，不另写一遍 role === 'at-pm'：M1a 评审在 H4
  // 那里已经因为同一个谓词写两份开过一轮循环，结论是抽成单一导出。它内部走
  // callerOf，MAIN（'__main__'）与裸 'at-pm' 都返回 true；这条豁免的安全性依赖
  // 「没有角色能把 at-pm 当派发目标」这条花名册不变量，由
  // tests/roster-closure.test.mjs 钉住，完整论证在 contract-guard.mjs 头部。
  //
  // agentTeamDir 缺省时这一段整体不触发，回落到既有行为——纯函数不该假设调用方
  // 一定传全参数，而 gate.mjs 那条路径上它总是来自 ctx.agentTeamDir。
  if (isControlFile(filePath, agentTeamDir)) {
    if (isContractWriter(role)) return { decision: 'allow' }
    return {
      decision: 'deny',
      reason:
        `${role} 不得写 ${filePath}——这是编排层的控制文件（run 指针、项目配置、` +
        `触达表、运行状态），只有 PM（项目经理）能写。控制文件不是任何阶段的产物，` +
        `不参与角色认领：流程状态该由编排层记账，不该由执行角色自己改。你如果认为` +
        `流程状态不对（比如阶段该推进了、返工计数不对），把它冒泡给上级，由 PM 落盘。`,
    }
  }

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
    // 评审 I-2：这条判定与 hooks/gate.mjs 的 ledger 分支曾经各写一份逐字符相同的
    // 拷贝，现在都用 hooks/lib/path-norm.mjs 的 underDir，传原始的 filePath/runDir
    // （不是这里已经算好的 target/rd）——underDir 自己会 norm，调用方不用先算
    // 一遍再传，两边不用记着保持"谁传原始值、谁传 norm 过的值"这条约定。rd 仍然
    // 保留：下面拼产物路径（norm(`${rd}/${p}`)）要用到它。
    if (underDir(filePath, runDir)) {
      // 评审三轮 Important 2：旧版本这里对整个 run 目录一律放行，注释说的
      // 是"自己那份"，代码做的是"任何一份"——两者不是取舍，是代码没实现
      // 它自己声明的意图。真实后果：runctx.mjs 的 artifactExists 就是在
      // runDir 下解析的，gate.mjs 把它交给 H2 就绪门禁当前置产物的判据；
      // 如果角色能在 run 目录下随便写，就能凭空伪造出别人阶段的产物去
      // 满足 H2 的 requires，H2 的判据变成可伪造的。state.json 更直接是
      // H4/H5 的状态来源，且它本来就不是"流程产物"。收紧成：只放行调用者
      // 自己名下的 produces（stageOwnerOfRunPath 找到的 owner.role === role），
      // run 目录下其余一切（别人的产物、state.json、任何非产物文件）一律 deny。
      //
      // 控制文件（state.json 等）已经在函数顶部单独处理过，走不到这里——见那一段的
      // 注释与 docs/09 账一。这里剩下的是纯粹的阶段产物判定。
      // 「同一角色的多个阶段 produces 都能写」（at-pm 的 S1/S4）是这块唯一一直正确
      // 的行为，tests/writepath.test.mjs 与 tests/gate-writepath.test.mjs 各钉了一
      // 条，不要丢——stageOwnerOfRunPath 对 target 逐阶段逐产者匹配，at-pm 在 S1
      // 与 S4 各命中一次，owner.role === 'at-pm' 两次都成立。
      //
      // M2a：「是不是我的」与「是谁的」现在都由 stageOwnerOfRunPath 一次回答（上面
      // 函数头部的注释记了删掉 producesOf 的理由：它对 <role> 模式的产物恒答"不是
      // 我的"，会把 at-backend 自己也拒在 S5 的实现记录门外）。
      const owner = stageOwnerOfRunPath(stages, rd, target)
      if (owner) {
        if (owner.role === role) return { decision: 'allow' }
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
