// docs/79（docs/42 §4、docs/29 §5「reach.json 写完之后会落后」）：.agent-team/reach.json 是项目经理照【触达表】手抄的快照，门禁只在写它的那一刻核
// （ledger.mjs 的 reachCheckNotice）。之后 project.json 被手改（两趟之间用户改了 paths）、写坏、被删，/agent-team:at-status 照旧照它报。现在每趟开头
// 写 current-run 时，按当前 project.json 与花名册重算一遍、与磁盘上的比：对不上、写坏了、有重复的键、不在，【触达表】说出来、给出正确的那一份。
// project.json 有阻断或插件问题时不核（那时【触达表】本来就叫 PM 先别写，「正确的那一份」也算不准）；写 state.json 等别的时机不核（免得每次记账都刷）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { computeReach } from '../hooks/lib/reach.mjs'
import { reachStaleNotice } from '../hooks/lib/ledger.mjs'

const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const posted = (file_path, agent_type = 'agent-team:at-pm') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type, tool_input: { file_path } })
const ctxOf = (r) => decisionOf(r.stdout)?.additionalContext ?? ''
const expectedOf = (project) => computeReach({ roster: ROSTER, paths: project.paths })
const WIDER = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': [...(TEMPLATE.paths['at-backend'] ?? []), 'scripts/'] } }

// 写 current-run（落盘之后的账本）；reach：磁盘上 reach.json 的原文（null 是不在，DIR 是建成一个目录）；writer：写指针的人；roster：花名册的原文（给了就拷一份插件、
// 换掉花名册——门禁从它自己所在的插件根读花名册，tests/gate-acceptance.test.mjs 同一个做法）。
const DIR = Symbol('dir')
function pointer({ project = TEMPLATE, reach, file = 'current-run', writer = 'agent-team:at-pm', roster = null }) {
  const dirs = makeRun({ runId: 'r1', stage: 'S1', project })
  const plugin = roster === null ? null : realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-r37-plug-')))
  try {
    let gate
    if (plugin) {
      const REPO = new URL('../', import.meta.url)
      cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
      cpSync(new URL('stages.json', REPO), join(plugin, 'stages.json'))
      writeFileSync(join(plugin, 'roster.json'), roster)
      gate = join(plugin, 'hooks', 'boot.mjs')
    }
    const at = join(dirs.projectDir, '.agent-team')
    if (reach === DIR) mkdirSync(join(at, 'reach.json'))
    else if (reach !== null) writeFileSync(join(at, 'reach.json'), reach)
    const target = file === 'current-run' ? join(at, 'current-run') : join(at, 'runs', 'r1', file)
    return ctxOf(run('ledger', posted(target, writer), gate, dirs.projectDir))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
    if (plugin) rmSync(plugin, { recursive: true, force: true })
  }
}
const jsonAfter = (ctx) => JSON.parse(ctx.slice(ctx.indexOf('{', ctx.indexOf('重写进 .agent-team/reach.json'))).split('\n\n')[0])

test('reachStaleNotice（docs/79）：对得上不吭声（键序、BOM、CRLF 不算不同）；对不上、写坏了、有重复的键、不在各说一句，都给出正确的那一份', () => {
  const expected = expectedOf(TEMPLATE)
  assert.equal(reachStaleNotice({ text: JSON.stringify(expected), expected }), null)
  assert.equal(reachStaleNotice({ text: String.fromCharCode(0xfeff) + JSON.stringify(expected, null, 2).split('\n').join('\r\n'), expected }), null)
  const cases = [
    [JSON.stringify(expectedOf(WIDER)), '不一样'],
    ['{ 坏了', '不是一份合法的 JSON'],
    ['{"__main__": {}, "__main__": {}}', '写了不止一次的键'],
    [null, '不在'],
  ]
  for (const [text, word] of cases) {
    const s = reachStaleNotice({ text, expected })
    assert.ok(s && s.startsWith('【触达表】') && s.includes(word), String(s))
    assert.ok(s.includes('/agent-team:at-status'), s)
    assert.deepEqual(JSON.parse(s.slice(s.indexOf('{'))), expected)
  }
})

test('写 current-run（docs/79）：project.json 改宽了、reach.json 还是旧的——【触达表】说它落后，给出按当前配置算的那一份；对得上时不说', () => {
  const stale = pointer({ project: WIDER, reach: JSON.stringify(expectedOf(TEMPLATE)) })
  assert.ok(stale.includes('【触达表】') && stale.includes('.agent-team/reach.json'), stale)
  assert.deepEqual(jsonAfter(stale), expectedOf(WIDER))
  const fresh = pointer({ project: WIDER, reach: JSON.stringify(expectedOf(WIDER)) })
  assert.ok(!fresh.includes('【触达表】'), fresh)
  const missing = pointer({ project: TEMPLATE, reach: null })
  assert.ok(missing.includes('【触达表】') && missing.includes('不在'), missing)
})

test('写 current-run（docs/79）：project.json 有阻断时不核 reach.json（【project.json】先说，【触达表】不给一份算不准的）', () => {
  const BLOCKED = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['../'] } }
  const ctx = pointer({ project: BLOCKED, reach: JSON.stringify(expectedOf(TEMPLATE)) })
  assert.ok(ctx.includes('【project.json】'), ctx)
  assert.ok(!ctx.includes('重写进 .agent-team/reach.json'), ctx)
})

// 复核（docs/79 §8）：花名册读不出（插件问题）时不核——照它算的触达表是空的，叫 PM 照着重写会用一份空表盖掉对的那一份；reach.json 在却读不出（这里是
// 一个目录）不核；写指针的人不是项目经理时，叫它原样冒泡、不要自己重写（与写 reach.json 那一刻同一个口径）；「对不上」的成因里有插件更新。
test('写 current-run（docs/79 §8）：花名册读不出时只说【插件】、不给触达表；reach.json 在却读不出不核；不是项目经理写的叫它冒泡；成因里有插件更新', () => {
  const broken = pointer({ project: TEMPLATE, reach: JSON.stringify(expectedOf(TEMPLATE)), roster: '{ 坏了' })
  assert.ok(broken.includes('【插件】'), broken)
  assert.ok(!broken.includes('重写进 .agent-team/reach.json'), broken)
  const dir = pointer({ project: TEMPLATE, reach: DIR })
  assert.ok(!dir.includes('【触达表】'), dir)
  const other = pointer({ project: TEMPLATE, reach: null, writer: 'agent-team:at-backend' })
  assert.ok(other.includes('【触达表】') && other.includes('原样冒泡'), other)
  const own = pointer({ project: TEMPLATE, reach: null })
  assert.ok(!own.includes('原样冒泡'), own)
  assert.ok(reachStaleNotice({ text: JSON.stringify(expectedOf(WIDER)), expected: expectedOf(TEMPLATE) }).includes('插件更新'))
})

test('写 state.json（docs/79）：reach.json 落后也不在这里说——只在每趟开头写 current-run 时核', () => {
  const ctx = pointer({ project: WIDER, reach: JSON.stringify(expectedOf(TEMPLATE)), file: 'state.json' })
  assert.ok(!ctx.includes('【触达表】'), ctx)
})
