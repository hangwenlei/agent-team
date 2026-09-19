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
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

function cleanup(dirs) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
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
function historyShrinkResult() {
  const dirs = makeRun({ runId: 'r1', stage: 'S3' })
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
  writeFileSync(p, JSON.stringify(before), 'utf8')
  const after = { ...before, stage: 'S2', history: before.history.slice(0, 2) }
  const result = run(
    'rework',
    { tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: p, content: JSON.stringify(after) } },
    GATE,
    dirs.projectDir,
  )
  return { ...result, dirs }
}

test('rework：把 history 整体删短的 Write → deny', () => {
  const { stdout, dirs } = historyShrinkResult()
  try {
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(dirs)
  }
})

test('rework：把 history 整体删短的 Write → deny 理由说"只许追加"', () => {
  const { stdout, dirs } = historyShrinkResult()
  try {
    // ?? '' 防御：万一上一条断言本该抓到的回归又滑过去了（decisionOf 返回 null），
    // 这里要给出"空串不匹配"这种可读的断言失败，不要在这条测试里再抛一次
    // TypeError（读 null.permissionDecisionReason）盖掉真正的失败信息。
    assert.match(decisionOf(stdout)?.permissionDecisionReason ?? '', /只许追加/)
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
function editReworkShrinkResult() {
  const dirs = makeRun({ runId: 'r1', stage: 'S5' })
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
  writeFileSync(p, JSON.stringify(before), 'utf8')
  const result = run(
    'rework',
    {
      tool_name: 'Edit',
      agent_type: 'at-pm',
      tool_input: { file_path: p, old_string: '"rework":{"S5":1}', new_string: '"rework":{"S5":0}' },
    },
    GATE,
    dirs.projectDir,
  )
  return { ...result, dirs }
}

test('rework：把 rework 改小的 Edit → deny', () => {
  const { stdout, dirs } = editReworkShrinkResult()
  try {
    assert.equal(decisionOf(stdout)?.permissionDecision, 'deny')
  } finally {
    cleanup(dirs)
  }
})

test('rework：把 rework 改小的 Edit → deny 理由点名 S5', () => {
  const { stdout, dirs } = editReworkShrinkResult()
  try {
    assert.match(decisionOf(stdout)?.permissionDecisionReason ?? '', /S5/)
  } finally {
    cleanup(dirs)
  }
})

// 正向自检锚：上面四条已经证明这个检查项真的会 deny（它是活的，不是被 hooks.json
// 漏注册或被 gate.mjs 整段短路掉的死代码）。这一条补另一半——证明它只对
// runs/*/state.json 说话，对 run 目录下其它文件的写入保持沉默，不是靠"从不 deny
// 任何东西"这种更廉价的方式通过上面几条。
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
