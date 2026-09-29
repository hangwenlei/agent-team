// 门禁子进程只从 tests/helpers/gate-runner.mjs 一个出口起（M3t，docs/28，全量审查第 4 条）。
//
// 为什么要一个出口：CI 的最低版本作业把 AGENT_TEAM_GATE_NODE 设成最低版本的 node，只让门禁子进程
// 换版本、测试框架本身留在新版本上。哪个判据自己 spawn 了 process.execPath，它就悄悄跑在新版本上，
// 最低版本作业对它什么都没证明。出口还负责一件事：子进程根本没跑起来时抛出来，而不是让一个空的
// stdout 冒充「门禁放行」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GATE_NODE, run, runAsync, decisionOf } from './helpers/gate-runner.mjs'
import { GATE_CHECK_PATH, GATE_CHECK_ONLINE } from '../hooks/lib/gate-check.mjs'
import { MIN_NODE } from './helpers/min-node.mjs'

const TESTS = new URL('./', import.meta.url)

// tests/ 下（含 helpers/、fixtures/）每一处「拿 process.execPath 或字面量 node 起子进程」的地方。对整份
// 文本匹配（调用可以折成好几行写），text 取那一处所在的整行（ALLOWED 按它认）。另外，process.execPath
// 这串字只准出现在 ALLOWED 那几行与出口自己里——先放进变量再 spawn 的写法，这一条挡得住。
//
// 文字扫描打不全（docs/16 §3 的三样）：
//   - 仍漏的写法：process.argv[0]、process.argv0、解构出来的 execPath、字面量 'node' 先进变量、execSync 的
//     字符串命令。
//   - 拒绝的判据长什么样：动态判据——最低版本作业里给门禁子进程装记录垫片，核对每个跑了 boot.mjs 的
//     进程的版本。
//   - 什么会让答案改变：出了一次「有门禁子进程没走出口」的事故，或者上面那种动态判据做得便宜了。
const SPAWN_RE = /\b(spawn|spawnSync|execFile|execFileSync|fork)\s*\(\s*(process\.execPath|['"]node(\.exe)?['"])/g

function sourcesUnderTests() {
  const out = []
  for (const dir of ['', 'helpers/', 'fixtures/']) {
    let names = []
    try {
      names = readdirSync(new URL(dir, TESTS))
    } catch {
      continue
    }
    for (const name of names.filter((n) => /\.(mjs|cjs|js)$/.test(n))) {
      out.push({ rel: dir + name, text: readFileSync(new URL(dir + name, TESTS), 'utf8') })
    }
  }
  return out
}

function sitesIn(rel, text, re) {
  const lines = text.split(/\r?\n/)
  return [...text.matchAll(re)].map((m) => {
    const line = text.slice(0, m.index).split('\n').length
    return { rel, line, text: lines[line - 1].trim() }
  })
}

function nodeSpawnSites() {
  return sourcesUnderTests().flatMap(({ rel, text }) => sitesIn(rel, text, SPAWN_RE))
}

// process.execPath 出现在哪。除外的：本文件、出口自己，以及伪造预加载——它在门禁子进程里面改这个值，
// 不起任何子进程。
const EXEC_PATH_OK = ['helpers/gate-runner.mjs', 'gate-runner.test.mjs', 'helpers/fake-node-version.cjs']
function execPathSites() {
  return sourcesUnderTests()
    .filter(({ rel }) => !EXEC_PATH_OK.includes(rel))
    .flatMap(({ rel, text }) => sitesIn(rel, text, /process\.execPath/g))
}

// 不是门禁子进程、所以不该走出口的，逐处列出理由。
const ALLOWED = [
  { rel: 'readme-sync.test.mjs', has: "'--test'", why: '量的是测试框架本身（node --test tests/ 的行为），不是门禁' },
  { rel: 'version-bump.test.mjs', has: '[CLI,', why: '跑的是 scripts/check-version-bump.mjs，不是门禁' },
]

test('门禁子进程只从 gate-runner 起：tests/ 下别处拿 node 起子进程的，只有清单里那几处', () => {
  const stray = nodeSpawnSites().filter((s) => !ALLOWED.some((a) => a.rel === s.rel && s.text.includes(a.has)))
  assert.deepEqual(
    stray.map((s) => `${s.rel}:${s.line}  ${s.text}`),
    [],
    '这些地方自己起了 node 子进程。门禁子进程改走 tests/helpers/gate-runner.mjs 的 run / runAsync（要预加载就传 nodeArgs）；' +
      '真的不是门禁的，加进本文件的 ALLOWED 并写明理由。',
  )
})

test('锚：ALLOWED 的每一条都还对得上一处真实的调用——清单不会悄悄变成空转的豁免', () => {
  const sites = nodeSpawnSites()
  for (const a of ALLOWED) {
    assert.ok(sites.some((s) => s.rel === a.rel && s.text.includes(a.has)), `${a.rel}（${a.has}）已经不在了，把它从 ALLOWED 里删掉`)
  }
})

test('process.execPath 只出现在 ALLOWED 那几行——先放进变量再 spawn 的写法也挡得住', () => {
  const stray = execPathSites().filter((s) => !ALLOWED.some((a) => a.rel === s.rel && s.text.includes(a.has)))
  assert.deepEqual(stray.map((s) => `${s.rel}:${s.line}  ${s.text}`), [])
})

test('自检：扫描认得出折成两行的调用', () => {
  const sample = 'const r = spawnSync(\n  process.execPath,\n  [x],\n)\n'
  assert.equal(sitesIn('x.mjs', sample, SPAWN_RE).length, 1)
  assert.equal(sitesIn('x.mjs', sample, SPAWN_RE)[0].line, 1)
})

test('自检：nodeSpawnSites() 认得出一处真实的写法，也不收变量——扫描不是在空转', () => {
  assert.ok(nodeSpawnSites().some((s) => s.rel === 'readme-sync.test.mjs'))
  assert.ok(!nodeSpawnSites().some((s) => s.rel === 'helpers/gate-runner.mjs'), '出口自己用的是变量 node，不该被当成别处')
})

// ---- 出口在子进程没跑起来时抛 ----

test('入口文件本身找不到：run 抛出来，而不是返回一个空的 stdout 冒充放行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-team-runner-'))
  try {
    assert.throws(() => run('writepath', {}, join(dir, 'no-such-boot.mjs'), dir), /找不到/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('退出码不在 0/1/2 里：run 与 runAsync 都抛', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-team-runner-'))
  try {
    const gate = join(dir, 'exit3.mjs')
    writeFileSync(gate, 'process.exit(3)\n')
    assert.throws(() => run('writepath', {}, gate, dir), /退出码 3/)
    await assert.rejects(runAsync('writepath', {}, { gate, cwd: dir }), /退出码 3/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('node 本身起不来：run 抛出来', () => {
  assert.throws(() => run('writepath', {}, undefined, undefined, undefined, { node: join(tmpdir(), 'no-such-node-binary') }), /没起来/)
})

// ---- 最低版本作业的锚 ----
//
// CI 的最低版本作业（.github/workflows/min-node.yml）设了 AGENT_TEAM_GATE_NODE 时，门禁子进程必须
// 真的跑在 hooks/boot.mjs 的 MIN_NODE 那一版上——精确到补丁号。没设时（本地、主矩阵）跳过。

// 经出口问：出口的默认 node 被改回 process.execPath 时，只核 GATE_NODE 常量的锚照样绿，而门禁子进程全都
// 悄悄回到新版本上（M3t 复核）。门禁自检的拒绝理由里带着门禁用的 node 版本，拿它核。
test('最低版本作业：门禁子进程跑的正是 MIN_NODE 那一版——经 run 与 runAsync 两个出口核', { skip: !process.env.AGENT_TEAM_GATE_NODE }, async () => {
  const r = spawnSync(GATE_NODE, ['-p', 'process.versions.node'], { encoding: 'utf8' })
  assert.equal(r.stdout.trim(), MIN_NODE, `AGENT_TEAM_GATE_NODE=${GATE_NODE}`)
  assert.notEqual(GATE_NODE, process.execPath, '测试框架与门禁子进程是同一个 node——最低版本作业没起作用')
  const dir = mkdtempSync(join(tmpdir(), 'agent-team-runner-min-'))
  try {
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, GATE_CHECK_PATH), content: 'x' } }
    for (const out of [run('writepath', input, undefined, dir), await runAsync('writepath', input, { cwd: dir })]) {
      const reason = decisionOf(out.stdout)?.permissionDecisionReason ?? ''
      assert.ok(reason.startsWith(GATE_CHECK_ONLINE), reason)
      assert.ok(reason.includes(`v${MIN_NODE}`), `出口起的不是 ${MIN_NODE}：${reason}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const WORKFLOW = new URL('../.github/workflows/min-node.yml', import.meta.url)

test('最低版本作业的配置：装的就是 MIN_NODE，并把它交给 AGENT_TEAM_GATE_NODE', () => {
  const y = readFileSync(WORKFLOW, 'utf8')
  const versions = [...y.matchAll(/node-version:\s*['"]?([\d.]+)['"]?/g)].map((m) => m[1])
  assert.ok(versions.includes(MIN_NODE), `min-node.yml 没有装 ${MIN_NODE}（装的是 ${versions.join('、')}）`)
  assert.match(y, /AGENT_TEAM_GATE_NODE=/)
  assert.match(y, /AGENT_TEAM_OLD_NODES=/)
  for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) assert.ok(y.includes(os), os)
  // 最后一次 setup-node 决定 PATH 上的 node，也就是测试框架用的那个：它必须是新版本。
  assert.equal(Number(versions[versions.length - 1].split('.')[0]) >= 22, true, `最后装的是 ${versions[versions.length - 1]}`)
})
