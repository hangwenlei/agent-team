// 审查第 37 条前半（M4c，docs/37）：契约的账只认 state.json 的 contract_sha 这一份。
//
// 原来契约的 sha 记在两处：写契约时门禁只回传 contract_sha，账本比对（compareArtifacts）却只读 artifacts['00-contract.md']。
// 照 /agent-team:at 只记 contract_sha 的 run，每一次派发返回都报「00-contract.md：磁盘上有、artifacts 里没记」；PM 把 sha 抄进
// artifacts 之后，每一次合法修订又报「记账之后被改过」。真漂移报出来与这两句噪声逐字相同，还有几种一个字都不报（契约被改回
// 修订前、PM 照通用收尾把 artifacts 改成与磁盘一致之后、契约被删）。
//
// 现在：账本比对不再看契约；派发返回时（H5a）与 PM 写 state.json 时（ledger），拿 contract_sha 比磁盘上的契约，对不上单列一段
// 【契约】。写 state.json 那一处是为异步派发补的：H5a 只在派发那一刻跑，S6 里用 Bash 改的契约，要到下一次派发才报——推进到 S7 的
// 那一次写入在派验收之前，它才是规格 §4.2 ①「S7 验收前校验哈希未变」的那一刻。
// 回传不报磁盘上算出来的 sha，也不说「把 artifacts 改成与磁盘一致」：照着磁盘去改账，就把一次漂移洗成了合法。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const ORIGINAL = 'fixture 00-contract.md\n'
const REVISED = ORIGINAL + '\n## 4. 修订记录\n\n### 2026-10-04 用户答复\n范围加上导出。\n'
const H0 = sha256OfContract(ORIGINAL)
const H1 = sha256OfContract(REVISED)

const ctxOf = (stdout) => (stdout.trim() ? JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '' : '')
const returned = (target, caller) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  ...(caller ? { agent_type: caller } : {}),
  tool_input: { subagent_type: target, prompt: 'x' },
  tool_response: { status: 'completed' },
})
const posted = (file) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: file } })

// 一趟 S2 的 run：契约与 01-prd.md 在磁盘上，01-prd.md 记了账（免得账本比对的那一行把契约那一行的有无搅在一起）。
function withRun({ stage = 'S2', roster = ['at-product'], files = ['00-contract.md', '01-prd.md'], contract = ORIGINAL, state = {} }, body) {
  const dirs = makeRun({ runId: 'r1', stage, roster, artifacts: files })
  const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
  try {
    if (files.includes('00-contract.md')) writeFileSync(join(runDir, '00-contract.md'), contract, 'utf8')
    const statePath = join(runDir, 'state.json')
    const s = JSON.parse(readFileSync(statePath, 'utf8'))
    const recorded = Object.fromEntries(files.filter((f) => f !== '00-contract.md').map((f) => [f, sha256OfContract(`fixture ${f}\n`)]))
    writeFileSync(statePath, JSON.stringify({ ...s, artifacts: recorded, ...state }), 'utf8')
    return body({ dirs, runDir, statePath })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}
const h5a = (dirs, input = returned('agent-team:at-product')) => run('deliverable', input, GATE, dirs.projectDir)

// ---------------------------------------------------------------------------- 噪声没了

test('M4c G1：照 /agent-team:at 记账（契约在、contract_sha 对得上、artifacts 不记契约）→ 派发返回不提契约', () => {
  withRun({ state: { contract_sha: H0 } }, ({ dirs }) => {
    const r = h5a(dirs)
    assert.equal(r.status, 0)
    assert.ok(!ctxOf(r.stdout).includes('00-contract.md'), ctxOf(r.stdout))
    assert.ok(!ctxOf(r.stdout).includes('【契约】'), ctxOf(r.stdout))
  })
})

test('M4c G2：合法修订之后（contract_sha 已是新值），artifacts 里还记着修订前的契约 sha（旧 run）→ 不提契约', () => {
  withRun({ contract: REVISED, state: { contract_sha: H1, artifacts: { '00-contract.md': H0, '01-prd.md': sha256OfContract('fixture 01-prd.md\n') } } }, ({ dirs }) => {
    const ctx = ctxOf(h5a(dirs).stdout)
    assert.ok(!ctx.includes('00-contract.md'), ctx)
    assert.ok(!ctx.includes('【契约】'), ctx)
  })
})

// ---------------------------------------------------------------------------- 真漂移都报

test('M4c G3：修订之后契约被改回修订前（artifacts 记着修订前的值）→ 报【契约】', () => {
  withRun({ contract: ORIGINAL, state: { contract_sha: H1, artifacts: { '00-contract.md': H0, '01-prd.md': sha256OfContract('fixture 01-prd.md\n') } } }, ({ dirs }) => {
    assert.match(ctxOf(h5a(dirs).stdout), /【契约】/)
  })
})

test('M4c G4：契约被改、artifacts 已经照磁盘改成新值（洗过）、contract_sha 没动 → 照报【契约】', () => {
  withRun({ contract: REVISED, state: { contract_sha: H0, artifacts: { '00-contract.md': H1, '01-prd.md': sha256OfContract('fixture 01-prd.md\n') } } }, ({ dirs }) => {
    assert.match(ctxOf(h5a(dirs).stdout), /【契约】/)
  })
})

test('M4c G5：修订块追加了、contract_sha 没跟上 → 报【契约】，指向第 4 节，不报磁盘上算出来的 sha', () => {
  withRun({ contract: REVISED, state: { contract_sha: H0 } }, ({ dirs }) => {
    const ctx = ctxOf(h5a(dirs).stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes('/agent-team:at 第 4 节'), ctx)
    assert.ok(ctx.includes(H0), '记的那个值照报（经 shaOrNote）')
    assert.ok(!ctx.includes(H1), '磁盘上算出来的那个值不报：照着它改账就把漂移洗成了合法')
    assert.ok(!ctx.includes('把 artifacts 改成与磁盘一致'), ctx)
    assert.ok(ctx.includes('不要自己算'), ctx)
    // 复核（docs/37 §3）：对得上格式、对不上值，门禁分不出是修订后没记、记了自己算的值、还是契约被改了——不断言成因，几种都列出来。
    for (const k of ['可能是', '自己算', '恢复原样', '记进 contract_sha']) assert.ok(ctx.includes(k), `缺「${k}」：${ctx}`)
    assert.ok(!ctx.includes('契约在记账之后被改过'), ctx)
  })
})

test('M4c G6：契约被删、contract_sha 记着值 → 报【契约】，说需求基线不在了、告诉用户', () => {
  withRun({ files: ['01-prd.md'], state: { contract_sha: H0 } }, ({ dirs }) => {
    const ctx = ctxOf(h5a(dirs).stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes('磁盘上没有 00-contract.md'), ctx)
    assert.ok(ctx.includes('告诉用户'), ctx)
  })
})

test('M4c G7：契约在磁盘上、contract_sha 还是 PENDING → 报【契约】，叫它从写契约那一次的回传里拿、拿不到就原样重写一次', () => {
  withRun({ state: { contract_sha: 'PENDING' } }, ({ dirs }) => {
    const ctx = ctxOf(h5a(dirs).stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes('还是 PENDING'), '说的是还没记，不是漂移：' + ctx)
    assert.ok(!ctx.includes('在记账之后被改过'), ctx)
    assert.ok(ctx.includes('原样重写一次'), ctx)
    assert.ok(!ctx.includes(H0), '这里也不报磁盘上的值')
  })
})

test('M4c G8：收件人不是 PM（架构师派 at-backend 返回）→ 契约那一段带「原样冒泡」的收尾，stderr 留误投痕；PM 收件时没有那行痕', () => {
  const S5 = { stage: 'S5', roster: ['at-architect', 'at-backend'], files: ['00-contract.md', '05-impl/at-backend.md'], contract: REVISED, state: { contract_sha: H0 } }
  withRun(S5, ({ dirs }) => {
    const r = h5a(dirs, returned('agent-team:at-backend', 'agent-team:at-architect'))
    const ctx = ctxOf(r.stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes('原样冒泡给派你的人'), ctx)
    assert.ok(ctx.includes('PM 不会同时收到一份'), ctx)
    // 复核：契约这一条咽掉了，PM 自己下一次派发返回或写 state.json 时还会看到——不说「没有任何人会再看见它」。
    assert.ok(!ctx.includes('没有任何人会再看见它'), ctx)
    assert.match(r.stderr, /契约/)
    assert.match(r.stderr, /H4/, '误投痕要说到契约本身（H4），不只是 state.json')
  })
  withRun({ contract: REVISED, state: { contract_sha: H0 } }, ({ dirs }) => {
    const r = h5a(dirs)
    assert.ok(!ctxOf(r.stdout).includes('原样冒泡给派你的人'), ctxOf(r.stdout))
    assert.doesNotMatch(r.stderr, /契约/)
  })
})

test('M4c G9：契约是 CRLF、contract_sha 按 LF 算的 → 不报（比对先统一行尾）', () => {
  withRun({ contract: ORIGINAL.replace(/\n/g, '\r\n'), state: { contract_sha: H0 } }, ({ dirs }) => {
    assert.ok(!ctxOf(h5a(dirs).stdout).includes('【契约】'))
  })
})

test('M4c G10：契约还没写（PENDING、磁盘上没有）→ 不报：还没走到那一步', () => {
  withRun({ stage: 'S1', roster: [], files: [], state: { contract_sha: 'PENDING' } }, ({ dirs }) => {
    assert.ok(!ctxOf(h5a(dirs, returned('agent-team:at-product')).stdout).includes('【契约】'))
  })
})

// ---------------------------------------------------------------------------- 写 state.json 时也核

test('M4c S1：PM 写 state.json、契约对得上 → 不提契约', () => {
  withRun({ state: { contract_sha: H0 } }, ({ dirs, statePath }) => {
    const r = run('ledger', posted(statePath), GATE, dirs.projectDir)
    assert.ok(!ctxOf(r.stdout).includes('【契约】'), ctxOf(r.stdout))
  })
})

test('M4c S2：PM 写 state.json、契约在记账之后被改过（例：S6 里有人用 Bash 改了它）→ 这一次写入就报【契约】，早于派验收', () => {
  withRun({ stage: 'S6', roster: ['at-qa'], contract: REVISED, state: { contract_sha: H0 } }, ({ dirs, statePath }) => {
    const ctx = ctxOf(run('ledger', posted(statePath), GATE, dirs.projectDir).stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(!ctx.includes(H1), ctx)
  })
})

test('M4c S3：PM 写 state.json、contract_sha 是 PENDING 而契约在磁盘上（例：重建的 state.json）→ 报【契约】', () => {
  withRun({ state: { contract_sha: 'PENDING' } }, ({ dirs, statePath }) => {
    const ctx = ctxOf(run('ledger', posted(statePath), GATE, dirs.projectDir).stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes('还是 PENDING'), ctx)
  })
})

test('M4c S4：PM 写 state.json、契约被删 → 报【契约】', () => {
  withRun({ state: { contract_sha: H0 } }, ({ dirs, runDir, statePath }) => {
    unlinkSync(join(runDir, '00-contract.md'))
    assert.match(ctxOf(run('ledger', posted(statePath), GATE, dirs.projectDir).stdout), /【契约】/)
  })
})

test('M4c S5：建 run 那一次（PENDING、契约还没写）写 state.json → 不报', () => {
  withRun({ stage: 'S1', roster: [], files: [], state: { contract_sha: 'PENDING' } }, ({ dirs, statePath }) => {
    assert.ok(!ctxOf(run('ledger', posted(statePath), GATE, dirs.projectDir).stdout).includes('【契约】'))
  })
})

test('M4c S6：写契约那一刻的【契约】照旧给新值（合法修订拿 sha 的那条路不变）', () => {
  withRun({ contract: REVISED, state: { contract_sha: H0 } }, ({ dirs, runDir }) => {
    const ctx = ctxOf(run('ledger', posted(join(runDir, '00-contract.md')), GATE, dirs.projectDir).stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes(H1), '写契约那一刻要把新值交给 PM——这是合法修订记账的唯一来源')
  })
})

// 复核（docs/37 §3）：派发返回时「产物没交」那一支（异步派发启动那一刻、冒泡返回都走它）也带【契约】——原来只删那一行全套照绿。
test('M4c G11：被派角色的产物没交（例：架构师冒泡返回）、契约漂了 → 同样报【契约】；协调者收件时带冒泡的收尾', () => {
  withRun({ stage: 'S3', roster: ['at-architect'], files: ['00-contract.md', '01-prd.md'], contract: REVISED, state: { contract_sha: H0 } }, ({ dirs }) => {
    const ctx = ctxOf(h5a(dirs, returned('agent-team:at-architect')).stdout)
    assert.match(ctx, /交付物校验/)
    assert.match(ctx, /【契约】/)
  })
  const S5 = { stage: 'S5', roster: ['at-architect', 'at-backend'], files: ['00-contract.md'], contract: REVISED, state: { contract_sha: H0 } }
  withRun(S5, ({ dirs }) => {
    const r = h5a(dirs, returned('agent-team:at-backend', 'agent-team:at-architect'))
    const ctx = ctxOf(r.stdout)
    assert.match(ctx, /交付物校验/)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes('原样冒泡给派你的人'), ctx)
    assert.match(r.stderr, /契约/)
  })
})

// 复核（docs/37 §3）：contract_sha 缺键或乱写，不是「契约在记账之后被改过」——单说它不合法，出路是写 PENDING、原样重写一次契约拿 sha。
test('M4c G12：contract_sha 不合法 → 【契约】说它不合法、给 PENDING 那条出路，不说契约被改过，也不套两层括号', () => {
  withRun({ state: { contract_sha: 'x' } }, ({ dirs }) => {
    const ctx = ctxOf(h5a(dirs).stdout)
    assert.match(ctx, /【契约】/)
    assert.ok(ctx.includes('不是合法的 sha256'), ctx)
    assert.ok(ctx.includes('PENDING'), ctx)
    assert.ok(ctx.includes('原样重写一次'), ctx)
    assert.ok(!ctx.includes('在记账之后被改过'), ctx)
    assert.ok(!ctx.includes('（（'), ctx)
  })
})

// 复核（docs/37 §3）：契约在、只是这一次读不出（例：被别的程序占着）——说「这次读不出、没核」，不说「需求基线不在了、告诉用户」。
// Windows 上造不出「在、却读不出」的文件（锁要另一个进程持着），只在 POSIX 上用权限造。
test('M4c G13：契约在却读不出 → 【契约】说这一次读不出、没核，不说它不在', { skip: process.platform === 'win32' }, () => {
  withRun({ state: { contract_sha: H0 } }, ({ dirs, runDir }) => {
    const p = join(runDir, '00-contract.md')
    chmodSync(p, 0o000)
    try {
      const ctx = ctxOf(h5a(dirs).stdout)
      if (process.getuid && process.getuid() === 0) return // root 无视权限位
      assert.match(ctx, /【契约】/)
      assert.ok(ctx.includes('读不出'), ctx)
      assert.ok(!ctx.includes('磁盘上没有 00-contract.md'), ctx)
    } finally {
      chmodSync(p, 0o644)
    }
  })
})

