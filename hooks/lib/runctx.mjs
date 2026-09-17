// 把门禁需要的磁盘状态读成数据。所有失败都返回 { ok: false, reason, kind }，
// 绝不抛异常——门禁的调用方需要自己决定 fail open 还是 fail closed，
// 而不是被一个异常替它决定。
//
// 「绝不抛异常」是这个模块对外的硬契约，不是「代码顺手没写会抛的地方」：
// Task 3-6 的真实调用形如 readRunContext(process.cwd(), process.env.CLAUDE_PLUGIN_ROOT)，
// CLAUDE_PLUGIN_ROOT 没设置时就是 undefined，传给 path.join 会同步抛 TypeError。
// 这类问题必须由这个函数自己兜住（下面整个函数体包一层 try/catch），而不是
// 指望四个下游调用方各自防一遍——防漏一处，fail-closed 的检查项就会把
// 「门禁自己读不到上下文」误判成别的错误路径（Task 2 评审 I3）。
//
// Task 4 复审：kind 字段是这次新加的，区分 ok:false 的两种截然不同的性质——
// 旧版本只有一个 { ok:false, reason }，把它们压成了同一件事，H3（以及
// Task 5 的 H4）作为 fail-closed 的检查项没法区分，只能对两者一视同仁地
// 拒绝。这两种性质分别是：
//
//   kind: 'no-run'     压根没有进行中的 run（没有 .agent-team、没有
//                       current-run、current-run 指向的 run 目录不存在）。
//                       这不是「门禁判不出来」——门禁做出了一个有依据的
//                       判定：本次调用不归它管。H3/H4 的全部前提是「一个
//                       run 正在跑，角色各自认领了地盘」；没有 run 就没有
//                       地盘可言。fail-closed 的检查项在这种情形下应该
//                       放行（但要按 H2 的先例往 stderr 留痕，不能静默——
//                       静默的放行和门禁真的坏掉长得一模一样，见
//                       hooks/gate.mjs 的 writepath 分支）。
//                       不区分的后果是自举死锁：建第一个 run 之前
//                       .agent-team 还不存在，ok 必然是 false；如果笼统
//                       fail closed，从主线程（或被 settings.json 钉成
//                       主线程的具名角色，比如 at-pm）写
//                       .agent-team/project.json 这个自举动作本身永远
//                       做不成，第一个 run 永远建不出来，门禁把自己锁在
//                       门外。
//
//   kind: 'unreadable' run 存在但读不出来，或者输入本身不可信（state.json/
//                       project.json 坏了、内容不是对象、current-run 是
//                       空文件、runId 含路径穿越字符、两个根传了非字符串、
//                       以及任何意外异常）。这才是门禁真的判不出来，规格
//                       §6 fail closed 说的是这种情形，继续拒绝。这条边界
//                       不能因为上面那条放宽：一个被写坏的 project.json
//                       必须继续落在这里，否则把 project.json 写坏就成了
//                       绕过 H3/H4 per-role 隔离的办法——run 明明还在跑，
//                       角色认领数据却因为文件损坏而不被承认。
//
// 【M1b 终审 C1】失败返回里也带 agentTeamDir。理由：有一类判定只需要「.agent-team
// 在哪」，压根不需要一个进行中的 run——触达表就是这样（它的判据只有插件侧的
// roster.json 与刚写完的 .agent-team/project.json，两者都与 run 无关），而
// /at-init 按设计恰恰跑在**没有 run 的时候**。ok:false 时把这个字段一并给出去，
// 调用方才有可能区分「这次写入与我无关」和「这次写入正好是我唯一该发声的那一个」。
// 唯一没有它的是最外层兜底 catch：那一支连 join(projectDir, '.agent-team') 都可能
// 就是抛异常的原因（projectDir 不是字符串），base 根本没被算出来、也不在作用域里。
// ⚠️ 这个字段不改变任何 kind 语义：它只是一条路径，不是「可以继续往下判」的许可。
//
// current-run 是空文件属于 unreadable 而不是 no-run，是一个有意的判断：
// pointer 文件本身存在（不同于「找不到 pointer」），空内容更像是写入过程
// 被打断的异常状态，不是「nobody has started a run yet」那种干净的缺席。
// 分类成 unreadable 更安全——如果算 no-run，任何能把 current-run 截断成
// 空文件的手段（哪怕只是 H3 已知边界里那条「Bash 能写文件」）都会被当成
// 「没有 run」而放行，即便 runs/<真实 id>/ 下还有一个真正在跑的 run。
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

/**
 * 单独读 `.agent-team/project.json`，不要求有进行中的 run（M1b 终审 C1）。
 *
 * 为什么不让 gate.mjs 自己 readFileSync：`readJson` 已经把「JSON.parse 过了但取不出
 * 字段」（`null` / `[]` / `"x"`）这条边界处理掉了，在 gate.mjs 里再手写一份就是同一份
 * 知识的第二份拷贝——`hooks/lib/path-norm.mjs` 头部记着两份逐字相同的 `norm()` 真的
 * 分叉过，结论是抽成单一导出。用户项目里 `.agent-team` 的读盘也只该有这一层。
 *
 * 与 readRunContext 一样绝不抛：失败返回 { ok: false, reason }。
 */
export function readProjectConfig(projectDir) {
  try {
    const path = join(projectDir, '.agent-team', 'project.json')
    if (!existsSync(path)) return { ok: false, reason: `找不到 ${path}` }
    return readJson(path)
  } catch (err) {
    return { ok: false, reason: `读取 project.json 失败：${err.message}` }
  }
}

// projectDir：用户仓库根，放 .agent-team（current-run / state.json / project.json）。
// pluginDir：插件根，放 stages.json。两者不是同一个目录——hook 以用户项目为 cwd 运行，
// 插件文件要用 ${CLAUDE_PLUGIN_ROOT} 定位。混用会在真实环境里读不到东西而单测照样绿。
export function readRunContext(projectDir, pluginDir) {
  try {
    const base = join(projectDir, '.agent-team')
    const pointer = join(base, 'current-run')
    if (!existsSync(pointer)) {
      return {
        ok: false,
        kind: 'no-run',
        agentTeamDir: base,
        reason: `找不到 ${pointer}——当前没有进行中的 run`,
      }
    }

    let runId = ''
    try {
      runId = readFileSync(pointer, 'utf8').trim()
    } catch (err) {
      // pointer 存在（刚过了 existsSync）但读不出来——权限、被并发进程占用
      // 之类的异常状态，不是「没有 run」，门禁真的判不出来。
      return {
        ok: false,
        kind: 'unreadable',
        agentTeamDir: base,
        reason: `读取 current-run 失败：${err.message}`,
      }
    }
    // 空文件不算 no-run，见文件头部注释：pointer 存在但内容为空是异常
    // 状态，不是干净的缺席，归 unreadable 更安全。
    if (!runId) {
      return { ok: false, kind: 'unreadable', agentTeamDir: base, reason: 'current-run 是空的' }
    }
    // current-run 的内容会被原样拼进 runs/<runId>/... 路径。不校验的话，一个
    // 含 ../ 的 runId 会被 path.join 正规化到 .agent-team/runs 之外，让 H5
    // 交付物门禁跑去别的目录判定产物是否存在——这是路径可信边界问题，不是
    // 普通的「文件不存在」失败，必须在拼路径之前挡住（Task 2 评审 M2）。
    // 归 unreadable：这是输入不可信，不是「没有 run」，这条边界不能放松。
    if (runId.includes('/') || runId.includes('\\') || runId.includes('..')) {
      return {
        ok: false,
        kind: 'unreadable',
        agentTeamDir: base,
        reason: `current-run 内容不是合法的 run id（含路径分隔符或 ..）：${JSON.stringify(runId)}`,
      }
    }

    const runDir = join(base, 'runs', runId)
    if (!existsSync(runDir)) {
      // current-run 指向的 run 目录不存在——指针指向了一个从没建出来、
      // 或已经被清理掉的 run。同样是「没有 run 可管」，归 no-run。
      return {
        ok: false,
        kind: 'no-run',
        agentTeamDir: base,
        reason: `current-run 指向 ${runId}，但 ${runDir} 不存在`,
      }
    }

    // 走到这里，run 目录本身已确认存在——下面几步读到的任何失败都是
    // 「这个真实存在的 run 读不出来」，不再有 no-run 的可能，一律 unreadable。
    const state = readJson(join(runDir, 'state.json'))
    if (!state.ok) return { ok: false, kind: 'unreadable', agentTeamDir: base, reason: state.reason }

    const stages = readJson(join(pluginDir, 'stages.json'))
    if (!stages.ok) return { ok: false, kind: 'unreadable', agentTeamDir: base, reason: stages.reason }

    const projectPath = join(base, 'project.json')
    const project = existsSync(projectPath) ? readJson(projectPath) : { ok: true, value: null }
    if (!project.ok) return { ok: false, kind: 'unreadable', agentTeamDir: base, reason: project.reason }

    return {
      ok: true,
      runId,
      runDir,
      state: state.value,
      stages: stages.value,
      project: project.value,
      // agentTeamDir 是 .agent-team 本身（runDir 的爷爷目录）。H3 判定控制文件要用
      // 它：current-run / project.json / reach.json 都在这一层、不在 runDir 里。
      // 让 decideWritePath 自己从 runDir 往上推两级也行，但那会是第二处「.agent-team
      // 在哪」的知识——这个文件已经是那条知识的唯一来源（上面的 base），直接给出去。
      agentTeamDir: base,
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
      // 与 artifactExists 同构：ledger 要拿 00-contract.md 的字节去算 sha256。
      // 读不到一律返回 null，绝不抛——这个模块对外的硬契约是「所有失败都返回数据，
      // 不抛异常」，闭包里也不例外（join 也在 try 里面，理由同 artifactExists）。
      artifactBytes(rel) {
        try {
          return readFileSync(join(runDir, rel))
        } catch {
          return null
        }
      },
    }
  } catch (err) {
    // 兜底分支：projectDir/pluginDir 传了非字符串导致 join() 同步抛出，
    // 或者任何没预料到的异常。这不是「没有 run」——门禁自己都不知道出了
    // 什么问题，只能按最严格的 unreadable 处理。
    //
    // ⚠️ 这一支**没有** agentTeamDir，和上面每一条失败返回都不一样，这是有意的：
    // 抛出的很可能正是 join(projectDir, '.agent-team') 自己（projectDir 不是字符串），
    // base 从来没被算出来、此刻也不在作用域里。硬凑一个值出来就是在编一条路径。
    // 调用方按「取不到 agentTeamDir 就照原路 fail open」处理，见 hooks/gate.mjs 的
    // ledger 分支。
    return { ok: false, kind: 'unreadable', reason: `读取运行上下文失败：${err.message}` }
  }
}
