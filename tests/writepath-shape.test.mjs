// H3 在 project.json 形状不对时怎么判（M3u，docs/29，全量审查第 10 条）。
//
// 此前只要 project.json 是个合法对象，调用者在 paths 里「没有键」就静默放行：paths 缺失、键名拼错、带插件
// 前缀、被删掉、run 进行中整份 project.json 不在，效果都一样——按角色隔离全开，不留痕迹。现在（控制文件与
// run 目录保护两段照旧在前）：
//   1. PM → 放行；2. 按设计不认领路径的角色（at-qa、at-acceptance）没有键 → 放行，不看 project.json 其余部分；
//   3. 花名册读坏 → 拒；4. 不在花名册里的调用者 → 放行（不归本插件管）；5. run 进行中 project.json 不在 → 拒；
//   6. paths 缺失或不是对象 → 拒；7. 调用者没有键 → 拒；8. 调用者自己的条目有阻断问题 → 拒，只拒它；
//   9. 其余照旧（认领了放行、别人的拒、没人认领拒），认领者查找只看合法的前缀。
// 每条拒绝理由都要说清拒在哪，并给执行角色一条够得着的出路（冒泡，由 PM 改 project.json 或重装插件）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideWritePath } from '../hooks/lib/writepath.mjs'
import { NO_PATHS_ROLES } from '../hooks/lib/project.mjs'
import { quote } from '../hooks/lib/trusted.mjs'
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

// ---- 5、6：没有整份判据时拒 NO_PATHS_ROLES 以外的执行角色（它们在第 2 步已经放行）----

test('run 进行中 project.json 不在：执行角色写 run 目录外被拒，理由说「不在」、给出 /agent-team:at-init', () => {
  assertConfigDeny(decide('at-backend', OWN, null), '不在', '/agent-team:at-init')
})

test('paths 缺失、为空串、为数组、为字符串：执行角色写 run 目录外被拒，理由说的是 paths 本身，不是「没有你的键」', () => {
  for (const paths of [undefined, '', [], ['src/server/'], 'src/', 0]) {
    const project = { ...TEMPLATE, paths }
    if (paths === undefined) delete project.paths
    const r = decide('at-backend', OWN, project)
    assertConfigDeny(r, paths === undefined ? 'paths 缺失' : `paths 不是对象（是 ${quote(paths)}）`)
    assert.ok(!r.reason.includes('的键'), r.reason)
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

test('调用者的键是 []：写 run 目录外被拒——[] 表示有意只写 run 目录；理由给出冒泡的出路', () => {
  const r = decide('at-product', '/proj/docs/product/x.md', withPaths({ ...TEMPLATE.paths, 'at-product': [] }))
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /冒泡/)
  assert.match(r.reason, /PM/)
})

// ---- 8：只拒持有问题条目的那个角色 ----

test('调用者自己的条目有阻断问题（不是数组、元素不是字符串、出根、认领整个根、带冒号）：拒，理由点名那条', () => {
  for (const [value, bad] of [
    ['src/server/', '"src/server/"'],
    [['src/server/', 5], '5'],
    [['../'], '"../"'],
    [[''], '""'],
    [['./'], '"./"'],
    [['src/a:b'], '"src/a:b"'],
  ]) {
    const r = decide('at-backend', OWN, withPaths({ ...TEMPLATE.paths, 'at-backend': value }))
    assertConfigDeny(r, 'paths["at-backend"]', bad)
  }
})

test('一条坏前缀让整个条目作废：自己其余合法的前缀也写不了——理由把这一点说出来，不让人读成「只有这条前缀失效」', () => {
  const r = decide('at-backend', OWN, withPaths({ ...TEMPLATE.paths, 'at-backend': ['src/server/', '../shared/'] }))
  assertConfigDeny(r, '"../shared/"', '其余合法的前缀')
  // 给执行角色的理由只说问题本身：「删掉这一条……收尾时告诉用户」是说给 PM 的，执行角色改不了 project.json、
  // 也见不到用户；它的出路是冒泡（assertConfigDeny 已经核了）。
  for (const k of ['删掉这一条', '收尾时告诉用户']) assert.ok(!r.reason.includes(k), `${k}：${r.reason}`)
})

test('配置问题的出路指向规则那一节，不叫用户重跑命令：括注里的节号与 /agent-team:at-init 里「划分路径归属」那一节对得上', () => {
  const md = readFileSync(new URL('../commands/at-init.md', import.meta.url), 'utf8')
  const n = (md.match(/^## (\d+)\. 划分路径归属/m) ?? [])[1]
  assert.ok(n, 'at-init.md 里找不到「划分路径归属」那一节')
  const r = decide('at-backend', OWN, withPaths({ ...TEMPLATE.paths, 'at-backend': ['../'] }))
  assert.ok(r.reason.includes(`规则见 /agent-team:at-init 第 ${n} 节`), r.reason)
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

test('认领者查找只看合法的前缀：别人条目里阻断的前缀（出根、认领整个根）不把「没人认领」说成「归它」', () => {
  for (const bad of [['../'], ['']]) {
    const r = decide('at-backend', '/proj/elsewhere/x.ts', withPaths({ ...TEMPLATE.paths, 'at-ios': bad }))
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /没有被任何角色认领/)
    assert.ok(!r.reason.includes('归 "at-ios"'), r.reason)
  }
  // 坏条目排在真主人前面时，归属也不被它抢走。
  const r = decide('at-backend', IOS, withPaths({ 'at-outsider': ['../'], ...TEMPLATE.paths }))
  assert.ok(r.reason.includes('归 "at-ios"'), r.reason)
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

test('at-qa、at-acceptance 建了键：就只能写这些前缀——validateProject「建了键它就只能写这些前缀」那句的判据', () => {
  for (const role of NO_PATHS_ROLES) {
    const project = withPaths({ ...TEMPLATE.paths, [role]: ['tests/'] })
    assert.equal(decide(role, '/proj/src/x.ts', project).decision, 'deny', role)
    assert.equal(decide(role, '/proj/tests/x.ts', project).decision, 'allow', role)
  }
})

// ---- 3、4：花名册 ----

test('花名册读坏（{}、[]、null、非空数组）：执行角色写 run 目录外被拒，理由指向 roster.json、给出重装的出路——不能落成「不在花名册里就放行」', () => {
  // 非空数组：Object.keys(['at-backend']) 是 ['0']，只查「非空」会把它当成有效花名册，第 4 步对全员放行。
  for (const roster of [{}, [], null, ['at-backend']]) {
    for (const path of [OWN, IOS, '/proj/CLAUDE.md']) {
      const r = decide('at-backend', path, TEMPLATE, roster)
      assert.equal(r.decision, 'deny', JSON.stringify(roster))
      assert.match(r.reason, /roster\.json/)
      assert.match(r.reason, /冒泡/)
      assert.match(r.reason, /重装|更新/)
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

test('没人认领：理由里带着调用者自己的前缀，并说明前缀按字面比较、不是通配符；出路是冒泡给上级，不是叫它自己改 project.json', () => {
  const r = decide('at-backend', '/proj/src/server/a.ts', withPaths({ ...TEMPLATE.paths, 'at-backend': ['src/**'] }))
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /没有被任何角色认领/)
  assert.ok(r.reason.includes('src/**'), r.reason)
  assert.match(r.reason, /通配符/)
  assert.match(r.reason, /冒泡/)
  assert.match(r.reason, /PM/)
  assert.ok(!r.reason.includes('再动它'), r.reason)
  // 没人认领也可能是这次调用越界了，不能把它说成「配置问题、不是这次调用的问题」（不拼 fixIt）。
  assert.ok(!r.reason.includes('这是配置问题'), r.reason)
  assert.ok(r.reason.includes('你写不了 project.json'), r.reason)
})

test('「这条路径归谁」只认 H3 会拿来判人的键：at-pm、__main__、拼错的键认领了也不说成「归它」', () => {
  const paths = { ...TEMPLATE.paths }
  delete paths['at-ios']
  const r = decide('at-backend', IOS, withPaths({ ...paths, 'at-pm': ['src/'], __main__: ['src/'], 'at-fronted': ['src/'] }))
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /没有被任何角色认领/)
  for (const k of ['at-pm', '__main__', 'at-fronted']) assert.ok(!r.reason.includes(`归 "${k}"`), `${k}：${r.reason}`)
})

test('「这条路径归谁」照认 H3 会判的键：建了键的 at-qa、at-acceptance 认领的路径归它们；at-outsider 也照说，引 PM 去改那个错键', () => {
  // 说成「没人认领」会把人引去扩 paths，而不是跨角色协调。
  for (const key of NO_PATHS_ROLES) {
    const r = decide('at-backend', '/proj/e2e/a.spec.ts', withPaths({ ...TEMPLATE.paths, [key]: ['e2e/'] }))
    assert.ok(r.decision === 'deny' && r.reason.includes(`归 "${key}"`), r.reason)
  }
  const paths = { ...TEMPLATE.paths }
  delete paths['at-ios']
  const r = decide('at-backend', IOS, withPaths({ ...paths, 'at-outsider': ['src/ios/'] }))
  assert.ok(r.reason.includes('"at-outsider"'), r.reason)
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
    for (const bad of ['{', '{}', '[]', '["at-backend"]']) {
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
        assert.match(d.permissionDecisionReason, /重装|更新/)
      }
      assert.equal(run('writepath', write('agent-team:at-pm', join(proj, 'dist', 'x.js')), gate, proj).stdout.trim(), '', bad)
    }
  } finally {
    rmSync(plugin, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  }
})

// ============================================================================ M4b（docs/36，审查第 21 条）

// 几个角色共列的根级文件（package.json 同时在 at-backend、at-frontend 名下）：第三个角色写它被拒时，理由要把认领者列全——
// 只点第一个，PM 会以为它只归一个角色，再补一轮「归 X」。只认 H3 会判人的键（at-pm、__main__、拼错的键不列）。
const SHARED = withPaths({
  ...TEMPLATE.paths,
  'at-backend': ['src/server/', 'package.json'],
  'at-frontend': ['src/web/', 'package.json'],
  'at-pm': ['package.json'],
  __main__: ['package.json'],
  'at-fronted': ['package.json'],
})

test('M4b 归谁：几个角色共列的文件，拒绝理由把认领者列全、每个各带引号；不列 at-pm、__main__、拼错的键', () => {
  const r = decide('at-ios', '/proj/package.json', SHARED)
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('"at-backend"') && r.reason.includes('"at-frontend"'), r.reason)
  for (const k of ['at-pm', '__main__', 'at-fronted']) assert.ok(!r.reason.includes(`"${k}"`), `${k}：${r.reason}`)
})

// 出路按调用者分：叶子执行角色（花名册里派不出任何人）要几个角色一起改的，由 PM 在 paths 里共列；协调者
// （at-architect、at-product）不拿这句——它的正路是派给认领者，照「列到你名下」做，PM 会把代码路径划给设计类角色。
test('M4b 归谁：叶子执行角色的出路是冒泡、由 PM 在 paths 里把它也列到你名下（你写不了 project.json）', () => {
  for (const role of ['at-ios', 'at-ui']) {
    const r = decide(role, '/proj/package.json', SHARED)
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /冒泡/)
    assert.ok(r.reason.includes('列到你名下'), `${role}：${r.reason}`)
    assert.ok(r.reason.includes('你写不了 project.json'), `${role}：${r.reason}`)
  }
})

test('M4b 归谁：协调者（at-architect、at-product）不拿「列到你名下」，拿「这是认领者的活」', () => {
  for (const role of ['at-architect', 'at-product']) {
    const r = decide(role, '/proj/package.json', SHARED)
    assert.equal(r.decision, 'deny')
    assert.ok(!r.reason.includes('列到你名下'), `${role}：${r.reason}`)
    assert.ok(r.reason.includes('认领者的活'), `${role}：${r.reason}`)
    // 第一轮复核：这句不看阶段——架构师在 S3 出方案时派不了 S5 的产者（H2 拒），正路是写进落盘清单；派不到的冒泡。
    assert.ok(r.reason.includes('落盘清单'), `${role}：${r.reason}`)
    assert.match(r.reason, /冒泡给派你的上级/)
  }
})

// 没人认领时，调用者自己的认领清单逐条引：整份数组只过一次 quote 会被截在 80 个字符，排在末尾的（正好是之后补进来的）
// 被截掉。空数组照说「只写 run 目录」。
test('M4b 没人认领：自己的认领清单逐条引，排在末尾的前缀也看得见；[] 说只写 run 目录', () => {
  const long = ['src/server/', 'src/shared/', 'package.json', 'package-lock.json', 'tsconfig.json', 'tests/']
  const r = decide('at-backend', '/proj/vite.config.ts', withPaths({ ...TEMPLATE.paths, 'at-backend': long }))
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /没有被任何角色认领/)
  for (const p of long) assert.ok(r.reason.includes(`"${p}"`), `${p}：${r.reason}`)
  const e = decide('at-product', '/proj/x.md', withPaths({ ...TEMPLATE.paths, 'at-product': [] }))
  assert.equal(e.decision, 'deny')
  assert.match(e.reason, /只写 run 目录/)
})

// ---- M4b 第一轮复核：出路的边角 ----

// 调用者是建了键的 at-qa、at-acceptance：它按设计不认领路径，叫 PM 再往这个错键上加前缀，与账本「不要给它建键」打架。
test('M4b 归谁：建了键的 at-qa 写别人的文件——出路是让 PM 删掉它的键，不是「列到你名下」', () => {
  const r = decide('at-qa', '/proj/package.json', withPaths({ ...SHARED.paths, 'at-qa': [] }))
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('不该有你的键'), r.reason)
  assert.ok(!r.reason.includes('列到你名下'), r.reason)
})

// 认领者是按设计不该有键的角色（at-outsider、at-qa、at-acceptance）：没有谁派得到 at-outsider，协调者不该被叫去「派给认领者」。
test('M4b 归谁：认领者是 at-outsider——点明它不该有键、冒泡给 PM 改配置，不叫协调者去派它', () => {
  const r = decide('at-architect', '/proj/scripts/x.sh', withPaths({ ...TEMPLATE.paths, 'at-outsider': ['scripts/'] }))
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('"at-outsider"') && r.reason.includes('不该有 paths 键'), r.reason)
  assert.ok(!r.reason.includes('分发它的那一段'), r.reason)
})

// 认领者自己的条目整条作废：派它去写，它在第 8 步又被拒——先说条目作废，不叫协调者派它。
test('M4b 归谁：认领者的条目整条作废——点明作废、先修 project.json，不叫协调者去派它', () => {
  const r = decide('at-architect', '/proj/src/web/a.ts', withPaths({ ...TEMPLATE.paths, 'at-frontend': ['src/web/', '../shared/'] }))
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('"at-frontend"') && r.reason.includes('整条作废'), r.reason)
  assert.ok(!r.reason.includes('分发它的那一段'), r.reason)
})

// 花名册读得出、调用者自己那一条坏了：判不出它是叶子还是协调者，不给「列到你名下」（那会把代码路径划给设计类角色）。
test('M4b 归谁：花名册里调用者那一条坏了——不给「列到你名下」，指向重装插件', () => {
  for (const broken of [null, {}, { can_delegate_to: 'at-backend' }]) {
    const r = decide('at-architect', '/proj/package.json', SHARED, { ...ROSTER, 'at-architect': broken })
    assert.equal(r.decision, 'deny')
    assert.ok(!r.reason.includes('列到你名下'), r.reason)
    assert.ok(r.reason.includes('roster.json'), r.reason)
  }
})

// 没人认领：自己条目里「要改」档的前缀（不可见格式字符、首尾空白）原样引出来，读着像「认领了却说没人认领」——把问题一并说出来。
test('M4b 没人认领：自己条目里有要改的前缀（零宽字符）——理由把问题说出来（写出码点）', () => {
  const zw = String.fromCharCode(0x200b)
  const r = decide('at-ios', '/proj/ios/a.swift', withPaths({ ...TEMPLATE.paths, 'at-ios': [`ios${zw}/`] }))
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /没有被任何角色认领/)
  assert.match(r.reason, /U\+200B/)
})
