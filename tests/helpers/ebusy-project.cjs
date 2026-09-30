// 门禁子进程的预加载（node -r）：对 .agent-team/project.json 的前 N 次 readFileSync 抛 EBUSY，N 取环境变量
// AGENT_TEAM_TEST_EBUSY_READS——模拟 Windows 上杀毒软件、索引器短暂占用文件（M3u 复核轮，docs/29）。
// syncBuiltinESMExports 让门禁里 `import { readFileSync } from 'node:fs'` 的具名导入也看到替换后的函数。
const fs = require('fs')
const { syncBuiltinESMExports } = require('module')

let left = Number(process.env.AGENT_TEAM_TEST_EBUSY_READS) || 0
const original = fs.readFileSync
fs.readFileSync = function readFileSync(file, ...rest) {
  if (left > 0 && typeof file === 'string' && /[\\/]project\.json$/.test(file)) {
    left -= 1
    const err = new Error(`EBUSY: resource busy or locked, open '${file}'`)
    err.code = 'EBUSY'
    throw err
  }
  return original.call(this, file, ...rest)
}
syncBuiltinESMExports()
