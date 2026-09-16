// 把门禁需要的磁盘状态读成数据。所有失败都返回 { ok: false, reason }，
// 绝不抛异常——门禁的调用方需要自己决定 fail open 还是 fail closed，
// 而不是被一个异常替它决定。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function readJson(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (err) {
    return { ok: false, reason: `读取 ${path} 失败：${err.message}` }
  }
}

// projectDir：用户仓库根，放 .agent-team（current-run / state.json / project.json）。
// pluginDir：插件根，放 stages.json。两者不是同一个目录——hook 以用户项目为 cwd 运行，
// 插件文件要用 ${CLAUDE_PLUGIN_ROOT} 定位。混用会在真实环境里读不到东西而单测照样绿。
export function readRunContext(projectDir, pluginDir) {
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
      const p = join(runDir, rel)
      try {
        return statSync(p).isFile()
      } catch {
        return false
      }
    },
  }
}
