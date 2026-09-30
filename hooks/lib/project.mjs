// .agent-team/project.json 的形状（M3u，docs/29，全量审查第 10 条）。
//
// 此前 project.json 只要是个合法对象，H3 就照单全收：paths 缺失、键名拼错、带插件前缀、被删掉——调用者在
// paths 里「没有键」——一律静默放行；前缀 '../' 认领到项目根之外，'' 与 '.' 认领整个项目根。这里把问题分三档：
//   - block（阻断）：H3 据此拒持有这个条目的角色（paths 本身缺失或不是对象时拒所有执行角色）；
//   - fix（要改）：/agent-team:at-init 明令禁止、或者按字面比较一定落空的写法；
//   - confirm（请确认）：可能是有意的，PM 读一遍，是想要的就不动。
// 纯函数，不碰文件系统。外部值（键、前缀、available_roles 的元素）一律过 quote（docs/27）。
import path from 'node:path'
import { quote } from './trusted.mjs'
import { isPlainObject } from './stages.mjs'
import { isValidRoster } from './decide.mjs'

// 按设计不认领路径的角色：H3 对它们在 run 目录之外放行（审查第 34 条另论）。与 templates/project.json 的
// available_roles 减去 paths 的键逐一对账（tests/project.test.mjs）；/agent-team:at-init 明令不给它们建键，
// 它们的正文也照此写着「写路径隔离连拒都不会拒你」。
export const NO_PATHS_ROLES = ['at-qa', 'at-acceptance']

// /agent-team:at-init 明令不许建键的：at-pm（不参与路径认领）加上按设计不认领路径的那几个。
export const FORBIDDEN_KEYS = ['at-pm', ...NO_PATHS_ROLES]

// 花名册里、但门禁永远不会拿 paths 去判的：主线程（gate.mjs 在进 H3 之前就豁免了它）与测试替身。
const UNREAD_KEYS = ['__main__', 'at-outsider']

// 前缀按本平台的分隔符切段，丢掉空段与 '.' 段。
function segmentsOf(prefix, platform) {
  return prefix.split(platform === 'win32' ? /[\\/]/ : /\//).filter((s) => s !== '' && s !== '.')
}

// 照 H3 的拼法（项目根 + '/' + 前缀，见 writepath.mjs 的 underAny）在一个虚拟根上纯字面地解析，看它落在哪：
// 出了根、就是根本身、还是根里面。不碰文件系统。
function landing(prefix, platform) {
  const p = platform === 'win32' ? path.win32 : path.posix
  const root = platform === 'win32' ? path.win32.resolve('C:/v/r') : '/v/r'
  const rel = p.relative(root, p.resolve(`${root}/${prefix}`))
  if (rel === '') return 'root'
  if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return 'outside'
  return 'inside'
}

/** 一条前缀的问题。label 是这条前缀所在的位置（已经过 quote 的说法，比如 paths["at-backend"]）。 */
export function prefixProblems(prefix, { platform = process.platform, label = '前缀' } = {}) {
  const out = { block: [], fix: [], confirm: [] }
  const at = `${label} 的前缀 ${quote(prefix)}`
  if (prefix.includes(':')) {
    out.block.push(`${at} 带冒号——冒号只可能是盘符或流后缀，门禁认不出它指向哪`)
  } else {
    const where = landing(prefix, platform)
    if (where === 'outside') out.block.push(`${at} 出了项目根——前缀要留在项目里`)
    if (where === 'root') {
      out.block.push(`${at} 认领了整个项目根——.claude/、CLAUDE.md、.git 都会对这个角色敞开；写成具体的目录`)
    }
  }
  const segs = segmentsOf(prefix, platform)
  if (segs.length > 0 && segs[0].toLowerCase() === '.agent-team') {
    out.fix.push(`${at} 落在 .agent-team 下——那里的控制文件不走角色认领`)
  }
  if (prefix.includes('\\')) out.fix.push(`${at} 含反斜杠——前缀一律用 /（macOS / Linux 上反斜杠是文件名的一部分）`)
  if (/[*?]/.test(prefix)) out.fix.push(`${at} 含 * 或 ?——前缀按字面比较，不是通配符`)
  if (prefix !== prefix.trim()) out.fix.push(`${at} 首尾有空白——按字面比较，认领的是另一个名字`)
  if (prefix.split(/[\\/]/).some((s) => s !== '.' && s !== '..' && /[. ]$/.test(s))) {
    out.fix.push(`${at} 有以点或空格结尾的段——Windows 上门禁一律拒写这种写法`)
  }
  if (/^[\\/]/.test(prefix) && !/^[\\/]{2}/.test(prefix)) {
    out.confirm.push(`${at} 以 / 开头——门禁把它当作相对项目根的路径，写成相对的更清楚`)
  }
  return out
}

/** 一个角色条目（paths[role] 的值）的问题。 */
export function entryProblems(role, value, { platform = process.platform, label = `paths[${quote(role)}]` } = {}) {
  const out = { block: [], fix: [], confirm: [] }
  if (!Array.isArray(value)) {
    out.block.push(`${label} 不是数组（是 ${quote(value)}）`)
    return out
  }
  for (const el of value) {
    if (typeof el !== 'string') {
      out.block.push(`${label} 的元素 ${quote(el)} 不是字符串`)
      continue
    }
    merge(out, prefixProblems(el, { platform, label }))
  }
  return out
}

/** 条目里 H3 真正拿来比对的那些前缀：字符串，而且没有阻断问题。认领者查找只看它们。 */
export function usablePrefixes(value, { platform = process.platform } = {}) {
  if (!Array.isArray(value)) return []
  return value.filter((el) => typeof el === 'string' && prefixProblems(el, { platform }).block.length === 0)
}

/** 整份 project.json 的问题。roster 是 roster.json 的内容；读坏了（不是有效的花名册）就不核对角色名。 */
export function validateProject(project, { roster, platform = process.platform } = {}) {
  const out = { block: [], fix: [], confirm: [] }
  if (!isPlainObject(project)) {
    out.block.push('project.json 的内容不是一个 JSON 对象')
    return out
  }
  const rosterOk = isValidRoster(roster)
  if (!rosterOk) {
    out.confirm.push('roster.json 读不出来（插件安装可能不完整），project.json 里的角色名没法核对——这不是 project.json 的问题')
  }
  const known = (name) => rosterOk && Object.hasOwn(roster, name)

  const paths = project.paths
  if (!isPlainObject(paths)) {
    const what = paths === undefined ? '缺失' : `不是对象（是 ${quote(paths)}）`
    out.block.push(`paths ${what}——写路径隔离没有判据，执行角色写 run 目录外会被拒`)
  } else {
    for (const [key, value] of Object.entries(paths)) {
      const label = `paths[${quote(key)}]`
      if (rosterOk && !known(key)) {
        out.fix.push(`${label}：${quote(key)} 不是花名册里的角色名——拼错了？带了 agent-team: 前缀？门禁不会拿它判任何人`)
      } else if (key === 'at-pm') {
        out.fix.push(`${label}：不要给 at-pm 建键——PM 不参与路径认领，这个键不起作用`)
      } else if (NO_PATHS_ROLES.includes(key)) {
        out.fix.push(`${label}：不要给 ${key} 建键——它按设计不认领路径；建了键它就只能写这些前缀，与它的正文不符`)
      } else if (UNREAD_KEYS.includes(key)) {
        out.confirm.push(`${label}：门禁不会拿这个键去判 ${key}`)
      }
      merge(out, entryProblems(key, value, { platform, label }))
    }
    out.confirm.push(...nesting(paths, platform))
  }

  const roles = project.available_roles
  if (!Array.isArray(roles)) {
    const what = roles === undefined ? '缺失' : `不是数组（是 ${quote(roles)}）`
    out.fix.push(`available_roles ${what}——它是「这个项目用得上哪些执行角色」，收尾与产者交代都读它`)
  } else {
    for (const r of roles) {
      if (typeof r !== 'string' || (rosterOk && !known(r))) {
        out.fix.push(`available_roles 里的 ${quote(r)} 不是花名册里的角色名`)
      } else if (r === 'at-pm' || UNREAD_KEYS.includes(r)) {
        out.fix.push(`available_roles 里不要写 ${quote(r)}——它不是执行角色`)
      } else if (isPlainObject(paths) && !NO_PATHS_ROLES.includes(r) && !Object.hasOwn(paths, r)) {
        out.confirm.push(
          `available_roles 里有 ${quote(r)}，paths 里却没有它的键——它写 run 目录之外的任何地方都会被拒。` +
            '它确实只写 run 目录的话，写成 [] 表明这是有意的；否则给它划前缀',
        )
      }
    }
  }
  return out
}

// 不同角色之间，一条前缀按段严格包含另一条：外层角色也能写进内层（认领按「列了谁、谁能写」，不按最具体的
// 前缀归属）。相同前缀（共享目录）与同一角色内部的嵌套不提。段一律按不分大小写比，多提一条无害。
function nesting(paths, platform) {
  const entries = Object.entries(paths).map(([role, value]) => [
    role,
    usablePrefixes(value, { platform }).map((p) => ({ p, segs: segmentsOf(p, platform).map((s) => s.toLowerCase()) })),
  ])
  const out = []
  for (const [a, pa] of entries) {
    for (const [b, pb] of entries) {
      if (a === b) continue
      for (const x of pa) {
        for (const y of pb) {
          if (x.segs.length < y.segs.length && x.segs.every((s, i) => s === y.segs[i])) {
            out.push(
              `paths[${quote(a)}] 的 ${quote(x.p)} 包含 paths[${quote(b)}] 的 ${quote(y.p)}——` +
                `${quote(a)} 也能写进这一块；认领按「列了谁、谁能写」，不按最具体的前缀归属`,
            )
          }
        }
      }
    }
  }
  return out
}

function merge(into, from) {
  into.block.push(...from.block)
  into.fix.push(...from.fix)
  into.confirm.push(...from.confirm)
}
