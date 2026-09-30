// hooks/boot.mjs 的 MIN_NODE——门禁代码需要的最低 Node——是唯一真源（M3t，docs/28）。README 两半、
// agents/at-pm.md 的排查清单、CI 的最低版本作业都拿它比对。boot.mjs 是进程入口、一被 import 就会跑，
// 所以从源码文本里抠：行首锚定，恰好一处，形状 x.y.z。
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../hooks/boot.mjs', import.meta.url), 'utf8')
const HITS = [...SRC.matchAll(/^const MIN_NODE = '(\d+)\.(\d+)\.(\d+)'\r?$/gm)]
if (HITS.length !== 1) {
  throw new Error(`hooks/boot.mjs 里 \`const MIN_NODE = 'x.y.z'\` 应当恰好一行，实际 ${HITS.length} 行`)
}

export const MIN_PARTS = HITS[0].slice(1, 4).map(Number)
export const MIN_NODE = MIN_PARTS.join('.')
export const MIN_MAJOR_MINOR = `${MIN_PARTS[0]}.${MIN_PARTS[1]}`

// 紧挨着 v 的前一个版本（边界用例）：最后一个非零段减一，后面各段补成 99。
export function versionBefore(v) {
  const p = v.split('.').map(Number)
  for (let i = 2; i >= 0; i--) {
    if (p[i] > 0) {
      p[i] -= 1
      for (let j = i + 1; j < 3; j++) p[j] = 99
      return p.join('.')
    }
  }
  throw new Error(`${v} 没有前一个版本`)
}
