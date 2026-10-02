import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildLedgerNotices } from '../hooks/lib/ledger.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
}
const SHA = 'sha256:' + 'b'.repeat(64)
const base = {
  kind: 'other', contractSha: null, state: { stage: 'S1', contract_sha: 'PENDING' },
  reach: null, stages: STAGES, stageDone: false, stateProblems: [],
  produceName: null, produceSha: null,
}
const joined = (over) => buildLedgerNotices({ ...base, ...over }).join('\n')

test('无事可报时返回空数组——不要每次写文件都刷一屏', () => {
  assert.deepEqual(buildLedgerNotices(base), [])
})

test('写了契约：把哈希交回去，并说明要原样写进 contract_sha', () => {
  const s = joined({ kind: 'contract', contractSha: SHA })
  assert.ok(s.includes(SHA))
  assert.match(s, /contract_sha/)
  assert.match(s, /不要自己拼/)
})

test('写了契约且已记过同一个哈希：不报', () => {
  const notices = buildLedgerNotices({
    ...base, kind: 'contract', contractSha: SHA,
    state: { stage: 'S1', contract_sha: SHA },
  })
  assert.deepEqual(notices, [])
})

test('契约漂移：报出来，并点名 escalations', () => {
  const s = joined({
    kind: 'contract', contractSha: SHA,
    state: { stage: 'S1', contract_sha: 'sha256:' + 'c'.repeat(64) },
  })
  assert.match(s, /漂移/)
  assert.match(s, /escalations/)
})

test('写了 project.json：交回触达表，并标出被放大的角色与那条派发链', () => {
  const reach = {
    'at-product': {
      own: ['docs/'], reachableRoles: ['at-backend'],
      reach: ['docs/', 'src/server/'],
      widenedBy: { 'src/server/': 'at-product → at-backend' }, widened: true,
    },
    'at-backend': { own: ['src/server/'], reachableRoles: [], reach: ['src/server/'], widenedBy: {}, widened: false },
  }
  const s = joined({ kind: 'project', reach })
  assert.match(s, /reach\.json/)
  assert.ok(s.includes('at-product → at-backend'))
  assert.ok(s.includes('src/server/'))
})

// 评审 M-3：硬约束（docs/09 账二实现约束 1 / 规格 §6.4）唯一的机械守卫——触达表
// 是审计产物，不是安全边界，输出措辞不得把它说成「限制」——原来排在上面那条
// test() 四段断言的最后一位。它不会被永久遮蔽（前三条断言全过之前它一直会跑到），
// 所以只是 Minor，不是 Task 5 那种"从未被执行到"；但同一个形状（守约束的断言排在
// 措辞断言后面）正是上一个任务栽进去的地方，单独拆出来让这条约束可以被独立观测、
// 独立塌回验证，不依赖前面三条断言先全部通过。Step 3 落地时实测过 brief 原稿的
// 实现代码在这条断言上真的失败过一次（原文写的是"这不是限制也不是告警"，自己就
// 含「限制」二字）——这条测试证明过它真的能抓住问题，不是摆设。
test('触达表的回传措辞不得把它说成「限制」', () => {
  const reach = {
    'at-product': {
      own: ['docs/'], reachableRoles: ['at-backend'],
      reach: ['docs/', 'src/server/'],
      widenedBy: { 'src/server/': 'at-product → at-backend' }, widened: true,
    },
    'at-backend': { own: ['src/server/'], reachableRoles: [], reach: ['src/server/'], widenedBy: {}, widened: false },
  }
  const s = joined({ kind: 'project', reach })
  assert.doesNotMatch(s, /限制/)
})

test('触达表里没有任何角色被放大时，也要说一句「没有」而不是沉默', () => {
  const reach = { a: { own: ['p/'], reachableRoles: [], reach: ['p/'], widenedBy: {}, widened: false } }
  const s = joined({ kind: 'project', reach })
  assert.match(s, /reach\.json/)
  assert.match(s, /没有角色的触达超出/)
})

test('state.json 有问题：逐条交回', () => {
  const s = joined({ kind: 'state', stateProblems: ['rework["S2"] 是 0，但 history 里 S2 出现了 3 次'] })
  assert.match(s, /rework/)
  assert.match(s, /state\.json/)
})

const SHA_P = 'sha256:' + 'e'.repeat(64)

test('写了阶段产物：回传它的 sha256，并说明要写进 artifacts', () => {
  const s = joined({ kind: 'produce', produceName: '01-prd.md', produceSha: SHA_P })
  assert.ok(s.includes(SHA_P))
  assert.ok(s.includes('01-prd.md'))
  assert.match(s, /artifacts/)
})

test('写了阶段产物且 artifacts 里已经是同一个哈希：不重复报', () => {
  const notices = buildLedgerNotices({
    ...base, kind: 'produce', produceName: '01-prd.md', produceSha: SHA_P,
    state: { stage: 'S1', contract_sha: 'PENDING', artifacts: { '01-prd.md': SHA_P } },
  })
  assert.deepEqual(notices, [])
})

test('写了阶段产物且 artifacts 里记的是别的哈希：报出来，两个值都带上', () => {
  const old = 'sha256:' + 'f'.repeat(64)
  const s = joined({
    kind: 'produce', produceName: '01-prd.md', produceSha: SHA_P,
    state: { stage: 'S1', contract_sha: 'PENDING', artifacts: { '01-prd.md': old } },
  })
  assert.ok(s.includes(SHA_P))
  assert.ok(s.includes(old))
})

// 修复轮 1 缺陷 2：stages.json 里 S2/S3/S5 的 produces 恰恰是 at-product/at-architect/
// at-backend 自己写的，PostToolUse 的 additionalContext 送给写文件的那个角色本人，
// 不是 PM——但 state.json 归 PM 写（⚠️ M3b 修复轮 1：这句话和下面那条原来都带着
// 「一律」那个口径，它不成立；同一份知识只留一处，在 hooks/lib/ledger.mjs 的
// pmOnlyNotice 上方，别在这里抄第二份。**这条测试要的那层意思没变。**）。
// M1 里每阶段只有一个 produces，写完它几乎总是
// 同时触发下面的 stageDone 分支（已经带"回报上级"提示），两条拼在同一次回传里凑巧
// 补全了语义；这条测试特意只给 kind:'produce'、不给 stageDone（`base` 的
// `stageDone: false` 默认值不动），确保 produce 分支自己就把这句话说完整，不依赖
// 跟 stageDone 拼车。
test('产物回传自己就点名非 PM 请回报上级——不依赖跟阶段推进提示拼在一起', () => {
  const s = joined({ kind: 'produce', produceName: '01-prd.md', produceSha: SHA_P })
  // 连「sha256 值」一起钉：光 /回报/ 太松，pmOnlyNotice 的模板是
  // `把${reportWhat}回报给上级`，reportWhat 以英文/数字收尾就会拼出「sha256回报」，
  // 与本仓库「英文/数字 + 空格 + 中文」的惯例相反，而 /回报/ 测不出这一点。
  assert.match(s, /把这个 sha256 值回报给上级/)
})

test('当前阶段产物已齐：提示推进，并说明不推进会让 H5 哑掉', () => {
  const s = joined({ stageDone: true })
  assert.match(s, /S2/)          // nextStage(STAGES, 'S1')
  assert.match(s, /history/)
  assert.match(s, /H5/)
})

// 评审 M-2：这条提示可能发给任何触发了 ledger 的角色，不止 PM——但改 state.json
// 只有 PM 能做（控制文件，H3 在 PreToolUse 上把非 PM 对它的写入拒掉）。不点破这件事，
// 提示会让一个做不到的角色去做它，跟 H3 互相矛盾。钉住新增的这层意思：文案必须点名 PM。
// ⚠️ **M3b 修复轮 1：这里原来写的是「H3 对非 PM 一律拒绝」，那个全称量词假**——
// no-run 那一支对所有角色 fail open，理由写在 hooks/lib/ledger.mjs 的 pmOnlyNotice 上方，
// 不在这里重复。**这条测试要的那层意思没变**：文案必须点名 PM。
// ⚠️ M3b「坏指针的窗口」之后那个全称量词**仍然假**，只是该举的实物换了一个
// （坏指针已归 unreadable、H3 在那里拒非 PM；剩下的是「pointer 根本不在」）。
// 单一真源还是 pmOnlyNotice 上方那一段，这里不抄第二份。
test('提示推进时点名这个动作只能由 PM 执行', () => {
  const s = joined({ stageDone: true })
  assert.match(s, /PM/)
})

// 评审 I-1：原来这条测试唯一的断言是 doesNotMatch(/推进到 S3/)——空字符串天然
// 满足它，删掉整个收口分支（out.push(nxt ? ... : ...) 改成 if (nxt) out.push(...)）
// 这条测试也不会变红，「该收口了」那句话和它后面解释 H5 会哑掉的 tail 此前没有
// 任何测试守着。补两条正面断言堵住这个空洞。三条断言留在同一个 test() 里没有
// 遮蔽风险：这里唯一会跑的塌法是整段删除，此时 s 变成 ''，doesNotMatch 那条会
// 无害地通过（'' 确实不含 "推进到 S3"），真正抛出的是下一条 match 断言——不存在
// "先失败的断言挡住后面那条、导致后面那条从未被验证"的 Task 5 式遮蔽。
test('最后一个阶段产物齐了：提示收口，不瞎报下一阶段', () => {
  const s = joined({ stageDone: true, state: { stage: 'S2', contract_sha: 'PENDING' } })
  assert.doesNotMatch(s, /推进到 S3/)
  assert.match(s, /收口|最后一段/)
  assert.match(s, /H5/)
})

test('退化输入一律不抛', () => {
  for (const bad of [null, undefined, {}, { kind: 'contract' }]) {
    assert.doesNotThrow(() => buildLedgerNotices(bad ?? {}))
  }
})

// ---------------------------------------------------------------------------
// M3y（docs/33）：【返工】——写 state.json 时，列出当前段与更早段还是上一轮的产物
// ---------------------------------------------------------------------------
test('M3y【返工】：写 state.json、当前段还有上一轮的产物 → 列出来，给两条出路', () => {
  const s = joined({ kind: 'state', reworkStale: { stage: 'S5', current: ['05-impl/at-backend.md'], earlier: [] } })
  assert.match(s, /【返工】/)
  assert.match(s, /当前段 S5：05-impl\/at-backend\.md/)
  assert.match(s, /重写/)
  assert.match(s, /"accepted"/)
  assert.doesNotMatch(s, /更早的段/)
})

test('M3y【返工】：更早段还旧的，带出处、说清多半是补记', () => {
  const s = joined({ kind: 'state', reworkStale: { stage: 'S6', current: [], earlier: [{ name: '05-impl/at-backend.md', stage: 'S5' }] } })
  assert.match(s, /更早的段：05-impl\/at-backend\.md（S5）/)
  assert.match(s, /补记/)
  assert.doesNotMatch(s, /- 当前段/)
})

test('M3y【返工】：两样都空、或者写的不是 state.json → 不发', () => {
  assert.doesNotMatch(joined({ kind: 'state', reworkStale: { stage: 'S5', current: [], earlier: [] } }), /【返工】/)
  assert.doesNotMatch(joined({ kind: 'state' }), /【返工】/)
  assert.doesNotMatch(joined({ kind: 'produce', reworkStale: { stage: 'S5', current: ['05-impl/at-backend.md'], earlier: [] } }), /【返工】/)
})

// M3y 复核：链尾那一段没有「推进出去」这次写入，收口不经 H6——【返工】不能对它说「推进出这一段时 H6 会拦」。
// M4a（docs/35）订正：收口那一次写入（closed_at）现在经 H6（hooks/lib/closing.mjs）——【返工】改说「收口那一次 H6 会拦」；
// 08-delivery.md 是验证段的产物，不给「标 accepted」。仍然不说「推进出这一段时 H6 会拦」（链尾没有推进）。
const REAL_STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
test('M3y【返工】：当前段是阶段链最后一段时，说收口那一次 H6 会拦（M4a），不说推进时会拦', () => {
  const s = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'state', state: { stage: 'S8' }, reworkStale: { stage: 'S8', current: ['08-delivery.md'], earlier: [] } }).join('\n')
  assert.match(s, /当前段 S8：08-delivery\.md/)
  assert.match(s, /最后一段：收口那一次写入（closed_at）H6 会拦还是上一轮的产物，收口之前让它重写。/)
  assert.doesNotMatch(s, /收口不经 H6/)
  // 收口已经收了：不发【返工】。
  const closed = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'state', state: { stage: 'S8', closed_at: '2026-10-01T15:00:00Z' }, reworkStale: { stage: 'S8', current: ['08-delivery.md'], earlier: [] } }).join('\n')
  assert.doesNotMatch(closed, /【返工】/)
  assert.doesNotMatch(s, /推进出这一段时 H6 会拦/)
  const mid = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'state', state: { stage: 'S5' }, reworkStale: { stage: 'S5', current: ['05-impl/at-backend.md'], earlier: [] } }).join('\n')
  assert.match(mid, /推进出这一段时 H6 会拦/)
})

// 【返工】只发给写 state.json 的 PM；S1、S4、S8 的产物就是它自己的，「派它的产者」它做不到。
test('M3y【返工】：出路分开说——PM 自己那几段的产物自己写，别的派产者', () => {
  const s = joined({ kind: 'state', reworkStale: { stage: 'S5', current: ['05-impl/at-backend.md'], earlier: [] } })
  assert.match(s, /你自己那几段的产物自己写/)
})

// 返工轮里推进进 history 里已有的一段（回到 S5 之后再进 S6），rework 那一段也要照派生量加 1——H6 只认派生量，正文与【阶段】
// 原来都只列 stage、history、roster、stage_roles、trimmed，照写会被 H6 拒一次（docs/15 那一趟真撞上过）。
test('M3y【阶段】：下一段在 history 里已经出现过时，提醒同一次 Write 把 rework 那一段加 1', () => {
  const h = (...ids) => ids.map((stage) => ({ stage, at: 't' }))
  const again = buildLedgerNotices({ ...base, stages: REAL_STAGES, stageDone: true, state: { stage: 'S5', history: h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5') } }).join('\n')
  assert.match(again, /S6 在 history 里已经出现过[^。]*rework/)
  const first = buildLedgerNotices({ ...base, stages: REAL_STAGES, stageDone: true, state: { stage: 'S5', history: h('S1', 'S2', 'S3', 'S4', 'S5') } }).join('\n')
  assert.doesNotMatch(first, /在 history 里已经出现过/)
})

test('M3y【阶段】：history 里混着 null、字符串、数字条目时不抛，「已经出现过」照常判', () => {
  const h = (...ids) => ids.map((stage) => ({ stage, at: 't' }))
  for (const bad of [null, 'x', 42]) {
    const s = buildLedgerNotices({ ...base, stages: REAL_STAGES, stageDone: true, state: { stage: 'S5', history: [bad, ...h('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5')] } }).join('\n')
    assert.match(s, /S6 在 history 里已经出现过/, JSON.stringify(bad))
  }
})

// ============================================================================
// M3z（docs/34，全量审查第 16 条）：越限单列成【返工预算】，【阶段】在推进会越限时先叫 PM 问用户。
//
// validateState 的越限（按 history 的派生值、上限 = 3 + 覆盖它的返工批准条数）此前混在【state.json】那一块里，抬头是「改完再继续」
// ——可越限的唯一出路是问用户，把计数改小会被 H6 以「不可重置」拒（O6）。【阶段】原来只说「rework 那一段加 1」，推进会越限时
// 照它写会被 H6 拒。两处给的规范标签取同一段（budget.mjs 的 approvalTargetFor），一次批准两处都消掉。
import { approvalLabel } from '../hooks/lib/budget.mjs'

const hh = (...ids) => ids.map((stage) => ({ stage, at: 't' }))
// S6 → S5 回退 3 轮之后又回到 S5（第 4 轮已经记下）。
const FOURTH = hh('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5', 'S6', 'S5', 'S6', 'S5', 'S6', 'S5')

test('M3z【返工预算】：写 state.json、越限 → 单列一块，给规范标签，说不要改计数，不说「改完再继续」', () => {
  const s = buildLedgerNotices({
    ...base, kind: 'state', stages: REAL_STAGES, state: { stage: 'S5', history: FOURTH },
    budget: [{ stage: 'S5', rounds: 4, limit: 3 }],
  }).join('\n')
  assert.match(s, /^【返工预算】/m)
  assert.match(s, /S5 已经返工 4 轮，上限 3/)
  assert.ok(s.includes(approvalLabel('S5')), s)
  assert.match(s, /不要改计数/)
  assert.doesNotMatch(s, /改完再继续/)
  assert.match(s, /0 条/)
})

test('M3z【返工预算】：越限的是 S6、最后一次回退回到 S5 → 标签写回到 S5（照它记下的批准盖得住 S6）', () => {
  const s = buildLedgerNotices({
    ...base, kind: 'state', stages: REAL_STAGES, state: { stage: 'S6', history: [...FOURTH, ...hh('S6')] },
    budget: [{ stage: 'S6', rounds: 4, limit: 3 }],
  }).join('\n')
  assert.ok(s.includes(approvalLabel('S5')), s)
})

test('M3z【返工预算】：没越限、写的不是 state.json → 不发', () => {
  assert.doesNotMatch(joined({ kind: 'state', budget: [] }), /【返工预算】/)
  assert.doesNotMatch(joined({ kind: 'state' }), /【返工预算】/)
  assert.doesNotMatch(joined({ kind: 'produce', budget: [{ stage: 'S5', rounds: 4, limit: 3 }] }), /【返工预算】/)
})

test('M3z【返工预算】：段名不在阶段链上（history 被别处写坏）→ 加引号点名，不给标签', () => {
  const s = joined({ kind: 'state', stages: REAL_STAGES, state: { stage: 'S5', history: FOURTH }, budget: [{ stage: 'S5b', rounds: 4, limit: 3 }] })
  assert.match(s, /"S5b"/)
  assert.ok(!s.includes(approvalLabel('S5b')), s)
})

test('M3z【阶段】：推进进下一段会越限 → 说会超过上限、先问用户，标签回到最后一次回退回到的那一段', () => {
  // 第 4 轮回到 S5 时只批了 S5；S6 已经出现 4 次，再进是第 4 轮。写 state.json（写者是 PM）时给全问用户的做法。
  const s = buildLedgerNotices({
    ...base, kind: 'state', stages: REAL_STAGES, stageDone: true, state: { stage: 'S5', history: FOURTH },
    grants: [{ reworkTo: 'S5', covers: ['S5'] }],
  }).join('\n')
  assert.match(s, /推进到 S6 会让它到第 4 轮返工，超过上限 3/)
  assert.ok(s.includes(approvalLabel('S5')), s)
  assert.match(s, /1 条/)
})

test('M3z【阶段】：批准覆盖了下一段 → 照旧只说 rework 那一段加 1', () => {
  const s = buildLedgerNotices({
    ...base, stages: REAL_STAGES, stageDone: true, state: { stage: 'S5', history: FOURTH },
    grants: [{ reworkTo: 'S5', covers: ['S5', 'S6'] }],
  }).join('\n')
  assert.match(s, /S6 在 history 里已经出现过[^。]*rework/)
  assert.doesNotMatch(s, /超过上限/)
})

// 复核（docs/34 §3，prose-3）：写产物触发的【阶段】会发给执行角色，它没有 AskUserQuestion、也改不了 state.json——越限那一句
// 不对它下「问用户」的命令，只说推进之前 PM 要先问用户（前面的 pmOnlyNotice 已经叫非 PM 回报上级）。
test('复核【阶段】：写产物时（不是写 state.json）越限那一句不带问用户的做法', () => {
  const s = buildLedgerNotices({
    ...base, kind: 'produce', stages: REAL_STAGES, stageDone: true, state: { stage: 'S5', history: FOURTH },
    grants: [{ reworkTo: 'S5', covers: ['S5'] }],
  }).join('\n')
  assert.match(s, /推进到 S6 会让它到第 4 轮返工，超过上限 3/)
  assert.match(s, /PM 推进之前要先问用户/)
  assert.doesNotMatch(s, /AskUserQuestion/)
})

// 变异 L06：【返工预算】不按链序取最早越限的段时全绿——上面几条只有一段越限。
test('变异 L06：几段同时越限、budget 不按链序给 → 标签取链上最早那一段之前最后一次回退回到的段', () => {
  const s = buildLedgerNotices({
    // 最后一次回退回到 S5：越限的若取 S5，标签是「回到 S5」；取链上最早的 S2，标签是「回到 S2」（approvalTargetFor 不越过越限的段）。
    ...base, kind: 'state', stages: REAL_STAGES, state: { stage: 'S5', history: hh('S1', 'S2', 'S3', 'S2', 'S3', 'S2', 'S3', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5') },
    budget: [{ stage: 'S5', rounds: 4, limit: 3 }, { stage: 'S2', rounds: 4, limit: 3 }],
  }).join('\n')
  assert.ok(s.includes(approvalLabel('S2')), s)
  assert.ok(!s.includes(approvalLabel('S5')), s)
})

// M4a 复核（L07、A-7）：【返工】两类都有时，标 accepted 那一句点名能标的那几份；最后一段还收不了口时，给非 PM 的那句回报说「还收不了口」。
test('M4a 复核【返工】两类都有：「这一轮接受它原样」点名能标的那一份', () => {
  const s = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'state', state: { stage: 'S6' }, reworkStale: { stage: 'S6', current: ['06-test.md'], earlier: [{ name: '05-impl/at-backend.md', stage: 'S5' }] } }).join('\n')
  assert.match(s, /这一轮接受它原样（05-impl\/at-backend\.md）/)
  assert.match(s, /06-test\.md：验证段/)
})

test('M4a 复核【阶段】最后一段还收不了口：给非 PM 的回报说「还收不了口」，不说「齐了」', () => {
  const s = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'produce', state: { stage: 'S8' }, stageDone: true, closeBlockers: [{ name: '07-acceptance.md', why: 'missing', require: true }] }).join('\n')
  assert.match(s, /还收不了口/)
  assert.doesNotMatch(s, /"这一段的产物已经齐了"这件事/)
})

// M4a 复核二（L03、L05、L04）：「齐了」那一支的回报照旧；【阶段】的阻碍按 state 分「叫没叫过」；【返工】更早段那一行带验证段的说明。
test('M4a 复核二【阶段】不在最后一段：给非 PM 的回报照旧是「这一段的产物已经齐了」', () => {
  const s = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'produce', state: { stage: 'S5' }, stageDone: true }).join('\n')
  assert.match(s, /"这一段的产物已经齐了"这件事/)
})

test('M4a 复核二【阶段】阻碍按 state 分叫没叫过：at-qa 在 S6 叫过 → 「被叫到过」', () => {
  const s = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'state', state: { stage: 'S8', stage_roles: { S6: ['at-qa'] }, roster: ['at-qa'] }, stageDone: true, closeBlockers: [{ name: '06-test.md', why: 'missing', require: true }] }).join('\n')
  assert.match(s, /06-test\.md[^\n]*被叫到过/)
})

test('M4a 复核二【返工】更早段那一行：验证段的产物只能重写', () => {
  const s = buildLedgerNotices({ ...base, stages: REAL_STAGES, kind: 'state', state: { stage: 'S7' }, reworkStale: { stage: 'S7', current: [], earlier: [{ name: '06-test.md', stage: 'S6' }] } }).join('\n')
  assert.match(s, /验证段的产物只能重写/)
})
