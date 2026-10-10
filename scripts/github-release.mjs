#!/usr/bin/env node
// 用法：node scripts/github-release.mjs（CI 的 tag 作业在打完 tag 之后跑；要 GITHUB_TOKEN 与 GITHUB_REPOSITORY，Actions 里后者自带；需要完整历史）。
// 给 3.3.1 起、还没有 GitHub Release 的各版建一条，从低到高。认法与 tag-release.mjs 同一份：每一版的 tag 打在 main 的 first-parent 历史上 plugin.json
// 第一次是它的提交——tag 不在远端、或者指向别处的那一版不建，已有的不动，正文是 CHANGELOG.md 里这一版那一行。哪一版没建成，别的照建、退出码 1。
// 认法在 scripts/lib/release.mjs，行为由 tests/github-release.test.mjs 钉着（API 换成假的）。第 45 条，docs/52（§8 是复核）。

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { RELEASE_FLOOR, ensureRelease, firstCommitPerVersion, pluginVersionEntries, releaseTargets } from './lib/release.mjs'

const token = process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY
if (!token || !repo) {
  console.log('✖ 缺 GITHUB_TOKEN 或 GITHUB_REPOSITORY——这个脚本在 CI 的 tag 作业里跑（打完 tag 之后），本地用不着。')
  process.exit(1)
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const targets = releaseTargets(firstCommitPerVersion(pluginVersionEntries(git)))
const changelog = readFileSync('CHANGELOG.md', 'utf8')
if (!targets.length) console.log(`没有要建 Release 的版本（${RELEASE_FLOOR} 之前的各版不补）。`)
let ok = true
for (const t of targets) {
  const result = await ensureRelease({ fetch: globalThis.fetch, repo, token, version: t.version, expectedSha: t.sha, changelog })
  for (const line of result.lines) console.log(line)
  ok = ok && result.ok
}
process.exit(ok ? 0 : 1)
