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
//
// 本模块只做格式化，一切 I/O 在 gate.mjs 里；判据本身来自这些纯函数模块：contract-hash.mjs、
// reach.mjs、state.mjs、project.mjs。
import { compareContractSha, shaOrNote } from './contract-hash.mjs'
import { inline, quote, safeJson } from './trusted.mjs'
import { nextStage } from './state.mjs'

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
  kind, contractSha, state, reach, stages, stageDone, stateProblems, produceName, produceSha, projectReport, reworkStale,
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

  // M3y（docs/33，全量审查第 15 条）：返工轮里写 state.json 时，列出当前段与更早段还是上一轮的产物（磁盘内容与 rework_base
  // 记的 sha 相同；gate.mjs 经 freshness.mjs 的 staleByStage 算好传进来）。写 state.json 的只有 PM，出路直接说给它。
  // 产物名与段 id 都是插件自己的名字（stages.json），原样。只在写 state.json 时发：每写一份产物都刷一遍会把真正要看的东西淹掉。
  if (kind === 'state' && reworkStale && (reworkStale.current?.length || reworkStale.earlier?.length)) {
    const lines = []
    if (reworkStale.current.length) {
      // 链尾那一段没有「推进出去」这次写入，收口不经 H6（第 24 条：链尾没有收口标记）——不能对它许诺 H6 会拦。
      const last = nextStage(stages, reworkStale.stage) === null
      lines.push(
        `  - 当前段 ${reworkStale.stage}：${reworkStale.current.join('、')}——交没交、齐没齐的判据（H5、H2、【阶段】）不把它们` +
          (last
            ? `算成这一轮的。这是阶段链最后一段，收口不经 H6：收口之前让它重写，或者标 "accepted"。`
            : `算成这一轮的，推进出这一段时 H6 会拦。`),
      )
    }
    if (reworkStale.earlier.length) {
      lines.push(
        `  - 更早的段：${reworkStale.earlier.map((e) => `${e.name}（${e.stage}）`).join('、')}——推进出那一段时它们本该已经` +
          `重写或标过 "accepted"：多半是回退记晚了（补记：同一次写入在回退之后又往前记了几段，回退之后已经重写过的也照磁盘` +
          `记成了上一轮的），或者文件被改回了旧内容。`,
      )
    }
    out.push(
      `【返工】这是返工轮：state.json 的 rework_base 记着回退那一刻各份产物的 sha，下面这些磁盘内容与它记的一样，` +
        `还是上一轮的——\n${lines.join('\n')}\n` +
        `出路：这一轮重写它（你自己那几段的产物自己写，别的派它的产者）；这一轮接受它原样，就在 state.json 的 rework_base 里把它的值改成 "accepted"` +
        `（只许当前段及更早段的；用 Write 整份重写 state.json）。`,
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

  if (stageDone && typeof st.stage === 'string') {
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
    const who = pmOnlyNotice('改 state.json', '"这一段的产物已经齐了"这件事')
    // M3y（docs/33）：返工轮里下一段在 history 里已经出现过（回到 S5 之后再进 S6），rework 那一段也要照派生量加 1——少了 H6
    // 会拒。这条提示原来只列 stage、history、roster、stage_roles、trimmed，照写会被 H6 拒一次（docs/15 那一趟真撞上过）。
    const again =
      nxt && Array.isArray(st.history) && st.history.some((e) => e && typeof e === 'object' && e.stage === nxt)
        ? `（${nxt} 在 history 里已经出现过：同一次 Write 把 rework 里的 ${nxt} 照派生量加 1，少了 H6 会拒）`
        : ''
    out.push(
      nxt
        ? `【阶段】${st.stage} 的产物已经齐了。这一段如果确实结束了，需要把 state.stage 推进到 ` +
          `${nxt}，并往 history 追加一条 { "stage": "${nxt}", "at": "<ISO 时间>" }${again}——用同一次 Write 把这一段的账一起记掉：` +
          `叫到的人累加进 roster（state.json 里有 stage_roles 的，同一批人并进它的这一段），决定不叫的产出角色写进 trimmed。` +
          `分两次写，推进那一次会被产者交代当成漏派。${who}${tail}`
        : `【阶段】${st.stage} 的产物已经齐了，而它是阶段链的最后一段——该收口了。${who}${tail}`,
    )
  }

  return out
}
