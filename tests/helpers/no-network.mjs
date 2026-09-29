// 以 `node --import <本文件> hooks/boot.mjs <检查项>` 预加载：门禁进程里任何一次拿网络路径去
// 调 fs（lstat、stat、realpath、readlink、exists、readFile、readdir），都往 stderr 写一行
// `NET-TOUCH <函数> <路径>` 并当作不存在处理，不真的去连 SMB。
//
// 为什么要钉这一条（M3q 复核，docs/25）：门禁在 PreToolUse 上跑，早于平台对网络路径的人工
// 确认；它对 \\server\share 做一次 lstat，就会在用户来得及拒绝之前发出 SMB 连接——慢（服务器
// 不通时逼近 hooks.json 的 30 秒超时），还可能泄露 NTLM 凭据。平台自己的 Write 也特意对网络
// 路径跳过 stat。只断言「拒了」钉不住这一点：先 lstat 再拒，结论一样。
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

// 网络路径：\\server\share、\\?\UNC\…、\\.\UNC\…、\??\…，以及不带盘符的设备路径。
// 带盘符的设备前缀（\\?\C:\…）不算——那是本地文件。
function isNetwork(p) {
  if (typeof p !== 'string') return false
  const s = p.replace(/\//g, '\\')
  if (/^\\\?\?\\/.test(s)) return true
  if (/^\\\\[?.]\\[A-Za-z]:(\\|$)/.test(s)) return false
  return /^\\\\/.test(s)
}

function wrap(name, fn, onBlocked) {
  const wrapped = function (p, ...rest) {
    if (isNetwork(String(p))) {
      process.stderr.write(`NET-TOUCH ${name} ${p}\n`)
      return onBlocked()
    }
    return fn.call(this, p, ...rest)
  }
  return wrapped
}

const enoent = () => {
  const e = new Error('no-network shim: blocked')
  e.code = 'ENOENT'
  throw e
}

for (const name of ['lstatSync', 'statSync', 'readlinkSync', 'readFileSync', 'readdirSync']) {
  fs[name] = wrap(name, fs[name], enoent)
}
fs.existsSync = wrap('existsSync', fs.existsSync, () => false)
const realpathNative = fs.realpathSync.native
const realpath = wrap('realpathSync', fs.realpathSync, enoent)
realpath.native = wrap('realpathSync.native', realpathNative, enoent)
fs.realpathSync = realpath
syncBuiltinESMExports()
