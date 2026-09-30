// H3 在 project.json 形状不对时怎么判（M3u，docs/29，全量审查第 10 条）。
//
// 此前只要 project.json 是个合法对象，调用者在 paths 里「没有键」就静默放行：paths 缺失、键名拼错、带插件
// 前缀、被删掉、run 进行中整份 project.json 不在，效果都一样——按角色隔离全开，不留痕迹。现在（控制文件与
// run 目录保护两段照旧在前）：
//   1. PM → 放行；2. 按设计不认领路径的角色（at-qa、at-acceptance）没有键 → 放行，不看 project.json 其余部分；
//   3. 花名册读坏 → 拒；4. 不在花名册里的调用者 → 放行（不归本插件管）；5. run 进行中 project.json 不在 → 拒；
//   6. paths 缺失或不是对象 → 拒；7. 调用者没有键 → 拒；8. 调用者自己的条目有阻断问题 → 拒，只拒它；
//   9. 其余照旧（认领了放行、别人的拒、没人认领拒），认领者查找只看合法的前缀。
// 每条拒绝理由都要指向具体的配置问题，并给执行角色一条够得着的出路（冒泡，由 PM 改 project.json）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideWritePath } from '../hooks/lib/writepath.mjs'
import { NO_PATHS_ROLES } from '../hooks/lib/project.mjs'
import { run, decisionOf } from './helpers/gate-runner.mjs'

const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
const RUN = '/proj/.agent-team/runs/r1'
const AT = '/proj/.agent-team'
const STAGES = { S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] } }

const decide = (role, filePath, project, roster = ROSTER) =>
  decideWritePath({ role, filePath, project, runDir: RUN, stages: STAGES, agentTeamDir: AT, roster })
const withPaths = (paths) => ({ ...TEMPLATE, paths })
const OWN = '/proj/src/server/a.ts' // at-backend 自己的地盘
const IOS = '/proj/src/ios/x.swift' // 别人的地盘

// 配置问题的拒绝理由：指向 project.json、给出够得着的出路。
function assertConfigDeny(r, ...mustInclude) {
  assert.equal(r.decision, 'deny', JSON.stringify(r))
  assert.match(r.reason, /project\.json/)
  assert.match(r.reason, /冒泡/)
  for (const s of mustInclude) assert.ok(r.reason.includes(s), `${s}：${r.reason}`)
}

test('基线：模板配置下，执行角色写自己的地盘放行、写别人的拒', () => {
  assert.equal(decide('at-backend', OWN, TEMPLATE).decision, 'allow')
  assert.equal(decide('at-backend', IOS, TEMPLATE).decision, 'deny')
})

// ---- 5、6：没有整份判据时拒所有执行角色 ----

test('run 进行中 project.json 不在：执行角色写 run 目录外被拒，理由说「不在」、给出 /agent-team:at-init', () => {
  assertConfigDeny(decide('at-backend', OWN, null), '不在', '/agent-team:at-init')
})

test('paths 缺失、为空串、为数组、为字符串：执行角色写 run 目录外被拒', () => {
  for (const paths of [undefined, '', [], 'src/', 0]) {
    const project = { ...TEMPLATE, paths }
    if (paths === undefined) delete project.paths
    assertConfigDeny(decide('at-backend', OWN, project))
  }
})

// ---- 7：调用者没有键 ----

test('调用者在 paths 里没有键（被删、键名拼错、带插件前缀）：拒，理由点名它，附上认不出的键', () => {
  const paths = { ...TEMPLATE.paths }
  delete paths['at-frontend']
  const cases = [
    [paths, []],
    [{ ...paths, 'at-fronted': ['src/web/'] }, ['at-fronted']],
    [{ ...paths, 'agent-team:at-frontend': ['src/web/'] }, ['agent-team:at-frontend']],
  ]
  for (const [p, hints] of cases) {
    const r = decide('at-frontend', '/proj/src/web/App.tsx', withPaths(p))
    assertConfigDeny(r, 'at-frontend', ...hints)
  }
})

test('调用者的键是 []：写 run 目录外被拒——[] 表示有意只写 run 目录', () => {
  const r = decide('at-product', '/proj/docs/product/x.md', withPaths({ ...TEMPLATE.paths, 'at-product': [] }))
  assert.equal(r.decision, 'deny')
})

// ---- 8：只拒持有问题条目的那个角色 ----

test('调用者自己的条目有阻断问题（不是数组、元素不是字符串、出根、认领整个根、带冒号）：拒，理由点名那条', () => {
  for (const value of ['src/server/', ['src/server/', 5], ['../'], [''], ['./'], ['src/a:b']]) {
    const r = decide('at-backend', OWN, withPaths({ ...TEMPLATE.paths, 'at-backend': value }))
    assertConfigDeny(r, 'at-backend')
  }
})

test('别的角色的条目坏了、paths 里多了认不出的键：不影响其余角色写自己的地盘', () => {
  for (const extra of [
    { 'at-ios': '../' },
    { 'at-ios': ['../'] },
    { 'at-ios': [{ toString: 1 }] },
    { 'at-fronted': ['src/web/'] },
    { ' at-backend': ['x/'] },
    { _comment: 'hi' },
  ]) {
    const project = withPaths({ ...TEMPLATE.paths, ...extra })
    assert.equal(decide('at-backend', OWN, project).decision, 'allow', JSON.stringify(extra))
    // 认领者查找跳过坏条目：别人条目里的 {"toString":1} 不再让门禁崩掉。
    assert.doesNotThrow(() => decide('at-backend', '/proj/elsewhere/x.ts', project))
  }
})

// ---- 2：按设计不认领路径的角色 ----

test('at-qa、at-acceptance 没有键：不管 project.json 在不在、形状对不对，run 目录外都放行——它们的正文照此写', () => {
  for (const role of NO_PATHS_ROLES) {
    for (const project of [TEMPLATE, null, { ...TEMPLATE, paths: [] }, withPaths({ ...TEMPLATE.paths, 'at-ios': '../' })]) {
      assert.equal(decide(role, '/proj/tests/x.test.ts', project).decision, 'allow', `${role}：${JSON.stringify(project)?.slice(0, 60)}`)
    }
    // 花名册读坏也一样：它们的权限本来就不看花名册。
    assert.equal(decide(role, '/proj/tests/x.test.ts', TEMPLATE, {}).decision, 'allow')
  }
})

// ---- 3、4：花名册 ----

test('花名册读坏（{}、[]、null）：执行角色写 run 目录外被拒，理由指向 roster.json——不能落成「不在花名册里就放行」', () => {
  for (const roster of [{}, [], null]) {
    for (const path of [OWN, IOS, '/proj/CLAUDE.md']) {
      const r = decide('at-backend', path, TEMPLATE, roster)
      assert.equal(r.decision, 'deny', JSON.stringify(roster))
      assert.match(r.reason, /roster\.json/)
    }
  }
})

test('不在花名册里的调用者：不归本插件管，放行', () => {
  assert.equal(decide('some-other-plugin-agent', '/proj/anything.ts', TEMPLATE).decision, 'allow')
  assert.equal(decide('some-other-plugin-agent', '/proj/anything.ts', null).decision, 'allow')
})

test('at-outsider（在花名册里、没有键、不是按设计不认领路径的角色）：写 run 目录外被拒', () => {
  assert.equal(decide('at-outsider', '/proj/anything.ts', TEMPLATE).decision, 'deny')
})

// ---- 1：PM ----

test('PM 写 run 目录外：放行，不看 project.json——包括给 at-pm 错建了键的时候（那个键不起作用）', () => {
  for (const project of [TEMPLATE, null, { ...TEMPLATE, paths: [] }, withPaths({ ...TEMPLATE.paths, 'at-pm': ['docs/'] })]) {
    assert.equal(decide('at-pm', '/proj/dist/app.js', project).decision, 'allow')
  }
})

// ---- 9：没人认领时，理由说清调用者自己认领了什么 ----

test('没人认领：理由里带着调用者自己的前缀，并说明前缀按字面比较、不是通配符', () => {
  const r = decide('at-backend', '/proj/src/server/a.ts', withPaths({ ...TEMPLATE.paths, 'at-backend': ['src/**'] }))
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /没有被任何角色认领/)
  assert.ok(r.reason.includes('src/**'), r.reason)
  assert.match(r.reason, /通配符/)
})

// ---- 拒绝理由里的外部值只占一行（docs/27）----

test('键与前缀带换行字符：拒绝理由不另起一行', () => {
  const LS = String.fromCharCode(0x2028)
  for (const b of ['\n', LS]) {
    const project = withPaths({ ...TEMPLATE.paths, [`at-fronted${b}伪造`]: ['x/'], 'at-backend': [`..${b}/伪造`] })
    delete project.paths['at-frontend']
    for (const [role, path] of [['at-frontend', '/proj/src/web/a.ts'], ['at-backend', OWN]]) {
      const r = decide(role, path, project)
      assert.equal(r.decision, 'deny')
      assert.ok(!r.reason.includes(b), JSON.stringify(r.reason))
    }
  }
})

// ---- 门禁子进程：roster.json 真的读坏 ----
//
// gate.mjs 的 loadRoster 读坏时退回 {}。H3 若照「不在花名册里就不归我管」放行，就对所有人全开——这一条走真实
// 子进程，在插件副本上只把 roster.json 写坏（不碰仓库里的那份）。

test('门禁子进程：roster.json 读坏时，执行角色写 run 目录外被拒、理由指向 roster.json；PM 照旧放行', () => {
  const REPO = new URL('..', import.meta.url)
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-shape-plug-')))
  const proj = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-shape-proj-')))
  try {
    cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
    cpSync(new URL('stages.json', REPO), join(plugin, 'stages.json'))
    for (const bad of ['{', '{}', '[]']) {
      writeFileSync(join(plugin, 'roster.json'), bad)
      mkdirSync(join(proj, '.agent-team', 'runs', 'r1'), { recursive: true })
      writeFileSync(join(proj, '.agent-team', 'current-run'), 'r1')
      writeFileSync(join(proj, '.agent-team', 'runs', 'r1', 'state.json'), JSON.stringify({ run_id: 'r1', stage: 'S5', contract_sha: 'PENDING', roster: [], artifacts: {}, rework: {}, never_invoked: [], escalations: [], history: [{ stage: 'S5', at: 't' }] }))
      writeFileSync(join(proj, '.agent-team', 'project.json'), JSON.stringify(TEMPLATE))
      const write = (agent, fp) => ({ hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: agent, tool_input: { file_path: fp, content: 'x' } })
      const gate = join(plugin, 'hooks', 'boot.mjs')
      for (const fp of [join(proj, 'src', 'server', 'a.ts'), join(proj, 'src', 'ios', 'x.swift')]) {
        const d = decisionOf(run('writepath', write('agent-team:at-backend', fp), gate, proj).stdout)
        assert.equal(d?.permissionDecision, 'deny', `${bad} · ${fp}`)
        assert.match(d.permissionDecisionReason, /roster\.json/)
      }
      assert.equal(run('writepath', write('agent-team:at-pm', join(proj, 'dist', 'x.js')), gate, proj).stdout.trim(), '', bad)
    }
  } finally {
    rmSync(plugin, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  }
})
