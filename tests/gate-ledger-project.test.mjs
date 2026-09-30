// ledger 的【project.json】回传（M3u，docs/29，全量审查第 10 条）。
//
// project.json 的形状问题只有 PM 改得了，所以要在 PM 看得见的地方说出来：
//   - PM 写 project.json 时（有 run、没有 run 两条路）：三档全报——阻断、要改、请确认；
//   - project.json 写坏（解析不出、不是对象）时：一句固定的话，不回显文件内容（docs/27）；
//   - 每趟 run 开头 PM 写 current-run 时：整份报一次（已装用户的旧配置在 S1 就露面，不等到 S5 撞上拒绝）；
//   - PM 写 state.json 时：只报阻断（覆盖升级前开始、升级后续跑的 run；不报警告，免得每次记账都刷一遍）。
// 没有问题时一个字都不发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
const posted = (file_path) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'agent-team:at-pm', tool_input: { file_path } })
const ctxOf = (r) => decisionOf(r.stdout)?.additionalContext ?? ''

function withRun(project, body) {
  const dirs = makeRun({ runId: 'r1', stage: 'S1', project })
  try {
    return body(dirs.projectDir, join(dirs.projectDir, '.agent-team', 'runs', 'r1'))
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

function withoutRun(body) {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-lp-')))
  try {
    mkdirSync(join(p, '.agent-team'), { recursive: true })
    return body(p)
  } finally {
    rmSync(p, { recursive: true, force: true })
  }
}

const TYPO = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-fronted': ['src/web/'] } }
const BLOCKED = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['../'] } }
const CONFIRM_ONLY = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-product': ['docs/'] } }

// ---- 写 project.json ----

test('写 project.json（没有 run，/agent-team:at-init 的正路）：有问题就报【project.json】，在【触达表】之前', () => {
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('【触达表】'), ctx)
    assert.ok(ctx.indexOf('【project.json】') < ctx.indexOf('【触达表】'), ctx)
    assert.ok(ctx.includes('"at-fronted"'), ctx)
    assert.match(ctx, /要改/)
  })
})

test('写 project.json（run 进行中）：阻断、要改、请确认三档各有标题', () => {
  withRun(TEMPLATE, (p) => {
    const project = { ...BLOCKED, paths: { ...BLOCKED.paths, 'at-fronted': ['x/'], 'at-product': ['docs/'] } }
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(project))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
    for (const s of ['【project.json】', '阻断', '要改', '请确认', '"../"', '"at-fronted"', '"docs/"']) assert.ok(ctx.includes(s), `${s}：${ctx}`)
  })
})

test('写 project.json：模板原样（问题一条都没有）时不报【project.json】，照发【触达表】', () => {
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TEMPLATE))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
    assert.ok(!ctx.includes('【project.json】'), ctx)
    assert.ok(ctx.includes('【触达表】'), ctx)
  })
})

// ---- 写坏 ----

for (const [label, text] of [
  ['语法错', '{ "paths": { '],
  ['尾逗号', '{ "paths": {}, }'],
  ['顶层是数组', '[]'],
  ['顶层是 null', 'null'],
]) {
  test(`写坏的 project.json（${label}）：没有 run、有 run 两种状态下都报一句固定的话，不回显文件内容、不发触达表`, () => {
    const check = (p) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), text)
      const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
      assert.ok(ctx.includes('【project.json】') && ctx.includes('不是一个合法的 JSON 对象'), ctx)
      assert.ok(!ctx.includes('【触达表】'), ctx)
      assert.ok(!ctx.includes(text.trim()) || text.trim().length < 3, `回显了文件内容：${ctx}`)
    }
    withoutRun(check)
    withRun(TEMPLATE, check)
  })
}

// ---- 每趟 run 开头 ----

test('写 current-run：project.json 有问题就整份报一次；没有问题时不报', () => {
  withRun(TYPO, (p) => {
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'current-run')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('"at-fronted"'), ctx)
  })
  withRun(TEMPLATE, (p) => {
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'current-run')), undefined, p))
    assert.ok(!ctx.includes('【project.json】'), ctx)
  })
})

test('写 current-run：run 已经建起来而 project.json 不在——报出来，指向 /agent-team:at-init', () => {
  withRun(null, (p) => {
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'current-run')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('不在') && ctx.includes('/agent-team:at-init'), ctx)
  })
})

// ---- 写 state.json ----

test('写 state.json：只报阻断——只有要改或请确认的问题时不报', () => {
  withRun(BLOCKED, (p, runDir) => {
    const ctx = ctxOf(run('ledger', posted(join(runDir, 'state.json')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('"../"'), ctx)
    assert.ok(!ctx.includes('请确认'), ctx)
  })
  for (const project of [TYPO, CONFIRM_ONLY, TEMPLATE]) {
    withRun(project, (p, runDir) => {
      const ctx = ctxOf(run('ledger', posted(join(runDir, 'state.json')), undefined, p))
      assert.ok(!ctx.includes('【project.json】'), ctx)
    })
  }
})
