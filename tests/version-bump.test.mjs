// 发布纪律的机械判据（M3p，docs/24 §2.3）：推 main 就是发布，每次都要挪 version——
// 碰插件会加载的东西挪中间一位，只碰散文/文档/测试挪最后一位，任何一位不长到 10。
//
// docs/19 §9.2 当年裁定「只立纪律、不配判据」，理由是发布在这个仓库里没有机械表征：
// 放在 node --test 里的判据会在每一个开发中 commit 上红，红了等于没红。它同时写下了改判
// 条件——「出现 .github/workflows/，也就是有东西在 push 到 main 这个时刻真的跑一次」。
// 这一轮加了 CI，所以这条判据只在 CI 的「推 main / 向 main 提 PR」两个事件上跑
// （scripts/check-version-bump.mjs），比的是事件前后两个提交，不是树里的字。
// 前半测纯函数：给定前后版本号与改动文件清单，判得对不对；末尾在临时 git 仓库里测 CLI 外壳。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgeVersionBump, PLUGIN_LOADED, withoutVersionOnlyManifest } from '../scripts/lib/version-bump.mjs'

const ok = (args) => judgeVersionBump(args).ok

test('只改文档、挪了最后一位 → 通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.8', changed: ['docs/x.md', 'README.md'] }), true)
})

test('只改文档、版本号没动 → 不通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.7', changed: ['README.md'] }), false)
})

test('碰了 hooks/、只挪了最后一位 → 不通过，理由点名要挪中间一位', () => {
  const r = judgeVersionBump({ before: '0.7.7', after: '0.7.8', changed: ['hooks/gate.mjs'] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /中间一位/)
  assert.match(r.reason, /hooks\/gate\.mjs/)
})

test('碰了 hooks/、挪了中间一位 → 通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.8.0', changed: ['hooks/gate.mjs'] }), true)
})

test('挪了第一位也算挪过中间一位 → 通过', () => {
  assert.equal(ok({ before: '0.9.3', after: '1.0.0', changed: ['agents/at-pm.md'] }), true)
})

test('插件会加载的每一类路径都被认出来——漏认一类，那类改动就能只挪最后一位混过去', () => {
  for (const path of [
    'agents/at-pm.md',
    'commands/at.md',
    'hooks/hooks.json',
    'skills/at-api-contract/SKILL.md',
    'templates/project.json',
    'settings.json',
    'stages.json',
    'roster.json',
    'stages.README.md',
    '.claude-plugin/marketplace.json',
    '.claude-plugin/plugin.json',
  ]) {
    assert.equal(ok({ before: '0.7.7', after: '0.7.8', changed: [path] }), false, path)
  }
})

test('PLUGIN_LOADED 与上一条逐一列举的清单一致——多认或少认都要有人来改这里', () => {
  assert.deepEqual(
    [...PLUGIN_LOADED].sort(),
    [
      '.claude-plugin/marketplace.json',
      '.claude-plugin/plugin.json',
      'agents/',
      'commands/',
      'hooks/',
      'roster.json',
      'settings.json',
      'skills/',
      'stages.README.md',
      'stages.json',
      'templates/',
    ],
  )
})

test('前缀不粘连：hooks-old.md 不是 hooks/ 下的文件', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.8', changed: ['hooks-old.md'] }), true)
})

test('只认仓库根下的那几个目录与文件——docs/hooks/、tests/fixtures/agents/、docs/settings.json 都是散文', () => {
  for (const path of ['docs/hooks/x.md', 'tests/fixtures/agents/a.md', 'docs/settings.json', 'docs/stages.README.md']) {
    assert.equal(ok({ before: '0.7.7', after: '0.7.8', changed: [path] }), true, path)
  }
})

test('任何一位长到 10 → 不通过', () => {
  const r = judgeVersionBump({ before: '0.7.9', after: '0.7.10', changed: ['README.md'] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /10/)
})

test('版本号不是三段纯数字（例如 -wip 后缀）→ 不通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.8-wip', changed: ['README.md'] }), false)
})

test('版本号往回挪 → 不通过', () => {
  assert.equal(ok({ before: '0.8.0', after: '0.7.9', changed: ['README.md'] }), false)
})

test('版本号往回挪、而改动清单是空的（回滚式 force push：head 是 base 的祖先）→ 不通过', () => {
  assert.equal(ok({ before: '0.8.0', after: '0.7.7', changed: [] }), false)
})

test('事件之前的 version 读不成 x.y.z 时只校验之后的形状', () => {
  assert.equal(ok({ before: 'garbage', after: '0.7.8', changed: ['hooks/gate.mjs'] }), true)
})

test('没有任何改动 → 通过，不要求挪版本号', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.7', changed: [] }), true)
})

test('事件之前还没有 plugin.json（before 为 null）→ 只校验 after 的形状', () => {
  assert.equal(ok({ before: null, after: '0.1.0', changed: ['.claude-plugin/plugin.json'] }), true)
  assert.equal(ok({ before: null, after: 'x', changed: ['.claude-plugin/plugin.json'] }), false)
})

// ---- plugin.json：只改了 version 不算「改了插件会加载的东西」----
//
// 每次发布都改 plugin.json 的 version；要是它一出现就算插件会加载的改动，纯文档发布也得挪中间
// 一位。所以只有 version 以外的字段变了，它才留在清单里。

test('plugin.json 只改了 version：从清单里拿掉', () => {
  const changed = ['README.md', '.claude-plugin/plugin.json']
  assert.deepEqual(
    withoutVersionOnlyManifest(changed, { name: 'a', version: '0.7.7' }, { name: 'a', version: '0.7.8' }),
    ['README.md'],
  )
})

test('plugin.json 还改了别的字段：留在清单里', () => {
  const changed = ['.claude-plugin/plugin.json']
  assert.deepEqual(
    withoutVersionOnlyManifest(changed, { name: 'a', version: '0.7.7' }, { name: 'b', version: '0.7.8' }),
    changed,
  )
})

test('plugin.json 一侧读不出来：留在清单里，宁可多要求一位', () => {
  const changed = ['.claude-plugin/plugin.json']
  assert.deepEqual(withoutVersionOnlyManifest(changed, null, { version: '0.7.8' }), changed)
})

// ---- CLI 外壳：在临时 git 仓库里造真的提交 ----
//
// 纯函数测不到「从 git 取改动清单」这一层（M3p 复核：改名移出插件目录只列新路径、中文路径被
// 加引号转义、force push 之后拿不到 before 被静默放行，三处都在这一层）。

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-version-bump.mjs')

function withRepo(body) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-vb-')))
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  const manifest = (version, extra = {}) =>
    write('.claude-plugin/plugin.json', JSON.stringify({ name: 'x', version, ...extra }))
  const commit = (msg) => {
    git('add', '-A')
    git('commit', '-q', '-m', msg)
    return git('rev-parse', 'HEAD')
  }
  const check = (base, head) =>
    spawnSync(process.execPath, [CLI, base, head], { cwd: dir, encoding: 'utf8' })
  try {
    git('init', '-q')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    body({ git, write, manifest, commit, check })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('CLI：把插件目录里的文件改名挪出去、只挪最后一位 → 不通过（改名要当删除算）', () => {
  withRepo(({ write, manifest, commit, git, check }) => {
    write('hooks/a.mjs', 'export {}\n')
    write('docs/README.md', '# docs\n') // git mv 要求目标目录已经存在
    manifest('0.7.7')
    const base = commit('base')
    git('mv', 'hooks/a.mjs', 'docs/a.mjs')
    manifest('0.7.8')
    const head = commit('move')
    assert.equal(check(base, head).status, 1)
  })
})

test('CLI：插件目录下的中文路径被认出来——不被 git 的引号转义藏掉', () => {
  withRepo(({ write, manifest, commit, check }) => {
    manifest('0.7.7')
    const base = commit('base')
    write('skills/中文技能/SKILL.md', '# x\n')
    manifest('0.7.8')
    const head = commit('add')
    assert.equal(check(base, head).status, 1)
  })
})

test('CLI：只改文档、只挪最后一位 → 通过（锚：上面两条红不是因为 CLI 一律判红）', () => {
  withRepo(({ write, manifest, commit, check }) => {
    manifest('0.7.7')
    const base = commit('base')
    write('docs/说明.md', '# x\n')
    manifest('0.7.8')
    const head = commit('docs')
    const r = check(base, head)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  })
})

test('CLI：plugin.json 改了 version 以外的字段、只挪最后一位 → 不通过', () => {
  withRepo(({ manifest, commit, check }) => {
    manifest('0.7.7')
    const base = commit('base')
    manifest('0.7.8', { description: 'changed' })
    const head = commit('desc')
    assert.equal(check(base, head).status, 1)
  })
})

test('CLI：回滚式 force push（head 是 base 的祖先、版本号往回挪）→ 不通过', () => {
  withRepo(({ write, manifest, commit, check }) => {
    manifest('0.7.7')
    const old = commit('old')
    write('hooks/a.mjs', 'export {}\n')
    manifest('0.8.0')
    const newer = commit('new')
    assert.equal(check(newer, old).status, 1)
  })
})

test('CLI：事件之前的提交拿不到（force push 之后）→ 不通过，不静默放行', () => {
  withRepo(({ manifest, commit, check }) => {
    manifest('0.7.7')
    const head = commit('only')
    const r = check('1234567890abcdef1234567890abcdef12345678', head)
    assert.equal(r.status, 1, r.stdout + r.stderr)
  })
})

test('CLI：推一条新分支（before 全零）→ 跳过，通过', () => {
  withRepo(({ manifest, commit, check }) => {
    manifest('0.7.7')
    const head = commit('only')
    assert.equal(check('0000000000000000000000000000000000000000', head).status, 0)
  })
})
