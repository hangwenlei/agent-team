// H5 交付物校验（纯函数）。不碰文件系统——artifactExists 由调用方注入，
// 这样它能脱离 Claude Code 与磁盘单测（跟 hooks/lib/readiness.mjs 的
// decideReadiness 是同一个理由）。
//
// 同一份判定喂两条 hook：
//   H5b（SubagentStop）拿它做真拦截，把角色顶回去补产物；
//   H5a（PostToolUse）拿它记权威 warning。
// 两道缺一不可——平台对 SubagentStop 的重试有上限，到点会静默放行且父级无感，
// 单靠 H5b 会在平台放弃那一刻制造一个假的「一次通过」信号。
//
// ⚠️ M3k（2026-09-21）：上面这条理由**只覆盖同步派发那一种**，而它是本文件唯一
// 说明「为什么要两道」的一句。**异步派发下两道根本不在同一个时刻**：H5a 挂的
// PostToolUse:Agent 在子代理刚被启动那一刻就跑完了（实测 docs/20 §7.10：告警
// 00:12:53、产物落盘 00:15:20；时刻表 docs/18 §3.6），那一刻 H5b 还一次都没跑过。
// 所以异步下「缺一不可」的理由更强、也更简单：**H5b 那一刻还不存在**，
// 而父级此时看到的「干净的一次通过」压根不是一次通过，是一次启动成功。
// ⚠️ 这条注释**不重复那份认知状态**（异步是不是唯一、同步量到过几次）——
// 单一真源是 docs/11 §5.33；发给用户的那段文案在 ./retry-budget.mjs。
// ⚠️ **这里不写它到底顶多少下，那个计数的单一真源是 ./retry-budget.mjs**
// （它是一个可配置的默认值，源码与几次观测逐条在那里）。此前这句话连同同一份知识
// 在八句话、六个文件里各写了一份，其中五句用的是中文数字、词形扫不到
// （docs/16 §3.4 的实物，逐句在 docs/11 §5.29）。判据：
// tests/retry-budget-single-source.test.mjs。
// 失败策略见规格 §6：H5 两道都是流程辅助、fail open，不做安全边界。
//
// 【M1b 改】这个函数此前与 decideReadiness 共用同一条迭代规则——「取该角色第一个
// produces 未齐的阶段」。那条规则对 H2 问的问题（「它接下来要做哪一段」）当时被认为是对的
// （⚠️ M3w 订正，docs/31：对 H2 也不对，H2 现在先按派发者收窄候选段，见 ./readiness.mjs），
// 对 H5 问的问题（「它刚做完的那一段交付了吗」）是错的：多阶段角色做完前一段之后，
// H5 会拿下一段的缺失产物把这一段顶回去，顶到平台放弃为止（计数见 ./retry-budget.mjs，
// 不在这里写）——一路纯噪音的拦截，还会把 H5b 唯一的重试预算消耗光。
// 现在改成由调用方把阶段 id 传进来
// （gate.mjs 传 ctx.state.stage），不再自己猜。
//
// ⚠️ 这条修复引入的新失效形状：state.stage 停在旧阶段时，这个函数会对新阶段的角色
// 返回 { ok: true, skipped: 'role-not-in-stage' }——不是放行，是**哑掉**，而哑掉和
// 「通过了」在会话里长得一模一样（docs/08 §0 说的正是这种形状）。所以 skipped 必须
// 带出去：gate.mjs 的 H5a 在这种情形下发 warning，ledger 在当前阶段产物齐了时提示
// 推进阶段。两条对策缺一不可，改这里之前先读它们。
//
// 【M2a 补】S5 的 produces 是 `<role>` 模式（`["05-impl/<role>.md"]`），单一真源见
// hooks/lib/stages.mjs 头部。（下面这段写于 Task 4，当时归属判据还是 `stage.role !== role`，
// 所以原话是「走到这里的 role 必然等于 stage.role」——**Task 9 把归属判据改成
// `stageRoles(stage).includes(role)` 之后这句不再成立**：走到这里的 role 是 producers
// 里的任意一个。下面的分析不受影响，expandProduces(stage, [role]) 本来就是按「这一个
// 已经匹配上的角色」展开的。）但 `stage.produces` 本身仍然是那份**字面量**（含占位
// 符，不是展开过的路径），如果直接拿它去问 artifactExists，永远问的是字面意义上
// 名叫 "05-impl/<role>.md" 的文件，这个文件不可能存在。后果：H5b 会把 at-backend
// 永久拦在 S5 完不成的状态（stop-gate 一律 exit 2），H5a 永远报"缺 05-impl/<role>.md"
// ——跟磁盘上是否真的写出了 05-impl/at-backend.md 完全无关。这不是"多一个产者没被
// 照顾到"的边界情形，是**这一次被判的那个角色**（Task 4 当时那必然是 stage.role 本人）
// 自己的交付也判不对，S5 本身就完不成。brief/设计文档都没提到这处
// 必须跟着 stages.json 的 <role> 模式一起改的地方，是 Task 4 落地时发现并补上的。
// 用 expandProduces(stage, [role]) 只展开这一个已经匹配上的角色，不展开 producers
// 里的其它人。
//
// ⚠️ M2b Task 4 改（2026-09-20）：这里原来接着写「那些人走的是上面的 role-not-in-stage
// 分支，本函数不对他们表态」——**那句话在本段开头那条更正之后就不成立了**。Task 9 之后
// producers 里的每一个各自返回时都会通过归属判据、各自被判一次，各自展开各自那一份
// 05-impl/<自己>.md。「一次调用只展开一个角色」是真的，「其它 producers 走
// role-not-in-stage」是假的——上一版把两者写成了同一句话。
//
// 值得单独记一笔的是它是怎么活下来的：**本段开头刚更正过「走到这里的 role 必然等于
// stage.role」，而同一个旧模型的第二句就活在那条更正下面**——更正只作用到了它逐字点名
// 的那一句上，同一个说法在同一段注释里活过了自己的更正（stages.README.md 那一侧有逐字
// 同族的一份，已一并改掉）。这与 docs/11 §3「错的注释活得比代码久」是同一族，但更难
// 发现：这一份的隔壁就摆着正确的说法。
//
// 真正走 role-not-in-stage 的是**不在 producers 里**的角色——at-architect 在 S5 是派发
// 发起者、不是产者，tests/deliverable.test.mjs 的「S5 多产者：不在 producers 里的角色
// 仍然是 role-not-in-stage」那条钉着这一侧。
// （H5 的静默集合另见 gate.mjs 的 isCoordinatorFor 与 stages.README.md。）
// ⚠️ M2b 终审 B2（2026-09-20）：**紧挨着上面那段的这一行，就是上面那段诊断的东西本身。**
// 它原来写的是「对没有 producers 的单产者阶段（S1–S4、S6–S8），expandProduces 对不含
// <role> 的条目原样保留一次，逐字等价于原来的 stage.produces，这条改动对它们是零行为
// 差异」——**对 S2 三句全假**：M2b 把 S2 改成了 producers: ["at-product","at-ui"] + 对象
// 形式的 produces，它既不是单产者、producers 也不缺省、更不「逐字等价于原来的
// stage.produces」。而 S2 就在那句话枚举的「S1–S4」里面。
//
// 上面那段是 Task 4 自己写的，写的就是「更正只作用到了它逐字点名的那一句上，同一个说法
// 在同一段注释里活过了自己的更正」——**然后把紧接着下一行的失效枚举原封不动留着**。
// 本分支该形状的第六次复演，发生在诊断该形状的那段注释里。测试侧其实知道
// （tests/fixtures/make-run.mjs、tests/gate-deliverable.test.mjs、
// tests/gate-readiness.test.mjs 的注释都写着「S2 从单产者阶段改成对象形式的多产者
// 阶段」），只有文档和注释没跟。
//
// 改成**按条件说，不枚举阶段号**（枚举会在下一次改形状时再假一次，条件不会）：
// 对**没有 producers 的阶段**，expandProduces 走数组分支、对不含 <role> 的条目原样保留
// 一次，结果逐字等于 stage.produces 本身——这条改动对那些阶段是零行为差异
// （tests/deliverable.test.mjs 现有各条据此必须仍然全绿，不改签名）。
// 哪些阶段属于这一类，去 stages.json 看，不要在这里抄一份清单。
import { expandProduces, isRolePatternStage, stageRoles } from './stages.mjs'
import { VERIFY_REDO_SELF, splitByAccept } from './freshness.mjs'

// 「这个阶段 id 在不在阶段链里」。M3v（docs/30）起门禁自检的追加句与 unknown-stage 的修法（hooks/lib/fail-open.mjs）也要
// 问同一个问题，抽成一份：它们说「不在阶段链里」的时候，必须正是这里判 skipped:'unknown-stage' 的时候。
export function isKnownStage(stages, stageId) {
  return (
    !!stages && typeof stages === 'object' && typeof stageId === 'string' && Object.hasOwn(stages, stageId) &&
    !!stages[stageId]
  )
}

// M4c（docs/37，全量审查第 18 条）：冒泡的出口。各角色正文叫它们「契约有问题、缺输入、写入被拒就冒泡，不要自己改了继续写」，
// 拒绝文案也许诺「把理由写进你的回报，由上级判断」——可 H5b 从不认这条出口，照做的子代理每次停下都被顶回去，顶到平台的
// 续跑上限（真实会话 066acaaa）。现在门禁认一个固定的形状：已经被拦过一回（SubagentStop 输入的 stop_hook_active 为真），而且
// 最后一条回复（last_assistant_message）的第一个非空行以 BUBBLE_MARK 开头，就放它停下。
//   - 要 stop_hook_active：第一回停下一定先被拦、先看到缺的是什么——忘了写的会去写，真要冒泡的原样再停一回（拒绝文案这么教）。
//     它不专属本插件（别家的 SubagentStop 拦过、CLI 自己的收尾强制也会把它置真），那时第一回就带着标记的也直接放行——标记是
//     子代理自己写的，门禁核不了真假，放行它也造不出进度：产物照旧算没交。
//   - 只认第一个非空行，容许常见的包装：行首的 Markdown 装饰（#、>、*、_、`、-）、编号、照抄下来的「、【，「冒泡」两个字
//     本身加粗（**冒泡**：）、冒号前的空白与半角冒号。夹在正文里的不认；「冒泡排序」这种不带冒号的不认（docs/37 §3 的复核）。
//   - 冒泡不改「交没交」：这里只决定 H5b 放不放它停下。下一段的前置（H2）与收口照常判缺，【阶段】不说齐了；但推进本身
//     不核缺产物（第 17 条）——不在任何前置里的那几份（02-*、03-alignment.md、05-impl/*），冒泡之后照样能被推进过去，
//     与原来顶到平台上限被静默放行是同一个洞（docs/37 §5），靠 PM 读回复。父级那一侧不加机制——同步派发时工具结果、
//     异步派发时完成通知里就是这条回复的原文（docs/37 §1），读它的是正文（/agent-team:at 第 3 节「核实」）。
export const BUBBLE_MARK = '冒泡：'
const BUBBLE_HEAD = new RegExp(`^[\\s#>*_\`\\-「【]*(?:\\d+[.)、]\\s*)?${BUBBLE_MARK.slice(0, -1)}[\\s*_\`」】]*[：:]`)

// 拒绝文案里教这个出口的那几句（缺/空与还旧两支共用；单一真源，判据从这里取）。不写任何次数：重试上限的计数只准在
// ./retry-budget.mjs 里（tests/retry-budget-single-source.test.mjs）。
// 复核（docs/37 §3）：「写入被拒」不在冒泡的理由里——执行段被写路径隔离拒了的，正文要它把被拒写进实现记录那一节
// （执行段的拒绝文案另点出这一条，见 IMPL_DENIAL_NOTE）。「原样再停一次」会被读成「什么都不改再停」，改成说清再发什么。
export const BUBBLE_WHEN = '确实交不出来、要上级定的（契约有问题、缺输入）'
export const BUBBLE_EXIT =
  `就不写：把你最后一条回复的第一行写成「${BUBBLE_MARK}<一句话理由>」，下面写清缺什么、要上级定什么，再停下` +
  '——门禁认这一行、放你停下；这一段的产物照旧算没交，上级读你的回复来定。已经这样写过、又被拦回来的，把那条回复原样再发一遍' +
  `再停下（第一行仍是「${BUBBLE_MARK}…」），只回一句「已冒泡」不算。`
const IMPL_DENIAL_NOTE = '被写路径隔离拒了的，照你的正文把被拒的路径与拒绝原文写进实现记录的「被写路径隔离拒绝」一节——写了就能停。'

export function isBubbleStop({ stopHookActive, lastMessage } = {}) {
  if (stopHookActive !== true || typeof lastMessage !== 'string') return false
  const first = lastMessage.split('\n').find((line) => line.trim() !== '')
  return first !== undefined && BUBBLE_HEAD.test(first)
}

// M3y（docs/33，全量审查第 15 条）：调用方把 artifactExists 换成 freshness 的 artifactCurrent（在、而且不是上一轮的），另传
// artifactStale（返工轮里还是上一轮的：磁盘内容与回退那一刻记的 sha 相同）。「缺」与「还是上一轮的」分开报——出口不一样：
// 上一轮那份这一轮核过、不用改，可以在末尾追加一节写明，内容一变就算这一轮的。没有上一轮的产物时，文案与 v1.6.0 逐字相同。
// M4a 文档核对（docs/35）：artifactBlank（空文件：归一化之后去掉空白什么都不剩）单列成 blank，说「是空文件」，不混进「还没有写到磁盘上」。
export function decideDeliverable({ role, stageId, stages, artifactExists, artifactStale = () => false, artifactBlank = () => false }) {
  if (!stages || typeof stages !== 'object') return { ok: true, skipped: 'unknown-stage' }

  const stage = isKnownStage(stages, stageId) ? stages[stageId] : null
  // stageId 来自 state.json 的 stage 字段。查不到只有两种成因：state.json 缺字段，
  // 或者它指向一个 stages.json 里不存在的阶段——两者都是「门禁认不出该查哪一段」，
  // 不是「这个角色没有交付义务」。H5 是 fail open，所以不表态；但要把原因带出去，
  // 让 gate.mjs 能把它和「角色确实没义务」区分开。
  if (!stage) return { ok: true, skipped: 'unknown-stage' }

  // 这个角色不是当前阶段的执行者。同样不表态，但同样要带出原因：
  // 「派了一个在当前阶段没有交付义务的角色」本身是一件值得看一眼的事，而且它也是
  // 「state.stage 停在旧阶段」这个失效的表征——见 gate.mjs 的 H5a 分支。
  // M2a Task 9 实测发现：这里原本写的是 `stage.role !== role`（单数 role），而 S5 自 Task 4
  // 起是**多产者**阶段（producers: at-backend/at-frontend/at-ui/at-ios/at-android）。
  // 后果有两条，都不是理论推演：
  //   1. H5 **从不检查** at-frontend/at-ui/at-ios/at-android 在 S5 的交付物——它们是合法
  //      产者，却在这里就被判成「没有交付义务」直接跳过，下面那段 expandProduces
  //      对它们永远走不到
  //   2. H5a 会对它们发一条**假告警**：「刚返回的 X 不是当前阶段的执行者，而且它也派不到
  //      那个执行者」——第二句在拓扑上是真的（它们 reachableRoles 为空），但结论是错的，
  //      它们本来就该在这一段产出
  // Task 4 修了 produces 的展开（下面那行 expandProduces），漏了这道归属判据——与
  // 规格 §4 注记里记的「消费方不是四个是八个」同一族，这是第九处。
  if (!stageRoles(stage).includes(role)) return { ok: true, skipped: 'role-not-in-stage' }

  const produces = expandProduces(stage, [role])
  const stale = produces.filter((p) => artifactStale(p))
  const blank = produces.filter((p) => !stale.includes(p) && artifactBlank(p))
  const missing = produces.filter((p) => !artifactExists(p) && !stale.includes(p) && !blank.includes(p))
  // produces 为空时 missing 必然也是空数组（filter 空数组恒得空数组），这一条顺带
  // 覆盖了「这个阶段没有产物义务」，不需要单独判 produces.length === 0——那样会多出
  // 一层两条分支永远同时成立或同时不成立的判断，删掉任何一层都测不出行为差异
  // （Task 5 的教训：变异测试要能证明每一层都必要）。
  if (missing.length === 0 && stale.length === 0 && blank.length === 0) return { ok: true }
  const denial = isRolePatternStage(stage) ? IMPL_DENIAL_NOTE : ''
  const gone = [missing.length ? `${missing.join('、')} 还没有写到磁盘上` : '', blank.length ? `${blank.join('、')} 是空文件` : '']
    .filter(Boolean)
    .join('，')

  if (stale.length === 0) {
    return {
      ok: false,
      stageId,
      missing,
      blank,
      stale,
      reason:
        `${role} 在 ${stageId} 应当产出 ${produces.join('、')}，但 ${gone}。` +
        `在结束之前把它写出来。${denial}${BUBBLE_WHEN}，${BUBBLE_EXIT}`,
    }
  }

  const notWritten = gone ? `${gone}，` : ''
  // M4a（docs/35）：验证段的产物（测试报告、验收报告、交付报告）不给「核过、不用改就追加一节」这条路——问题 B 里那正是
  // 「at-qa 不重测、追加一句就过」。它们只给「重跑之后重写」（freshness.mjs 的 VERIFY_REDO）。
  const { accept, redo } = splitByAccept(stages, stale)
  const html = accept.some((p) => p.endsWith('.html')) ? '（.html 文件用 <!-- --> 注释写这一节）' : ''
  const appendOut = accept.length
    ? `${redo.length ? `${accept.join('、')} ` : ''}这一轮核过、确实不用改的，在它末尾追加一节，写明这一轮核过什么、为什么不用改${html}；`
    : ''
  const redoOut = redo.length ? `${redo.join('、')}：${VERIFY_REDO_SELF}。` : ''
  return {
    ok: false,
    stageId,
    missing,
    blank,
    stale,
    reason:
      `${role} 在 ${stageId} 应当产出 ${produces.join('、')}，但 ${notWritten}${stale.join('、')} 还是上一轮的——这是返工轮，` +
      `它的内容与回退那一刻磁盘上的一样。在结束之前把这一轮的写出来。${redoOut}${appendOut}` +
      `${denial}${BUBBLE_WHEN}，或者这一段确实不需要产出、不该由你改的，${BUBBLE_EXIT}`,
  }
}
