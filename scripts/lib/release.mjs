// 第 45 条（M4l，docs/47）：按版本打 tag 的认法——纯函数，不读 git；CLI 外壳是 scripts/tag-release.mjs（CI 的 tag 作业在推 main 之后跑它）。
//
// 一版的 tag 打在 main 的 first-parent 历史上 plugin.json 第一次是这个版本的那个提交（合进来的一版打在合并提交上）。每次都把缺的补齐：某一次推 main
// CI 红了、那一版没打上，下一次全绿时补。CI 推不了的（那个提交里带着与 main 现在不同的工作流文件，推它等于创建或更新工作流，GITHUB_TOKEN 没有 workflows 权限）要人在本地补，
// 历史上 v0.8.0–v2.9.0 那 22 版就是这样补的（docs/47 §0 的订正、docs/48）。远端已有、指向别处的 tag 不挪，报出来让人看。

import { changelogEntry } from './version-bump.mjs'

export const TAG_PREFIX = 'v'
const VERSION_RE = /^\d+\.\d+\.\d+$/

/**
 * entries：first-parent 历史上改过 plugin.json 的提交，从旧到新，各带那一刻的 version（读不出为 null）。
 * 每个版本取第一次出现的提交；不是 x.y.z 的跳过。
 * @returns {{ version: string, sha: string }[]}
 */
export function firstCommitPerVersion(entries) {
  const seen = new Set()
  const out = []
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.version !== 'string' || !VERSION_RE.test(e.version) || seen.has(e.version)) continue
    seen.add(e.version)
    out.push({ version: e.version, sha: e.sha })
  }
  return out
}

/**
 * wanted：firstCommitPerVersion 的结果；remote：远端已有的 tag → 它指向的提交（附注 tag 剥开之后）。
 * 远端没有的要打；有、指向同一个提交的不动；指向别处的是冲突。
 * @returns {{ create: { tag: string, sha: string }[], conflicts: { tag: string, want: string, have: string }[] }}
 */
export function planTags(wanted, remote) {
  const create = []
  const conflicts = []
  for (const w of Array.isArray(wanted) ? wanted : []) {
    const tag = TAG_PREFIX + w.version
    const have = remote.get(tag)
    if (have === undefined) create.push({ tag, sha: w.sha })
    else if (have !== w.sha) conflicts.push({ tag, want: w.sha, have })
  }
  return { create, conflicts }
}

// 第 45 条剩下的「没有 GitHub Release」（M4q，docs/52）：tag 作业打完 tag 之后，给 RELEASE_FLOOR 起、还没有 Release 的各版建一条 GitHub Release；
// CLI 外壳是 scripts/github-release.mjs。认法与打 tag 同一份（firstCommitPerVersion）：tag 不在远端、或者在远端指向的不是认法要的那个提交，不建——
// 建 Release 时 tag 不在，GitHub 会在默认分支的 HEAD 上新打一个；指错了的 tag，打 tag 那一步报冲突、不挪，这里跟着不建（复核 docs/52 §8）。已有就不动
// （作业重跑不重复建）；正文是 CHANGELOG.md 里这一版那一行；远端标着的最新一条版本更高时不抢「最新」。RELEASE_FLOOR 之前的各版不补（有意，docs/52 §1.2）。
// fetch 由调用方给，判据里换成假的。
const API = 'https://api.github.com'
const MANIFEST = '.claude-plugin/plugin.json'

/** 3.3.1 起每一版都有 GitHub Release；之前的各版不补。 */
export const RELEASE_FLOOR = '3.3.1'

function tagVersion(tagName) {
  const m = typeof tagName === 'string' ? /^v(\d+)\.(\d+)\.(\d+)$/.exec(tagName) : null
  return m ? m.slice(1).map(Number) : null
}

function isNewer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

const partsOf = (v) => v.split('.').map(Number)

/**
 * 要有 Release 的各版：wanted（firstCommitPerVersion 的结果）里版本不低于 floor 的，按版本号从低到高（按数比）。
 * @returns {{ version: string, sha: string }[]}
 */
export function releaseTargets(wanted, floor = RELEASE_FLOOR) {
  const f = partsOf(floor)
  return (Array.isArray(wanted) ? wanted : [])
    .filter((w) => w && typeof w.version === 'string' && VERSION_RE.test(w.version) && !isNewer(f, partsOf(w.version)))
    .sort((a, b) => (isNewer(partsOf(a.version), partsOf(b.version)) ? 1 : isNewer(partsOf(b.version), partsOf(a.version)) ? -1 : 0))
}

/**
 * HEAD 的 first-parent 历史上改过 plugin.json 的提交，从旧到新，各带那一刻的 version（读不出为 null）——firstCommitPerVersion 的输入。
 * git 由调用方给（跑一条 git 命令、回 stdout），本模块自己不读 git；tag-release.mjs 与 github-release.mjs 共用这一份认法。
 */
export function pluginVersionEntries(git) {
  const shas = git('log', '--first-parent', '--reverse', '--format=%H', 'HEAD', '--', MANIFEST)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  return shas.map((sha) => {
    let version = null
    try {
      version = JSON.parse(git('show', `${sha}:${MANIFEST}`)).version
    } catch {}
    return { sha, version }
  })
}

/**
 * 给 version 那一版建 GitHub Release（已有就不动）。repo 是「owner/name」，token 是有 contents: write 的令牌，expectedSha 是认法要那一版的 tag 指着的提交
 * （firstCommitPerVersion 给的）。
 * @returns {Promise<{ ok: boolean, lines: string[] }>} ok 为 false 时 CLI 退出码 1。
 */
export async function ensureRelease({ fetch, repo, token, version, expectedSha, changelog }) {
  const fail = (line) => ({ ok: false, lines: [`✖ ${line}`] })
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return fail(`版本号 ${JSON.stringify(version)} 不是 x.y.z——不建 Release。`)
  const body = changelogEntry(changelog, version)
  if (body === null) return fail(`CHANGELOG.md 里没有「- ${version}：…」这一行，Release 没有正文——不建。`)
  if (typeof repo !== 'string' || !repo || typeof token !== 'string' || !token) return fail('缺仓库名或令牌——不建 Release。')
  const tag = TAG_PREFIX + version
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{40,64}$/.test(expectedSha)) return fail(`不知道 ${tag} 该打在哪个提交上——不建 Release。`)
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agent-team-release',
  }
  const call = async (method, path, payload) => {
    const res = await fetch(`${API}/repos/${repo}${path}`, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })
    let json = null
    try {
      json = await res.json()
    } catch {}
    return { status: res.status, json }
  }
  try {
    const ref = await call('GET', `/git/ref/tags/${tag}`)
    if (ref.status === 404) {
      return fail(`${tag} 不在远端——不建 Release（tag 不在时 GitHub 会在默认分支的 HEAD 上新打一个，打错地方）；先让打 tag 那一步把它打上。`)
    }
    if (ref.status !== 200) return fail(`查 ${tag} 在不在远端，回的是 ${ref.status}。`)
    // 附注 tag 指着 tag 对象，剥开到提交再比（CI 打的是轻量 tag，人在本地补的可能是附注的）。
    let obj = ref.json?.object
    for (let i = 0; i < 5 && obj?.type === 'tag'; i++) {
      const peeled = await call('GET', `/git/tags/${obj.sha}`)
      if (peeled.status !== 200) return fail(`剥开 ${tag} 这个附注 tag，回的是 ${peeled.status}。`)
      obj = peeled.json?.object
    }
    const at = obj?.type === 'commit' && typeof obj.sha === 'string' ? obj.sha : null
    if (at !== expectedSha) {
      return fail(`${tag} 在远端指向 ${at ?? '一个认不出的对象'}，按认法应该是 ${expectedSha}——不建 Release；打 tag 那一步报的冲突是同一件事，请人看。`)
    }
    const existing = await call('GET', `/releases/tags/${tag}`)
    if (existing.status === 200) return { ok: true, lines: [`${tag} 的 Release 已经有了，不动。`] }
    if (existing.status !== 404) return fail(`查 ${tag} 的 Release，回的是 ${existing.status}。`)
    const latest = await call('GET', '/releases/latest')
    if (latest.status !== 200 && latest.status !== 404) return fail(`查远端标着的最新一条 Release，回的是 ${latest.status}。`)
    const have = latest.status === 200 ? tagVersion(latest.json?.tag_name) : null
    const makeLatest = have && !isNewer(version.split('.').map(Number), have) ? 'false' : 'true'
    const created = await call('POST', '/releases', { tag_name: tag, name: tag, body, draft: false, prerelease: false, make_latest: makeLatest })
    if (created.status !== 201) {
      const why = typeof created.json?.message === 'string' ? `：${created.json.message}` : ''
      return fail(`建 ${tag} 的 Release，回的是 ${created.status}${why}。`)
    }
    return { ok: true, lines: [`建了 ${tag} 的 Release${makeLatest === 'true' ? '，标成最新' : '（远端标着的最新一条版本更高，不抢「最新」）'}。`] }
  } catch (e) {
    return fail(`调 GitHub API 出错：${e?.message ?? e}`)
  }
}
