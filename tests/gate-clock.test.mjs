// 门禁的钟（docs/93）：项目经理没有钟，state.json 的 history[].at 与 closed_at 一直是估的——真实会话里七场全是，越写越往后，
// 收口时间写到了会话结束之后。门禁在项目经理写 state.json 之前总会说话的两处带上门禁此刻的时间：自检的回复（每一轮第一次写
// .agent-team 之前；桌面端每个角色交回来都会触发一轮）与【阶段】（推进、收口）；命令正文叫它照抄、不要估。门禁不核这两个时间
// （不用它们判任何事），这里只钉「给了」与「格式过得了收口标记的形状」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { gateClock, closedAt } from '../hooks/lib/closing.mjs'
import { gateCheckReason } from '../hooks/lib/gate-check.mjs'
import { buildLedgerNotices } from '../hooks/lib/ledger.mjs'

const NOW = new Date('2026-10-12T11:45:01.987Z')
const T = '2026-10-12T11:45:01Z'
const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] },
}
const base = {
  kind: 'other', contractSha: null, state: { stage: 'S1', contract_sha: 'PENDING' },
  reach: null, stages: STAGES, stageDone: true, stateProblems: [], produceName: null, produceSha: null,
}
const TIME_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/

test('gateClock：到秒的 UTC 时间、以 Z 结尾，过得了收口标记的形状', () => {
  assert.equal(gateClock(NOW), T)
  assert.equal(closedAt({ closed_at: gateClock(NOW) }), T)
  assert.match(gateClock(), new RegExp('^' + TIME_RE.source + '$'))
})

test('自检的回复带门禁此刻的时间，说 history 的 at 与 closed_at 照它写、不要估', () => {
  const r = gateCheckReason({ version: 'v24.1.0', execPath: '/n', now: NOW })
  assert.ok(r.includes(`门禁此刻的时间是 ${T}（UTC）`), r)
  assert.ok(r.includes('history 里的 at、closed_at') && r.includes('不要估'), r)
})

test('【阶段】推进：history 那一条带门禁此刻的时间，不再是占位', () => {
  const s = buildLedgerNotices({ ...base, now: NOW }).join('\n')
  assert.ok(s.includes(`往 history 追加一条 { "stage": "S2", "at": "${T}" }（at 是门禁此刻的时间，照抄，不要估）`), s)
  assert.ok(!s.includes('<ISO 时间>'), s)
})

test('【阶段】收口：closed_at 写门禁此刻的时间', () => {
  const s = buildLedgerNotices({ ...base, state: { stage: 'S2', contract_sha: 'PENDING' }, now: NOW }).join('\n')
  assert.ok(s.includes(`记 never_invoked 与 closed_at（closed_at 写门禁此刻的时间 ${T}，不要估；`), s)
})

const inWindow = (text, t0, t1) => {
  const m = TIME_RE.exec(text)
  assert.ok(m, text)
  const t = Date.parse(m[0])
  assert.ok(t >= Math.floor(t0 / 1000) * 1000 && t <= t1, `${m[0]} 不在 ${new Date(t0).toISOString()}…${new Date(t1).toISOString()}`)
}

test('门禁子进程：自检的回复与【阶段】带的是门禁跑的那一刻的时间', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S1', artifacts: ['00-contract.md'] })
  try {
    const p = dirs.projectDir
    let t0 = Date.now()
    const check = run('writepath', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(p, '.agent-team', 'gate-check'), content: 'x' } }, undefined, p)
    let t1 = Date.now()
    const reason = decisionOf(check.stdout)?.permissionDecisionReason ?? ''
    inWindow(reason.slice(reason.indexOf('门禁此刻的时间是')), t0, t1)
    const statePath = join(p, '.agent-team', 'runs', 'r1', 'state.json')
    t0 = Date.now()
    const led = run('ledger', { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath } }, GATE, p)
    t1 = Date.now()
    const ctx = led.stdout.trim() ? JSON.parse(led.stdout).hookSpecificOutput?.additionalContext ?? '' : ''
    const at = ctx.indexOf('"stage": "S2", "at": "')
    assert.ok(at >= 0, ctx)
    inWindow(ctx.slice(at), t0, t1)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('命令正文：history 的 at 与 closed_at 照门禁给的时间写，不要估', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(
    at.includes('`history` 里的 at 与 `closed_at` 写真实的时间：照这一轮门禁自检或【阶段】回传里给的门禁时间写，不要估——你没有钟，估出来的会越写越偏。'),
    '缺那一句',
  )
  assert.ok(!at.includes('"at": "<ISO 时间>"'), '还有只写占位的地方')
})
