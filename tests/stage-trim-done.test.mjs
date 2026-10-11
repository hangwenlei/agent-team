// docs/76（docs/32 §4「叫到之后又裁掉：isStageDone 仍等它的产物，【阶段】不发」）：推进判据（advance.mjs 的 departureNeeds）对叫到之后又裁掉的角色，
// trimmed 里记着它、值是这一段、那份产物 mayWaive 许的（按叫到的人展开产物的段、不被任何段当前置、不是验证段），就免掉；isStageDone（【阶段】与
// 交付物核验判齐用它）原来照样等——【阶段】不说齐了，可推进其实放行，项目经理拿不到「可以推进了」那一句。现在 isStageDone 多收一个 state，用同一个
// trimmedAt + mayWaive 免掉那几份，口径与推进一致；每一处调用都传 state。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isStageDone } from '../hooks/lib/state.mjs'
import { participantsOf } from '../hooks/lib/stages.mjs'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { dispatchLine } from '../hooks/lib/completion.mjs'

const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const S5_STATE = {
  stage: 'S5',
  roster: ['at-product', 'at-architect', 'at-backend', 'at-frontend'],
  stage_roles: { S2: ['at-product'], S3: ['at-architect'], S5: ['at-architect', 'at-backend', 'at-frontend'] },
  trimmed: { 'at-frontend': 'S5' },
}

test('isStageDone（docs/76）：S5 里叫到之后又裁掉的执行角色，它那份实现记录免掉——传了 state 判齐；不传、或者 trimmed 记的不是这一段，照旧等它', () => {
  const have = new Set(['05-impl/at-backend.md'])
  const exists = (n) => have.has(n)
  const roster = participantsOf(S5_STATE, 'S5')
  assert.equal(isStageDone({ stage: 'S5', stages: STAGES, artifactExists: exists, roster, state: S5_STATE }), true)
  assert.equal(isStageDone({ stage: 'S5', stages: STAGES, artifactExists: exists, roster }), false)
  const elsewhere = { ...S5_STATE, trimmed: { 'at-frontend': 'S2' } }
  assert.equal(isStageDone({ stage: 'S5', stages: STAGES, artifactExists: exists, roster, state: elsewhere }), false)
  // 别的执行角色没交的，照旧不齐。
  assert.equal(isStageDone({ stage: 'S5', stages: STAGES, artifactExists: () => false, roster, state: S5_STATE }), false)
})

test('isStageDone（docs/76）：验证段（S6）叫到 at-qa 之后又裁掉的不免——测试报告照旧要（mayWaive 不许验证段）', () => {
  const s6 = { stage: 'S6', roster: ['at-qa'], stage_roles: { S6: ['at-qa'] }, trimmed: { 'at-qa': 'S6' } }
  assert.equal(isStageDone({ stage: 'S6', stages: STAGES, artifactExists: () => false, roster: participantsOf(s6, 'S6'), state: s6 }), false)
})

test('【阶段】（docs/76）：S5 里叫到之后又裁掉一个执行角色、别的都交了——项目经理写 state.json 时说 S5 齐了（推进本来就放行）', () => {
  const dirs = makeRun({ runId: 'r1', stage: 'S5', artifacts: ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md', '05-impl/at-backend.md'], roster: S5_STATE.roster })
  try {
    const statePath = join(dirs.projectDir, '.agent-team', 'runs', 'r1', 'state.json')
    const now = JSON.parse(readFileSync(statePath, 'utf8'))
    writeFileSync(statePath, JSON.stringify({ ...now, ...S5_STATE }))
    const posted = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath } }
    const out = run('ledger', posted, GATE, dirs.projectDir).stdout
    const ctx = out.trim() ? JSON.parse(out).hookSpecificOutput?.additionalContext ?? '' : ''
    assert.ok(ctx.includes('【阶段】S5 的产物已经齐了'), ctx)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 复核（docs/76 §8）：调用点判据核值不只核键（state 传成 null 也该红），扫描面认任何写法的调用（不只 `isStageDone({`）、跳过定义与注释；
// 列举调用所在的文件，不报总数。
test('调用点（docs/76）：hooks 下每一处 isStageDone 调用都传 state: ctx.state、artifactStale: fresh.isStale、running: runningRolesIn(…)，调用只在 hooks/gate.mjs 里', () => {
  const HOOKS = new URL('../hooks/', import.meta.url)
  const files = [
    ...readdirSync(HOOKS).filter((x) => x.endsWith('.mjs')).map((x) => ['hooks/' + x, new URL(x, HOOKS)]),
    ...readdirSync(new URL('lib/', HOOKS)).filter((x) => x.endsWith('.mjs')).map((x) => ['hooks/lib/' + x, new URL('lib/' + x, HOOKS)]),
  ]
  const where = new Set()
  for (const [name, u] of files) {
    // 去掉行注释（// 之后到行尾），块注释里不写 isStageDone 调用。
    const text = readFileSync(u, 'utf8').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n')
    for (let i = text.indexOf('isStageDone('); i >= 0; i = text.indexOf('isStageDone(', i + 1)) {
      if (text.slice(Math.max(0, i - 9), i) === 'function ') continue // 定义本身不算调用
      let depth = 0
      let j = i + 'isStageDone('.length
      for (; j < text.length; j++) {
        if (text[j] === '{' || text[j] === '(') depth++
        else if (text[j] === '}' || text[j] === ')') {
          if (depth === 0) break
          depth--
        }
      }
      const args = text.slice(i, j)
      where.add(name)
      assert.ok(/(?:^|[{,\s])state\s*:\s*ctx\.state\s*(?:[,}]|$)/m.test(args), `${name}：state 没传 ctx.state——${args.slice(0, 160)}`)
      assert.ok(/artifactStale\s*:\s*fresh\.isStale\s*(?:,|\})/.test(args), `${name}：artifactStale 没传 fresh.isStale——${args.slice(0, 160)}`)
      assert.ok(/running\s*:\s*runningRolesIn\(ctx,\s*ctx\.state\?\.stage\)\s*(?:,|\})/.test(args), `${name}：running 没传——${args.slice(0, 160)}`)
      // docs/77 §8：值后面直接收尾已经核了；键只出现一次（重复的键后一个生效）。
      for (const key of ['state', 'artifactStale', 'running']) {
        assert.equal((args.match(new RegExp('(?:^|[{,\\s])' + key + '\\s*:', 'gm')) || []).length, 1, `${name}：${key} 写了不止一次——${args.slice(0, 160)}`)
      }
    }
  }
  assert.deepEqual([...where], ['hooks/gate.mjs'])
})

test('isStageDone（docs/76 §8）：免掉的那份还是上一轮的（artifactStale）不免；那个角色在这一段还在跑（running）不免；旧 run 没有 stage_roles 照样免', () => {
  const roster = participantsOf(S5_STATE, 'S5')
  const only = (...names) => (n) => names.includes(n)
  const base = { stage: 'S5', stages: STAGES, artifactExists: only('05-impl/at-backend.md'), roster, state: S5_STATE }
  assert.equal(isStageDone(base), true)
  assert.equal(isStageDone({ ...base, artifactStale: (n) => n === '05-impl/at-frontend.md' }), false)
  assert.equal(isStageDone({ ...base, running: new Set(['at-frontend']) }), false)
  assert.equal(isStageDone({ ...base, running: new Set(['at-product']) }), true)
  const legacy = { stage: 'S5', roster: ['at-architect', 'at-backend', 'at-frontend'], trimmed: { 'at-frontend': 'S5' } }
  assert.equal(isStageDone({ stage: 'S5', stages: STAGES, artifactExists: only('05-impl/at-backend.md'), roster: participantsOf(legacy, 'S5'), state: legacy }), true)
})

test('【阶段】（docs/76 §8）：返工轮里免掉的那份还是上一轮的、或者那个角色在这一段还在跑（派发记录里没有停下行）——都不说 S5 齐了', () => {
  const ledger = (extraState, files) => {
    const dirs = makeRun({ runId: 'r1', stage: 'S5', artifacts: ['00-contract.md', '01-prd.md', '03-arch.md', '04-dispatch.md', '05-impl/at-backend.md'], roster: S5_STATE.roster })
    try {
      const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
      const statePath = join(runDir, 'state.json')
      for (const [n, c] of Object.entries(files)) writeFileSync(join(runDir, n), c)
      const now = JSON.parse(readFileSync(statePath, 'utf8'))
      writeFileSync(statePath, JSON.stringify({ ...now, ...S5_STATE, ...extraState }))
      const posted = { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: statePath } }
      const out = run('ledger', posted, GATE, dirs.projectDir).stdout
      return out.trim() ? JSON.parse(out).hookSpecificOutput?.additionalContext ?? '' : ''
    } finally {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  }
  const OLD = 'old frontend\n'
  // 返工轮：at-frontend 那份在磁盘上、与 rework_base 记的一样（上一轮的）。
  const stale = ledger({ rework_base: { '05-impl/at-frontend.md': sha256OfContract(Buffer.from(OLD)) } }, { '05-impl/at-frontend.md': OLD })
  assert.ok(!stale.includes('【阶段】S5 的产物已经齐了'), stale)
  // 派发记录里 at-frontend 在 S5 派出去了、没有停下行（还在跑）。
  const line = dispatchLine({ at: '2026-10-11T10:00:00.000Z', agentId: 'a0000000000000f05', toolUseId: null, role: 'at-frontend', stage: 'S5', caller: 'at-architect', callerId: 'a0000000000000a05', mode: 'background' })
  const running = ledger({}, { 'dispatches.jsonl': line + '\n' })
  assert.ok(!running.includes('【阶段】S5 的产物已经齐了'), running)
})

test('isStageDone（docs/76）：免哪几份与推进同一个口径——被后面某段当前置的不免（S2 的 01-prd.md）、不被当前置的免（02-*）；不随参与者变的固定产物不免', () => {
  const s2 = (trimmed) => ({ stage: 'S2', roster: ['at-product', 'at-ui'], stage_roles: { S2: ['at-product', 'at-ui'] }, trimmed })
  const roster = participantsOf(s2({}), 'S2')
  const only = (...names) => (n) => names.includes(n)
  // at-product 叫到之后又裁掉：01-prd.md 是 S3 的前置，不免。
  assert.equal(isStageDone({ stage: 'S2', stages: STAGES, artifactExists: only('02-ui-spec.md', '02-wireframe.html'), roster, state: s2({ 'at-product': 'S2' }) }), false)
  // at-ui 叫到之后又裁掉：02-* 不被任何段当前置，免掉。
  assert.equal(isStageDone({ stage: 'S2', stages: STAGES, artifactExists: only('01-prd.md'), roster, state: s2({ 'at-ui': 'S2' }) }), true)
  // 自造的一段：有一份不随参与者变的固定产物（notes.md）和按人展开的那几份；裁掉 a，固定产物照样要。
  const custom = {
    S1: { role: 'a', producers: ['a', 'b'], requires: [], produces: ['notes.md', 'x/<role>.md'] },
    S2: { role: 'c', producers: ['c'], requires: [], produces: ['y.md'] },
  }
  const st = { stage: 'S1', roster: ['a', 'b'], stage_roles: { S1: ['a', 'b'] }, trimmed: { a: 'S1' } }
  assert.equal(isStageDone({ stage: 'S1', stages: custom, artifactExists: only('x/b.md'), roster: participantsOf(st, 'S1'), state: st }), false)
  assert.equal(isStageDone({ stage: 'S1', stages: custom, artifactExists: only('x/b.md', 'notes.md'), roster: participantsOf(st, 'S1'), state: st }), true)
})
