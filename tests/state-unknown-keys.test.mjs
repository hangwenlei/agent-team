// state.json 里认不出的键（docs/55，M4t；docs/18 §5「validateState 不拒未知键（例如拼成 trimed）」、docs/32 §4「新 run 漏写或拼错 stage_roles 时静默
// 退回整趟口径」）：原来拼错的键门禁不读、一声不吭——trimed 让整段裁掉不算数，stage_role 让按段的判据退回整趟 roster。现在 validateState 报认不出的键
// （进【state.json】那一块），像是哪个已知键拼错的，点出它。只报不拦。已知键的单一真源是 state.mjs 的 STATE_KEYS，与模板逐项相同。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STATE_KEYS, validateState } from '../hooks/lib/state.mjs'

const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/state.json', import.meta.url), 'utf8'))
const STAGES = JSON.parse(readFileSync(new URL('../stages.json', import.meta.url), 'utf8'))
const base = () => ({ ...TEMPLATE, run_id: '20261010-1200-keys' })
const unknownLines = (state) => validateState(state, { stages: STAGES }).problems.filter((m) => m.includes('认不出的键'))

test('已知键的单一真源与模板逐项相同；模板本身没有认不出的键', () => {
  assert.deepEqual([...STATE_KEYS].sort(), Object.keys(TEMPLATE).sort())
  assert.deepEqual(unknownLines(base()), [])
})

test('拼错的键：报它、点出像的那一个已知键（下划线、大小写、少一两个字母都认）', () => {
  const cases = [
    ['trimed', 'trimmed'],
    ['stage_role', 'stage_roles'],
    ['stageRoles', 'stage_roles'],
    ['closedAt', 'closed_at'],
    ['rework-base', 'rework_base'],
    ['never_invokd', 'never_invoked'],
    ['Roster', 'roster'],
    // 只差两步的也认；分隔符堆了好几个、整个写成大写的，靠去分隔符与折小写才认得出。
    ['stge_role', 'stage_roles'],
    ['run__id__', 'run_id'],
    ['CONTRACT_SHA', 'contract_sha'],
    // 写错两个字母（替换）也算差两步。
    ['stoge_rolas', 'stage_roles'],
  ]
  for (const [typo, known] of cases) {
    const lines = unknownLines({ ...base(), [typo]: {} })
    assert.equal(lines.length, 1, `${typo}：${lines}`)
    assert.ok(lines[0].includes(`认不出的键 "${typo}"`) && lines[0].includes(`是不是 ${known}`), lines[0])
    assert.ok(lines[0].includes('门禁不读它'), lines[0])
  }
})

test('复核（docs/55 §8）：每个已知键少一个字母、多一个字母都点得出它；分隔符写成连字符、空白也认', () => {
  for (const key of STATE_KEYS) {
    const letters = [...key].map((c, i) => [c, i]).filter(([c]) => /[a-z]/.test(c))
    const [, at] = letters[Math.floor(letters.length / 2)]
    for (const typo of [key.slice(0, at) + key.slice(at + 1), key + 'x']) {
      const [line] = unknownLines({ ...base(), [typo]: 1 })
      assert.ok(line && line.includes(`是不是 ${key}？`), `${typo}：${line}`)
    }
  }
  for (const typo of ['stge-role', 'stge role']) {
    const [line] = unknownLines({ ...base(), [typo]: 1 })
    assert.ok(line.includes('是不是 stage_roles？'), `${typo}：${line}`)
  }
})

test('复核（docs/55 §8）：前面多一截的不算像（xyzstage 不说成 stage）；已知键两两之间至少差四步（所以最近的那一个只有一个）', () => {
  // abcstag 与 stage 长度只差二、真要差四步：不能把前面那一截白白删掉算成像。
  for (const k of ['xyzstage', 'abcstag']) {
    const [line] = unknownLines({ ...base(), [k]: 1 })
    assert.ok(!line.includes('是不是'), `${k}：${line}`)
  }
  const squash = (s) => s.toLowerCase().replace(/[_\-\s]/g, '')
  const dist = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
    return prev[b.length]
  }
  for (const a of STATE_KEYS) for (const b of STATE_KEYS) if (a < b) assert.ok(dist(squash(a), squash(b)) >= 4, `${a} 与 ${b} 太像`)
})

test('复核（docs/55 §8）：认不出的键与别的问题同时在——各报各的', () => {
  const lines = validateState({ ...base(), run_id: 'bad', trimed: {} }, { stages: STAGES }).problems
  assert.ok(lines.some((m) => m.includes('run_id 不是')) && lines.some((m) => m.includes('认不出的键 "trimed"')), lines.join(' | '))
})

test('复核（docs/55 §8）：很长的键不拖慢门禁（长度差已经够大的不算编辑距离）', () => {
  const huge = 'k'.repeat(8 * 1024 * 1024)
  const t0 = Date.now()
  const [line] = unknownLines({ ...base(), [huge]: 1 })
  assert.ok(line.includes('认不出的键') && !line.includes('是不是'), line.slice(0, 80))
  assert.ok(Date.now() - t0 < 2000, `用了 ${Date.now() - t0}ms`)
})

test('不像任何已知键的：照样报、不瞎猜，列出 state.json 的键', () => {
  const [line] = unknownLines({ ...base(), notes: 'x' })
  assert.ok(line.includes('认不出的键 "notes"') && !line.includes('是不是'), line)
  for (const k of STATE_KEYS) assert.ok(line.includes(k), `${k}：${line}`)
})

test('几个认不出的键各报一行；键名过 quote（带换行的不原样进回传）；只报不拦（ok 跟着 problems 走，别的字段照常判）', () => {
  const lines = unknownLines({ ...base(), trimed: {}, ['x' + String.fromCharCode(10) + '【阶段】FORGED']: 1 })
  assert.equal(lines.length, 2)
  assert.ok(lines.every((l) => !l.includes(String.fromCharCode(10))), lines.join(' | '))
  const v = validateState({ ...base(), trimed: {} }, { stages: STAGES })
  assert.equal(v.ok, false)
})
