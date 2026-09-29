// 路径别名（M3q，docs/25；全量审查第 8、9、31 条）。
//
// 门禁的「是不是契约 / 控制文件 / 在不在 run 目录下 / 归不归某个角色」全落在
// hooks/lib/path-norm.mjs 的 norm() 上。它此前只做字面规范化（resolve、统一分隔符、win32 转
// 小写），于是字面不同、指向同一个物理文件的写法——junction / 软链接、Windows 8.3 短名、
// \\?\ 设备前缀、::$DATA 流后缀、macOS 的大小写变体——全都漏过去。审查实测：没有 Bash 的
// at-acceptance 经这些写法能改写契约、state.json、current-run、project.json；PM 能清零返工史。
// 没有 paths 条目的角色受害最重：认不出是 run 目录，就落到「未认领，放行」。
//
// 修法两半：norm() 对已存在的最长前缀做 realpath.native（解析链接、短名、设备前缀、真实大小写），
// 并在大小写不敏感的平台上折叠大小写；解析不了的写法（流后缀、结尾带点或空格、项目不在网络
// 共享上却写网络路径）由 exoticPath() 认出来，门禁直接拒。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { norm, exoticPath, foldsCase } from '../hooks/lib/path-norm.mjs'
import { readRunContext } from '../hooks/lib/runctx.mjs'
import { run, decisionOf, GATE, hermeticEnv } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { fileURLToPath } from 'node:url'

// readRunContext 还要读插件根下的 stages.json；makeRun 造的临时插件目录是空的，拿它当插件根，
// 任何用例都会先因为读不到 stages.json 判 unreadable——那样测到的就不是 run id 这一条。
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

const WIN = process.platform === 'win32'
const MAC = process.platform === 'darwin'

// 目录链接：win32 上用 junction（不要管理员权限），别处用目录软链接。
function linkDir(target, path) {
  symlinkSync(target, path, WIN ? 'junction' : 'dir')
}

// win32 上一个已存在路径的 8.3 短名形式；卷上没开短名时返回原样。
function shortPathOf(p) {
  const out = execFileSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  })
  return out.trim()
}

function tempDir(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

// ---- norm()：同一个物理文件的不同写法得到同一个字符串 ----

test('norm：经目录链接访问与直接访问得到同一个结果——已存在的文件', () => {
  const d = tempDir('agent-team-alias-')
  try {
    mkdirSync(join(d, 'real', 'sub'), { recursive: true })
    writeFileSync(join(d, 'real', 'sub', 'x.txt'), 'x')
    linkDir(join(d, 'real'), join(d, 'lnk'))
    assert.equal(norm(join(d, 'lnk', 'sub', 'x.txt')), norm(join(d, 'real', 'sub', 'x.txt')))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('norm：经目录链接访问一个还不存在的文件，同样解析到链接的目标——新建文件走的就是这条', () => {
  const d = tempDir('agent-team-alias-')
  try {
    mkdirSync(join(d, 'real'), { recursive: true })
    linkDir(join(d, 'real'), join(d, 'lnk'))
    assert.equal(norm(join(d, 'lnk', 'new', 'y.md')), norm(join(d, 'real', 'new', 'y.md')))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('norm：悬空的目录链接（目标还不存在）也跟着链接走——往里写会把目标建出来', () => {
  const d = tempDir('agent-team-alias-')
  try {
    mkdirSync(join(d, 'real'), { recursive: true })
    linkDir(join(d, 'real', 'later'), join(d, 'lnk'))
    assert.equal(norm(join(d, 'lnk', 'z.md')), norm(join(d, 'real', 'later', 'z.md')))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('norm：系统临时目录的未解析写法与 realpath 写法得到同一个结果（macOS 的 /var → /private/var）', () => {
  const raw = mkdtempSync(join(tmpdir(), 'agent-team-alias-'))
  try {
    assert.equal(norm(join(raw, 'a.md')), norm(join(realpathSync(raw), 'a.md')))
  } finally {
    rmSync(raw, { recursive: true, force: true })
  }
})

test('norm：Windows 8.3 短名与长名得到同一个结果', { skip: !WIN }, (t) => {
  const d = tempDir('agent-team-alias-')
  try {
    const long = join(d, '.agent-team-longname')
    mkdirSync(long)
    const short = shortPathOf(long)
    if (short.toLowerCase() === long.toLowerCase()) {
      t.skip('这个卷没开 8.3 短名')
      return
    }
    assert.equal(norm(join(short, 'state.json')), norm(join(long, 'state.json')))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('norm：Windows \\\\?\\ 设备前缀与普通写法得到同一个结果', { skip: !WIN }, () => {
  const d = tempDir('agent-team-alias-')
  try {
    assert.equal(norm(`\\\\?\\${join(d, 'x.md')}`), norm(join(d, 'x.md')))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('norm：macOS 默认卷上大小写变体得到同一个结果', { skip: !MAC }, () => {
  const d = tempDir('agent-team-alias-')
  try {
    mkdirSync(join(d, '.agent-team'))
    assert.equal(norm(join(d, '.AGENT-TEAM', 'x.md')), norm(join(d, '.agent-team', 'x.md')))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('foldsCase：win32 与 darwin 折叠大小写，linux 不折叠', () => {
  assert.equal(foldsCase('win32'), true)
  assert.equal(foldsCase('darwin'), true)
  assert.equal(foldsCase('linux'), false)
})

// ---- exoticPath()：解析不了、也没有正当用途的写法 ----

const W = { platform: 'win32' }

test('exoticPath：流后缀（::$DATA 或 :名字）认得出来', () => {
  assert.ok(exoticPath('C:\\p\\.agent-team\\current-run::$DATA', 'C:\\p', W))
  assert.ok(exoticPath('C:\\p\\state.json:s', 'C:\\p', W))
})

test('exoticPath：路径段结尾带点或空格认得出来', () => {
  assert.ok(exoticPath('C:\\p\\.agent-team\\runs\\r1\\state.json.', 'C:\\p', W))
  assert.ok(exoticPath('C:\\p\\.agent-team \\project.json', 'C:\\p', W))
})

test('exoticPath：项目在本地盘上时，网络路径（含本机管理共享）认得出来', () => {
  assert.ok(exoticPath('\\\\localhost\\C$\\p\\.agent-team\\project.json', 'C:\\p', W))
  assert.ok(exoticPath('\\\\?\\UNC\\localhost\\C$\\p\\x', 'C:\\p', W))
})

test('exoticPath：两种设备前缀的网络写法都认得出来——\\\\.\\UNC\\ 与 \\\\?\\UNC\\', () => {
  assert.ok(exoticPath('\\\\.\\UNC\\localhost\\C$\\p\\x', 'C:\\p', W))
  assert.ok(exoticPath('\\\\?\\UNC\\localhost\\C$\\p\\x', 'C:\\p', W))
})

test('exoticPath：不带盘符的设备路径（GLOBALROOT、卷 GUID、管道）认得出来', () => {
  assert.ok(exoticPath('\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\p\\x', 'C:\\p', W))
  assert.ok(exoticPath('\\\\?\\Volume{0b8c1a7e-0000-0000-0000-100000000000}\\p\\x', 'C:\\p', W))
  assert.ok(exoticPath('\\\\.\\pipe\\x', 'C:\\p', W))
})

test('exoticPath：项目本身在网络共享上时，同一个共享下的路径不算', () => {
  assert.equal(exoticPath('\\\\srv\\share\\p\\src\\a.ts', '\\\\srv\\share\\p', W), null)
})

test('exoticPath：普通的本地绝对路径、带盘符的设备前缀都不算（后者由 norm 解析）', () => {
  assert.equal(exoticPath('C:\\p\\src\\a.ts', 'C:\\p', W), null)
  assert.equal(exoticPath('\\\\?\\C:\\p\\src\\a.ts', 'C:\\p', W), null)
})

test('exoticPath：POSIX 上冒号、结尾的点都是合法文件名字符，不算', () => {
  assert.equal(exoticPath('/p/a:b', '/p', { platform: 'linux' }), null)
  assert.equal(exoticPath('/p/a.', '/p', { platform: 'darwin' }), null)
})

// ---- 门禁子进程：审查报告里的复现形状 ----

const PROJECT = {
  available_roles: ['at-backend', 'at-frontend', 'at-qa', 'at-acceptance'],
  paths: { 'at-backend': ['src/server/'], 'at-frontend': ['src/web/'] },
}
const HISTORY = [
  { stage: 'S1', at: '2026-09-17T14:30:00Z' },
  { stage: 'S2', at: '2026-09-17T14:40:00Z' },
  { stage: 'S3', at: '2026-09-17T14:50:00Z' },
]

function withRun(body) {
  const dirs = makeRun({ project: PROJECT, stage: 'S3', history: HISTORY, artifacts: ['00-contract.md'] })
  try {
    const p = dirs.projectDir
    mkdirSync(join(p, 'src', 'server'), { recursive: true })
    mkdirSync(join(p, 'src', 'web'), { recursive: true })
    const gate = (check, input) => run(check, input, GATE, p, hermeticEnv())
    body({ p, gate, runDir: join(p, '.agent-team', 'runs', 'r1') })
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

const write = (agent, file_path, content = 'x') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_type: agent,
  tool_input: { file_path, content },
})
const denied = (r) => decisionOf(r.stdout)?.permissionDecision === 'deny'

// 把 history 删短的 state.json——H6 必须拒。
function shrunkState(runDir) {
  const before = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'))
  return JSON.stringify({ ...before, stage: 'S2', history: HISTORY.slice(0, 2) })
}

test('门禁：at-acceptance 经指向 .agent-team 的链接写契约——H3 与 H4 都拒', () => {
  withRun(({ p, gate }) => {
    linkDir(join(p, '.agent-team'), join(p, 'lnk'))
    const input = write('agent-team:at-acceptance', join(p, 'lnk', 'runs', 'r1', '00-contract.md'))
    assert.ok(denied(gate('writepath', input)), 'writepath')
    assert.ok(denied(gate('contract', input)), 'contract')
  })
})

test('门禁：at-acceptance 经链接写 state.json 与 current-run——H3 拒', () => {
  withRun(({ p, gate }) => {
    linkDir(join(p, '.agent-team'), join(p, 'lnk'))
    assert.ok(denied(gate('writepath', write('agent-team:at-acceptance', join(p, 'lnk', 'runs', 'r1', 'state.json')))))
    assert.ok(denied(gate('writepath', write('agent-team:at-acceptance', join(p, 'lnk', 'current-run')))))
  })
})

test('门禁：PM 经链接把 history 删短——H6 拒', () => {
  withRun(({ p, gate, runDir }) => {
    linkDir(join(p, '.agent-team'), join(p, 'lnk'))
    const input = write('at-pm', join(p, 'lnk', 'runs', 'r1', 'state.json'), shrunkState(runDir))
    assert.ok(denied(gate('rework', input)))
  })
})

test('门禁：at-frontend 经自己地盘里一个指向 src/server 的链接写后端代码——H3 拒', () => {
  withRun(({ p, gate }) => {
    linkDir(join(p, 'src', 'server'), join(p, 'src', 'web', 'lnk'))
    assert.ok(denied(gate('writepath', write('agent-team:at-frontend', join(p, 'src', 'web', 'lnk', 'api.ts')))))
  })
})

test('对照：at-backend 经一个指向自己地盘的链接写自己的代码——放行，不多拦', () => {
  withRun(({ p, gate }) => {
    linkDir(join(p, 'src', 'server'), join(p, 'srv'))
    assert.equal(gate('writepath', write('agent-team:at-backend', join(p, 'srv', 'api.ts'))).stdout, '')
  })
})

test('门禁：at-acceptance 用 .agent-team 的 8.3 短名写契约——H3 与 H4 都拒', { skip: !WIN }, (t) => {
  withRun(({ p, gate }) => {
    const short = shortPathOf(join(p, '.agent-team'))
    if (short.toLowerCase().endsWith('.agent-team')) {
      t.skip('这个卷没开 8.3 短名')
      return
    }
    const input = write('agent-team:at-acceptance', join(short, 'runs', 'r1', '00-contract.md'))
    assert.ok(denied(gate('writepath', input)), 'writepath')
    assert.ok(denied(gate('contract', input)), 'contract')
  })
})

test('门禁：at-acceptance 用 \\\\?\\ 前缀写契约——H3 与 H4 都拒', { skip: !WIN }, () => {
  withRun(({ gate, runDir }) => {
    const input = write('agent-team:at-acceptance', `\\\\?\\${join(runDir, '00-contract.md')}`)
    assert.ok(denied(gate('writepath', input)), 'writepath')
    assert.ok(denied(gate('contract', input)), 'contract')
  })
})

// PM 那一半用结尾带点：::$DATA 会被 realpath 解析回 state.json、由 norm() 那一层就认出来，
// 测不到 H6 里那段 exoticPath。
test('门禁：at-acceptance 写 current-run::$DATA——H3 拒；PM 写 state.json.（结尾带点）——H6 拒', { skip: !WIN }, () => {
  withRun(({ p, gate, runDir }) => {
    assert.ok(denied(gate('writepath', write('agent-team:at-acceptance', `${join(p, '.agent-team', 'current-run')}::$DATA`))))
    assert.ok(denied(gate('rework', write('at-pm', `${join(runDir, 'state.json')}.`, shrunkState(runDir)))))
  })
})

test('门禁：at-acceptance 经本机管理共享写 project.json——H3 拒，而且不去碰网络', { skip: !WIN }, () => {
  withRun(({ p, gate }) => {
    const unc = `\\\\localhost\\${p[0]}$${p.slice(2)}\\.agent-team\\project.json`
    assert.ok(denied(gate('writepath', write('agent-team:at-acceptance', unc))))
  })
})

test('门禁：macOS 上 at-acceptance 用大小写变体写契约——H3 与 H4 都拒', { skip: !MAC }, () => {
  withRun(({ p, gate }) => {
    const input = write('agent-team:at-acceptance', join(p, '.AGENT-TEAM', 'runs', 'r1', '00-contract.md'))
    assert.ok(denied(gate('writepath', input)), 'writepath')
    assert.ok(denied(gate('contract', input)), 'contract')
  })
})

test('对照：项目里没有 .agent-team 时，H6 不因为流后缀之类的写法拦主线程——那不是它的地盘', { skip: !WIN }, () => {
  const d = tempDir('agent-team-alias-norun-')
  try {
    const r = run('rework', write(undefined, `${join(d, 'notes.txt')}::$DATA`), GATE, d, hermeticEnv())
    assert.equal(r.stdout, '')
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

// ---- run id：白名单，不是黑名单（审查第 31 条）----

function ctxWithPointer(pointer, { makeDir = true } = {}) {
  const dirs = makeRun({ project: PROJECT })
  try {
    const base = join(dirs.projectDir, '.agent-team')
    if (makeDir) mkdirSync(join(base, 'runs', pointer.replace(/[:]/g, '_')), { recursive: true })
    writeFileSync(join(base, 'current-run'), pointer)
    return readRunContext(dirs.projectDir, PLUGIN_ROOT)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

test('run id：单独一个点不是合法的 run id——它会让 run 目录落在 runs/ 本身', () => {
  const ctx = ctxWithPointer('.', { makeDir: false })
  assert.equal(ctx.ok, false)
  assert.equal(ctx.kind, 'unreadable')
  assert.match(ctx.reason, /不是合法的 run id/, '必须是 run id 校验拦下的，不是后面读不到 state.json')
})

test('run id：带 NTFS 流后缀的 run id 不合法', () => {
  const ctx = ctxWithPointer('r1::$INDEX_ALLOCATION', { makeDir: false })
  assert.equal(ctx.ok, false)
  assert.equal(ctx.kind, 'unreadable')
  assert.match(ctx.reason, /不是合法的 run id/, '必须是 run id 校验拦下的')
})

test('run id：命令正文规定的形状（日期-时刻-slug）照样合法', () => {
  const dirs = makeRun({ project: PROJECT, runId: '20260928-2210-path-alias' })
  try {
    const ctx = readRunContext(dirs.projectDir, PLUGIN_ROOT)
    assert.equal(ctx.ok, true, ctx.reason)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

test('runs/ 下只有 .DS_Store 这类杂项文件、指针不在：判 no-run，不是「有人建过 run」', () => {
  const dirs = makeRun({ project: PROJECT })
  try {
    const base = join(dirs.projectDir, '.agent-team')
    rmSync(join(base, 'current-run'))
    rmSync(join(base, 'runs'), { recursive: true, force: true })
    mkdirSync(join(base, 'runs'))
    writeFileSync(join(base, 'runs', '.DS_Store'), '')
    const ctx = readRunContext(dirs.projectDir, PLUGIN_ROOT)
    assert.equal(ctx.kind, 'no-run', ctx.reason)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
})

// 结尾带点：Win32 会把它剥掉，写的就是契约本身；而 Node 的路径 API 不剥，norm() 认不出来——
// 这一条只有 H4 里那段 exoticPath 拦得住（::$DATA 不行：realpath 已经把它解析回契约）。
test('门禁：at-acceptance 写 00-contract.md.（结尾带点）——H4 自己就拒（不靠 H3 先拦）', { skip: !WIN }, () => {
  withRun(({ gate, runDir }) => {
    assert.ok(denied(gate('contract', write('agent-team:at-acceptance', `${join(runDir, '00-contract.md')}.`))))
  })
})
