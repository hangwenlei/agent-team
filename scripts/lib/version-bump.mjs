// 发布纪律的判定核心（M3p，docs/24 §2.3）。纯函数，不读 git、不读文件——CLI 外壳
// scripts/check-version-bump.mjs 负责把两个提交的 version 与改动清单喂进来。
//
// 纪律原文在 HANDOFF.md「长期决策」：每次推 main 都挪 version——碰插件会加载的东西挪中间
// 一位，只碰散文/docs/tests 挪最后一位，任何一位不长到 10。理由：`claude plugin update`
// 比的是 version 字符串，不是 commit；不挪，用户就拿不到这次改动。

// 「插件会加载的东西」的单一真源。以 / 结尾的是目录前缀，其余是仓库根下的文件。
// 出处是 docs/19 §9.3 的纪律正文（「插件真正会加载的任何东西」，含 .claude-plugin/ 下两份
// 清单），外加它漏掉的 stages.README.md——/agent-team:at-resume 与 at-status 的正文要模型在
// 运行时读它的一节，改它就改了这两条命令的行为（M3p 复核）。
// .claude-plugin/plugin.json 每次发布都会改 version，只改 version 的那一次由
// withoutVersionOnlyManifest 从清单里拿掉，不算在这里。
export const PLUGIN_LOADED = [
  'agents/',
  'commands/',
  'hooks/',
  'skills/',
  'templates/',
  'settings.json',
  'stages.json',
  'roster.json',
  'stages.README.md',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
]

const MANIFEST = '.claude-plugin/plugin.json'

function isPluginLoaded(path) {
  return PLUGIN_LOADED.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p))
}

function parse(v) {
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) return null
  return v.split('.').map(Number)
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/**
 * plugin.json 在两个提交之间只改了 version 时，把它从改动清单里拿掉。任何一侧读不出来就
 * 留着——宁可多要求挪一位，不要漏认。
 * @param {string[]} changed
 * @param {object|null} before 事件之前的 plugin.json（解析后）
 * @param {object|null} after 事件之后的 plugin.json（解析后）
 */
export function withoutVersionOnlyManifest(changed, before, after) {
  if (!changed.includes(MANIFEST)) return changed
  const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
  if (!isObj(before) || !isObj(after)) return changed
  // 不排序键：键的顺序变了也算改动——偏严，不漏认。
  const strip = ({ version, ...rest }) => JSON.stringify(rest)
  return strip(before) === strip(after) ? changed.filter((p) => p !== MANIFEST) : changed
}

/**
 * @param {{ before: string|null, after: string, changed: string[] }} args
 *   before：事件之前那个提交的 version（那时还没有 plugin.json 则为 null）；
 *   after：事件之后的 version；changed：两个提交之间改动过的路径（仓库相对、正斜杠）。
 * @returns {{ ok: boolean, reason: string }}
 */
export function judgeVersionBump({ before, after, changed }) {
  const a = parse(after)
  if (!a) {
    return { ok: false, reason: `version ${JSON.stringify(after)} 不是三段纯数字（x.y.z）。` }
  }
  if (a.some((n) => n >= 10)) {
    return { ok: false, reason: `version ${after} 有一位长到了 10 以上；该进位时进到上一位。` }
  }
  const b = parse(before)
  // 往回挪一律不行，不看改动清单：回滚式 force push 把 main 退回祖先时，三点 diff 的
  // merge-base 就是 head，清单是空的，而用户手里的 version 却比仓库里的新。
  if (b && cmp(a, b) < 0) {
    return { ok: false, reason: `version 往回挪了（${before} → ${after}）。` }
  }
  if (!Array.isArray(changed) || changed.length === 0) {
    return { ok: true, reason: '两个提交之间没有改动，不要求挪版本号。' }
  }
  if (before === null || before === undefined) {
    return { ok: true, reason: `事件之前还没有 version，本次记为 ${after}。` }
  }
  if (!b) {
    return { ok: true, reason: `事件之前的 version ${JSON.stringify(before)} 读不成 x.y.z，只校验了 ${after} 的形状。` }
  }
  if (cmp(a, b) === 0) {
    return {
      ok: false,
      reason: `version 没有往前挪（${before} → ${after}）。推 main 就是发布，而 claude plugin update 比的是 version 字符串。`,
    }
  }
  const loaded = changed.filter(isPluginLoaded)
  const middleMoved = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
  if (loaded.length > 0 && !middleMoved) {
    return {
      ok: false,
      reason:
        `改了插件会加载的东西，要挪中间一位（${before} → ${after} 只挪了最后一位）。` +
        `这些路径是插件会加载的：${loaded.join('、')}`,
    }
  }
  return { ok: true, reason: `${before} → ${after}` }
}
