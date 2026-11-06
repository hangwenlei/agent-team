// 一趟只归一个会话——门禁子进程那一层：
//   - 账本在建 run 的那一次记下归属（runs/<id>/owner.json，门禁专属）；
//   - H3 拦别的会话的主线程写这一趟、另建一趟、切走或指到它；H2 拦它以这一趟的名义派人；
//   - 命令展开时（session-notice）告诉项目经理这一趟归另一个会话；
//   - 批准记录器认两个接手标签，把这一趟改归这个会话。
// 纯函数那一层在 tests/owner.test.mjs。夹具照真实会话的顺序：H6（写之前 state.json 不在）→ 落盘 → 账本 → 写指针。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { OWNER_FILE } from '../hooks/lib/owner.mjs'

const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-11-05T10:00:00Z' }))
const stateOf = (id, stage = 'S1', history = H('S1')) => ({
  run_id: id,
  stage,
  contract_sha: 'PENDING',
  roster: [],
  stage_roles: {},
  artifacts: {},
  rework: {},
  never_invoked: [],
  escalations: [],
  history,
})
const PM = 'agent-team:at-pm'
const preWrite = (file, content, sid = 's-1', over = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: PM,
  ...(sid === null ? {} : { session_id: sid }),
  tool_input: { file_path: file, content },
  ...over,
})
const posted = (file, sid = 's-1', over = {}) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Write',
  agent_type: PM,
  ...(sid === null ? {} : { session_id: sid }),
  tool_input: { file_path: file },
  ...over,
})
const ownerPath = (runDir) => join(runDir, OWNER_FILE)
const ownerOf = (runDir) => JSON.parse(readFileSync(ownerPath(runDir), 'utf8'))
const point = (projectDir, id) => writeFileSync(join(projectDir, '.agent-team', 'current-run'), id)

function cleanup(dirs) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
}

// 一个跑过 at-init、还没有 run 的项目。
function world(body) {
  const dirs = makeRun({ runId: 'r0', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r0'), { recursive: true, force: true })
    rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
    return body(dirs)
  } finally {
    cleanup(dirs)
  }
}

// 照项目经理的做法建一趟：H6 放行 → 落盘 → 账本 → 写指针。
function createRun(projectDir, id, { sid = 's-1', pointTo = true } = {}) {
  const dir = join(projectDir, '.agent-team', 'runs', id)
  const content = JSON.stringify(stateOf(id), null, 2)
  const d = decisionOf(run('rework', preWrite(join(dir, 'state.json'), content, sid), GATE, projectDir).stdout)
  assert.equal(d, null, '建 run 的那一次 H6 放行：' + JSON.stringify(d))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), content)
  const led = run('ledger', posted(join(dir, 'state.json'), sid), GATE, projectDir)
  if (pointTo) point(projectDir, id)
  return { dir, led }
}

test('建 run 的那一次（H6 → 落盘 → 账本）记下归属：owner.json 的 session_id 是建它的会话、via 是 create', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    const o = ownerOf(dir)
    assert.equal(o.session_id, 's-1')
    assert.equal(o.via, 'create')
    assert.equal(o.previous, null)
    assert.match(o.at, /^\d{4}-\d{2}-\d{2}T/)
    // 同一个会话之后再写 state.json：归属不变。
    run('ledger', posted(join(dir, 'state.json'), 's-1'), GATE, projectDir)
    assert.equal(ownerOf(dir).session_id, 's-1')
  })
})

test('已有门禁专属文件的 run（升级之前就在跑的）被写 state.json，不补归属', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S5' })
  try {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    writeFileSync(join(runDir, 'dispatches.jsonl'), '')
    run('ledger', posted(join(runDir, 'state.json'), 's-2'), GATE, dirs.projectDir)
    assert.equal(existsSync(ownerPath(runDir)), false)
  } finally {
    cleanup(dirs)
  }
})

test('用 Bash 建的 run（门禁没见到建的那一次）：项目经理写的不是 state.json 时不记归属', () => {
  world(({ projectDir }) => {
    const dir = join(projectDir, '.agent-team', 'runs', 'r1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify(stateOf('r1'), null, 2))
    point(projectDir, 'r1')
    writeFileSync(join(dir, '00-contract.md'), '# 00 契约\n')
    run('ledger', posted(join(dir, '00-contract.md'), 's-1'), GATE, projectDir)
    assert.equal(existsSync(ownerPath(dir)), false)
  })
})

test('账本输入里没有 session_id：不记归属，stderr 留一行痕', () => {
  world(({ projectDir }) => {
    const { dir, led } = createRun(projectDir, 'r1', { sid: null })
    assert.equal(existsSync(ownerPath(dir)), false)
    assert.match(led.stderr, /会话 id/)
  })
})

test('子代理（带 agent_id）写 state.json 不记归属', () => {
  world(({ projectDir }) => {
    const dir = join(projectDir, '.agent-team', 'runs', 'r1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify(stateOf('r1'), null, 2))
    run('ledger', posted(join(dir, 'state.json'), 's-1', { agent_id: 'a0123456789abcdef' }), GATE, projectDir)
    assert.equal(existsSync(ownerPath(dir)), false)
  })
})

test('owner.json 任何人用 Edit/Write 都拒，项目经理也拒', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    for (const agent_type of [PM, 'agent-team:at-backend', undefined]) {
      const input = preWrite(ownerPath(dir), '{"session_id":"s-9","via":"create"}', 's-1', { agent_type })
      if (agent_type === undefined) delete input.agent_type
      const d = decisionOf(run('writepath', input, GATE, projectDir).stdout)
      assert.equal(d?.permissionDecision, 'deny', String(agent_type))
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// H3：别的会话的主线程写这一趟、另建一趟、切走或指到它。
const reasonOf = (out) => decisionOf(out.stdout)?.permissionDecisionReason ?? ''
const writeBy = (projectDir, file, sid, over = {}) => {
  const input = preWrite(file, '# x' + String.fromCharCode(10), sid, over)
  if ('agent_type' in over && over.agent_type === undefined) delete input.agent_type
  return run('writepath', input, GATE, projectDir)
}
const OWNED = /会话归属/

test('别的会话写这一趟的 state.json、契约、04-dispatch.md，H3 拒（项目经理与不带 agent_type 的主会话都拒）', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    for (const f of ['state.json', '00-contract.md', '04-dispatch.md']) {
      for (const over of [{}, { agent_type: undefined }]) {
        const out = writeBy(projectDir, join(dir, f), 's-2', over)
        assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny', f)
        assert.match(reasonOf(out), /归另一个会话/, f)
        assert.match(reasonOf(out), /\/agent-team:at-resume/, f)
        assert.match(reasonOf(out), /别的会话的一趟/, f)
      }
    }
  })
})

test('建这一趟的会话照常写', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    assert.equal(decisionOf(writeBy(projectDir, join(dir, '00-contract.md'), 's-1').stdout), null)
  })
})

test('已收口的一趟不按会话拦', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...stateOf('r1'), closed_at: '2026-11-05T12:00:00Z' }, null, 2))
    assert.doesNotMatch(reasonOf(writeBy(projectDir, join(dir, '04-dispatch.md'), 's-2')), OWNED)
  })
})

test('没有 owner.json 的旧 run 不按会话拦', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    const dir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    assert.equal(decisionOf(writeBy(dirs.projectDir, join(dir, '00-contract.md'), 's-2').stdout), null)
  } finally {
    cleanup(dirs)
  }
})

test('owner.json 坏了：不按会话拦，stderr 留痕', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    writeFileSync(ownerPath(dir), '{')
    const out = writeBy(projectDir, join(dir, '00-contract.md'), 's-2')
    assert.doesNotMatch(reasonOf(out), OWNED)
    assert.match(out.stderr, /归属记录/)
  })
})

test('别的会话另建一趟（写 runs/r2/state.json，写之前不在），拒，理由含「不能另建一趟」；主人自己另建放行', () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    const r2 = join(projectDir, '.agent-team', 'runs', 'r2', 'state.json')
    const out = run('writepath', preWrite(r2, JSON.stringify(stateOf('r2')), 's-2'), GATE, projectDir)
    assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny')
    assert.match(reasonOf(out), /不能另建一趟/)
    assert.doesNotMatch(reasonOf(run('writepath', preWrite(r2, JSON.stringify(stateOf('r2')), 's-1'), GATE, projectDir)), OWNED)
  })
})

test('别的会话写 current-run（切到 r2、或原样写 r1），拒；主人放行', () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    const ptr = join(projectDir, '.agent-team', 'current-run')
    for (const content of ['r2', 'r1']) {
      const out = run('writepath', preWrite(ptr, content, 's-2'), GATE, projectDir)
      assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny', content)
      assert.match(reasonOf(out), /current-run/, content)
    }
    assert.doesNotMatch(reasonOf(run('writepath', preWrite(ptr, 'r2', 's-1'), GATE, projectDir)), OWNED)
  })
})

test('current-run 里写的 id 与目录名大小写不同（非 Linux）：照样认成那一趟、拒另建', { skip: process.platform === 'linux' }, () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    point(projectDir, 'R1')
    const r2 = join(projectDir, '.agent-team', 'runs', 'r2', 'state.json')
    assert.match(reasonOf(run('writepath', preWrite(r2, JSON.stringify(stateOf('r2')), 's-2'), GATE, projectDir)), /不能另建一趟/)
  })
})

test('hook 输入没有 session_id：不按会话拦', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    assert.doesNotMatch(reasonOf(writeBy(projectDir, join(dir, '00-contract.md'), null)), OWNED)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// H2：别的会话的主线程以这一趟的名义派人。
const dispatchBy = (projectDir, sid, over = {}) =>
  run(
    'readiness',
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      agent_type: PM,
      session_id: sid,
      tool_input: { subagent_type: 'agent-team:at-product', description: 'x', prompt: 'x' },
      ...over,
    },
    GATE,
    projectDir,
  )

test('别的会话的主线程派 at-product，H2 拒，理由含「派人」「归另一个会话」', () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    const out = dispatchBy(projectDir, 's-2')
    assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny')
    assert.match(reasonOf(out), /派人/)
    assert.match(reasonOf(out), /归另一个会话/)
  })
})

test('建这一趟的会话派人，不出这条理由', () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    assert.doesNotMatch(reasonOf(dispatchBy(projectDir, 's-1')), OWNED)
  })
})

test('带 agent_id 的协调者往下派，不走这一道', () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    const out = dispatchBy(projectDir, 's-2', {
      agent_type: 'agent-team:at-product',
      agent_id: 'a0123456789abcdef',
      tool_input: { subagent_type: 'agent-team:at-ui', description: 'x', prompt: 'x' },
    })
    assert.doesNotMatch(reasonOf(out), OWNED)
  })
})

test('带 agent_id 的子代理写 run 目录：不走这一道（照原来的写路径隔离判）', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    const out = writeBy(projectDir, join(dir, '01-prd.md'), 's-2', { agent_type: 'agent-team:at-product', agent_id: 'a0123456789abcdef' })
    assert.doesNotMatch(reasonOf(out), OWNED)
  })
})
