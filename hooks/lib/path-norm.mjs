// 路径归一化：门禁在做任何「相等 / 前缀」比对之前，两边都要先过这个函数。
//
// 为什么单独成模块（全分支评审 · 整理项 5）：hooks/lib/writepath.mjs 与
// hooks/lib/contract-guard.mjs 曾各写一份逐字相同的 norm()，后者还附了一段
// 「重复是有意的」的论证，理由是"这几行只是通用的 Windows 路径语义，不会因为
// 两边各自的业务规则演化而分叉"。这个前提已经被证伪：I1 修的正是 writepath.mjs
// 单方面演化出来的一条缝（run 目录保护被挂到了 project.json 存在之上），两个
// 文件对同一批假设确实会分叉。
//
// 而且两边判错的方向相反，所以分叉的代价不对称：
//   - writepath.mjs 判错是**多拦**——把自己人挡在外面，且拒绝理由会说"这条
//     路径没有被任何角色认领"，是一句会把排查方向带偏到 project.json 的错误
//     指控；
//   - contract-guard.mjs 判错是**漏拦**——一次真实的契约写入因为盘符或路径段
//     大小写没对齐，被判成"目标不是契约文件"而放行，等于这道闸自己被绕过去。
// 漏拦那一份是安全洞，不是噪音；靠"两边各自记得改"维持不住，必须只有一份。
//
// M3q（docs/25，全量审查第 8、9 条）：只做字面规范化不够。字面不同、指向同一个物理文件的
// 写法——junction / 软链接、Windows 8.3 短名、\\?\ 设备前缀、macOS 的大小写变体——会让
// 「是不是契约 / 控制文件 / 在不在 run 目录下 / 归不归某个角色」全部认错，而且没有 paths 条目
// 的角色（at-qa、at-acceptance）会因此落到「未认领，放行」：没有 Bash 也能改写契约与
// state.json。所以 norm() 现在对已存在的最长前缀做 realpath.native，两边比较的都是物理位置；
// 解析不了的写法由 exoticPath() 认出来，门禁直接拒。
//
// 仍然认不出来的（登记在 docs/25）：硬链接与 bind mount——同一个 inode、两条互不相干的路径，
// 只有持 Bash 的角色建得出来，而 Bash 本来就不经门禁。
import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

// 同一个进程里对同一条路径只解析一次：一次门禁判定里 norm() 会被拿同样的前缀调很多遍
// （stageOwnerOfRunPath 逐阶段逐产者、underAny 逐前缀），而门禁进程只活一次调用。
const CANON = new Map()

/**
 * 大小写不敏感的平台：Windows（NTFS）与 macOS（APFS / HFS+ 的默认格式）。
 * 导出是为了能脱离当前平台单测这条口径。
 */
export function foldsCase(platform) {
  return platform === 'win32' || platform === 'darwin'
}

export function norm(p) {
  const real = canonical(resolve(p)).split(sep).join('/')
  if (process.platform === 'darwin') return real.normalize('NFC').toLowerCase()
  return foldsCase(process.platform) ? real.toLowerCase() : real
}

// 已存在的最长前缀做 realpath.native（解析链接、8.3 短名、设备前缀、磁盘上的真实大小写），
// 还不存在的尾巴原样拼回去。按 lstat 找前缀而不是 existsSync：后者跟随链接，一条悬空的链接
// 会被当成「不存在」，可往它里面写恰恰会把目标建出来——所以悬空链接要自己 readlink 跟过去。
// 绝不抛：任何一步出错都退回字面形式，比较照旧按字面进行。
function canonical(abs, depth = 0) {
  if (CANON.has(abs)) return CANON.get(abs)
  let out = abs
  try {
    const tail = []
    let head = abs
    for (;;) {
      let st = null
      try {
        st = lstatSync(head)
      } catch {}
      if (st) {
        let real
        try {
          real = realpathSync.native(head)
        } catch {
          // 悬空链接：realpath 找不到目标。顺着链接自己走一步（有深度上限，防环）。
          if (st.isSymbolicLink() && depth < 16) {
            real = canonical(resolve(dirname(head), readlinkSync(head)), depth + 1)
          } else {
            real = head
          }
        }
        out = tail.length ? join(real, ...tail) : real
        break
      }
      const parent = dirname(head)
      if (parent === head) break // 一路都不存在（比如不存在的盘）：字面形式
      tail.unshift(head.slice(parent.length).replace(/^[\\/]+/, ''))
      head = parent
    }
  } catch {
    out = abs
  }
  CANON.set(abs, out)
  return out
}

/**
 * 解析不了、也没有正当用途的写法：返回一句理由；普通路径返回 null。只在 Windows 上有这些形式——
 * POSIX 上冒号、结尾的点与空格都是合法的文件名字符。
 *   - 流后缀（`::$DATA`、`:名字`）：冒号在 Windows 文件名里只可能是流分隔符。写主流等于写文件
 *     本身，写别的流则把数据挂在同一个文件上；两种都不是任何角色该做的事。
 *   - 路径段结尾带点或空格：Win32 会把它们剥掉，`state.json.` 就是 `state.json`。
 *   - 网络路径（`\\server\share`、`\\?\UNC\…`，含本机管理共享 `\\localhost\C$`）而项目不在
 *     同一个共享上：它可能绕回本机的任何一个文件，而门禁没法不碰网络就认出来是哪一个。
 * 带盘符的设备前缀（`\\?\C:\…`、`\\.\C:\…`）不在这里——norm() 会把它解析回普通写法。
 * 纯字符串判断，不碰文件系统（网络路径尤其不能碰：那会去连 SMB）。
 */
export function exoticPath(p, projectRoot, { platform = process.platform } = {}) {
  if (platform !== 'win32' || typeof p !== 'string' || !p) return null
  const s = p.replace(/\//g, '\\')
  const unc = uncShare(s)
  // 去掉网络共享前缀或带盘符的设备前缀之后的那一段；冒号只许出现在盘符位置。
  const rest = unc ? s.slice(unc.length) : s.replace(/^\\\\[?.]\\/, '')
  const colonFrom = !unc && /^[A-Za-z]:/.test(rest) ? 2 : 0
  if (rest.indexOf(':', colonFrom) !== -1) {
    return `路径里带流后缀（冒号之后的部分）：${p}`
  }
  const segs = rest.split('\\')
  if (segs.some((x) => x !== '.' && x !== '..' && x !== '' && /[. ]$/.test(x))) {
    return `路径里有以点或空格结尾的段（Windows 会把它们剥掉，指向的是另一个名字）：${p}`
  }
  if (unc) {
    const rootShare = typeof projectRoot === 'string' ? uncShare(projectRoot.replace(/\//g, '\\')) : null
    if (!rootShare || rootShare.toLowerCase() !== unc.toLowerCase()) {
      return `这是网络路径（${unc}），而项目不在这个共享上——它可能绕回本机的任何文件：${p}`
    }
  }
  return null
}

// `\\server\share` 或 `\\?\UNC\server\share` 形式时返回规范化的 `\\server\share` 前缀，否则 null。
function uncShare(s) {
  let m = /^\\\\\?\\UNC\\([^\\]+)\\([^\\]+)/i.exec(s)
  if (!m) m = /^\\\\(?![?.]\\)([^\\]+)\\([^\\]+)/.exec(s)
  return m ? `\\\\${m[1]}\\${m[2]}` : null
}

/**
 * target 是不是 dir 本身、或 dir 底下的东西。
 *
 * 抽出来的理由与这个文件存在的理由是同一个（见上面 norm 的注释）：这段比较此前在
 * hooks/lib/writepath.mjs 与 hooks/gate.mjs 的 underRun 里各有一份逐字符相同的拷贝，
 * 而 I1 分叉的那条缝恰好就是这块 run 目录判定。两边判错的方向不同——writepath 那份
 * 判错是多拦或漏拦，ledger 那份判错是该说话时不说话——但「靠两边各自记得改」维持不住
 * 这件事是一样的（Task 6 评审 I-2）。
 *
 * 前缀比对必须带上末尾的 `/`：只用 startsWith(d) 会把 `.agent-team-backup` 误判成
 * `.agent-team` 底下的东西（`.agent-team-backup` 确实以 `.agent-team` 这个字符串
 * 开头，但它是兄弟目录，不是子目录）。tests/path-norm.test.mjs 的「前缀粘连」那条
 * 单独钉住这一点。
 */
export function underDir(target, dir) {
  if (typeof target !== 'string' || !target || typeof dir !== 'string' || !dir) return false
  const d = norm(dir)
  const t = norm(target)
  return t === d || t.startsWith(`${d}/`)
}
