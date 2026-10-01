// 以 `node -r <本文件> hooks/boot.mjs <检查项>` 预加载：让门禁在判定中途抛异常（M3v，docs/30）。gate.mjs 最外层 catch
// 的那几格（fail open 的检查项崩溃时发什么、写过 stdout 之后再崩时不写第二份）要子进程级地走一遍，而自然的触发只有
// 一份大到转不成字符串的产物（docs/27 §4）。AGENT_TEAM_TEST_THROW 选怎么抛，逗号分隔可以叠：
//   hash           crypto.createHash 一调就抛——ledger 算契约与产物的哈希、H5a 的账本比对都经过它；
//   prefix:<名字>   对这一个字符串调 startsWith 就抛——stripPluginPrefix 认目标角色时经过它；
//   exit           第一次 process.exit 抛——「写过 stdout 之后再崩」那一格；
//   read:<后缀>     readFileSync 读路径以这个后缀结尾（分隔符统一成 /）的文件就抛——H6 拍回退快照时逐份读产物（M3y），
//                  一份读不出来要落「不核」、不能让整次判定 fail closed。
// 写成 -r 的 .cjs 而不是 --import 的 .mjs：--import 要 Node 18.18 起才有（最低版本作业跑 16.9）。
const modes = String(process.env.AGENT_TEAM_TEST_THROW || '').split(',').filter(Boolean)

for (const mode of modes) {
  if (mode === 'hash') {
    const crypto = require('crypto')
    crypto.createHash = function () {
      throw new Error('injected: createHash')
    }
    require('module').syncBuiltinESMExports()
  } else if (mode.startsWith('prefix:')) {
    const target = mode.slice('prefix:'.length)
    const original = String.prototype.startsWith
    String.prototype.startsWith = function () {
      if (String(this) === target) throw new Error('injected: startsWith')
      return original.apply(this, arguments)
    }
  } else if (mode.startsWith('read:')) {
    const suffix = mode.slice('read:'.length)
    const fs = require('fs')
    const original = fs.readFileSync
    fs.readFileSync = function (p) {
      if (String(p).split('\\').join('/').endsWith(suffix)) throw new Error('injected: readFileSync')
      return original.apply(this, arguments)
    }
    require('module').syncBuiltinESMExports()
  } else if (mode === 'exit') {
    const original = process.exit
    let first = true
    process.exit = function (code) {
      if (first) {
        first = false
        throw new Error('injected: exit')
      }
      return original.call(process, code)
    }
  }
}
