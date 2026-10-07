// 第 45 条（docs/47，M4l）：发布工程——CHANGELOG.md 一版一行、最新的在最上面、最上面那一版就是 plugin.json 的版本；推 main、判据与版本检查都过了之后
// CI 按 plugin.json 的版本打 vX.Y.Z（已经有了就不动），推 tag 不再触发 CI；README 两半说清每一版改了什么写在哪。版本号往前挪时 CHANGELOG 有没有这一版，
// 由 scripts/check-version-bump.mjs 在推 main、向 main 提 PR 时核（tests/version-bump.test.mjs）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { latestChangelogVersion } from '../scripts/lib/version-bump.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const VERSION = JSON.parse(read('.claude-plugin/plugin.json')).version
const LINE_RE = /^- (\d+)\.(\d+)\.(\d+)：(.+)$/

test('第 45 条：CHANGELOG.md 最上面那一版就是 plugin.json 的版本', () => {
  assert.equal(latestChangelogVersion(read('CHANGELOG.md')), VERSION)
})

test('第 45 条：CHANGELOG.md 一版一行——每一行「- x.y.z：…」，版本不重复、从新到旧排，冒号后面有话；别的「- 」开头的行不许混进来', () => {
  const lines = read('CHANGELOG.md').split('\n').filter((l) => l.startsWith('- '))
  assert.ok(lines.length > 0)
  const seen = new Set()
  let prev = null
  for (const l of lines) {
    const m = LINE_RE.exec(l)
    assert.ok(m, `不是「- x.y.z：…」：${l}`)
    const v = [Number(m[1]), Number(m[2]), Number(m[3])]
    const key = v.join('.')
    assert.ok(!seen.has(key), `重复：${key}`)
    seen.add(key)
    if (prev) assert.ok(prev[0] > v[0] || (prev[0] === v[0] && (prev[1] > v[1] || (prev[1] === v[1] && prev[2] > v[2]))), `没有从新到旧：${prev.join('.')} 之后是 ${key}`)
    assert.ok(m[4].trim().length > 0)
    prev = v
  }
})

test('第 45 条：CI 推 main 之后打 tag——只在推 main 上、判据与版本检查都过了之后、按 plugin.json 的版本、已经有了就不动；只有这个作业有写权限', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = ci.slice(ci.indexOf('\n  tag:'))
  assert.ok(ci.includes('\n  tag:'), 'ci.yml 没有 tag 作业')
  assert.ok(job.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'"), job.slice(0, 400))
  assert.ok(/needs:\s*\[test, version-bump\]/.test(job), 'tag 作业要等 test 与 version-bump 都过')
  assert.ok(/permissions:\s*\n\s+contents: write/.test(job), 'tag 作业要有 contents: write')
  assert.ok(job.includes(".claude-plugin/plugin.json") && job.includes('git ls-remote --exit-code --tags origin'), '按 plugin.json 的版本打、已经有了就不动')
  assert.ok(/^permissions:\s*\n\s+contents: read/m.test(ci), '工作流默认只读')
})

test('第 45 条：推 tag 不触发 ci、min-node——push 只认分支', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/min-node.yml']) {
    const y = read(f)
    assert.ok(/\non:\n  push:\n    branches: \['\*\*'\]\n/.test(y), `${f} 的 push 要写 branches: ['**']（不写就连推 tag 也触发）`)
  }
})

test('第 45 条：README 两半说清每一版改了什么写在 CHANGELOG.md、每一版有对应的 tag', () => {
  const r = read('README.md')
  const half = r.indexOf('<a id="english"></a>')
  assert.ok(r.slice(0, half).includes('每一版改了什么写在 [CHANGELOG.md](CHANGELOG.md)，每一版都打了对应的 tag（`v` 加版本号）。'), '中文半')
  assert.ok(r.slice(half).includes('What changed in each version is in [CHANGELOG.md](CHANGELOG.md), and every version has a matching tag (`v` plus the version number).'), '英文半')
})
