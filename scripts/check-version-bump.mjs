#!/usr/bin/env node
// 用法：node scripts/check-version-bump.mjs <事件之前的提交> <事件之后的提交>
// CI（.github/workflows/ci.yml）在「推 main」与「向 main 提 PR」两个事件上跑它：推 main 就是
// 发布，这是这个仓库里「发布」唯一的机械表征（docs/24 §2.3，改判 docs/19 §9.2）。
// 判定在 scripts/lib/version-bump.mjs；这里只从 git 里取数。需要完整历史（fetch-depth: 0）。
// 这一层的行为由 tests/version-bump.test.mjs 末尾在临时 git 仓库里造提交钉着。

import { execFileSync } from 'node:child_process'
import { CHANGELOG, judgeVersionBump, withoutVersionOnlyManifest } from './lib/version-bump.mjs'

const [base, head] = process.argv.slice(2)

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function manifestAt(ref) {
  try {
    return JSON.parse(git('show', `${ref}:.claude-plugin/plugin.json`))
  } catch {
    return null
  }
}

// 第 45 条（M4l）：事件之后那个提交的 CHANGELOG.md（没有给 null）——版本号往前挪时，最上面那一行要是这一版。
function changelogAt(ref) {
  try {
    return git('show', `${ref}:${CHANGELOG}`)
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
if (!base || /^0+$/.test(base)) {
  console.log(`没有可比的「之前」提交（${base || '空'}），跳过版本号检查。`)
  process.exit(0)
}
// before 不是全零却拿不到：多半是 force push——actions/checkout 只拉分支与 tag，被改写掉的
// 旧 tip 不在其中。补拉一次；还拿不到就判红，不静默放行（M3p 复核：版本号往回挪恰恰最常
// 出现在回滚式的 force push 里）。
if (!exists(base)) {
  try {
    git('fetch', '--no-tags', '--depth=1', 'origin', base)
  } catch {}
  if (!exists(base)) {
    console.log(`✖ 拿不到事件之前的提交 ${base}（force push？），无法核版本号。`)
    process.exit(1)
  }
}

// 三点：只算 head 这一侧自 merge-base 以来引入的改动。推 main 的快进推送里 merge-base 就是
// base；向 main 提 PR 时 main 可能已经往前走了，两点会把 main 那边的新改动也算进来。
// --no-renames：改名只列新路径，把文件挪出插件目录会被当成只加了一个散文文件；关掉改名
// 检测，旧路径以删除的身份出现。-z：路径按原样输出、以 NUL 分隔——不加 -z 时 git 会把中文
// 路径加引号、转成八进制（core.quotePath），startsWith('skills/') 永远配不上。
const changed = git('diff', '--name-only', '--no-renames', '-z', `${base}...${head}`)
  .split('\0')
  .filter(Boolean)
const before = manifestAt(base)
const after = manifestAt(head)
const r = judgeVersionBump({
  before: before?.version ?? null,
  after: after?.version,
  changed: withoutVersionOnlyManifest(changed, before, after),
  changelog: changelogAt(head),
})
console.log(`${r.ok ? '✔' : '✖'} ${r.reason}`)
process.exit(r.ok ? 0 : 1)
