// 全量审查第 45 条剩下的「没有 GitHub Release」（docs/52，M4q）：CI 的 tag 作业打完 tag 之后，给当前这一版（HEAD 上 plugin.json 的版本）建一条
// GitHub Release——tag 不在远端不建（建 Release 时 tag 不在，GitHub 会在默认分支的 HEAD 上新打一个，打错了地方）；已有就不动；正文是 CHANGELOG.md
// 里这一版那一行；是不是「最新」按版本号比远端已标的最新那一条。历史上的各版不补（有意）。API 调用经注入的 fetch，这里不碰网络。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changelogEntry } from '../scripts/lib/version-bump.mjs'
import { ensureRelease } from '../scripts/lib/release.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_CLI = join(ROOT, 'scripts', 'github-release.mjs')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/).join('\n')
const CHANGELOG = '# 更新记录\n\n- 3.3.10：第十个补丁\n- 3.3.1：推 main 之后发这一版的 GitHub Release\n- 3.3.0：漏切指针时回传【指针】\n'
const REPO = 'hangwenlei/agent-team'
const API = 'https://api.github.com'

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
const TAG_OK = { 'GET /repos/hangwenlei/agent-team/git/ref/tags/v3.3.1': [200, { ref: 'refs/tags/v3.3.1' }] }
const run = (routes, over = {}) => {
  const f = fakeFetch(routes)
  return ensureRelease({ fetch: f.fetch, repo: REPO, token: 'T0KEN', version: '3.3.1', changelog: CHANGELOG, ...over }).then((r) => ({ ...r, calls: f.calls }))
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

test('ensureRelease：tag 在远端、还没有 Release、远端还没标最新——建一条：名字是 tag，正文是 CHANGELOG 那一行，标成最新；带上令牌与 API 版本头', async () => {
  const r = await run({ ...TAG_OK, 'POST /repos/hangwenlei/agent-team/releases': [201, { html_url: 'https://github.com/x' }] })
  assert.equal(r.ok, true, r.lines.join('\n'))
  const p = posts(r.calls)
  assert.equal(p.length, 1)
  assert.equal(p[0].path, '/repos/hangwenlei/agent-team/releases')
  assert.deepEqual(p[0].body, { tag_name: 'v3.3.1', name: 'v3.3.1', body: '推 main 之后发这一版的 GitHub Release', draft: false, prerelease: false, make_latest: 'true' })
  for (const c of r.calls) {
    assert.equal(c.headers.Authorization, 'Bearer T0KEN')
    assert.equal(c.headers.Accept, 'application/vnd.github+json')
    assert.equal(c.headers['X-GitHub-Api-Version'], '2022-11-28')
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

test('ensureRelease：远端标着的最新一条版本更高——这一条建出来不抢「最新」；更低、或者认不出版本号的，照常标最新', async () => {
  const create = { 'POST /repos/hangwenlei/agent-team/releases': [201, {}] }
  const newer = await run({ ...TAG_OK, ...create, 'GET /repos/hangwenlei/agent-team/releases/latest': [200, { tag_name: 'v3.4.0' }] })
  assert.equal(posts(newer.calls)[0].body.make_latest, 'false')
  const patchNewer = await run({ ...TAG_OK, ...create, 'GET /repos/hangwenlei/agent-team/releases/latest': [200, { tag_name: 'v3.3.10' }] })
  assert.equal(posts(patchNewer.calls)[0].body.make_latest, 'false', '按数比，不按字符串比')
  const older = await run({ ...TAG_OK, ...create, 'GET /repos/hangwenlei/agent-team/releases/latest': [200, { tag_name: 'v3.3.0' }] })
  assert.equal(posts(older.calls)[0].body.make_latest, 'true')
  const odd = await run({ ...TAG_OK, ...create, 'GET /repos/hangwenlei/agent-team/releases/latest': [200, { tag_name: 'nightly' }] })
  assert.equal(posts(odd.calls)[0].body.make_latest, 'true')
  // 按字符串比时 "v3.3.9" 排在 "v3.3.10" 后面——这一格只有按数比才对。
  const tens = await run(
    { 'GET /repos/hangwenlei/agent-team/git/ref/tags/v3.3.10': [200, {}], ...create, 'GET /repos/hangwenlei/agent-team/releases/latest': [200, { tag_name: 'v3.3.9' }] },
    { version: '3.3.10' },
  )
  assert.equal(posts(tens.calls)[0].body.make_latest, 'true')
})

test('ensureRelease：CHANGELOG 里没有这一版、版本号不是 x.y.z、仓库名或令牌是空的——不调 API，算失败', async () => {
  for (const over of [{ version: '3.3.2' }, { version: '3.3' }, { repo: '' }, { token: '' }]) {
    const r = await run({ ...TAG_OK }, over)
    assert.equal(r.ok, false, JSON.stringify(over))
    assert.equal(r.calls.length, 0, JSON.stringify(over))
  }
})

test('ensureRelease：API 出错——查 tag、查 Release、查最新、建，哪一步回的不是预期的状态都算失败、不往下走；fetch 抛异常也一样', async () => {
  const cases = [
    { 'GET /repos/hangwenlei/agent-team/git/ref/tags/v3.3.1': [500, {}] },
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
    const r = await ensureRelease({ fetch: throwing, repo: REPO, token: 'T0KEN', version: '3.3.1', changelog: CHANGELOG })
    assert.equal(r.ok, false)
    assert.ok(r.lines.join('\n').includes('网络断了'), r.lines.join('\n'))
  }
})

test('github-release CLI：缺 GITHUB_TOKEN 或 GITHUB_REPOSITORY——不碰网络，退出码 1，说清这个脚本在 CI 的 tag 作业里跑', () => {
  const env = { ...process.env }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  delete env.GITHUB_REPOSITORY
  for (const extra of [{}, { GITHUB_REPOSITORY: REPO }, { GITHUB_TOKEN: 'x' }]) {
    const r = spawnSync(process.execPath, [RELEASE_CLI], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8' })
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.ok(r.stdout.includes('GITHUB_TOKEN') && r.stdout.includes('tag 作业'), r.stdout)
    assert.equal(r.stdout.trim().split(/\r?\n/).length, 1, '说完这一句就停，不往下读文件、不调 API：' + r.stdout)
  }
})

test('CI：tag 作业打完 tag 再发 Release——同一个作业里排在打 tag 之后、打 tag 那一步红了也照样跑（它自己先核 tag 在不在远端），令牌经 env 传', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = ci.slice(ci.indexOf('\n  tag:'))
  const tagStep = job.indexOf('node scripts/tag-release.mjs --push')
  const relStep = job.indexOf('node scripts/github-release.mjs')
  assert.ok(tagStep > 0 && relStep > tagStep, 'Release 那一步要在 tag 作业里、排在打 tag 之后')
  const step = job.slice(job.lastIndexOf('\n      - ', relStep), job.indexOf('\n      - ', relStep) === -1 ? undefined : job.indexOf('\n      - ', relStep))
  assert.ok(step.includes('if: ${{ !cancelled() }}'), step)
  assert.ok(/env:\s*\n\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}/.test(step), step)
})
