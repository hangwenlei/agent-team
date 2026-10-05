// ledger：把 PM 算不出来的派生事实交回给 PM（纯函数，只负责格式化）。
//
// ⚠️ 这**不是门禁**。它永不拒绝、fail open，规格 §6 的五道闸一条没变。
// docs/09 账二明确说过不加第六道闸，这条不违反它：它不拦任何东西，只让本来看不见
// 的东西可见。
//
// 为什么这些计算放在 hook 侧而不是让 PM 自己跑脚本：at-pm.md 的 tools: 行就是整个
// 会话的能力上界（规格 §3.3.1，U4/U7/docs04 §9 ③ 三次观测），给 PM Bash 等于替 M1c
// 把整棵子树的上界开了，而且会经 §6.2「Bash 是软约束」那个口子推翻 docs/09 账一
// #2（PM 就能 echo > 01-prd.md 伪造 H2 的判据）。更根本的一条：hook 一定会触发，
// 脚本要靠 PM 记得跑——这与 §4.2 ② 把就绪门禁写成 hook 而不是提示词是同一条理由。
// ⚠️ 订正（M4b，docs/36）：「tools: 行就是整个会话的能力上界」在工具这一维不成立——P4 实测，主线程的 tools: 只封顶
// 派发宇宙，子代理拿的是自己清单里的工具。PM 后来也拿到了 Bash（M1c），M4b 裁定保留，理由是跑构建与测试（docs/36 §2.9）。「hook 一定会触发」那一条照旧。
//
// 本模块只做格式化，一切 I/O 在 gate.mjs 里；判据本身来自这些纯函数模块：contract-hash.mjs、
// reach.mjs、state.mjs、project.mjs。
import { compareContractSha, shaOrNote } from './contract-hash.mjs'
import { inline, quote, safeJson } from './trusted.mjs'
import { nextStage } from './state.mjs'
import { approvalTargetFor, askUserText, limitOf } from './budget.mjs'
import { isPlainObject, isStageChain, productsOfStage, stageRoles, isRolePatternStage } from './stages.mjs'
import { VERIFY_REDO, splitByAccept } from './freshness.mjs'
import { closedAt, blockerLine } from './closing.mjs'

// 「这个动作只能由 PM 执行、非 PM 请回报上级」——stageDone 与 produce 两个分支都要
// 说这句话：推进/收口 state.stage 与把哈希写进 artifacts，改的都是同一份控制文件
// （runs/*/state.json），hooks/lib/writepath.mjs 对非 PM 角色的拒绝是同一条规则，
// 理由只有一个，字面量只写一份。
//
// 这不是预先设计好的抽象，是修复轮 1 评审揪出缺陷 2 之后补的：produce 分支原来
// 没有这句话，M1 里 stages.json 每阶段只有一个 produces，写完它几乎总是同时让
// isStageDone 为真、跟下面 stageDone 分支（已经带这句话）拼进同一次回传，凑巧补全
// 了语义——评审原话："那是数据形状凑巧掩盖，不是设计保证"。M2 一旦出现多 produces
// 的阶段，先写完的那个产物会单独触发 produce 分支、没有任何"回报上级"的下一步，
// 跟 H3 给出互相矛盾的指示（提示让一个做不到这件事的角色去做它）。抽成一份两处调用，
// 不给"同一句话两处各写一遍、后续只改一处"这类漂移留口子——这个仓库为这类分叉开过
// 好几轮循环，不该在自己刚写的代码里重蹈。
//
// ⚠️ **M3b 修复轮 1：精度修正，不是行为修正。** 这段字面量里原来写的是「写路径隔离对非
// PM 角色**一律**拒绝」——那个全称量词实测不成立：H3 在 `kind:'no-run'` 那一支对**所有
// 角色** fail open，非 PM 在那个窗口里写得成 `runs/<id>/state.json`（子进程级探针，
// 完整记录在 docs/11 §5.23 的收口块）。
// ⚠️ **M3b「坏指针的窗口」：那条实测当初举的实物已经不在了，而结论没变，两件事分开记。**
// 举的实物是「current-run 指向的 run 目录不存在」，它本轮从 `no-run` 挪去了 `unreadable`
// （论证在 `hooks/lib/runctx.mjs` 头部），H3 在那个状态下现在拒非 PM。
// **但「一律」仍然是假的**：`no-run` 这一支照旧对所有角色 fail open，只是今天它只剩
// 「pointer 根本不在」一种——非 PM 在**那个**状态下照样写得成 `runs/<id>/state.json`。
// 所以这段措辞一个字都不要改回去；变的是该举哪个实物，不是那个全称量词的真值。
// **改的只有那四个字，建议本身一个字没软**：「不要自己去写 state.json」在那个窗口里照样
// 成立——**能写 ≠ 该写**，而且那个窗口在文件落盘那一刻就关上了，他的下一次写入就被拒。
// ⚠️ 这条回传的行为本来就是对的：它早就在让非 PM 往上报，**正是 M3b 给 buildDriftNotice
// 补的那个形状**。别因为这次订正把它改成「你也可以自己写」。
function pmOnlyNotice(action, reportWhat) {
  return (
    `这个动作（${action}）只能由 PM 执行——runs/*/state.json 是控制文件，` +
    `写路径隔离在 PreToolUse 上把非 PM 对它的写入拒掉。如果你不是 PM：把${reportWhat}回报给上级，` +
    `由 PM 落盘，不要自己去写 state.json。`
  )
}

/**
 * 【project.json】（M3u，docs/29，全量审查第 10 条）。report 是 hooks/lib/project.mjs 的 validateProject 那样的
 * { block, fix, confirm }，每条已经是单行、外部值过了 quote；三档都空时返回 null。
 *
 * 收件人不一定是 PM：project.json 是控制文件，run 进行中只有 PM 写得了；但 no-run 时 H3 对所有角色 fail open
 * （见 pmOnlyNotice 上方的注释），而 ledger 在 no-run 下对 project.json 照样回传。所以首句照 pmOnlyNotice 的
 * 写法说「只有 PM 该改它」，不对收件人说「你是唯一改得了它的人」。
 *
 * 阻断那一档的标题说清按角色生效：每条讲的都是某一条前缀，实测 PM 会读成「只有这条前缀失效」而留着它，
 * 可 H3 的第 8 步让这个角色整条条目作废。
 */
export function projectNotice(report) {
  const sections = [
    ['阻断（按角色生效：一个角色的条目里只要有一条，它写 run 目录之外的任何地方都会被拒，连它其余合法的前缀也一样）', report?.block],
    ['要改（/agent-team:at-init 明令不许这样写，或者按字面比较一定落空）', report?.fix],
    ['请确认（可能是有意的：读一遍，是想要的就不动）', report?.confirm],
  ].filter(([, items]) => Array.isArray(items) && items.length)
  if (!sections.length) return null
  return (
    '【project.json】.agent-team/project.json 有问题，逐条如下——只有 PM 该改它：你是 PM 就用 Write 整份重写；' +
    '不是的话把这些问题回报给上级，不要自己写 project.json：\n' +
    sections.map(([title, items]) => `  ${title}：\n` + items.map((s) => `  - ${s}`).join('\n')).join('\n') +
    '\n' +
    [
      (report.block?.length || report.fix?.length) && '阻断与要改的，改到没有为止再往下走',
      report.confirm?.length && '请确认的，确认是有意的就留着',
    ].filter(Boolean).join('；') +
    '。'
  )
}

/**
 * 【插件】（M3u）：roster.json 读不出来。它不是 project.json 的问题，不混进【project.json】——那一段的首句叫 PM
 * 整份重写 project.json、结尾叫它改到没有为止，这一条改 project.json 永远改不掉。report 同 projectNotice。
 */
export function pluginNotice(report) {
  const items = Array.isArray(report?.plugin) ? report.plugin : []
  return items.length ? items.map((s) => `【插件】${s}。`).join('\n') : null
}

/**
 * project.json 解析不出、或者不是对象。不回显文件内容（docs/27）。
 * - justWritten：这次写的正是它（写 project.json 那条缝）；否则是它在别处被弄坏（用户在两趟 run 之间手改，加了
 *   注释或尾逗号），PM 写 .agent-team 下别的文件时撞上。run 进行中时，那一刻契约与产物的哈希也回传不了，改好之后
 *   要原样重写一次刚才那个文件才拿得到（契约这一格 commands/at.md §2 另有兜底，这句管的是其余产物与记账）；没有
 *   run 时没有哈希可拿，改好 project.json 本身就会收到报告与【触达表】那一段。
 * - utf16：门禁认出它是 UTF-16 编码（Windows PowerShell 5.1 的 Out-File、> 的默认编码；gate.mjs 的 looksUtf16）。只说
 *   「注释和尾逗号」会把 PM 引开。实测（CLI 2.1.283）：Read 看到的是开头两个 U+FFFD、每个字后跟一个 NUL 的乱码；
 *   Write 第一次去掉 BOM、仍写成 UTF-16LE，第二次才是 UTF-8。PM 自己核字节、看到第一次写完仍是 UTF-16 时，会不信
 *   「再写一次」有用、改去写探测文件或删文件重建（6 次里 2 次）——所以把这个可观测的现象与兜底都说出来。修 UTF-16
 *   要连写两次 project.json，run 进行中时，早先那条「在别处被弄坏」回传末尾的「修好后原样重写刚才那个文件」隔着两段
 *   回传，实测多半被丢掉（7 次里 1 次照做）；所以写的正是它、UTF-16、run 进行中这一格，把那个提醒挂在修好之前的最后
 *   一条回传上。兜底（删掉重建）按 project.json 的写入次数计：run 进行中时 PM 写 state.json 已经收到过一次同样的句子，
 *   只说「第二次写完仍收到」会被数成第二次，第一次写完就删文件（合并前复测 8 次里 1 次）。
 */
export function brokenProjectNotice({ runInProgress, justWritten = true, utf16 = false }) {
  const why = utf16 ? '（文件是 UTF-16 编码，门禁只读 UTF-8）' : '（常见原因：注释、尾逗号、文件不是 UTF-8 编码）'
  const how = justWritten
    ? utf16 && runInProgress
      ? '只有 PM 该改它：你是 PM 就用 Write 写回一份合法的完整 project.json；收到触达表之后，这之前写过、没拿到回传的 ' +
        'state.json、契约或产物各原样重写一次，再继续；不是的话回报上级，不要自己写。'
      : '只有 PM 该改它：你是 PM 就用 Write 写回一份合法的完整 project.json，再继续；不是的话回报上级，不要自己写。'
    : runInProgress
      ? '契约与产物的哈希这时也回传不了。只有 PM 该改它：你是 PM 就用 Write 写回一份合法的完整 project.json，' +
        '再原样重写一次刚才那个文件拿回传；不是的话回报上级，不要自己写。'
      : '只有 PM 该改它：你是 PM 就用 Write 写回一份合法的完整 project.json——改好就会收到报告与【触达表】那一段，再继续；' +
        '不是的话回报上级，不要自己写。'
  return (
    `【project.json】${justWritten ? '刚写进去的 ' : ''}.agent-team/project.json 不是一个合法的 JSON 对象${why}，门禁读不出它。` +
    (runInProgress ? 'run 进行中：执行角色写任何地方都会被拒，前置就绪与交付物校验按读不出运行上下文放行。' : '') +
    (utf16
      ? '用 Write 整份重写 project.json（Read 看到的可能是一字一隔的乱码）。第一次写完 project.json，文件多半仍是 UTF-16、' +
        '只少了开头的 FF FE，这是预期的：照原样再 Write 一次 project.json。连写两次 project.json 仍收到这一句，才先删掉它，' +
        '再用 Write 新建（写别的文件时收到的这一句不算次数）。不用另写别的文件试探。'
      : '') +
    how
  )
}

export function buildLedgerNotices({
  kind, contractSha, state, reach, stages, stageDone, stateProblems, produceName, produceSha, projectReport, reworkStale, budget, grants,
  writerIsPm = true,
  writer = null,
  contractUnreadable = false,
  closeBlockers,
} = {}) {
  const out = []
  const st = state && typeof state === 'object' ? state : {}

  // 排在最前：写 project.json 时它要先于【触达表】——先把配置改对，再落盘由它算出来的触达表。【插件】又在它之前：
  // 插件装坏了，改 project.json 之前先停下。
  const pl = pluginNotice(projectReport)
  if (pl) out.push(pl)
  const pn = projectNotice(projectReport)
  if (pn) out.push(pn)

  if (kind === 'contract') {
    const cmp = compareContractSha({ recorded: st.contract_sha, actual: contractSha ?? null })
    if (!cmp.ok) out.push(`【契约】${cmp.problem}`)
  }
  // M4c（docs/37，全量审查第 37 条前半）：写 state.json 时也拿 contract_sha 比磁盘上的契约。写它的只能是 PM，不分收件人。理由是
  // 异步派发：H5a 只在派发那一刻跑，S6 里用 Bash 改的契约要到下一次派发才报——推进到 S7 的那一次写入在派验收之前，它才是规格
  // §4.2 ①「S7 验收前校验哈希未变」的那一刻，收口那一次写入也在这里核。contractSha 是调用方读过契约之后给的（磁盘上没有时是
  // null）；不给（undefined，例：坏 state.json 那一支只报形状）就不核。
  // 复核（docs/37 §3）：契约在、这一次却读不出（contractUnreadable，调用方给）——说读不出、没核，不说它不在。
  if (kind === 'state' && contractSha !== undefined && isPlainObject(state)) {
    const cmp = contractUnreadable
      ? { ok: false, kind: 'unreadable' }
      : compareContractSha({ recorded: st.contract_sha, actual: contractSha })
    const n = contractCheckNotice(cmp, st.contract_sha)
    if (n) out.push(n)
  }

  // M3u：花名册读坏、或者 project.json 有阻断时不发触达表的 JSON，说清为什么、什么时候会收到。花名册读坏时 computeReach
  // 拿 {} 算，恒得出「没有角色的触达超出」（实测 PM 用这份 {} 覆盖了一份正确的 reach.json）。有阻断时一律等改完再发：
  // 元素级、前缀级阻断下它照整条作废的条目算，把门禁不放行的前缀也算成「还能写到」，与同一段回传里的【project.json】
  // 自相矛盾；整份级、整条级阻断下它算得与 H3 一致，但改完阻断就会变——所以话里不说「算得不对」，只说改完才会收到。
  // 只在写 project.json 时出（kind === 'project'）：写 state.json、current-run 时不推它，免得每次记账都刷一遍。
  const blocked = Array.isArray(projectReport?.block) && projectReport.block.length > 0
  if (kind === 'project' && (pl || blocked)) {
    out.push(
      pl
        ? '【触达表】这次算不出来：花名册读不出，照它算的触达表是空的、不对。不要写 .agent-team/reach.json，保持原样；' +
            '插件重装（或有新版本时更新）之后，新开一个会话再跑 /agent-team:at-init 落盘。'
        : '【触达表】这次不发：上面有阻断，改完阻断、重写 project.json 之后才会收到；在那之前不要写 .agent-team/reach.json。',
    )
  } else if (kind === 'project' && reach && typeof reach === 'object') {
    const lines = []
    for (const [role, r] of Object.entries(reach)) {
      if (!r || !r.widened) continue
      for (const [prefix, via] of Object.entries(r.widenedBy ?? {})) {
        // 角色与经由链来自 roster.json（插件自己的名字）；前缀来自 project.json，谁都写得进，加引号。
        lines.push(`  ${inline(role)} 还能写到 ${quote(prefix)}（经 ${inline(via)}）`)
      }
    }
    // 措辞：这是「当前配置下各角色实际能写到哪些地方」，不是「限制」
    // （docs/09 账二实现约束 1）。⚠️ brief 原稿这里写的是「这不是限制也不是告警」——
    // 这句话本身就含「限制」二字，跟文件头「不得说成限制」的注释、以及
    // tests/ledger.test.mjs 里 assert.doesNotMatch(s, /限制/) 直接矛盾：brief 自己的
    // 实现代码违反了 brief 自己写的规则（Task 6 落地时发现，不在简报明确列出的
    // 「已经过时的地方」里）。换成「门禁」——本文件头部注释与 reach.mjs 头部注释
    // 已经在用这个词表达同一个意思（"这不是门禁""不是安全边界"），不是新造的说法。
    const body = lines.length
      ? `当前配置下，下面这些角色实际能写到的地方超出了它自己认领的路径：\n${lines.join('\n')}\n` +
        `这不是门禁也不是告警，是一份审计事实：写路径隔离只挡 Edit/Write 的直接写入，` +
        `一个角色把写入转手派发给路径的合法拥有者就绕过去了（规格 §6.4）。`
      : '当前配置下，没有角色的触达超出它自己认领的路径。'
    out.push(
      `【触达表】${body}\n` +
        `把下面这份 JSON 原样写进 .agent-team/reach.json：\n` +
        `${safeJson(reach)}`,
    )
  }

  if (kind === 'state' && Array.isArray(stateProblems) && stateProblems.length) {
    out.push(
      `【state.json】刚写进去的状态有问题，逐条如下——改完再继续，不要带着它往下跑：\n` +
        stateProblems.map((p) => `  - ${p}`).join('\n'),
    )
  }

  // M3z（docs/34，全量审查第 16 条）：按 history 的派生值越限（validateState 的 budget，上限 = 3 + 覆盖它的返工批准条数）。此前混在
  // 【state.json】那一块里，抬头是「改完再继续」——可唯一的出路是问用户，把计数改小会被 H6 以「不可重置」拒（O6）。只在写 state.json
  // 时发；写它的只有 PM。标签回到最早越限那一段之前最后一次回退回到的那一段（approvalTargetFor），与【阶段】、H6 判据④同一个取法。
  // 越限的段名来自 history（谁都写得进），不在阶段链上的加引号、不给标签（问用户补不上它）。
  // M4a 复核（P2）：已收口的 run 不发——问用户批准再返工一轮这条路收口之后走不通（记录器不记、H6 冻结）。
  if (kind === 'state' && Array.isArray(budget) && budget.length && closedAt(st) === null) {
    const chain = isStageChain(stages)
    const known = (s) => chain && typeof s === 'string' && Object.hasOwn(stages, s)
    const ids = chain ? Object.keys(stages) : []
    const named = budget.map((b) => `${known(b.stage) ? b.stage : quote(b.stage)} 已经返工 ${b.rounds} 轮，上限 ${b.limit}`)
    const onChain = budget.filter((b) => known(b.stage)).sort((a, b) => ids.indexOf(a.stage) - ids.indexOf(b.stage))
    const head =
      `【返工预算】history 显示 ${named.join('；')}（规格 §4.2 ③：第 3 轮终局，不过则升级），门禁在这一趟 run 里读不到覆盖它的` +
      '返工批准（批准记录丢了、读不出来，或者 history 被别处改过）。不要改计数——改小会被返工预算门禁以「不可重置」拒掉。'
    out.push(
      onChain.length
        ? `${head}\n${askUserText(approvalTargetFor({ history: st.history, stages, stage: onChain[0].stage }), grants, '再写一次 state.json 记上那条 escalation 与新的 contract_sha，照常往下走这一轮——不要为它再记一次回退；这一块之后就不再出现。')}`
        : `${head}这些段不在阶段链上，问用户也补不上：把这件事告诉用户。`,
    )
  }

  // M3y（docs/33，全量审查第 15 条）：返工轮里写 state.json 时，列出当前段与更早段还是上一轮的产物（磁盘内容与 rework_base
  // 记的 sha 相同；gate.mjs 经 freshness.mjs 的 staleByStage 算好传进来）。写 state.json 的只有 PM，出路直接说给它。
  // 产物名与段 id 都是插件自己的名字（stages.json），原样。只在写 state.json 时发：每写一份产物都刷一遍会把真正要看的东西淹掉。
  // M4a（docs/35）：已收口的 run 不发【返工】——收口时 H6 已经核过最后一段，之后不再推进、回退。
  if (kind === 'state' && reworkStale && (reworkStale.current?.length || reworkStale.earlier?.length) && closedAt(st) === null) {
    const lines = []
    if (reworkStale.current.length) {
      // M4a（docs/35）：链尾那一段的产物在收口那一次写入（closed_at）里由 H6 核——原来「收口不经 H6」，这一行只能说「收口之前让它重写」。
      const last = nextStage(stages, reworkStale.stage) === null
      const lastAccept = splitByAccept(stages, reworkStale.current).accept.length > 0
      lines.push(
        `  - 当前段 ${reworkStale.stage}：${reworkStale.current.join('、')}——交没交、齐没齐的判据（H5、H2、【阶段】）不把它们` +
          (last
            ? `算成这一轮的。这是阶段链最后一段：收口那一次写入（closed_at）H6 会拦还是上一轮的产物，收口之前让它重写` +
              `${lastAccept ? '，或者标 "accepted"' : ''}。`
            : `算成这一轮的，推进出这一段时 H6 会拦。`),
      )
    }
    if (reworkStale.earlier.length) {
      lines.push(
        `  - 更早的段：${reworkStale.earlier.map((e) => `${e.name}（${e.stage}）`).join('、')}——推进出那一段时它们本该已经` +
          `重写（验证段的产物只能重写）或标过 "accepted"：多半是回退记晚了（补记：同一次写入在回退之后又往前记了几段，回退之后已经重写过的也照磁盘` +
          `记成了上一轮的），或者文件被改回了旧内容。`,
      )
    }
    // M4a（docs/35）：验证段的产物不给「标 accepted」——出路按 splitByAccept 分开说；全是验证段的，那一句整句不出现。
    const listed = [...reworkStale.current, ...reworkStale.earlier.map((e) => e.name)]
    const { accept, redo } = splitByAccept(stages, listed)
    const both = accept.length && redo.length
    const acceptOut = accept.length
      ? `；这一轮接受它原样${both ? `（${accept.join('、')}）` : ''}，就在 state.json 的 rework_base 里把它的值改成 "accepted"` +
        `（只许当前段及更早段的；用 Write 整份重写 state.json）`
      : ''
    // 文档核对（PG-5）：PM 自己的验证段产物（08-delivery.md）不说「让它的产者重跑」。
    const pmOwn = (n) => chainIds(stages).some((id) => productsOfStage(stages[id]).includes(n) && stageRoles(stages[id]).includes('at-pm'))
    const ownRedo = redo.filter(pmOwn)
    const otherRedo = redo.filter((n) => !pmOwn(n))
    const redoOut =
      (otherRedo.length ? `\n${otherRedo.join('、')}：${VERIFY_REDO}。` : '') +
      (ownRedo.length ? `\n${ownRedo.join('、')}：这是你自己的产物，这一轮重写（验证段的产物，不能标 "accepted"）。` : '')
    out.push(
      `【返工】这是返工轮：state.json 的 rework_base 记着回退那一刻各份产物的 sha，下面这些磁盘内容与它记的一样，` +
        `还是上一轮的——\n${lines.join('\n')}\n` +
        `出路：这一轮重写它（你自己那几段的产物自己写，别的派它的产者）${acceptOut}。${redoOut}`,
    )
  }

  if (kind === 'produce' && typeof produceName === 'string' && typeof produceSha === 'string') {
    const recorded = (st.artifacts && typeof st.artifacts === 'object') ? st.artifacts[produceName] : undefined
    // 已经记过同一个哈希就不吭声——每写一次产物都刷一遍会把真正要看的东西淹掉。
    if (recorded !== produceSha) {
      // 见本文件头部 pmOnlyNotice 上方的注释：这句话不能只靠跟 stageDone 分支拼在
      // 同一次回传里凑出语义，produce 分支自己必须说完整。
      // 第二个参数以中文收尾：模板是 `把${reportWhat}回报给上级`，直接传 '这个 sha256'
      // 会拼成「sha256回报」，与本文件里 77 处「英文/数字 + 空格 + 中文」的惯例相反。
      const who = pmOnlyNotice('把这一条写进 artifacts', '这个 sha256 值')
      out.push(
        (recorded === undefined
          ? `【产物】${produceName} 的 sha256 是 ${produceSha}，state.json 的 artifacts 里还没有记。` +
            `把这一条原样写进去——不要自己拼一个。它是 §6.2 内容比对的基线，也是 /at-status 对账的依据。`
          : `【产物】${produceName} 的 sha256 是 ${produceSha}，而 artifacts 里记的是 ${shaOrNote(recorded)}。` +
            `这份产物在记账之后被改过——如果是有意的，把新值写进去；如果不是，去看看是谁改的。`
        ) + who,
      )
    }
  }

  // M4a（docs/35）：已收口的 run 不发【阶段】——原来对走完的 run 每写一次都说「该收口了」（审查第 24 条）。
  if (stageDone && typeof st.stage === 'string' && closedAt(st) === null) {
    const nxt = nextStage(stages, st.stage)
    // 为什么这条必须有：H5 交付物校验按 state.stage 判定（见 hooks/lib/deliverable.mjs）。
    // state.stage 停在旧阶段时，H5 对新阶段的角色无话可说——ok、零输出、看起来一切
    // 正常。那正是 docs/08 §0 说的「看起来通过了」那种失效形状，这条提示是让它变得
    // 可听见的唯一机制。
    const tail =
      `H5 交付物校验按 state.stage 判定：它停在旧阶段时，对新阶段的角色会完全无话可说——` +
      `不是放行，是哑掉，而哑掉和「通过了」在会话里长得一模一样。`
    // 评审 M-2：这条提示可能发给任何一个刚触发 ledger 的角色，不能假设读到它的
    // 就是 PM——运行时实测过 at-product 写自己阶段的产物（01-prd.md）时，只要
    // state.stage 还停在一个 produces 已齐的旧阶段就会收到它。但「推进/收口」这个
    // 动作是改 runs/*/state.json，那是控制文件，hooks/lib/writepath.mjs 对非 PM
    // 角色一律 deny——不点破这件事，这条提示等于让一个做不到这件事的角色去做它，
    // 跟 H3 给出互相矛盾的指示。硬约束 6 不许把提示削弱或按角色掐掉，所以补救的
    // 是措辞：把动作明确归给 PM，再给非 PM 一条不会撞 H3 的下一步。
    // M4a 复核（A-7）：最后一段还收不了口时，回报给上级的是「还收不了口、缺哪几份」，不是「齐了」。
    // M4b 第二轮复核（docs/36）：执行段里最后写完实现记录的执行角色也收到这一条。它读不到别人的实现记录、改不了 state.json，
    // 门禁也不读实现记录写了什么——回报给上级的不是「齐了」，是「都在磁盘上了」，再加一句管它自己那一份的。
    const implStage = isRolePatternStage(stages?.[st.stage])
    const who =
      Array.isArray(closeBlockers) && closeBlockers.length
        ? pmOnlyNotice('改 state.json', '"最后一段还收不了口、缺哪几份"这件事')
        : implStage && !writerIsPm
          ? pmOnlyNotice('改 state.json', '"这一段的产物都在磁盘上了（门禁不读实现记录写了什么）"这件事')
          : pmOnlyNotice('改 state.json', '"这一段的产物已经齐了"这件事')
    // M3y（docs/33）：返工轮里下一段在 history 里已经出现过（回到 S5 之后再进 S6），rework 那一段也要照派生量加 1——少了 H6
    // 会拒。这条提示原来只列 stage、history、roster、stage_roles、trimmed，照写会被 H6 拒一次（docs/15 那一趟真撞上过）。
    const again =
      nxt && Array.isArray(st.history) && st.history.some((e) => e && typeof e === 'object' && e.stage === nxt)
        ? `（${nxt} 在 history 里已经出现过：同一次 Write 把 rework 里的 ${nxt} 照派生量加 1，少了 H6 会拒）`
        : ''
    // M3z（docs/34）：加 1 之后超过上限（3 + 覆盖它的返工批准条数）时，H6 判据④会拒这次推进——先叫 PM 问用户。正路上回退那一次
    // 的预判已经把这一轮要用到的段一起批了，走到这里多半是批准记录丢了、或者 history 被别处改过。
    const entered = nxt && Array.isArray(st.history) ? st.history.filter((e) => isPlainObject(e) && e.stage === nxt).length : 0
    const nextLimit = limitOf(nxt, grants)
    // 复核（docs/34 §3，prose-3）：写产物触发的【阶段】会发给执行角色——它没有 AskUserQuestion、改不了 state.json，前面的 pmOnlyNotice
    // 已经叫非 PM 回报上级。问用户的做法只在写 state.json（写者只能是 PM）时给全。
    const overHead = `\n推进到 ${nxt} 会让它到第 ${entered} 轮返工，超过上限 ${nextLimit}（规格 §4.2 ③：第 3 轮终局，不过则升级），H6 会拒这次推进`
    const over =
      entered <= nextLimit
        ? ''
        : kind === 'state'
          ? `${overHead}。${askUserText(approvalTargetFor({ history: st.history, stages, stage: nxt }), grants, '再推进——推进那一次 Write 连同那条 escalation 与新的 contract_sha 一起记。')}`
          : `${overHead}：PM 推进之前要先问用户。`
    out.push(
      nxt
        ? `【阶段】${st.stage} 的产物已经齐了。这一段如果确实结束了，需要把 state.stage 推进到 ` +
          `${nxt}，并往 history 追加一条 { "stage": "${nxt}", "at": "<ISO 时间>" }${again}——用同一次 Write 把这一段的账一起记掉：` +
          `叫到的人累加进 roster（state.json 里有 stage_roles 的，同一批人并进它的这一段），决定不叫的产出角色写进 trimmed。` +
          `分两次写，推进那一次会被产者交代当成漏派。` +
          (implStage ? implRecordNote({ stage: stages?.[st.stage], writerIsPm, writer }) : '') +
          `${who}${tail}${over}`
        : Array.isArray(closeBlockers) && closeBlockers.length
          ? `【阶段】${st.stage} 的产物已经写了，它是阶段链的最后一段，但还收不了口——收口要最后一段的前置与产物都在、不是空文件、` +
            `而且是这一轮的：\n` +
            closeBlockers.map((b) => `  - ${blockerLine(stages, b, st)}`).join('\n') +
            `\n补齐之后照 /agent-team:at 第 6 节从第一步重走一遍再收口（补交的验收结论要读，交付文档要照它改）。${who}${tail}`
          : `【阶段】${st.stage} 的产物已经齐了，而它是阶段链的最后一段——该收口了：照 /agent-team:at 第 6 节，用同一次 Write ` +
            `记 never_invoked 与 closed_at（收口那一次 H6 核最后一段的前置与产物；没被拒就是收好了，收口成功不另发回传），再向用户汇报。` +
            `收口之后，交付之后的新改动另起一趟。${who}${tail}`,
    )
  }

  return out
}

// 阶段链的段 id（读不出来时空）。
function chainIds(stages) {
  return isStageChain(stages) ? Object.keys(stages) : []
}

// M4b 第一轮复核（docs/36）：执行段「齐了」的回传末尾固定带这一句。执行角色在 S5 被写路径隔离拒绝时，照正文先写一份实现记录才停下
// （M4c 起 H5b 也认冒泡：不写实现记录、回复第一行是「冒泡：」也停得下，那一份照旧算没交）
// （H5b），被拒还没解决的那一份在门禁看来就是交了；门禁不读它写了什么，这一句把 PM 引到那一节上。H5a「全部齐备」那句同用。
export const IMPL_RECORD_NOTE =
  '这一段的产物是各执行角色的实现记录：推进之前逐份读，有「被写路径隔离拒绝」一节、里面还有没标「已解决」的条目的，那一份不算交齐' +
  '（门禁看不出这一点；做法见 /agent-team:at 第 3 节「各段的具体做法」里这一段那一条）。'

// 第二轮复核：同一条回传发给执行角色时用这一句——上面那句叫读者去逐份读、去照 /agent-team:at 做，它都做不了。
const IMPL_RECORD_ROLE_NOTE =
  '你自己的实现记录里「被写路径隔离拒绝」一节还有没标「已解决」的条目的话，这一段还没做完：回报时照实说，不要只报「齐了」。'
// 文档核对（docs/36 §3.2）：非 PM、又不是这一段产者的写者（S5 里改 03-arch.md 的架构师、提前被派来写 06-test.md 的 at-qa）没有
// 实现记录，「你自己的」对它们是空话。给一句不预设收件人有实现记录的。
const IMPL_RECORD_PEER_NOTE =
  '这一段的产物是各执行角色的实现记录，门禁不读写了什么：有「被写路径隔离拒绝」一节、里面还有没标「已解决」的条目的那一份' +
  '不算交齐，回报时照实说，不要只报「齐了」。'

// 执行段「齐了」那句按写者分三档：PM（推进者）、这一段的产者（写的是自己的实现记录）、其余非 PM 写者。产者按 stages.json 这一段
// 的 role 与 producers 认（stageRoles），writer 是剥过前缀的调用者；读不出来时按「其余」说，那一句对谁都不是假话。
function implRecordNote({ stage, writerIsPm, writer }) {
  if (writerIsPm) return IMPL_RECORD_NOTE
  return typeof writer === 'string' && stageRoles(stage).includes(writer) ? IMPL_RECORD_ROLE_NOTE : IMPL_RECORD_PEER_NOTE
}

// M4c（docs/37，全量审查第 37 条前半）：派发返回（H5a）与写 state.json 时的【契约】。与写契约那一刻的【契约】（buildLedgerNotices
// 里 kind === 'contract' 那一支，带磁盘上的新值）不同：这里**不报磁盘上算出来的 sha**，也不说「改成与磁盘一致」——照着磁盘去改账，
// 就把一次漂移洗成了合法。合法修订拿新值的路只有一条：写契约那一次的回传（手上没有就原样重写一次契约）。按 compareContractSha 的
// kind 组措辞；收件人改不了 state.json 时，由调用方（gate.mjs 的 contractNoticeFor）接上冒泡的收尾。记录的值经 shaOrNote 才进文字。
export function contractCheckNotice(cmp, recorded) {
  if (!cmp || cmp.ok) return null
  if (cmp.kind === 'pending') {
    return (
      '【契约】00-contract.md 在磁盘上，state.json 的 contract_sha 还是 PENDING。把写契约那一次【契约】回传给的 sha 原样记进' +
      ' contract_sha；手上没有那个值（例如 state.json 是重建的），就原样重写一次 00-contract.md，从这一次的回传里拿——不要自己算' +
      '（门禁先统一行尾再算，自己算的对不上）。'
    )
  }
  if (cmp.kind === 'unreadable') {
    return (
      '【契约】这一次读不出 00-contract.md（文件在，可能正被别的程序占着），契约没核——过一会儿再看；不要据此重写契约，' +
      '也不要改 contract_sha。'
    )
  }
  if (cmp.kind === 'invalid') {
    return (
      '【契约】state.json 的 contract_sha 不是合法的 sha256（原值不回显），门禁拿它核不了契约。把它写成 PENDING，再原样重写一次' +
      ' 00-contract.md、从这一次的回传里拿 sha——不要自己算（门禁先统一行尾再算，自己算的对不上）。'
    )
  }
  if (cmp.kind === 'missing') {
    return (
      `【契约】state.json 记着 contract_sha ${shaOrNote(recorded)}，但磁盘上没有 00-contract.md：这趟 run 唯一的需求基线不在了，` +
      '后面每一步都失去了对账的依据。不要凭记忆另写一份顶上（第 1 节是用户原话）——把这件事告诉用户，由用户定怎么补回。'
    )
  }
  // 复核（docs/37 §3）：格式对、值不等，门禁分不出成因——不断言「契约被改过」，几种可能都列出来，各给各的出路。
  return (
    `【契约】磁盘上的 00-contract.md 与 state.json 记的 contract_sha（${shaOrNote(recorded)}）对不上。门禁分不出是哪一种，可能是：` +
    '照 /agent-team:at 第 4 节修订之后没记新值——把那一次写契约收到的【契约】回传给的 sha 记进 contract_sha；记的是自己算的值——' +
    '原样重写一次契约，从这一次的回传里拿；契约被人改过、不是第 4 节的修订——把契约恢复原样，告诉用户。不要自己算 sha——这一段也' +
    '不报磁盘上算出来的值。'
  )
}
