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
import { resolve, sep } from 'node:path'

export function norm(p) {
  // 先 resolve 再统一分隔符：防止 .. 与正/反斜杠差异绕过前缀比对（比对的是
  // 解析后的绝对路径，不是原始字符串）。
  const resolved = resolve(p).split(sep).join('/')
  // Windows 文件系统大小写不敏感，但 resolve() 保留调用方给的原始大小写：
  // filePath 来自工具调用方给的 file_path/notebook_path，runDir 与 base 最终
  // 来自 process.cwd()，两者不同源，盘符或路径段的大小写可能对不齐
  // （C:\proj\... vs c:\proj\...，或 SRC vs src）。POSIX 文件系统大小写敏感，
  // 'src' 与 'SRC' 真的是两个不同的文件，不能对它做同样的折叠——这条分支只在
  // win32 触发，POSIX 上这一行根本跑不到。
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
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
