// docs/83（docs/42 §4「不核的几种时候一声不吭」）：项目经理写完 .agent-team/reach.json，门禁按当前 project.json 与花名册重算核一遍——对不上就回一段【触达表】。
// 有几种时候门禁核不了（project.json 有阻断、花名册读不出、刚写的 reach.json 读不出、project.json 不在），原来一声不吭；/agent-team:at-init 却说「这一次没再
// 收到【触达表】，就是对上了」——没核被读成了对上。现在核不了时也回一段【触达表】：说这一次没有核、为什么、怎么办，并点明没收到核对结果不等于对上了。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, GATE, decisionOf } from './helpers/gate-runner.mjs'
import { failRead } from './helpers/fail-read.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { computeReach } from '../hooks/lib/reach.mjs'

const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
const ROSTER = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
const GOOD = JSON.stringify(computeReach({ roster: ROSTER, paths: TEMPLATE.paths }))
const posted = (file_path, agent_type = 'agent-team:at-pm') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type, tool_input: { file_path } })
const ctxOf = (r) => decisionOf(r.stdout)?.additionalContext ?? ''
const UNCHECKED = '【触达表】这一次没有核刚写进 .agent-team/reach.json 的那一份'
const NOT_MATCHED = '没收到核对结果不等于对上了'

// 写 reach.json（落盘之后的账本）。run：有没有一趟 run；project：project.json 的内容（null 是不在）；reach：reach.json 的原文（DIR 是建成目录）。
const DIR = Symbol('dir')
// failProjectReads：门禁子进程读 project.json 时失败几次（tests/helpers/fail-read.mjs；Infinity 是一直失败，null 是不加载）。
// projectText：project.json 的原文（盖过 project；读得到、却解析不出的那一种用它造）。whole：返回整个结果（stdout、stderr），不只回传。
function write({ run: withRun = true, project = TEMPLATE, reach = GOOD, writer = 'agent-team:at-pm', roster = null, failProjectReads = null, projectText = null, whole = false } = {}) {
  let projectDir, cleanup
  if (withRun) {
    const dirs = makeRun({ runId: 'r1', stage: 'S1', project: project ?? null })
    projectDir = dirs.projectDir
    cleanup = () => {
      rmSync(dirs.projectDir, { recursive: true, force: true })
      rmSync(dirs.pluginDir, { recursive: true, force: true })
    }
  } else {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-r41-')))
    mkdirSync(join(projectDir, '.agent-team'), { recursive: true })
    if (project) writeFileSync(join(projectDir, '.agent-team', 'project.json'), JSON.stringify(project))
    cleanup = () => rmSync(projectDir, { recursive: true, force: true })
  }
  if (projectText !== null) writeFileSync(join(projectDir, '.agent-team', 'project.json'), projectText)
  const plugin = roster === null ? null : realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-r41-plug-')))
  try {
    let gate = GATE
    if (plugin) {
      const REPO = new URL('../', import.meta.url)
      cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
      cpSync(new URL('stages.json', REPO), join(plugin, 'stages.json'))
      writeFileSync(join(plugin, 'roster.json'), roster)
      gate = join(plugin, 'hooks', 'boot.mjs')
    }
    const target = join(projectDir, '.agent-team', 'reach.json')
    if (reach === DIR) mkdirSync(target)
    else writeFileSync(target, reach)
    const r =
      failProjectReads === null
        ? run('ledger', posted(target, writer), gate, projectDir)
        : run('ledger', posted(target, writer), gate, projectDir, ...Object.values(failRead('project.json', failProjectReads)))
    return whole ? r : ctxOf(r)
  } finally {
    cleanup()
    if (plugin) rmSync(plugin, { recursive: true, force: true })
  }
}

test('reach.json 核对（docs/83）：project.json 有阻断——说这一次没有核、先改好 project.json，没收到核对结果不等于对上了', () => {
  for (const withRun of [true, false]) {
    const BLOCKED = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['../'] } }
    const c = write({ run: withRun, project: BLOCKED })
    assert.ok(c.includes(UNCHECKED) && c.includes('project.json 有阻断') && c.includes(NOT_MATCHED), `${withRun}：${c}`)
  }
})

test('reach.json 核对（docs/83）：花名册读不出（插件问题）——说这一次没有核、不要照它改，告诉用户重装或更新插件', () => {
  const c = write({ roster: '{ 坏了' })
  assert.ok(c.includes(UNCHECKED) && c.includes('花名册读不出') && c.includes(NOT_MATCHED), c)
  // 复核（docs/83 §8）：出路与写 project.json 那一次看齐——重装或更新插件之后新开会话再跑 at-init；刚写的这一份不当成上一份配置。
  assert.ok(c.includes('新开一个会话再跑 /agent-team:at-init 落盘') && c.includes('不要把它当成上一份配置'), c)
  assert.ok(!c.includes('把下面这份 JSON 原样重写进'), c)
})

test('reach.json 核对（docs/83）：刚写的 reach.json 读不出来——说这一次没有核、再写一次', () => {
  const c = write({ reach: DIR })
  assert.ok(c.includes(UNCHECKED) && c.includes('读不出来') && c.includes(NOT_MATCHED), c)
})

test('reach.json 核对（docs/83）：project.json 不在——有 run、没有 run 两条路都说这一次没有核、先写好 project.json', () => {
  for (const withRun of [true, false]) {
    const c = write({ run: withRun, project: null })
    assert.ok(c.includes(UNCHECKED) && c.includes('.agent-team/project.json 不在') && c.includes(NOT_MATCHED), `${withRun}：${c}`)
  }
})

test('reach.json 核对（docs/83）：对得上照旧不出声；不是项目经理写的，核不了的那一句后面叫它原样冒泡', () => {
  assert.ok(!write({}).includes('【触达表】'))
  const c = write({ writer: 'agent-team:at-backend', project: null, run: false })
  assert.ok(c.includes(UNCHECKED) && c.includes('原样冒泡给派你的人'), c)
})

// 复核（docs/83 §8，中）：没有 run 时（at-init）project.json 这一刻读不出（被短暂占用）——重读最多三次：读到了照常核，一直读不到说这一次没有核。
// 复核（docs/87 §8，低 6）：有 run 时同样——运行上下文那一次读不出，写 reach.json 那一条缝重读读到了照常核，一直读不到说这一次没有核。
test('reach.json 核对（docs/83 §8）：at-init 时 project.json 被短暂占用——重读读到了照常核；一直读不到说这一次没有核、过一会儿再写', () => {
  for (const withRun of [false, true]) {
    const once = write({ run: withRun, reach: '{}', failProjectReads: 1 })
    assert.ok(once.includes('把下面这份 JSON 原样重写进 .agent-team/reach.json'), `${withRun}：${once}`)
    const always = write({ run: withRun, reach: '{}', failProjectReads: Infinity })
    assert.ok(always.includes(UNCHECKED) && always.includes('project.json 这一刻读不出来') && always.includes(NOT_MATCHED), `${withRun}：${always}`)
  }
  const other = write({ run: false, reach: '{}', failProjectReads: Infinity, writer: 'agent-team:at-backend' })
  assert.ok(other.includes('不要自己写 project.json 或 reach.json'), other)
})

// docs/87（docs/83 §4「project.json 读得到、却解析不出时……不提 reach.json 没核」）：原来写 reach.json 那一条缝放过它，落到「它在别处被弄坏」那一条缝，
// 只说 project.json 的问题——没核被读成了对上。现在同一次回传里两段都说：先说这一次没有核，再说 project.json 的问题（UTF-16 的照旧点明）。
test('reach.json 核对（docs/87）：project.json 读得到、却解析不出——有 run、没有 run 都说这一次没有核，同一次回传里照旧说 project.json 的问题', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(TEMPLATE), 'utf16le')])
  for (const withRun of [true, false]) {
    const r = write({ run: withRun, projectText: '{ "paths": {}, }', whole: true })
    const c = ctxOf(r)
    assert.ok(c.includes(UNCHECKED) && c.includes(NOT_MATCHED) && c.includes('project.json 解析不出'), `${withRun}：${c}`)
    assert.ok(c.includes('【project.json】') && c.indexOf(UNCHECKED) < c.indexOf('【project.json】'), `${withRun}：${c}`)
    assert.equal(c.includes('run 进行中'), withRun, `${withRun}：${c}`)
    // 复核（docs/87 §8，中 1、中 2）：出路钉住；刚写的是 reach.json，不说「刚写进去的 project.json」；有 run 时也不叫它原样重写 reach.json、不说哈希
    // 回传不了——两段说同一条出路：改好 project.json，照写它那一次的【触达表】重写。
    assert.ok(c.includes('改好之后，写它那一次的【触达表】给出正确的那一份，照它重写 reach.json'), `${withRun}：${c}`)
    assert.ok(c.includes('改好就会收到报告与【触达表】那一段'), `${withRun}：${c}`)
    for (const w of ['刚写进去的', '原样重写一次刚才那个文件', '哈希这时也回传不了']) assert.ok(!c.includes(w), `${withRun}：「${w}」：${c}`)
    // 复核（低 1）：有 run 时留痕（fail open 的那一行），没有 run 时不留。
    assert.equal(r.stderr.includes('agent-team ledger 回传：读不到运行上下文'), withRun, `${withRun}：${r.stderr}`)
    if (!withRun) assert.ok(!r.stderr.includes('ledger 回传'), r.stderr)
    // UTF-16 的照旧点明编码（brokenProjectNotice 的 utf16 那一支），有没有 run 都是。
    const u = write({ run: withRun, projectText: utf16 })
    assert.ok(u.includes(UNCHECKED) && u.includes('UTF-16'), `${withRun}：${u}`)
  }
  // 不是项目经理写的：两段都归项目经理，叫它把这两段原样冒泡（复核低 3：只说「这一段」，照字面冒泡上去的是悬空的「下一段说怎么改」）。
  const other = write({ run: false, projectText: '[1, 2]', writer: 'agent-team:at-backend' })
  assert.ok(other.includes(UNCHECKED) && other.includes('把这两段原样冒泡给派你的人'), other)
})

test('正文（docs/83）：/agent-team:at-init 说清收到「这一次没有核」的不算对上', () => {
  const s = readFileSync(new URL('../commands/at-init.md', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
  assert.ok(s.includes('这一次没再收到【触达表】，就是对上了；收到的是「这一次没有核」那一段的，照它说的做，不算对上'), s.slice(s.indexOf('回传里还有一段【触达表】'), s.indexOf('回传里还有一段【触达表】') + 600))
})
