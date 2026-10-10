// 全量审查第 45 条剩下的「没有 GitHub Release」（docs/52，M4q）：CI 的 tag 作业打完 tag 之后，给 3.3.1 起、还没有 Release 的各版建一条 GitHub Release
// ——认法与打 tag 同一份（每一版的 tag 打在 main 的 first-parent 历史上 plugin.json 第一次是它的提交）：tag 不在远端、或者在远端指向的不是那个提交，
// 不建（建 Release 时 tag 不在，GitHub 会在默认分支的 HEAD 上新打一个）；已有就不动；正文是 CHANGELOG.md 里这一版那一行；是不是「最新」按版本号比
// 远端已标的最新那一条。3.3.1 之前的各版不补（有意）。API 经注入的 fetch（CLI 那几条经 --import 预载的假 fetch），这里不碰网络。
// 复核（docs/52 §8）：tag 冲突时不建；CLI 读到环境变量之后那条路、CI 那一步不吞错、一次推进好几版时都建，都配了判据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { changelogEntry } from '../scripts/lib/version-bump.mjs'
import { RELEASE_FLOOR, ensureRelease, releaseTargets } from '../scripts/lib/release.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_CLI = join(ROOT, 'scripts', 'github-release.mjs')
const FAKE_FETCH = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'fake-github-fetch.mjs')).href
const runCli = (args, opts) => spawnSync(process.execPath, [...args, RELEASE_CLI], { encoding: 'utf8', ...opts })
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/).join('\n')
const CHANGELOG = '# 更新记录\n\n- 3.3.10：第十个补丁\n- 3.3.1：推 main 之后发这一版的 GitHub Release\n- 3.3.0：漏切指针时回传【指针】\n'
const REPO = 'hangwenlei/agent-team'
const API = 'https://api.github.com'
const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

// 假的 fetch：按「方法 路径」查表回状态与 JSON，记下每一次调用。表里没有的回 404。
function fakeFetch(routes) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const path = String(url).startsWith(API) ? String(url).slice(API.length) : String(url)
    calls.push({ method, path, headers: init.headers ?? {}, body: init.body === undefined ? undefined : JSON.parse(init.body) })
    const hit = routes[`${method} ${path}`]
    const [status, json] = hit ?? [404, { message: 'Not Found' }]
    return { status, ok: status >= 200 && status < 300, json: async () => json }
  }
  return { fetch, calls }
}
const TAG_REF = 'GET /repos/hangwenlei/agent-team/git/ref/tags/v3.3.1'
const TAG_OK = { [TAG_REF]: [200, { ref: 'refs/tags/v3.3.1', object: { sha: SHA, type: 'commit' } }] }
const CREATE = { 'POST /repos/hangwenlei/agent-team/releases': [201, {}] }
const run = (routes, over = {}) => {
  const f = fakeFetch(routes)
  return ensureRelease({ fetch: f.fetch, repo: REPO, token: 'T0KEN', version: '3.3.1', expectedSha: SHA, changelog: CHANGELOG, ...over }).then((r) => ({ ...r, calls: f.calls }))
}
const posts = (calls) => calls.filter((c) => c.method === 'POST')

test('changelogEntry：取这一版那一行冒号后面的话；版本号按整段比（3.3.1 不认 3.3.10 那一行）；没有、不是 x.y.z 的给 null', () => {
  assert.equal(changelogEntry(CHANGELOG, '3.3.1'), '推 main 之后发这一版的 GitHub Release')
  assert.equal(changelogEntry(CHANGELOG, '3.3.10'), '第十个补丁')
  assert.equal(changelogEntry(CHANGELOG, '3.3.2'), null)
  assert.equal(changelogEntry(CHANGELOG, '3.3'), null)
  assert.equal(changelogEntry(CHANGELOG.split('\n').join('\r\n'), '3.3.0'), '漏切指针时回传【指针】')
  assert.equal(changelogEntry(null, '3.3.1'), null)
})

test('releaseTargets：3.3.1 起的各版、按版本号从低到高（按数比）；更早的、不是 x.y.z 的不要', () => {
  assert.equal(RELEASE_FLOOR, '3.3.1')
  const wanted = [
    { version: '3.2.0', sha: '1' },
    { version: '3.3.0', sha: '2' },
    { version: '3.3.10', sha: '5' },
    { version: '3.3.1', sha: '3' },
    { version: '3.3.9', sha: '4' },
    { version: 'x', sha: '6' },
    { version: '4.0.0', sha: '7' },
  ]
  assert.deepEqual(releaseTargets(wanted).map((w) => w.version), ['3.3.1', '3.3.9', '3.3.10', '4.0.0'])
  assert.deepEqual(releaseTargets(null), [])
})

test('ensureRelease：tag 在远端、指着认法要的提交、还没有 Release、远端还没标最新——建一条：名字是 tag，正文是 CHANGELOG 那一行，标成最新；带上令牌与 API 版本头', async () => {
  const r = await run({ ...TAG_OK, ...CREATE })
  assert.equal(r.ok, true, r.lines.join('\n'))
  const p = posts(r.calls)
  assert.equal(p.length, 1)
  assert.equal(p[0].path, '/repos/hangwenlei/agent-team/releases')
  // 请求体整份核：不带 target_commitish（tag 已经在远端，Release 跟着它；带上就可能指向别处）。
  assert.deepEqual(p[0].body, { tag_name: 'v3.3.1', name: 'v3.3.1', body: '推 main 之后发这一版的 GitHub Release', draft: false, prerelease: false, make_latest: 'true' })
  for (const c of r.calls) {
    assert.equal(c.headers.Authorization, 'Bearer T0KEN')
    assert.equal(c.headers.Accept, 'application/vnd.github+json')
    assert.equal(c.headers['X-GitHub-Api-Version'], '2022-11-28')
    assert.ok(typeof c.headers['User-Agent'] === 'string' && c.headers['User-Agent'].length > 0)
  }
  assert.ok(r.lines.some((l) => l.includes('v3.3.1')), r.lines.join('\n'))
})

test('ensureRelease：这一版的 Release 已经有了——不动，算成功（作业重跑时不重复建）', async () => {
  const r = await run({ ...TAG_OK, 'GET /repos/hangwenlei/agent-team/releases/tags/v3.3.1': [200, { id: 1 }] })
  assert.equal(r.ok, true)
  assert.equal(posts(r.calls).length, 0)
})

test('ensureRelease：tag 不在远端——不建（GitHub 会在默认分支的 HEAD 上新打一个），算失败；连 Release 都不去查', async () => {
  const r = await run({})
  assert.equal(r.ok, false)
  assert.equal(posts(r.calls).length, 0)
  assert.deepEqual(r.calls.map((c) => c.path), ['/repos/hangwenlei/agent-team/git/ref/tags/v3.3.1'])
  assert.ok(r.lines.join('\n').includes('tag'), r.lines.join('\n'))
})

test('ensureRelease（复核 docs/52 §8，中 1）：tag 在远端却指向别的提交——不建，说出两头；附注 tag 剥开之后再比', async () => {
  const wrong = await run({ [TAG_REF]: [200, { object: { sha: OTHER, type: 'commit' } }], ...CREATE })
  assert.equal(wrong.ok, false)
  assert.equal(posts(wrong.calls).length, 0)
  assert.ok(wrong.lines.join('\n').includes(OTHER) && wrong.lines.join('\n').includes(SHA), wrong.lines.join('\n'))
  const TAGOBJ = 'c'.repeat(40)
  const annotated = { [TAG_REF]: [200, { object: { sha: TAGOBJ, type: 'tag' } }], ...CREATE }
  const ok = await run({ ...annotated, [`GET /repos/hangwenlei/agent-team/git/tags/${TAGOBJ}`]: [200, { object: { sha: SHA, type: 'commit' } }] })
  assert.equal(ok.ok, true, ok.lines.join('\n'))
  assert.equal(posts(ok.calls).length, 1)
  const elsewhere = await run({ ...annotated, [`GET /repos/hangwenlei/agent-team/git/tags/${TAGOBJ}`]: [200, { object: { sha: OTHER, type: 'commit' } }] })
  assert.equal(elsewhere.ok, false)
  assert.equal(posts(elsewhere.calls).length, 0)
  const peelFails = await run(annotated)
  assert.equal(peelFails.ok, false)
  assert.equal(posts(peelFails.calls).length, 0)
  assert.ok(/\b404\b/.test(peelFails.lines.join('\n')), '剥不开时说回的是什么：' + peelFails.lines.join('\n'))
  const shapeless = await run({ [TAG_REF]: [200, {}], ...CREATE })
  assert.equal(shapeless.ok, false)
  assert.equal(posts(shapeless.calls).length, 0)
})

test('ensureRelease：远端标着的最新一条版本更高——这一条建出来不抢「最新」；更低、或者认不出版本号的，照常标最新', async () => {
  const latest = (tagName) => ({ 'GET /repos/hangwenlei/agent-team/releases/latest': [200, { tag_name: tagName }] })
  const newer = await run({ ...TAG_OK, ...CREATE, ...latest('v3.4.0') })
  assert.equal(posts(newer.calls)[0].body.make_latest, 'false')
  const patchNewer = await run({ ...TAG_OK, ...CREATE, ...latest('v3.3.10') })
  assert.equal(posts(patchNewer.calls)[0].body.make_latest, 'false', '按数比，不按字符串比')
  const older = await run({ ...TAG_OK, ...CREATE, ...latest('v3.3.0') })
  assert.equal(posts(older.calls)[0].body.make_latest, 'true')
  for (const odd of ['nightly', 'v9.9.9-rc1']) {
    const r = await run({ ...TAG_OK, ...CREATE, ...latest(odd) })
    assert.equal(posts(r.calls)[0].body.make_latest, 'true', odd)
  }
  // 按字符串比时 "v3.3.9" 排在 "v3.3.10" 后面——这一格只有按数比才对。
  const tens = await run(
    { 'GET /repos/hangwenlei/agent-team/git/ref/tags/v3.3.10': [200, { object: { sha: SHA, type: 'commit' } }], ...CREATE, ...latest('v3.3.9') },
    { version: '3.3.10' },
  )
  assert.equal(posts(tens.calls)[0].body.make_latest, 'true')
})

test('ensureRelease：CHANGELOG 里没有这一版、版本号不是 x.y.z、不知道 tag 该在哪个提交、仓库名或令牌是空的——不调 API，算失败', async () => {
  for (const over of [{ version: '3.3.2' }, { version: '3.3' }, { expectedSha: undefined }, { expectedSha: 'HEAD' }, { repo: '' }, { token: '' }]) {
    const r = await run({ ...TAG_OK }, over)
    assert.equal(r.ok, false, JSON.stringify(over))
    assert.equal(r.calls.length, 0, JSON.stringify(over))
  }
})

test('ensureRelease：API 出错——查 tag、查 Release、查最新、建，哪一步回的不是预期的状态都算失败、不往下走；fetch 抛异常也一样', async () => {
  const cases = [
    { [TAG_REF]: [500, {}] },
    { ...TAG_OK, 'GET /repos/hangwenlei/agent-team/releases/tags/v3.3.1': [500, {}] },
    { ...TAG_OK, 'GET /repos/hangwenlei/agent-team/releases/latest': [403, {}] },
    { ...TAG_OK, 'POST /repos/hangwenlei/agent-team/releases': [422, { message: 'Validation Failed' }] },
  ]
  for (const routes of cases) {
    const r = await run(routes)
    assert.equal(r.ok, false, JSON.stringify(routes))
    assert.ok(posts(r.calls).length <= 1, JSON.stringify(routes))
    assert.ok(r.lines.some((l) => /\b(500|403|422)\b/.test(l)), r.lines.join('\n'))
  }
  for (const at of [0, 1, 2, 3]) {
    let n = at
    const throwing = async (url, init) => {
      if (n-- === 0) throw new Error('网络断了')
      return fakeFetch({ ...TAG_OK }).fetch(url, init)
    }
    const r = await ensureRelease({ fetch: throwing, repo: REPO, token: 'T0KEN', version: '3.3.1', expectedSha: SHA, changelog: CHANGELOG })
    assert.equal(r.ok, false)
    assert.ok(r.lines.join('\n').includes('网络断了'), r.lines.join('\n'))
  }
})

const cleanEnv = () => {
  const env = { ...process.env }
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_REPOSITORY', 'FAKE_GITHUB_ROUTES', 'FAKE_GITHUB_LOG']) delete env[k]
  return env
}

test('github-release CLI：缺 GITHUB_TOKEN 或 GITHUB_REPOSITORY——不碰网络，退出码 1，说清这个脚本在 CI 的 tag 作业里跑', () => {
  for (const extra of [{}, { GITHUB_REPOSITORY: REPO }, { GITHUB_TOKEN: 'x' }, { GH_TOKEN: 'x', GITHUB_REPOSITORY: REPO }]) {
    const r = runCli([], { cwd: ROOT, env: { ...cleanEnv(), ...extra } })
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.ok(r.stdout.includes('GITHUB_TOKEN') && r.stdout.includes('tag 作业'), r.stdout)
    assert.equal(r.stdout.trim().split(/\r?\n/).length, 1, '说完这一句就停，不往下读文件、不调 API：' + r.stdout)
  }
})

// 临时仓库：plugin.json 依次是 3.3.0、3.3.1、3.3.2（各一个提交），CHANGELOG 里三版都有。
function withRepo(body) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'at-release-')))
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'test')
    git('config', 'commit.gpgsign', 'false')
    mkdirSync(join(dir, '.claude-plugin'))
    writeFileSync(join(dir, 'CHANGELOG.md'), '# 更新记录\n\n- 3.3.2：第二版\n- 3.3.1：第一版\n- 3.3.0：之前的一版\n')
    const shas = {}
    for (const v of ['3.3.0', '3.3.1', '3.3.2']) {
      writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'x', version: v }) + '\n')
      git('add', '.claude-plugin/plugin.json', 'CHANGELOG.md')
      git('commit', '-q', '-m', v)
      shas[v] = git('rev-parse', 'HEAD')
    }
    return body({ dir, shas })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function cliRun(dir, routes) {
  const log = join(dir, '..', `${dir.split(/[\\/]/).pop()}-calls.jsonl`)
  try {
    const r = runCli(['--import', FAKE_FETCH], {
      cwd: dir,
      env: { ...cleanEnv(), GITHUB_TOKEN: 'T0KEN', GITHUB_REPOSITORY: 'owner/repo', FAKE_GITHUB_ROUTES: JSON.stringify(routes), FAKE_GITHUB_LOG: log },
    })
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    return { ...r, calls }
  } finally {
    rmSync(log, { force: true })
  }
}

const tagRefs = (shas, over = {}) => ({
  'GET /repos/owner/repo/git/ref/tags/v3.3.1': [200, { object: { sha: over['3.3.1'] ?? shas['3.3.1'], type: 'commit' } }],
  'GET /repos/owner/repo/git/ref/tags/v3.3.2': [200, { object: { sha: over['3.3.2'] ?? shas['3.3.2'], type: 'commit' } }],
})

test('github-release CLI（复核 docs/52 §8，中 2）：按 first-parent 历史给 3.3.1 起的各版建（从低到高），令牌、仓库名从环境变量来，建成退出码 0；3.3.0 不碰', () => {
  withRepo(({ dir, shas }) => {
    const r = cliRun(dir, { ...tagRefs(shas), 'POST /repos/owner/repo/releases': [201, {}] })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(posts(r.calls).map((p) => [p.body.tag_name, p.body.body]), [['v3.3.1', '第一版'], ['v3.3.2', '第二版']])
    for (const c of r.calls) {
      assert.equal(c.headers.Authorization, 'Bearer T0KEN')
      assert.ok(c.path.startsWith('/repos/owner/repo/'), c.path)
      assert.ok(!c.path.includes('v3.3.0'), c.path)
    }
  })
})

test('github-release CLI（复核 docs/52 §8）：哪一版没建成——退出码 1，别的版照建；tag 指错了提交的那一版不建', () => {
  withRepo(({ dir, shas }) => {
    const refused = cliRun(dir, { ...tagRefs(shas), 'POST /repos/owner/repo/releases': [422, { message: 'Validation Failed' }] })
    assert.equal(refused.status, 1, refused.stdout + refused.stderr)
    const misplaced = cliRun(dir, { ...tagRefs(shas, { '3.3.1': shas['3.3.0'] }), 'POST /repos/owner/repo/releases': [201, {}] })
    assert.equal(misplaced.status, 1, misplaced.stdout + misplaced.stderr)
    assert.deepEqual(posts(misplaced.calls).map((p) => p.body.tag_name), ['v3.3.2'])
    assert.ok(misplaced.stdout.includes(shas['3.3.0']) && misplaced.stdout.includes(shas['3.3.1']), misplaced.stdout)
  })
})

test('CI：tag 作业打完 tag 再发 Release——这一步就在 tag 作业里、排在打 tag 之后、红了也跑（它自己核 tag）、令牌经 env 传、不吞错；别处不跑它', () => {
  const ci = read('.github/workflows/ci.yml')
  const lines = ci.split('\n')
  const start = lines.indexOf('  tag:')
  assert.ok(start > 0, 'ci.yml 没有 tag 作业')
  let end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l))
  if (end < 0) end = lines.length
  const job = lines.slice(start, end)
  const tagAt = job.indexOf('        run: node scripts/tag-release.mjs --push')
  const nameAt = job.indexOf('      - name: publish the GitHub release')
  assert.ok(tagAt > 0 && nameAt > tagAt, 'Release 那一步要在 tag 作业里、排在打 tag 之后')
  let stepEnd = job.findIndex((l, i) => i > nameAt && l.startsWith('      - '))
  if (stepEnd < 0) stepEnd = job.length
  const step = job.slice(nameAt, stepEnd).filter((l) => l.trim() && !l.trim().startsWith('#'))
  assert.deepEqual(step, [
    '      - name: publish the GitHub release',
    '        if: ${{ !cancelled() }}',
    '        env:',
    '          GITHUB_TOKEN: ${{ github.token }}',
    '        run: node scripts/github-release.mjs',
  ])
  assert.ok(!job.some((l) => l.includes('continue-on-error')), 'tag 作业不许吞错')
  const runs = lines.filter((l) => !l.trim().startsWith('#') && l.includes('scripts/github-release.mjs'))
  assert.deepEqual(runs, ['        run: node scripts/github-release.mjs'], '只在 tag 作业的这一步里跑')
})
