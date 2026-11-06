// 并行微调：认领文件。纯函数，I/O 由 gate.mjs 注入。
//
// 几趟微调在同一个目录里并行，靠「先写先得」不互相覆盖：每一趟微调派出去的子代理第一次写一个项目文件（项目根之下、.agent-team/ 之外）时，
// 落盘之后账本把它记进这一趟自己的 runs/<id>/claims.jsonl（门禁专属）；别的、还没收尾的微调的子代理再写它，H3 拒，叫它冒泡。收尾、放弃之后
// 那一趟的认领自然不算（判的时候只读没收尾的微调的那一份）。认领记录每一趟一份：每个会话的门禁只写自己那一趟的，避开跨会话同写一份文件的丢更新。
//
// 认领键是 norm() 之后的绝对路径（解析 .、..、链接，Windows、macOS 上折小写）：同一个文件换一种写法认得出来。两边在同一刻第一次写同一个文件的
// 竞态不挡（登记为边界）；Bash 写的文件不记（门禁不加 Bash 的 matcher）。
import { isPlainObject } from './stages.mjs'
import { quote, inline } from './trusted.mjs'

/** 认领记录的一行。key：认领键；path：相对项目根的显示路径；role：写它的角色。 */
export function claimLine({ at, key, path, role }) {
  return JSON.stringify({ kind: 'claim', at, key, path, role })
}

/** claims.jsonl 的原文 → 认领键的集合。坏行、形状不对的行跳过（Bash 写得进这个文件）。 */
export function readClaims(text) {
  const keys = new Set()
  if (typeof text !== 'string') return keys
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let v
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (isPlainObject(v) && v.kind === 'claim' && typeof v.key === 'string' && v.key !== '') keys.add(v.key)
  }
  return keys
}

/**
 * 别的没收尾的微调里有没有认领这个键。others：[{ id, keys: Set, startedAt, wordsHead }]。
 * @returns {null | { id: string, startedAt: string|null, wordsHead: string|null }}
 */
export function claimBlock({ key, others = [] }) {
  if (typeof key !== 'string' || !Array.isArray(others)) return null
  const hit = others.find((o) => isPlainObject(o) && o.keys instanceof Set && o.keys.has(key))
  return hit ? { id: hit.id, startedAt: hit.startedAt ?? null, wordsHead: hit.wordsHead ?? null } : null
}

/** H3 的拒绝理由。path 是由项目根拼出的显示路径（inline）；run id、时间、原话开头是磁盘上的值（quote）。 */
export function claimDenyReason({ path, other }) {
  const facts = [
    typeof other?.startedAt === 'string' && other.startedAt !== '' ? `${quote(other.startedAt)} 起` : null,
    typeof other?.wordsHead === 'string' && other.wordsHead !== '' ? `原话开头 ${quote(other.wordsHead)}` : null,
  ].filter(Boolean)
  return (
    `agent-team 认领：另一个微调 ${quote(other?.id)}${facts.length ? `（${facts.join('，')}）` : ''}正在改 ${inline(path)}——等那边收尾再改。` +
    '不要换路径或改用 Bash 绕开：以「冒泡：」停下，把这一句原样回报项目经理。'
  )
}
