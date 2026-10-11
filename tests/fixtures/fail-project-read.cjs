// 判据用（docs/83 §8）：门禁子进程以 `node -r` 预加载它，读 .agent-team/project.json 时抛 EBUSY——模拟杀毒软件、索引器的短暂占用。
// AGENT_TEAM_TEST_PROJECT_READ_FAILS 是要失败的次数；不给就一直失败。只碰文件名正好是 project.json 的读，别的读照常。
const fs = require('fs')
const original = fs.readFileSync
const env = process.env.AGENT_TEAM_TEST_PROJECT_READ_FAILS
let left = env === undefined ? Infinity : Number(env)
fs.readFileSync = function readFileSync(path, ...rest) {
  if (typeof path === 'string' && /[\\/]project\.json$/.test(path) && left > 0) {
    left -= 1
    const err = new Error(`EBUSY: resource busy or locked, open '${path}'`)
    err.code = 'EBUSY'
    throw err
  }
  return original.call(this, path, ...rest)
}
