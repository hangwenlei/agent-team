// 判据用：门禁子进程以 `node -r` 预加载它，读某个文件名的文件时抛 EBUSY——模拟杀毒软件、索引器、别的程序的短暂占用。Windows 上用权限位造不出
// 「在、却读不出」的文件（锁要另一个进程持着），这样三个系统都造得出（docs/83 §8、docs/84）。
// AGENT_TEAM_TEST_FAIL_READ_NAME：文件名（不给是 project.json）；AGENT_TEAM_TEST_FAIL_READS：失败几次（不给就一直失败）。只碰文件名正好是它的读，别的读照常。
// 帮手在 tests/helpers/fail-read.mjs。
const fs = require('fs')
const original = fs.readFileSync
const name = process.env.AGENT_TEAM_TEST_FAIL_READ_NAME || 'project.json'
const times = process.env.AGENT_TEAM_TEST_FAIL_READS
let left = times === undefined ? Infinity : Number(times)
const endsWithName = (p) => typeof p === 'string' && (p === name || p.endsWith('/' + name) || p.endsWith(String.fromCharCode(92) + name))
fs.readFileSync = function readFileSync(path, ...rest) {
  if (endsWithName(path) && left > 0) {
    left -= 1
    const err = new Error(`EBUSY: resource busy or locked, open '${path}'`)
    err.code = 'EBUSY'
    throw err
  }
  return original.call(this, path, ...rest)
}
