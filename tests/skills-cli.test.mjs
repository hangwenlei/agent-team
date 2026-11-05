// 项目经理经 Bash 调的 skill 命令行（hooks/skills-cli.mjs）：输出一份 JSON、正常退出码 0、用法不对或清单读不出来退出码 2。
// 子进程经 tests/helpers/gate-runner.mjs 的 run 起（它不是门禁，不核钩子的输出契约）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, hermeticEnv } from './helpers/gate-runner.mjs'
import { world } from './helpers/skills-world.mjs'

const CLI = fileURLToPath(new URL('../hooks/skills-cli.mjs', import.meta.url))
const cliIn = (cwd) => (sub, args) => run(sub, '', CLI, cwd, hermeticEnv(), { contract: false, args })

test('cli list 输出 JSON、退出码 0', () => {
  const { home, projectRoot } = world()
  const r = cliIn(projectRoot)('list', ['--home', home])
  assert.equal(r.status, 0)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.installed.map((s) => s.ref).sort(), ['project/local-one', 'ui-kit@mkt:polish', 'user/cloned', 'user/plain'])
  assert.deepEqual(out.installed.find((s) => s.ref === 'user/plain').registered_roles, [])
})

test('cli sync 之后 list 带出登记给谁；再 check：没变时 changed 与 missing 都空', () => {
  const { home, projectRoot } = world()
  const cli = cliIn(projectRoot)
  const s = JSON.parse(cli('sync', ['ui-kit:polish', '--roles', 'at-ui,at-frontend', '--home', home]).stdout)
  assert.deepEqual(s.errors, [])
  const l = JSON.parse(cli('list', ['--home', home]).stdout)
  assert.deepEqual(l.installed.find((x) => x.ref === 'ui-kit@mkt:polish').registered_roles, ['at-ui', 'at-frontend'])
  const c = JSON.parse(cli('check', ['--home', home]).stdout)
  assert.deepEqual([c.changed, c.missing, c.copy_missing, c.copy_changed, c.unchanged], [[], [], [], [], ['ui-kit:polish']])
})

test('cli refuses broken registry', () => {
  const { home, projectRoot, agentTeamDir } = world()
  writeFileSync(join(agentTeamDir, 'skills.json'), '{bad')
  const cli = cliIn(projectRoot)
  for (const [sub, args] of [['list', []], ['check', []], ['sync', ['ui-kit:polish', '--roles', 'at-ui']], ['assign', ['plain', '--add', 'at-ui']], ['remove', ['plain']]]) {
    const r = cli(sub, [...args, '--home', home])
    assert.equal(r.status, 2, sub)
    assert.match(JSON.parse(r.stdout).error, /^skills\.json 读不出来：/, sub)
  }
  assert.equal(readFileSync(join(agentTeamDir, 'skills.json'), 'utf8'), '{bad')
})

test('cli sync 对已登记、本机又变了的要带 --update；assign --add 只加不丢', () => {
  const { home, projectRoot } = world()
  const cli = cliIn(projectRoot)
  cli('sync', ['plain', '--roles', 'at-ui', '--home', home])
  writeFileSync(join(home, '.claude', 'skills', 'plain', 'SKILL.md'), '---\ndescription: 第二版\n---\n')
  assert.equal(JSON.parse(cli('sync', ['plain', '--home', home]).stdout).errors.length, 1)
  assert.deepEqual(JSON.parse(cli('sync', ['plain', '--update', '--home', home]).stdout).errors, [])
  assert.deepEqual(JSON.parse(cli('assign', ['plain', '--add', 'at-qa', '--home', home]).stdout).assigned, ['plain'])
  const l = JSON.parse(cli('list', ['--home', home]).stdout)
  assert.deepEqual(l.installed.find((x) => x.ref === 'user/plain').registered_roles, ['at-ui', 'at-qa'])
})

test('cli 拒 --roles at-outsider，什么都不写', () => {
  const { home, projectRoot, agentTeamDir } = world()
  const r = cliIn(projectRoot)('sync', ['ui-kit:polish', '--roles', 'at-outsider', '--home', home])
  assert.equal(r.status, 2)
  assert.throws(() => readFileSync(join(agentTeamDir, 'skills.json')))
})

test('cli 在没有 .agent-team 的目录里退出码 2', () => {
  const { home } = world()
  const empty = realpathSync(mkdtempSync(join(tmpdir(), 'at-skills-empty-')))
  const r = cliIn(empty)('list', ['--home', home])
  assert.equal(r.status, 2)
  assert.ok(JSON.parse(r.stdout).error)
})

test('cli 认不出的子命令退出码 2', () => {
  const { home, projectRoot } = world()
  assert.equal(cliIn(projectRoot)('frobnicate', ['--home', home]).status, 2)
})

test('cli remove 与 assign 走得通', () => {
  const { home, projectRoot } = world()
  const cli = cliIn(projectRoot)
  cli('sync', ['plain', '--roles', 'at-qa', '--home', home])
  assert.deepEqual(JSON.parse(cli('assign', ['plain', '--roles', 'at-ui', '--home', home]).stdout).assigned, ['plain'])
  assert.deepEqual(JSON.parse(cli('remove', ['plain', '--home', home]).stdout).removed, ['plain'])
})
