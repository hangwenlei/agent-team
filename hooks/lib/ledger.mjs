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
// 本模块只做格式化，一切 I/O 在 gate.mjs 里；判据本身来自 contract-hash.mjs /
// reach.mjs / state.mjs 三个纯函数模块。
import { compareContractSha } from './contract-hash.mjs'
import { nextStage } from './state.mjs'

export function buildLedgerNotices({
  kind, contractSha, state, reach, stages, stageDone, stateProblems,
} = {}) {
  const out = []
  const st = state && typeof state === 'object' ? state : {}

  if (kind === 'contract') {
    const cmp = compareContractSha({ recorded: st.contract_sha, actual: contractSha ?? null })
    if (!cmp.ok) out.push(`【契约】${cmp.problem}`)
  }

  if (kind === 'project' && reach && typeof reach === 'object') {
    const lines = []
    for (const [role, r] of Object.entries(reach)) {
      if (!r || !r.widened) continue
      for (const [prefix, via] of Object.entries(r.widenedBy ?? {})) {
        lines.push(`  ${role} 还能写到 ${prefix}（经 ${via}）`)
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
        `${JSON.stringify(reach, null, 2)}`,
    )
  }

  if (kind === 'state' && Array.isArray(stateProblems) && stateProblems.length) {
    out.push(
      `【state.json】刚写进去的状态有问题，逐条如下——改完再继续，不要带着它往下跑：\n` +
        stateProblems.map((p) => `  - ${p}`).join('\n'),
    )
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
    const who =
      `这个动作（改 state.json）只能由 PM 执行——runs/*/state.json 是控制文件，` +
      `写路径隔离对非 PM 角色一律拒绝。如果你不是 PM：把"这一段的产物已经齐了"这` +
      `件事回报给上级，由 PM 落盘，不要自己去写 state.json。`
    out.push(
      nxt
        ? `【阶段】${st.stage} 的产物已经齐了。这一段如果确实结束了，需要把 state.stage 推进到 ` +
          `${nxt}，并往 history 追加一条 { "stage": "${nxt}", "at": "<ISO 时间>" }。${who}${tail}`
        : `【阶段】${st.stage} 的产物已经齐了，而它是阶段链的最后一段——该收口了。${who}${tail}`,
    )
  }

  return out
}
