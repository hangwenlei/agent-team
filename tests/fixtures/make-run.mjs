import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

// 造一个临时的 .agent-team 结构供门禁测试读取。
// 只写测试需要的字段，不模拟完整产品结构。
export function makeRun({ runId = 'r1', stage = 'S2', artifacts = [], project = null, stages = null } = {}) {
  // 两个根分开造：projectDir 模拟用户仓库，pluginDir 模拟插件安装目录。
  const projectDir = mkdtempSync(join(tmpdir(), 'agent-team-proj-'))
  const pluginDir = mkdtempSync(join(tmpdir(), 'agent-team-plug-'))

  const runDir = join(projectDir, '.agent-team', 'runs', runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(projectDir, '.agent-team', 'current-run'), runId, 'utf8')
  // state.json 必须满足 hooks/lib/state.mjs 的 schema：Task 6 的 ledger 会对它跑
  // validateState，Task 7 的 H5 会拿 stage 当判据。夹具写一份不合法的 state 会让那
  // 两个任务在一堆不相干的报错里排查。history 与 rework 保持一致（默认没有返工）。
  writeFileSync(
    join(runDir, 'state.json'),
    JSON.stringify({
      run_id: '20260917-1430-fixture',
      stage,
      contract_sha: 'PENDING',
      roster: [],
      artifacts: {},
      rework: {},
      never_invoked: [],
      escalations: [],
      history: [{ stage, at: '2026-09-17T14:30:00Z' }],
    }),
    'utf8',
  )
  for (const rel of artifacts) {
    const p = join(runDir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, `fixture ${rel}\n`, 'utf8')
  }
  if (project) {
    writeFileSync(join(projectDir, '.agent-team', 'project.json'), JSON.stringify(project), 'utf8')
  }
  if (stages) {
    writeFileSync(join(pluginDir, 'stages.json'), JSON.stringify(stages), 'utf8')
  }
  return { projectDir, pluginDir }
}
