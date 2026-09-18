// 派生自 stages.json 形状的小工具（纯函数）。
//
// 目前只有一个概念：**所有阶段 produces 的并集**——用来判断"这个名字是不是某个阶段的
// 产物"，不关心具体是哪个阶段。这个并集此前在 hooks/lib/state.mjs 的 validateState
// （校验 state.json 的 artifacts 的键）与 hooks/lib/artifact-drift.mjs 的
// compareArtifacts（账本比对要遍历的名字集合）各写了一份逐字等价的拷贝，两处都是
// M1c 本轮新增（评审发现 4）。
//
// 今天两份拷贝逐字等价、没有现存 bug——但这正是 hooks/lib/path-norm.mjs 头部记的那个
// 形状：分叉的代价静默且不对称，若哪天只改了一份（比如"产物名允许带路径分隔符"这类
// 收紧/放宽），另一份不会有任何提示地继续用旧口径，两个"produces 并集"就会答出不同的
// 答案。本轮复评已经当场抓到过同族复演一次（修复轮 3 (a)：同一条正则写了两份，只放宽
// 主判据那一份就全绿）——抽成单一真源，与本仓库已经做过的同类抽法
// （hooks/lib/path-norm.mjs、hooks/lib/control-files.mjs、tests/helpers/agent-tools.mjs、
// tests/helpers/expected-agents.mjs）同一手法：多处需要同一份知识时，只留一份，其余
// 全部 import。
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** stages 里所有阶段 produces 的并集，忽略形状不对的阶段条目。stages 本身形状不对
 * （不是对象）时返回空集合——调用方各自决定"没有可判定的产物集合"该怎么处理，这里
 * 不表态、也不抛。 */
export function producedNames(stages) {
  const out = new Set()
  if (!isPlainObject(stages)) return out
  for (const s of Object.values(stages)) {
    if (isPlainObject(s) && Array.isArray(s.produces)) {
      for (const p of s.produces) out.add(p)
    }
  }
  return out
}
