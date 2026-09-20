// 「谁能（传递地）派发到某一段的 `role`」——拿**真实** roster.json + stages.json 算。
//
// 为什么抽出来（M2b 终审 A4）：
//
// `stages.README.md` 的「H5a 的静默集合」那张表有八行，`tests/gate-deliverable.test.mjs`
// 里的 `H5A_SILENCE_TABLE` 是它的第二份拷贝。`tableFailHint` 白纸黑字写着「那里是这张表
// 的单一真源，这组测试只是它的守卫」——**但它守的是测试文件里那份拷贝**（拿 computeReach
// 对），README 那张表可以单独漂走而零测试红。补守卫时需要同一个推导在两个测试文件里都
// 用得上，于是抽这一份；**不在第二个文件里把 computeReach 那三行再拼一遍**——那正是本
// 仓库已经为之开过多轮循环的形状（hooks/lib/path-norm.mjs 头部记着最早那一次）。
//
// 只读真实数据、不接受注入：这两张表钉的就是「**当前真实花名册**下的拓扑事实」，
// 参数化会把它变成一条对任意输入都成立的恒等式，什么都不钉。
import { readFileSync } from 'node:fs'
import { computeReach } from '../../hooks/lib/reach.mjs'

export const REAL_ROSTER = JSON.parse(
  readFileSync(new URL('../../roster.json', import.meta.url), 'utf8'),
)
export const REAL_STAGES = JSON.parse(
  readFileSync(new URL('../../stages.json', import.meta.url), 'utf8'),
)

// 判据只问拓扑可达性，paths 传 {}——与 hooks/gate.mjs 的 isCoordinatorFor 逐字一致。
// 返回顺序 = Object.keys(roster) 的顺序，两处 deepEqual 连顺序一起钉。
export function whoCanReach(stageId) {
  const reach = computeReach({ roster: REAL_ROSTER, paths: {} })
  const stageRole = REAL_STAGES[stageId]?.role
  return Object.keys(REAL_ROSTER).filter((k) =>
    (reach[k]?.reachableRoles ?? []).includes(stageRole),
  )
}
