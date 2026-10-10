#!/usr/bin/env node
// 用法：node scripts/tag-release.mjs [--push]
// 在要发布的那个提交上跑（CI 的 tag 作业：推 main、ci 的判据与版本检查都过了之后）。认法在 scripts/lib/release.mjs：沿 HEAD 的 first-parent 历史，
// 每一版打在 plugin.json 第一次是它的那个提交上，远端缺的都补上、一次推完；远端已有、指向别处的不挪，报出来、退出码 1。不带 --push 只列出要打
// 什么，本地不建 tag、远端不动。需要完整历史（fetch-depth: 0）。行为由 tests/release.test.mjs 在临时仓库加裸远端里钉着。
//
// ⚠️ CI 里推送用的是 GITHUB_TOKEN：它推不了指向「带着与默认分支不同的工作流文件」的提交的 tag（推它等于创建或更新工作流，GitHub 要 workflows 权限，GITHUB_TOKEN 拿不到）——
// 那样的 tag 被拒，作业红（M4l 合并时实测：v0.8.0–v2.9.0 被拒）。工作流文件改过之后漏打的旧版，要有 workflow 权限的人在本地跑
// `node scripts/tag-release.mjs --push` 补（M4l 起工作流的 push 只认分支，推 tag 不触发 CI；M4l 之前的提交里的工作流不认这一条，一次推三个以内会起 CI，超过三个 GitHub 不生成推送事件）。
// docs/47 §0、§1.3 的订正，docs/48。

import { execFileSync } from 'node:child_process'
import { firstCommitPerVersion, planTags, pluginVersionEntries } from './lib/release.mjs'

const push = process.argv.includes('--push')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const NL = String.fromCharCode(10)
const TAB = String.fromCharCode(9)

// first-parent 历史上改过 plugin.json 的提交与那一刻的版本（与 github-release.mjs 同一份认法，M4q 起抽进 lib）。
const entries = pluginVersionEntries(git)

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
  // 本地已有、指向别处的 tag：空跑与推都报出来、退出码 1（只读，两种模式都核）。只有推的时候才建本地 tag。
  let local = null
  try {
    local = git('rev-parse', '--verify', '--quiet', `refs/tags/${c.tag}^{commit}`).trim()
  } catch {}
  if (local && local !== c.sha) {
    console.log(`✖ 本地已有 ${c.tag}，指向 ${local}，不是 ${c.sha}——不覆盖，请人看。`)
    process.exit(1)
  }
  if (!push) {
    console.log(`要打 ${c.tag} → ${c.sha}`)
    continue
  }
  if (!local) git('tag', c.tag, c.sha)
  console.log(`打 ${c.tag} → ${c.sha}`)
}
if (push && create.length) execFileSync('git', ['push', 'origin', ...create.map((c) => `refs/tags/${c.tag}`)], { stdio: 'inherit' })
process.exit(conflicts.length ? 1 : 0)
