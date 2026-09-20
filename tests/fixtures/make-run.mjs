import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

// 造一个临时的 .agent-team 结构供门禁测试读取。
// 只写测试需要的字段，不模拟完整产品结构。
//
// M2b Task 2：加可选 roster（缺省 []，与改动前逐字相同的旧行为）。S2 从单产者阶段
// 改成对象形式的多产者阶段后，stageRolesInRun 的 roster ∩ producers 口径第一次对
// S2 生效——roster 默认的 [] 会让「这一趟在 S2 里的产出角色」算成空集合，
// expandProduces 对象分支因此对任何角色都返回 []，H5a/账本比对会因为
// expectedArtifacts(S2, []) 是空集合而看不见 01-prd.md。这不是 stages.mjs 的
// bug——空 roster 就是"这一趟没人是它的产者"，对 expectedArtifacts /
// compareArtifacts / isStageDone 这几个没有 targetRole 概念、只答"这一趟该有
// 哪些产物"的消费方，这一直是诚实的语义（S5 的已知边界），S2 只是第一次真的
// 用到它。需要断言这几个消费方在 S2 场景下行为的测试，必须显式把在场角色传进
// roster，不能再依赖旧默认值"反正是字面量、roster 不影响"这条已经不成立的
// 隐含假设。
//
// ⚠️ H2（hooks/lib/readiness.mjs 的 decideReadiness）不在上面这条语义里，
// 不要照抄。Task 2 修复轮 1 · 修复 1 发现：roster 默认的 [] 曾经也会让 H2 的
// done 判定在空数组上 .every() 恒真、把 S2/S5 直接判成"已完成"、静默跳过
// requires 检查——但那不是"没人是它的产者"的诚实语义，decideReadiness 判定
// 循环里的 targetRole 本身必然是合法产者之一（见 readiness.mjs 里 mine 的构造
// 条件），空数组只是因为 roster 还没来得及记上正在被派的这个角色。该函数已经
// 改为把 targetRole 并入判定用的角色集合，不再单纯依赖 roster 是否已经记上它。
// 断言 H2/readiness 行为的测试不再需要靠显式传 roster 来绕开这个问题；已有
// 测试里仍然保留的显式传参，是为了隔离测试自己真正要盯的那件事，不是因为还
// 依赖这个绕法（见 tests/gate-readiness.test.mjs 与 tests/readiness.test.mjs
// 里对应测试的说明）。
export function makeRun({ runId = 'r1', stage = 'S2', artifacts = [], project = null, stages = null, roster = [] } = {}) {
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
      roster,
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
