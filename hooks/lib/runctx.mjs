// 把门禁需要的磁盘状态读成数据。所有失败都返回 { ok: false, reason }，
// 绝不抛异常——门禁的调用方需要自己决定 fail open 还是 fail closed，
// 而不是被一个异常替它决定。
//
// 「绝不抛异常」是这个模块对外的硬契约，不是「代码顺手没写会抛的地方」：
// Task 3-6 的真实调用形如 readRunContext(process.cwd(), process.env.CLAUDE_PLUGIN_ROOT)，
// CLAUDE_PLUGIN_ROOT 没设置时就是 undefined，传给 path.join 会同步抛 TypeError。
// 这类问题必须由这个函数自己兜住（下面整个函数体包一层 try/catch），而不是
// 指望四个下游调用方各自防一遍——防漏一处，fail-closed 的检查项就会把
// 「门禁自己读不到上下文」误判成别的错误路径（Task 2 评审 I3）。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function readJson(path) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    return { ok: false, reason: `读取 ${path} 失败：${err.message}` }
  }
  // JSON.parse('null')/('[]')/('"x"') 都是合法 JSON 但取不出字段——放行的话
  // ok:true 会带着不可用的 value 传给下游，某次 ctx.state.stage 这样的属性
  // 访问就会悄悄拿到 undefined，而不是在这里被明确拒绝。hooks/gate.mjs 的
  // isValidInput 就是为了挡同一类输入才加的，这里不能是唯一的例外
  // （Task 2 评审 I2）。
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: `读取 ${path} 失败：内容不是一个 JSON 对象` }
  }
  return { ok: true, value }
}

// projectDir：用户仓库根，放 .agent-team（current-run / state.json / project.json）。
// pluginDir：插件根，放 stages.json。两者不是同一个目录——hook 以用户项目为 cwd 运行，
// 插件文件要用 ${CLAUDE_PLUGIN_ROOT} 定位。混用会在真实环境里读不到东西而单测照样绿。
export function readRunContext(projectDir, pluginDir) {
  try {
    const base = join(projectDir, '.agent-team')
    const pointer = join(base, 'current-run')
    if (!existsSync(pointer)) {
      return { ok: false, reason: `找不到 ${pointer}——当前没有进行中的 run` }
    }

    let runId = ''
    try {
      runId = readFileSync(pointer, 'utf8').trim()
    } catch (err) {
      return { ok: false, reason: `读取 current-run 失败：${err.message}` }
    }
    if (!runId) return { ok: false, reason: 'current-run 是空的' }
    // current-run 的内容会被原样拼进 runs/<runId>/... 路径。不校验的话，一个
    // 含 ../ 的 runId 会被 path.join 正规化到 .agent-team/runs 之外，让 H5
    // 交付物门禁跑去别的目录判定产物是否存在——这是路径可信边界问题，不是
    // 普通的「文件不存在」失败，必须在拼路径之前挡住（Task 2 评审 M2）。
    if (runId.includes('/') || runId.includes('\\') || runId.includes('..')) {
      return {
        ok: false,
        reason: `current-run 内容不是合法的 run id（含路径分隔符或 ..）：${JSON.stringify(runId)}`,
      }
    }

    const runDir = join(base, 'runs', runId)
    if (!existsSync(runDir)) {
      return { ok: false, reason: `current-run 指向 ${runId}，但 ${runDir} 不存在` }
    }

    const state = readJson(join(runDir, 'state.json'))
    if (!state.ok) return { ok: false, reason: state.reason }

    const stages = readJson(join(pluginDir, 'stages.json'))
    if (!stages.ok) return { ok: false, reason: stages.reason }

    const projectPath = join(base, 'project.json')
    const project = existsSync(projectPath) ? readJson(projectPath) : { ok: true, value: null }
    if (!project.ok) return { ok: false, reason: project.reason }

    return {
      ok: true,
      runId,
      runDir,
      state: state.value,
      stages: stages.value,
      project: project.value,
      artifactExists(rel) {
        // join 放在 try 里面：rel 理论上总是 stages.json 里 requires/produces
        // 数组的字符串元素，但这层防御不该指望调用方守规矩——同一个教训
        // （I3）在这个闭包里单独存在一份，join 本身也不能留在 try 之外。
        try {
          return statSync(join(runDir, rel)).isFile()
        } catch {
          return false
        }
      },
    }
  } catch (err) {
    return { ok: false, reason: `读取运行上下文失败：${err.message}` }
  }
}
