// ledger 的【project.json】回传（M3u，docs/29，全量审查第 10 条）。
//
// project.json 的形状问题只有 PM 改得了，所以要在 PM 看得见的地方说出来：
//   - PM 写 project.json 时（有 run、没有 run 两条路）：三档全报——阻断、要改、请确认；
//   - project.json 写坏（解析不出、不是对象）时：一句固定的话，不回显文件内容（docs/27）；
//   - project.json 在别处被弄坏（用户手改加了注释、尾逗号）而 run 在：写 .agent-team 下任何文件都回传那句固定的话
//     的变体——此前这一格整趟 run 一声不吭，PM 拿不到契约哈希，只能按「门禁没在跑」停下；
//   - 每趟 run 开头 PM 写 current-run 时：整份报一次（已装用户的旧配置在 S1 就露面，不等到 S5 撞上拒绝）；
//   - PM 写 state.json 时：只报阻断（覆盖升级前开始、升级后续跑的 run；不报警告，免得每次记账都刷一遍）；
//   - roster.json 读不出来：单列【插件】，排在【project.json】之前——它不是 project.json 的问题，改它修不好。
// 没有问题时一个字都不发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, decisionOf, hermeticEnv } from './helpers/gate-runner.mjs'
import { brokenProjectNotice, buildLedgerNotices, pluginNotice, projectNotice } from '../hooks/lib/ledger.mjs'
import { NO_PATHS_ROLES } from '../hooks/lib/project.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
const posted = (file_path, agent_type = 'agent-team:at-pm') => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type, tool_input: { file_path } })
const ctxOf = (r) => decisionOf(r.stdout)?.additionalContext ?? ''

// 读 project.json 的方式由预加载脚本化（tests/helpers/project-reads.cjs）：占用、写了一半、按时间的占用窗口、数停顿。
const PROJECT_READS = fileURLToPath(new URL('./helpers/project-reads.cjs', import.meta.url))
const runReads = (input, cwd, vars) =>
  run('ledger', input, undefined, cwd, { ...hermeticEnv(), ...vars }, { nodeArgs: ['-r', PROJECT_READS] })
const reads = (script) => ({ AGENT_TEAM_TEST_PROJECT_READS: script })

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
      // 写的正是 project.json：说「刚写进去的」，不叫它去「原样重写刚才那个文件」（那就是它自己）。
      assert.ok(ctx.includes('刚写进去的') && !ctx.includes('原样重写'), ctx)
      assert.ok(ctx.includes('回报上级'), ctx)
      // 普通的坏文件不按 UTF-16 说：说错原因会把 PM 从注释、尾逗号那里引开。
      assert.ok(!ctx.includes('UTF-16') && !ctx.includes('再 Write 一次'), ctx)
    }
    withoutRun(check)
    withRun(TEMPLATE, check)
  })
}

test('brokenProjectNotice：写的正是它、run 里在别处被弄坏、没有 run 时在别处被弄坏，三种口径各给各的出路', () => {
  const jw = brokenProjectNotice({ runInProgress: true })
  assert.ok(jw.includes('刚写进去的') && jw.includes('回报上级'), jw)
  assert.ok(!jw.includes('原样重写') && !jw.includes('哈希'), jw)
  const el = brokenProjectNotice({ runInProgress: true, justWritten: false })
  assert.ok(!el.includes('刚写进去的'), el)
  for (const k of ['哈希这时也回传不了', '原样重写一次刚才那个文件', '回报上级']) assert.ok(el.includes(k), `${k}：${el}`)
  // 没有 run 就没有契约哈希可拿；改好 project.json 本身就会收到报告与触达表。
  const nr = brokenProjectNotice({ runInProgress: false, justWritten: false })
  for (const k of ['哈希', '原样重写', 'run 进行中']) assert.ok(!nr.includes(k), `${k}：${nr}`)
  assert.ok(nr.includes('改好就会收到报告与触达表') && nr.includes('回报上级'), nr)
  // 原因：泛说时把编码也列上；认出 UTF-16 时直说，并叫它写两次也不奇怪（Write 第一次会沿用原编码）。
  assert.ok(jw.includes('注释') && jw.includes('尾逗号') && jw.includes('不是 UTF-8 编码'), jw)
  // UTF-16：说出可观测的现象（第一次写完仍是 UTF-16、只少了 FF FE）与兜底——实测 PM 自己核字节、看到第一次写完仍是
  // UTF-16 时，会不信「再写一次」有用，改去写探测文件或删文件重建。
  const u = brokenProjectNotice({ runInProgress: true, justWritten: false, utf16: true })
  for (const k of ['UTF-16', '门禁只读 UTF-8', 'FF FE', '再 Write 一次', '先删掉它，再用 Write 新建', '不用另写别的文件试探']) {
    assert.ok(u.includes(k), `${k}：${u}`)
  }
  assert.ok(!u.includes('注释'), u)
  for (const s of [jw, el, nr]) assert.ok(!s.includes('FF FE') && !s.includes('再 Write 一次'), s)
})

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

test('project.json 读的时候撞上占用、再读是合法的：照常发报告与触达表，不谎报「写坏了」；连着占用超过重读的上限才只留痕', () => {
  const BOM = String.fromCharCode(0xfeff)
  // 没有 run：缝里 readProjectConfig 读一次，重读最多三次——前三次撞上占用，第四次读到。带 BOM 的合法文件同样认得。
  for (const [n, text] of [[1, JSON.stringify(TYPO)], [3, JSON.stringify(TYPO)], [1, BOM + JSON.stringify(TYPO)]]) {
    withoutRun((p) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), text)
      const ctx = ctxOf(runReads(posted(join(p, '.agent-team', 'project.json')), p, reads(`busy*${n}`)))
      assert.ok(ctx.includes('【触达表】') && ctx.includes('"at-fronted"'), `${n}：${ctx}`)
      assert.ok(!ctx.includes('不是一个合法的 JSON 对象'), ctx)
    })
  }
  // run 在：读运行上下文还要多读一次。
  for (const n of [2, 4]) {
    withRun(TEMPLATE, (p) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
      const ctx = ctxOf(runReads(posted(join(p, '.agent-team', 'project.json')), p, reads(`busy*${n}`)))
      assert.ok(ctx.includes('【触达表】') && ctx.includes('"at-fronted"'), `${n}：${ctx}`)
      assert.ok(!ctx.includes('不是一个合法的 JSON 对象'), ctx)
    })
  }
  // 一直读不到：只留痕，不说「写坏了」。
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
    const r = runReads(posted(join(p, '.agent-team', 'project.json')), p, reads('busy*10'))
    assert.equal(ctxOf(r), '')
    assert.match(r.stderr, /ledger 回传/)
  })
})

test('重读之间真的停一下：按时间的占用窗口（第一次读之后 40ms 内都占用）也等得过去——单向判据，慢机器上最多假绿', () => {
  // 原版第三次读离第一次至少两次停顿（每次至少 25ms），一定落在 40ms 的窗口之外；三次读连着不停就全落在窗口里。
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TYPO))
    const ctx = ctxOf(runReads(posted(join(p, '.agent-team', 'project.json')), p, { AGENT_TEAM_TEST_PROJECT_BUSY_MS: '40' }))
    assert.ok(ctx.includes('【触达表】'), ctx)
  })
})

test('重读记着读到过的原文：先读到坏内容、之后又撞上占用，照样报「写坏了」，不退成只留痕', () => {
  // 杀毒软件在刚写完时扫描就是这一格：readProjectConfig 与第一次重读读到 []，后两次撞上占用。
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), '[]')
    const ctx = ctxOf(runReads(posted(join(p, '.agent-team', 'project.json')), p, reads('ok,ok,busy*2')))
    assert.ok(ctx.includes('不是一个合法的 JSON 对象') && ctx.includes('刚写进去的'), ctx)
  })
})

test('重读也挡读到写了一半的内容：run 在、写 state.json 时 project.json 前两次读到一半，不谎报「写坏了」', () => {
  // 读运行上下文读到一半 → run 判成读不出；在别处被弄坏那一支的第一次重读又读到一半，第二次才读全。
  withRun(TEMPLATE, (p, runDir) => {
    const ctx = ctxOf(runReads(posted(join(runDir, 'state.json')), p, reads('half*2')))
    assert.ok(!ctx.includes('不是一个合法的 JSON 对象'), ctx)
  })
})

test('写的正是 project.json 而缝里一直读不到、之后才读到坏内容：报不报都行，但不用「在别处被弄坏」的口径叫它原样重写它自己', () => {
  // 读的次数：读运行上下文 1 次、readProjectConfig 1 次、缝里重读 3 次，共 5 次——以后增减读取次数要跟着改。
  withRun(TEMPLATE, (p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), '[]')
    const ctx = ctxOf(runReads(posted(join(p, '.agent-team', 'project.json')), p, reads('busy*5')))
    assert.ok(!ctx.includes('原样重写') && !ctx.includes('哈希这时也回传不了'), ctx)
  })
})

test('project.json 不在（ENOENT）时不重读、不停顿；坏文件照旧重读，两次停顿', () => {
  const waits = (r) => Number((/agent-team-test waits=(\d+)/.exec(r.stderr) ?? [])[1])
  const count = { AGENT_TEAM_TEST_COUNT_WAITS: '1' }
  withoutRun((p) => {
    const r = runReads(posted(join(p, '.agent-team', 'reach.json')), p, count)
    assert.equal(waits(r), 0, r.stderr)
  })
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), '[]')
    const r = runReads(posted(join(p, '.agent-team', 'reach.json')), p, count)
    assert.equal(waits(r), 2, r.stderr)
  })
})

test('project.json 是 UTF-16 编码（Windows PowerShell 5.1 的默认）：回传直说编码，不只说注释和尾逗号', () => {
  const body = Buffer.from(JSON.stringify(TEMPLATE), 'utf16le')
  const be = Buffer.from(body).swap16()
  for (const bytes of [Buffer.concat([Buffer.from([0xff, 0xfe]), body]), body, Buffer.concat([Buffer.from([0xfe, 0xff]), be]), be]) {
    withoutRun((p) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), bytes)
      const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
      assert.ok(ctx.includes('UTF-16') && ctx.includes('门禁只读 UTF-8'), ctx)
    })
    withRun(TEMPLATE, (p, runDir) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), bytes)
      const ctx = ctxOf(run('ledger', posted(join(runDir, 'state.json')), undefined, p))
      assert.ok(ctx.includes('UTF-16') && ctx.includes('门禁只读 UTF-8') && ctx.includes('再 Write 一次'), ctx)
    })
  }
})

test('带 NUL 却不是 UTF-16 的坏文件（尾部补 NUL、整份清零、UTF-32）：不说成 UTF-16，落回泛说的口径', () => {
  const json = JSON.stringify(TEMPLATE)
  const utf32 = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), Buffer.from([...json].flatMap((c) => [c.charCodeAt(0), 0, 0, 0]))])
  for (const bytes of [Buffer.concat([Buffer.from(json), Buffer.alloc(512)]), Buffer.alloc(1024), utf32]) {
    withoutRun((p) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), bytes)
      const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
      assert.ok(ctx.includes('不是一个合法的 JSON 对象') && !ctx.includes('UTF-16') && ctx.includes('常见原因'), ctx)
    })
  }
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
        const r = run('ledger', posted(f), undefined, p)
        const ctx = ctxOf(r)
        assert.ok(ctx.includes('【project.json】') && ctx.includes('不是一个合法的 JSON 对象'), `${f}：${ctx}`)
        assert.ok(!ctx.includes('刚写进去的'), ctx)
        assert.ok(ctx.includes('run 进行中'), ctx)
        // 出路：改好之后原样重写一次刚才那个文件拿回传；不是 PM 的回报上级。
        for (const k of ['哈希这时也回传不了', '原样重写一次刚才那个文件', '回报上级']) assert.ok(ctx.includes(k), `${k}：${ctx}`)
        // run 读不出来时放行必须留痕，而且只留一行。
        assert.equal((r.stderr.match(/ledger 回传：读不到运行上下文/g) ?? []).length, 1, r.stderr)
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

test('没有 run、project.json 坏着：写 .agent-team 下别的文件（at-init 的 reach.json）也回传，不说 run 进行中、不提哈希，不留痕', () => {
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), '{ "paths": {}, }')
    const r = run('ledger', posted(join(p, '.agent-team', 'reach.json')), undefined, p)
    const ctx = ctxOf(r)
    assert.ok(ctx.includes('【project.json】') && ctx.includes('不是一个合法的 JSON 对象'), ctx)
    for (const k of ['run 进行中', '哈希']) assert.ok(!ctx.includes(k), `${k}：${ctx}`)
    // 与写 project.json 那条缝同一个理由：no-run 下不把人指向 current-run 去查一个不存在的问题。
    assert.equal(r.stderr.trim(), '')
  })
})

test('project.json 坏着时，.agent-team 之外的写入照旧一声不吭——执行角色与主会话写业务文件不被刷屏', () => {
  const outside = (p) => [
    [join(p, 'src', 'x.ts'), 'agent-team:at-backend'],
    [join(p, 'README.md'), undefined],
  ]
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), '[]')
    for (const [f, who] of outside(p)) {
      const input = posted(f)
      if (who) input.agent_type = who
      else delete input.agent_type
      assert.equal(ctxOf(run('ledger', input, undefined, p)), '', f)
    }
  })
  withRun(TEMPLATE, (p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), '[]')
    assert.equal(ctxOf(run('ledger', posted(join(p, 'README.md')), undefined, p)), '')
  })
})

test('带 BOM 的合法 project.json 不被当成写坏：run 读不出来（指针还没写）的那一格里写 state.json 不报', () => {
  withoutRun((p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), String.fromCharCode(0xfeff) + JSON.stringify(TEMPLATE))
    const runDir = join(p, '.agent-team', 'runs', 'r1')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'state.json'), JSON.stringify({ run_id: 'r1', stage: 'S1', contract_sha: 'PENDING', roster: [], artifacts: {}, rework: {}, never_invoked: [], escalations: [], history: [{ stage: 'S1', at: 't' }] }))
    const ctx = ctxOf(run('ledger', posted(join(runDir, 'state.json')), undefined, p))
    assert.ok(!ctx.includes('不是一个合法的 JSON 对象'), ctx)
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

// ---- 【插件】：roster.json 读不出来 ----

test('pluginNotice：没有插件问题时不发；有就单成一段【插件】，排在【project.json】与【触达表】之前', () => {
  assert.equal(pluginNotice({ block: [], fix: [], confirm: [], plugin: [] }), null)
  assert.equal(pluginNotice(null), null)
  const notices = buildLedgerNotices({ kind: 'project', reach: {}, projectReport: { block: ['BLOCK-1'], fix: [], confirm: [], plugin: ['PLUGIN-1'] } })
  const text = notices.join('\n')
  const at = (s) => text.indexOf(s)
  assert.ok(at('【插件】PLUGIN-1') >= 0 && at('【插件】') < at('【project.json】') && at('【project.json】') < at('【触达表】'), text)
  // 它不在【project.json】那一段里：那一段的首句叫人整份重写 project.json、结尾叫人改到没有为止。
  assert.ok(!projectNotice({ block: [], fix: [], confirm: [], plugin: ['PLUGIN-1'] }), '只有插件问题时不该出【project.json】')
})

test('门禁子进程：插件副本的 roster.json 读坏时，写 project.json、写 state.json 都收到【插件】，不叫 PM 改 project.json', () => {
  const REPO = new URL('..', import.meta.url)
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'agent-team-lp-plug-')))
  try {
    cpSync(new URL('hooks', REPO), join(plugin, 'hooks'), { recursive: true })
    cpSync(new URL('stages.json', REPO), join(plugin, 'stages.json'))
    writeFileSync(join(plugin, 'roster.json'), '{')
    const gate = join(plugin, 'hooks', 'boot.mjs')
    withoutRun((p) => {
      writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TEMPLATE))
      const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), gate, p))
      assert.ok(ctx.includes('【插件】') && ctx.includes('roster.json'), ctx)
      assert.ok(!ctx.includes('【project.json】'), ctx)
    })
    withRun(TEMPLATE, (p, runDir) => {
      const ctx = ctxOf(run('ledger', posted(join(runDir, 'state.json')), gate, p))
      assert.ok(ctx.includes('【插件】'), ctx)
      for (const k of ['改到没有为止', '整份重写']) assert.ok(!ctx.includes(k), `${k}：${ctx}`)
    })
    // 触达表拿空花名册算，恒得出「没有角色的触达超出」——实测 PM 用这份 {} 覆盖了一份正确的 reach.json。不发 JSON。
    for (const bad of ['{', '{}', '[]']) {
      writeFileSync(join(plugin, 'roster.json'), bad)
      const check = (p) => {
        writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(TEMPLATE))
        const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), gate, p))
        assert.ok(ctx.includes('【插件】') && ctx.includes('不要写 .agent-team/reach.json'), `${bad}：${ctx}`)
        for (const k of ['原样写进 .agent-team/reach.json', '没有角色的触达超出']) assert.ok(!ctx.includes(k), `${k}：${ctx}`)
      }
      withoutRun(check)
      withRun(TEMPLATE, check)
    }
  } finally {
    rmSync(plugin, { recursive: true, force: true })
  }
})

test('写 project.json 有阻断时不发触达表 JSON：照整条作废的条目算出来的「还能写到」与门禁自相矛盾', () => {
  const project = { ...TEMPLATE, paths: { ...TEMPLATE.paths, 'at-backend': ['src/server/', '../shared/'] } }
  const check = (p) => {
    writeFileSync(join(p, '.agent-team', 'project.json'), JSON.stringify(project))
    const ctx = ctxOf(run('ledger', posted(join(p, '.agent-team', 'project.json')), undefined, p))
    assert.ok(ctx.includes('【project.json】') && ctx.includes('"../shared/"'), ctx)
    assert.ok(ctx.includes('【触达表】这次不发') && ctx.includes('不要写 .agent-team/reach.json'), ctx)
    for (const k of ['还能写到 "../shared/"', '原样写进 .agent-team/reach.json']) assert.ok(!ctx.includes(k), `${k}：${ctx}`)
  }
  withoutRun(check)
  withRun(TEMPLATE, check)
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
