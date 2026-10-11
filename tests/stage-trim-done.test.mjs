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

test('调用点（docs/76）：hooks 下每一处 isStageDone 调用都传 state（不传就退回原来那种等裁掉的人的口径）', () => {
  const HOOKS = new URL('../hooks/', import.meta.url)
  const files = [
    ...readdirSync(HOOKS).filter((f) => f.endsWith('.mjs')).map((f) => new URL(f, HOOKS)),
    ...readdirSync(new URL('lib/', HOOKS)).filter((f) => f.endsWith('.mjs')).map((f) => new URL(`lib/${f}`, HOOKS)),
  ]
  let calls = 0
  for (const u of files) {
    const text = readFileSync(u, 'utf8')
    for (let i = text.indexOf('isStageDone({'); i >= 0; i = text.indexOf('isStageDone({', i + 1)) {
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
      calls++
      assert.ok(/\bstate\s*:/.test(args), `${u.pathname.split('/hooks/')[1]}：${args.slice(0, 120)}`)
    }
  }
  assert.ok(calls >= 3, `前置：扫到的调用太少（${calls}）`)
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
