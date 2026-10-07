#!/usr/bin/env node
// 用法：node scripts/tag-release.mjs [--push]
// 在要发布的那个提交上跑（CI 的 tag 作业：推 main、ci 的判据与版本检查都过了之后）。认法在 scripts/lib/release.mjs：沿 HEAD 的 first-parent 历史，
// 每一版打在 plugin.json 第一次是它的那个提交上，远端缺的都补上、一次推完；远端已有、指向别处的不挪，报出来、退出码 1。不带 --push 只列出要做什么。
// 需要完整历史（fetch-depth: 0）。行为由 tests/release.test.mjs 在临时仓库加裸远端里钉着。

import { execFileSync } from 'node:child_process'
import { firstCommitPerVersion, planTags } from './lib/release.mjs'

const push = process.argv.includes('--push')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const NL = String.fromCharCode(10)
const TAB = String.fromCharCode(9)

const shas = git('log', '--first-parent', '--reverse', '--format=%H', 'HEAD', '--', '.claude-plugin/plugin.json')
  .split(NL)
  .map((s) => s.trim())
  .filter(Boolean)
const entries = shas.map((sha) => {
  let version = null
  try {
    version = JSON.parse(git('show', `${sha}:.claude-plugin/plugin.json`)).version
  } catch {}
  return { sha, version }
})

// 远端已有的 tag：ls-remote 给出 refs/tags/x，附注 tag 另有一行 refs/tags/x^{}（剥开之后的提交）——取剥开之后的。
const remote = new Map()
for (const line of git('ls-remote', '--tags', 'origin').split(NL).filter(Boolean)) {
  const [sha, ref] = line.trim().split(TAB)
  const name = ref.replace(/^refs\/tags\//, '')
  if (name.endsWith('^{}')) remote.set(name.slice(0, -3), sha)
  else if (!remote.has(name)) remote.set(name, sha)
}

const { create, conflicts } = planTags(firstCommitPerVersion(entries), remote)
for (const c of conflicts) console.log(`✖ ${c.tag} 在远端指向 ${c.have}，按认法应该是 ${c.want}——不挪已有的 tag，请人看。`)
if (!create.length) console.log('没有要补的 tag。')
for (const c of create) {
  let local = null
  try {
    local = git('rev-parse', '--verify', '--quiet', `refs/tags/${c.tag}^{commit}`).trim()
  } catch {}
  if (local && local !== c.sha) {
    console.log(`✖ 本地已有 ${c.tag}，指向 ${local}，不是 ${c.sha}——不覆盖，请人看。`)
    process.exit(1)
  }
  if (!local) git('tag', c.tag, c.sha)
  console.log(`${push ? '打' : '要打'} ${c.tag} → ${c.sha}`)
}
if (push && create.length) execFileSync('git', ['push', 'origin', ...create.map((c) => `refs/tags/${c.tag}`)], { stdio: 'inherit' })
process.exit(conflicts.length ? 1 : 0)
