// 需求稿（docs/95）的门禁子进程这一层：/agent-team:at 建 run 之前问清需求、用户在 AskUserQuestion 里选了「照这份需求开始」——批准记录器
// （approval-ask，PostToolUse）把那道题的题面记成这一次的原话（项目一级的 user-words.json，source: 'ask'，整份换掉命令那一次记下的），回传【需求稿】、
// 给用户一行；之后建 run 那一次（H6 + 账本）照常绑进 run 目录，契约第 1 节对着需求稿核，对不上的说法按来源说。像批准却不记的几种不动记录、回传原因；
// 门禁这一侧记不下的叫用户把需求稿贴在命令后面重发。批准之前就建好的那一趟不认它。纯函数那一层在 tests/brief.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { reworkFromHistory } from '../hooks/lib/state.mjs'
import { BRIEF_LABEL, USER_WORDS_FILE } from '../hooks/lib/user-words.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const NL = String.fromCharCode(10)
const ROUGH = '给待办加个截止日期'
const DRAFT = ['要做什么、为什么：给待办加一个截止日期，过期的标红', '给谁用：自己', '做完的样子：', '1. 新建待办时能选截止日期', '2. 过期的待办标红', '不做：提醒推送', '约束：不加依赖'].join(NL)
const TALK_ASK = '对不上用户批准的需求稿'
const TALK_CMD = '对不上用户在 /agent-team:at 后面写的原话'
const H = (...ids) => ids.map((stage) => ({ stage, at: '2026-10-14T10:00:00Z' }))
const outOf = (stdout) => (stdout.trim() ? JSON.parse(stdout) : {})
const ctxOf = (stdout) => outOf(stdout).hookSpecificOutput?.additionalContext ?? ''
const contract = (section1) =>
  ['# 00 契约 —— 这趟 run 的需求基线', '', '## 1. 用户原话', '', ...section1.split(NL), '', '## 2. PM 的理解（可改）', '', '- 网页版。', '', '## 4. 修订记录', ''].join(NL)

const expansion = (args, sid = 's-1') => ({
  hook_event_name: 'UserPromptExpansion',
  expansion_type: 'slash_command',
  command_name: 'agent-team:at',
  command_args: args,
  command_source: 'plugin',
  prompt: '/agent-team:at ' + args,
  session_id: sid,
})
// 项目经理问「要不要照它开始」：一道单选题，题面就是需求稿。
const asked = (answer, { question = DRAFT, sid = 's-1', extra = {}, notes = null, multiSelect = false } = {}) => {
  const questions = [{ question, header: '需求定稿', multiSelect, options: [{ label: BRIEF_LABEL, description: '' }, { label: '再改改', description: '' }] }]
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    agent_type: 'agent-team:at-pm',
    ...(sid === null ? {} : { session_id: sid }),
    tool_input: { questions },
    tool_response: { questions, answers: { [question]: answer }, ...(notes === null ? {} : { annotations: { [question]: { notes } } }), ...extra },
  }
}
const posted = (file, sid = 's-1') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', session_id: sid, tool_input: { file_path: file } })
const pendingPath = (projectDir) => join(projectDir, '.agent-team', USER_WORDS_FILE)
const pendingOf = (projectDir) => JSON.parse(readFileSync(pendingPath(projectDir), 'utf8'))
const stateOf = (id, stage = 'S1', history = H('S1')) => ({ run_id: id, stage, contract_sha: 'PENDING', roster: [], stage_roles: {}, artifacts: {}, rework: {}, never_invoked: [], escalations: [], history })
const stateWrite = (runDir, state, sid = 's-1') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: 'agent-team:at-pm',
  session_id: sid,
  tool_input: { file_path: join(runDir, 'state.json'), content: JSON.stringify(state, null, 2) },
})

function cleanup(dirs) {
  rmSync(dirs.projectDir, { recursive: true, force: true })
  rmSync(dirs.pluginDir, { recursive: true, force: true })
}

// 照真实顺序建一趟新 run：H6（写之前文件不在）、落盘、账本（绑的第二步）、写指针。
function createRun(projectDir, id, sid = 's-1') {
  const dir = join(projectDir, '.agent-team', 'runs', id)
  const state = stateOf(id)
  const d = decisionOf(run('rework', stateWrite(dir, state, sid), GATE, projectDir).stdout)
  assert.equal(d, null, '建 run 的那一次 H6 放行：' + JSON.stringify(d))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2))
  run('ledger', posted(join(dir, 'state.json'), sid), GATE, projectDir)
  writeFileSync(join(projectDir, '.agent-team', 'current-run'), id)
  return dir
}

function advance(runDir, to, sid = 's-1') {
  const now = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'))
  const ids = ['S1', 'S2', 'S3']
  const next = H(...ids.slice(0, ids.indexOf(to) + 1))
  const c = join(runDir, '00-contract.md')
  const contract_sha = existsSync(c) ? sha256OfContract(readFileSync(c)) : now.contract_sha
  return stateWrite(runDir, { ...now, stage: to, history: next, rework: reworkFromHistory(next), contract_sha }, sid)
}

// 项目里有 .agent-team、还没有 run（r0 删掉）。
function project(body) {
  const dirs = makeRun({ runId: 'r0', stage: 'S1' })
  try {
    rmSync(join(dirs.projectDir, '.agent-team', 'runs', 'r0'), { recursive: true, force: true })
    rmSync(join(dirs.projectDir, '.agent-team', 'current-run'), { force: true })
    return body(dirs)
  } finally {
    cleanup(dirs)
  }
}

test('批准：选了「照这份需求开始」——题面记成这一次的原话（来源 ask），整份换掉命令那一次记下的；回传【需求稿】、给用户一行', () => {
  project(({ projectDir }) => {
    run('user-words', expansion(ROUGH), GATE, projectDir)
    assert.equal(pendingOf(projectDir).source, 'command')
    const r = run('approval-ask', asked(BRIEF_LABEL), GATE, projectDir)
    assert.equal(r.status, 0, r.stderr)
    const p = pendingOf(projectDir)
    assert.equal(p.args, DRAFT)
    assert.equal(p.source, 'ask')
    assert.equal(p.session_id, 's-1')
    assert.deepEqual(p.runs_before, [])
    assert.equal(p.binding, null)
    assert.equal(p.bound, null)
    assert.equal(p.dropped, null)
    const out = outOf(r.stdout)
    const c = out.hookSpecificOutput?.additionalContext ?? ''
    assert.ok(c.includes('【需求稿】门禁记下了用户批准的这份需求稿') && c.includes('契约第 1 节逐字照抄它'), c)
    assert.ok(!c.includes(DRAFT.split(NL)[0]), '回传不复述需求稿：' + c)
    assert.equal(out.systemMessage, 'agent-team 需求稿：已记下你批准的这份需求稿，契约第 1 节照它核，项目经理已收到。')
  })
})

test('批准之后建 run：需求稿绑进 run 目录；第 1 节照抄需求稿不说、推进出第一段放行；照抄命令带的原话按需求稿说对不上、推进被拒', () => {
  project(({ projectDir }) => {
    run('user-words', expansion(ROUGH), GATE, projectDir)
    run('approval-ask', asked(BRIEF_LABEL), GATE, projectDir)
    const runDir = createRun(projectDir, 'r1')
    const bound = JSON.parse(readFileSync(join(runDir, USER_WORDS_FILE), 'utf8'))
    assert.equal(bound.args, DRAFT)
    assert.equal(bound.source, 'ask')
    assert.equal(bound.bound, 'r1')

    writeFileSync(join(runDir, '00-contract.md'), contract(ROUGH))
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes('【契约】') && c.includes(TALK_ASK) && c.includes(`「${BRIEF_LABEL}」`), c)
    assert.ok(!c.includes(TALK_CMD), '来源是需求稿，不说命令后面写的原话：' + c)
    const d = decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes(TALK_ASK), d.permissionDecisionReason)

    writeFileSync(join(runDir, '00-contract.md'), contract(DRAFT.split(NL).map((l) => '> ' + l).join(NL)))
    const ok = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!ok.includes(TALK_ASK), '照抄（引用块）不说：' + ok)
    assert.equal(decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout), null)
  })
})

test('命令没带参数：清掉之后问清需求、批准——照样记下、照样核（不带参数的那一趟也核第 1 节了）', () => {
  project(({ projectDir }) => {
    run('user-words', expansion(ROUGH), GATE, projectDir)
    run('user-words', expansion(''), GATE, projectDir)
    assert.equal(existsSync(pendingPath(projectDir)), false, '不带参数的那一次清掉了这个会话挂着的那份')
    run('approval-ask', asked(BRIEF_LABEL), GATE, projectDir)
    const runDir = createRun(projectDir, 'r1')
    writeFileSync(join(runDir, '00-contract.md'), contract('做一个截止日期'))
    assert.equal(decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout)?.permissionDecision, 'deny')
  })
})

test('不记：选了「再改改」不出声、记录不动；带备注、离开键盘、另写了话、多选、标签夹了别的话——记录不动，回传原因、叫它改好再问，给用户一行', () => {
  project(({ projectDir }) => {
    run('user-words', expansion(ROUGH), GATE, projectDir)
    const before = readFileSync(pendingPath(projectDir), 'utf8')
    const quiet = run('approval-ask', asked('再改改'), GATE, projectDir)
    assert.equal(quiet.status, 0, quiet.stderr)
    assert.equal(quiet.stdout, '')
    assert.equal(readFileSync(pendingPath(projectDir), 'utf8'), before)
    for (const [input, why] of [
      [asked(BRIEF_LABEL, { notes: '第 2 条去掉' }), '用户在选项旁写了备注'],
      [asked(BRIEF_LABEL, { extra: { afkTimeoutMs: 60000 } }), '用户离开了键盘'],
      [asked(BRIEF_LABEL, { extra: { response: '等一下' } }), '用户另写了一段话'],
      [asked(BRIEF_LABEL, { multiSelect: true }), '那道题是多选'],
      [asked(BRIEF_LABEL + '，但是第 2 条去掉'), '标签夹了别的话'],
    ]) {
      const r = run('approval-ask', input, GATE, projectDir)
      assert.equal(r.status, 0, r.stderr)
      assert.equal(readFileSync(pendingPath(projectDir), 'utf8'), before, why)
      const out = outOf(r.stdout)
      const c = out.hookSpecificOutput?.additionalContext ?? ''
      assert.ok(c.includes('【需求稿】用户这次的回答没有记成批准') && c.includes(why) && c.includes('在那之前不要建 run'), c)
      assert.equal(out.systemMessage, 'agent-team 需求稿：这次的回答没有记成批准，项目经理已收到原因。')
    }
  })
})

test('不记（门禁这一侧）：项目里没有 .agent-team 不建它；读不到会话 id——叫用户把需求稿贴在命令后面重发', () => {
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'at-brief-')))
  try {
    const r = run('approval-ask', asked(BRIEF_LABEL), GATE, bare)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(existsSync(join(bare, '.agent-team')), false)
    const c = ctxOf(r.stdout)
    assert.ok(c.includes('【需求稿】门禁没有记下') && c.includes('/agent-team:at 后面重发'), c)
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }
  project(({ projectDir }) => {
    const r = run('approval-ask', asked(BRIEF_LABEL, { sid: null }), GATE, projectDir)
    assert.equal(existsSync(pendingPath(projectDir)), false)
    assert.ok(ctxOf(r.stdout).includes('读不到这个会话的 id'), r.stdout)
  })
})

test('批准之前就建好的那一趟不认需求稿：项目经理写它的 state.json，需求稿那份作废；那一趟照旧对命令带的原话核', () => {
  project(({ projectDir }) => {
    run('user-words', expansion(ROUGH), GATE, projectDir)
    const runDir = createRun(projectDir, 'r1')
    run('approval-ask', asked(BRIEF_LABEL), GATE, projectDir)
    assert.deepEqual(pendingOf(projectDir).runs_before, ['r1'])
    run('ledger', posted(join(runDir, 'state.json')), GATE, projectDir)
    assert.equal(pendingOf(projectDir).dropped, 'r1')
    writeFileSync(join(runDir, '00-contract.md'), contract(DRAFT))
    const d = decisionOf(run('rework', advance(runDir, 'S2'), GATE, projectDir).stdout)
    assert.equal(d?.permissionDecision, 'deny', JSON.stringify(d))
    assert.ok(d.permissionDecisionReason.includes(TALK_CMD), d.permissionDecisionReason)
  })
})
