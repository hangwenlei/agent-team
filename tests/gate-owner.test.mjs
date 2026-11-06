// 一趟只归一个会话——门禁子进程那一层：
//   - 账本在建 run 的那一次记下归属（runs/<id>/owner.json，门禁专属）；
//   - H3 拦别的会话的主线程写这一趟、另建一趟、切走或指到它；H2 拦它以这一趟的名义派人；
//   - 命令展开时（session-notice）告诉项目经理这一趟归另一个会话；
//   - 批准记录器认两个接手标签，把这一趟改归这个会话。
// 纯函数那一层在 tests/owner.test.mjs。夹具照真实会话的顺序：H6（写之前 state.json 不在）→ 落盘 → 账本 → 写指针。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { BACK_LABEL, OWNER_FILE, TAKEOVER_CLOSE_LABEL, TAKEOVER_LABEL } from '../hooks/lib/owner.mjs'

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

test('别的会话用带流后缀、结尾带点的写法写 current-run，照样认成指针、拒', () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    for (const leaf of ['current-run::$DATA', 'current-run.']) {
      const out = run('writepath', preWrite(join(projectDir, '.agent-team', leaf), 'r2', 's-2'), GATE, projectDir)
      assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny', leaf)
      assert.match(reasonOf(out), /current-run/, leaf)
    }
  })
})

test('经一个指向 current-run 的文件链接写指针（叶名不是 current-run），照样认成指针、拒', (t) => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    const alias = join(projectDir, '.agent-team', 'ptr')
    try {
      symlinkSync(join(projectDir, '.agent-team', 'current-run'), alias, 'file')
    } catch (e) {
      t.skip('建不了文件链接：' + e.code)
      return
    }
    const out = run('writepath', preWrite(alias, 'r2', 's-2'), GATE, projectDir)
    assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny')
    assert.match(reasonOf(out), /current-run/)
  })
})

// 两趟：r0 归 s-2（指针指着它），r1 归 s-1、没收口。
function twoRuns(projectDir) {
  createRun(projectDir, 'r1', { sid: 's-1' })
  const r0 = join(projectDir, '.agent-team', 'runs', 'r0')
  mkdirSync(r0, { recursive: true })
  writeFileSync(join(r0, 'state.json'), JSON.stringify(stateOf('r0'), null, 2))
  writeFileSync(ownerPath(r0), JSON.stringify({ session_id: 's-2', at: 't', via: 'create', previous: null }))
  point(projectDir, 'r0')
}
const editPointer = (projectDir, old_string, new_string, sid) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  agent_type: PM,
  session_id: sid,
  tool_input: { file_path: join(projectDir, '.agent-team', 'current-run'), old_string, new_string },
})

test('别的会话用 Edit 把 current-run 从自己那一趟改指到别的会话的一趟，拒', () => {
  world(({ projectDir }) => {
    twoRuns(projectDir)
    const out = run('writepath', editPointer(projectDir, 'r0', 'r1', 's-2'), GATE, projectDir)
    assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny')
    assert.match(reasonOf(out), /"r1"/)
  })
})

test('用 Edit 改 current-run、算不出改完是什么，而有一趟别的会话的 run 开着，拒', () => {
  world(({ projectDir }) => {
    twoRuns(projectDir)
    const out = run('writepath', editPointer(projectDir, '不在文件里', 'r1', 's-2'), GATE, projectDir)
    assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny')
  })
})

test('经一个名字不合 run id 格式的链接写进那一趟：照样认成那一趟、按会话拒', (t) => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    const alias = join(projectDir, '.agent-team', 'runs', 'al@ias')
    try {
      symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (e) {
      t.skip('建不了链接：' + e.code)
      return
    }
    const out = writeBy(projectDir, join(alias, '00-contract.md'), 's-2')
    assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny')
    assert.match(reasonOf(out), OWNED)
  })
})

test('run 目录名写成 Windows 会去掉的样子（结尾带空格）：照样认成那一趟、拒', { skip: process.platform !== 'win32' }, () => {
  world(({ projectDir }) => {
    createRun(projectDir, 'r1', { sid: 's-1' })
    const out = writeBy(projectDir, join(projectDir, '.agent-team', 'runs', 'r1 ', '00-contract.md'), 's-2')
    assert.equal(decisionOf(out.stdout)?.permissionDecision, 'deny')
  })
})

test('hook 输入没有 session_id：不按会话拦', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    assert.doesNotMatch(reasonOf(writeBy(projectDir, join(dir, '00-contract.md'), null)), OWNED)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 命令展开时（session-notice，UserPromptExpansion）告诉项目经理这一趟归另一个会话。
const ARGS = '做一个记账应用：能记收入和支出'
const expand = (command, sid, args = '列表页加一个导出按钮') => ({
  hook_event_name: 'UserPromptExpansion',
  expansion_type: 'slash_command',
  command_name: 'agent-team:' + command,
  command_args: args,
  command_source: 'plugin',
  prompt: '/agent-team:' + command + ' ' + args,
  session_id: sid,
})
const noticeOf = (out) => (out.stdout.trim() ? JSON.parse(out.stdout).hookSpecificOutput?.additionalContext ?? '' : '')

// s-1 发了 /agent-team:at（原话记下、建 run 时绑上），建 r1。
function ownedRun(projectDir) {
  run('user-words', expand('at', 's-1', ARGS), GATE, projectDir)
  return createRun(projectDir, 'r1', { sid: 's-1' }).dir
}

test('别的会话展开 /agent-team:at：回传【会话】，带 run id、起的时间、原话开头，指向第 1 节「别的会话的一趟」', () => {
  world(({ projectDir }) => {
    ownedRun(projectDir)
    const out = run('session-notice', expand('at', 's-2'), GATE, projectDir)
    assert.equal(out.status, 0, out.stderr)
    const n = noticeOf(out)
    assert.match(n, /【会话】/)
    assert.match(n, /"r1"/)
    assert.match(n, /"2026-11-05T10:00:00Z"/)
    assert.match(n, /"做一个记账应用：能记收入和支出"/)
    assert.match(n, /\/agent-team:at 第 1 节「别的会话的一趟」/)
    assert.doesNotMatch(n, /只差收口/)
  })
})

test('那一趟停在最后一段、交付文档写了：回传里说只差收口', () => {
  world(({ projectDir }) => {
    const dir = ownedRun(projectDir)
    const ids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
    writeFileSync(join(dir, 'state.json'), JSON.stringify(stateOf('r1', 'S8', H(...ids)), null, 2))
    writeFileSync(join(dir, '08-delivery.md'), '# 交付' + String.fromCharCode(10) + '做完了' + String.fromCharCode(10))
    assert.match(noticeOf(run('session-notice', expand('at', 's-2'), GATE, projectDir)), /只差收口/)
  })
})

test('展开 /agent-team:at-resume：指向 at-resume 第 1 节；展开 /agent-team:at-status：只陈述归属', () => {
  world(({ projectDir }) => {
    ownedRun(projectDir)
    assert.match(noticeOf(run('session-notice', expand('at-resume', 's-2', ''), GATE, projectDir)), /\/agent-team:at-resume 第 1 节「别的会话的一趟」/)
    const st = noticeOf(run('session-notice', expand('at-status', 's-2', ''), GATE, projectDir))
    assert.match(st, /归另一个会话/)
    assert.doesNotMatch(st, /问用户/)
  })
})

test('建它的会话展开、没有 owner.json、已收口、没有 current-run、别的命令：stdout 为空', () => {
  world(({ projectDir }) => {
    assert.equal(run('session-notice', expand('at', 's-2'), GATE, projectDir).stdout, '', '没有 current-run')
    const dir = ownedRun(projectDir)
    assert.equal(run('session-notice', expand('at', 's-1'), GATE, projectDir).stdout, '', '建它的会话')
    assert.equal(run('session-notice', expand('at-init', 's-2'), GATE, projectDir).stdout, '', '别的命令')
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...stateOf('r1'), closed_at: '2026-11-05T12:00:00Z' }, null, 2))
    assert.equal(run('session-notice', expand('at', 's-2'), GATE, projectDir).stdout, '', '已收口')
  })
  const dirs = makeRun({ runId: 'r1', stage: 'S1' })
  try {
    assert.equal(run('session-notice', expand('at', 's-2'), GATE, dirs.projectDir).stdout, '', '没有 owner.json 的旧 run')
  } finally {
    cleanup(dirs)
  }
})

test('session-notice 永不 exit 2（坏掉的 owner.json、读不出的 state.json、读不出的输入）', () => {
  world(({ projectDir }) => {
    const dir = ownedRun(projectDir)
    writeFileSync(ownerPath(dir), '{')
    assert.equal(run('session-notice', expand('at', 's-2'), GATE, projectDir).status, 0)
    writeFileSync(ownerPath(dir), JSON.stringify({ session_id: 's-1', at: 't', via: 'create' }))
    writeFileSync(join(dir, 'state.json'), '{')
    assert.equal(run('session-notice', expand('at', 's-2'), GATE, projectDir).status, 0)
    assert.equal(run('session-notice', 'not json', GATE, projectDir).status, 0)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 接手：批准记录器认两个接手标签，把 current-run 指着的那一趟改归这个会话。
const askTakeover = (answer, sid, { multiSelect = false, notes = null } = {}) => {
  const questions = [{ question: '原来那个会话还在吗？', header: '接手', multiSelect, options: [{ label: BACK_LABEL, description: '' }, { label: TAKEOVER_LABEL, description: '' }] }]
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    agent_type: PM,
    session_id: sid,
    tool_input: { questions },
    tool_response: {
      questions,
      answers: { [questions[0].question]: answer },
      ...(notes === null ? {} : { annotations: { [questions[0].question]: { notes } } }),
    },
  }
}

test('s-2 选「在这个会话接手」：owner.json 改成 s-2、via takeover、previous s-1；回传含「已记下」', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    const out = run('approval-ask', askTakeover(TAKEOVER_LABEL, 's-2'), GATE, projectDir)
    const o = ownerOf(dir)
    assert.equal(o.session_id, 's-2')
    assert.equal(o.via, 'takeover')
    assert.equal(o.previous, 's-1')
    const ctx = JSON.parse(out.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /已记下/)
    assert.match(JSON.parse(out.stdout).systemMessage, /改归这个会话/)
  })
})

test('选「接手并收口，再开始这次」同样记', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    run('approval-ask', askTakeover(TAKEOVER_CLOSE_LABEL, 's-2'), GATE, projectDir)
    assert.equal(ownerOf(dir).session_id, 's-2')
  })
})

test('接手之后 s-1 写 state.json，H3 拒，理由含「被另一个会话接手」；s-2 写放行', () => {
  world(({ projectDir }) => {
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    run('approval-ask', askTakeover(TAKEOVER_LABEL, 's-2'), GATE, projectDir)
    const s1 = writeBy(projectDir, join(dir, '00-contract.md'), 's-1')
    assert.equal(decisionOf(s1.stdout)?.permissionDecision, 'deny')
    assert.match(reasonOf(s1), /被另一个会话接手/)
    assert.equal(decisionOf(writeBy(projectDir, join(dir, '00-contract.md'), 's-2').stdout), null)
  })
})

test('已经归这个会话、已收口、没有 current-run、多选题、带备注：不记，回传说为什么', () => {
  world(({ projectDir }) => {
    const noRun = run('approval-ask', askTakeover(TAKEOVER_LABEL, 's-2'), GATE, projectDir)
    assert.match(JSON.parse(noRun.stdout).hookSpecificOutput.additionalContext, /没有记成接手/)
    const { dir } = createRun(projectDir, 'r1', { sid: 's-1' })
    const mine = run('approval-ask', askTakeover(TAKEOVER_LABEL, 's-1'), GATE, projectDir)
    assert.match(JSON.parse(mine.stdout).hookSpecificOutput.additionalContext, /本来就归这个会话/)
    for (const opts of [{ multiSelect: true }, { notes: '先别动' }]) {
      const out = run('approval-ask', askTakeover(TAKEOVER_LABEL, 's-2', opts), GATE, projectDir)
      assert.match(JSON.parse(out.stdout).hookSpecificOutput.additionalContext, /没有记成接手/, JSON.stringify(opts))
      assert.equal(ownerOf(dir).session_id, 's-1', JSON.stringify(opts))
    }
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...stateOf('r1'), closed_at: '2026-11-05T12:00:00Z' }, null, 2))
    const closed = run('approval-ask', askTakeover(TAKEOVER_LABEL, 's-2'), GATE, projectDir)
    assert.match(JSON.parse(closed.stdout).hookSpecificOutput.additionalContext, /已经收口/)
    assert.equal(ownerOf(dir).session_id, 's-1')
  })
})

test('没有 owner.json 的旧 run：选了接手就补上归属（via takeover，previous 为 null）', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S2' })
  try {
    run('approval-ask', askTakeover(TAKEOVER_LABEL, 's-2'), GATE, dirs.projectDir)
    const o = ownerOf(join(dirs.projectDir, '.agent-team', 'runs', 'r1'))
    assert.equal(o.session_id, 's-2')
    assert.equal(o.via, 'takeover')
    assert.equal(o.previous, null)
  } finally {
    cleanup(dirs)
  }
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
