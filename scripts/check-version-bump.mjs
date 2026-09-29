#!/usr/bin/env node
// 用法：node scripts/check-version-bump.mjs <事件之前的提交> <事件之后的提交>
// CI（.github/workflows/ci.yml）在「推 main」与「向 main 提 PR」两个事件上跑它：推 main 就是
// 发布，这是这个仓库里「发布」唯一的机械表征（docs/24 §2.3，改判 docs/19 §9.2）。
// 判定在 scripts/lib/version-bump.mjs；这里只从 git 里取数。需要完整历史（fetch-depth: 0）。

import { execFileSync } from 'node:child_process'
import { judgeVersionBump } from './lib/version-bump.mjs'

const [base, head] = process.argv.slice(2)

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function versionAt(ref) {
  try {
    return JSON.parse(git('show', `${ref}:.claude-plugin/plugin.json`)).version ?? null
  } catch {
    return null
  }
}

function exists(ref) {
  try {
    git('cat-file', '-e', `${ref}^{commit}`)
    return true
  } catch {
    return false
  }
}

if (!head) {
  console.error('用法：node scripts/check-version-bump.mjs <base> <head>')
  process.exit(2)
}
// 推一条新分支时 GitHub 给的 before 是全零；这种事件没有「之前」可比。
if (!base || /^0+$/.test(base) || !exists(base)) {
  console.log(`没有可比的「之前」提交（${base || '空'}），跳过版本号检查。`)
  process.exit(0)
}

// 三点：只算 head 这一侧自 merge-base 以来引入的改动。推 main 的快进推送里 merge-base 就是
// base；向 main 提 PR 时 main 可能已经往前走了，两点会把 main 那边的新改动也算进来。
const changed = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean)
const r = judgeVersionBump({ before: versionAt(base), after: versionAt(head), changed })
console.log(`${r.ok ? '✔' : '✖'} ${r.reason}`)
process.exit(r.ok ? 0 : 1)
