import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ESCALATION_KINDS, REJECTION_KINDS, REWORK_LIMIT, isStageDone, nextStage, rejectTo, reworkFromHistory, validateState } from '../hooks/lib/state.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  S3: { role: 'at-architect', requires: ['01-prd.md'], produces: ['03-arch.md'] },
}
const SHA = 'sha256:' + 'a'.repeat(64)

function good(over = {}) {
  return {
    run_id: '20260917-1430-login-sso',
    stage: 'S2',
    contract_sha: SHA,
    roster: ['at-product'],
    artifacts: { '00-contract.md': SHA },
    rework: {},
    never_invoked: ['at-frontend'],
    escalations: [],
    history: [
      { stage: 'S1', at: '2026-09-17T14:30:00Z' },
      { stage: 'S2', at: '2026-09-17T14:52:00Z' },
    ],
    ...over,
  }
}

test('合法的 state 通过', () => {
  assert.deepEqual(validateState(good(), { stages: STAGES }), { ok: true, problems: [] })
})

test('rework 由 history 推导：某阶段出现 n 次就是 n-1 次返工', () => {
  assert.deepEqual(reworkFromHistory([
    { stage: 'S1' }, { stage: 'S2' }, { stage: 'S2' }, { stage: 'S2' },
  ]), { S2: 2 })
})

test('reworkFromHistory 对空/坏输入返回空对象，不抛', () => {
  assert.deepEqual(reworkFromHistory([]), {})
  assert.deepEqual(reworkFromHistory(null), {})
  assert.deepEqual(reworkFromHistory([{ stage: 'S1' }, 'x', null]), {})
})

// 这是本任务存在的理由：把返工计数改小，必须有东西会红。
test('把 rework 改小会被抓住', () => {
  const s = good({
    stage: 'S2',
    rework: {},
    history: [{ stage: 'S1', at: 'x' }, { stage: 'S2', at: 'x' }, { stage: 'S2', at: 'x' }],
  })
  const r = validateState(s, { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /rework/.test(p) && /history/.test(p)))
})

test('把 rework 改大同样被抓住——两个方向都不许分叉', () => {
  const r = validateState(good({ rework: { S2: 1 } }), { stages: STAGES })
  assert.equal(r.ok, false)
})

test('history 最后一条必须等于 stage 字段', () => {
  const r = validateState(good({ stage: 'S3' }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /history/.test(p) && /stage/.test(p)))
})

test('history 不能为空——一个 run 至少进入过一个阶段', () => {
  assert.equal(validateState(good({ history: [], stage: 'S1' }), { stages: STAGES }).ok, false)
})

test('stage 必须是 stages.json 里存在的阶段', () => {
  const r = validateState(good({ stage: 'S9', history: [{ stage: 'S9', at: 'x' }] }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /S9/.test(p)))
})

test('contract_sha 要么是 PENDING 要么是 sha256:<64 hex>', () => {
  assert.equal(validateState(good({ contract_sha: 'PENDING' }), { stages: STAGES }).ok, true)
  assert.equal(validateState(good({ contract_sha: 'sha256:abc' }), { stages: STAGES }).ok, false)
  assert.equal(validateState(good({ contract_sha: 'a'.repeat(64) }), { stages: STAGES }).ok, false)
})

test('返工计数不得超过硬上限', () => {
  const history = [{ stage: 'S1', at: 'x' }]
  for (let i = 0; i <= REWORK_LIMIT + 1; i++) history.push({ stage: 'S2', at: 'x' })
  const s = good({ stage: 'S2', history, rework: reworkFromHistory(history) })
  const r = validateState(s, { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => new RegExp(String(REWORK_LIMIT)).test(p)))
})

test('escalations 的 kind 必须是五类之一', () => {
  const esc = { stage: 'S2', kind: 'whatever', question: 'q', answer: 'a', at: 'x' }
  const r = validateState(good({ escalations: [esc] }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => ESCALATION_KINDS.every((k) => p.includes(k))))
})

test('五类升级条件与规格 §5.1 一一对应', () => {
  assert.deepEqual(ESCALATION_KINDS, [
    'sensitive', 'contract-conflict', 'tradeoff', 'contract-hole', 'budget-exhausted',
  ])
})

test('缺字段逐条报出来，一次报全不要只报第一条', () => {
  const r = validateState({}, { stages: STAGES })
  assert.equal(r.ok, false)
  for (const k of ['run_id', 'stage', 'contract_sha', 'roster', 'artifacts', 'rework', 'never_invoked', 'escalations', 'history']) {
    assert.ok(r.problems.some((p) => p.includes(k)), `没有报出缺 ${k}`)
  }
})

test('state 本身不是对象时也不抛', () => {
  for (const bad of [null, [], 'x', 3, undefined]) {
    const r = validateState(bad, { stages: STAGES })
    assert.equal(r.ok, false)
    assert.ok(r.problems.length > 0)
  }
})

test('不给 stages 时跳过与阶段链有关的检查，其余照查', () => {
  assert.equal(validateState(good({ stage: 'S9', history: [{ stage: 'S9', at: 'x' }] }), {}).ok, true)
  assert.equal(validateState(good({ rework: { S2: 5 } }), {}).ok, false)
})

test('artifacts 的键必须是某个阶段的 produces', () => {
  const r = validateState(good({ artifacts: { '不是产物.md': SHA } }), { stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((x) => /不是任何阶段的 produces/.test(x)))
})

test('不给 stages 时跳过这条键名校验', () => {
  assert.equal(validateState(good({ artifacts: { '不是产物.md': SHA } }), {}).ok, true)
})

// ——— trimmed：M3a 新加的字段 ———
//
// 它记「这一趟主动裁掉了谁、在哪一段」。背景与为什么不要求写理由，见
// hooks/lib/state.mjs 里 validateState 的 trimmed 那一段注释。
//
// ⚠️ validateState 里 trimmed 的那几条形状判据，**今天在真实数据上一次也不迭代**：
// templates/state.json 的 trimmed 是 {}，Object.entries 零次，「不是对象」那一条也走不到。
// 按本仓库那条「零覆盖不等于有缺口，但零有三种」——这属于「今天零次迭代、将来会有
// 输入」那一种，锚**不能**用「派生集合非空」那一款（今天那个集合就是空的），要用
// **已知违规样本**那一款。所以下面每一条都自带一个已知违规样本，样本就是锚本身：
// 不是对象（`['at-ui']`）、值不是阶段 id（`'S9'`）、值不是字符串（`3`）、
// 键不是任何阶段的产者（`'at-outsider'`）。
//
// 这几条同时是「trimmed 缺失时不报错」那条空集合断言的正向自检锚：那一条断的是
// problems 为空，光有它时，把整段校验删掉它照样绿；有了这几条，删掉其中任何一条
// 都有东西会红（变异验证逐条跑过）。

test('trimmed 合法时通过——键是某阶段的产者，值是 stages 里存在的阶段', () => {
  const r = validateState(good({ trimmed: { 'at-architect': 'S3' } }), { stages: STAGES })
  assert.deepEqual(r.problems, [], r.problems.join('\n'))
})

// 向后兼容：M3a 之前落盘的 state.json 里根本没有这个字段，而 /agent-team:at-resume
// 会去读它们。缺失必须**不**报错——这一条红了就意味着老 run 一打开就被判成状态不合法。
test('trimmed 缺失时不报错——M3a 之前落盘的 state.json 没有这个字段', () => {
  assert.ok(!Object.hasOwn(good(), 'trimmed'), 'good() 夹具里不该有 trimmed，否则下面那句断的不是「缺失」')
  assert.deepEqual(validateState(good(), { stages: STAGES }).problems, [])
})

test('trimmed 不是对象时报出来', () => {
  const r = validateState(good({ trimmed: ['at-ui'] }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed 不是对象/.test(x)), r.problems.join('\n'))
})

test('trimmed 的值不是 stages 里的阶段时报出来', () => {
  const r = validateState(good({ trimmed: { 'at-architect': 'S9' } }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed\["at-architect"\]/.test(x) && /S9/.test(x)), r.problems.join('\n'))
})

test('trimmed 的值不是字符串时报出来——阶段 id 不能写成数字或 true', () => {
  const r = validateState(good({ trimmed: { 'at-architect': 3 } }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed\["at-architect"\] 不是字符串/.test(x)), r.problems.join('\n'))
})

// 键的合法集合是「stages 里全部阶段 stageRoles 的并集」，不是 roster.json 的键集合。
// at-outsider 在 roster.json 里真实存在，却不是任何阶段的产者——按 roster.json 校验
// 会放它过去，而裁掉一个本来就什么都不产出的角色不构成任何交代。理由见
// hooks/lib/state.mjs 那一段注释。
test('trimmed 的键不是任何阶段的产者时报出来——at-outsider 在花名册里，但它不产出任何东西', () => {
  const r = validateState(good({ trimmed: { 'at-outsider': 'S2' } }), { stages: STAGES })
  assert.ok(r.problems.some((x) => /trimmed 里有 "at-outsider"/.test(x)), r.problems.join('\n'))
})

// 与上面 artifacts 键名校验那一条同一个口径：stages 缺省时，凡是要拿 stages 当判据的
// 归属检查一律不表态。下面两条拆开，因为它们守的是两件相反的事（跳过 / 照查）。
test('不给 stages 时跳过 trimmed 的两条归属校验——键与值的归属都拿 stages 当判据', () => {
  assert.equal(validateState(good({ trimmed: { 'at-outsider': 'S9' } }), {}).ok, true)
})

// 上一条是「不表态」，光有它时把整段 trimmed 校验删掉它照样绿。这条钉住不表态的边界：
// **形状检查不在此列**——trimmed 不是对象，与有没有给 stages 无关。
test('不给 stages 时 trimmed 的形状校验照查——不是对象仍然报', () => {
  assert.equal(validateState(good({ trimmed: ['at-ui'] }), {}).ok, false)
})

test('nextStage 按 stages 的书写顺序走，不按 id 字符串排序', () => {
  assert.equal(nextStage(STAGES, 'S1'), 'S2')
  assert.equal(nextStage(STAGES, 'S3'), null)
  assert.equal(nextStage(STAGES, 'S9'), null)
  assert.equal(nextStage(null, 'S1'), null)
})

// readiness.mjs 与 deliverable.mjs 都栽过 "S10".localeCompare("S2") < 0 那一坑
// （Task 3 评审 Minor 2）。nextStage 是第三处按顺序走阶段链的地方，一起钉住。
test('nextStage 对 S9 → S10 也对——插入序不取决于数值宽度', () => {
  const wide = { S9: { role: 'r' }, S10: { role: 'r' } }
  assert.equal(nextStage(wide, 'S9'), 'S10')
})

// isStageDone：Task 6 变异验证第 4 项发现的缺口，补在这里而不是只留在
// hooks/gate.mjs 内联——那处代码只经子进程级测试跑到，而仓库根真实 stages.json
// 里每个阶段的 produces 都只有一个元素，.every 与 .some 在单元素数组上永远同值，
// 子进程级测试判不出两者的差异（完整背景见本函数在 hooks/lib/state.mjs 里的
// 头部注释）。下面用一份合成的多产物阶段夹具，真正把 .every 的「全部」语义
// （不是 .some 的「任一」）钉住。
const have = (...names) => (rel) => names.includes(rel)
const MULTI = { S2: { role: 'at-product', requires: [], produces: ['a.md', 'b.md'] } }

test('isStageDone：produces 全部存在时为 true', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('a.md', 'b.md') }), true)
})

// 这条是全部意义所在：只有一个产物存在时，.every 必须是 false——如果这里误用
// .some，任何一个产物一到位就会误报「这个阶段齐了」，提前催 PM 推进阶段、
// 在 history 里记一条它压根没做完的记录。
test('isStageDone：只有部分 produces 存在时为 false（.every 不是 .some）', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('a.md') }), false)
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have('b.md') }), false)
})

test('isStageDone：一个产物都没有时为 false', () => {
  assert.equal(isStageDone({ stage: 'S2', stages: MULTI, artifactExists: have() }), false)
})

test('isStageDone：produces 为空数组时为 false——没有产物义务不算"齐了"', () => {
  const stages = { S1: { role: 'at-pm', requires: [], produces: [] } }
  assert.equal(isStageDone({ stage: 'S1', stages, artifactExists: have() }), false)
})

test('isStageDone：stage 在 stages 里查不到、或 stages 本身不是对象时为 false，不抛', () => {
  assert.equal(isStageDone({ stage: 'S9', stages: MULTI, artifactExists: have() }), false)
  assert.equal(isStageDone({ stage: 'S2', stages: null, artifactExists: have() }), false)
  assert.equal(isStageDone({ stage: undefined, stages: MULTI, artifactExists: have() }), false)
})

// M2a：roster 可选参数。S5 这种多产者阶段，「齐了」取决于这一趟实际派了谁——
// 上面五条都不传 roster，走的是「退回全部 producers」那条兼容路径，不受这里影响。
const S5_MULTI = {
  S5: { role: 'at-backend', producers: ['at-backend', 'at-frontend'], produces: ['05-impl/<role>.md'] },
}

test('isStageDone：S5 只按 roster 里的执行角色判——没派到的角色不拖住推进', () => {
  const done = isStageDone({
    stage: 'S5', stages: S5_MULTI, roster: ['at-backend'],
    artifactExists: have('05-impl/at-backend.md'),
  })
  assert.equal(done, true)
})

test('isStageDone：roster 里有两个执行角色而只交了一个时为 false', () => {
  const done = isStageDone({
    stage: 'S5', stages: S5_MULTI, roster: ['at-backend', 'at-frontend'],
    artifactExists: have('05-impl/at-backend.md'),
  })
  assert.equal(done, false)
})

test('isStageDone：roster 缺省时按全部 producers 判——不传 roster 不等于不判', () => {
  const done = isStageDone({
    stage: 'S5', stages: S5_MULTI,
    artifactExists: have('05-impl/at-backend.md'),
  })
  assert.equal(done, false)
})

// Task 7：驳回路由。规格 §4.3 那张表此前没有任何代码消费它，nextStage 只会前进一格。
// rejectTo(kind) 把那张表搬进代码，成为单一真源。
test('rejectTo：需求理解错回到 S2', () => {
  assert.equal(rejectTo('requirement'), 'S2')
})

test('rejectTo：设计错回到 S3', () => {
  assert.equal(rejectTo('design'), 'S3')
})

test('rejectTo：实现错回到 S5', () => {
  assert.equal(rejectTo('implementation'), 'S5')
})

test('rejectTo：契约内在矛盾不由代码决定回哪，返回 null 走升级', () => {
  assert.equal(rejectTo('contract-conflict'), null)
})

test('rejectTo：不认识的 kind 返回 null，不抛', () => {
  assert.equal(rejectTo('nonsense'), null)
})

test('前置条件：REJECTION_KINDS 恰好是规格 §4.3 的四类', () => {
  assert.deepEqual([...REJECTION_KINDS], ['requirement', 'design', 'implementation', 'contract-conflict'])
})

test('contract-conflict 同时也是 ESCALATION_KINDS 的一类——它走升级不走路由', () => {
  assert.ok(ESCALATION_KINDS.includes('contract-conflict'))
})

// 这条防的是将来有人顺手给 validateState 加一条「stage 只能前进」的校验，把
// rejectTo 刚搬进代码的回退路径静默掐断。validateState 现在不校验阶段前后关系，
// 所以这条测试今天就该是绿的——它的价值在未来，不在今天。
//
// 不能复用顶部的 STAGES：那份只到 S3，而且下面「nextStage 按 stages 的书写顺序走」
// 那条测试依赖 STAGES 恰好在 S3 处到头（nextStage(STAGES, 'S3') === null）。把
// STAGES 扩到 S5/S6 会让那条测试从绿变红——单独建一份只给这条测试用的 stages 夹具。
const STAGES_WITH_REWORK = {
  S5: { role: 'at-backend', requires: [], produces: ['05-impl/at-backend.md'] },
  S6: { role: 'at-qa', requires: ['05-impl/at-backend.md'], produces: ['06-test-report.md'] },
}

test('回退后的 state 仍然合法：stage 指向更早的阶段、history 追加一条、rework 跟着涨', () => {
  const state = {
    run_id: '20260919-0421-x', stage: 'S5', contract_sha: SHA,
    roster: ['at-backend'], artifacts: {}, never_invoked: [], escalations: [],
    rework: { S5: 1 },
    history: [{ stage: 'S5', at: 'x' }, { stage: 'S6', at: 'x' }, { stage: 'S5', at: 'x' }],
  }
  assert.deepEqual(validateState(state, { stages: STAGES_WITH_REWORK }).problems, [])
})

// 规格 §4.3 ↔ 代码的闭包：那张表的单一真源现在是 rejectTo(kind)，这两条测试把
// 规格正文与代码钉在一起。**必须成对**——下面这条从规格正则解析出三行、逐行核对
// rejectTo；正则一旦因为规格改排版而匹配不到，循环零次，那条测试会全绿而不是报错。
// 紧跟着的前置条件测试就是防这个：钉住「真的解析出了 3 行」。
//
// ⚠️ 用 Write 工具落的这两条，没有走 Bash heredoc——heredoc 会吞掉正则里 \| 与 \d
// 的反斜杠，导致测试假绿（M1c 终审复评踩过这个坑）。
test('规格 §4.3 表里的每一行都能在 rejectTo 里命中', () => {
  const spec = readFileSync(new URL('../docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md', import.meta.url), 'utf8')
  const rows = [...spec.matchAll(/^\| (需求理解错|设计错|实现错) \| .*? \| (S\d) → S8 \|$/gm)]
  const byLabel = { 需求理解错: 'requirement', 设计错: 'design', 实现错: 'implementation' }
  for (const m of rows) {
    assert.equal(rejectTo(byLabel[m[1]]), m[2], `规格 §4.3 的「${m[1]}」写的是回到 ${m[2]}，rejectTo 答的是 ${rejectTo(byLabel[m[1]])}`)
  }
})

test('前置条件：上一条真的从规格里解析出了 3 行——否则它是空转', () => {
  const spec = readFileSync(new URL('../docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md', import.meta.url), 'utf8')
  const rows = [...spec.matchAll(/^\| (需求理解错|设计错|实现错) \| .*? \| (S\d) → S8 \|$/gm)]
  assert.equal(rows.length, 3)
})
