// ledger 在 gate.mjs 里 tests/ledger.test.mjs 覆盖不到的部分：ctx 读取、路径分派、
// additionalContext 的输出形状、以及「与本检查项无关的写入保持沉默」。
// 与 tests/gate-writepath.test.mjs 同一个已知边界：gate.mjs 读的是仓库根真实
// stages.json（S1 归 at-pm、produces 是 00-contract.md），夹具改不了它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'

// GATE 直接从 gate-runner.mjs 拿，不在本文件里另算一份——brief 原稿这里是
// `new URL('../hooks/gate.mjs', import.meta.url).pathname`，在 win32 上
// URL.pathname 前面带一个斜杠（"/C:/Users/..."），不是合法的 Windows 路径；
// spawnSync 把它当 argv 传给 node.exe 时会被当成"缺盘符的 POSIX 绝对路径"按当前
// 盘符再拼一次，变成 "C:\C:\Users\..."，六条测试里凡是真的 spawn 子进程的全部
// MODULE_NOT_FOUND（Task 6 落地时在本机 Windows 环境实测到，不在简报明确列出的
// 「已经过时的地方」四条里）。tests/gate-writepath.test.mjs 已经踩过同一个坑：
// 它从 gate-runner.mjs 拿用 fileURLToPath 算好的 GATE，这里照抄同一个修法，不
// 另起一份用 .pathname 的算法——两处路径计算只该有一份，跟 hooks/lib/path-norm.mjs
// 头部那条「重复会分叉」的教训是同一类。

function ctxOf(stdout) {
  if (!stdout.trim()) return null
  return JSON.parse(stdout).hookSpecificOutput.additionalContext
}

test('写了契约：回传的哈希与磁盘上算出来的一致', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', '00-contract.md')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p },
    }, GATE, projectDir)
    const ctx = ctxOf(stdout)
    assert.ok(ctx.includes(sha256OfContract(readFileSync(p))))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('写了 project.json：回传触达表，含 reach.json 落盘指示', () => {
  const { projectDir, pluginDir } = makeRun({
    runId: 'r1', stage: 'S1',
    project: { paths: { 'at-product': ['docs/'], 'at-backend': ['src/server/'] } },
  })
  try {
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'project.json') },
    }, GATE, projectDir)
    const ctx = ctxOf(stdout)
    assert.match(ctx, /reach\.json/)
    // 仓库根真实 roster.json：at-architect → at-backend 这条边存在。
    // ⚠️ M2b Task 3 之前这里钉的是 at-product → at-backend。那条边在本任务被**移除**
    // 了：规格 §4 的 S2 写的是「at-product → at-ui」，S5 的分发是 at-architect 的事，
    // 所以 at-product 的 can_delegate_to 从 ["at-backend"] 改成了 ["at-ui"]。这条断言
    // 正是 docs/11 §2 已知边界第 5 条（四个月前）预言过的那一类「断言钉在真实
    // roster.json 的一条边上」——换成 at-architect → at-backend 不是为了让它变绿，是
    // 因为触达表这一行的事实变了：at-product 现在派不到 at-backend，src/server/ 只剩
    // at-architect 这一条链能把它带进别人的触达里。
    assert.ok(ctx.includes('at-architect → at-backend'))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// Task 2 修复轮 1：单一真源这个交付物要求的不只是「trusted.mjs 自己的单测通过」，
// 还要「gate.mjs 三处真实调用点的真实输出确实以它开头」——否则重构可以被悄悄
// 塌回硬编码字面量（且可能带一个字的漂移）而没有任何测试发现。这条钉的是
// hooks/gate.mjs:134（emitLedger）。复用上面那条测试的同一份夹具与输入：它已
// 确认过这个场景会产出非空 notices（触达表分支无条件 push）。用 startsWith，
// 不用 includes——includes 在前缀被挪到正文中间时仍然绿，测不出"前缀在不在
// 开头"。TRUSTED_PREFIX 从 hooks/lib/trusted.mjs import，不在本文件另写一份
// 字面量，那正是这次要防的漂移本身。
test('emitLedger 的真实输出以受信前缀开头，不是巧合等长的别的文本', () => {
  const { projectDir, pluginDir } = makeRun({
    runId: 'r1', stage: 'S1',
    project: { paths: { 'at-product': ['docs/'], 'at-backend': ['src/server/'] } },
  })
  try {
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'project.json') },
    }, GATE, projectDir)
    assert.ok(ctxOf(stdout).startsWith(TRUSTED_PREFIX))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('写了坏的 state.json：problems 逐条回传', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const bad = JSON.parse(readFileSync(p, 'utf8'))
    bad.rework = { S1: 2 }   // history 里 S1 只出现一次，应当是 0
    writeFileSync(p, JSON.stringify(bad), 'utf8')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p },
    }, GATE, projectDir)
    assert.match(ctxOf(stdout), /rework/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('写了阶段产物：回传的哈希与磁盘实算一致', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', '01-prd.md')
    writeFileSync(p, '# PRD\n', 'utf8')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: p },
    }, GATE, projectDir)
    assert.ok(ctxOf(stdout).includes(sha256OfContract(readFileSync(p))))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// Task 2 修复轮 1 定下的形状：新增的回传路径要单独钉一条「真实输出以受信前缀开头」。
// 这条严格说不是一个全新的 additionalContext 调用点——kind: 'produce' 的内容最终
// 仍然流经 hooks/gate.mjs:134 的同一个 emitLedger（上面「写了 project.json」那条
// 已经钉过这个调用点本身会用 trustedBlock 包装，包装逻辑不分 kind），但「同一个函数
// 所以肯定也对」是推理，不是证据——照同一个形状直接对含【产物】内容的这次真实回传
// 断言一遍，不留这个空子。
//
// ⚠️ 修复轮 1 缺陷 1：这条测试原来复用了上面「写了阶段产物：回传的哈希与磁盘实算
// 一致」那份夹具（stage: 'S1', artifacts:['00-contract.md']），评审指出那是幻绿——
// `stage: 'S1'` 加 `00-contract.md` 已经在磁盘上，让 `isStageDone('S1')` 恒真，
// `buildLedgerNotices` 因此恒非空、恒经 `trustedBlock` 包装，跟 `kind:'produce'`
// 分支是否正确工作完全无关，是 `stageDone` 那条 notice 搭的顺风车。评审实测：把
// `kind === 'produce'` 分支整体短路、或把 gate.mjs 产物匹配条件改成恒真，这条测试
// 都保持绿——上面那条正向锚点（回传的哈希与磁盘实算一致）能抓住这两种塌法是因为它
// 断言的是"输出里含有这个具体 sha256 子串"，`stageDone` 那条 notice 天然不含这个
// 值；这条测试原来只断言 `startsWith(TRUSTED_PREFIX)`，任何非空输出都满足，才会被
// `stageDone` 的顺风车悄悄糊弄过去。
//
// 修法：换一份不会让当前阶段"恰好齐了"的夹具——`state.stage` 设成 `S3`（它的
// `produces` 是 `03-arch.md` 与 `03-alignment.md`，两个全程都不创建，
// `isStageDone('S3')` 恒假），但实际写的文件仍然是 `01-prd.md`（S2 的 produces）。
// gate.mjs 的匹配循环遍历 `ctx.stages` 的**所有**阶段找 produces，不只当前阶段
// （hooks/gate.mjs 里 `for (const s of Object.values(ctx.stages))` 那段自己的设计），
// 所以写 `01-prd.md` 依然会被正确识别成 `kind:'produce'`，同时不会触发任何
// `stageDone` 噪音。
//
// ⚠️ M2b 终审定向复评（2026-09-20）：这一段原来还写着「**这是排除掉顺风车唯一的
// 办法：仓库根真实 stages.json 每个阶段只有一个 produces**，没法造一个『当前阶段
// 没齐、但仍然齐了当前阶段』这种自相矛盾的场景，只能靠跨阶段拆开」。
// **前提假，跟着推出来的结论也假**：实跑展开，多产物的阶段不止一个（S2/S3/S5 都是，
// 去 `stages.json` 看，别在这里抄一份数字）。自从 S3 有了第二个产物，**同阶段内就造
// 得出**那个所谓自相矛盾的场景——磁盘上只放 `03-arch.md`、`state.stage = S3`，
// 写的正是 S3 自己的 produces，而 `isStageDone('S3')` 仍然是 `false`（复评与本轮各自
// 实跑核过）。上面那个括号「（它的 `produces` 是 `03-arch.md`）」也是同一刀之后
// 变得不完整的，一并补全。
//
// **夹具不改，测试判据不改**——它本来就是对的，而且跨阶段这一份还**额外覆盖**了
// 「匹配循环遍历所有阶段、不只当前阶段」这一点，是有理由留的那一份。改的只是这段
// 说明：把「唯一的办法」降成「一种做法，且它另有价值」。
//
// ⚠️⚠️ **这一条真正值钱的不是它被改掉了，是它暴露的那个上限。**
// `03-alignment.md` 是 `9ffcad2`（「produces 的第二种形式」）加进 S3 的——**与终审
// B2 那一族的另外五处是同一刀砍出来的**。而 B2 那一轮的穷举用的是词形表
// （`单产者` / `S1–S4` / `S6–S8` …），**这句话一个词都不含**：它讲的是「每个阶段
// 只有一个 produces」，与那五处讲的「哪些阶段没有 producers」是同一个改动的两种
// 说法。**不是漏看，是词形表结构上覆盖不到它。**
// 记下这句，它比这次的修补更重要：
//
//     同一次改动造成的失效，散落在**互不共享任何词形**的句子里；
//     词形表能覆盖的是「说法相同的那些」，覆盖不了「原因相同的那些」。
//
// 要穷举「原因相同的那些」，入口不是检索词，是**那一次改动本身**
// （`git log -S` / 那个 commit 的 diff 波及面）。完整记录见 `docs/11` §5.18 裁定「词形表的上限」。
//
// **本轮当场按那个方法扫了一遍，又找出第八处**：`hooks/lib/state.mjs` 的 `isStageDone`
// docstring 结尾写着「不再受仓库根真实 stages.json『**每个阶段只有一个产物**』这个形状
// 限制」——同一个事实（S3 多了 `03-alignment.md`），一个写「produces」、一个写「产物」，
// 词形不同、原因相同。**方法当场证明了自己。**
//
// 顺带：这不是本仓库第一次撞上词形表的上限。`hooks/lib/readiness.mjs` 里记着 M2a 的
// 同一形状——`<role>` 消费方的第十处「两轮穷举都没照到」，因为前两轮 grep 的是
// `.produces`，而那一行读的是 `.role`。当时把它记成了「漏了一处」，现在看清楚了：
// **是按词形穷举这件事本身有上限，不是那两轮不够仔细。**
test('写了阶段产物：真实输出同样以受信前缀开头', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S3' })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', '01-prd.md')
    writeFileSync(p, '# PRD\n', 'utf8')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: p },
    }, GATE, projectDir)
    assert.ok(ctxOf(stdout).startsWith(TRUSTED_PREFIX))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 正向锚点就是上面那条：它已经证明「写一个真的阶段产物」这条通道会回传非空内容。
// 这条钉住的是新增匹配逻辑的另一侧——run 目录下不属于任何阶段 produces 的文件，
// 不能被误判成产物回传。
//
// 夹具特意用 stage: 'S2'、但仍然预置 00-contract.md（S1 的产物）：
// - 不能用 stage: 'S1' + artifacts:['00-contract.md']——那会让 isStageDone('S1') 为
//   true，buildLedgerNotices 无论 kind 是什么都会推一条「阶段已齐」的 notice，stdout
//   非空，这条「保持沉默」的断言会恒为假，跟这次改动是否有 bug 无关（实测踩过一次，
//   见下面的失败记录）。stage: 'S2' 时 S2 的产物 01-prd.md 不在磁盘上，isStageDone
//   为 false，排除了这条噪音。
// - 但仍然要让 00-contract.md 存在：如果把 gate.mjs 里「这是不是阶段产物」的匹配
//   条件改成恒真，产物匹配循环会把 00-contract.md（stages.json 里第一个阶段 S1 的
//   第一个 produces）误判成这次写入对应的产物名，然后真的用 ctx.artifactBytes 去读
//   它、真的算出一个哈希、真的回传——用一份没有任何 artifacts 的夹具测不出这个恒真
//   塌法，因为 artifactBytes 会读不到文件、拿到 null，误判分支会因为
//   「typeof produceSha !== 'string'」而继续沉默，恒真塌法就被悄悄放过去了。
test('run 目录下的文件不是任何阶段的 produces：不当成产物回传', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'] })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', 'scratch.txt')
    writeFileSync(p, '不是任何阶段的产物\n', 'utf8')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: p },
    }, GATE, projectDir)
    assert.equal(stdout.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('写业务代码时保持沉默——零 stdout', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-backend',
      tool_input: { file_path: join(projectDir, 'src', 'server', 'api.ts') },
    }, GATE, projectDir)
    assert.equal(stdout.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// Task 6 变异验证第 3 项发现的缺口：上面那条「保持沉默」的夹具（stage S1、没有
// artifacts）无论 isControlFile/underDir 那道早退在不在，stageDone 恒为 false、
// kind 恒为 'other'，notices 恒是空数组——早退删不删，stdout 都是空的，那条测试
// 证明不了早退本身有必要（实测：把早退改成无条件继续，`node --test` 仍然
// pass 258 / fail 0，没有任何测试变红）。这一条把「当前阶段产物已经齐了」这个
// 会让 buildLedgerNotices 产出非空内容的条件叠上去，才能让早退的有无造成
// 可观察的差异：00-contract.md 已经在磁盘上（stageDone 为 true），但这次写入
// 仍然是与 ledger 无关的业务代码——早退在场时应当继续保持沉默，不能因为「阶段
// 已经齐了」这件事跟这次写入的路径无关就把它汇报出来。
test('阶段产物已经齐了，但这次写的是业务代码：仍然保持沉默——早退不看 stageDone', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-backend',
      tool_input: { file_path: join(projectDir, 'src', 'server', 'api.ts') },
    }, GATE, projectDir)
    assert.equal(stdout.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('ledger 永不拒绝——输出里不会出现 permissionDecision', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const { stdout, status } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-backend',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    assert.equal(status, 0)
    assert.doesNotMatch(stdout, /permissionDecision/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 这两条替换的是一条自相矛盾的旧测试（M1b 终审 C1）。旧测试叫「没有 run 时
// fail open 且留痕，不静默」，但它**写的正是 project.json** 并断言 stdout 为空
// ——也就是说仓库自己把「触达表在全新项目上永远回传不了」这件事写成了一条绿测试。
// /at-init 按设计跑在没有 run 的时候（commands/at-init.md 末尾明令不建 run），
// 所以那条通道必须在没有 run 时也通。
//
// 拆成两个 test()：一条验「写 project.json 照常回传」，一条验「写别的文件才
// fail open」。它们检验的是不同侧面，不是同一个不变量按数据遍历；而且第一条正是
// 变异验证里期望变红的那条，必须自己占一个 test()，否则它一失败会把第二条挡住。
test('没有 run 时写 project.json：仍然回传触达表——/at-init 按设计就跑在没有 run 的时候', () => {
  const { projectDir, pluginDir } = makeRun({
    runId: 'r1', stage: 'S1',
    project: { paths: { 'at-product': ['docs/'], 'at-backend': ['src/server/'] } },
  })
  try {
    rmSync(join(projectDir, '.agent-team', 'current-run'), { force: true })
    const { stdout, status } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'project.json') },
    }, GATE, projectDir)
    assert.equal(status, 0)
    const ctx = ctxOf(stdout)
    assert.ok(
      ctx,
      '没有 run 时写 project.json 必须照常回传触达表——触达表的判据只有 roster.json 与 ' +
        'project.json，两者都与 run 无关，而 /at-init 恰恰跑在没有 run 的时候。' +
        'stdout 为空意味着 .agent-team/reach.json 在全新项目上永远建不出来。',
    )
    assert.match(ctx, /reach\.json/)
    // 仓库根真实 roster.json：at-architect → at-backend 这条边存在。
    // ⚠️ M2b Task 3 之前这里钉的是 at-product → at-backend。那条边在本任务被**移除**
    // 了：规格 §4 的 S2 写的是「at-product → at-ui」，S5 的分发是 at-architect 的事，
    // 所以 at-product 的 can_delegate_to 从 ["at-backend"] 改成了 ["at-ui"]。这条断言
    // 正是 docs/11 §2 已知边界第 5 条（四个月前）预言过的那一类「断言钉在真实
    // roster.json 的一条边上」——换成 at-architect → at-backend 不是为了让它变绿，是
    // 因为触达表这一行的事实变了：at-product 现在派不到 at-backend，src/server/ 只剩
    // at-architect 这一条链能把它带进别人的触达里。
    assert.ok(ctx.includes('at-architect → at-backend'))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// run 存在但读不出来（kind:'unreadable'）时写 project.json：**两件事都要发生**。
// 触达表照发（判据只有 roster.json + 刚写完的 project.json，跟那个坏掉的 run 无关，
// 而「在一个坏掉的 run 上重跑 /at-init」恰恰是要支持的动作），fail-open 留痕也照留
// （门禁自己判不出来，这是唯一的信号）。终审复评 a：第一版只 emit 不留痕，那一次
// 写入的 stderr 是零字节。
//
// 拆成两条：它们检验的是同一次调用的两个不同侧面（该说的话说了没有 / 该留的痕留了
// 没有），放同一个 test() 里前一句失败会把后一句整个挡住，看不出丢的是哪一样。
const makeBrokenRun = () => {
  const dirs = makeRun({
    runId: 'r1', stage: 'S1',
    project: { paths: { 'at-product': ['docs/'], 'at-backend': ['src/server/'] } },
  })
  // 空的 current-run 是 kind:'unreadable'（不是 no-run）——pointer 文件在，内容是空的，
  // 判据见 hooks/lib/runctx.mjs 头部。
  writeFileSync(join(dirs.projectDir, '.agent-team', 'current-run'), '', 'utf8')
  return dirs
}
const writeProjectJson = (projectDir) =>
  run('ledger', {
    tool_name: 'Write', agent_type: 'at-pm',
    tool_input: { file_path: join(projectDir, '.agent-team', 'project.json') },
  }, GATE, projectDir)

test('run 坏了（unreadable）时写 project.json：触达表照发', () => {
  const { projectDir, pluginDir } = makeBrokenRun()
  try {
    const { stdout, status } = writeProjectJson(projectDir)
    assert.equal(status, 0)
    const ctx = ctxOf(stdout)
    assert.ok(ctx, '触达表的判据跟那个坏掉的 run 无关——在坏掉的 run 上重跑 /at-init 必须走得通')
    assert.match(ctx, /reach\.json/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('run 坏了（unreadable）时写 project.json：fail-open 留痕照留——不是二选一', () => {
  const { projectDir, pluginDir } = makeBrokenRun()
  try {
    const { stderr, status } = writeProjectJson(projectDir)
    assert.equal(status, 0)
    assert.match(
      stderr,
      /ledger 回传：读不到运行上下文（/,
      '门禁自己判不出来时必须留痕，且措辞要说"读不到运行上下文"而不是"没有进行中的 run"' +
        '——run 就在那里，坏的是别的东西。发了触达表不等于可以不留这一行：' +
        '静默的放行和门禁彻底坏掉长得一模一样。',
    )
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// no-run 是 /at-init 的**正常**形态，那条路径不该留痕——在正路上刷一行「当前没有
// 进行中的 run，本次放行」只会把人指向 current-run 去查一个不存在的问题。
// 这条与上面那条 unreadable 留痕配对：ctx.kind 那个三元塌成任一支，必有一条变红。
test('没有 run 时写 project.json：不留 fail-open 痕迹——那是 /at-init 的正常形态', () => {
  const { projectDir, pluginDir } = makeRun({
    runId: 'r1', stage: 'S1',
    project: { paths: { 'at-product': ['docs/'], 'at-backend': ['src/server/'] } },
  })
  try {
    rmSync(join(projectDir, '.agent-team', 'current-run'), { force: true })
    const { stdout, stderr } = writeProjectJson(projectDir)
    // 正向锚点：光断言 stderr 为空的话，整条通道被删掉（stdout 也空）照样绿。
    assert.ok(ctxOf(stdout), '触达表必须照常回传，否则下面那条"没留痕"证明不了任何事')
    assert.equal(stderr.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('没有 run 时写别的文件：fail open 且留痕，不静默', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    rmSync(join(projectDir, '.agent-team', 'current-run'), { force: true })
    const { stdout, stderr, status } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-pm',
      // run 目录下的阶段产物：上面那条缝只放 project.json 一个文件，别的照旧。
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', '00-contract.md') },
    }, GATE, projectDir)
    assert.equal(status, 0)
    assert.equal(stdout.trim(), '')
    // 正向锚点：doesNotMatch/为空这类否定断言单独立不住（空输出天然满足），
    // 必须同时钉住「该出现的那行痕迹真的出现了」。
    assert.match(stderr, /ledger 回传/)
    assert.match(stderr, /current-run/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})


// ——— M3a Task 2：产者交代判据在真实 gate 上的子进程级验证 ———
//
// 纯函数那一层在 tests/coverage.test.mjs。这里钉的是接线：触发点选对了没
// （kind === 'state' 那一刻，不是每次写）、文案有没有真的到 stdout 上、
// 宇宙有没有真的按 project.json 的 available_roles 收窄、收窄不成时留痕了没有。
//
// 夹具是 docs/15 §5.1 那一趟的形状，roster 逐字用它记的那一份 ["at-product"]：
// S2 走过了（history 里有、且不是当前阶段），at-ui 是 S2 的产者而 roster 里没有它。
// gate.mjs 读的是仓库根真实 stages.json（见本文件头部那条已知边界），所以 S2 的
// producers 就是 at-product + at-ui。
//
// S1 也走过了，而它的产者是 at-pm 自己——**收窄之后 at-pm 自动退出宇宙**
// （commands/at-init.md 明令 available_roles 不写 at-pm），所以下面那条
// assert.doesNotMatch 证明得了「只点名该点的那一个」。不收窄那一组则相反，
// 它钉的正是「口径比平时宽」这件事被说出来了。
const M2B_AVAILABLE = [
  'at-product', 'at-architect', 'at-backend', 'at-frontend', 'at-ui', 'at-qa', 'at-acceptance',
]

const WALKED_S2 = {
  runId: 'r1',
  stage: 'S3',
  history: [
    { stage: 'S1', at: '2026-09-20T10:00:00Z' },
    { stage: 'S2', at: '2026-09-20T10:10:00Z' },
    { stage: 'S3', at: '2026-09-20T10:20:00Z' },
  ],
  roster: ['at-product'],
  project: { available_roles: M2B_AVAILABLE, paths: {} },
}

// 同一份 state，只把 at-pm 塞进 available_roles（正是 commands/at-init.md 禁的那件事，
// 而没有任何运行时判据拦它——见修复轮 F1 那一组）。
const PM_IN_AVAILABLE = {
  ...WALKED_S2,
  project: { available_roles: [...M2B_AVAILABLE, 'at-pm'], paths: {} },
}

const stateJsonOf = (projectDir) => join(projectDir, '.agent-team', 'runs', 'r1', 'state.json')
// agentType 是**收件人**：PostToolUse 的 additionalContext 发给刚做完这次写入的那个上下文。
// 缺省 at-pm 与 M3b 之前逐字相同，既有调用一个都不用改；传 null 表示主线程
// （逐字是「**没有 agent_type 这个键**」，不是 agent_type: undefined——callerOf 两者都归
// MAIN，但 JSON.stringify 会把显式的 undefined 整个键丢掉，留着它等于让测试依赖一个
// 它没打算依赖的序列化细节）。
const writeState = (projectDir, agentType = 'at-pm') => {
  const input = { tool_name: 'Write', tool_input: { file_path: stateJsonOf(projectDir) } }
  if (agentType !== null) input.agent_type = agentType
  return run('ledger', input, GATE, projectDir)
}

test('推进出去之后写 state.json：产者交代那条文案出现在 stdout，并点名是哪一段的哪个角色', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    const ctx = ctxOf(writeState(projectDir).stdout)
    assert.match(ctx, /S2 的 at-ui/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 文案的两条出路各钉一条。brief 的硬要求：一条是「真要裁就写进 trimmed」，
// 一条是「不是裁剪就去补派」。只写一条出路等于替读的人做了那个判断，而判据恰恰
// 分辨不了这两种触发（它看到的东西在两种情况下完全一样）。
test('产者交代文案给出「写进 trimmed」这条出路，并带上可以照抄的形状', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir).stdout), /trimmed[\s\S]*\{"at-ui": "S2"\}/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('产者交代文案给出「去把它派出去」这条出路，不是只有 trimmed 一条', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir).stdout), /不是裁剪，是漏了：把它派出去/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 这条防的是本仓库栽过的那一族：失败文案把人指向错误修法。这里的错误修法很具体
// ——把名字写进 roster 让提示消失。写了名字不派人，产物照样不存在，洞还在。
test('产者交代文案明确写出「不要为了让提示消失就写进 roster」', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir).stdout), /不要为了让这条提示消失就把名字写进 roster/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 新增回传内容照本仓库既有形状钉一条「真实输出以受信前缀开头」（Task 2 修复轮 1 的
// 先例）。这份夹具不会产生别的 notice（S3 的产物一个都不在磁盘上 → 没有【阶段】；
// state 本身合法 → 没有【state.json】），所以这条断言没有顺风车可搭：输出非空就
// 只能是产者交代这一条。
test('产者交代的真实回传以受信前缀开头', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.ok(ctxOf(writeState(projectDir).stdout).startsWith(TRUSTED_PREFIX))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 正向自检锚在上面那五条：同一份夹具（逐字同一个 WALKED_S2，只多一个 trimmed）
// 在 at-ui 没被声明时真的报。这里断言的是**整个 stdout 为空**，不是
// doesNotMatch——后者在「整条通道被删掉」时同样绿（空输出天然满足否定断言），
// 而 stdout 严格为空是对整个输出的正面陈述：一条 notice 都没有。
test('at-ui 写进 trimmed 之后：同一份夹具不再报，整条回传为空', () => {
  const { projectDir, pluginDir } = makeRun({ ...WALKED_S2, trimmed: { 'at-ui': 'S2' } })
  try {
    assert.equal(writeState(projectDir).stdout.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 触发点：推进出去时，不是每次写。写产物那一刻 roster 对这一段本来就还不完整
// （commands/at.md 第 4 步在派发并核实之后才累加它），在那里算是稳定的误报。
// 这条不是拿空输出证明的——同一次调用的 stdout 里有【产物】那条 sha256 回传，
// 证明通道是通的、只是产者交代那一条按设计没上车。
test('写的不是 state.json 时不报产者交代——触发点是推进出去那一刻', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', '01-prd.md')
    writeFileSync(p, '# PRD\n', 'utf8')
    const { stdout } = run('ledger', {
      tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: p },
    }, GATE, projectDir)
    const ctx = ctxOf(stdout)
    assert.ok(ctx.includes(sha256OfContract(readFileSync(p))), '【产物】回传必须照常出现，否则下面那条证明不了任何事')
    assert.doesNotMatch(ctx, /产者交代/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ——— Ruling 2：真实 gate 上的收窄，以及收窄不成时的两半留痕 ———

// S1 走过了、at-pm 是它的产者、roster 里没有 at-pm（docs/15 §5.1 那一刻逐字如此），
// 而 available_roles 不含 at-pm —— 所以它不该被点名。
// 正向锚是上面那条「点名 S2 的 at-ui」：同一次输出里该点的那个真的被点了。
test('Ruling 2：available_roles 不含 at-pm，S1 那一段不被点名', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    const ctx = ctxOf(writeState(projectDir).stdout)
    assert.doesNotMatch(ctx, /at-pm/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 已知违规样本锚：把 at-pm 塞进 available_roles（正是 commands/at-init.md 禁的那件事）
// → 同一份 state 上 S1 立刻被点名。没有这条，上一条在「收窄退化成恒不点名」时照样绿。
test('正向自检锚（Ruling 2）：at-pm 一旦被写进 available_roles，S1 立刻被点名', () => {
  const { projectDir, pluginDir } = makeRun(PM_IN_AVAILABLE)
  try {
    assert.match(ctxOf(writeState(projectDir).stdout), /S1 的 at-pm/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ——— 修复轮 F1：那个错示例**只在收窄成功时**才产生，护栏原来挂错了地方 ———
//
// 整条链（实跑核过）：真实 project.json 的 available_roles 里写了 at-pm
// （commands/at-init.md 明令不要写，但没有任何运行时判据拦它）→ **收窄成功**
// （narrowed 为真，stderr 无痕、「口径比平时宽」那段与它带的护栏全都不出现）
// → S1 是每趟 history 的第一段，而 at-pm 做自己那几段时没有「派发」这个动作、
// 所以不在 roster（docs/15 §5.1 第 3 点逐字）→ gaps[0] 就是 {S1, at-pm}
// → 文案逐字给出 {"at-pm": "S1"} → validateState 放过（at-pm 真的是 S1/S4/S8 的产者，
// 形状挑不出毛病）→ gap 消失、洞留着，而且这一趟从此声明「把自己的驱动者裁掉了」。
//
// ⚠️ 这个夹具本来就在（上面那条锚用的就是它），**只差这几条断言没写**。
// 下面三条共用它：上面那条锚（S1 真的被点名）就是它们的正向自检锚。

test('修复轮 F1：收窄成功时文案也不得逐字给出把 at-pm 写进 trimmed 的示例', () => {
  const { projectDir, pluginDir } = makeRun(PM_IN_AVAILABLE)
  try {
    assert.doesNotMatch(ctxOf(writeState(projectDir).stdout), /\{"at-pm": "S1"\}/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('修复轮 F1：护栏点名 at-pm 是驱动者本人，并指向真修法（去 available_roles 里删掉它）', () => {
  const { projectDir, pluginDir } = makeRun(PM_IN_AVAILABLE)
  try {
    const ctx = ctxOf(writeState(projectDir).stdout)
    assert.match(ctx, /at-pm 是\*\*这一趟的驱动者本人\*\*[\s\S]*available_roles 里写了它/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 举例跳过驱动者、落到同一批里安全的那一条上——不是退化成「永远给占位形状」。
test('修复轮 F1：举例跳过驱动者，落到同一批里安全的那一条上', () => {
  const { projectDir, pluginDir } = makeRun(PM_IN_AVAILABLE)
  try {
    assert.match(ctxOf(writeState(projectDir).stdout), /形状是 \{"at-ui": "S2"\}/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 这一批里**一个安全的都没有**（available_roles 只有 at-pm）：退回占位形状，
// 而不是硬拿驱动者举例。
test('修复轮 F1：整批都是驱动者时退回占位形状，不硬拿它举例', () => {
  const { projectDir, pluginDir } = makeRun({ ...WALKED_S2, project: { available_roles: ['at-pm'], paths: {} } })
  try {
    const ctx = ctxOf(writeState(projectDir).stdout)
    assert.ok(ctx.includes('S1 的 at-pm'), '这一批必须真的只剩驱动者那一条，否则下面那条证明不了任何事')
    assert.ok(ctx.includes('形状是 {"<角色名>": "<阶段 id>"}'))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 反面：这一批里没有驱动者时，护栏那句不出现——它不是一句无条件的套话。
// 锚在「该点名的那个还是点了」。
test('修复轮 F1：这一批没有驱动者时，护栏那句不出现（锚：该点名的那个还是点了）', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    const ctx = ctxOf(writeState(projectDir).stdout)
    assert.ok(ctx.includes('S2 的 at-ui'), '该点名的那一条必须还在，否则下面那条证明不了任何事')
    assert.doesNotMatch(ctx, /驱动者本人/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 收窄不成的两半：文案自己说出口径变宽了（这一条），以及 stderr 上的那行痕迹（下一条）。
// 没有 project.json 时 readRunContext 的 ctx 仍然 ok（project 是 null），所以判据照常跑、
// 照常报，只是没收窄——这正是「不许因为读不到东西就闭嘴」。
test('收窄不成：没有 project.json 时文案自己说出口径比平时宽', () => {
  const { projectDir, pluginDir } = makeRun({ ...WALKED_S2, project: null })
  try {
    assert.match(ctxOf(writeState(projectDir).stdout), /没能按「这个项目用得上哪些角色」收窄/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('收窄不成：没有 project.json 时 stderr 上留一行痕迹，不静默', () => {
  const { projectDir, pluginDir } = makeRun({ ...WALKED_S2, project: null })
  try {
    assert.match(writeState(projectDir).stderr, /产者交代：读不到 .*available_roles/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 收窄不成那一刻，口径真的变宽了：at-pm 被算进来。这条是上面两条的正向锚——
// 光钉「文案说了它没收窄」与「stderr 有痕」，在收窄其实照常生效、只是多喊了一嗓子时
// 同样绿。
test('收窄不成：口径真的变宽——同一份 state 上 at-pm 这次被点名了', () => {
  const { projectDir, pluginDir } = makeRun({ ...WALKED_S2, project: null })
  try {
    assert.match(ctxOf(writeState(projectDir).stdout), /S1 的 at-pm/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 反面：收窄成功时既不留那行痕迹、文案里也没有那句话。两条否定断言各配正向锚——
// stderr 那条锚在「stdout 照常有回传」，文案那条锚在「该点名的还是点了」。
test('收窄成功时 stderr 不留那行痕迹（锚：stdout 照常回传，不是整条通道哑了）', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    const { stdout, stderr } = writeState(projectDir)
    assert.ok(ctxOf(stdout), '产者交代必须照常回传，否则下面那条证明不了任何事')
    assert.equal(stderr.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('收窄成功时文案里没有「没能收窄」那句话（锚：该点名的那个还是点了）', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    const ctx = ctxOf(writeState(projectDir).stdout)
    assert.ok(ctx.includes('S2 的 at-ui'), '该点名的那一条必须还在，否则下面那条证明不了任何事')
    assert.doesNotMatch(ctx, /没能按/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 收窄不成时，① 那条给的是**形状**而不是真实的第一条 gap。实测过：不收窄时第一条
// 常常是 {"at-pm": "S1"}，而把 at-pm 写进 trimmed 是确确实实错的（它是每一趟的驱动者，
// commands/at-init.md 明令 available_roles 不写它），偏偏 validateState 会放它过去
// ——at-pm 真的是 S1/S4/S8 的产者，形状校验挑不出毛病。这就是本仓库「失败文案把人指向
// 错误修法」那一族的第三种形状：**文案给的示例本身是错的修法**。
// 正向锚是上面「带上可以照抄的形状」那条：收窄成功时它给的就是真实那一条。
test('收窄不成：文案不拿 at-pm 当 trimmed 的示例，给的是占位形状', () => {
  const { projectDir, pluginDir } = makeRun({ ...WALKED_S2, project: null })
  try {
    const ctx = ctxOf(writeState(projectDir).stdout)
    assert.ok(ctx.includes('{"<角色名>": "<阶段 id>"}'), '占位形状必须在，否则下面那条证明不了任何事')
    assert.doesNotMatch(ctx, /\{"at-pm": "S1"\}/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ——— M3b 修复轮 1：产者交代的收尾也按「收件人改不改得了 state.json」分支 ———
//
// 这条回传曾经被断言**到不了非 PM 手里**（buildCoverageNotice 上方那段注释的原话），
// 那个全称量词实测不成立：readRunContext 把「current-run 指向的 run 目录不存在」判成
// kind:'no-run'，H3 在那一支对**所有角色** fail open，非 PM 因此写得成
// runs/<id>/state.json；写完那一刻 ctx 已经 ok，ledger 照常走到 kind === 'state'。
// **而窗口在同一刻关上**——他的下一次写入就被 H3 拒了，于是收件人拿到这条提示时已经
// 改不了它。与账本比对那一条**同一个形状，只是门更窄**。完整机制在 gate.mjs 里。
//
// ⚠️ **M3b「坏指针的窗口」把上面那条路关上了**：那种 ctx 已经归 unreadable，H3 在那一支
// 拒非 PM，所以「非 PM 到得了这条回传」今天没有已知的确定性路径了。**下面这几条不因此
// 作废，也不改一个字**——它们钉的是「这一帧长这样时文案说什么」，而这一帧的构造理由
// 写在下一段里（ledger 从不判这次写入当初该不该被放行，那是另一个 hook 的事）。
// 为什么分支本身留着（不是「万一」，有三条具体理由），写在 gate.mjs 的
// buildCoverageNotice 上方，不在这里重复第二遍。
//
// ⚠️ **夹具不需要去重建那个坏掉的 run**：ledger 这个检查项读的输入在两种情形下逐字
// 相同（ctx.ok + tool_input.file_path 指着 state.json + agent_type 是那个非 PM），
// 它自己不判「这次写入当初该不该被放行」——那是 H3 在 PreToolUse 上的事，另一个 hook。
// 直接换 agent_type 就是那一帧的真实形状，不是简化。
//
// 下面每条只换 writeState 的第二个参数。诊断那一半（哪一段的哪个角色、口径宽不宽、
// 驱动者护栏）对谁都成立，由上面那几组钉着，这里不重复。

test('M3b：收件人是 at-backend 时，产者交代不再用「两条出路，逐个按事实选一条」那种「你去改」的口吻', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.doesNotMatch(ctxOf(writeState(projectDir, 'at-backend').stdout), /两条出路，逐个按事实选一条/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 上一条的正向自检锚，钉在**判据真正迭代的那一层**：不是「这份夹具有没有回传」
// （那只证明夹具活着），是「同一份夹具、只把收件人换成 PM，那句口吻就回来」。
// 分支判据被改成恒「改不了」时这一条红；被改成恒「改得了」时上一条红。两条各守一侧。
test('M3b 正向自检锚：同一份夹具、收件人换成 at-pm 时那句口吻照旧出现——上一条守的是分支，不是文案整个没了', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-pm').stdout), /两条出路，逐个按事实选一条/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('M3b：收件人改不了时，产者交代要先说清这一条他改不了', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-backend').stdout), /这一条你改不了/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('M3b：收件人改不了时，产者交代要他把这一条原样冒泡给派他的人', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-backend').stdout), /原样冒泡给派你的人/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('M3b：收件人改不了时，产者交代要他别自己把它咽掉', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-backend').stdout), /不要自己把它咽掉/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ——— 下面四条：**信息不许在这一支里丢掉，只是换了谁动手** ———
//
// 「判据分辨不了真裁剪还是真漏派、读的人分辨得了」这件事**不随收件人变**，那正是两条
// 出路存在的全部理由。把这一支写成一句「转给 PM 吧」，等于替读的人做了那个判断——
// 而收件人常常恰恰是**做过那个裁剪决定的人本人**（M3a 真实那一趟：at-product 自决不派
// at-ui）。上面那几条 PM 侧的同族断言（trimmed 形状 / 去派出去 / roster 护栏）一一对应。

test('M3b：收件人改不了时，「判据分辨不了、你分辨得了」这句话没丢', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-backend').stdout), /判据分辨不了真裁剪还是真漏派，你分辨得了/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('M3b：收件人改不了时，① 那条裁剪出路连同可照抄的形状一起留着', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-backend').stdout), /trimmed[\s\S]*\{"at-ui": "S2"\}/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ② 那一条在这一支里是**部分做得到**：派人受 H1 的 can_delegate_to 管，可能行可能不行；
// 而记账那一半无论如何都在 PM 那边（roster 也住在 state.json）。两件事都要说出来，
// 只说一半会让他以为派完就没事了。
test('M3b：收件人改不了时，② 那条补派出路留着，并说清他可能真的做得到', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-backend').stdout), /派它出去这一半你可能真的做得到/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// 错误修法那条护栏在这一支里换了个方向：他自己写不了 roster，但他**往上带**的时候可以
// 把错的修法一起带上去，PM 照做一样把洞留着。所以护栏不能因为他动不了手就删掉。
test('M3b：收件人改不了时，「别把它说成把名字写进 roster 就行」那条护栏留着', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, 'at-backend').stdout), /不要把它说成「把名字写进 roster 就行」/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('M3b：收件人改不了时往 stderr 留一行痕，并点名是谁收到的', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(writeState(projectDir, 'at-backend').stderr, /产者交代：这次的回传落在 at-backend 手里/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 本仓库「fail open 必须留痕」是硬规矩，**但这一条不是 fail open**：运行上下文是好的、
// 判据照常算了、回传照常发了，没有放行任何东西——错的是收件人，不是判定。所以钉的是
// 正向的「写清它是什么」：复用 failOpenNotice 那一族的措辞会让这一条红，而一条否定式
// 断言在那种改法下反而可能照样绿。
test('M3b：产者交代那行痕要写清它不是 fail open', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(writeState(projectDir, 'at-backend').stderr, /没有放行任何东西/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 空断言，夹具整个哑掉时天然满足。它的正向锚是上面那条「收件人 at-backend 时 stderr
// 点名了他」——同一份夹具、同一条代码路径，只差 agent_type 一个字段。
// ⚠️ 这份夹具 narrowed 为真（project.available_roles 写齐了），所以这里的「空」同时
// 说明那条「没能按 available_roles 收窄」的痕迹也没有被误发——两条痕迹是两件事。
test('M3b：收件人是 at-pm 时不留那行痕——那条路径本来就通，留痕只是噪音', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.equal(writeState(projectDir, 'at-pm').stderr.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('M3b：收件人是主线程（没有 agent_type 这个键）时，产者交代保持「你去改」那一支', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.match(ctxOf(writeState(projectDir, null).stdout), /两条出路，逐个按事实选一条/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('M3b：收件人是主线程时也不留那行痕', () => {
  const { projectDir, pluginDir } = makeRun(WALKED_S2)
  try {
    assert.equal(writeState(projectDir, null).stderr.trim(), '')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ——— M3b「坏指针的窗口」：ledger 这一支本轮的变化是**开始留痕** ———
//
// 「current-run 指向的 run 目录不存在」本轮从 no-run 挪去 unreadable（论证在
// hooks/lib/runctx.mjs 头部）。对 project.json 那条缝，这意味着两件事分别落在
// 上面已有的两组判据上：触达表照发（缝本身不看 kind），而 `ctx.kind !== 'no-run'`
// 那一行**本轮开始对坏指针成立**，于是 fail-open 痕迹开始出现。
//
// ⚠️ **那一行痕开始出现是对的，不是回归**：上面「没有 run 时写 project.json：
// 不留 fail-open 痕迹」那一条的理由逐字是「在正路上刷一行……只会把人指向
// current-run 去查一个**根本不存在的问题**」。坏指针恰恰相反——current-run 里
// 真的有一个指不到东西的 id，**这时真有问题可指**。那条「正路不留痕」的判据
// 一个字没动，它守的仍然是 pointer 根本不在的 no-run。
//
// 拆成两条：同一次调用的两个侧面（该说的话说了没有 / 该留的痕留了没有），
// 放同一个 test() 里前一句失败会把后一句整个挡住——与上面 unreadable 那一组同一个
// 理由，也与它构成对照：那一组用空 current-run，这一组用坏指针，两个实物同一条理由。
const makeDanglingPointerRun = () => {
  const dirs = makeRun({
    runId: 'r1', stage: 'S1',
    project: { paths: { 'at-product': ['docs/'], 'at-backend': ['src/server/'] } },
  })
  // current-run 留着（内容仍然是 r1），删掉它指向的 run 目录。
  rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
  return dirs
}

test('坏指针（run 目录不存在）时写 project.json：触达表照发——在坏掉的 run 上重跑 /at-init 必须跑得完', () => {
  const { projectDir, pluginDir } = makeDanglingPointerRun()
  try {
    const { stdout, status } = writeProjectJson(projectDir)
    assert.equal(status, 0)
    const ctx = ctxOf(stdout)
    assert.ok(
      ctx,
      '坏指针是「这个 run 坏了」，而触达表的判据只有 roster.json + 刚写完的 project.json，' +
        '跟那个坏掉的 run 无关——stdout 为空意味着收窄把 /at-init 的逃生路径一起关掉了',
    )
    assert.match(ctx, /reach\.json/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('坏指针时写 project.json：fail-open 留痕本轮开始出现——这时 current-run 里真有一个指不到东西的 id', () => {
  const { projectDir, pluginDir } = makeDanglingPointerRun()
  try {
    const { stderr, status } = writeProjectJson(projectDir)
    assert.equal(status, 0)
    assert.match(
      stderr,
      /ledger 回传：读不到运行上下文（/,
      '门禁自己判不出来时必须留痕；措辞要说「读不到运行上下文」而不是「没有进行中的 run」' +
        '——指针在，说明有人开过 run，坏的是它指向的东西',
    )
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})
