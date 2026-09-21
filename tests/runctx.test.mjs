import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readProjectConfig, readRunContext } from '../hooks/lib/runctx.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const STAGES = { S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] } }

function cleanup({ projectDir, pluginDir }) {
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(pluginDir, { recursive: true, force: true })
}

test('读得到当前 run 的 id、state 与 stages', () => {
  const dirs = makeRun({ runId: 'r42', stage: 'S2', stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.equal(ctx.runId, 'r42')
    assert.equal(ctx.state.stage, 'S2')
    assert.deepEqual(ctx.stages.S2.produces, ['01-prd.md'])
  } finally {
    cleanup(dirs)
  }
})

// kind 的两个取值与分类理由（为什么要分、不分会怎样自举死锁）是这个模块
// 对外的权威解释，见本文件顶部 readRunContext 上方的头部注释——下面每条
// 测试只标它落在哪个分支、为什么落在那个分支，不重复整套论证。

test('没有 .agent-team 时返回 ok:false 而不是抛异常，kind 是 no-run', () => {
  const ctx = readRunContext('/definitely/not/a/real/path', '/also/not/real')
  assert.equal(ctx.ok, false)
  assert.match(ctx.reason, /current-run|\.agent-team/)
  assert.equal(ctx.kind, 'no-run')
})

// ⚠️ M3b「坏指针的窗口」：这一条原来钉的是 kind === 'no-run'，**本轮把真源改了，
// 判据跟着改**——它当时红得对，红的原因就是分类变了。为什么改：pointer 在就意味着
// 有人开过 run，这不是干净的缺席；归 no-run 会让 H3/H4 这两个 fail-closed 的检查项
// 在这一个输入状态下对**所有角色** fail open。完整论证在 runctx.mjs 头部，不在这里
// 重复第二遍；子进程级的前后行为由 tests/gate-writepath.test.mjs 与
// tests/gate-contract.test.mjs 里那几条「坏指针」用例钉着。
test('current-run 指向不存在的 run 时返回 ok:false，kind 是 unreadable（不是 no-run）', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    rmSync(`${dirs.projectDir}/.agent-team/runs/r1`, { recursive: true, force: true })
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    // M1：不止判定失败，还要钉住失败原因是「目录不存在」，
    // 不是别的碰巧也返回 ok:false 的路径。
    assert.match(ctx.reason, /不存在/)
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// 这条与上面那条是同一条理由的两个实物（pointer 在 = 有人开过 run），
// 依据都在 runctx.mjs 头部注释里——空内容是异常状态，不是干净的缺席。
// ⚠️ 这两条都变绿不等于分类判别力还在：把 kind 塌成恒 'unreadable' 时它们照样绿，
// 真正会红的是本文件里 pointer **不在**的那两条——「没有 .agent-team 时……kind 是
// no-run」与「kind 是 no-run 的失败返回也带 agentTeamDir」。两侧各有人守着。
test('current-run 是空文件时返回 ok:false，kind 是 unreadable（不是 no-run）', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/current-run`, '', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.match(ctx.reason, /空/)
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// ——— M3c 这一格：current-run **根本不在**，而 .agent-team/runs/ 下非空 ———
//
// 与上面两条是同一条理由的第三个实物，轴是「有没有人建过 run」而不是「pointer 在不在」
// （完整论证在 hooks/lib/runctx.mjs 头部 ③ 那一段）。它此前归 no-run，于是 H3/H4 这两个
// fail-closed 的检查项在这一个输入状态下对**所有角色** fail open——子进程级的前后行为由
// tests/gate-writepath.test.mjs 与 tests/gate-contract.test.mjs 里那几条「丢指针」用例钉着。
test('current-run 不在、而 runs/ 下非空时返回 ok:false，kind 是 unreadable（不是 no-run）', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.equal(ctx.kind, 'unreadable')
    // 光断言 kind 抓不住「这个 unreadable 其实来自别的分支」：理由必须同时点名
    // 指针不在**和** runs/ 非空，两件事缺一这一格就不成立。
    assert.match(ctx.reason, /找不到/)
    assert.match(ctx.reason, /非空/)
    assert.equal(ctx.agentTeamDir, join(dirs.projectDir, '.agent-team'))
  } finally {
    cleanup(dirs)
  }
})

// ⚠️ 下面三条是上面那条的**正向自检锚，也是这一刀的硬边界本身**：收窄的全部前提是
// 「自举一个字没变」。判据被错改成「指针不在一律 unreadable」时上面那条照样绿，
// 红的是这三条——而它们红掉的真实后果是建第一个 run 这个自举动作永远做不成。
// 三种形态各占一个 test()：它们是三个不同的早退点（runs/ 不存在 / runs/ 存在但空 /
// .agent-team 整个不存在），不是同一个不变量按数据遍历。
// 「.agent-team 整个不存在」那一条不在这里另写：本文件上面「没有 .agent-team 时返回
// ok:false 而不是抛异常，kind 是 no-run」就是它。
test('自举边界：.agent-team 在、runs/ 不存在——仍然 no-run，仍然放行', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
    rmSync(join(dirs.projectDir, '.agent-team', 'runs'), { recursive: true, force: true })
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.equal(ctx.kind, 'no-run', '从来没有人建过 run = 干净的缺席，收窄不该碰它')
  } finally {
    cleanup(dirs)
  }
})

test('自举边界：runs/ 存在但是空目录——仍然 no-run，仍然放行', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.equal(
      ctx.kind,
      'no-run',
      '判据是 runs/ 里有没有东西，不是 runs/ 这个目录在不在——写成 existsSync(runsDir) 就红',
    )
  } finally {
    cleanup(dirs)
  }
})

// ⚠️ readdirSync 抛的时候落哪一支，是这一刀要自己裁的那一条边（理由三条，逐条写在
// hooks/lib/runctx.mjs 那个 catch 上方）。要钉的是**两件事**：归 unreadable，以及
// 带 agentTeamDir。**拆成两条**：写在一个 test() 里的话，kind 判错会让第二句断言
// 根本跑不到，两个变异（改 kind / 删 agentTeamDir）打出来的红清单逐字相同，
// 看不出丢的是哪一样——本轮的变异验证当场撞到了这个，才拆的。
// 两条共用同一个夹具帮手：造法是「runs 是个文件而不是目录」，readdirSync 当场
// ENOTDIR，不依赖权限也不依赖并发。
const makeUnreadableRunsDir = () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
  rmSync(join(dirs.projectDir, '.agent-team', 'runs'), { recursive: true, force: true })
  writeFileSync(join(dirs.projectDir, '.agent-team', 'runs'), '不是目录', 'utf8')
  return dirs
}

test('runs/ 读不出来（它是个文件）时 kind 是 unreadable——判不出空不空，就判不出这是自举还是丢了指针', () => {
  const dirs = makeUnreadableRunsDir()
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.equal(ctx.kind, 'unreadable')
    // 连理由一起锚：光断言 kind 的话，这个 unreadable 由别的分支发出（比如异常
    // 一路落到最外层兜底 catch）也照样绿，而那正是下一条要排除的那件事。
    assert.match(ctx.reason, /读不出来/)
  } finally {
    cleanup(dirs)
  }
})

test('runs/ 读不出来时的返回**带 agentTeamDir**——这一支必须自己接住异常，不能落到最外层兜底 catch', () => {
  const dirs = makeUnreadableRunsDir()
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(
      ctx.agentTeamDir,
      join(dirs.projectDir, '.agent-team'),
      '最外层兜底 catch 那一支没有 agentTeamDir，是因为 base 压根没算出来——这里 base ' +
        '是算出来的。丢掉它，ledger 那条缝（/at-init 的触达表靠 ctx.agentTeamDir 认路）' +
        '会在这里静默倒退成照原路 fail open',
    )
  } finally {
    cleanup(dirs)
  }
})

test('state.json 是坏 JSON 时返回 ok:false 而不是抛异常，kind 是 unreadable', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/runs/r1/state.json`, '{ not json', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    // M1：钉住失败来自 readJson 的「解析失败」分支（reason 里带「失败」二字），
    // 而不是巧合落到了别的 ok:false 分支。
    assert.match(ctx.reason, /失败/)
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// I2：JSON.parse('null')/('[]')/('"x"') 都是合法 JSON 但取不出字段。state.json
// 内容如果就是字面量 null，旧实现会让 readJson 返回 { ok:true, value:null }，
// 一路放行到 ctx.state.stage 才在某个下游任务里炸出 TypeError——而不是在这里
// 被判定为「读不到可用状态」。这条钉住 readJson 的形状守卫确实生效。
test('state.json 内容是合法 JSON 但不是对象（字面量 null）时返回 ok:false', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/runs/r1/state.json`, 'null', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.match(ctx.reason, /不是一个 JSON 对象/)
  } finally {
    cleanup(dirs)
  }
})

test('stages.json 从插件根读，不从项目根读', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    // 项目根里放一份内容不同的 stages.json——不应当被读到。
    writeFileSync(`${dirs.projectDir}/stages.json`, JSON.stringify({ SX: { role: 'wrong' } }), 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.ok(ctx.stages.S2, '读到的应当是插件根那份')
    assert.equal(ctx.stages.SX, undefined, '不应当读到项目根那份')
  } finally {
    cleanup(dirs)
  }
})

test('artifactExists 只在文件真存在时为 true', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['00-contract.md'], stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.artifactExists('00-contract.md'), true)
    assert.equal(ctx.artifactExists('01-prd.md'), false)
  } finally {
    cleanup(dirs)
  }
})

// M3：stages.json 里唯一的嵌套 produces 是 S5 的 05-impl/at-backend.md，
// 之前只测过平铺路径。同时钉住 artifactExists 用的是 isFile() 而不是
// existsSync()——目录本身存在但不是文件，不能被误判成产物已交付。
test('artifactExists 对嵌套路径的产物能判定，且目录本身不算产物', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['05-impl/at-backend.md'], stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.artifactExists('05-impl/at-backend.md'), true)
    assert.equal(ctx.artifactExists('05-impl'), false, '目录不是文件，isFile() 必须判 false')
  } finally {
    cleanup(dirs)
  }
})

// I3：真实调用形如 readRunContext(process.cwd(), process.env.CLAUDE_PLUGIN_ROOT)。
// CLAUDE_PLUGIN_ROOT 没设置时就是 undefined，join(undefined, 'stages.json')
// 在旧实现里会同步抛 TypeError，直接冲出 readRunContext——这正是模块头部注释
// 自己承诺「绝不抛异常」所不允许的事。projectDir 给一个真实存在的目录，
// 只让 pluginDir 是 undefined，专门命中 join(pluginDir, 'stages.json') 这一步。
test('pluginDir 是 undefined 时返回 ok:false 而不是抛异常，kind 是 unreadable', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, undefined)
    assert.equal(ctx.ok, false)
    // 走的是整个函数体外层 try/catch 兜住的异常（join(undefined, ...)
    // 同步抛 TypeError），跟"没有 run"无关，是门禁自己拿到的参数有问题。
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// M2：current-run 的内容会被原样拼进 runs/<runId>/... 路径。不校验的话，
// ../../x 这样的内容会被 path.join 正规化到 .agent-team/runs 之外，
// 让 H5 交付物门禁去别的目录判定产物是否存在。
test('current-run 内容含路径穿越字符时返回 ok:false，kind 是 unreadable', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/current-run`, '../../x', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.match(ctx.reason, /run id/)
    // 这条边界不能被"没有 run"放宽：路径穿越字符是路径可信边界问题，
    // 不是"没有东西要管"，必须继续 fail closed（Task 4 复审明确要求）。
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// I4：project 是 Interfaces 明确产出的字段，但此前没有任何用例传过
// makeRun 的 project 参数，也没有断言过「不存在时是 null」——两条分支
// 都是没被钉住的设计决定。这三条补上。

test('project.json 存在时，project 字段读到它的内容', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES, project: { name: 'demo-project' } })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.deepEqual(ctx.project, { name: 'demo-project' })
  } finally {
    cleanup(dirs)
  }
})

test('project.json 不存在时，project 字段是 null', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.equal(ctx.project, null)
  } finally {
    cleanup(dirs)
  }
})

test('project.json 是坏 JSON 时整个上下文返回 ok:false，kind 是 unreadable（不能被当成 no-run 放宽）', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/project.json`, '{ not json', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    // run 本身是真实存在的（makeRun 造出了 current-run/runs/<id>/state.json），
    // 只有 project.json 这一份坏了——不能被归为 no-run（理由见头部注释）。
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

test('ctx 带 agentTeamDir，等于 <projectDir>/.agent-team', () => {
  const { projectDir, pluginDir } = makeRun({ stages: STAGES })
  try {
    const ctx = readRunContext(projectDir, pluginDir)
    assert.equal(ctx.ok, true)
    assert.equal(ctx.agentTeamDir, join(projectDir, '.agent-team'))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// M1b 终审 C1：失败返回里也要有 agentTeamDir。没有它，ledger 在「还没有 run」时
// 连「这次写的是不是 .agent-team/project.json」都问不出来，触达表回传在全新项目上
// 结构性不可达。两条分别钉住 no-run 与 unreadable，各自占一个 test()——它们是两个
// 不同的返回点，不是同一个不变量按数据遍历。
// ⚠️ M3c：这条的夹具原来只删 current-run，而那已经不再是 no-run——runs/r1/ 还在时
// 它是 kind:'unreadable'（判据在 hooks/lib/runctx.mjs 头部 ③）。改的是夹具，不是断言：
// 这条要钉的不变量（**no-run 的失败返回也带 agentTeamDir**，否则 /at-init 的触达表
// 在全新项目上结构性不可达）一个字没变，变的是「怎么造一个真的 no-run」。
test('kind 是 no-run 的失败返回也带 agentTeamDir', () => {
  const { projectDir, pluginDir } = makeRun({ stages: STAGES })
  try {
    rmSync(join(projectDir, '.agent-team', 'current-run'), { force: true })
    rmSync(join(projectDir, '.agent-team', 'runs'), { recursive: true, force: true })
    const ctx = readRunContext(projectDir, pluginDir)
    assert.equal(ctx.ok, false)
    assert.equal(ctx.kind, 'no-run')
    assert.equal(ctx.agentTeamDir, join(projectDir, '.agent-team'))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('kind 是 unreadable 的失败返回也带 agentTeamDir', () => {
  const { projectDir, pluginDir } = makeRun({ stages: STAGES })
  try {
    writeFileSync(join(projectDir, '.agent-team', 'current-run'), '', 'utf8')
    const ctx = readRunContext(projectDir, pluginDir)
    assert.equal(ctx.ok, false)
    assert.equal(ctx.kind, 'unreadable')
    assert.equal(ctx.agentTeamDir, join(projectDir, '.agent-team'))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 最外层兜底 catch 那一支是唯一**没有** agentTeamDir 的失败返回，而且那是有意的：
// 抛出的很可能正是 join(projectDir, '.agent-team') 自己。调用方按「取不到就照原路
// fail open」处理，所以这条边界要钉住——凭空补一个值出来就是在编一条路径。
test('projectDir 不是字符串时（最外层兜底 catch）不带 agentTeamDir——那条路径根本没算出来', () => {
  const ctx = readRunContext(undefined, undefined)
  assert.equal(ctx.ok, false)
  assert.equal(ctx.kind, 'unreadable')
  assert.equal(ctx.agentTeamDir, undefined)
  assert.match(ctx.reason, /读取运行上下文失败/)
})

// readProjectConfig：不要求有进行中的 run，ledger 在 ctx 读不出来时靠它拿到触达表的
// 判据。三条分别是「读得到」「文件不在」「内容不是对象」，三种不同的返回形状，拆开。
test('readProjectConfig 读得到 .agent-team/project.json', () => {
  const { projectDir, pluginDir } = makeRun({ stages: STAGES, project: { paths: { 'at-product': ['docs/'] } } })
  try {
    const r = readProjectConfig(projectDir)
    assert.equal(r.ok, true)
    assert.deepEqual(r.value.paths['at-product'], ['docs/'])
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('readProjectConfig 在 project.json 不存在时返回 ok:false，不抛', () => {
  const { projectDir, pluginDir } = makeRun({ stages: STAGES })
  try {
    const r = readProjectConfig(projectDir)
    assert.equal(r.ok, false)
    assert.match(r.reason, /project\.json/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('readProjectConfig 对「合法 JSON 但不是对象」返回 ok:false——与 readRunContext 同一条边界', () => {
  const { projectDir, pluginDir } = makeRun({ stages: STAGES })
  try {
    writeFileSync(join(projectDir, '.agent-team', 'project.json'), 'null', 'utf8')
    const r = readProjectConfig(projectDir)
    assert.equal(r.ok, false)
    assert.match(r.reason, /不是一个 JSON 对象/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('readProjectConfig 传非字符串时返回 ok:false 而不是抛异常', () => {
  const r = readProjectConfig(undefined)
  assert.equal(r.ok, false)
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0)
})

test('artifactBytes 读得到产物字节', () => {
  const { projectDir, pluginDir } = makeRun({ artifacts: ['00-contract.md'], stages: STAGES })
  try {
    const ctx = readRunContext(projectDir, pluginDir)
    assert.ok(Buffer.isBuffer(ctx.artifactBytes('00-contract.md')))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('artifactBytes 读不到时返回 null，不抛', () => {
  const { projectDir, pluginDir } = makeRun({ stages: STAGES })
  try {
    const ctx = readRunContext(projectDir, pluginDir)
    assert.equal(ctx.artifactBytes('不存在.md'), null)
    assert.equal(ctx.artifactBytes(undefined), null)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})
