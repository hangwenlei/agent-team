// 门禁子进程的预加载（node -r）：按脚本改写对 .agent-team/project.json 的 readFileSync（M3u，docs/29）——模拟 Windows
// 上杀毒软件、索引器的短暂占用，以及读到别人写了一半的内容。
//   AGENT_TEAM_TEST_PROJECT_READS：逗号分隔的脚本，依次作用于每一次读，「动作*次数」表示连着几次：
//     busy —— 抛 EBUSY；half —— 只给出真实内容的前一半；ok —— 照常读。脚本用完之后照常读。
//   AGENT_TEAM_TEST_PROJECT_BUSY_MS：第一次读之后这么多毫秒以内的读一律抛 EBUSY（按时间的占用窗口）。
//   AGENT_TEAM_TEST_COUNT_WAITS=1：数 Atomics.wait 的次数，进程退出时往 stderr 写一行「agent-team-test waits=N」。
//     用 fs.writeSync：退出时的 process.stderr.write 在 macOS 的管道上是异步的，会丢。
// syncBuiltinESMExports 让门禁里 `import { readFileSync } from 'node:fs'` 的具名导入也看到替换后的函数。
const fs = require('fs')
const { syncBuiltinESMExports } = require('module')

const script = []
for (const part of (process.env.AGENT_TEAM_TEST_PROJECT_READS || '').split(',').filter(Boolean)) {
  const [action, times] = part.split('*')
  for (let i = 0; i < (Number(times) || 1); i += 1) script.push(action)
}
const busyMs = Number(process.env.AGENT_TEAM_TEST_PROJECT_BUSY_MS) || 0
let firstRead = null

function busy(file) {
  const err = new Error(`EBUSY: resource busy or locked, open '${file}'`)
  err.code = 'EBUSY'
  return err
}

const original = fs.readFileSync
fs.readFileSync = function readFileSync(file, ...rest) {
  if (typeof file === 'string' && /[\\/]project\.json$/.test(file)) {
    const now = Date.now()
    if (firstRead === null) firstRead = now
    if (busyMs && now - firstRead < busyMs) throw busy(file)
    const action = script.shift()
    if (action === 'busy') throw busy(file)
    if (action === 'half') {
      const content = original.call(this, file, ...rest)
      return content.slice(0, Math.floor(content.length / 2))
    }
  }
  return original.call(this, file, ...rest)
}
syncBuiltinESMExports()

if (process.env.AGENT_TEAM_TEST_COUNT_WAITS === '1') {
  let waits = 0
  const wait = Atomics.wait
  Atomics.wait = function countedWait(...args) {
    waits += 1
    return wait.apply(this, args)
  }
  process.on('exit', () => fs.writeSync(2, `agent-team-test waits=${waits}\n`))
}
