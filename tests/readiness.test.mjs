import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideReadiness } from '../hooks/lib/readiness.mjs'

const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
  S3: { role: 'at-architect', requires: ['00-contract.md', '01-prd.md'], produces: ['03-arch.md'] },
}

const have = (...names) => (rel) => names.includes(rel)

test('前置产物齐全时放行', () => {
  const r = decideReadiness({ targetRole: 'at-product', stages: STAGES, artifactExists: have('00-contract.md') })
  assert.equal(r.decision, 'allow')
})

test('前置产物缺失时拒绝', () => {
  const r = decideReadiness({ targetRole: 'at-product', stages: STAGES, artifactExists: have() })
  assert.equal(r.decision, 'deny')
})

test('拒绝理由点名缺的是哪个产物', () => {
  const r = decideReadiness({ targetRole: 'at-product', stages: STAGES, artifactExists: have() })
  assert.match(r.reason, /00-contract\.md/)
})

test('拒绝理由指明该先跑哪一阶段', () => {
  const r = decideReadiness({ targetRole: 'at-architect', stages: STAGES, artifactExists: have('00-contract.md') })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /01-prd\.md/)
  assert.match(r.reason, /S2/, '应当告诉调用者 01-prd.md 是 S2 的产物')
  // Task 3 评审 Minor 1：S3 的 requires 有两项，00-contract.md 已经满足、
  // 只有 01-prd.md 缺。只断言缺的那项出现，抓不住「missing 没过滤、把已满足
  // 的也一起报出来」这种改法——那样改了上面三条 assert 照样全绿。
  assert.doesNotMatch(r.reason, /00-contract/, '00-contract.md 已经齐了，不该出现在缺失清单里')
})

test('无前置的阶段一律放行', () => {
  const r = decideReadiness({ targetRole: 'at-pm', stages: STAGES, artifactExists: have() })
  assert.equal(r.decision, 'allow')
})

test('不在阶段链里的角色不归本门禁管，放行', () => {
  // Task 3 评审 Important 2：at-worker-a 是 c3dc888 已经改名清掉的占位角色名，
  // 不该在新测试里复活。这条用例的语义是"一个真实存在、但不在阶段链里的
  // 角色"，用 at-outsider（roster.json 里真实存在，stages.json 里确实没有
  // 它的阶段）才是这个语义，用一个不存在的名字反而测的是另一件事。
  const r = decideReadiness({ targetRole: 'at-outsider', stages: STAGES, artifactExists: have() })
  assert.equal(r.decision, 'allow')
})

test('一个角色出现在多个阶段时，取尚未完成的最早那个', () => {
  // at-pm 同时是 S1 与 S4 的执行角色。S1 的产物已在、S4 的前置未齐时，
  // 应当按 S4 判定而不是按 S1 放行。
  const stages = {
    S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
    S4: { role: 'at-pm', requires: ['01-prd.md'], produces: ['04-dispatch.md'] },
  }
  const r = decideReadiness({ targetRole: 'at-pm', stages, artifactExists: have('00-contract.md') })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /01-prd\.md/)
})

// Task 3 评审 Minor 2："S10".localeCompare("S2") < 0——字典序会把 S10 排到
// S2 前面。stages.json 的书写顺序（Object.entries 的插入序）本来就是流水线
// 顺序，不该重新按字典序排。这条钉住"按书写顺序判定"这个真实的实现选择：
// 旧的 localeCompare 实现会先查到 requires 为空的 S10、判它已完成，
// 于是漏过 S2 真正缺失的前置，整条错判成 allow。
test('多阶段同角色按 stages 的书写顺序判定，不按阶段 id 的字典序', () => {
  const stages = {
    S2: { role: 'at-pm', requires: ['x'], produces: ['02.md'] },
    S10: { role: 'at-pm', requires: [], produces: ['10.md'] },
  }
  const r = decideReadiness({ targetRole: 'at-pm', stages, artifactExists: have() })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /S2/, '应当按书写顺序先判定 S2，不能被字典序排到 S10 后面')
})

// M2a Task 4 之后的穷举 grep 找出的第三处 <role> 消费方（前两处 writepath.mjs 的
// producesOf 与 deliverable.mjs 的 decideDeliverable 由 Task 4 实现者抓到并修了）。
// 这里的两条判据原来直接读字面量 stage.produces：
//   - producerOf：查不到 05-impl/at-backend.md 的归属，错误文案丢掉「（S5 的产物）」
//   - done：artifactExists('05-impl/<role>.md') 恒假 → S5 永远判未完成
const M2A_STAGES = {
  S4: { role: 'at-pm', requires: [], produces: ['04-dispatch.md'] },
  S5: {
    role: 'at-backend',
    producers: ['at-backend', 'at-frontend'],
    requires: ['04-dispatch.md'],
    produces: ['05-impl/<role>.md'],
  },
}

test('H2：<role> 阶段的 done 判据按 roster 展开——这一趟只派了后端且它交了，S5 算完成', () => {
  const r = decideReadiness({
    targetRole: 'at-backend',
    stages: M2A_STAGES,
    roster: ['at-backend'],
    artifactExists: (p) => ['04-dispatch.md', '05-impl/at-backend.md'].includes(p),
  })
  assert.equal(r.decision, 'allow')
})

test('H2：<role> 阶段 done 判据不再拿字面量去查磁盘——artifactExists 收到的名字里不含 <role>', () => {
  const seen = []
  decideReadiness({
    targetRole: 'at-backend',
    stages: M2A_STAGES,
    roster: ['at-backend'],
    artifactExists: (p) => { seen.push(p); return true },
  })
  assert.equal(seen.some((p) => p.includes('<role>')), false, `artifactExists 收到了含占位符的名字：${JSON.stringify(seen)}`)
})

test('前置条件：上一条的 artifactExists 真的被调用过——否则「没收到占位符」是空转', () => {
  const seen = []
  decideReadiness({
    targetRole: 'at-backend',
    stages: M2A_STAGES,
    roster: ['at-backend'],
    artifactExists: (p) => { seen.push(p); return true },
  })
  assert.ok(seen.length > 0)
})

test('H2：producerOf 认得出 <role> 展开后的产物归属——缺失项的错误文案要点名它是哪一段的产物', () => {
  const r = decideReadiness({
    targetRole: 'at-qa',
    stages: {
      ...M2A_STAGES,
      S6: { role: 'at-qa', requires: ['05-impl/at-backend.md'], produces: ['06-test.md'] },
    },
    roster: ['at-backend', 'at-qa'],
    artifactExists: (p) => p === '04-dispatch.md',
  })
  assert.match(r.reason, /05-impl\/at-backend\.md（S5 的产物）/)
})

// Task 6 评审发现的同一族第三处，而且是三处里最危险的一处。
//
// gate.mjs 三处同构的 `Array.isArray(ctx.state?.roster) ? ctx.state.roster : undefined`
// 实测差异（直接调纯函数，真实 stages.json）：
//   compareArtifacts  undefined → 报出伪造产物；[] → **不报**（已由 gate-deliverable.test.mjs 覆盖）
//   isStageDone       undefined → false；[]  → false  —— **不可观测**，没有可测的东西
//   decideReadiness   undefined → **deny**；[] → **allow** —— 本条覆盖它
//
// 最后一条方向最糟：`[]` 会让 H2 **停止拒绝**一次前置产物缺失的派发。原因是
// `expandProduces(stage, [])` 对带 <role> 的 produces 返回空数组，而空数组 `.every`
// 恒为 true → 该阶段被判「已完成」→ `continue` 跳过，它的 requires 永远不被检查。
test('H2：state.roster 不是数组时退回全部 producers——前置产物缺失仍然 deny，不会因为空集合而误判「已完成」', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({
    targetRole: 'at-backend',
    stages,
    artifactExists: () => false,
    roster: undefined,
  })
  assert.equal(r.decision, 'deny')
})

test('前置条件：同一夹具传合法 roster 时也 deny——上一条不是靠 roster 的取值碰巧绿的', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({
    targetRole: 'at-backend',
    stages,
    artifactExists: () => false,
    roster: ['at-backend'],
  })
  assert.equal(r.decision, 'deny')
})

// M2a 整分支终审发现的**第十处** <role> 消费方：H2 的归属判据。
//
// 终审实测（真实子进程 gate.mjs readiness，04-dispatch.md 缺失）：
//   派 at-backend  → deny
//   派 at-frontend → allow（零输出）  ← 它是 S5 的合法产者
//   派 at-ui/at-ios/at-android → 同样 allow
// 也就是说这四个角色**对 H2 完全免疫**，requires 一次都不会被检查。
//
// 为什么两轮穷举都没照到：前两轮 grep 的是 `.produces`，而这一行读的是 `.role`。
// **穷举的范围本身也会漏。**
//
// 终审还验了一件事：把它修对之后全量 505/0 **一条都不红**——说明零测试钉住这个错误
// 行为，它不是有意裁定，是漏网。这几条就是补上那个零覆盖。
const S5_MULTI_READY = {
  S4: { role: 'at-pm', requires: [], produces: ['04-dispatch.md'] },
  S5: {
    role: 'at-backend',
    producers: ['at-backend', 'at-frontend', 'at-ui'],
    requires: ['04-dispatch.md'],
    produces: ['05-impl/<role>.md'],
  },
}

test('H2：S5 的非 role 产者（at-frontend）前置缺失时同样被拒——不能对 H2 免疫', () => {
  const r = decideReadiness({
    targetRole: 'at-frontend',
    stages: S5_MULTI_READY,
    artifactExists: () => false,
  })
  assert.equal(r.decision, 'deny')
})

test('H2：S5 的 role 本身（at-backend）前置缺失时被拒——与上一条对称，证明不是只有一半在工作', () => {
  const r = decideReadiness({
    targetRole: 'at-backend',
    stages: S5_MULTI_READY,
    artifactExists: () => false,
  })
  assert.equal(r.decision, 'deny')
})

test('H2：S5 的非 role 产者前置齐备时放行——上一条的拒不是无条件拒', () => {
  const r = decideReadiness({
    targetRole: 'at-frontend',
    stages: S5_MULTI_READY,
    artifactExists: (p) => p === '04-dispatch.md',
  })
  assert.equal(r.decision, 'allow')
})

test('H2：完全不在 producers 里的角色仍然放行（它在这条链上没有阶段）', () => {
  const r = decideReadiness({
    targetRole: 'at-outsider',
    stages: S5_MULTI_READY,
    artifactExists: () => false,
  })
  assert.equal(r.decision, 'allow')
})

// ---- Task 2 修复轮 1 · 修复 1：H2 在真实初始状态下对 S2/S5 完全失效 ----
//
// 上面 M2A_STAGES / S5_MULTI_READY 那几组用例都是手写的最小夹具，从不覆盖
// 「roster 真的是空数组」这个真实起点——templates/state.json 的 roster 初始值
// 就是 []，commands/at.md 第 4 步在派发**并核实之后**才把 targetRole 累加进去，
// 也就是说 H2 跑的那一刻，roster 必然还不含正在被派的这个角色。旧代码把 roster
// 原样传给 stageRolesInRun：S2（对象形式）与 S5（<role> 形式）在这个起点上展开
// 出空数组，.every() 在空数组上恒真，被误判成「已完成」，requires 整段被跳过、
// 静默放行——这四条钉住修复前会静默放行、修复后必须 deny 的四个角色，全部读
// 仓库根真实 stages.json，不用手写夹具，因为这条回归就发生在真实形状上。
test('H2 回归（修复 1）：S2 对象形式、roster 为空、磁盘全空——派 at-product 必须 deny，理由点名 S2 与 00-contract.md', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({ targetRole: 'at-product', stages, roster: [], artifactExists: have() })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /S2/)
  assert.match(r.reason, /00-contract\.md/)
})

test('H2 回归（修复 1）：同一场景下 at-ui 同样被 deny——它是 S2 的第二个 producer，不是 S2.role', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({ targetRole: 'at-ui', stages, roster: [], artifactExists: have() })
  assert.equal(r.decision, 'deny')
})

test('H2 回归（修复 1）：S5 <role> 形式、roster 为空、磁盘全空——派 at-backend 必须 deny（M2a 遗留的这个洞一并钉住）', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({ targetRole: 'at-backend', stages, roster: [], artifactExists: have() })
  assert.equal(r.decision, 'deny')
})

// 区分刀：把这条修法与「stageRolesInRun 展开为空就判『未完成』」那条近似修法分开。
// 场景是真实会发生的：at-frontend 先交了自己的实现记录，PM 紧接着派 at-backend，
// 而 03-arch.md/04-dispatch.md 都还没写出来。
//
// 本条修法：inRun = [...roster, targetRole] = ['at-frontend', 'at-backend']，
// stageRolesInRun(S5, inRun) = ['at-backend', 'at-frontend']（两者都在场），展开出
// ['05-impl/at-backend.md', '05-impl/at-frontend.md']；at-backend 那份不存在 →
// done=false → 检查 requires → 03-arch.md/04-dispatch.md 都缺 → deny。
//
// 近似修法「展开为空就判未完成」（不并 targetRole，只在 stageRolesInRun(stage,
// roster) 为空数组时把 done 强制置 false）：stageRolesInRun(S5, ['at-frontend']) =
// ['at-frontend']，非空，不触发那条特殊情况；展开出 ['05-impl/at-frontend.md']，
// 它已经存在于磁盘上 → done=true → continue 跳过 S5 → mine 只有 S5 一段 → 循环
// 结束、返回 allow——把 at-backend 的派发放了行，requires 一次没检查，漏掉。
// 这条测试下面有一段真实跑过近似修法的记录，见 fix-1 报告。
test('H2 回归（修复 1）区分刀：S5 已有 at-frontend 的实现记录、roster 只含 at-frontend，派 at-backend 仍必须 deny', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({
    targetRole: 'at-backend',
    stages,
    roster: ['at-frontend'],
    artifactExists: have('05-impl/at-frontend.md'),
  })
  assert.equal(r.decision, 'deny')
})

// 正向自检锚（一）：S2 场景里前置产物（00-contract.md）确实在磁盘上时，
// 派 at-product 放行——证明上面几条 deny 不是「roster 为空就无脑 deny」。
test('H2 回归（修复 1）正向自检锚：S2 前置产物齐备时，roster 为空也不妨碍放行', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({ targetRole: 'at-product', stages, roster: [], artifactExists: have('00-contract.md') })
  assert.equal(r.decision, 'allow')
})

// 正向自检锚（二）：S5 场景同理，roster 为空但 requires（03-arch.md、
// 04-dispatch.md）都在磁盘上时放行。
test('H2 回归（修复 1）正向自检锚：S5 前置产物齐备时，roster 为空也不妨碍放行', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({
    targetRole: 'at-backend',
    stages,
    roster: [],
    artifactExists: have('03-arch.md', '04-dispatch.md'),
  })
  assert.equal(r.decision, 'allow')
})

// 正向自检锚（三）：targetRole 不属于任何阶段时一直放行，roster 为空不改变这一点
// ——上面几条的 deny 也不是「凡是空 roster 都 deny」。
test('H2 回归（修复 1）正向自检锚：targetRole 不属于任何阶段（at-outsider）时放行，roster 为空不改变这一点', () => {
  const stages = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
  const r = decideReadiness({ targetRole: 'at-outsider', stages, roster: [], artifactExists: have() })
  assert.equal(r.decision, 'allow')
})
