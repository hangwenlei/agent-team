// docs/30 §4「第二趟起漏切指针、契约写在当前 run 之外」（docs/51，M4p）：项目经理把契约或阶段产物写进 runs/ 下一趟不是 current-run 的 run 目录时，
// 账本原来一句不说（这次写入不在当前 run 里，按设计提前退出）——没有 sha 回传、不进账本比对，门禁照旧按指针指着的那一趟判。现在回传一段【指针】：
// 说清这次写在哪一趟、门禁按哪一趟判，按情形给出路——新建的就是那一趟（指针指过去；契约与项目经理自己的产物原样重写拿回传，别的角色的产物派它的
// 产者重交）、写错了目录（照原样写进指针指着的那一趟）、要接着做那一趟（先问用户；它已经收口就不能接着做）。
// 收窄到契约与产物：写 state.json（建新 run 时它本来就先于指针）、写别的文件、执行角色的写入都不说。
// 复核（docs/51 §8）：指针指着的那一趟 state.json 读不出来时同样说（原来回的【门禁】叫项目经理去重建它）；目录名不是合法 run id 的不给「指过去」；
// 出路一对别的角色的产物走不通（指过去之后 H3 拒项目经理写它），改成派产者重交；两条出路各走一遍。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, decisionOf, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const posted = (file, agent = 'agent-team:at-pm') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', ...(agent ? { agent_type: agent } : {}), tool_input: { file_path: file } })
const TAG = '【指针】'
const squash = (s) => s.replace(/\s+/g, '')
const has = (text, k) => squash(text).includes(squash(k))
const stateOf = (id, extra = {}) => JSON.stringify({ run_id: id, stage: 'S1', contract_sha: 'PENDING', roster: [], artifacts: {}, rework: {}, never_invoked: [], escalations: [], history: [{ stage: 'S1', at: '2026-10-07T10:00:00Z' }], ...extra })

// 当前这一趟 r1 停在 S2；另一趟（id）建了目录（withState 时也写了 state.json）。
function twoRuns(body, { other = 'r2', withState = false, otherState = null } = {}) {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', roster: ['at-product'] })
  const at = join(dirs.projectDir, '.agent-team')
  const r1 = join(at, 'runs', 'r1')
  const r2 = join(at, 'runs', other)
  mkdirSync(r2, { recursive: true })
  if (withState || otherState) writeFileSync(join(r2, 'state.json'), otherState ?? stateOf(other))
  try {
    return body({ ...dirs, at, r1, r2 })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('漏切指针：项目经理把契约写进另一趟的 run 目录——【指针】说清写在哪一趟、门禁按哪一趟判，三种情形各一条出路', () => {
  twoRuns(({ projectDir, r2 }) => {
    writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
    const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes(TAG), c)
    for (const k of [
      '【指针】这次写的是 "r2" 那一趟 run 目录里的 00-contract.md，current-run 指着 "r1"——门禁按 "r1" 判，这次写入没有 sha 回传、不进账本比对。',
      '新建的就是 "r2"、忘了改指针：照 /agent-team:at 第 1 节把 current-run 指到它，再原样重写一次这份文件拿回传',
      '写错了目录、要写的是 "r1" 那一趟：照原样写进 "r1"；"r2" 里这一份已经被这次写入改了，告诉用户',
      '要接着做的是 "r2" 那一趟：那一趟是用户定过放弃的、或者拿不准，先问用户；用户要接着做，再把 current-run 指到它、跑 /agent-team:at-resume',
    ]) assert.ok(has(c, k), `缺「${k}」：${c}`)
    // 整段逐字：逐句钉挡不住往出路后面另加一句（复核 docs/51 §8，例如「也可以不管它接着写」）。
    assert.equal(
      c,
      'agent-team 账本回传：\n' +
        '【指针】这次写的是 "r2" 那一趟 run 目录里的 00-contract.md，current-run 指着 "r1"——门禁按 "r1" 判，这次写入没有 sha 回传、不进账本比对。看是哪一种：\n' +
        '  - 新建的就是 "r2"、忘了改指针：照 /agent-team:at 第 1 节把 current-run 指到它，再原样重写一次这份文件拿回传\n' +
        '  - 写错了目录、要写的是 "r1" 那一趟：照原样写进 "r1"；"r2" 里这一份已经被这次写入改了，告诉用户\n' +
        '  - 要接着做的是 "r2" 那一趟：那一趟是用户定过放弃的、或者拿不准，先问用户；用户要接着做，再把 current-run 指到它、跑 /agent-team:at-resume',
    )
  })
})

test('漏切指针：别的角色的产物——出路一是派它的产者重交（这一份不算它交的），不是原样重写；项目经理自己的产物照常原样重写', () => {
  twoRuns(({ projectDir, r2 }) => {
    writeFileSync(join(r2, '01-prd.md'), '# prd\n')
    const c = ctxOf(run('ledger', posted(join(r2, '01-prd.md')), GATE, projectDir).stdout)
    assert.ok(has(c, '再派 at-product 重交一次（这一份是你写的，不算它交的；它重交之前，别拿这一份当这一段交齐了）'), c)
    assert.ok(!has(c, '再原样重写一次这份文件拿回传'), c)
    writeFileSync(join(r2, '04-dispatch.md'), '# dispatch\n')
    const own = ctxOf(run('ledger', posted(join(r2, '04-dispatch.md')), GATE, projectDir).stdout)
    assert.ok(own.includes(TAG) && has(own, '再原样重写一次这份文件拿回传'), own)
  })
})

test('漏切指针（复核 docs/51 §8，中 2）：把出路一走一遍——契约指过去之后原样重写拿得到 sha；别的角色的产物指过去之后项目经理写它被 H3 拒', () => {
  twoRuns(
    ({ projectDir, at, r2 }) => {
      writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
      writeFileSync(join(at, 'current-run'), 'r2')
      const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(!c.includes(TAG) && /sha256/.test(c), '指过去之后：【契约】带 sha，不再出【指针】：' + c)
      const write = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path: join(r2, '01-prd.md'), content: '# prd\n' } }
      const d = decisionOf(run('writepath', write, GATE, projectDir).stdout)
      assert.equal(d?.permissionDecision, 'deny', '别的角色的产物：指过去之后项目经理写不了，所以出路一给的是派产者：' + JSON.stringify(d))
    },
    { withState: true },
  )
})

test('漏切指针（复核 docs/51 §8，中 1）：指针指着的那一趟 state.json 读不出来——照样出【指针】，叫它别去修那一趟；不出【门禁】那句「写回一份合法的 state.json」', () => {
  twoRuns(({ projectDir, r1, r2 }) => {
    writeFileSync(join(r1, 'state.json'), '{ 坏的')
    writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
    const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes(TAG), c)
    assert.ok(has(c, '那一趟的 state.json 读不出来，门禁这一次什么都没核，这次写入也没有 sha 回传。别去修那一趟'), c)
    assert.ok(!c.includes('写回一份合法的完整'), c)
    assert.ok(!has(c, '写错了目录、要写的是'), '那一趟坏了：不叫它写回去：' + c)
  })
})

test('漏切指针（复核 docs/51 §8）：那一趟已经收口——不给「接着做」，说它已经收口、新改动另起一趟', () => {
  twoRuns(
    ({ projectDir, r2 }) => {
      writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
      const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(has(c, '要接着做的是 "r2" 那一趟：它已经收口，不能再接着做——交付之后的新改动另起一趟'), c)
      assert.ok(!c.includes('/agent-team:at-resume'), c)
    },
    { otherState: stateOf('r2', { stage: 'S8', closed_at: '2026-10-07T11:00:00Z' }) },
  )
})

test('漏切指针（复核 docs/51 §8）：目录名不是合法的 run id——不给「指过去」，说它当不了 run；名字在一对引号里', () => {
  twoRuns(
    ({ projectDir, r2 }) => {
      writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
      const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(has(c, '【指针】这次写进的 "r1 - Copy" 不是一趟 run 的目录（这个名字当不了 run id）'), c)
      assert.ok(!has(c, '把 current-run 指到它'), c)
    },
    { other: 'r1 - Copy' },
  )
})

test('漏切指针：收窄——另一趟的 state.json、别的文件、执行角色的写入、当前这一趟的契约、深一层的同名文件、项目代码里同名的文件都不说', () => {
  twoRuns(
    ({ projectDir, r1, r2 }) => {
      const silent = (input) => {
        const c = ctxOf(run('ledger', input, GATE, projectDir).stdout)
        assert.ok(!c.includes(TAG), `${input.tool_input.file_path}：${c}`)
      }
      silent(posted(join(r2, 'state.json')))
      writeFileSync(join(r2, 'notes.md'), 'x\n')
      silent(posted(join(r2, 'notes.md')))
      writeFileSync(join(r2, '01-prd.md'), '# prd\n')
      silent(posted(join(r2, '01-prd.md'), 'agent-team:at-product'))
      writeFileSync(join(r1, '00-contract.md'), '# 契约\n')
      silent(posted(join(r1, '00-contract.md')))
      mkdirSync(join(r2, 'sub'), { recursive: true })
      writeFileSync(join(r2, 'sub', '00-contract.md'), 'x\n')
      silent(posted(join(r2, 'sub', '00-contract.md')))
      const deep = join(projectDir, 'src', 'components', 'abc')
      mkdirSync(deep, { recursive: true })
      writeFileSync(join(deep, '00-contract.md'), 'x\n')
      silent(posted(join(deep, '00-contract.md')))
    },
    { withState: true },
  )
})

test('漏切指针：主线程（没有 agent_type）写另一趟的契约也说——它与项目经理同一档', () => {
  twoRuns(({ projectDir, r2 }) => {
    writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
    const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md'), null), GATE, projectDir).stdout)
    assert.ok(c.includes(TAG), c)
  })
})

test('漏切指针：写的是当前这一趟、只是路径换了写法（带 ..）——不说', () => {
  twoRuns(({ projectDir, r1, r2 }) => {
    writeFileSync(join(r1, '00-contract.md'), '# 契约\n')
    const c = ctxOf(run('ledger', posted(join(r2, '..', 'r1', '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c.includes(TAG), c)
  })
})

test('漏切指针：Windows 上指针写的 run id 与目录名大小写不同、写的是当前这一趟——还是这一趟，不说', { skip: process.platform !== 'win32' }, () => {
  twoRuns(({ projectDir, at, r1 }) => {
    writeFileSync(join(at, 'current-run'), 'R1')
    writeFileSync(join(r1, '00-contract.md'), '# 契约\n')
    const c = ctxOf(run('ledger', posted(join(r1, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(!c.includes(TAG), c)
  })
})

test('漏切指针：回传里的目录名照这次给的路径原样（Windows、macOS 上不折成小写）', () => {
  twoRuns(
    ({ projectDir, r2 }) => {
      writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
      const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(c.includes('"20261007-1430-Login"'), c)
    },
    { other: '20261007-1430-Login' },
  )
})
