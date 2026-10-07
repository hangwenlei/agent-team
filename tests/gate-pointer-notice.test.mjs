// docs/30 §4「第二趟起漏切指针、契约写在当前 run 之外」（docs/51，M4p）：项目经理把契约或阶段产物写进 runs/ 下一趟不是 current-run 的 run 目录时，
// 账本原来一句不说（这次写入不在当前 run 里，按设计提前退出）——没有 sha 回传、不进账本比对，门禁照旧按指针指着的那一趟判。现在回传一段【指针】：
// 说清这次写在哪一趟、门禁按哪一趟判，出路两条（新建的那一趟先把指针指过去再原样重写；要接着做的确是那一趟，先把指针改回它、再续跑）。
// 收窄到契约与产物：写 state.json（建新 run 时它本来就先于指针）、写别的文件、执行角色的写入都不说。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const posted = (file, agent = 'agent-team:at-pm') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: agent, tool_input: { file_path: file } })
const TAG = '【指针】'

// 当前这一趟 r1 停在 S2；另一趟（id）只有目录（还没写 state.json，或者写了）。
function twoRuns(body, { other = 'r2', withState = false } = {}) {
  const dirs = makeRun({ runId: 'r1', stage: 'S2', roster: ['at-product'] })
  const at = join(dirs.projectDir, '.agent-team')
  const r1 = join(at, 'runs', 'r1')
  const r2 = join(at, 'runs', other)
  mkdirSync(r2, { recursive: true })
  if (withState) writeFileSync(join(r2, 'state.json'), JSON.stringify({ run_id: other, stage: 'S1', history: [{ stage: 'S1', at: '2026-10-07T10:00:00Z' }] }))
  try {
    return body({ ...dirs, r1, r2 })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('漏切指针：项目经理把契约写进另一趟的 run 目录——【指针】说清写在哪一趟、门禁按哪一趟判，给出两条出路', () => {
  twoRuns(({ projectDir, r2 }) => {
    writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
    const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
    assert.ok(c.includes(TAG), c)
    assert.ok(c.includes('"r2"') && c.includes('"r1"') && c.includes('00-contract.md'), c)
    assert.ok(c.includes('current-run') && c.includes('/agent-team:at-resume'), c)
  })
})

test('漏切指针：项目经理把阶段产物写进另一趟的 run 目录——同样说；产物名照阶段链认', () => {
  twoRuns(({ projectDir, r2 }) => {
    writeFileSync(join(r2, '01-prd.md'), '# prd\n')
    const c = ctxOf(run('ledger', posted(join(r2, '01-prd.md')), GATE, projectDir).stdout)
    assert.ok(c.includes(TAG) && c.includes('01-prd.md') && c.includes('"r2"'), c)
  })
})

test('漏切指针：收窄——写另一趟的 state.json（建新 run 时它先于指针）、别的文件、执行角色的写入都不说；写当前这一趟的契约照旧', () => {
  twoRuns(
    ({ projectDir, r1, r2 }) => {
      const silent = (input) => {
        const c = ctxOf(run('ledger', input, GATE, projectDir).stdout)
        assert.ok(!c.includes(TAG), c)
      }
      silent(posted(join(r2, 'state.json')))
      writeFileSync(join(r2, 'notes.md'), 'x\n')
      silent(posted(join(r2, 'notes.md')))
      writeFileSync(join(r2, '01-prd.md'), '# prd\n')
      silent(posted(join(r2, '01-prd.md'), 'agent-team:at-product'))
      writeFileSync(join(r1, '00-contract.md'), '# 契约\n')
      silent(posted(join(r1, '00-contract.md')))
      mkdirSync(join(projectDir, 'src'), { recursive: true })
      writeFileSync(join(projectDir, 'src', '00-contract.md'), 'x\n')
      silent(posted(join(projectDir, 'src', '00-contract.md')))
    },
    { withState: true },
  )
})

test('漏切指针：run 目录名是磁盘上的值——过 quote（带空格的名字在一对引号里）', () => {
  twoRuns(
    ({ projectDir, r2 }) => {
      writeFileSync(join(r2, '00-contract.md'), '# 契约\n')
      const c = ctxOf(run('ledger', posted(join(r2, '00-contract.md')), GATE, projectDir).stdout)
      assert.ok(c.includes('"r 2"'), c)
    },
    { other: 'r 2' },
  )
})
