// 第 48 条（docs/47，M4l）：工程卫生——.gitignore 收掉不该进仓库的脚手架目录；.gitattributes 把换行符钉成 LF（docs/11 §5.28）；测试碰不到的脚本
// 有语法错误时全套也要红（每一份 node --check 一遍）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const lines = (p) => readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/).map((l) => l.trim())

test('第 48 条：.gitignore 收掉 .playwright-mcp/ 与 scratchpad/（还有原来的 .superpowers/、.claude/worktrees/）', () => {
  const g = lines('.gitignore')
  for (const e of ['.playwright-mcp/', 'scratchpad/', '.superpowers/', '.claude/worktrees/']) assert.ok(g.includes(e), `.gitignore 缺 ${e}`)
})

test('第 48 条：.gitattributes 把文本文件的换行符钉成 LF（docs/11 §5.28 的修法）', () => {
  assert.ok(lines('.gitattributes').includes('* text=auto eol=lf'))
})

// 判据文件自己由 node --test 加载，语法错了当场就红；这里管的是另外那些：hooks/ 下的入口与库（多数被判据 import，但入口可能没有）、scripts/、
// tests/helpers/ 与 tests/fixtures/（预加载、子进程里跑的那几份）。
function scripts(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...scripts(rel))
    else if (/\.(mjs|cjs|js)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(rel)
  }
  return out
}

test('第 48 条：hooks/、scripts/、tests/helpers/、tests/fixtures/ 下每一份脚本都过 node --check', () => {
  const files = ['hooks', 'scripts', join('tests', 'helpers'), join('tests', 'fixtures')].flatMap(scripts)
  assert.ok(files.length > 0)
  const bad = []
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', join(ROOT, f)], { encoding: 'utf8' })
    if (r.status !== 0) bad.push(`${relative(ROOT, join(ROOT, f))}：${(r.stderr || '').split(/\r?\n/).find((l) => /Error/.test(l)) ?? r.stderr}`)
  }
  assert.deepEqual(bad, [])
})
