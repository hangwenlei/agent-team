// ledger 与 H4 在 Edit 路径上的判据（M4b，docs/36，审查第 29 条）。今天让 ledger 或 H4 只认 Write（对 Edit 失明），整套照绿——而 ledger 的
// Edit 路径今天就在用：PM 用 Edit 往契约追加修订块、靠回传拿新的 contract_sha；执行角色 Edit 自己的 05-impl；M4b 起
// at-product、at-architect 也持 Edit。工具名不写字面量清单：从 hooks/lib/checks.mjs 的 toolNames 取，每个工具名走同一个场景。
// NotebookEdit 的路径字段是 notebook_path，单列一条。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'
import { CHECKS } from '../hooks/lib/checks.mjs'

const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput.additionalContext ?? '' : '')
const PATH_TOOLS = (check) => CHECKS[check].toolNames.filter((t) => t !== 'NotebookEdit')
const inputFor = (tool, agentType, file) => ({
  tool_name: tool,
  agent_type: agentType,
  tool_input: tool === 'Edit' ? { file_path: file, old_string: 'a', new_string: 'b' } : { file_path: file, content: 'x' },
})

test('M4b 前置：ledger 与 contract 的 toolNames 里都有 Edit 和 Write', () => {
  for (const c of ['ledger', 'contract']) {
    assert.ok(PATH_TOOLS(c).includes('Edit') && PATH_TOOLS(c).includes('Write'), c)
  }
})

for (const tool of PATH_TOOLS('ledger')) {
  test(`M4b ledger · ${tool}：写文档的角色改自己的产物，回传带磁盘实算的 sha`, () => {
    const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: ['at-product'] })
    try {
      const p = join(projectDir, '.agent-team', 'runs', 'r1', '01-prd.md')
      writeFileSync(p, '# PRD\n\n追加的一段\n', 'utf8')
      const { stdout } = run('ledger', inputFor(tool, 'agent-team:at-product', p), GATE, projectDir)
      assert.ok(ctxOf(stdout).includes(sha256OfContract(readFileSync(p))), `${tool} 之后的【产物】回传里没有这份文件的 sha`)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
      rmSync(pluginDir, { recursive: true, force: true })
    }
  })

  test(`M4b ledger · ${tool}：PM 往契约追加修订块，回传新的 contract_sha`, () => {
    const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S3', artifacts: ['00-contract.md', '01-prd.md'] })
    try {
      const p = join(projectDir, '.agent-team', 'runs', 'r1', '00-contract.md')
      writeFileSync(p, '# 契约\n\n## 修订 2026-10-04\n用户补充\n', 'utf8')
      const { stdout } = run('ledger', inputFor(tool, 'agent-team:at-pm', p), GATE, projectDir)
      assert.ok(ctxOf(stdout).includes(sha256OfContract(readFileSync(p))), `${tool} 之后 PM 拿不到新的 contract_sha`)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
      rmSync(pluginDir, { recursive: true, force: true })
    }
  })
}

for (const tool of PATH_TOOLS('contract')) {
  test(`M4b contract（H4）· ${tool}：子代理改 00-contract.md 被拒`, () => {
    const dirs = makeRun({ runId: 'r1' })
    try {
      const p = join(dirs.projectDir, '.agent-team', 'runs', 'r1', '00-contract.md')
      const out = decisionOf(run('contract', inputFor(tool, 'agent-team:at-product', p), undefined, dirs.projectDir).stdout)
      assert.equal(out?.permissionDecision, 'deny', `${tool} 改契约没有被 H4 拒`)
    } finally {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  })
}

test('M4b ledger · NotebookEdit：路径从 notebook_path 取，回传带磁盘实算的 sha', () => {
  assert.ok(CHECKS.ledger.toolNames.includes('NotebookEdit'))
  const { projectDir, pluginDir } = makeRun({ runId: 'r1', stage: 'S2', artifacts: ['00-contract.md'], roster: ['at-product'] })
  try {
    const p = join(projectDir, '.agent-team', 'runs', 'r1', '01-prd.md')
    writeFileSync(p, ['# PRD', '', '笔记本里改的一段', ''].join(String.fromCharCode(10)), 'utf8')
    const { stdout } = run('ledger', { tool_name: 'NotebookEdit', agent_type: 'agent-team:at-product', tool_input: { notebook_path: p, new_source: 'x' } }, GATE, projectDir)
    assert.ok(ctxOf(stdout).includes(sha256OfContract(readFileSync(p))), 'NotebookEdit 之后的【产物】回传里没有这份文件的 sha')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }
})
