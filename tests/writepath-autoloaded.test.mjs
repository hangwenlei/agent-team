// 认领一个目录不连带它下面那几类位置（docs/53，M4r；docs/41 §4 登记的「有键的角色在自己前缀下写嵌套的 CLAUDE.md、.claude/」那一格）：
// 子目录里的 CLAUDE.md、CLAUDE.local.md（Claude Code 在那个目录下干活时当成指令加载）、.claude（skill、命令与设置）、.git（git 当成仓库，
// hook 会被执行）、.agent-team（门禁按离得最近的认项目根，嵌套一个就换掉了判据）。原来认领了 src/server/，就能在它下面新建这些，H3 放行。
// 现在 H3 判前缀之下新出现的那一截：落在这几类上就拒；前缀本身写明了它的（用户在 S4 照 sensitive 批过）照放行。名字不分大小写比。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { decideWritePath } from '../hooks/lib/writepath.mjs'
import { entryProblems } from '../hooks/lib/project.mjs'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const RUN = '/proj/.agent-team/runs/r1'
const AT = '/proj/.agent-team'
const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S5: { role: 'at-backend', producers: ['at-backend', 'at-frontend'], requires: [], produces: ['05-impl/<role>.md'] },
  S6: { role: 'at-qa', requires: [], produces: ['06-test.md'] },
}
const PROJECT = {
  paths: {
    'at-backend': ['src/server/', 'src/shared'],
    'at-frontend': ['src/web/', 'src/web/CLAUDE.md', 'src/web/.claude/', '.claude/', 'tools/.git/'],
    'at-architect': ['docs/'],
  },
}
const call = (role, filePath, project = PROJECT) =>
  decideWritePath({ roster: ROSTER, role, filePath, project, runDir: RUN, stages: STAGES, agentTeamDir: AT })
const WAY = '冒泡给派你的上级，由 PM 先问用户、在 .agent-team/project.json 的 paths 里把这个文件或目录本身写进你名下（你写不了 project.json）'

test('认领的目录下新建 CLAUDE.md、CLAUDE.local.md——拒，说清它会被当成指令加载、出路是 PM 问过用户把它本身写进 paths；不分大小写', () => {
  for (const f of ['/proj/src/server/CLAUDE.md', '/proj/src/server/api/claude.md', '/proj/src/server/CLAUDE.local.md', '/proj/src/shared/Claude.Md']) {
    const r = call('at-backend', f)
    assert.equal(r.decision, 'deny', f)
    assert.ok(r.reason.includes('当成指令加载') && r.reason.includes(WAY), r.reason)
  }
  assert.ok(call('at-backend', '/proj/src/server/CLAUDE.md').reason.includes('这是一份 CLAUDE.md'))
  assert.ok(call('at-backend', '/proj/src/server/CLAUDE.local.md').reason.includes('这是一份 CLAUDE.local.md'))
})

test('认领的目录下的 .claude、.git（目录或文件）、.agent-team——拒，各说各的后果；.agent-team 不划给任何角色，不给「写进你名下」', () => {
  const cases = [
    ['/proj/src/server/.claude/skills/x/SKILL.md', '.claude 目录里', WAY],
    ['/proj/src/server/.CLAUDE/settings.json', '.claude 目录里', WAY],
    ['/proj/src/server/.git/hooks/pre-commit', 'hook 会被执行', WAY],
    ['/proj/src/server/vendor/.git', 'hook 会被执行', WAY],
    ['/proj/src/server/.agent-team/project.json', '另一个项目的根', '门禁不把它划给任何角色：别建它，冒泡给派你的上级。'],
  ]
  for (const [f, says, way] of cases) {
    const r = call('at-backend', f)
    assert.equal(r.decision, 'deny', f)
    assert.ok(r.reason.includes(says) && r.reason.includes(way), `${f}：${r.reason}`)
  }
  assert.ok(!call('at-backend', '/proj/src/server/.agent-team/project.json').reason.includes('写进你名下'))
})

test('名字只差一点的照常放行：.gitignore、.github、.claudeignore、CLAUDE.md.bak、my.git、claude.mdx', () => {
  for (const f of [
    '/proj/src/server/app.ts',
    '/proj/src/server/.gitignore',
    '/proj/src/server/.github/workflows/ci.yml',
    '/proj/src/server/.claudeignore',
    '/proj/src/server/CLAUDE.md.bak',
    '/proj/src/server/my.git/x',
    '/proj/src/server/docs/claude.mdx',
    // 段名正好是普通对象继承来的键：按段名查表不能查到它们。
    '/proj/src/server/constructor/toString.js',
    '/proj/src/server/__proto__/hasOwnProperty',
  ]) {
    assert.equal(call('at-backend', f).decision, 'allow', f)
  }
})

test('前缀本身写明了的照放行（用户在 S4 批过）：单个文件 src/web/CLAUDE.md、目录 .claude/、tools/.git/；写明的那一截之下再出现的照拒', () => {
  assert.equal(call('at-frontend', '/proj/src/web/CLAUDE.md').decision, 'allow')
  assert.equal(call('at-frontend', '/proj/.claude/commands/x.md').decision, 'allow')
  assert.equal(call('at-frontend', '/proj/tools/.git/hooks/pre-push').decision, 'allow')
  // 两条前缀都盖得住：宽的 src/web/ 之下那一截带着 .claude，窄的 src/web/.claude/ 写明了它——有一条干净就放行。
  assert.equal(call('at-frontend', '/proj/src/web/.claude/skills/a.md').decision, 'allow')
  // 写明的是 src/web/ 下那一份 CLAUDE.md，不连带更深一层的。
  assert.equal(call('at-frontend', '/proj/src/web/pages/CLAUDE.md').decision, 'deny')
  // 写明了 .claude/，它里面的 CLAUDE.md 是又一处会被加载的指令，没写明。
  assert.equal(call('at-frontend', '/proj/.claude/CLAUDE.md').decision, 'deny')
  // 没带结尾斜杠的目录前缀同样认。
  assert.equal(call('at-backend', '/proj/src/shared/CLAUDE.md').decision, 'deny')
  assert.equal(call('at-backend', '/proj/src/shared/util.ts').decision, 'allow')
})

test('协调者的认领同样不连带；项目经理、主线程不受 paths 管，照旧放行', () => {
  assert.equal(call('at-architect', '/proj/docs/CLAUDE.md').decision, 'deny')
  assert.equal(call('at-architect', '/proj/docs/arch.md').decision, 'allow')
  assert.equal(call('at-pm', '/proj/src/server/CLAUDE.md').decision, 'allow')
  assert.equal(call('__main__', '/proj/src/server/.claude/x.md').decision, 'allow')
})

test('建了键的 at-qa 在自己前缀下写这几类——拒，照它那一格的说法（不说怎么开口子）；前缀下的普通文件照旧放行', () => {
  const project = { paths: { ...PROJECT.paths, 'at-qa': ['tests/'] } }
  assert.equal(call('at-qa', '/proj/tests/a.test.ts', project).decision, 'allow')
  const r = call('at-qa', '/proj/tests/CLAUDE.md', project)
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('你不写 run 目录之外的文件'), r.reason)
  assert.ok(!r.reason.includes('写进你名下'), r.reason)
})

test('复核（docs/53 §8，中 1）：.agent-team 不认「写明了」——写明认领了嵌套的、或者项目根下的 .agent-team，照样拒；project.json 对任何深度的都报', () => {
  const project = { paths: { 'at-backend': ['src/server/', 'src/server/.agent-team/', '.agent-team/'] } }
  for (const f of ['/proj/src/server/.agent-team/project.json', '/proj/.agent-team/notes.md']) {
    const r = call('at-backend', f, project)
    assert.equal(r.decision, 'deny', f)
    assert.ok(r.reason.includes('门禁不把它划给任何角色'), r.reason)
  }
  assert.equal(call('at-backend', '/proj/src/server/a.ts', project).decision, 'allow')
  const nested = entryProblems('at-backend', ['src/server/.agent-team/'])
  assert.ok(nested.fix.some((m) => m.includes('嵌套的 .agent-team')), JSON.stringify(nested))
  const rootOne = entryProblems('at-backend', ['.agent-team/'])
  assert.ok(rootOne.fix.some((m) => m.includes('那里的控制文件不走角色认领')), JSON.stringify(rootOne))
})

test('复核（docs/53 §8，低）：前缀带 .. 也按解析后的位置判——写明了与没写明照样分得开', () => {
  const project = { paths: { 'at-backend': ['src/x/../server/', 'src/x/../server/docs/CLAUDE.md'] } }
  assert.equal(call('at-backend', '/proj/src/server/CLAUDE.md', project).decision, 'deny')
  assert.equal(call('at-backend', '/proj/src/server/docs/CLAUDE.md', project).decision, 'allow')
  assert.equal(call('at-backend', '/proj/src/server/a.ts', project).decision, 'allow')
})

test('复核（docs/53 §8，低）：它已经写明划给了别的角色——说归谁、经上级协调，不给「写进你名下」', () => {
  const project = { paths: { 'at-backend': ['src/'], 'at-frontend': ['src/web/', 'src/web/CLAUDE.md'] } }
  const r = call('at-backend', '/proj/src/web/CLAUDE.md', project)
  assert.equal(r.decision, 'deny')
  assert.ok(r.reason.includes('它已经写明划给了 "at-frontend"') && r.reason.includes('冒泡给派你的上级'), r.reason)
  assert.ok(!r.reason.includes('写进你名下'), r.reason)
  // 没写明的那一方不算归它：at-frontend 的 src/web/ 之下那一截带着 CLAUDE.md。
  const other = call('at-backend', '/proj/src/web/pages/CLAUDE.md', project)
  assert.ok(other.reason.includes('写进你名下') && !other.reason.includes('写明划给了'), other.reason)
})

test('/agent-team:at 的 S4：执行角色为这几处冒泡上来的，.agent-team 一律不补，别的照 sensitive 先问用户、把它本身补进名下', () => {
  const at = readFileSync(new URL('../commands/at.md', import.meta.url), 'utf8').replace(/\s+/g, '')
  const k =
    '门禁不让认领一个目录连带它下面的 `CLAUDE.md`、`CLAUDE.local.md`、`.claude`、`.git`、`.agent-team`：执行角色为这几处冒泡上来的，' +
    '`.agent-team` 一律不补，别的同样照 `sensitive` 先问用户，批了就把那个文件或目录本身补进它名下。'
  assert.ok(at.includes(k.replace(/\s+/g, '')), `commands/at.md 缺「${k}」`)
})

test('子进程：执行角色经门禁写自己认领目录下的 CLAUDE.md 被拒、写普通文件放行', () => {
  const dirs = makeRun({ runId: 'r1', project: { paths: { 'at-backend': ['src/server/'] } } })
  try {
    const write = (file) => ({ tool_name: 'Write', agent_type: 'agent-team:at-backend', tool_input: { file_path: file, content: 'x' } })
    const denied = decisionOf(run('writepath', write(join(dirs.projectDir, 'src', 'server', 'CLAUDE.md')), undefined, dirs.projectDir).stdout)
    assert.equal(denied?.permissionDecision, 'deny')
    assert.ok(denied.permissionDecisionReason.includes('当成指令加载'), denied.permissionDecisionReason)
    const ok = run('writepath', write(join(dirs.projectDir, 'src', 'server', 'api.ts')), undefined, dirs.projectDir)
    assert.equal(ok.stdout.trim(), '')
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})
