// H5 交付物校验的纯函数核心——decideDeliverable 不碰文件系统
// （artifactExists 由调用方注入），可以脱离 Claude Code 与磁盘单测。
// 它同时喂 H5b（SubagentStop，真拦截）与 H5a（PostToolUse，权威记录）
// 两条 hook；这两条 hook 在 gate.mjs 里各自怎么从输入中挖出角色、怎么读
// 运行上下文、deny/warning 怎么传导——那部分入口传导链由
// tests/gate-deliverable.test.mjs 的子进程级测试覆盖，不在这里重复
// （Task 3 的教训：纯函数测试和入口传导链测试要分开覆盖，只测前者会漏掉
// 字段选错、ctx 分派这类真实发生过的问题）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideDeliverable, isBubbleStop, BUBBLE_MARK, BUBBLE_EXIT } from '../hooks/lib/deliverable.mjs'
import { SUBAGENT_STOP_RETRY_NOTE } from '../hooks/lib/retry-budget.mjs'

const STAGES = {
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  S3: { role: 'at-architect', requires: ['01-prd.md'], produces: ['03-arch.md'] },
}
const have = (...names) => (rel) => names.includes(rel)

test('产物已写时 ok', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: STAGES, artifactExists: have('01-prd.md') })
  assert.equal(r.ok, true)
})

test('产物未写时不 ok，并列出缺的是哪些', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: STAGES, artifactExists: have() })
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ['01-prd.md'])
})

test('理由点名阶段与文件', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: STAGES, artifactExists: have() })
  assert.match(r.reason, /S2/)
  assert.match(r.reason, /01-prd\.md/)
})

// 简报原稿这里写的角色名是 'at-worker-a'——已删除的旧名（Task 6 简报「简报
// 已经过时的地方」第 4 条）。换成 at-outsider：花名册里真实存在、但设计上
// 从不出现在任何阶段里的角色（仓库根真实 stages.json 没有一条 role 是
// at-outsider），比随便一个"恰好没写进这个局部 STAGES 夹具"的角色更能
// 说明这条测试到底在验证什么。
test('不在阶段链里的角色没有交付物义务', () => {
  const r = decideDeliverable({ role: 'at-outsider', stageId: 'S2', stages: STAGES, artifactExists: have() })
  assert.equal(r.ok, true)
})

test('stages 缺失时不判定为失败——门禁坏了不该诬告角色', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: null, artifactExists: have() })
  assert.equal(r.ok, true)
})

// produces 为空这条边界，decideDeliverable 与 hooks/lib/readiness.mjs 的
// decideReadiness 面对的是同一份 stages.json、同一组情形——两边对"没有产物
// 义务的阶段要不要拦"这件事语义不能打架，否则 H2 与 H5 会对同一个阶段给出
// 不一致的答案。
//
// "角色身兼多阶段时，先判定哪一段"这条边界，M1b 之前两个函数共用同一条迭代
// 规则（都取该角色第一个未完成的阶段）。Task 7 把 decideDeliverable 改成只
// 认调用方传入的 stageId、不再自己迭代所有阶段——这正是这次改动要修的 bug
// 本体（见 hooks/lib/deliverable.mjs 头部【M1b 改】那段）。原来这里还有一条
// "同一角色的多个阶段按插入序判定"的测试，验的是 decideDeliverable 自己遍历
// mine 数组、跳过已完成阶段这条逻辑；这条逻辑随这次改动整体删除了（新实现是
// stages[stageId] 直查，不再有第二个候选阶段可比顺序），继续留着那条测试、
// 只补一个 stageId 参数，会让它退化成跟上面"产物未写时不 ok"完全同构的重复
// 断言，而测试名和注释仍然宣称在验证"插入序"——这正是这个项目反复栽过的失效
// 形状（一个看起来在验证某件事、实际什么都没验的断言）。删掉它，覆盖它原本
// 要防的回归("不再自己找第一个未完成的阶段")的是下面新增的第一条测试，
// 用的是规格 §4 里真实会出现的场景（at-architect 身兼 S3 与 S5），比原来
// S2/S10 这个纯为了避开字典序而造的合成夹具更贴近会真正发生的情形。
test('produces 为空的阶段视为跳过（不检查），与 decideReadiness 的已知边界一致', () => {
  // decideReadiness 那边这条边界的完整说明见 hooks/lib/readiness.mjs
  // Task 3 评审 Minor 3 的注释：纯评审类、不产出文件的阶段两边都不设防，
  // 是同一个已知边界，不是 decideDeliverable 单独引入的新缺口。
  const stages = { S1: { role: 'at-pm', requires: [], produces: [] } }
  const r = decideDeliverable({ role: 'at-pm', stageId: 'S1', stages, artifactExists: have() })
  assert.equal(r.ok, true)
})

// 下面四条覆盖 M1b Task 7 的新语义：decideDeliverable 现在只认调用方传入的
// stageId，不再自己猜"该看哪一段"。

test('按传入的 stageId 判定，不再自己找「第一个未完成的阶段」', () => {
  // at-architect 同时是 S3 与 S5 的执行者——规格 §4 的完整阶段链就是这样。
  // 它刚交完 S3（03-arch.md 在磁盘上），S5 的产物当然还没有。
  const stages = {
    S3: { role: 'at-architect', requires: [], produces: ['03-arch.md'] },
    S5: { role: 'at-architect', requires: [], produces: ['05-impl/index.md'] },
  }
  const exists = (p) => p === '03-arch.md'
  // 老规则会拿 S5 的缺失产物把刚交完 S3 的它顶回去，顶到平台静默放行为止
  // （顶多少下不写在这里，单一真源是 hooks/lib/retry-budget.mjs）。
  assert.deepEqual(
    decideDeliverable({ role: 'at-architect', stageId: 'S3', stages, artifactExists: exists }),
    { ok: true },
  )
  // 真到了 S5 才该拦。
  const r = decideDeliverable({ role: 'at-architect', stageId: 'S5', stages, artifactExists: exists })
  assert.equal(r.ok, false)
  assert.equal(r.stageId, 'S5')
})

test('角色不是当前阶段的执行者：不表态，但说明为什么', () => {
  const stages = { S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] } }
  const r = decideDeliverable({ role: 'at-backend', stageId: 'S2', stages, artifactExists: () => false })
  assert.deepEqual(r, { ok: true, skipped: 'role-not-in-stage' })
})

test('stageId 查不到（缺失、或 state.stage 是个不存在的阶段）：不表态，并说明为什么', () => {
  const stages = { S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] } }
  for (const stageId of [undefined, null, 'S9', 3]) {
    assert.deepEqual(
      decideDeliverable({ role: 'at-product', stageId, stages, artifactExists: () => false }),
      { ok: true, skipped: 'unknown-stage' },
    )
  }
})

test('当前阶段没有 produces 义务：不表态', () => {
  const stages = { S3: { role: 'at-architect', requires: [], produces: [] } }
  assert.deepEqual(
    decideDeliverable({ role: 'at-architect', stageId: 'S3', stages, artifactExists: () => false }),
    { ok: true },
  )
})

// hooks/lib/deliverable.mjs 用 Object.hasOwn(stages, stageId) 而不是下标访问
// stages[stageId]，理由与 decideDelegation 查花名册条目时改用 Object.hasOwn 是同一条
// （规格 §6.0 第 5 条 / tests/decide.test.mjs 的退化形态覆盖）：原型链上自带的属性名
// 会让"查得到条目"这件事凭空成立。stageId 来自 state.json 的 stage 字段，那是一个
// 磁盘上的字符串，不该假设它一定是个正经阶段 id。
//
// ⚠️ 这条单独占一个 test()：它是这道防线唯一的证明。此前用 undefined/null/'S9'/3
// 四个值的那条测试撞不上原型链的键，把 Object.hasOwn 退化成下标访问后全量仍然零红
// （评审实测；本任务的复核重新跑过一遍，结论一致：280 条不变、全绿）。
//
// __proto__ 单独核实过是否与另外四个一致，而不是假设一致：Object.hasOwn(stages,
// '__proto__') 是 false（它不是 stages 的 own key，只是 Object.prototype 上的一对
// 访问器），下标访问 stages['__proto__'] 拿到的是 Object.prototype 本身（真值、
// .role 是 undefined）——退化后的表现与 constructor/toString/hasOwnProperty/valueOf
// 完全一致（都从 unknown-stage 变成 role-not-in-stage），所以放进同一个循环，不拆开。
test('stageId 是原型链上的属性名时也算查不到——不能凭空冒出一个阶段', () => {
  const stages = { S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] } }
  for (const stageId of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    assert.deepEqual(
      decideDeliverable({ role: 'at-product', stageId, stages, artifactExists: () => false }),
      { ok: true, skipped: 'unknown-stage' },
      `stageId 为 ${stageId} 时应当归成 unknown-stage`,
    )
  }
})

// Task 4：brief 与设计文档都没提到、落地 stages.json 的 <role> 模式时随手发现的一处
// 必改点——decideDeliverable 原来直接拿 stage.produces（对 S5 是字面量
// ["05-impl/<role>.md"]，含占位符）去问 artifactExists，永远问不到真实存在的文件。
// 下面三条：第一条证明真正写出实现记录后 ok 变 true（这是修复本体：改之前这条
// 恒 false，因为 artifactExists 只认得 '05-impl/at-backend.md' 这个展开后的名字，
// 从不会被传入字面量 '05-impl/<role>.md'）；第二、三条证明 missing/reason 里带的
// 是展开后的真实文件名，不是原样的占位符字面量——避免"改对了返回值的 true/false，
// 但 missing 里仍然泄漏着 <role> 占位符"这种半吊子修复蒙混过关。
const S5_MULTI = {
  role: 'at-backend',
  producers: ['at-backend', 'at-frontend'],
  requires: [],
  produces: ['05-impl/<role>.md'],
}

test('M2a：S5 是 <role> 模式时，S5.role 本身（at-backend）交付了真实文件——ok 为 true', () => {
  const r = decideDeliverable({
    role: 'at-backend', stageId: 'S5', stages: { S5: S5_MULTI },
    artifactExists: (p) => p === '05-impl/at-backend.md',
  })
  assert.equal(r.ok, true)
})

test('M2a：S5 是 <role> 模式时，S5.role 本身没交付——missing 里是展开后的真实文件名，不是字面量占位符', () => {
  const r = decideDeliverable({
    role: 'at-backend', stageId: 'S5', stages: { S5: S5_MULTI },
    artifactExists: () => false,
  })
  assert.deepEqual(r.missing, ['05-impl/at-backend.md'])
})

test('M2a：reason 文案里点名的也是展开后的文件名', () => {
  const r = decideDeliverable({
    role: 'at-backend', stageId: 'S5', stages: { S5: S5_MULTI },
    artifactExists: () => false,
  })
  assert.match(r.reason, /05-impl\/at-backend\.md/)
})

// M2a Task 9 实测发现的第九处 <role> 消费方：归属判据。
//
// Task 4 把 S5 改成多产者（producers: at-backend/at-frontend/at-ui/at-ios/at-android）
// 并修了 produces 的展开，但归属判据仍是 `stage.role !== role`（单数）。后果两条：
//   1. H5 从不检查 at-frontend/at-ui/at-ios/at-android 在 S5 的交付物——它们是合法产者，
//      却在归属判据这一步就被判成「没有交付义务」，下面的 expandProduces 永远走不到
//   2. H5a 对它们发假告警（「不是执行者、而且派不到那个执行者」——第二句拓扑上为真，
//      结论却是错的）
//
// 改成 stageRoles(stage).includes(role) 之后，producers 里每一个都被正常检查。
const S5_PRODUCERS = {
  S5: {
    role: 'at-backend',
    producers: ['at-backend', 'at-frontend', 'at-ui'],
    requires: [],
    produces: ['05-impl/<role>.md'],
  },
}

test('S5 多产者：at-frontend 交了自己的实现记录 → ok，不再被判成「没有交付义务」', () => {
  const r = decideDeliverable({
    role: 'at-frontend', stageId: 'S5', stages: S5_PRODUCERS,
    artifactExists: (p) => p === '05-impl/at-frontend.md',
  })
  assert.equal(r.ok, true)
})

test('S5 多产者：at-frontend 没交时 H5 要报它缺自己那份，不是沉默跳过', () => {
  const r = decideDeliverable({
    role: 'at-frontend', stageId: 'S5', stages: S5_PRODUCERS,
    artifactExists: () => false,
  })
  assert.deepEqual(r.missing, ['05-impl/at-frontend.md'])
})

test('S5 多产者：at-frontend 没交时不是 skipped —— skipped 会让 H5a 发那条假告警', () => {
  const r = decideDeliverable({
    role: 'at-frontend', stageId: 'S5', stages: S5_PRODUCERS,
    artifactExists: () => false,
  })
  assert.equal(r.skipped, undefined)
})

test('S5 多产者：不在 producers 里的角色仍然是 role-not-in-stage（at-architect 是派发发起者，不是产者）', () => {
  const r = decideDeliverable({
    role: 'at-architect', stageId: 'S5', stages: S5_PRODUCERS,
    artifactExists: () => true,
  })
  assert.equal(r.skipped, 'role-not-in-stage')
})

test('前置条件：S5_PRODUCERS 的 producers 确实有三个且 at-architect 不在其中——上一条不是空转', () => {
  assert.deepEqual(S5_PRODUCERS.S5.producers, ['at-backend', 'at-frontend', 'at-ui'])
})

// ---------------------------------------------------------------------------
// M3y（docs/33，全量审查第 15 条）：返工轮里还是上一轮的产物
// ---------------------------------------------------------------------------
//
// 调用方把 artifactExists 换成 freshness 的 artifactCurrent（在、而且不是上一轮的），另传 artifactStale（还是上一轮的）。
// 「缺」与「还是上一轮的」分开报：前者是没写，后者是写了、但这一轮没动过——出口不一样（后者可以在末尾追加一节说明这一轮
// 核过、不用改）。没有上一轮的产物时，文案与 v1.6.0 逐字相同。
const REAL = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const fresh = ({ current = [], stale = [] }) => ({
  artifactExists: (n) => current.includes(n),
  artifactStale: (n) => stale.includes(n),
})

// M4c（docs/37，审查第 18 条）：出口那半句从「把理由写进你的回报，由上级判断」（门禁从来不认）换成教冒泡的那一句。
test('M3y：没有上一轮的产物时，理由是固定的那一句（M4c 起末尾教冒泡的出口）', () => {
  const r = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: REAL, ...fresh({}) })
  assert.equal(
    r.reason,
    'at-product 在 S2 应当产出 01-prd.md，但 01-prd.md 还没有写到磁盘上。在结束之前把它写出来。' +
      `确实交不出来、要上级定的（契约有问题、缺输入、写入被拒），${BUBBLE_EXIT}`,
  )
  assert.deepEqual(r.stale, [])
  const old = decideDeliverable({ role: 'at-product', stageId: 'S2', stages: REAL, artifactExists: have() })
  assert.equal(old.reason, r.reason, '不传 artifactStale 时与传了、但一份都不旧时一样')
})

test('M3y：产物还是上一轮的 → 不 ok，归 stale 不归 missing', () => {
  const r = decideDeliverable({ role: 'at-backend', stageId: 'S5', stages: REAL, ...fresh({ stale: ['05-impl/at-backend.md'] }) })
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.stale, ['05-impl/at-backend.md'])
})

test('M3y：上一轮的产物，理由说清是上一轮的、给两条出口（追加一节说明 / 不写、冒泡）', () => {
  const r = decideDeliverable({ role: 'at-backend', stageId: 'S5', stages: REAL, ...fresh({ stale: ['05-impl/at-backend.md'] }) })
  assert.match(r.reason, /05-impl\/at-backend\.md 还是上一轮的/)
  assert.match(r.reason, /末尾追加一节/)
  assert.ok(r.reason.includes(BUBBLE_EXIT), r.reason)
  assert.ok(!r.reason.includes('把理由写进你的回报'), r.reason)
  assert.doesNotMatch(r.reason, /还没有写到磁盘上/, '在磁盘上的不能说成没写')
  assert.doesNotMatch(r.reason, /<!--/, '.md 不提 HTML 注释')
})

test('M3y：上一轮的是 .html → 追加的那一节用 HTML 注释写', () => {
  const r = decideDeliverable({
    role: 'at-ui',
    stageId: 'S2',
    stages: REAL,
    ...fresh({ current: ['02-ui-spec.md'], stale: ['02-wireframe.html'] }),
  })
  assert.deepEqual(r.stale, ['02-wireframe.html'])
  assert.match(r.reason, /<!-- -->/)
})

test('M3y：一份没写、一份是上一轮的 → 两样分开报', () => {
  const r = decideDeliverable({ role: 'at-ui', stageId: 'S2', stages: REAL, ...fresh({ stale: ['02-wireframe.html'] }) })
  assert.deepEqual(r.missing, ['02-ui-spec.md'])
  assert.deepEqual(r.stale, ['02-wireframe.html'])
  assert.match(r.reason, /02-ui-spec\.md 还没有写到磁盘上/)
  assert.match(r.reason, /02-wireframe\.html 还是上一轮的/)
})

test('M3y：重写过（current）的不报', () => {
  const r = decideDeliverable({ role: 'at-backend', stageId: 'S5', stages: REAL, ...fresh({ current: ['05-impl/at-backend.md'] }) })
  assert.equal(r.ok, true)
})

// .html 的那句提示按「还旧的」判，不按整段 produces：at-ui 只有 .md 那份还旧时不提 HTML 注释。
test('M3y：at-ui 只有 02-ui-spec.md 还旧 → 不提 HTML 注释', () => {
  const r = decideDeliverable({ role: 'at-ui', stageId: 'S2', stages: REAL, ...fresh({ current: ['02-wireframe.html'], stale: ['02-ui-spec.md'] }) })
  assert.deepEqual(r.stale, ['02-ui-spec.md'])
  assert.doesNotMatch(r.reason, /<!--/)
})

// M4a 文档核对：空文件单独说「是空文件」，不说成「还没有写到磁盘上」。
test('M4a 核对 H5b：产物是空文件 → 拒，理由说是空文件', () => {
  const STAGES6 = { S6: { role: 'at-qa', requires: [], produces: ['06-test.md'] } }
  const r = decideDeliverable({ role: 'at-qa', stageId: 'S6', stages: STAGES6, artifactExists: () => false, artifactBlank: (n) => n === '06-test.md' })
  assert.equal(r.ok, false)
  assert.match(r.reason, /06-test\.md 是空文件/)
  assert.doesNotMatch(r.reason, /还没有写到磁盘上/)
})

// ---------------------------------------------------------------------------
// M4c（docs/37，审查第 18 条）：冒泡的出口
// ---------------------------------------------------------------------------
//
// 门禁认的形状：已经被拦过一回（stop_hook_active 为真），最后一条回复的第一个非空行以「冒泡：」开头（容许行首的 Markdown
// 装饰与半角冒号）。只认第一行、只认 true：标记夹在正文里、或者第一回停下就带着标记，都照拦——第一回先让它看到缺的是什么。
test('M4c isBubbleStop：只在 stop_hook_active 为真、第一个非空行以标记开头时为真', () => {
  const half = BUBBLE_MARK.slice(0, -1) + ':'
  const yes = [
    `${BUBBLE_MARK}契约冲突`,
    `**${BUBBLE_MARK}**契约冲突`,
    `# ${BUBBLE_MARK}契约冲突`,
    `## ${BUBBLE_MARK}契约冲突`,
    `> ${BUBBLE_MARK}契约冲突`,
    `- ${BUBBLE_MARK}契约冲突`,
    `* ${BUBBLE_MARK}契约冲突`,
    `\`${BUBBLE_MARK}\`契约冲突`,
    `\n\n   ${BUBBLE_MARK}契约冲突\n细节`,
    `${half}契约冲突`,
  ]
  for (const lastMessage of yes) assert.equal(isBubbleStop({ stopHookActive: true, lastMessage }), true, JSON.stringify(lastMessage))
  const no = [
    [false, `${BUBBLE_MARK}契约冲突`],
    [undefined, `${BUBBLE_MARK}契约冲突`],
    ['true', `${BUBBLE_MARK}契约冲突`],
    [true, `我看了契约。\n${BUBBLE_MARK}契约冲突`],
    [true, `${BUBBLE_MARK.slice(0, -1)}排序写完了`],
    [true, ''],
    [true, '   \n  '],
    [true, undefined],
    [true, 42],
    [true, null],
  ]
  for (const [stopHookActive, lastMessage] of no) {
    assert.equal(isBubbleStop({ stopHookActive, lastMessage }), false, JSON.stringify([stopHookActive, lastMessage]))
  }
  assert.equal(isBubbleStop(), false, '缺参数不抛')
})

test('M4c：缺/空与还旧两支的拒绝文案都教同一个出口（标记原样写出、说清原样再停一次），不再许诺门禁不认的「写进回报」', () => {
  const missing = decideDeliverable({ role: 'at-architect', stageId: 'S3', stages: REAL, ...fresh({}) })
  const blank = decideDeliverable({ role: 'at-architect', stageId: 'S3', stages: REAL, artifactExists: () => false, artifactBlank: (n) => n === '03-arch.md' })
  const stale = decideDeliverable({ role: 'at-qa', stageId: 'S6', stages: REAL, ...fresh({ stale: ['06-test.md'] }) })
  for (const r of [missing, blank, stale]) {
    assert.equal(r.ok, false)
    assert.ok(r.reason.includes(BUBBLE_MARK), r.reason)
    assert.ok(r.reason.includes(BUBBLE_EXIT), r.reason)
    assert.ok(!r.reason.includes('把理由写进你的回报'), r.reason)
  }
  assert.ok(BUBBLE_EXIT.includes('原样再停一次'), BUBBLE_EXIT)
  assert.ok(BUBBLE_EXIT.includes('产物照旧算没交'), '要说清冒泡不等于交了')
})

// M4c：平台续跑上限那句改成 CLI 2.1.286 源码与实测核过的事实（docs/37 §1）：默认连续拦截有上限、到点静默覆盖，环境变量改得了、
// 设为 0 不设上限，两次停下之间调过工具计数清零；产物不在的另一种可能是冒泡。计数只在这个常量里（单一真源判据钉着）。
test('M4c SUBAGENT_STOP_RETRY_NOTE：说出冒泡这一种可能、点名环境变量与清零，不再说「不是一个固定值」', () => {
  assert.ok(SUBAGENT_STOP_RETRY_NOTE.includes(BUBBLE_MARK), SUBAGENT_STOP_RETRY_NOTE)
  assert.ok(SUBAGENT_STOP_RETRY_NOTE.includes('CLAUDE_CODE_STOP_HOOK_BLOCK_CAP'), SUBAGENT_STOP_RETRY_NOTE)
  assert.ok(SUBAGENT_STOP_RETRY_NOTE.includes('设为 0'), SUBAGENT_STOP_RETRY_NOTE)
  assert.ok(SUBAGENT_STOP_RETRY_NOTE.includes('清零'), SUBAGENT_STOP_RETRY_NOTE)
  assert.ok(!SUBAGENT_STOP_RETRY_NOTE.includes('不是一个固定值'), SUBAGENT_STOP_RETRY_NOTE)
})
