import { test } from 'node:test'
import assert from 'node:assert/strict'
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
