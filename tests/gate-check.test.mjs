// 门禁自检（M3t，docs/28，全量审查第 4 条）。
//
// 门禁全是 command hook，起不来时平台一律放行、错误不进模型的上下文——PM 自己察觉不到门禁没在跑。
// 所以反过来查：PM 用 Write 写 .agent-team/gate-check，门禁在线时 H3 必拒、理由里带着固定串；写入
// 成功就说明门禁没在跑。这份判据钉门禁这一半：什么样的写入拿得到「在线」、什么样的拿不到。
// 协议那一半（PM 怎么判、怎么收尾）在 agents/at-pm.md，由 tests/agents.test.mjs 钉着。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, hermeticEnv } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { CHECKS } from '../hooks/lib/checks.mjs'
import { GATE_CHECK_PATH, GATE_CHECK_ONLINE, isGateCheck, gateCheckReason } from '../hooks/lib/gate-check.mjs'

const BS = String.fromCharCode(92)
// 反斜杠只在 Windows 上是分隔符：Linux / macOS 上 `.agent-team\gate-check` 是一个字面名字的文件，本来就不算自检。
const WIN = process.platform === 'win32'

// ---- 路径判定 ----

test('isGateCheck：末两段恰好是 .agent-team/gate-check 才算——写法（分隔符、大小写、相对路径）不影响', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-gc-')))
  try {
    for (const p of [
      join(base, '.agent-team', 'gate-check'),
      join(base, 'sub', '.agent-team', 'gate-check'),
      `${base}/.agent-team/gate-check`,
      join(base, '.AGENT-TEAM', 'Gate-Check'),
      GATE_CHECK_PATH,
      ...(WIN ? [GATE_CHECK_PATH.split('/').join(BS)] : []),
    ]) {
      assert.ok(isGateCheck(p), p)
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

// 匹配过宽的代价是真的：被误认的正当写入会收到「预期的拒绝，接着往下做」，写入就悄悄丢了。
test('isGateCheck：相似的路径都不算', () => {
  for (const p of [
    '.agent-team/gate-check.txt',
    '.agent-team/gate-checkx',
    'x/gate-check',
    'gate-check',
    '.agent-team/sub/gate-check',
    '.agent-team',
    '',
    null,
    42,
  ]) {
    assert.ok(!isGateCheck(p), String(p))
  }
})

test('gateCheckReason：以固定串开头，带着门禁用的 node 版本与路径，说明拒绝是预期的', () => {
  const r = gateCheckReason({ version: 'v24.1.0', execPath: '/opt/node/bin/node' })
  assert.ok(r.startsWith(GATE_CHECK_ONLINE), r)
  assert.ok(r.includes('v24.1.0') && r.includes('/opt/node/bin/node'), r)
  assert.match(r, /预期/)
  assert.ok(!r.includes('\n'), r)
})

// ---- 门禁子进程：谁写、在什么项目里写，都拿到「在线」 ----

const write = (agent, file_path, tool = 'Write') => ({
  hook_event_name: 'PreToolUse',
  tool_name: tool,
  ...(agent ? { agent_type: agent } : {}),
  tool_input: tool === 'NotebookEdit' ? { notebook_path: file_path, new_source: 'x' } : { file_path, content: 'x' },
})

// 三种项目状态：连 .agent-team 都没有（/at-init 之前）、run 好好的、run 读不出来（current-run 指向不存在的目录）。
function withProject(state, fn) {
  if (state === 'bare') {
    const p = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-gc-bare-')))
    try {
      return fn(p)
    } finally {
      rmSync(p, { recursive: true, force: true })
    }
  }
  const dirs = makeRun({ runId: 'r1', stage: 'S1', project: { paths: { 'at-backend': ['src/server/'] } } })
  try {
    if (state === 'unreadable') writeFileSync(join(dirs.projectDir, '.agent-team', 'current-run'), 'r-missing')
    return fn(dirs.projectDir)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

const CALLERS = [
  ['主线程（没有 agent_type）', undefined],
  ['被钉成主线程的 at-pm', 'agent-team:at-pm'],
  ['执行角色', 'agent-team:at-backend'],
]

for (const state of ['bare', 'ok', 'unreadable']) {
  for (const [who, agent] of CALLERS) {
    test(`H3：${who}在「${state}」项目里写 .agent-team/gate-check → 拒，理由里有「在线」`, () => {
      withProject(state, (p) => {
        for (const tool of ['Write', 'Edit', 'NotebookEdit']) {
          const r = run('writepath', write(agent, join(p, '.agent-team', 'gate-check'), tool), undefined, p)
          const d = decisionOf(r.stdout)
          assert.equal(d?.permissionDecision, 'deny', `${tool}：${r.stdout}${r.stderr}`)
          assert.ok(d.permissionDecisionReason.startsWith(GATE_CHECK_ONLINE), d.permissionDecisionReason)
        }
      })
    })
  }
}

// 项目根不锚定：用户 /cd 到别的目录再跑 /at-init 时，门禁认的项目根（CLAUDE_PROJECT_DIR）不是那里。
// 锚定项目根的写法会让自检在门禁好好的时候拿不到「在线」、PM 误报门禁没在跑。
test('H3：CLAUDE_PROJECT_DIR 指向别处、目标项目里还没有 .agent-team——照样拿到「在线」', () => {
  withProject('ok', (a) => {
    withProject('bare', (b) => {
      const env = { ...hermeticEnv(), CLAUDE_PROJECT_DIR: a }
      const r = run('writepath', write('agent-team:at-pm', join(b, '.agent-team', 'gate-check')), undefined, a, env)
      assert.ok(decisionOf(r.stdout)?.permissionDecisionReason?.startsWith(GATE_CHECK_ONLINE), r.stdout + r.stderr)
    })
  })
})

test('H3：路径写成反斜杠、大写、相对路径——照样拿到「在线」', () => {
  withProject('ok', (p) => {
    for (const fp of [
      ...(WIN ? [`${p}${BS}.agent-team${BS}gate-check`] : []),
      join(p, '.AGENT-TEAM', 'GATE-CHECK'),
      GATE_CHECK_PATH,
    ]) {
      const r = run('writepath', write('agent-team:at-pm', fp), undefined, p)
      assert.ok(decisionOf(r.stdout)?.permissionDecisionReason?.startsWith(GATE_CHECK_ONLINE), `${fp}：${r.stdout}${r.stderr}`)
    }
  })
})

test('H3：相似的路径拿不到「在线」', () => {
  withProject('ok', (p) => {
    for (const fp of [join(p, '.agent-team', 'gate-check.txt'), join(p, '.agent-team', 'gate-checkx'), join(p, 'x', 'gate-check')]) {
      for (const [, agent] of CALLERS) {
        const r = run('writepath', write(agent, fp), undefined, p)
        assert.ok(!(r.stdout + r.stderr).includes(GATE_CHECK_ONLINE), `${fp}：${r.stdout}`)
      }
    }
  })
})

// 平台对同一次调用并行跑同组的全部 PreToolUse hook，模型只看到其中一条拒绝理由。会跑自检的是 PM
// （主线程或被钉住的 at-pm）：对它们，同组其余检查项必须一声不出，否则那条理由可能盖掉「在线」。
// 同组的检查项从 CHECKS 里取，将来往这一组加检查项会自动被纳入。
test('同组的其余检查项对 PM 的自检写入一声不出——模型看到的只会是「在线」那一条', () => {
  const siblings = Object.entries(CHECKS)
    .filter(([name, s]) => name !== 'writepath' && s.event === CHECKS.writepath.event &&
      JSON.stringify(s.toolNames) === JSON.stringify(CHECKS.writepath.toolNames))
    .map(([name]) => name)
  assert.ok(siblings.length > 0, '同组没有别的检查项——这条判据在空集合上空转')
  for (const state of ['bare', 'ok', 'unreadable']) {
    withProject(state, (p) => {
      for (const agent of [undefined, 'agent-team:at-pm']) {
        for (const check of siblings) {
          const r = run(check, write(agent, join(p, '.agent-team', 'gate-check')), undefined, p)
          assert.equal(r.stdout.trim(), '', `${state} · ${agent ?? '主线程'} · ${check}：${r.stdout}`)
          assert.equal(r.status, 0, `${state} · ${check}：${r.stderr}`)
        }
      }
    })
  }
})
