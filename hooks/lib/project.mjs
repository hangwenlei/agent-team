// .agent-team/project.json 的形状（M3u，docs/29，全量审查第 10 条）。
//
// 此前 project.json 只要是个合法对象，H3 就照单全收：paths 缺失、键名拼错、带插件前缀、被删掉——调用者在
// paths 里「没有键」——一律静默放行；前缀 '../' 认领到项目根之外，'' 与 '.' 认领整个项目根。这里把问题分三档，另有一档 plugin：
//   - block（阻断）：H3 据此拒持有这个条目的角色——只算 H3 会拿这个键去判的（建了键的 at-qa、at-acceptance 也算）；
//     at-pm、__main__ 与认不出的键上的同类问题 H3 不拿来判人，降成要改。paths 本身缺失或不是对象时拒 at-qa、
//     at-acceptance 以外的执行角色；
//   - fix（要改）：/agent-team:at-init 明令禁止、或者按字面比较一定落空的写法；
//   - confirm（请确认）：可能是有意的，PM 读一遍，是想要的就不动；
//   - plugin（插件）：roster.json 读不出来。它不是 project.json 的问题，改 project.json 修不好，ledger 把它单列成
//     【插件】，不混进【project.json】那句「整份重写、改到没有为止」。
// 纯函数，不碰文件系统。外部值（键、前缀、available_roles 的元素）一律过 quote（docs/27）。
import path from 'node:path'
import { quote } from './trusted.mjs'
import { isPlainObject } from './stages.mjs'
import { isValidRoster } from './decide.mjs'

// 按设计不认领路径的角色：它们只写 run 目录里自己那份产物，没有键时 H3 在 run 目录之外拒它们（M4f，docs/41，审查第 34 条；
// 此前整段放行）。与 templates/project.json 的 available_roles 减去 paths 的键逐一对账（tests/project.test.mjs）；
// /agent-team:at-init 明令不给它们建键——建了键，H3 就照键放行它们写那几个前缀，等于在 run 目录之外给它们开了口子。
export const NO_PATHS_ROLES = ['at-qa', 'at-acceptance']

// 花名册里、但不是执行角色的：驱动者 PM、主线程（callerOf 对它的判定值）、测试替身。available_roles 里不该有它们。
const NOT_EXECUTION = ['at-pm', '__main__', 'at-outsider']

// 落在这些地方，Claude Code 会自动加载或执行里面的东西（设置、hook、指令、MCP 配置）：认领它们等于把这些交给
// 这个角色。门禁层面对所有角色拒写它们归审查第 34 条（docs/24），这里只提醒。按不分大小写比，多提一条无害。
// 文件只认项目根下启动即加载的那几个：子目录里的 CLAUDE.md 是任何目录前缀都带着的风险（在认领的目录里新建一个
// 就是），只对写明文件名的那一条报反而是任意的——M4r 起由 H3 拒（writepath.mjs 的 guardedBelow：认领的目录不连带它下面的
// CLAUDE.md、CLAUDE.local.md、.claude、.git、.agent-team），前缀写明了的照放行，这里照旧只对写明的提醒。
const AUTOLOADED_DIRS = ['.claude', '.git']
const AUTOLOADED_FILES = ['claude.md', 'claude.local.md', '.mcp.json']

// 照 H3 的拼法（项目根 + '/' + 前缀，见 writepath.mjs 的 underAny）在一个虚拟根上纯字面地解析，给出相对根的
// 落点：'..' 折叠掉，'.' 与空段丢掉。不碰文件系统。落点、嵌套、「落在哪个目录下」都按它判——H3 放行的范围按
// 解析后的位置算，按字面拼写比会让 'src/server/..' 这类字面上窄、实际宽的前缀漏报，嵌套的方向还会说反。
function resolvedRel(prefix, platform) {
  const p = platform === 'win32' ? path.win32 : path.posix
  const root = platform === 'win32' ? path.win32.resolve('C:/v/r') : '/v/r'
  return { p, rel: p.relative(root, p.resolve(`${root}/${prefix}`)) }
}

// 解析后的落点按本平台的分隔符切段。
function segmentsOf(prefix, platform) {
  const { rel } = resolvedRel(prefix, platform)
  return rel.split(platform === 'win32' ? /[\\/]/ : /\//).filter((s) => s !== '' && s !== '.')
}

// 落在哪：出了根、就是根本身、还是根里面。
function landing(prefix, platform) {
  const { p, rel } = resolvedRel(prefix, platform)
  if (rel === '') return 'root'
  if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return 'outside'
  return 'inside'
}

/**
 * 一条前缀的问题。label 是这条前缀所在的位置（已经过 quote 的说法，比如 paths["at-backend"]）。
 * audience：读这些话的是谁。'pm'（缺省）给出改法；'role' 是 H3 第 8 步拼进给执行角色的拒绝理由——执行角色改不了
 * project.json、也见不到用户，阻断只说问题本身，出路由调用方的「冒泡给上级」给。
 */
export function prefixProblems(prefix, { platform = process.platform, label = '前缀', audience = 'pm' } = {}) {
  const out = { block: [], fix: [], confirm: [] }
  const at = `${label} 的前缀 ${quote(prefix)}`
  const forPm = (s) => (audience === 'pm' ? s : '')
  if (prefix.includes(':')) {
    // 不分平台一律阻断：同一份 project.json 在各平台上意思要一样。理由只说 Windows——POSIX 上冒号是普通文件名字符。
    out.block.push(
      `${at} 带冒号` +
        forPm(
          '——Windows 上冒号只能是盘符或流后缀，门禁认不出它指向哪；为了同一份 project.json 在各平台上意思一样，' +
            '所有平台上都不接受带冒号的前缀，换一个不带冒号的名字',
        ),
    )
  } else {
    const where = landing(prefix, platform)
    // 改法要说全：只说「前缀要留在项目里」时，实测 PM 会把 '../shared/' 换成项目里并不存在的 'shared/'——多半是
    // 另一个地方，这个角色凭空多认领了一个目录。理由不说「这个角色写不到项目外」：PM 写得到（M4f 之前没有键的 at-qa、
    // at-acceptance 也写得到，docs/41），这句还会随降档出现在 at-pm 的键上；说的是门禁不会按这条前缀放行任何写入（第 8 步整条作废、认领者
    // 查找跳过它、H3 不拿不判人的键判人），这对每一种持有者都成立。
    if (where === 'outside') {
      out.block.push(
        `${at} 出了项目根` +
          forPm(
            '——删掉这一条：门禁不会按这条前缀放行任何写入；不要换成项目里的同名目录（多半是另一个地方），' +
              '收尾时告诉用户删了哪一条',
          ),
      )
    }
    if (where === 'root') {
      out.block.push(
        `${at} 认领了整个项目根` +
          forPm(
            '——.claude/、CLAUDE.md、.git 都会对这个角色敞开；改成具体的目录或文件：前缀也可以是单个文件' +
              '（比如 main.py），平铺在项目根的文件逐个列出',
          ),
      )
    }
  }
  const segs = segmentsOf(prefix, platform).map((s) => s.toLowerCase())
  if (segs[0] === '.agent-team') {
    out.fix.push(`${at} 落在 .agent-team 下——那里的控制文件不走角色认领`)
  } else if (segs.includes('.agent-team')) {
    out.fix.push(`${at} 落在一个嵌套的 .agent-team 下——门禁不把它划给任何角色，按这条前缀写进去的照样被拒`)
  }
  if (AUTOLOADED_DIRS.includes(segs[0]) || (segs.length === 1 && AUTOLOADED_FILES.includes(segs[0]))) {
    out.confirm.push(
      `${at} 落在 Claude Code 会自动加载或执行的地方（.claude/、.git/、项目根下的 CLAUDE.md、CLAUDE.local.md、` +
        '.mcp.json）——认领它等于把设置、hook、指令交给这个角色；确实要这样再留着',
    )
  }
  if (prefix.includes('\\')) out.fix.push(`${at} 含反斜杠——前缀一律用 /（macOS / Linux 上反斜杠是文件名的一部分）`)
  if (/[*?]/.test(prefix)) out.fix.push(`${at} 含 * 或 ?——前缀按字面比较，不是通配符`)
  // 先剥掉格式字符再看首尾空白：U+FEFF 既算空白（trim 剥它）又是格式字符，不剥的话同一个看不见的字符报两条，
  // 「首尾有空白」还会让人去找一个并不存在的空格。
  const bare = prefix.replace(/\p{Cf}/gu, '')
  if (bare !== bare.trim()) out.fix.push(`${at} 首尾有空白——按字面比较，认领的是另一个名字`)
  // 零宽空格之类的格式字符 trim 剥不掉，肉眼也看不出来；quote 现在也写成码点（docs/59），这里另报一条，说清它按字面比较、认领的是另一个名字。
  const invisible = [...new Set(prefix.match(/\p{Cf}/gu) ?? [])]
  if (invisible.length) {
    const cps = invisible.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join('、')
    out.fix.push(`${at} 含不可见的格式字符（${cps}）——按字面比较，认领的是另一个名字`)
  }
  if (prefix.split(/[\\/]/).some((s) => s !== '.' && s !== '..' && /[. ]$/.test(s))) {
    out.fix.push(`${at} 有以点或空格结尾的段——Windows 上门禁一律拒写这种写法`)
  }
  if (/^[\\/]/.test(prefix) && !/^[\\/]{2}/.test(prefix)) {
    out.confirm.push(`${at} 以 / 开头——门禁把它当作相对项目根的路径，写成相对的更清楚`)
  }
  return out
}

/** 一个角色条目（paths[role] 的值）的问题。audience 见 prefixProblems。 */
export function entryProblems(
  role,
  value,
  { platform = process.platform, label = `paths[${quote(role)}]`, audience = 'pm' } = {},
) {
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
    merge(out, prefixProblems(el, { platform, label, audience }))
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
  const out = { block: [], fix: [], confirm: [], plugin: [] }
  if (!isPlainObject(project)) {
    out.block.push('project.json 的内容不是一个 JSON 对象')
    return out
  }
  const rosterOk = isValidRoster(roster)
  if (!rosterOk) {
    // H1 拒一切派发、H3 拒 PM 以外的角色写 run 目录之外：不可能是有意的。改
    // project.json 修不好它，单列一档（ledger 的【插件】），这一条自己说清出路（/agent-team:at-init 第 3 节照此写）。
    out.plugin.push(
      'roster.json 读不出来（插件安装不完整）——这不是 project.json 的问题，改它修不好：派发一律被拒，' +
        '除 PM 外写 run 目录之外也一律被拒。停下，告诉用户重装或更新 agent-team 插件',
    )
  }
  const known = (name) => rosterOk && Object.hasOwn(roster, name)

  const paths = project.paths
  if (!isPlainObject(paths)) {
    const what = paths === undefined ? '缺失' : `不是对象（是 ${quote(paths)}）`
    // H3 的第 2 步排在这之前：没有键的 at-qa、at-acceptance 在那一步就被拒（M4f），不是例外（commands/at.md §0 同一口径）。
    out.block.push(`paths ${what}——写路径隔离没有判据，执行角色写 run 目录外会被拒`)
  } else {
    // H3 真会拿来判人、而且整条没作废的键：嵌套提醒只在它们之间比（「X 也能写进这一块」对别的键是假话）。
    const judged = new Set()
    for (const [key, value] of Object.entries(paths)) {
      const label = `paths[${quote(key)}]`
      // inert：H3 不拿这个键判任何人——PM 在第 1 步放行、主线程在进 H3 之前就被 gate.mjs 豁免、认不出的键对不上
      // 任何调用者。它上面的阻断问题不让谁被拒，降成要改：阻断档的标题说「这些角色……会被拒」，写 state.json 时
      // 还只报这一档，挂在这种键上就是每次记账都重报一遍的假话。at-outsider 不在此列：H3 照常按它的键判它（挡住
      // 它的是工具面只有 Read，tests/tool-surface.test.mjs 钉着）。
      // 花名册读坏时判不出哪些键是真角色（拼错的键也在内）：除 at-pm、__main__ 外一律不降档，阻断照报——那些前缀
      // 重装前后都该改掉；嵌套提醒不出（见下），它对拼错的键是假话，重装后重跑 /agent-team:at-init 会补上。
      let inert = true
      if (rosterOk && !known(key)) {
        out.fix.push(`${label}：${quote(key)} 不是花名册里的角色名——拼错了？带了 agent-team: 前缀？门禁不会拿它判任何人`)
      } else if (key === 'at-pm') {
        out.fix.push(`${label}：不要给 at-pm 建键——PM 不参与路径认领，这个键不起作用`)
      } else if (key === '__main__') {
        out.confirm.push(`${label}：门禁在进 H3 之前就豁免了主线程，不会拿这个键去判它`)
      } else {
        inert = false
        if (NO_PATHS_ROLES.includes(key)) {
          out.fix.push(`${label}：不要给 ${key} 建键——它按设计不认领路径；建了键它就只能写这些前缀，与它的正文不符`)
        } else if (key === 'at-outsider') {
          out.fix.push(`${label}：不要给 at-outsider 建键——它是测试替身，不是执行角色`)
        }
      }
      const p = entryProblems(key, value, { platform, label })
      if (inert) {
        out.fix.push(...p.block, ...p.fix)
        out.confirm.push(...p.confirm)
      } else {
        merge(out, p)
        if (!p.block.length) judged.add(key)
      }
    }
    if (rosterOk) out.confirm.push(...nesting(Object.entries(paths).filter(([k]) => judged.has(k)), platform))
  }

  const roles = project.available_roles
  if (!Array.isArray(roles)) {
    const what = roles === undefined ? '缺失' : `不是数组（是 ${quote(roles)}）`
    out.fix.push(`available_roles ${what}——它是「这个项目用得上哪些执行角色」，收尾与产者交代都读它`)
  } else {
    for (const r of roles) {
      if (typeof r !== 'string' || (rosterOk && !known(r))) {
        out.fix.push(`available_roles 里的 ${quote(r)} 不是花名册里的角色名`)
      } else if (NOT_EXECUTION.includes(r)) {
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
// 前缀归属）。相同前缀（共享目录）与同一角色内部的嵌套不提。段按 H3 解析后的落点切（'..' 先折叠），一律按不分
// 大小写比（Windows / macOS 上门禁的 norm 折叠大小写；Linux 上多提一条无害）。只比调用方给的条目：H3 不判人的键
// 不参与（对它们说「也能写进这一块」是假话）；整条有阻断（已经作废）的条目两个方向都不参与——作外层时那句是
// 假话，作内层时那句虽真，但这个条目要先改掉阻断、整份重写 project.json，重写之后会再报，先不加噪声。
function nesting(pathEntries, platform) {
  const entries = pathEntries.map(([role, value]) => [
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
