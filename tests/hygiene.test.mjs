// 第 48 条（docs/47，M4l）：工程卫生——.gitignore 收掉不该进仓库的脚手架目录；.gitattributes 把换行符钉成 LF（docs/11 §5.28）；测试碰不到的脚本
// 有语法错误时全套也要红（每一份 node --check 一遍）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

// 复核（低 5）：scratchpad/ 进了忽略清单，git status 就不再提示它——而 node --test 照样递归收它下面的 *.test.mjs。看不见了不等于没风险：仓库根下不许有它。
test('第 48 条：仓库根下没有 scratchpad/（忽略只管 git，node --test 照样收它下面的判据）', () => {
  assert.ok(!existsSync(join(ROOT, 'scratchpad')), '仓库根下有 scratchpad/：挪到仓库外')
})

// 第 46 条（docs/48，M4m）：裁定编号只在裁定记录（docs/16）里用，别处写名字（docs/16 §2.30）。注释与判据里撞过号：同一个号在这里指
// M3a 那条「产者交代的宇宙收窄到 available_roles」，裁定记录里同号的是另一件事。docs/ 整体不扫：带日期的记录原样引用编号。
const NOT_SCANNED = new Set(['.git', 'docs', 'node_modules', '.claude', '.superpowers', 'scratchpad', '.playwright-mcp'])
function textFiles(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    if (NOT_SCANNED.has(name)) continue
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...textFiles(rel))
    else if (/\.(mjs|cjs|js|json|md|ya?ml)$/.test(name)) out.push(rel)
  }
  return out
}

test('第 46 条：docs/ 之外不写裁定编号（Ruling 后面跟数字），写裁定的名字', () => {
  const files = textFiles('.')
  assert.ok(files.some((f) => f.startsWith('hooks')) && files.some((f) => f.startsWith('tests')), '前置：扫描集合里没有 hooks/ 或 tests/')
  const bad = []
  for (const f of files) {
    readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).forEach((l, i) => {
      if (/\bRuling\s+\d/.test(l)) bad.push(`${f}:${i + 1}  ${l.trim().slice(0, 80)}`)
    })
  }
  assert.deepEqual(bad, [])
})
