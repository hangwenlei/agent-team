// 第 45 条（M4l，docs/47）：按版本打 tag 的认法——纯函数，不读 git；CLI 外壳是 scripts/tag-release.mjs（CI 的 tag 作业在推 main 之后跑它）。
//
// 一版的 tag 打在 main 的 first-parent 历史上 plugin.json 第一次是这个版本的那个提交（合进来的一版打在合并提交上）。每次都把缺的补齐：某一次推 main
// CI 红了、那一版没打上，下一次全绿时补；历史上的各版也是这样补上的（GITHUB_TOKEN 推的 tag 不触发任何工作流——手工推旧提交的 tag，会按那个提交里
// 还没有分支过滤的工作流起 CI）。远端已有、指向别处的 tag 不挪，报出来让人看。

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
