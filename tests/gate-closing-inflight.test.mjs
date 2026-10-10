// 收口那一刻还有派出去、门禁没见它停下的人（docs/56，M4u；docs/35 §5「收口那一刻拦『还有派发在跑』没做」、docs/38 §2.7）：不拦——「还在跑」只能
// 按停下行认，中断的子代理永远没有停下行，拦了这一趟就收不了口（与 docs/51 §1.2 同一个理由）。原来收口成功不发任何回传，项目经理不知道还有人在跑、
// 它们之后交的东西不算进这一趟。现在写 state.json、这一趟已经收口时，账本列出这一趟派发记录里门禁没见停下的（最后一回是「拦」的也算没停）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { dispatchLine, stopLine } from '../hooks/lib/completion.mjs'

const NL = String.fromCharCode(10)
const TAG = '【派发】这一趟收口了'
const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const posted = (file) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: file } })
const AT = '2026-10-10T10:00:00.000Z'
const id = (n) => 'a' + String(n).padStart(16, '0')
const dispatched = (n, role, stage) => dispatchLine({ at: AT, agentId: id(n), toolUseId: null, role, stage, caller: 'at-pm', callerId: null, mode: 'background' })
const stopped = (n, role, stage, outcome) => stopLine({ at: AT, agentId: id(n), role, stage, outcome })

function withRun({ closed, log }, body) {
  const dirs = makeRun({ runId: 'r1', stage: 'S8', roster: ['at-backend', 'at-frontend', 'at-qa'] })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  const statePath = join(runDir, 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  writeFileSync(statePath, JSON.stringify({ ...state, closed_at: closed ? '2026-10-10T12:00:00Z' : null }))
  if (log) writeFileSync(join(runDir, 'dispatches.jsonl'), log.join(NL) + NL)
  try {
    return body({ ...dirs, runDir, statePath })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

const LOG = [
  dispatched(1, 'at-backend', 'S5'),
  dispatched(2, 'at-frontend', 'S5'),
  stopped(2, 'at-frontend', 'S5', 'pass'),
  dispatched(3, 'at-qa', 'S6'),
  stopped(3, 'at-qa', 'S6', 'block'),
  dispatched(4, 'at-nobody', 'S5'),
  dispatched(5, 'at-backend', 'S5'),
  stopped(5, 'at-backend', 'S5', 'bubble'),
]

test('收口之后写 state.json：列出门禁没见停下的派发（最后一回是「拦」的也算没停），说它们之后交的不算进这一趟；停下了的、冒泡停下的不列', () => {
  withRun({ closed: true, log: LOG }, ({ projectDir, statePath }) => {
    const c = ctxOf(run('ledger', posted(statePath), GATE, projectDir).stdout)
    assert.ok(c.includes(TAG), c)
    const block = c.slice(c.indexOf(TAG))
    assert.ok(block.includes('  - at-backend（S5）') && block.includes('  - at-qa（S6）') && block.includes('  - 一条认不出角色或段的派发'), block)
    assert.ok(!block.includes('at-frontend'), block)
    assert.equal(block.split('  - at-backend（S5）').length - 1, 1, '冒泡停下的那一个 at-backend 不列：' + block)
    assert.ok(block.includes('它们之后交的东西不计入这一趟'), block)
  })
})

test('/agent-team:at 收口第五步：同时收到【派发】列出的还没停下的人，照它告诉用户、还在跑的等它停下再汇报', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').replace(/\s+/g, '')
  assert.ok(at.includes('同时收到别的回传（例如产者交代、【派发】列出的还没停下的人）的，照它如实告诉用户——还在跑的，等它停下再汇报。'), 'commands/at.md')
})

test('还没收口、没有派发记录、都停下了——都不说', () => {
  withRun({ closed: false, log: LOG }, ({ projectDir, statePath }) => {
    assert.ok(!ctxOf(run('ledger', posted(statePath), GATE, projectDir).stdout).includes(TAG))
  })
  withRun({ closed: true, log: null }, ({ projectDir, statePath }) => {
    assert.ok(!ctxOf(run('ledger', posted(statePath), GATE, projectDir).stdout).includes(TAG))
  })
  withRun({ closed: true, log: [dispatched(2, 'at-frontend', 'S5'), stopped(2, 'at-frontend', 'S5', 'pass')] }, ({ projectDir, statePath }) => {
    assert.ok(!ctxOf(run('ledger', posted(statePath), GATE, projectDir).stdout).includes(TAG))
  })
})
