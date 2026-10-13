// 门禁的钟（docs/93）：项目经理没有钟，state.json 的 history[].at 与 closed_at 一直是估的——真实会话里七场全是，越写越往后，
// 收口时间写到了会话结束之后。门禁在项目经理写 state.json 之前总会说话的两处带上门禁此刻的时间：自检的回复（每一轮第一次写
// .agent-team 之前；桌面端每个角色交回来都会触发一轮）与【阶段】（推进、收口）；命令正文叫它照抄、不要估。门禁不核这两个时间
// （不用它们判任何事），这里只钉「给了」与「格式过得了收口标记的形状」。
// docs/94：两场真实会话里项目经理收口那一次都把 history 里挨着的 S8 那一条已有的时间换成了收口时间、再自己改回去（整份重写 state.json 时把手头这件事
// 的时间带进了挨着的那一条）。几处说法都写明只有这次新写的那个时间照最新的写，已经写下的原样带着；门禁不核这些时间（它们不进任何判据，只是记录）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { gateClock, closedAt, decideClosing } from '../hooks/lib/closing.mjs'
import { validateState } from '../hooks/lib/state.mjs'
import { decideRework } from '../hooks/lib/rework-guard.mjs'
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

test('自检的回复带门禁此刻的时间，说 state.json 里的时间照最近一次门禁给的写、不要估', () => {
  const r = gateCheckReason({ version: 'v24.1.0', execPath: '/n', now: NOW })
  assert.ok(r.includes(`门禁此刻的时间是 ${T}（UTC）：state.json 里这次新写的时间（history 新追加的那一条、escalations 新记的那一条的 at，closed_at）照最近一次门禁回传给的时间写，不要估；已经写下的时间原样带着。`), r)
})

// 复核（低 5）：钟是 UTC，不跟着机器的时区走——CI 的 runner 默认就是 UTC，换一个时区才打得红用本地时间的写法。Node 运行中改 TZ 当场生效。
test('gateClock：换了时区照样是 UTC', () => {
  const was = process.env.TZ
  try {
    for (const tz of ['Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = tz
      assert.equal(new Date(2026, 0, 1).getTimezoneOffset() !== 0, true, tz)
      assert.equal(gateClock(NOW), T, tz)
    }
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
})

test('【阶段】推进：history 那一条带门禁此刻的时间，不再是占位', () => {
  const s = buildLedgerNotices({ ...base, now: NOW }).join('\n')
  assert.ok(s.includes(`往 history 追加一条 { "stage": "S2", "at": "${T}" }（at 是门禁此刻的时间，照抄，不要估；已有的 history 与 escalations 条目原样带着）`), s)
  assert.ok(!s.includes('<ISO 时间>'), s)
})

test('【阶段】收口：closed_at 写门禁此刻的时间', () => {
  const s = buildLedgerNotices({ ...base, state: { stage: 'S2', contract_sha: 'PENDING' }, now: NOW }).join('\n')
  assert.ok(s.includes(`记 never_invoked 与 closed_at（closed_at 写门禁此刻的时间 ${T}，不要估；history 原样带着，连时间也不改；`), s)
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

test('命令正文：state.json 里的时间与冻结时间照最近一次门禁给的写，不要估；等过之后先再取一次', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(
    at.includes(
      '`state.json` 里这次新写的时间（`history` 新追加的那一条、`escalations` 新记的那一条的 at、`closed_at`）和契约的冻结时间写真实的时间：用这次写入之前' +
        '最后拿到的门禁时间（自检的回复与【阶段】都带着），不要估——你没有钟，估出来的会越写越偏；已经写下的时间原样带着，不跟着换。拿到之后又等过用户或角色的，' +
        '先照你的角色说明里「门禁自检」那一节再做一次、取一次时间' +
        '（门禁照样拒那次写入，回复里带着此刻的时间，不弹权限窗）。',
    ),
    '缺那一句',
  )
  // 复核（低 5）：建 run、推进、回退三处 history 那一条都写「门禁给的时间」，收口那一步照门禁给的写——逐处核，不只认一个字面的占位。
  assert.equal(at.split('"at": "<门禁给的时间>" }').length - 1, 3, '三处 history 那一条')
  assert.ok(at.includes('（收口那一刻的时间，照门禁给的写，例：'), '收口那一步')
  assert.ok(at.includes('这一次不往 `history` 追加（推进进最后一段是之前单独那一次写入），已有的条目连时间也不改，'), '收口那一步不改已有的时间')
  assert.ok(at.includes('照它说的原因重问。重写那次被拒的写入时，它要追加的那一条照这次写入之前最后拿到的门禁时间写（那次写入没落盘）。'), '重写被拒的写入时，新追加的那一条照最新的门禁时间')
  assert.ok(!at.includes('ISO 时间'), '还有只写 ISO 时间的地方')
  const tpl = readFileSync(new URL('../templates/00-contract.md', import.meta.url), 'utf8')
  assert.ok(tpl.includes('冻结时间：<门禁给的时间>'), '契约模板的冻结时间')
})

// 复核（低 4）：门禁叫项目经理重写时间的几处拒绝理由与报错，也带门禁此刻的时间，不再只给占位或一个固定的样例。
test('拒绝理由与报错：history 条目形状不对、closed_at 不是时间——都带门禁此刻的时间', () => {
  const t0 = Date.now()
  const OPEN = { run_id: 'r1', stage: 'S2', contract_sha: 'PENDING', roster: [], artifacts: {}, rework: {}, never_invoked: [], escalations: [], history: [{ stage: 'S1', at: T }], closed_at: null }
  const c = decideClosing({ before: OPEN, after: { ...OPEN, closed_at: '昨天' }, stages: STAGES })
  assert.equal(c.ok, false)
  inWindow(c.reason.slice(c.reason.indexOf('门禁此刻是')), t0, Date.now())
  const v = validateState({ ...OPEN, closed_at: '昨天' }, { stages: STAGES })
  const msg = v.problems.find((m) => m.includes('closed_at')) ?? ''
  inWindow(msg.slice(msg.indexOf('门禁此刻是')), t0, Date.now())
  const before = { ...OPEN, stage: 'S1', history: [{ stage: 'S1', at: T }] }
  const r = decideRework({ before, after: { ...before, history: [...before.history, { at: T }] }, stages: STAGES })
  assert.equal(r.ok, false, JSON.stringify(r))
  inWindow(r.reason.slice(r.reason.indexOf('门禁此刻是')), t0, Date.now())
})

// docs/94 复核（低 4）：改旧条目段名的拒绝理由原来说「at 可以订正」，与正文「已经写下的时间原样带着」相抵。
test('改 history 旧条目段名的拒绝理由：段名、时间都不改，不再说可以订正', () => {
  const before = { run_id: 'r1', stage: 'S2', contract_sha: 'PENDING', history: [{ stage: 'S1', at: T }, { stage: 'S2', at: T }] }
  const r = decideRework({ before, after: { ...before, history: [{ stage: 'S2', at: T }, { stage: 'S2', at: T }] }, stages: STAGES })
  assert.equal(r.ok, false)
  assert.ok(r.reason.includes('已有的条目原样带着，段名、时间都不改，也不许删') && !r.reason.includes('订正'), r.reason)
})

// docs/94：桌面端默认权限模式下实测——插件装在项目之外，项目经理与各角色读插件自带的说明都要你确认；权限确认里拒掉任何一次，这一轮就停下等你。
test('README 两半：默认权限模式下会频繁弹窗、拒掉一次就停下，说「继续」接着做', () => {
  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const [zh, en] = text.split('<a id="english"></a>')
  assert.ok(
    zh.includes('> **默认权限模式下会频繁弹窗。** 每次写文件、跑命令都要你确认；插件装在项目文件夹之外，项目经理和部分角色读插件自带的说明也要确认。' +
      '在权限确认里拒掉项目经理的一次请求，这一轮就停下等你——说一句「继续」它会接着做。嫌弹窗多可以用 auto 模式。\n'),
    '中文那一半',
  )
  assert.ok(
    en.includes('> **Expect frequent prompts in the default permission mode.** Every file write and command asks for your confirmation, and since the plugin ' +
      'lives outside your project folder, the project manager and some roles also ask before reading the plugin\'s own instructions. Deny one of the project ' +
      'manager\'s requests and that turn stops and waits for you — say “continue” and it picks up where it stopped. Auto mode cuts the prompts down.\n'),
    '英文那一半',
  )
})
