import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { readRunContext } from '../hooks/lib/runctx.mjs'
import { makeRun } from './fixtures/make-run.mjs'

const STAGES = { S2: { role: 'at-product', requires: ['00-contract.md'], produces: ['01-prd.md'] } }

function cleanup({ projectDir, pluginDir }) {
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(pluginDir, { recursive: true, force: true })
}

test('读得到当前 run 的 id、state 与 stages', () => {
  const dirs = makeRun({ runId: 'r42', stage: 'S2', stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.equal(ctx.runId, 'r42')
    assert.equal(ctx.state.stage, 'S2')
    assert.deepEqual(ctx.stages.S2.produces, ['01-prd.md'])
  } finally {
    cleanup(dirs)
  }
})

test('没有 .agent-team 时返回 ok:false 而不是抛异常，kind 是 no-run', () => {
  const ctx = readRunContext('/definitely/not/a/real/path', '/also/not/real')
  assert.equal(ctx.ok, false)
  assert.match(ctx.reason, /current-run|\.agent-team/)
  // Task 4 复审：这是「压根没有进行中的 run」，门禁没有东西要管——不是
  // 「判不出来」。fail-closed 的检查项（H3/H4）要靠这个字段放行，不能把
  // 这种情形跟下面那些「run 存在但读不出来」的情形混在一起 fail closed，
  // 否则建第一个 run 之前的自举写入会被永久拒绝（自举死锁）。
  assert.equal(ctx.kind, 'no-run')
})

test('current-run 指向不存在的 run 时返回 ok:false，kind 是 no-run', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    rmSync(`${dirs.projectDir}/.agent-team/runs/r1`, { recursive: true, force: true })
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    // M1：不止判定失败，还要钉住失败原因是「目录不存在」，
    // 不是别的碰巧也返回 ok:false 的路径。
    assert.match(ctx.reason, /不存在/)
    // current-run 指向的 run 目录不存在——指针指向了一个从没建出来/已经
    // 被清理的 run，同样是「没有 run 可管」，不是「读不出来」。
    assert.equal(ctx.kind, 'no-run')
  } finally {
    cleanup(dirs)
  }
})

test('current-run 是空文件时返回 ok:false，kind 是 unreadable（不是 no-run）', () => {
  // 这条特意跟上面两条「no-run」区分开：pointer 文件本身存在（不同于
  // 「找不到 pointer」），只是内容为空——这不是"nobody has started a run
  // yet"那种干净的缺席状态，而是指针本身处于异常状态（比如写入过程中被
  // 打断）。分类成 unreadable 更安全：如果分成 no-run，任何能把 current-run
  // 截断成空文件的手段（哪怕只是权限之外的 Bash 写文件，H3 已知边界里
  // 明说 Bash 能写文件）都会被当成"没有 run"而放行，即便 runs/<真实id>/
  // 下还有一个真正在跑、真正有 project.json 认领数据的 run。
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/current-run`, '', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.match(ctx.reason, /空/)
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

test('state.json 是坏 JSON 时返回 ok:false 而不是抛异常，kind 是 unreadable', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/runs/r1/state.json`, '{ not json', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    // M1：钉住失败来自 readJson 的「解析失败」分支（reason 里带「失败」二字），
    // 而不是巧合落到了别的 ok:false 分支。
    assert.match(ctx.reason, /失败/)
    // run 目录本身是真实存在的（makeRun 造出来的），只是 state.json 坏了——
    // 这是"门禁坏了"，不是"没有东西要管"，必须继续 fail closed。
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// I2：JSON.parse('null')/('[]')/('"x"') 都是合法 JSON 但取不出字段。state.json
// 内容如果就是字面量 null，旧实现会让 readJson 返回 { ok:true, value:null }，
// 一路放行到 ctx.state.stage 才在某个下游任务里炸出 TypeError——而不是在这里
// 被判定为「读不到可用状态」。这条钉住 readJson 的形状守卫确实生效。
test('state.json 内容是合法 JSON 但不是对象（字面量 null）时返回 ok:false', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/runs/r1/state.json`, 'null', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.match(ctx.reason, /不是一个 JSON 对象/)
  } finally {
    cleanup(dirs)
  }
})

test('stages.json 从插件根读，不从项目根读', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    // 项目根里放一份内容不同的 stages.json——不应当被读到。
    writeFileSync(`${dirs.projectDir}/stages.json`, JSON.stringify({ SX: { role: 'wrong' } }), 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.ok(ctx.stages.S2, '读到的应当是插件根那份')
    assert.equal(ctx.stages.SX, undefined, '不应当读到项目根那份')
  } finally {
    cleanup(dirs)
  }
})

test('artifactExists 只在文件真存在时为 true', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['00-contract.md'], stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.artifactExists('00-contract.md'), true)
    assert.equal(ctx.artifactExists('01-prd.md'), false)
  } finally {
    cleanup(dirs)
  }
})

// M3：stages.json 里唯一的嵌套 produces 是 S5 的 05-impl/at-backend.md，
// 之前只测过平铺路径。同时钉住 artifactExists 用的是 isFile() 而不是
// existsSync()——目录本身存在但不是文件，不能被误判成产物已交付。
test('artifactExists 对嵌套路径的产物能判定，且目录本身不算产物', () => {
  const dirs = makeRun({ runId: 'r1', artifacts: ['05-impl/at-backend.md'], stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.artifactExists('05-impl/at-backend.md'), true)
    assert.equal(ctx.artifactExists('05-impl'), false, '目录不是文件，isFile() 必须判 false')
  } finally {
    cleanup(dirs)
  }
})

// I3：真实调用形如 readRunContext(process.cwd(), process.env.CLAUDE_PLUGIN_ROOT)。
// CLAUDE_PLUGIN_ROOT 没设置时就是 undefined，join(undefined, 'stages.json')
// 在旧实现里会同步抛 TypeError，直接冲出 readRunContext——这正是模块头部注释
// 自己承诺「绝不抛异常」所不允许的事。projectDir 给一个真实存在的目录，
// 只让 pluginDir 是 undefined，专门命中 join(pluginDir, 'stages.json') 这一步。
test('pluginDir 是 undefined 时返回 ok:false 而不是抛异常，kind 是 unreadable', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, undefined)
    assert.equal(ctx.ok, false)
    // 走的是整个函数体外层 try/catch 兜住的异常（join(undefined, ...)
    // 同步抛 TypeError），跟"没有 run"无关，是门禁自己拿到的参数有问题。
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// M2：current-run 的内容会被原样拼进 runs/<runId>/... 路径。不校验的话，
// ../../x 这样的内容会被 path.join 正规化到 .agent-team/runs 之外，
// 让 H5 交付物门禁去别的目录判定产物是否存在。
test('current-run 内容含路径穿越字符时返回 ok:false，kind 是 unreadable', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/current-run`, '../../x', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    assert.match(ctx.reason, /run id/)
    // 这条边界不能被"没有 run"放宽：路径穿越字符是路径可信边界问题，
    // 不是"没有东西要管"，必须继续 fail closed（Task 4 复审明确要求）。
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})

// I4：project 是 Interfaces 明确产出的字段，但此前没有任何用例传过
// makeRun 的 project 参数，也没有断言过「不存在时是 null」——两条分支
// 都是没被钉住的设计决定。这三条补上。

test('project.json 存在时，project 字段读到它的内容', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES, project: { name: 'demo-project' } })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.deepEqual(ctx.project, { name: 'demo-project' })
  } finally {
    cleanup(dirs)
  }
})

test('project.json 不存在时，project 字段是 null', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, true)
    assert.equal(ctx.project, null)
  } finally {
    cleanup(dirs)
  }
})

test('project.json 是坏 JSON 时整个上下文返回 ok:false，kind 是 unreadable（不能被当成 no-run 放宽）', () => {
  const dirs = makeRun({ runId: 'r1', stages: STAGES })
  try {
    writeFileSync(`${dirs.projectDir}/.agent-team/project.json`, '{ not json', 'utf8')
    const ctx = readRunContext(dirs.projectDir, dirs.pluginDir)
    assert.equal(ctx.ok, false)
    // Task 4 复审明确点名的边界：run 本身是真实存在的（makeRun 造出了
    // current-run/runs/<id>/state.json），只有 project.json 这一份坏了。
    // 如果这里也被归为 no-run 而 fail open，"把 project.json 写坏"就成了
    // 绕过 H3（以及 Task 5 的 H4）per-role 隔离的办法。
    assert.equal(ctx.kind, 'unreadable')
  } finally {
    cleanup(dirs)
  }
})
