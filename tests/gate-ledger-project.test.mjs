// ledger 的【project.json】回传（M3u，docs/29，全量审查第 10 条）。
//
// project.json 的形状问题只有 PM 改得了，所以要在 PM 看得见的地方说出来：
//   - PM 写 project.json 时（有 run、没有 run 两条路）：三档全报——阻断、要改、请确认；
//   - project.json 写坏（解析不出、不是对象）时：一句固定的话，不回显文件内容（docs/27）；
//   - project.json 在别处被弄坏（用户手改加了注释、尾逗号）而 run 在：写 .agent-team 下任何文件都回传那句固定的话
//     的变体——此前这一格整趟 run 一声不吭，PM 拿不到契约哈希，只能按「门禁没在跑」停下；
//   - 每趟 run 开头 PM 写 current-run 时：整份报一次（已装用户的旧配置在 S1 就露面，不等到 S5 撞上拒绝）；
//   - PM 写 state.json 时：只报阻断（覆盖升级前开始、升级后续跑的 run；不报警告，免得每次记账都刷一遍）。
// 没有问题时一个字都不发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, decisionOf, hermeticEnv } from './helpers/gate-runner.mjs'
import { projectNotice } from '../hooks/lib/ledger.mjs'
import { NO_PATHS_ROLES } from '../hooks/lib/project.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
const posted = (file_path, agent_type = 'agent-team:at-pm') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type, tool_input: { file_path } })
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

// 回传里某一档的那一段：从这档标题起，到下一个出现的档标题为止。标题带全角括号去认——结尾那句「阻断与要改的，
// 改到没有为止；请确认的……」本身就含三个裸词，只查裸词什么都钉不住。
const TITLES = ['阻断（', '要改（', '请确认（']
function sectionOf(text, title) {
  const start = text.indexOf(title)
  if (start < 0) return null
  const ends = TITLES.map((t) => text.indexOf(t, start + 1)).filter((i) => i > start)
  return text.slice(start, ends.length ? Math.min(...ends) : undefined)
}

// ---- projectNotice 本身：每条挂在自己那一档底下 ----

test('projectNotice：每条条目落在自己那档标题之后、下一档标题之前；非空的档标题只出现一次，空档不出标题', () => {
  const cases = [
    { block: ['BLOCK-1'], fix: ['FIX-1', 'FIX-2'], confirm: ['CONF-1'] },
    { block: [], fix: ['FIX-1'], confirm: ['CONF-1'] },
    { block: ['BLOCK-1'], fix: [], confirm: ['CONF-1'] },
    { block: [], fix: ['FIX-1'], confirm: [] },
    { block: [], fix: [], confirm: ['CONF-1'] },
  ]
  const tierOf = { block: '阻断（', fix: '要改（', confirm: '请确认（' }
  for (const report of cases) {
    const text = projectNotice(report)
    assert.ok(text.startsWith('【project.json】'), text)
    for (const [tier, title] of Object.entries(tierOf)) {
      const count = text.split(title).length - 1
      assert.equal(count, report[tier].length ? 1 : 0, `${title}：${text}`)
      for (const item of report[tier]) {
        const sec = sectionOf(text, title)
        assert.ok(sec && sec.includes(item), `${item} 不在「${title}」那一档：${text}`)
      }
    }
  }
  assert.equal(projectNotice({ block: [], fix: [], confirm: [] }), null)
  assert.equal(projectNotice(null), null)
})

test('projectNotice 的结尾：只有要改时叫改到没有为止；只有请确认时只说确认是有意的就留着', () => {
  assert.match(projectNotice({ block: [], fix: ['FIX-1'], confirm: [] }), /改到没有为止/)
  const onlyConfirm = projectNotice({ block: [], fix: [], confirm: ['CONF-1'] })
  assert.match(onlyConfirm, /确认是有意的就留着/)
  assert.ok(!onlyConfirm.includes('改到没有为止'), onlyConfirm)
})

test('projectNotice：阻断那一档说清按角色生效——一条坏前缀让这个角色其余合法的前缀也写不了', () => {
  assert.ok(projectNotice({ block: ['BLOCK-1'], fix: [], confirm: [] }).includes('其余合法的前缀'))
})

test('projectNotice：不说「你是唯一改得了它的人」——没有 run 时 H3 对所有角色放行，收件人可能不是 PM', () => {
  const text = projectNotice({ block: [], fix: ['FIX-1'], confirm: [] })
  assert.ok(!text.includes('唯一改得了'), text)
  assert.ok(text.includes('回报给上级'), text)
})

// ---- 写 project.json ----

test('写 project.json（没有 run，/agent-team:at-init 的正路）：有问题就报【project.json】，在【触达表】之前', () => {
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('【触达表】'), ctx)
    assert.ok(ctx.indexOf('【project.json】') < ctx.indexOf('【触达表】'), ctx)
    assert.ok(ctx.includes('"at-fronted"'), ctx)
    assert.ok(sectionOf(ctx, '要改（')?.includes('"at-fronted"'), ctx)
  })
})

test('写 project.json：只有前缀级的问题（通配符、以 / 开头）时也报——它们经 validateProject 汇进报告', () => {
  withoutRun((p) => {
    const project = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['src/*'] } }
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(project))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
    assert.ok(sectionOf(ctx, '要改（')?.includes('"src/*"'), ctx)
  })
  withRun({ ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['/src/server/', 'src/shared/'] } }, (p) => {
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'current-run')), undefined, p))
    assert.ok(sectionOf(ctx, '请确认（')?.includes('"/src/server/"'), ctx)
  })
})

test('写 project.json（没有 run）的不是 PM：回传不说「你是唯一改得了它的人」，叫它回报上级', () => {
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json'), 'agent-team:at-backend'), undefined, p))
    assert.ok(ctx.includes('【project.json】'), ctx)
    assert.ok(!ctx.includes('唯一改得了') && ctx.includes('回报给上级'), ctx)
  })
})

test('写 project.json（run 进行中）：阻断、要改、请确认三档各有标题', () => {
  withRun(TEMPLATE, (p) => {
    const project = { ...BLOCKED, paths: { ...BLOCKED.paths, 'at-fronted': ['x/'], 'at-product': ['docs/'] } }
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(project))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
    assert.ok(ctx.includes('【project.json】'), ctx)
    // 按段断言：每条挂在自己那一档底下（run 进行中这一支把 validateProject 的三档原样交给 ledger）。
    for (const [title, item] of [['阻断（', '"../"'], ['要改（', '"at-fronted"'], ['请确认（', '"docs/"']]) {
      assert.ok(sectionOf(ctx, title)?.includes(item), `${item} 不在「${title}」那一档：${ctx}`)
    }
    assert.ok(ctx.includes('其余合法的前缀'), ctx)
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

test('写坏的 project.json：run 进行中补一句后果、往 stderr 留痕；没有 run 时两样都没有', () => {
  const bad = '{ "paths": { '
  withRun(TEMPLATE, (p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), bad)
    const r = run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p)
    assert.ok(ctxOf(r).includes('run 进行中'), ctxOf(r))
    assert.match(r.stderr, /ledger 回传：读不到运行上下文（/)
  })
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), bad)
    const r = run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p)
    assert.ok(ctxOf(r).includes('不是一个合法的 JSON 对象'), ctxOf(r))
    assert.ok(!ctxOf(r).includes('run 进行中'), ctxOf(r))
    assert.equal(r.stderr.trim(), '')
  })
})

test('project.json 不在（写完又被删、或者被占用读不到）：不报【project.json】，只往 stderr 留痕', () => {
  withoutRun((p) => {
    const r = run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p)
    assert.ok(!ctxOf(r).includes('【project.json】'), ctxOf(r))
    assert.match(r.stderr, /ledger 回传/)
  })
})

test('project.json 读第一次撞上占用、再读一次是合法的：照常发报告与触达表，不谎报「写坏了」', () => {
  const ebusy = fileURLToPath(new URL('./helpers/ebusy-project.cjs', import.meta.url))
  const env = (n) => ({ ...hermeticEnv(), AGENT_TEAM_TEST_EBUSY_READS: String(n) })
  // 没有 run：门禁的缝里第一次读撞上占用。
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p, env(1), { nodeArgs: ['-r', ebusy] }))
    assert.ok(ctx.includes('【触达表】') && ctx.includes('"at-fronted"'), ctx)
    assert.ok(!ctx.includes('不是一个合法的 JSON 对象'), ctx)
  })
  // run 在：读运行上下文、缝里第一次读，两次都撞上占用。
  withRun(TEMPLATE, (p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p, env(2), { nodeArgs: ['-r', ebusy] }))
    assert.ok(ctx.includes('【触达表】') && ctx.includes('"at-fronted"'), ctx)
    assert.ok(!ctx.includes('不是一个合法的 JSON 对象'), ctx)
  })
})

// ---- project.json 在别处被弄坏、run 在 ----
//
// 用户在两趟 run 之间手改 project.json（加一行注释、多一个尾逗号）：readRunContext 判 unreadable，ledger 落进
// !ctx.ok。此前那一支只认「写的正是 project.json」与「写的 state.json 本身坏了」，PM 写 state.json、current-run、
// 契约都收不到任何东西——契约哈希拿不到，at.md 的「没收到就停下：门禁没在跑」把用户引去排查一个不存在的问题。

for (const [label, text] of [
  ['尾逗号', JSON.stringify(TEMPLATE).slice(0, -1) + ',}'],
  ['带注释', '// 手改\n' + JSON.stringify(TEMPLATE)],
  ['顶层是数组', '[]'],
]) {
  test(`project.json 在别处被弄坏（${label}）、run 在：写 state.json、current-run、契约都回传【project.json】，不回显原文`, () => {
    withRun(TEMPLATE, (p, runDir) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), text)
      writeFileSync(join(runDir, '00-contract.md'), '# 契约\n')
      for (const f of [join(runDir, 'state.json'), join(p, '.agent-team', 'current-run'), join(runDir, '00-contract.md')]) {
        const ctx = ctxOf(run('ledger', posted(f), undefined, p))
        assert.ok(ctx.includes('【project.json】') && ctx.includes('不是一个合法的 JSON 对象'), `${f}：${ctx}`)
        assert.ok(!ctx.includes('刚写进去的'), ctx)
        assert.ok(ctx.includes('run 进行中'), ctx)
        assert.ok(!ctx.includes('手改') && !ctx.includes('docs/product/'), `回显了文件内容：${ctx}`)
      }
    })
  })
}

test('从零建 run、指针还没写：写第一份 state.json 时 project.json 坏了也回传', () => {
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), '[]')
    const runDir = join(p, '.agent-team', 'runs', 'r1')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'state.json'), JSON.stringify({ run_id: 'r1', stage: 'S1', contract_sha: 'PENDING', roster: [], artifacts: {}, rework: {}, never_invoked: [], escalations: [], history: [{ stage: 'S1', at: 't' }] }))
    const ctx = ctxOf(run('ledger', posted(join(runDir, 'state.json')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('不是一个合法的 JSON 对象'), ctx)
  })
})

test('反例：project.json 合法、或者根本不在时，写契约不发「不是一个合法的 JSON 对象」', () => {
  for (const project of [TEMPLATE, null]) {
    withRun(project, (p, runDir) => {
      writeFileSync(join(runDir, '00-contract.md'), '# 契约\n')
      const ctx = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), undefined, p))
      assert.ok(!ctx.includes('不是一个合法的 JSON 对象'), ctx)
      assert.ok(ctx.includes('【契约】') || ctx.includes('sha256'), ctx)
    })
  }
})

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

test('写 current-run：run 已经建起来而 project.json 不在——报出来，指向 /agent-team:at-init；点名不受影响的 NO_PATHS_ROLES', () => {
  withRun(null, (p) => {
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'current-run')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('不在') && ctx.includes('/agent-team:at-init'), ctx)
    for (const role of NO_PATHS_ROLES) assert.ok(ctx.includes(role), `${role}：${ctx}`)
  })
})

// 续跑的 run（/agent-team:at-resume 不写 current-run）里 project.json 被删：写 state.json 是唯一提前说出来的时机。
test('写 state.json：run 进行中 project.json 不在——照报阻断，指向 /agent-team:at-init', () => {
  withRun(null, (p, runDir) => {
    const ctx = ctxOf(run('ledger', posted(join(runDir, 'state.json')), undefined, p))
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
