// 第 45 条（docs/47，M4l）：发布工程——CHANGELOG.md 一版一行、最新的在最上面、最上面那一版就是 plugin.json 的版本；推 main、判据与版本检查都过了之后
// CI 按 plugin.json 的版本打 vX.Y.Z（已经有了就不动），推 tag 不再触发 CI；README 两半说清每一版改了什么写在哪。版本号往前挪时 CHANGELOG 有没有这一版，
// 由 scripts/check-version-bump.mjs 在推 main、向 main 提 PR 时核（tests/version-bump.test.mjs）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestChangelogVersion } from '../scripts/lib/version-bump.mjs'
import { firstCommitPerVersion, planTags } from '../scripts/lib/release.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const NL = String.fromCharCode(10)
const VERSION = JSON.parse(read('.claude-plugin/plugin.json')).version
const LINE_RE = /^- (\d+)\.(\d+)\.(\d+)：(.+)$/

test('第 45 条：CHANGELOG.md 最上面那一版就是 plugin.json 的版本', () => {
  assert.equal(latestChangelogVersion(read('CHANGELOG.md')), VERSION)
})

test('第 45 条：CHANGELOG.md 一版一行——每一行「- x.y.z：…」，版本不重复、从新到旧排，冒号后面有话；别的「- 」开头的行不许混进来', () => {
  const lines = read('CHANGELOG.md').split('\n').filter((l) => l.startsWith('- '))
  assert.ok(lines.length > 0)
  const seen = new Set()
  let prev = null
  for (const l of lines) {
    const m = LINE_RE.exec(l)
    assert.ok(m, `不是「- x.y.z：…」：${l}`)
    const v = [Number(m[1]), Number(m[2]), Number(m[3])]
    const key = v.join('.')
    assert.ok(!seen.has(key), `重复：${key}`)
    seen.add(key)
    if (prev) assert.ok(prev[0] > v[0] || (prev[0] === v[0] && (prev[1] > v[1] || (prev[1] === v[1] && prev[2] > v[2]))), `没有从新到旧：${prev.join('.')} 之后是 ${key}`)
    assert.ok(m[4].trim().length > 0)
    prev = v
  }
})

test('第 45 条：CI 推 main 之后打 tag——只在推 main 上、判据与版本检查都过了之后、按 plugin.json 的版本、已经有了就不动；只有这个作业有写权限', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = ci.slice(ci.indexOf('\n  tag:'))
  assert.ok(ci.includes('\n  tag:'), 'ci.yml 没有 tag 作业')
  assert.ok(job.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'"), job.slice(0, 400))
  assert.ok(/needs:\s*\[test, version-bump\]/.test(job), 'tag 作业要等 test 与 version-bump 都过')
  assert.ok(/permissions:\s*\n\s+contents: write/.test(job), 'tag 作业要有 contents: write')
  assert.ok(job.includes('node scripts/tag-release.mjs --push'), 'tag 作业跑 scripts/tag-release.mjs（认法与补打都在脚本里，下面在临时仓库里测）')
  assert.ok(/^permissions:\s*\n\s+contents: read/m.test(ci), '工作流默认只读')
})

test('第 45 条：推 tag 不触发 ci、min-node——push 只认分支', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/min-node.yml']) {
    const y = read(f)
    assert.ok(/\non:\n  push:\n    branches: \['\*\*'\]\n/.test(y), `${f} 的 push 要写 branches: ['**']（不写就连推 tag 也触发）`)
  }
})

test('第 45 条：README 两半说清每一版改了什么写在 CHANGELOG.md、每一版有对应的 tag', () => {
  const r = read('README.md')
  const half = r.indexOf('<a id="english"></a>')
  assert.ok(r.slice(0, half).includes('每一版改了什么写在 [CHANGELOG.md](CHANGELOG.md)，每一版都打了对应的 tag（`v` 加版本号）。'), '中文半')
  assert.ok(r.slice(half).includes('What changed in each version is in [CHANGELOG.md](CHANGELOG.md), and every version has a matching tag (`v` plus the version number).'), '英文半')
})

// ---- 复核修订：打 tag 的认法与补打（scripts/tag-release.mjs）----

test('M4l 复核 firstCommitPerVersion：每一版取 first-parent 历史上第一次是它的提交；读不出、不是 x.y.z 的跳过', () => {
  const e = [
    { sha: 'a', version: '0.0.1' },
    { sha: 'b', version: '0.0.1' },
    { sha: 'c', version: null },
    { sha: 'd', version: '0.1.0' },
    { sha: 'e', version: '0.1.0-wip' },
    { sha: 'f', version: '0.0.1' },
  ]
  assert.deepEqual(firstCommitPerVersion(e), [{ version: '0.0.1', sha: 'a' }, { version: '0.1.0', sha: 'd' }])
})

test('M4l 复核 planTags：远端没有的要打；远端有、指向同一个提交的不动；指向别处的是冲突（不挪已有的 tag）', () => {
  const wanted = [{ version: '0.0.1', sha: 'a' }, { version: '0.1.0', sha: 'd' }, { version: '0.2.0', sha: 'g' }]
  const remote = new Map([['v0.0.1', 'a'], ['v0.1.0', 'x']])
  assert.deepEqual(planTags(wanted, remote), { create: [{ tag: 'v0.2.0', sha: 'g' }], conflicts: [{ tag: 'v0.1.0', want: 'd', have: 'x' }] })
})

const TAG_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'tag-release.mjs')

function withRemote(body) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-tag-')))
  const bare = join(root, 'remote.git')
  const dir = join(root, 'work')
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    mkdirSync(bare)
    git(bare, 'init', '-q', '--bare')
    mkdirSync(dir)
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 't@example.com')
    git(dir, 'config', 'user.name', 't')
    git(dir, 'remote', 'add', 'origin', bare)
    const manifest = (version) => {
      mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
      writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'x', version }))
    }
    const commit = (msg) => {
      git(dir, 'add', '-A')
      git(dir, 'commit', '-q', '-m', msg)
      return git(dir, 'rev-parse', 'HEAD')
    }
    const tags = () => {
      const m = new Map()
      for (const line of git(dir, 'ls-remote', '--tags', 'origin').split(NL).filter(Boolean)) {
        const [sha, ref] = line.split(String.fromCharCode(9))
        const name = ref.replace('refs/tags/', '')
        if (name.endsWith('^{}')) m.set(name.slice(0, -3), sha)
        else if (!m.has(name)) m.set(name, sha)
      }
      return m
    }
    const run = (...args) => spawnSync(process.execPath, [TAG_CLI, ...(args.length ? args : ['--push'])], { cwd: dir, encoding: 'utf8' })
    body({ dir, git: (...a) => git(dir, ...a), manifest, commit, tags, run, write: (rel, t) => writeFileSync(join(dir, rel), t) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('M4l 复核 tag-release：按 main 的 first-parent 历史补打每一版（合并进来的打在合并提交上）、一次推完；再跑一次不动；远端已有指向别处的不挪、退出码 1', () => {
  withRemote(({ git, manifest, commit, tags, run, write }) => {
    manifest('0.0.0')
    const c0 = commit('zero')
    manifest('0.0.1')
    const c1 = commit('base')
    write('README.md', 'x' + NL)
    commit('docs only')
    git('checkout', '-q', '-b', 'feature')
    manifest('0.0.2')
    commit('bump on branch')
    git('checkout', '-q', 'main')
    git('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature')
    const merge = git('rev-parse', 'HEAD')
    git('push', '-q', 'origin', 'main')
    // 远端已有一个附注 tag、指向对的提交：ls-remote 给的是 tag 对象，剥开之后才是提交——认得出、不当冲突；它之后缺的旧版（不只是最新那一版）都补上。
    git('tag', '-a', 'v0.0.0', '-m', 'annotated', c0)
    git('push', '-q', 'origin', 'refs/tags/v0.0.0')
    // 不带 --push：只列出要打什么，本地不建 tag、远端不动（M4m）。
    const dry = run('--dry-run')
    assert.equal(dry.status, 0, dry.stdout + dry.stderr)
    assert.ok(dry.stdout.includes('要打 v0.0.1') && dry.stdout.includes('要打 v0.0.2'), dry.stdout)
    assert.equal(git('tag', '--list', 'v0.0.1'), '', '空跑不建本地 tag')
    assert.equal(tags().get('v0.0.1'), undefined, '空跑不推')
    const first = run()
    assert.equal(first.status, 0, first.stdout + first.stderr)
    const t = tags()
    assert.equal(t.get('v0.0.1'), c1)
    assert.equal(t.get('v0.0.2'), merge, '合并进来的一版打在 main 上的合并提交上')
    const again = run()
    assert.equal(again.status, 0, again.stdout + again.stderr)
    assert.ok(again.stdout.includes('没有要补的 tag'), again.stdout)
    manifest('0.0.3')
    commit('next')
    git('tag', 'v0.0.3', c1)
    git('push', '-q', 'origin', 'refs/tags/v0.0.3')
    const clash = run()
    assert.equal(clash.status, 1, clash.stdout + clash.stderr)
    assert.ok(clash.stdout.includes('v0.0.3'), clash.stdout)
  })
})
