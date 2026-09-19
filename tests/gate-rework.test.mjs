// H6（rework）在 gate.mjs 里，tests/rework-guard.test.mjs 覆盖不到的逻辑：decideRework
// 是纯函数，从不知道 tool_name 是 Edit 还是 Write、从不知道要去读磁盘上的旧版本、也从不
// 经过 denyAndExit——这些全部活在 hooks/gate.mjs 自己的 CHECK === 'rework' 分支里。结构
// 照抄 tests/gate-contract.test.mjs / tests/gate-writepath.test.mjs（同一个已定下的教训：
// 纯函数测试与"入口传导链"测试要分别覆盖）。
//
// GATE 直接从 gate-runner.mjs 拿，不在本文件里另算一份——tests/gate-ledger.test.mjs 头部
// 记着这个坑：win32 上 `new URL(...).pathname` 前面带一个斜杠，spawnSync 传给 node.exe
// 会被当成缺盘符的 POSIX 路径再拼一次，变成 "C:\C:\Users\..."，MODULE_NOT_FOUND。
//
// 每条 test() 只放一个断言（docs/11 §3.3 第 1 条）：deny 场景拆成"deny 发生了"与
// "理由说的是哪一条判据"两条，重跑一次夹具的代价换来一条断言归因不被前一条遮蔽。
//
// 修复轮 1 Minor 7：夹具的 try/finally 顺序——makeRun() 之后立刻进 try，磁盘写入与
// run() 调用都必须在 try 内部，不能在一个独立的辅助函数里先跑完再把结果连同 dirs 一起
// 传出来（旧版本就是这么写的：辅助函数在 try 之外整个跑完，一旦它自己抛异常，dirs 永远
// 传不到调用方手上，finally 里的 cleanup 也就永远不会执行，temp 目录直接泄漏）。下面的
// 夹具函数一律只接收已经建好的 dirs、只做"从这里往后可能失败的事"，调用方负责建 dirs
// 与包 try/finally。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

function cleanup(dirs) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
}

function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(obj), 'utf8')
}

test('rework：正常推进的 Write（history 追加一条）→ 放行，stdout 为空', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const before = JSON.parse(readFileSync(p, 'utf8'))
    const after = {
      ...before,
      stage: 'S3',
      history: [...before.history, { stage: 'S3', at: '2026-09-19T00:00:00Z' }],
    }
    const { stdout } = run(
      'rework',
      { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p, content: JSON.stringify(after) } },
      GATE,
      dirs.projectDir,
    )
    assert.equal(stdout.trim(), '')
  } finally {
    cleanup(dirs)
  }
})

// 夹具：磁盘上（"before"）是一条三阶段的 history；这次 Write 想把它换成只剩两条。
// 直接 writeFileSync 造"before"，不经过门禁——这份夹具的职责只是把磁盘状态摆到位，
// 跟 tests/gate-ledger.test.mjs「写了坏的 state.json」那条同一个手法。
function historyShrinkFixture(dirs) {
  const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
  const before = {
    run_id: '20260917-1430-fixture',
    stage: 'S3',
    contract_sha: 'PENDING',
    roster: [],
    artifacts: {},
    rework: {},
    never_invoked: [],
    escalations: [],
    history: [
      { stage: 'S1', at: '2026-09-17T14:30:00Z' },
      { stage: 'S2', at: '2026-09-17T14:40:00Z' },
      { stage: 'S3', at: '2026-09-17T14:50:00Z' },
    ],
  }
  writeJson(p, before)
  const after = { ...before, stage: 'S2', history: before.history.slice(0, 2) }
  return run(
    'rework',
    { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p, content: JSON.stringify(after) } },
    GATE,
    dirs.projectDir,
  )
}

test('rework：把 history 整体删短的 Write → deny', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S3' })
  try {
    const { stdout } = historyShrinkFixture(dirs)
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(dirs)
  }
})

test('rework：把 history 整体删短的 Write → deny 理由说"只许追加"', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S3' })
  try {
    const { stdout } = historyShrinkFixture(dirs)
    // ?? '' 防御：万一上一条断言本该抓到的回归又滑过去了（decisionOf 返回 null），
    // 这里要给出"空串不匹配"这种可读的断言失败，不要在这条测试里再抛一次
    // TypeError（读 null.permissionDecisionReason）盖掉真正的失败信息。
    assert.match(decisionOf(stdout)?.permissionDecisionReason ?? '', /只许追加/)
  } finally {
    cleanup(dirs)
  }
})

// 修复轮 1 Minor 6（对称覆盖）：上面测的是"history 删短"走 Write、下面 Edit 夹具测的是
// "rework 改小"走 Edit——两个工具各只测了一半，纯函数判据相同，不是逻辑洞，但补一条
// "history 删短走 Edit"就能把"这不是 Write 专属行为"这件事也钉住。用字符串删除模拟
// "删掉最后一条 history 记录"：old_string 是磁盘原文里 S3 那条记录本身（含它前面的
// 逗号），new_string 是空串。
test('rework：把 history 整体删短的 Edit → deny——对称覆盖，另一半已经在上面测过 Write', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S3' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const before = {
      run_id: '20260917-1430-fixture',
      stage: 'S3',
      contract_sha: 'PENDING',
      roster: [],
      artifacts: {},
      rework: {},
      never_invoked: [],
      escalations: [],
      history: [
        { stage: 'S1', at: 't' },
        { stage: 'S2', at: 't' },
        { stage: 'S3', at: 't' },
      ],
    }
    writeJson(p, before)
    const { stdout } = run(
      'rework',
      {
        tool_name: 'Edit',
        agent_type: 'at-pm',
        tool_input: { file_path: p, old_string: ',{"stage":"S3","at":"t"}', new_string: '' },
      },
      GATE,
      dirs.projectDir,
    )
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(dirs)
  }
})

// Edit 路径专用夹具——Step 5 第 3 点"读旧文本、按 old_string/new_string 自己套用一次
// 替换"那段逻辑，只有走这条夹具的测试能测到；纯函数 decideRework 的测试（
// tests/rework-guard.test.mjs）直接喂 before/after 两个对象，永远不经过这段替换代码。
//
// "before" 用 JSON.stringify（不带缩进）写盘，是为了让 old_string 是一个已知、唯一、
// 逐字确定的子串——`"rework":{"S5":1}`，不是猜出来的格式。
function editReworkShrinkFixture(dirs) {
  const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
  const before = {
    run_id: '20260917-1430-fixture',
    stage: 'S5',
    contract_sha: 'PENDING',
    roster: [],
    artifacts: {},
    never_invoked: [],
    escalations: [],
    history: [
      { stage: 'S1', at: '2026-09-17T14:30:00Z' },
      { stage: 'S5', at: '2026-09-17T14:40:00Z' },
      { stage: 'S5', at: '2026-09-17T14:50:00Z' },
    ],
    rework: { S5: 1 },
  }
  writeJson(p, before)
  return run(
    'rework',
    {
      tool_name: 'Edit',
      agent_type: 'at-pm',
      tool_input: { file_path: p, old_string: '"rework":{"S5":1}', new_string: '"rework":{"S5":0}' },
    },
    GATE,
    dirs.projectDir,
  )
}

test('rework：把 rework 改小的 Edit → deny', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const { stdout } = editReworkShrinkFixture(dirs)
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(dirs)
  }
})

test('rework：把 rework 改小的 Edit → deny 理由点名 S5', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const { stdout } = editReworkShrinkFixture(dirs)
    assert.match(decisionOf(stdout)?.permissionDecisionReason ?? '', /S5/)
  } finally {
    cleanup(dirs)
  }
})

// 修复轮 1 Important 3：上面的 Edit 夹具里 old_string 在全文只出现一次，走的是默认
// （replace_all 缺省/false）分支——`replace_all: true` 那条分支（split/join 全量替换）
// 从来没被走到过。评审实测：把 `beforeText.split(old_string).join(new_string)` 整个
// 改成 `null`，461/0 零红，因为没有任何测试真的传了 `replace_all: true`。
//
// 夹具让 old_string（`:1`，冒号紧跟数字 1，只会出现在数值字段的赋值位置，不会出现在
// 任何字符串字段——字符串字段的值前面永远是冒号紧跟引号）在文本里出现两次：
// `rework["S1"]` 与 `rework["S2"]` 恰好都是 1。`replace_all:true` 应该把两处都替换成
// 0；如果这条分支被换成恒 null，afterText 直接变 null、decideRework 会因为"新内容
// parse 不出来"而放行——预期的 deny 会变成放行，测试变红。
test('rework：Edit 的 replace_all:true 对多处出现全部生效，两个阶段都改小 → deny', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const before = {
      run_id: '20260917-1430-fixture',
      stage: 'S2',
      contract_sha: 'PENDING',
      roster: [],
      artifacts: {},
      never_invoked: [],
      escalations: [],
      history: [
        { stage: 'S1', at: 't' },
        { stage: 'S1', at: 't' },
        { stage: 'S2', at: 't' },
        { stage: 'S2', at: 't' },
      ],
      rework: { S1: 1, S2: 1 },
    }
    writeJson(p, before)
    const { stdout } = run(
      'rework',
      {
        tool_name: 'Edit',
        agent_type: 'at-pm',
        tool_input: { file_path: p, old_string: ':1', new_string: ':0', replace_all: true },
      },
      GATE,
      dirs.projectDir,
    )
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(dirs)
  }
})

// 修复轮 1 Important 4：gate.mjs 自己那两段 catch（读旧文件失败 → beforeText = null；
// JSON.parse 失败 → parseOrNull 返回 null）此前零测试覆盖——纯函数层的对应行为
// （decideRework 收到 before/after 为 null 时放行）有测试，但"gate.mjs 真的把磁盘异常
// /parse 异常转成 null，而不是让异常一路冒泡到最外层 fail-closed 的 crash 兜底"这条
// 传导链没有。评审实测：把这两处 catch 换成 denyAndExit，461/0 零红。
//
// 这条测的是"本趟第一次建 state.json"：磁盘上还没有这个文件，readFileSync 必须抛
// ENOENT，被 catch 住变成 beforeText = null，而不是让异常冒泡——如果冒泡，'rework' 是
// fail closed，会被 gate.mjs 最外层 catch 判成 deny，PM 连第一次建 run 都会被拦住。
test('rework：磁盘上还没有这份 state.json（本趟第一次建）→ 放行，不因为读文件异常被 fail-closed 兜底拒绝', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    rmSync(p, { force: true })
    const fresh = { stage: 'S1', history: [{ stage: 'S1', at: 't' }], rework: {} }
    const { stdout } = run(
      'rework',
      { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p, content: JSON.stringify(fresh) } },
      GATE,
      dirs.projectDir,
    )
    assert.equal(stdout.trim(), '')
  } finally {
    cleanup(dirs)
  }
})

// 同一条 Important 4，另一半——这次新内容本身不是合法 JSON（比如半截被截断）。
// gate.mjs 的 parseOrNull 必须自己吞掉 JSON.parse 抛出的 SyntaxError、返回 null，
// 而不是让它冒泡到最外层——冒泡的话同样会被 fail-closed 兜底判成 deny，PM 连"把写坏
// 的文件修回去"这个动作本身都做不成，正好是 rework-guard.mjs 头部那条 I2 理由要防的。
test('rework：这次 Write 的新内容不是合法 JSON → 放行，不因为 parse 异常被 fail-closed 兜底拒绝', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const { stdout } = run(
      'rework',
      { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p, content: '{not valid json' } },
      GATE,
      dirs.projectDir,
    )
    assert.equal(stdout.trim(), '')
  } finally {
    cleanup(dirs)
  }
})

// 修复轮 1 Major 2：下面这条"写的不是 state.json"曾经是"前面几条 deny 的正向自检
// 锚"，但评审实测戳穿了——它写的内容是 `# PRD\n`，本来就 parse 不出来，所以
// `isControlFile(...) && target.endsWith('/state.json')` 这半句路径判据在不在场，
// 结果都是放行（461/0 零红，两个子条件各自删掉都不变红）。它证明的只是"这个检查项
// 对语法错误的输入不 deny"，不是"它真的用路径判据把这个文件排除在外了"——因为错误的
// 原因而绿，形状与 docs/11 §3.1 记的那类问题一样。
//
// 保留它是因为它仍然是一条真实、有意义的行为（普通产物文件不受 H6 打扰），但不再声称
// 自己是锚点。
test('rework：写的不是 state.json（比如 01-prd.md）→ 放行', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', '01-prd.md')
    const { stdout } = run(
      'rework',
      { tool_name: 'Write', agent_type: 'at-product', tool_input: { file_path: p, content: '# PRD\n' } },
      GATE,
      dirs.projectDir,
    )
    assert.equal(stdout.trim(), '')
  } finally {
    cleanup(dirs)
  }
})

// 真正的路径判据锚点——gate.mjs 的判据是
// `isControlFile(filePath, agentTeamDir) && target.endsWith('/state.json')` 两个
// 条件的合取，要各自独立地被测到，需要两份不会被"内容 parse 不出来"蒙混过关的夹具：
// 磁盘上的"before"必须是合法的 state 形状 JSON，这次 Write 的"after"必须是相对它的一次
// 真实 shrink（decideRework 会拒的那种），这样"这个检查项对这份内容本该 deny 却放行了"
// 才是一句能立住的话，而不是"它对谁都放行"。
//
// 锚点①：比 runs/*/state.json 深一层的路径（runs/r1/extra/state.json）。它的文件名
// 以 state.json 结尾（endsWith 判据会放它通过），但相对 .agent-team 的段数是 4 段，
// isControlFile 的 CONTROL_FILES 模式没有一条是 4 段的，判它不是控制文件——这条只在
// `isControlFile(...) &&` 那半被删掉时才会变红。
test('rework：路径判据锚点①——比 runs/*/state.json 深一层的 state.json 不算控制文件，放行', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'extra', 'state.json')
    const before = { stage: 'S5', history: [{ stage: 'S1', at: 't' }, { stage: 'S2', at: 't' }, { stage: 'S3', at: 't' }], rework: {} }
    const after = { stage: 'S5', history: [{ stage: 'S1', at: 't' }, { stage: 'S2', at: 't' }], rework: {} }
    writeJson(p, before)
    const { stdout } = run(
      'rework',
      { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p, content: JSON.stringify(after) } },
      GATE,
      dirs.projectDir,
    )
    assert.equal(stdout.trim(), '')
  } finally {
    cleanup(dirs)
  }
})

// 锚点②：`.agent-team/project.json`——它是 CONTROL_FILES 里登记的另一个模式
// （isControlFile 判它是控制文件），但文件名不是 state.json（endsWith 判据会挡住它）。
// 内容碰巧是合法的 state 形状 JSON 并且这次 Write 是一次 shrink，纯粹是测试夹具、不是
// 在断言 project.json 真的会长这样——这条只在 `target.endsWith('/state.json')` 那半被
// 删掉时才会变红。
test('rework：路径判据锚点②——project.json 不是 state.json，即使内容长得像也放行', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    const p = join(dirs.projectDir, '.agent-team', 'project.json')
    const before = { stage: 'S5', history: [{ stage: 'S1', at: 't' }, { stage: 'S2', at: 't' }, { stage: 'S3', at: 't' }], rework: {} }
    const after = { stage: 'S5', history: [{ stage: 'S1', at: 't' }, { stage: 'S2', at: 't' }], rework: {} }
    writeJson(p, before)
    const { stdout } = run(
      'rework',
      { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p, content: JSON.stringify(after) } },
      GATE,
      dirs.projectDir,
    )
    assert.equal(stdout.trim(), '')
  } finally {
    cleanup(dirs)
  }
})
