// H3（writepath）在 gate.mjs 里 tests/writepath.test.mjs 覆盖不到的逻辑：
// decideWritePath 是纯函数，从不知道 ctx.ok 是什么、从不知道 tool_input 的
// 字段到底叫 file_path 还是 notebook_path、也从不经过 denyAndExit——这些全部
// 活在 gate.mjs 自己的 CHECK === 'writepath' 分支里。
//
// Task 3 评审的教训（Important 1）：ctx.ok === true → 判定 → denyAndExit
// 这条链此前只有手工烟雾测试验证过。H3 是 fail closed（跟 H2 的 fail open
// 相反），这里补对称的覆盖：ctx 不可读、role 判定、deny 传导、以及
// NotebookEdit 的路径字段名（这条是本任务实现时发现的真实分支，见下方
// 具体测试的注释）都要经真实子进程走一遍，不能只信纯函数测试。
//
// 评审三轮 Minor 4：下面每条测试都用 makeRun() 造出 { projectDir, pluginDir }
// 并在 finally 里清理两者，但 pluginDir 从未被真正用到——gate.mjs 的
// ROOT = join(HERE, '..') 是硬编码的真实仓库根，读的是仓库根那份真实
// stages.json（Task 2 的设计，测试帮手改不了它，跟 tests/gate-readiness.
// test.mjs 的既有取舍一致）。继续调用 makeRun 并清理 pluginDir 只是为了
// 不在系统临时目录里留垃圾，不代表这些测试真的控制了 stages.json 的内容；
// 涉及 run 目录内产物归属判定的用例（"00-contract.md"/"state.json"那几条）
// 全部依赖仓库根真实 stages.json 里 S1 是 at-pm、S5 是 at-backend 这两条
// 事实，不是夹具决定的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const PROJECT = {
  paths: {
    'at-backend': ['src/server/', 'src/shared/'],
    'at-frontend': ['src/web/', 'src/shared/'],
    // 故意给 __main__（callerOf 对主线程的判定值）也认领一段窄路径。
    // 如果没有这条，"主线程不受隔离约束" 那条测试即使 gate.mjs 里的
    // MAIN 豁免分支被删掉也会碰巧通过——decideWritePath 对不在
    // project.paths 里的角色本来就会直接放行（见 tests/writepath.test.mjs
    // 「不在 project.paths 里的角色不归本门禁管」），那条测试会在错误的
    // 理由下变绿。加了这条，__main__ 变成一个「已登记但没认领这条目标
    // 路径」的角色，唯一能让它仍然放行的就是 gate.mjs 里显式的 MAIN 豁免。
    __main__: ['docs/'],
  },
}

// Task 4 复审（顾虑 1 的真正解法）：这条原来用"干净临时目录、没有
// .agent-team"来代表"ctx.ok 为 false"，断言 deny。评审指出这个场景其实是
// readRunContext 新分类里的 kind:'no-run'（压根没有进行中的 run，门禁没有
// 东西要管），不该再 deny——见下面"没有 run 时"那几条。为了不丢失"H3 对
// 真实失败仍然 fail closed"这条覆盖，这里改成一个 run 真实存在、但
// project.json 被写坏的场景（kind:'unreadable'）：这正是评审点名的边界，
// "一个坏掉的 project.json 必须继续拒，否则把 project.json 写坏就成了
// 绕过 H3 的办法"。
test('writepath：run 存在但 project.json 坏了——仍然 fail closed，不能被"没有 run"那条放宽', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    // makeRun 已经造出 current-run + runs/r1/state.json，run 是真实存在的；
    // 只手动把 project.json 写成坏 JSON——不是"没有 run"，是"run 读不出来"。
    writeFileSync(join(dirs.projectDir, '.agent-team', 'project.json'), '{ not json', 'utf8')
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'server', 'api.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(
      out,
      'project.json 损坏时必须仍然 deny——如果这里放行了，说明 no-run 的判定被错误地' +
        '放宽到了"run 存在但读不出来"这一类，写坏 project.json 就变成了绕过 H3 的办法',
    )
    assert.equal(out.permissionDecision, 'deny')
    // 评审三轮 Minor 5：只断言 deny 抓不住"因为别的原因凑巧也 deny"这类
    // 问题（比如 kind 分类错了、走到了别的 deny 分支）——理由必须真的
    // 指向"读不到运行上下文"，不是巧合撞上了同一个决定。
    assert.match(out.permissionDecisionReason, /运行上下文/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 全分支评审 I2：上一条（子代理）是 unreadable 继续 fail closed 的那一半，
// 下面三条是另一半——被 settings.json 钉成主线程的 at-pm 必须能过去。
//
// 为什么：H4 在 Task 5 评审之后已经把 PM 的短路排到了读 ctx 之前，理由写在
// hooks/gate.mjs 的 contract 分支里（「修复一个坏掉的 run 恰恰要 PM 动手，
// 门禁会把自己需要的人也锁在门外」）。H3 当时没有跟着做，只豁免 role ===
// MAIN，而本仓库自己的 settings.json 是 {"agent": "at-pm"}，主会话的 hook
// 输入带 agent_type: 'at-pm'（M0 实测「次要事实」），落不进 MAIN。三点叠成
// 硬死锁：(a) unreadable 的 deny 发生在看路径之前，拒的是这个会话的每一次
// Edit/Write，不只是敏感路径；(b) agents/at-pm.md 现在有 Bash（M1c 设计
// §1.1 的上界要求），但逼 PM 用 `echo >` 去修一个坏掉的 run 不是可接受的
// 运维路径；(c) 触发条件很廉价——project.json / state.json 坏了、或
// current-run 被截断成空文件，任意一条即可。结果是插件把自己唯一的运维人
// 锁在门外，只能由用户离开 Claude 手工改文件。同一个死锁形状在这条分支上
// 是第三次出现（H3 自己在 Task 4 修过自举死锁、H4 在 Task 5 修过）。
//
// （终审修复轮发现 5 复评：这条注释与下面 :118 的断言失败消息此前都还写着
// 「PM 的工具面没有 Bash」——commit 2d0147c 给 at-pm.md 加上 Bash 之后这句话
// 就不成立了，hooks/gate.mjs 的同款注释已经在发现 5 那次改过，这里是镜像、
// 没跟着改。断言逻辑与测试行为不变，只是这两处文字对齐 gate.mjs 现在的措辞。）
//
// 这条短路只放在 unreadable 那一支，不像 H4 那样提到读 ctx 之前——ctx 读得
// 出来时 at-pm 仍然是一个受完整 per-role 隔离约束的角色（见
// hooks/lib/writepath.mjs 里 run 目录那块旁边记的 I3 缺口），这次不动那条
// 语义。
test('writepath：project.json 坏了（unreadable），被钉成主线程的 at-pm 写普通源码——放行且留痕，不能把唯一的运维人锁在门外', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    writeFileSync(join(dirs.projectDir, '.agent-team', 'project.json'), '{ not json', 'utf8')
    const input = {
      tool_name: 'Edit',
      agent_type: 'at-pm',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'x.ts') },
    }
    const { stdout, stderr, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      'unreadable 时 PM 的每一次 Edit/Write 都被拒，等于这个会话里没有任何逃生路径——' +
        'at-pm 现在有 Bash，但逼它用 `echo >` 去修一个坏掉的 run 不是可接受的运维路径',
    )
    assert.ok(stderr.trim().length > 0, '这是一次 fail open，必须留痕，不能悄悄放行')
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /(H3|写路径)/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 逃生路径本身：坏掉的就是 project.json，修它的人只能是 PM。这条与
// tests/gate-contract.test.mjs 里「project.json 坏了…被钉成主线程的 at-pm
// ——仍然放行」对齐——两道闸此前对同一个身份给出相反结论（H3 说「at-pm 是
// 一个普通角色」、H4 说「at-pm 是 PM」），这是六道闸之间最实在的一处语义
// 打架，现在收口。
test('writepath：project.json 坏了（unreadable），at-pm 修 .agent-team/project.json 本身——放行，这正是逃生路径', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    writeFileSync(join(dirs.projectDir, '.agent-team', 'project.json'), '{ not json', 'utf8')
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(dirs.projectDir, '.agent-team', 'project.json') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '门禁不能把修复它自己所需的那个人也拦在外面')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// unreadable 的来源不止 project.json——current-run 被截断成空文件同样是
// unreadable（见 hooks/lib/runctx.mjs 头部注释：pointer 存在但内容为空属于
// 异常状态，不是干净的缺席）。这条钉住短路认的是 kind 而不是某一个具体的
// 坏文件。
test('writepath：current-run 是空文件（unreadable），被钉成主线程的 at-pm——同样放行，短路认的是 kind 不是某个具体坏文件', () => {
  const dirs = makeRun({ runId: 'r1' })
  try {
    writeFileSync(join(dirs.projectDir, '.agent-team', 'current-run'), '', 'utf8')
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-pm',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'x.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '带插件前缀的 agent_type 也要剥完前缀再判 PM，口径与 H1/H4 一致')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// Task 4 复审：current-run 内容含路径穿越字符同样必须继续 fail closed——
// 这是路径可信边界问题，不是"没有 run"。
test('writepath：current-run 内容含路径穿越字符——仍然 fail closed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-traversal-cwd-'))
  try {
    mkdirSync(join(cwd, '.agent-team'), { recursive: true })
    writeFileSync(join(cwd, '.agent-team', 'current-run'), '../../evil', 'utf8')
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(cwd, 'src', 'server', 'api.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, 'current-run 含路径穿越字符时必须 deny，不能被当成"没有 run"放行')
    assert.equal(out.permissionDecision, 'deny')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// MAIN（无 agent_type）豁免必须排在 ctx.ok 判定之前——理由（规格 §6 表格
// H1/H3 的措辞差异、不排前面会怎样自举死锁）见 hooks/gate.mjs 里这段判定
// 上方的注释，不在这里重复。
test('writepath：没有 agent_type（真·主线程）时放行，即使 ctx.ok 为 false——不会自己把自己锁死', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-main-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: join(cwd, '.agent-team', 'project.json') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      '无 agent_type 的调用不受 per-role 隔离约束，且不能被"读不到上下文"卡住——' +
        '否则 /at-init 从主线程写 .agent-team/project.json 这类自举动作会被永久拒绝，' +
        '第一个 run 永远建不出来',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// kind:'no-run' 的判定不区分调用者带不带 agent_type——定义与理由见
// hooks/lib/runctx.mjs 头部注释。这条验证"有名有姓的角色"这一般情形，
// 下面那条验证死锁场景本身（at-pm 写 project.json）。
test('writepath：没有 run 时，有名有姓的角色（非 MAIN）也放行——按 no-run 处理，不因为不是 MAIN 就被收紧', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-norun-named-cwd-'))
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(cwd, 'src', 'server', 'api.ts') },
    }
    const { stdout, stderr, status } = run('writepath', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '没有 run 不该走 deny JSON，即使调用者带着 agent_type')
    assert.ok(
      stderr.trim().length > 0,
      '必须往 stderr 留痕；静默的放行和门禁坏掉长得一模一样（H2 立下的先例）',
    )
    assert.match(stderr, /agent-team/)
    assert.match(stderr, /(H3|写路径)/)
    assert.match(stderr, /current-run/, 'stderr 里应带上 readRunContext 给出的具体原因')
    // 复评 Minor 2：整理项 10 的修复本体是 failOpenNotice 里那条
    // `ctx.kind === 'no-run' ? … : …`，此前全仓没有一条断言检查措辞——把三元
    // 塌回单一字符串、或把两支调换，都不会有任何测试变红，刚修掉的口径分叉
    // 可以静默回归。这条钉住 no-run 那一支。
    //
    // 必须连检查项名一起锚定，不能只 match /没有进行中的 run/：ctx.reason 本身
    // 就以"当前没有进行中的 run"结尾（见 hooks/lib/runctx.mjs 的 no-run 分支），
    // 只查那几个字的话，三元塌成"读不到运行上下文"也照样绿——那正是这条测试
    // 要防的回归。锚到"检查项名：措辞（"这个位置才有判别力。
    assert.match(
      stderr,
      /H3 写路径门禁：当前没有进行中的 run（/,
      'no-run 的措辞要说"没有进行中的 run"（门禁做出了有依据的判定：本次调用不归它管），' +
        '不能说成"读不到运行上下文"（那是门禁自己判不出来，意味着有东西坏了）——' +
        '对读到这行字的人，两者的下一步完全不同',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// 死锁场景本身：settings.json 的 agent 键把 at-pm 钉成主线程 agent 时，
// 主线程的 hook 输入带 agent_type（docs/05-M0-结论.md「次要事实」），不
// 享受上一条"无 agent_type"的豁免，走的是这条"kind:'no-run' 一般性放行"。
test('writepath：没有 run 时，被 settings.json 钉成主线程的 at-pm 写 project.json 不受阻——这正是死锁场景本身', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-bootstrap-cwd-'))
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(cwd, '.agent-team', 'project.json') },
    }
    const { stdout, status } = run('writepath', input, undefined, cwd)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      '/at-init 从被钉成主线程的 at-pm 写 .agent-team/project.json 这个自举动作' +
        '不该被拒绝，否则第一个 run 永远建不出来',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('writepath：ctx.ok 为 true，写自己名下的路径——deny 判定链没有被误触发，stdout 为空', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'server', 'api.ts') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '写自己认领的路径不该被 deny')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('writepath：ctx.ok 为 true，写别人名下的路径——deny 判定真的经 denyAndExit 传到 stdout，理由点名归属', () => {
  // project.json 从磁盘真实读出（makeRun 写的临时文件），agent_type 带插件
  // 前缀（顺带验证 callerOf 的剥前缀真的在这条路径上跑了），file_path 落在
  // at-frontend 的地盘里。
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(dirs.projectDir, 'src', 'web', 'App.tsx') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0, 'PreToolUse 的 deny 走 stdout JSON + exit 0，不是非零退出码')
    assert.ok(out, 'ctx.ok 为 true 且路径归属别人时必须有 deny 判定，stdout 不该是空的')
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(
      out.permissionDecisionReason,
      /at-frontend/,
      '理由里必须点名真正的归属方——只断言 deny 抓不住 ctx.project/role 传错这类问题',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('writepath：主线程（无 agent_type）不受 per-role 隔离约束，即使路径归别人也放行', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      // 故意不带 agent_type：模拟主线程直接调用 Edit。目标路径落在
      // at-frontend 的地盘，且 PROJECT.paths 里 __main__ 自己认领的是
      // docs/，两者都不含这条路径——唯一能让这里放行的就是 gate.mjs 里
      // 显式的 MAIN 豁免分支，不是"这个角色恰好没在花名册里"这种巧合。
      tool_input: { file_path: join(dirs.projectDir, 'src', 'web', 'App.tsx') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '主线程调用不该被 per-role 隔离拦住')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 本任务实现时发现的真实分支：NotebookEdit 的工具 schema 里路径字段叫
// notebook_path，不叫 file_path（Edit/Write 才是 file_path）。如果 gate.mjs
// 只读 tool_input.file_path，每一次 NotebookEdit 调用都会拿到 undefined，
// 命中 decideWritePath「没有可判定路径」那条分支而无条件放行——
// checks.mjs 把 NotebookEdit 列进 H3 的 toolNames 就白列了，这道闸对它
// 会静默失效，且不会被 tests/writepath.test.mjs 那份纯函数测试抓到（它
// 测的是 decideWritePath 本身，不测 gate.mjs 从 tool_input 里挖哪个字段）。
test('writepath：NotebookEdit 用 notebook_path 而不是 file_path 也能被正确判定', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'NotebookEdit',
      agent_type: 'agent-team:at-backend',
      tool_input: { notebook_path: join(dirs.projectDir, 'src', 'web', 'analysis.ipynb') },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(
      out,
      'notebook_path 落在别人地盘时必须 deny——如果这里 stdout 是空的，说明字段名读错了（读成了 file_path），H3 对 NotebookEdit 完全失效',
    )
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /at-frontend/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// at-pm 不是 callerOf 判定的 MAIN（settings.json 钉住主线程时 hook 输入带
// agent_type，见上面的死锁场景测试），会作为有名有姓的角色走到 run 目录
// 内的产物归属判定。这条钉住：at-pm 写它自己在 S1 产出的 00-contract.md
// 放行——依据是仓库根真实 stages.json 里 S1.role === 'at-pm'、
// S1.produces 含 '00-contract.md'（评审三轮 Important 2 收紧之后，run
// 目录下的合法写入集是"自己阶段的 produces"，不再是"目录下任何东西"，
// 见 hooks/lib/writepath.mjs 里 decideWritePath 的用法注释）。
test('writepath：被 settings.json 钉成主线程的 at-pm（带 agent_type）写 run 目录下的 00-contract.md 不受阻', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      'at-pm 写自己在 run 目录下的产物不该被 H3 拒绝，否则 S1 完不成、整条阶段链起不来',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 整理项 4：at-pm 在仓库根真实 stages.json 里是两个阶段的执行者——S1
// （00-contract.md，上一条测的）与 S4（04-dispatch.md，这一条）。上一条单独
// 存在时，只要"是不是我的"这层判定只认该角色的第一个阶段就能通过，两份
// produces 都能写这件事其实没有被钉住。补这一条把它钉死：它是
// hooks/lib/writepath.mjs 里 I3 那段缺口注释中唯一还正确的行为，也是
// hooks/lib/deliverable.mjs 里 I4 那条错误语义（H5 用"第一个未完成的阶段"代替
// "刚结束的阶段"）的对照面——将来为了修 I4 去动这套按角色取阶段的代码时，这条
// 会拦住顺手改坏 H3 的那一手。M2a：这层判定现在由 stageOwnerOfRunPath 逐阶段
// 匹配 target（不再是已删除的 producesOf 按角色累加），S1/S4 各自独立命中，
// 这条测试对新实现依然成立、不需要改。
test('writepath：被钉成主线程的 at-pm 写 S4 的产物 04-dispatch.md 也不受阻——同一角色多个阶段的 produces 都能写', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '04-dispatch.md'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)

    assert.equal(status, 0)
    assert.equal(
      stdout.trim(),
      '',
      // M2b 终审 B1：原文写的是「at-pm 是 S1 与 S4 两段的执行者」——**报了个总数，而且
      // 是错的**（S8 的 role 也是 at-pm）。这是会被打印出来的活文案，与裁定「活文案不报总数」处理
      // agents.test.mjs 那条「六个角色」同一类。按「列举，不报总数」那一族（docs/16 §3.1）。
      'at-pm 是 S1、S4、S8 各段的执行者，这些段的产物都该能写——只放行 S1 等于 S4 永远交不出来',
    )
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 评审三轮 Important 2 的子进程级证据：run 目录下的写入现在按 ctx.stages
// 收紧到"自己阶段的 produces"。00-contract.md 是 S1 的产物、归 at-pm——
// at-backend 写它必须 deny，且理由要点名真正的阶段与角色，不能只断言
// deny（那样抓不住"stages 传错/传漏"这类问题）。
test('writepath：run 目录下写别人阶段的产物——仍然 deny，理由点名哪个阶段、归谁', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, '00-contract.md 是 S1 的产物、归 at-pm，at-backend 写它必须 deny')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /at-pm/)
    assert.match(out.permissionDecisionReason, /S1/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// state.json 不是任何阶段的 produces——它是运行状态文件，H2 就绪门禁的
// artifactExists 就是在 run 目录下解析的，H4/H5 也要读它。如果角色能在
// run 目录下随便写，state.json 首当其冲：改写它就能伪造后续门禁的判据。
test('writepath：run 目录下写 state.json——仍然 deny，它不是任何阶段的产物', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(
      out,
      'state.json 落在 run 目录下但不是任何阶段的产物——如果这里放行了，说明 run 目录' +
        '豁免又退回了"目录下任何东西都放行"的旧行为',
    )
    assert.equal(out.permissionDecision, 'deny')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// H3：run 目录的兄弟目录同前缀粘连（docs/11 §1.5 第 3 点）。docs/11 举的例子字面
// 是 `.agent-team-backup` 对 `.agent-team`，跟 tests/path-norm.test.mjs 钉住的纯
// 函数场景一致。但动手前核对 decideWritePath 的实现发现：underDir 在这个函数里
// 唯一的调用点传的第二个参数是 runDir（`.agent-team/runs/<id>`），不是 agentTeamDir
// （`.agent-team`）本身——agentTeamDir 层面的判定走的是 isControlFile 自己另一份
// 独立、已经带结尾 `/` 的 inline 前缀检查（hooks/lib/control-files.mjs），根本不经过
// underDir。这意味着"`.agent-team-backup` 对 `.agent-team`"这个具体输入，即使
// underDir 退化成不带结尾 `/` 的裸 startsWith，在 decideWritePath 这条调用链上也
// 不会被误判——两个字符串在到达共同的 `runs/r1` 后缀之前就已经分叉了（`.agent-team`
// 后面接的是 `/`，`.agent-team-backup` 后面接的是 `-backup`）。这一点已经用 cp 备份
// hooks/lib/path-norm.mjs、手动把 underDir 退化成裸 startsWith 实测验证过：这个输入
// 在退化版本下依然是 false，path-norm.test.mjs 那条纯函数测试会变红，但下面这条不会。
//
// 于是这里补两条，不是一条：
// 1. 先把 docs/11 字面写的场景原样钉住——这是一条合法、独立的不变量（"跟
//    .agent-team 同前缀的兄弟目录不会被误认成控制文件或 run 目录产物"），只是
//    它不会被 underDir 的裁剪 bug 触发，对那个 bug 不敏感。
// 2. 再补一条 decideWritePath 真实调用点的参数形状会撞上的版本——runDir 自己的
//    兄弟：run r1 进行中时，`runs/r1-backup/01-prd.md` 对 `runs/r1` 同前缀粘连。
//    这一条才是"若 underDir 的调用点被错误换成裸 startsWith，H3 层面会变红"这句
//    话真正成立的那一条（同一次实测：退化版本下这条输入是 true，即误判成落在
//    run 目录里）。
test('H3：跟 .agent-team 同前缀的兄弟目录不算控制文件也不算 run 目录内——.agent-team-backup 对 .agent-team 必须 false（docs/11 §1.5 第 3 点字面场景）', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team-backup', 'runs', 'r1', '01-prd.md'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, '.agent-team-backup/... 不在 PROJECT.paths 任何角色名下，必须 deny')
    assert.equal(out.permissionDecision, 'deny')
    // 理由必须是函数末尾 project.paths 那一支的通用兜底措辞，不能是 run 目录
    // 那一支的"不是任何阶段的 produces"——下面的自检锚证明这两支措辞真的不同。
    assert.match(out.permissionDecisionReason, /没有被任何角色认领/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('H3：run 目录自己的兄弟目录同前缀粘连不算在 run 目录内——runs/r1-backup 对 runs/r1 必须 false（decideWritePath 真实调用点会撞上的版本，已用退化 underDir 实测验证）', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1-backup', '01-prd.md'),
      },
    }
    const { stdout, status } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.equal(status, 0)
    assert.ok(out, 'runs/r1-backup/... 不是这次 run（r1）认领的产物，也不在 PROJECT.paths 任何角色名下，必须 deny')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /没有被任何角色认领/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 正向自检锚：上面两条证明的都是"这个具体场景被 deny、理由是 project.paths 通用
// 兜底那一支"，但没证明"如果真的落进了 run 目录保护块，reason 真的会换成另一句
// 话"——万一两支措辞将来改得很像，上面那两条正则可能变成随便什么 deny 都能碰巧
// 匹配上的假阳性覆盖。这里换一个真的落在 run 目录里、且真的是 S2 产物的同名文件
// （01-prd.md），角色仍用 at-backend（S2 的执行者是 at-product，不是它），
// 断言 reason 点名"归 at-product"——证明两支措辞确实不同，上面两条的正则不是
// 巧合才匹配上的。同一条锚点服务上面两条测试，不需要各写一份。
test('自检：同名的 01-prd.md 若真的落在 run 目录里，reason 点名"归 at-product"——证明两支措辞真的不同', () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const input = {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: {
        file_path: join(dirs.projectDir, '.agent-team', 'runs', 'r1', '01-prd.md'),
      },
    }
    const { stdout } = run('writepath', input, undefined, dirs.projectDir)
    const out = decisionOf(stdout)

    assert.match(out.permissionDecisionReason, /归 at-product/)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// docs/09 账一：控制文件与阶段产物分家的子进程级传导链。纯函数测试
// （tests/writepath.test.mjs）证明判据本身没错，这里证明 ctx.agentTeamDir 真的
// 从 runctx.mjs 传到了 gate.mjs 再传到 decideWritePath——这一层传导链此前没有
// 任何测试覆盖，M1a Task 3 就是栽在"只有纯函数测试"上（docs/08 ②）。

test('ctx.ok 时：被钉成主线程的 at-pm 能写 state.json（账一，走控制文件规则）', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const { stdout, stderr } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    assert.equal(decisionOf(stdout), null, '不该有拒绝输出')
    // 自证「走的不是 I2 豁免」：I2 豁免必留 /读不到运行上下文/ 这行 stderr 痕迹
    // （见 gate.mjs 的 failOpenNotice 调用点），控制文件规则那条路径不会打它。
    // 不加这行的话，「这条测试走的是控制文件规则」目前只能靠 Step 12 变异跑的
    // 历史记录佐证，不是靠断言本身。
    assert.doesNotMatch(stderr, /读不到运行上下文/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('ctx.ok 时：at-backend 写 state.json 被拒，理由点名控制文件', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const { stdout } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    const d = decisionOf(stdout)
    assert.equal(d.permissionDecision, 'deny')
    assert.match(d.permissionDecisionReason, /控制文件/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 这里必须用**未登记**角色（at-outsider 不在 PROJECT.paths 里）。
// 用 at-backend 的话这条测试会在错误的理由下变绿：它是登记过的角色，改动前写
// .agent-team/project.json 本来就会被「这条路径没有被任何角色认领」拒掉，
// 根本走不到「静默放行」那条早退。真正被这次改动堵上的是未登记角色那条路
// （Object.hasOwn(owners, role) 早退 → allow），纯函数层由
// tests/writepath.test.mjs 的 at-outsider 用例覆盖，这条补的是子进程级那一层
// （docs/09 账一实现约束第 4 条：两层都要有）。
test('ctx.ok 时：at-outsider 写 project.json 被拒（此前会被静默放行）', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', project: PROJECT })
  try {
    const { stdout } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-outsider',
      tool_input: { file_path: join(projectDir, '.agent-team', 'project.json') },
    }, GATE, projectDir)
    const d = decisionOf(stdout)
    assert.equal(d.permissionDecision, 'deny')
    assert.match(d.permissionDecisionReason, /控制文件/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 这一条与上面第一条**不是同一条规则**，别把其中一条的绿当成另一条生效。
// 这里 run 目录存在但 state.json 缺失 → readRunContext 走 kind:'unreadable'
// → 放行 at-pm 的是 gate.mjs 里 I2 那条 PM 豁免，控制文件规则根本没跑到
// （decideWritePath 压根没被调用）。这是 PM 建第一个 run 的真实路径。
test('unreadable 时：at-pm 仍被放行，但走的是 I2 豁免而不是控制文件规则', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', project: PROJECT })
  try {
    rmSync(join(projectDir, '.agent-team', 'runs', 'r1', 'state.json'), { force: true })
    const { stdout, stderr } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    assert.equal(decisionOf(stdout), null)
    // 这两行 stderr 是 I2 豁免独有的留痕，控制文件规则那条路径不会打它。
    assert.match(stderr, /读不到运行上下文/)
    assert.match(stderr, /调用者是 PM/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('unreadable 时：at-backend 写 state.json 仍然 fail closed', () => {
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', project: PROJECT })
  try {
    rmSync(join(projectDir, '.agent-team', 'runs', 'r1', 'state.json'), { force: true })
    const { stdout } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    assert.equal(decisionOf(stdout).permissionDecision, 'deny')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ——— M3b「坏指针的窗口」：current-run 在、非空，但它指向的 runs/<id>/ 不存在 ———
//
// 这个输入状态此前归 kind:'no-run'，H3 因此在这里对**所有角色** fail open。
// 子进程级实测（改动前）：at-backend 写得成 runs/r1/state.json、写得成别人认领的
// 路径、也写得成自己的地盘——**H3 是 fail-closed 的检查项，它有一个输入状态对所有人
// fail open**。本轮把这一格挪去 unreadable 关上它；分类本身的论证在
// hooks/lib/runctx.mjs 头部，不在这里重复第二遍。
//
// 下面几条各守一件事、各占一个 test()：
//   · 非 PM 被拒（窗口关上了）——两条，一条控制文件、一条它自己的地盘；
//   · PM 仍然通（**收窄的全部前提就是「坏掉的 run 还修得了」**）——两条，
//     其中一条写的正是 current-run 本身，那是修好这个坏指针的那一次写入。
// 自举那一侧的正向锚不在这里另写：上面「没有 run 时，有名有姓的角色（非 MAIN）也
// 放行」与「没有 run 时……at-pm 写 project.json 不受阻」两条走的是 pointer **根本
// 不在**的 no-run，本轮一个字没碰它们，它们正是「收窄没有波及自举」的守卫。
const makeDanglingPointer = () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  // current-run 留着（内容仍然是 r1），只删掉它指向的 run 目录——这就是坏指针。
  rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r1'), { recursive: true, force: true })
  return dirs
}

test('坏指针（current-run 指向的 run 目录不存在）：at-backend 写 runs/r1/state.json 被拒——这个窗口本轮关上了', () => {
  const { projectDir, pluginDir } = makeDanglingPointer()
  try {
    const { stdout, status } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    assert.equal(status, 0)
    const out = decisionOf(stdout)
    assert.ok(out, '坏指针下非 PM 写控制文件必须 deny——这里放行就是那个 fail-open 窗口回来了')
    assert.equal(out.permissionDecision, 'deny')
    // 光断言 deny 抓不住「这个 deny 其实来自别处」：理由必须同时点名 fail-closed 的
    // 那条措辞与这次失败的**具体原因**，否则 kind 被塌成别的取值、或 deny 由另一条
    // 分支发出，这条照样绿（与本文件 project.json 损坏那条同一个手法）。
    assert.match(out.permissionDecisionReason, /读不到运行上下文/)
    assert.match(out.permissionDecisionReason, /不存在/, '理由里要带上「run 目录不存在」这个真实原因')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 这一条钉的是**爆炸半径**，不是又一次「控制文件被拦住」。unreadable 的 deny
// 发生在**看路径之前**（gate.mjs 的 writepath 分支：ctx 不 ok 就地 denyAndExit，
// decideWritePath 压根没被调用），所以坏指针下非 PM 连自己认领的地盘都写不了。
// 这是收窄要付的代价，写下来、由判据守着，不要让下一个人以为只拦了控制文件。
// 它与既有的「unreadable 时：at-backend 写 state.json 仍然 fail closed」不重复：
// 那一条钉的是控制文件这一类，这一条钉的是**本来合法的那一类也一起被拦**。
test('坏指针：at-backend 连自己认领的 src/server/ 也写不了——unreadable 的 deny 在看路径之前，爆炸半径就是这么大', () => {
  const { projectDir, pluginDir } = makeDanglingPointer()
  try {
    const { stdout } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(projectDir, 'src', 'server', 'api.ts') },
    }, GATE, projectDir)
    const out = decisionOf(stdout)
    assert.ok(out, 'ctx 读不出来时 H3 拒的是这个会话的每一次 Edit/Write，不只是控制文件')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /读不到运行上下文/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 下面两条是上面两条的**正向自检锚**，也是这次收窄的前提本身：收窄的全部前提
// 是「坏了还能修」。判据被错改成「unreadable 一律拒」时上面两条照样绿，红的是这两条。
test('坏指针：被钉成主线程的 at-pm 写 state.json 仍然放行，走 I2 豁免——修一个坏掉的 run 恰恰要 PM 动手', () => {
  const { projectDir, pluginDir } = makeDanglingPointer()
  try {
    const { stdout, stderr } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    assert.equal(decisionOf(stdout), null, '把插件唯一的运维人锁在门外，比多拒一次更糟')
    // 这两行 stderr 是 I2 豁免独有的留痕（与本文件上面那条同一份判别方式）：
    // 只断言「没被拒」的话，放行改由别的分支发出也照样绿。
    assert.match(stderr, /读不到运行上下文/)
    assert.match(stderr, /调用者是 PM/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('坏指针：at-pm 写 .agent-team/current-run 本身放行——那正是把这个坏指针修好的那一次写入', () => {
  const { projectDir, pluginDir } = makeDanglingPointer()
  try {
    const { stdout, stderr } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'current-run') },
    }, GATE, projectDir)
    assert.equal(
      decisionOf(stdout),
      null,
      '这一次写入就是逃生路径本身：拦住它，坏指针在 Claude 里就再也改不回来，' +
        '只能由用户离开会话手工改文件',
    )
    assert.match(stderr, /调用者是 PM/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ——— M3c「丢指针」：current-run **根本不在**，而 runs/<真实 id>/ 原封不动 ———
//
// 上面那一族的第三个实物，**比坏指针还便宜一个参数**（rm 比 echo bogus > 少一个）。
// 这个输入状态此前归 kind:'no-run'，H3 因此在这里同样对**所有角色** fail open：
// 子进程级实测（改动前）at-backend 写得成别人认领的路径、写得成 runs/r1/state.json、
// 也写得成 00-contract.md（H4 那一半在 tests/gate-contract.test.mjs）。
// 本轮把「指针不在**且** runs/ 非空」挪去 unreadable 关上它；分类本身的论证在
// hooks/lib/runctx.mjs 头部 ③，不在这里重复第二遍。
//
// ⚠️ **这一族与坏指针有一处不同，下面专门有一条钉它**：坏指针在正路上不可达，
// 而这一格**在正路上可达**——commands/at.md 第 1 节建 run 的顺序（先建目录与
// state.json、最后写 current-run）前半段就落在这一格里。所以「PM 通得过」在这里
// 不只是运维逃生路径，它是**建第一趟 run 这件事本身**。
const makeMissingPointer = () => {
  const dirs = makeRun({ runId: 'r1', project: PROJECT })
  // runs/r1/ 与它的 state.json 原封不动，只删掉指针——这就是这一格。
  rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
  return dirs
}

test('丢指针（current-run 不在、runs/ 非空）：at-backend 写别人认领的 src/web/ 被拒——这个窗口本轮关上了', () => {
  const { projectDir, pluginDir } = makeMissingPointer()
  try {
    const { stdout, status } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(projectDir, 'src', 'web', 'app.tsx') },
    }, GATE, projectDir)
    assert.equal(status, 0)
    const out = decisionOf(stdout)
    assert.ok(out, '丢指针下非 PM 写别人的地盘必须 deny——放行就是那个 fail-open 窗口回来了')
    assert.equal(out.permissionDecision, 'deny')
    // 光断言 deny 抓不住「这个 deny 其实来自别处」（比如 decideWritePath 的归属判定）：
    // 理由必须同时点名 fail-closed 那条措辞与这次失败的**具体原因**，手法与上面
    // 坏指针那一条同一份。
    assert.match(out.permissionDecisionReason, /读不到运行上下文/)
    assert.match(out.permissionDecisionReason, /非空/, '理由里要带上「runs/ 下非空」这个真实原因')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

test('丢指针：at-backend 写 runs/r1/state.json 被拒——控制文件这一类同样关上了', () => {
  const { projectDir, pluginDir } = makeMissingPointer()
  try {
    const { stdout } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(projectDir, '.agent-team', 'runs', 'r1', 'state.json') },
    }, GATE, projectDir)
    const out = decisionOf(stdout)
    assert.ok(out, '改动前这里放行，而 state.json 的 artifacts 是账本比对的唯一基线')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /读不到运行上下文/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 与坏指针那一族同理，这条钉的是**爆炸半径**，不是又一次「控制文件被拦住」：
// unreadable 的 deny 发生在**看路径之前**，所以丢指针下非 PM 连自己认领的地盘都
// 写不了。这是收窄要付的代价，写下来、由判据守着。
test('丢指针：at-backend 连自己认领的 src/server/ 也写不了——代价与既有的每一个 unreadable 状态一样大', () => {
  const { projectDir, pluginDir } = makeMissingPointer()
  try {
    const { stdout } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(projectDir, 'src', 'server', 'api.ts') },
    }, GATE, projectDir)
    const out = decisionOf(stdout)
    assert.ok(out, 'ctx 读不出来时 H3 拒的是这个会话的每一次 Edit/Write，不只是控制文件')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /读不到运行上下文/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 下面三条是上面三条的**正向自检锚**。判据被错改成「unreadable 一律拒」时
// 上面三条照样绿，红的是这三条——而它们红掉的后果分别是：run 接不回来、
// **第一趟 run 建不出来**、自举死锁。
test('丢指针：at-pm 写 .agent-team/current-run 本身放行——把指针写回去就是修好它的那一次写入', () => {
  const { projectDir, pluginDir } = makeMissingPointer()
  try {
    const { stdout, stderr } = run('writepath', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: join(projectDir, '.agent-team', 'current-run') },
    }, GATE, projectDir)
    assert.equal(
      decisionOf(stdout),
      null,
      '拦住它，一个丢了指针的 run 在 Claude 里就再也接不回来，只能由用户离开会话手工改文件',
    )
    // 这两行 stderr 是 I2 豁免独有的留痕：只断言「没被拒」的话，放行改由别的分支
    // 发出（比如 kind 被塌回 no-run）也照样绿。
    assert.match(stderr, /读不到运行上下文/)
    assert.match(stderr, /调用者是 PM/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})

// ⚠️ 这一条与上面那条**不是同一件事**，它是这一族独有的那一半：
// commands/at.md 第 1 节建 run 的顺序是「建目录 → 写 runs/<id>/state.json →
// 写 current-run」，**头两步跑在指针还没写、而 runs/ 已经非空的时刻**——也就是
// 这一格里。坏指针那一族在正路上不可达，这一格可达，所以这里放行的不是运维逃生
// 路径，而是**建第一趟 run 这个动作本身**。一条用例走完两步，因为要钉的是那个
// **顺序**：拆开就看不出它们是同一趟里相邻的两帧。
test('丢指针 · 正路瞬态：照 commands/at.md 第 1 节建第一趟 run，PM 的每一步都放行', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'agent-team-h3-firstrun-'))
  try {
    // /at-init 之后的形态：.agent-team 在、project.json 在、还没有任何 run。
    mkdirSync(join(projectDir, '.agent-team'), { recursive: true })
    writeFileSync(join(projectDir, '.agent-team', 'project.json'), JSON.stringify(PROJECT), 'utf8')
    const asPm = (file) => run('writepath', {
      tool_name: 'Write',
      agent_type: 'at-pm',
      tool_input: { file_path: file },
    }, GATE, projectDir)

    // 第 1 节第 2 步：目录已建（runs/ 非空、指针还没写 = 这一格），写 state.json。
    mkdirSync(join(projectDir, '.agent-team', 'runs', 'r1'), { recursive: true })
    const stateWrite = asPm(join(projectDir, '.agent-team', 'runs', 'r1', 'state.json'))
    assert.equal(
      decisionOf(stateWrite.stdout),
      null,
      '拦住这一步，第一趟 run 永远建不出来——这一格在正路上是可达的，不只是运维场景',
    )
    assert.match(
      stateWrite.stderr,
      /读不到运行上下文/,
      '走的是 unreadable 那一支的 I2 豁免，不是 no-run 的 fail open——' +
        '这半句话一变，说明这一格的分类又漂回去了',
    )

    // 第 1 节第 3 步：state.json 已落盘，写 current-run。仍然在这一格里。
    writeFileSync(join(projectDir, '.agent-team', 'runs', 'r1', 'state.json'), '{}', 'utf8')
    assert.equal(decisionOf(asPm(join(projectDir, '.agent-team', 'current-run')).stdout), null)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

// ⚠️ **这一刀的硬边界**：收窄认的是「runs/ 里有没有东西」，不是「runs/ 这个目录在不在」。
// 判据被错写成 existsSync(runsDir) 时上面每一条都照样绿，红的是这一条——而它红掉的
// 后果是：run 目录被清空过的项目里，整支班底一上来就写不了任何东西。
// 本文件上面「没有 run 时，有名有姓的角色（非 MAIN）也放行」那条走的是 .agent-team
// 整个不存在，与这条是同一条边的两个形态，两条都要在。
test('自举边界：runs/ 存在但是空目录——有名有姓的非 PM 角色仍然放行，按 no-run 处理', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-team-h3-emptyruns-'))
  try {
    mkdirSync(join(cwd, '.agent-team', 'runs'), { recursive: true })
    const { stdout, stderr, status } = run('writepath', {
      tool_name: 'Edit',
      agent_type: 'agent-team:at-backend',
      tool_input: { file_path: join(cwd, 'src', 'server', 'api.ts') },
    }, GATE, cwd)
    assert.equal(status, 0)
    assert.equal(stdout.trim(), '', '空的 runs/ 是「从来没有人建过 run」，仍然是干净的缺席')
    // 连措辞一起锚：只断言没被拒的话，kind 改判成 unreadable 而放行改由别的分支
    // 发出也照样绿——而这个角色根本不是 PM，它必须走 no-run 那一支。
    assert.match(stderr, /H3 写路径门禁：当前没有进行中的 run（/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
