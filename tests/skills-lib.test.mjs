// 用户本机装的 skill 登记给角色：找、算指纹、复制进项目、比对（hooks/lib/skills.mjs）。
// 夹具见 tests/helpers/skills-world.mjs，不读真机的 ~/.claude。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { put, skillMd, world } from './helpers/skills-world.mjs'
import {
  SKILLS_REGISTRY,
  SKILLS_DIR,
  skillDirName,
  hashSkillDir,
  diffSkillDirs,
  readSkillMeta,
  discoverSkills,
  readRegistry,
  syncSkills,
  assignRoles,
  checkSkills,
  removeSkills,
  assertRoles,
} from '../hooks/lib/skills.mjs'

const roster = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const NOW = '2026-11-05T00:00:00.000Z'

test('skillDirName 去掉 Windows 不收的字符', () => {
  assert.equal(skillDirName('frontend-design:frontend-design'), 'frontend-design__frontend-design')
  assert.equal(skillDirName('a<b>c?. '), 'a_b_c_')
})

test('hashSkillDir 与文件写入顺序无关、跳过 .git、内容改一个字节就变', () => {
  const { root } = world()
  const a = join(root, 'a')
  const b = join(root, 'b')
  put(join(a, 'x.md'), 'x')
  put(join(a, 'sub', 'y.md'), 'y')
  put(join(b, 'sub', 'y.md'), 'y')
  put(join(b, 'x.md'), 'x')
  assert.equal(hashSkillDir(a), hashSkillDir(b))
  const before = hashSkillDir(a)
  put(join(a, '.git', 'HEAD'), 'whatever')
  assert.equal(hashSkillDir(a), before)
  put(join(a, 'x.md'), 'X')
  assert.notEqual(hashSkillDir(a), before)
})

test('diffSkillDirs 分出加了、删了、改了的文件', () => {
  const { root } = world()
  const oldDir = join(root, 'old')
  const newDir = join(root, 'new')
  put(join(oldDir, 'same.md'), 's')
  put(join(oldDir, 'gone.md'), 'g')
  put(join(oldDir, 'sub', 'changed.md'), '1')
  put(join(newDir, 'same.md'), 's')
  put(join(newDir, 'sub', 'changed.md'), '2')
  put(join(newDir, 'fresh.md'), 'f')
  assert.deepEqual(diffSkillDirs(oldDir, newDir), [
    { rel: 'fresh.md', status: 'added' },
    { rel: 'gone.md', status: 'removed' },
    { rel: 'sub/changed.md', status: 'modified' },
  ])
})

test('meta without frontmatter', () => {
  const { root } = world()
  const dir = join(root, 'bare')
  put(join(dir, 'SKILL.md'), '# 没有 frontmatter\n')
  assert.equal(readSkillMeta(dir).description, '')
})

test('readSkillMeta 读出用途、认出附带脚本与越出自己目录的 ${CLAUDE_PLUGIN_ROOT} 引用', () => {
  const { root, pluginSkillDir } = world()
  const meta = readSkillMeta(pluginSkillDir)
  assert.equal(meta.description, '把界面打磨得更好')
  assert.deepEqual(meta.refs_outside, ['scripts/run.mjs'])
  assert.equal(meta.has_scripts, false)
  const withScript = join(root, 'ws')
  put(join(withScript, 'SKILL.md'), skillMd('带脚本'))
  put(join(withScript, 'tool.py'), 'print(1)\n')
  assert.equal(readSkillMeta(withScript).has_scripts, true)
})

test('discoverSkills 找全四类、跳过 agent-team 自己', () => {
  const { home, projectRoot } = world()
  const { installed, errors } = discoverSkills({ home, projectRoot })
  assert.deepEqual(errors, [])
  assert.deepEqual(installed.map((s) => [s.kind, s.ref]).sort(), [
    ['git', 'user/cloned'],
    ['plugin', 'ui-kit@mkt:polish'],
    ['project', 'project/local-one'],
    ['user', 'user/plain'],
  ])
  const polish = installed.find((s) => s.ref === 'ui-kit@mkt:polish')
  assert.equal(polish.name, 'ui-kit:polish')
  assert.equal(polish.version, '1.0.0')
  assert.equal(polish.plugin, 'ui-kit@mkt')
})

test('discover tolerates broken plugin list', () => {
  const { home, projectRoot } = world()
  put(join(home, '.claude', 'plugins', 'installed_plugins.json'), '{oops')
  const r = discoverSkills({ home, projectRoot })
  assert.ok(r.installed.some((s) => s.kind === 'user'))
  assert.equal(r.installed.some((s) => s.kind === 'plugin'), false)
  assert.equal(r.errors[0].source, 'installed_plugins.json')
})

test('syncSkills 整份复制、写清单', () => {
  const { home, projectRoot, agentTeamDir, pluginSkillDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  const r = syncSkills({ agentTeamDir, installed, names: ['ui-kit:polish'], roles: ['at-ui'], now: NOW })
  assert.deepEqual(r.errors, [])
  assert.equal(r.synced[0].dir, 'ui-kit__polish')
  assert.ok(existsSync(join(agentTeamDir, SKILLS_DIR, 'ui-kit__polish', 'references', 'a.md')))
  const entry = readRegistry(agentTeamDir).skills['ui-kit:polish']
  assert.deepEqual(entry.roles, ['at-ui'])
  assert.equal(entry.sha, hashSkillDir(pluginSkillDir))
  assert.equal(entry.synced_at, NOW)
  assert.equal(entry.source.plugin_root, dirname(dirname(pluginSkillDir)))
  assert.ok(existsSync(join(agentTeamDir, SKILLS_REGISTRY)))
})

test('syncSkills 撞名报错、不复制', () => {
  const { home, projectRoot, agentTeamDir } = world()
  put(join(home, '.claude', 'skills', 'same', 'SKILL.md'), skillMd('用户层的'))
  put(join(projectRoot, '.claude', 'skills', 'same', 'SKILL.md'), skillMd('项目层的'))
  const { installed } = discoverSkills({ home, projectRoot })
  const dup = syncSkills({ agentTeamDir, installed, names: ['same'], roles: ['at-ui'], now: NOW })
  assert.equal(dup.synced.length, 0)
  assert.match(dup.errors[0].message, /user\/same.*project\/same|project\/same.*user\/same/)
  assert.equal(existsSync(join(agentTeamDir, SKILLS_DIR, 'same')), false)
  const byRef = syncSkills({ agentTeamDir, installed, names: ['project/same'], roles: ['at-ui'], now: NOW })
  assert.deepEqual(byRef.errors, [])
})

test('syncSkills 不带角色时沿用原有的；新登记却没给角色的报错', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  const fresh = syncSkills({ agentTeamDir, installed, names: ['plain'], roles: null, now: NOW })
  assert.equal(fresh.synced.length, 0)
  assert.equal(fresh.errors.length, 1)
  syncSkills({ agentTeamDir, installed, names: ['plain'], roles: ['at-qa'], now: NOW })
  const again = syncSkills({ agentTeamDir, installed, names: ['plain'], roles: null, now: '2026-11-06T00:00:00.000Z' })
  assert.deepEqual(again.errors, [])
  assert.deepEqual(again.synced.map((s) => s.name), ['plain'])
  assert.deepEqual(readRegistry(agentTeamDir).skills.plain.roles, ['at-qa'])
  assert.equal(readRegistry(agentTeamDir).skills.plain.synced_at, '2026-11-06T00:00:00.000Z')
})

test('assignRoles 只改角色、不复制', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  syncSkills({ agentTeamDir, installed, names: ['plain'], roles: ['at-qa'], now: NOW })
  rmSync(join(agentTeamDir, SKILLS_DIR, 'plain'), { recursive: true })
  const r = assignRoles({ agentTeamDir, names: ['plain'], roles: ['at-qa', 'at-ui'] })
  assert.deepEqual(r.assigned, ['plain'])
  assert.deepEqual(readRegistry(agentTeamDir).skills.plain.roles, ['at-qa', 'at-ui'])
  assert.equal(existsSync(join(agentTeamDir, SKILLS_DIR, 'plain')), false)
  assert.equal(assignRoles({ agentTeamDir, names: ['nope'], roles: ['at-ui'] }).errors.length, 1)
})

test('check reports deleted copy', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  syncSkills({ agentTeamDir, installed, names: ['ui-kit:polish'], roles: ['at-ui'], now: NOW })
  rmSync(join(agentTeamDir, SKILLS_DIR, 'ui-kit__polish'), { recursive: true })
  const r = checkSkills({ agentTeamDir, installed })
  assert.deepEqual(r.copy_missing, ['ui-kit:polish'])
  assert.deepEqual(r.unchanged, [])
})

test('check follows plugin upgrade', () => {
  const { home, projectRoot, agentTeamDir, pluginRoot, writePlugins } = world()
  syncSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed, names: ['ui-kit:polish'], roles: ['at-ui'], now: NOW })
  const next = join(pluginRoot('1.1.0'), 'skills', 'polish')
  put(join(next, 'SKILL.md'), skillMd('把界面打磨得更好，第二版'))
  put(join(next, 'references', 'a.md'), '参考\n')
  writePlugins('1.1.0')
  const r = checkSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed })
  assert.deepEqual(r.missing, [])
  assert.equal(r.changed.length, 1)
  assert.equal(r.changed[0].name, 'ui-kit:polish')
  assert.equal(r.changed[0].version_from, '1.0.0')
  assert.equal(r.changed[0].version_to, '1.1.0')
  assert.deepEqual(r.changed[0].files, [{ rel: 'SKILL.md', status: 'modified' }])
  assert.equal(r.changed[0].source_path, next)
})

test('checkSkills 原件不见了报 missing，没变报 unchanged', () => {
  const { home, projectRoot, agentTeamDir } = world()
  syncSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed, names: ['plain', 'ui-kit:polish'], roles: ['at-ui'], now: NOW })
  rmSync(join(home, '.claude', 'skills', 'plain'), { recursive: true })
  const r = checkSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed })
  assert.deepEqual([r.missing, r.unchanged, r.changed], [['plain'], ['ui-kit:polish'], []])
})

test('removeSkills 删副本与清单那一条，不碰原件', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  syncSkills({ agentTeamDir, installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  const r = removeSkills({ agentTeamDir, names: ['plain'] })
  assert.deepEqual(r.removed, ['plain'])
  assert.equal(existsSync(join(agentTeamDir, SKILLS_DIR, 'plain')), false)
  assert.equal(readRegistry(agentTeamDir).skills.plain, undefined)
  assert.ok(existsSync(join(home, '.claude', 'skills', 'plain', 'SKILL.md')))
})

test('清单里被改过的 dir 与名字走不出 .agent-team/skills', () => {
  const { root, home, projectRoot, agentTeamDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  syncSkills({ agentTeamDir, installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  const victim = join(root, 'victim')
  put(join(victim, 'keep.txt'), '别删我')
  const reg = JSON.parse(readFileSync(join(agentTeamDir, SKILLS_REGISTRY), 'utf8'))
  reg.skills.plain.dir = '../../victim'
  reg.skills['..'] = { ...reg.skills.plain, dir: '..' }
  writeFileSync(join(agentTeamDir, SKILLS_REGISTRY), JSON.stringify(reg))
  const c = checkSkills({ agentTeamDir, installed })
  assert.deepEqual(c.unchanged, ['plain'])
  const r = removeSkills({ agentTeamDir, names: ['..', 'plain'] })
  assert.deepEqual(r.removed, ['plain'])
  assert.equal(r.errors[0].name, '..')
  assert.ok(existsSync(join(victim, 'keep.txt')))
  assert.ok(existsSync(join(agentTeamDir, SKILLS_REGISTRY)))
})

test('复制与指纹都不跟软链接走出 skill 目录', (t) => {
  const { root, home, projectRoot, agentTeamDir } = world()
  const secret = join(root, 'secret')
  put(join(secret, 'id_rsa'), '私钥')
  const plainDir = join(home, '.claude', 'skills', 'plain')
  symlinkSync(secret, join(plainDir, 'leak-dir'), 'junction')
  try {
    symlinkSync(join(secret, 'id_rsa'), join(plainDir, 'leak.txt'), 'file')
  } catch (e) {
    t.skip(`这台机器建不了文件软链接：${e.code}`)
    return
  }
  const { installed } = discoverSkills({ home, projectRoot })
  syncSkills({ agentTeamDir, installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  assert.equal(existsSync(join(agentTeamDir, SKILLS_DIR, 'plain', 'leak-dir', 'id_rsa')), false)
  assert.equal(existsSync(join(agentTeamDir, SKILLS_DIR, 'plain', 'leak.txt')), false)
  const before = hashSkillDir(join(home, '.claude', 'skills', 'plain'))
  put(join(secret, 'id_rsa'), '换了的私钥')
  assert.equal(hashSkillDir(join(home, '.claude', 'skills', 'plain')), before)
})

test('skill 目录本身是链进来的（目录联接）照常认得、照常复制', () => {
  const { root, home, projectRoot, agentTeamDir } = world()
  const repo = join(root, 'repos', 'fancy-ui')
  put(join(repo, 'SKILL.md'), skillMd('链进来的'))
  symlinkSync(repo, join(home, '.claude', 'skills', 'fancy-ui'), 'junction')
  const { installed } = discoverSkills({ home, projectRoot })
  assert.ok(installed.some((s) => s.ref === 'user/fancy-ui'))
  syncSkills({ agentTeamDir, installed, names: ['fancy-ui'], roles: ['at-ui'], now: NOW })
  assert.ok(existsSync(join(agentTeamDir, SKILLS_DIR, 'fancy-ui', 'SKILL.md')))
})

// ---- 终审之后的修补 ----

test('两个市场里同名的插件都列出来、ref 带市场，按名字认到启用着的那一个', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const other = join(home, 'plugcache', 'ui-kit-other', '2.0.0')
  put(join(other, 'skills', 'polish', 'SKILL.md'), skillMd('另一个市场的同名插件'))
  const list = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
  list.plugins['ui-kit@other'] = [{ scope: 'user', installPath: other, version: '2.0.0' }]
  put(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(list))
  put(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ui-kit@mkt': false, 'ui-kit@other': true } }))
  const { installed } = discoverSkills({ home, projectRoot })
  const both = installed.filter((s) => s.name === 'ui-kit:polish')
  assert.deepEqual(both.map((s) => [s.ref, s.enabled]).sort(), [['ui-kit@mkt:polish', false], ['ui-kit@other:polish', true]])
  const r = syncSkills({ agentTeamDir, installed, names: ['ui-kit:polish'], roles: ['at-ui'], now: NOW })
  assert.deepEqual(r.errors, [])
  assert.equal(readRegistry(agentTeamDir).skills['ui-kit:polish'].source.ref, 'ui-kit@other:polish')
})

test('installed_plugins.json 版本认不出、形状变了，都进 errors', () => {
  const { home, projectRoot } = world()
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json')
  const base = JSON.parse(readFileSync(file, 'utf8'))
  put(file, JSON.stringify({ ...base, version: 99 }))
  let r = discoverSkills({ home, projectRoot })
  assert.ok(r.installed.some((s) => s.kind === 'plugin'), '版本认不出也照旧试着读')
  assert.match(r.errors.map((e) => e.message).join('\n'), /版本/)
  put(file, JSON.stringify({ version: 2, plugins: { 'ui-kit@mkt': { scope: 'user', installPath: 'x' } } }))
  assert.equal(discoverSkills({ home, projectRoot }).errors.length, 1)
  put(file, JSON.stringify({ version: 2, plugins: { 'ui-kit@mkt': [{ scope: 'user', path: 'x' }] } }))
  assert.equal(discoverSkills({ home, projectRoot }).errors.length, 1)
  put(file, 'null')
  r = discoverSkills({ home, projectRoot })
  assert.equal(r.errors.length, 1)
  assert.ok(r.installed.some((s) => s.kind === 'user'))
})

test('check 报出项目里被改过的副本', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  syncSkills({ agentTeamDir, installed, names: ['plain', 'cloned'], roles: ['at-ui'], now: NOW })
  put(join(agentTeamDir, SKILLS_DIR, 'plain', 'SKILL.md'), '被人改过\n')
  rmSync(join(agentTeamDir, SKILLS_DIR, 'cloned', 'SKILL.md'))
  const r = checkSkills({ agentTeamDir, installed })
  assert.deepEqual(r.copy_changed, ['cloned', 'plain'])
  assert.deepEqual(r.unchanged, [])
})

test('已登记、本机原件又变了的，sync 不带 update 拒绝、副本不动；带 update 才换', () => {
  const { home, projectRoot, agentTeamDir } = world()
  syncSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  put(join(home, '.claude', 'skills', 'plain', 'SKILL.md'), skillMd('第二版'))
  const installed = discoverSkills({ home, projectRoot }).installed
  const refused = syncSkills({ agentTeamDir, installed, names: ['plain'], roles: ['at-ui', 'at-qa'], now: NOW })
  assert.equal(refused.synced.length, 0)
  assert.match(refused.errors[0].message, /update/)
  assert.ok(readFileSync(join(agentTeamDir, SKILLS_DIR, 'plain', 'SKILL.md'), 'utf8').includes('普通的用户层 skill'))
  assert.deepEqual(readRegistry(agentTeamDir).skills.plain.roles, ['at-ui'])
  const ok = syncSkills({ agentTeamDir, installed, names: ['plain'], roles: null, now: NOW, update: true })
  assert.deepEqual(ok.errors, [])
  assert.ok(readFileSync(join(agentTeamDir, SKILLS_DIR, 'plain', 'SKILL.md'), 'utf8').includes('第二版'))
})

test('assignRoles 能只加、只减，不丢原来分给的', () => {
  const { home, projectRoot, agentTeamDir } = world()
  syncSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  assignRoles({ agentTeamDir, names: ['plain'], add: ['at-qa', 'at-ui'] })
  assert.deepEqual(readRegistry(agentTeamDir).skills.plain.roles, ['at-ui', 'at-qa'])
  assignRoles({ agentTeamDir, names: ['plain'], remove: ['at-ui'] })
  assert.deepEqual(readRegistry(agentTeamDir).skills.plain.roles, ['at-qa'])
  assert.equal(assignRoles({ agentTeamDir, names: ['plain'], remove: ['at-qa'] }).errors.length, 1, '减到一个都不剩的拒绝')
  assert.deepEqual(readRegistry(agentTeamDir).skills.plain.roles, ['at-qa'])
})

test('skill 里会被平台自动加载的位置不复制、不进指纹，并报出跳过了什么', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const dir = join(home, '.claude', 'skills', 'plain')
  const before = hashSkillDir(dir)
  put(join(dir, 'CLAUDE.md'), '开发用的说明')
  put(join(dir, 'claude.local.md'), '本地说明')
  put(join(dir, '.claude', 'skills', 'inner', 'SKILL.md'), skillMd('嵌套的'))
  put(join(dir, '.agent-team', 'current-run'), 'x')
  put(join(dir, '.git'), 'gitdir: ../somewhere\n')
  put(join(dir, 'docs', 'CLAUDE.md'), '子目录里的')
  assert.equal(hashSkillDir(dir), before)
  assert.deepEqual(readSkillMeta(dir).skipped, ['.agent-team', '.claude', '.git', 'CLAUDE.md', 'claude.local.md', 'docs/CLAUDE.md'])
  syncSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  for (const rel of ['CLAUDE.md', 'claude.local.md', '.claude', '.agent-team', '.git', 'docs/CLAUDE.md']) {
    assert.equal(existsSync(join(agentTeamDir, SKILLS_DIR, 'plain', ...rel.split('/'))), false, rel)
  }
})

test('同步写下占位符的对应关系：自己目录指项目里的副本，插件根指原插件目录', () => {
  const { home, projectRoot, agentTeamDir, pluginSkillDir } = world()
  syncSkills({ agentTeamDir, installed: discoverSkills({ home, projectRoot }).installed, names: ['ui-kit:polish', 'plain'], roles: ['at-ui'], now: NOW })
  const reg = readRegistry(agentTeamDir).skills
  const slash = (p) => p.split('\\').join('/')
  assert.deepEqual(reg['ui-kit:polish'].placeholders, {
    '${CLAUDE_PLUGIN_ROOT}/skills/polish': '.agent-team/skills/ui-kit__polish',
    '${CLAUDE_SKILL_DIR}': '.agent-team/skills/ui-kit__polish',
    '${CLAUDE_PLUGIN_ROOT}': slash(dirname(dirname(pluginSkillDir))),
  })
  assert.deepEqual(reg.plain.placeholders, { '${CLAUDE_SKILL_DIR}': '.agent-team/skills/plain' })
})

test('skills 目录、副本目录、清单被换成链接时不跟着写、不跟着删', () => {
  const { root, home, projectRoot, agentTeamDir } = world()
  const { installed } = discoverSkills({ home, projectRoot })
  const outside = join(root, 'outside')
  put(join(outside, 'keep.txt'), '别动我')
  // 副本目录是一个指向项目外的目录联接：sync 不写进去，remove 不删它指着的东西。
  syncSkills({ agentTeamDir, installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  rmSync(join(agentTeamDir, SKILLS_DIR, 'plain'), { recursive: true })
  symlinkSync(outside, join(agentTeamDir, SKILLS_DIR, 'plain'), 'junction')
  const s = syncSkills({ agentTeamDir, installed, names: ['plain'], roles: null, now: NOW })
  assert.equal(s.synced.length, 0)
  assert.equal(existsSync(join(outside, 'SKILL.md')), false)
  assert.deepEqual(checkSkills({ agentTeamDir, installed }).copy_changed, ['plain'])
  const r = removeSkills({ agentTeamDir, names: ['plain'] })
  assert.equal(r.removed.length, 0)
  assert.ok(existsSync(join(outside, 'keep.txt')))
  // skills 目录本身是联接：同样拒。
  const fresh = world()
  const elsewhere = join(fresh.root, 'elsewhere')
  put(join(elsewhere, 'keep.txt'), '别动我')
  symlinkSync(elsewhere, join(fresh.agentTeamDir, SKILLS_DIR), 'junction')
  const t = syncSkills({ agentTeamDir: fresh.agentTeamDir, installed: discoverSkills({ home: fresh.home, projectRoot: fresh.projectRoot }).installed, names: ['plain'], roles: ['at-ui'], now: NOW })
  assert.equal(t.synced.length, 0)
  assert.equal(existsSync(join(elsewhere, 'plain')), false)
})

test('assertRoles 拒 at-outsider 与花名册外的名字', () => {
  assert.throws(() => assertRoles(['at-outsider'], roster))
  assert.throws(() => assertRoles(['nobody'], roster))
  assert.throws(() => assertRoles([], roster))
  assertRoles(['at-ui', 'at-pm', 'at-qa'], roster)
})

test('readRegistry 读到坏 JSON 抛错、不改文件', () => {
  const { agentTeamDir } = world()
  assert.deepEqual(readRegistry(agentTeamDir), { skills: {} })
  put(join(agentTeamDir, SKILLS_REGISTRY), '{bad')
  assert.throws(() => readRegistry(agentTeamDir), /^Error: skills\.json 读不出来：/)
  assert.equal(readFileSync(join(agentTeamDir, SKILLS_REGISTRY), 'utf8'), '{bad')
})
