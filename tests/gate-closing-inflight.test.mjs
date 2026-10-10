// 收口那一刻还有派出去、门禁没见它停下的人（docs/56，M4u；docs/35 §5「收口时还在跑的后台派发」、docs/38 §2.7）：不拦——「还在跑」只能按停下行认，
// 中断的子代理永远没有停下行，拦了这一趟就收不了口（与 docs/51 §1.2 同一个理由）。原来收口成功不发任何回传，项目经理不知道还有人在跑、它们之后交的
// 东西不算进这一趟。现在写 state.json、这一趟已经收口时，账本列出这一趟派发记录里门禁没见停下的（只有「拦」的停下行的也算没停；冒泡、放行算停了）。
// 复核（docs/56 §8）：不许诺完成通知会到、不说「停下之后就不再列」（收口之后门禁不再记停下行）；整段钉住；别的 run 的派发不算这一趟，停下行在别的
// run 里的照样认；只在写 state.json 时说。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function withRun({ closed, log, other = null }, body) {
  const dirs = makeRun({ runId: 'r1', stage: 'S8', roster: ['at-backend', 'at-frontend', 'at-qa'] })
  const runsDir = join(dirs.projectDir, '.agent-team', 'runs')
  const runDir = join(runsDir, 'r1')
  const statePath = join(runDir, 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  writeFileSync(statePath, JSON.stringify({ ...state, closed_at: closed ? '2026-10-10T12:00:00Z' : null }))
  if (log) writeFileSync(join(runDir, 'dispatches.jsonl'), log.join(NL) + NL)
  if (other) {
    const r0 = join(runsDir, 'r0')
    mkdirSync(r0, { recursive: true })
    writeFileSync(join(r0, 'state.json'), JSON.stringify({ ...state, run_id: 'r0', closed_at: null }))
    writeFileSync(join(r0, 'dispatches.jsonl'), other.join(NL) + NL)
  }
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

const WHOLE =
  '【派发】这一趟收口了，下面这些派发门禁没见它们在收口之前停下：\n' +
  '  - at-backend（S5）\n' +
  '  - at-qa（S6）\n' +
  '  - 一条认不出角色或段的派发\n' +
  '收口之后门禁不再核这一趟，也不再记它们停下（这份名单不会变短）：它们之后交的东西不计入这一趟，还在改的项目文件也没人核。' +
  '向用户汇报时照实说这几个——可能还在跑，也可能早已中断（会话断过、被停掉、被平台的续跑上限放过）；它们那一份没算进这一趟。'

test('收口之后写 state.json：列出门禁没见停下的派发（只有「拦」的停下行的也算没停），整段就是这样；停下了的、冒泡停下的不列', () => {
  withRun({ closed: true, log: LOG }, ({ projectDir, statePath }) => {
    const c = ctxOf(run('ledger', posted(statePath), GATE, projectDir).stdout)
    assert.ok(c.includes(TAG), c)
    assert.ok(c.includes(WHOLE), c)
    assert.ok(!c.includes('完成通知到了'), '不许诺完成通知会到：' + c)
  })
})

test('复核（docs/56 §8）：别的 run 里没停下的派发不算这一趟；停下行记在别的 run 里的照样认', () => {
  const other = [dispatched(7, 'at-frontend', 'S5'), stopped(1, 'at-backend', 'S5', 'pass')]
  withRun({ closed: true, log: [dispatched(1, 'at-backend', 'S5'), dispatched(3, 'at-qa', 'S6')], other }, ({ projectDir, statePath }) => {
    const c = ctxOf(run('ledger', posted(statePath), GATE, projectDir).stdout)
    const block = c.slice(c.indexOf(TAG))
    assert.ok(block.includes('  - at-qa（S6）'), block)
    assert.ok(!block.includes('at-frontend') && !block.includes('at-backend'), block)
  })
})

test('复核（docs/56 §8）：收口之后写别的文件（不是 state.json）不说', () => {
  withRun({ closed: true, log: LOG }, ({ projectDir, runDir }) => {
    writeFileSync(join(runDir, '00-contract.md'), '# 契约' + NL)
    const c = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c.includes(TAG), c)
  })
})

test('/agent-team:at 收口第五步：同时收到【派发】列出的门禁没见停下的人，照它如实告诉用户（不叫它等一条不一定会到的通知）', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').replace(/\s+/g, '')
  assert.ok(at.includes('同时收到别的回传（例如产者交代、【派发】列出的门禁没见停下的人）的，照它如实告诉用户。'), 'commands/at.md')
  assert.ok(!at.includes('等它停下再汇报'), 'commands/at.md')
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
