// H3 写路径隔离（判定函数：不读 stdin、不写输出、不退出进程；路径经 path-norm 的 norm() 解析到物理位置，会读文件系统——M3q）。
//
// ⚠️ 已知边界（规格 §6.2）：这道闸只管 Edit/Write/NotebookEdit。
// 执行角色保留 Bash 以跑构建与测试，而 Bash 能写文件（echo >、sed -i），
// 那条路不在本函数的覆盖范围内，README 已明示本插件不是沙箱。
// 评审三轮 Important 1 定下的大小写/分隔符归一化，现在是 hooks/lib/path-norm.mjs
// 里的公共实现——H3 与 H4 必须用同一份（整理项 5：两边判错的方向相反，
// 各留一份的代价不对称，理由写在那个文件的头部）。
import { dirname, resolve } from 'node:path'
import { exoticPath, norm, underDir } from './path-norm.mjs'
import { isControlFile } from './control-files.mjs'
import { isContractWriter } from './contract-guard.mjs'
import { stageRoles, expandProduces, isPlainObject, isStageChain } from './stages.mjs'
// 拒绝理由会被模型读到；角色名（hook 输入的 agent_type）、路径（tool_input）、project.json 的键与值
// 一律过 inline / quote（M3s，docs/27）。
import { inline, quote } from './trusted.mjs'
import { NO_PATHS_ROLES, entryProblems, usablePrefixes } from './project.mjs'
import { exemptFromPaths, isValidRoster } from './decide.mjs'

// 一个角色在阶段链上自己那几份产物（第 2 步的拒绝理由点名它，M4f 复核，docs/41 §8）。阶段链读不出、链上没有它：答空，理由泛说
// 「自己那份产物」。产物名来自插件自己的 stages.json，原样写进理由。
function ownProductsOf(stages, role) {
  if (!isStageChain(stages)) return []
  const out = []
  for (const id of Object.keys(stages)) if (stageRoles(stages[id]).includes(role)) out.push(...expandProduces(stages[id], [role]))
  return out
}

function underAny(target, prefixes, base) {
  // 评审三轮 Minor 3：prefixes 理论上总是数组（project.paths 的值），但
  // project.json 是用户手写的配置文件，形状不该指望它总是对的——不是数组
  // 时 .some 会抛 TypeError，外层 try/catch 兜得住（fail closed）但用户
  // 看到的是一句不知所云的"prefixes.some is not a function"，而不是指向
  // 真正问题（project.json 配置形状不对）的消息。这里防一层。M3u（docs/29）起
  // decideWritePath 这边已经走不到它：第 8 步的 entryProblems 先拒掉值不是数组的
  // 条目并给出具体的理由，认领者查找先过 usablePrefixes（总是数组）。
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
// 不归 s.role（at-backend）。**没有 producers 的阶段** stageRoles 退回 [s.role]，
// 这条对它们是逐字不变的行为——expandProduces 对不含 <role> 的条目原样保留一次，
// 不随 roles 列表长度变化。
//
// ⚠️ M2b 终审 B2（2026-09-20）：上面那句原来写的是「单产者阶段没有 producers……这条对
// **S1–S4/S6–S8** 是逐字不变的行为」——**假**。M2b 把 S2 改成了多产者阶段
// （producers: ["at-product","at-ui"] + 对象形式 produces），而 S2 就在枚举的「S1–S4」
// 里面：`stageRoles(S2)` 今天返回两个人，`expandProduces` 走的是对象分支。
// 改成按条件说、不枚举阶段号——哪些阶段没有 producers 去 stages.json 看。
// 同族的另外三处（deliverable.mjs / artifact-drift.mjs / state.mjs）一并改了。
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

export function decideWritePath({ role, filePath, project, runDir, stages, agentTeamDir, roster }) {
  if (typeof filePath !== 'string' || !filePath) return { decision: 'allow' }
  const who = inline(role)
  const fp = inline(filePath)

  // M3q（docs/25）：解析不了的写法（流后缀、结尾带点或空格、项目不在网络共享上却写网络路径）
  // 排在一切比对之前拒掉——下面的每一条判据都要先认出「这是哪个文件」，而这些写法认不出来，
  // 落到哪一条都可能是放行。排在 norm() 之前还因为网络路径不能碰：norm 会去 lstat 它。
  const projectRoot = agentTeamDir ? dirname(agentTeamDir) : runDir ? resolve(runDir, '..', '..', '..') : null
  const exotic = exoticPath(filePath, projectRoot)
  if (exotic) {
    return {
      decision: 'deny',
      reason: `${who} 不得写 ${fp}——${exotic}。请用项目里普通的本地绝对路径。`,
    }
  }

  const target = norm(filePath)

  // docs/09 账一（规格 §6.2.1）：控制文件与阶段产物是两类东西，判据不同。
  // 这一段必须排在下面 run 目录那块**之前**，也必须排在再下面 project.paths 那段
  // 之前——两头的既有判据对控制文件都是错的，而且错的方向相反：
  //   - runs/<id>/state.json 在 runDir 里，落到下面那块会被「不是你这个阶段的
  //     produces」**无条件**拒掉，连 PM 也拒（M1a 记的 I3 死锁）；
  //   - .agent-team/project.json 与 current-run 不在 runDir 里，落到下面按角色隔离那段时，
  //     花名册外的调用者会被**静默放行**——它能重写项目配置（M4f 之前还有没有键的 at-qa、
  //     at-acceptance，docs/41；M3u 之前是任何不在 paths 里登记的角色，docs/29）。
  // 一个太紧、一个太松，所以这不是「在某一段里加个 if」能解决的，必须自成一段。
  //
  // 「谁算 PM」复用 isContractWriter，不另写一遍 role === 'at-pm'：M1a 评审在 H4
  // 那里已经因为同一个谓词写两份开过一轮循环，结论是抽成单一导出。它内部走
  // callerOf，MAIN（'__main__'）与 at-pm（带不带插件前缀）都返回 true；这条豁免的安全性依赖
  // 「没有角色能把 at-pm 当派发目标」这条花名册不变量，由
  // tests/roster-closure.test.mjs 钉住，完整论证在 contract-guard.mjs 头部。
  //
  // agentTeamDir 缺省时这一段整体不触发，回落到既有行为——导出的判定函数不该假设
  // 调用方一定传全参数，而 gate.mjs 那条路径上它总是来自 ctx.agentTeamDir。
  if (isControlFile(filePath, agentTeamDir)) {
    if (isContractWriter(role)) return { decision: 'allow' }
    return {
      decision: 'deny',
      reason:
        `${who} 不得写 ${fp}——这是编排层的控制文件（run 指针、项目配置、` +
        `触达表、运行状态），只有 PM（项目经理）能写。控制文件不是任何阶段的产物，` +
        `不参与角色认领：流程状态该由编排层记账，不该由执行角色自己改。你如果认为` +
        `流程状态不对（比如阶段该推进了、返工计数不对），把它冒泡给上级，由 PM 落盘。`,
    }
  }

  // 全分支评审 I1：下面这整块 run 目录保护必须排在按角色隔离那段之前。它只依赖
  // runDir 与 stages，跟 project.paths 没有任何关系——而旧版本
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
  // M3u（docs/29）起排序照样要紧，理由换了：按角色隔离那段对 PM、花名册外的调用者放行，对没有键的
  // at-qa/at-acceptance（M4f 起，docs/41）与 project.json 不在的情形拒——排到这块前面，run 里别人的产物
  // 就能被 PM 写到，at-qa、at-acceptance 与执行角色自己的产物反而被拒。
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
            `${who} 不得写 ${fp}——这是 ${owner.stageId} 的产物（${owner.produces}），` +
            `归 ${owner.role}。跨角色的改动要经上级协调，不要直接动别人的地盘。`,
        }
      }
      return {
        decision: 'deny',
        reason:
          `${who} 不得写 ${fp}——run 目录下只有自己阶段的产物可写，这条路径不是任何` +
          `阶段的 produces（比如运行状态文件 state.json 就不是流程产物，不能被角色直接改）。`,
      }
    }
  }

  // 以下是 run 目录之外的按角色隔离，判据是 .agent-team/project.json 的 paths（M3u，docs/29，全量审查第 10 条）。
  // 此前只要 project.json 是个合法对象，调用者在 paths 里「没有键」就放行——paths 缺失、键名拼错、带插件前缀、
  // 被删掉、run 进行中整份文件不在，效果都是按角色隔离静默全开。现在逐步判；形状问题只让本检查项看，不把整趟
  // run 判成读不出来（那样 H2、H5 会跟着一起降级，一个键名拼错就让交付物校验停摆）。
  //
  // 1. PM 不参与路径认领：放行（给 at-pm 错建了键时这个键不起作用，ledger 会报）。判断与触达表的 unrestricted 共用
  //    decide.mjs 的 exemptFromPaths（M4f，审查第 27 条）。
  if (exemptFromPaths(role)) return { decision: 'allow' }

  // 2. 按设计不认领路径的角色（at-qa、at-acceptance）没有键时：run 目录之外一律拒，不看 project.json 其余部分——它们只写 run 目录里
  //    自己那份产物（M4f，docs/41，审查第 34 条）。原来这一步整段放行：能写 CLAUDE.md、.claude/、插件自己的门禁代码，也能改别人认领的
  //    实现代码与测试（at-qa 发现缺测试顺手自己写，就是这一格）。拒绝理由不提 paths、不提键：对正想写别人代码的角色说怎么开口子，
  //    等于告诉它怎么绕过去。出路是把问题照实写进它自己那份产物的结论、不用冒泡（M4f 复核）：at-qa 的正文说缺测试判「不通过：
  //    缺测试」、不冒泡，理由若叫它冒泡，它就会不交 06-test.md 停下，PM 当成产物没交，绕开那条路。
  const paths = project && typeof project === 'object' ? project.paths : undefined
  const pathsOk = isPlainObject(paths)
  if (NO_PATHS_ROLES.includes(role) && !(pathsOk && Object.hasOwn(paths, role))) {
    const own = ownProductsOf(stages, role).join('、')
    return {
      decision: 'deny',
      reason:
        `${who} 不得写 ${fp}——你只写 run 目录里自己那份${own ? ` ${own}` : '产物'}，run 目录之外的文件不是你的活。` +
        `要改实现、补测试或改配置的，不要自己动手：把看到的问题照实写进${own ? ` ${own} ` : '你那份产物'}的结论，不用为这个冒泡。`,
    }
  }

  // 3. 花名册读坏：判不出谁归不归本插件管。不能落成下一步的「不在花名册里就放行」——loadRoster 读坏时
  //    退回 {}，那样对所有人全开。H1 此时也拒一切派发。
  if (!isValidRoster(roster)) {
    return {
      decision: 'deny',
      reason:
        `${who} 不得写 ${fp}——roster.json 读不出来，门禁判不出你是不是本插件的角色，按安全边界拒绝。` +
        '插件安装可能不完整：冒泡给派你的上级，由 PM 告诉用户重装或更新 agent-team 插件。',
    }
  }

  // 4. 不在花名册里的调用者不归本插件管（H1 保证团队角色派不出花名册外的 agent）。
  if (!Object.hasOwn(roster, role)) return { decision: 'allow' }

  // 括注指向规则，不指向命令：PM 就地改 project.json 就行，不必让用户重跑 /agent-team:at-init。
  const fixIt = '这是配置问题，不是这次调用的问题：冒泡给派你的上级，由 PM 改 .agent-team/project.json（规则见 /agent-team:at-init 第 2 节）。'

  // 5. run 进行中而 project.json 不在：没有判据。
  if (!project) {
    return {
      decision: 'deny',
      reason: `${who} 不得写 ${fp}——run 进行中，但 .agent-team/project.json 不在，写路径隔离没有判据。${fixIt}`,
    }
  }

  // 6. paths 缺失或不是对象：同上。
  if (!pathsOk) {
    const what = paths === undefined ? '缺失' : `不是对象（是 ${quote(paths)}）`
    return {
      decision: 'deny',
      reason: `${who} 不得写 ${fp}——.agent-team/project.json 的 paths ${what}，写路径隔离没有判据。${fixIt}`,
    }
  }

  // 7. 调用者没有键：被删、从没写、键名拼错、带插件前缀，一律拒。认不出的键一并列出——多半是拼错的那一个。
  if (!Object.hasOwn(paths, role)) {
    const strays = Object.keys(paths).filter((k) => !Object.hasOwn(roster, k))
    const hint = strays.length ? `paths 里有这些认不出的键：${strays.map((k) => quote(k)).join('、')}——是不是拼错了？` : ''
    return {
      decision: 'deny',
      reason:
        `${who} 不得写 ${fp}——.agent-team/project.json 的 paths 里没有 ${who} 的键，run 目录之外它哪都写不了。` +
        `${hint}${fixIt}`,
    }
  }

  // project.paths 的值是相对项目根的前缀；项目根由 runDir 往上推三级得到
  // （.agent-team/runs/<id> → 项目根），没有 runDir 时退回用 filePath 的根。
  const base = runDir ? norm(`${runDir}/../../..`) : '/'
  // 问题按 audience: 'role' 取：只说问题本身，不带「删掉这一条……收尾时告诉用户」这类说给 PM 的改法——执行角色
  // 改不了 project.json、也见不到用户，它的出路是冒泡。
  const own = entryProblems(role, paths[role], { audience: 'role' })

  // 7b. 建了键的 at-qa、at-acceptance（M4b 第二轮复核，docs/36）：写在自己合法的前缀下照旧放行（判据钉着这一格）；别的
  //     一律说同一句——它不写 run 目录之外的文件，这次写入不是它的活，键本不该有、由 PM 删掉。原来这一格分三路说：第 8 步
  //     叫 PM「改 project.json」，「没人认领」那一支叫 PM「划给某个角色」，只有「归 X」那一支说键不该有——前两路都会把
  //     PM 引去往一个账本说「不要建」的键上加前缀。M4f 起删了键第 2 步照样拒；此前删键之后它整段放行，所以这里从来不说
  //     「删了之后就能写」——对正想写别人代码的 at-qa 说这句，等于告诉它怎么绕过去。
  if (NO_PATHS_ROLES.includes(role)) {
    if (!own.block.length && underAny(target, paths[role], base)) return { decision: 'allow' }
    return {
      decision: 'deny',
      reason:
        `${who} 不得写 ${fp}——你不写 run 目录之外的文件（只写自己那份 run 产物），这次写入不是你的活；` +
        '另外 .agent-team/project.json 的 paths 里不该有你的键（按设计不认领路径）：回报时提一句，由 PM 删掉它。',
    }
  }

  // 8. 调用者自己的条目有阻断问题（不是数组、元素不是字符串、前缀出根、认领整个根、带冒号）：只拒它——整条条目
  //    作废，连它其余合法的前缀也写不了。理由里说出来：实测只点一条前缀时，PM 会读成「只有这条前缀失效」而留着它。
  if (own.block.length) {
    return {
      decision: 'deny',
      reason:
        `${who} 不得写 ${fp}——.agent-team/project.json 里 ${own.block.slice(0, 3).join('；')}。` +
        `这让 ${who} 的整条 paths 条目作废，写它其余合法的前缀也被拒。${fixIt}`,
    }
  }

  const myPaths = paths[role]
  if (underAny(target, myPaths, base)) return { decision: 'allow' }

  // 认领者查找只看别人条目里合法的前缀：别人条目里一个坏元素不该把拒绝理由变成「门禁异常」。也只看 H3 会拿来判
  // 人的键（花名册里、不是 PM 与主线程）：说「这条路径归 at-pm」「归拼错的键」，是在叫执行角色去找一个不存在的主人
  // 协调。第 3 步已经保证走到这里时花名册有效。at-outsider 不排除：它是花名册里的真键、H3 照常判它；说「归
  // at-outsider」会把 PM 引到 project.json 里那个错键上（账本的要改档已经点名「不要给 at-outsider 建键」），排除它
  // 反倒会说成「没有被任何角色认领」，而配置里明明有人认领。
  // M4b（docs/36，审查第 21 条）：认领者列全——根级清单、构建配置、测试目录常常共列在几个执行角色名下（模板的
  // src/shared/ 就是这样写的），只点第一个，PM 会以为它只归一个角色。
  const claimants = Object.entries(paths)
    .filter(
      ([other, value]) =>
        other !== role &&
        Object.hasOwn(roster, other) &&
        other !== 'at-pm' &&
        other !== '__main__' &&
        underAny(target, usablePrefixes(value), base),
    )
    .map(([other]) => other)

  if (claimants.length) {
    // 出路按调用者分（M4b）。叶子执行角色（花名册里派不出任何人）：这份文件要是本来就该几个角色一起改，由 PM 在
    // paths 里共列。协调者（at-architect、at-product）不拿这句——它的正路是派给认领者（docs/09 的层级协调），照
    // 「列到你名下」做，PM 会把代码路径划给设计类角色，at-architect 的红线「不得替执行角色把代码写了」就只剩正文守着。
    // 第一轮复核（docs/36）补的几种边角：
    //   - 认领者按设计不该有键（NO_PATHS_ROLES、at-outsider：没有谁派得到它），或者它的条目整条作废（派它去写，它在第 8 步
    //     又被拒）——点明，出路是 PM 改配置，不叫协调者去派它；
    //   - 调用者自己是建了键的 at-qa、at-acceptance：第二轮复核挪到第 7b 步统一说，走不到这里；
    //   - 花名册里调用者那一条坏了：判不出它是叶子还是协调者，不给「列到你名下」；
    //   - 协调者那句不看阶段：架构师在 S3 出方案时派不了 S5 的产者（H2 拒），正路是写进落盘清单。
  // 第二轮复核：协调者那句只点名没被排除的认领者（不该有键、条目作废的不点——混着它们时「派给它」会被读成那一个；调用者
  // 自己派不到的，靠紧跟着的「派不到的，冒泡」兜住，不按 can_delegate_to 再筛）；调用者自己条目里
  // 「要改」档的前缀这一支也说出来（目标正好归别人时，PM 打开 project.json 会以为调用者已经列过了）。
    const entry = roster[role]
    const rosterOk = isPlainObject(entry) && Array.isArray(entry.can_delegate_to)
    const off = claimants.filter((c) => NO_PATHS_ROLES.includes(c) || c === 'at-outsider')
    const voided = claimants.filter((c) => !off.includes(c) && entryProblems(c, paths[c], { audience: 'role' }).block.length)
    const usable = claimants.filter((c) => !off.includes(c) && !voided.includes(c))
    const notes = []
    if (off.length) notes.push(`${off.map((c) => quote(c)).join('、')} 按设计不该有 paths 键——冒泡给派你的上级，由 PM 改 .agent-team/project.json`)
    if (voided.length) notes.push(`${voided.map((c) => quote(c)).join('、')} 的条目眼下整条作废——冒泡给派你的上级，由 PM 先修 .agent-team/project.json`)
    let way
    if (!rosterOk) {
      way = 'roster.json 里你这一条读不出来，门禁判不出该给你哪条出路：冒泡给派你的上级，由 PM 告诉用户重装或更新 agent-team 插件。'
    } else if (entry.can_delegate_to.length) {
      way = usable.length
        ? `这是认领者的活：到你分发它的那一段再派给 ${usable.map((c) => quote(c)).join(' 或 ')}（还在出方案的，把这件事写进你这一段的` +
          '产物交上去——架构师写进 03-arch.md 的「落盘清单」）；派不到的，冒泡给派你的上级。不要自己动它的文件。'
        : '不要自己动它的文件，冒泡给派你的上级。'
    } else {
      way =
        '跨角色的改动要经上级协调，不要直接动别人的地盘。这份文件要是本来就该几个角色一起改（根级清单、构建配置、' +
        '测试目录），冒泡给派你的上级，由 PM 在 .agent-team/project.json 的 paths 里把它也列到你名下（你写不了 project.json）。'
    }
    return {
      decision: 'deny',
      reason:
        `${who} 不得写 ${fp}——这条路径归 ${claimants.map((c) => quote(c)).join('、')}。` +
        `${notes.length ? `${notes.join('；')}。` : ''}` +
        (own.fix.length ? `你的条目里还有要改的：${own.fix.slice(0, 3).join('；')}。` : '') +
        way,
    }
  }

  return {
    decision: 'deny',
    reason:
      `${who} 不得写 ${fp}——这条路径在 .agent-team/project.json 里没有被任何角色认领` +
      // M4b：逐条引——整份数组只过一次 quote 会被截在 80 个字符，排在末尾的（正好是之后补进来的）被截掉。
      `（${who} 认领的是 ${myPaths.length ? myPaths.map((p) => quote(p)).join('、') : '[]（只写 run 目录）'}；` +
      '前缀按字面比较，不是通配符）。' +
      // 第一轮复核：自己条目里「要改」档的前缀（不可见格式字符、首尾空白、反斜杠）原样引出来，读着像「认领了却说没人认领」。
      (own.fix.length ? `你的条目里还有要改的：${own.fix.slice(0, 3).join('；')}。` : '') +
      // 落到这里的只可能是有键的执行角色，它写不了 project.json（控制文件）。不拼 fixIt：没人认领也可能是这次
      // 调用越界了，不一定是配置问题。
      '确实要写这里，冒泡给派你的上级，由 PM 决定要不要在 .agent-team/project.json 的 paths 里把它划给某个角色' +
      '（你写不了 project.json）。',
  }
}
