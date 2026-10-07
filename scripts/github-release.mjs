#!/usr/bin/env node
// 用法：node scripts/github-release.mjs（CI 的 tag 作业在打完 tag 之后跑；要 GITHUB_TOKEN 与 GITHUB_REPOSITORY，Actions 里后者自带）。
// 给 HEAD 上 plugin.json 的那一版建 GitHub Release：tag 不在远端不建、已有就不动、正文是 CHANGELOG.md 里这一版那一行。认法在 scripts/lib/release.mjs
// 的 ensureRelease，行为由 tests/github-release.test.mjs 钉着（API 换成假的）。第 45 条，docs/52。

import { readFileSync } from 'node:fs'
import { ensureRelease } from './lib/release.mjs'

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const repo = process.env.GITHUB_REPOSITORY
if (!token || !repo) {
  console.log('✖ 缺 GITHUB_TOKEN 或 GITHUB_REPOSITORY——这个脚本在 CI 的 tag 作业里跑（打完 tag 之后），本地用不着。')
  process.exit(1)
}
const version = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8')).version
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const result = await ensureRelease({ fetch: globalThis.fetch, repo, token, version, changelog })
for (const line of result.lines) console.log(line)
process.exit(result.ok ? 0 : 1)
