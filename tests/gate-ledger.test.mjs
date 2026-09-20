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
// （`git log -S` / 那个 commit 的 diff 波及面）。完整记录见 `docs/11` §5.18 Ruling 26。
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
