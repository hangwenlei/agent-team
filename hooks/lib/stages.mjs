// 派生自 stages.json 形状的小工具（纯函数）。
//
// 目前只有一个概念：**所有阶段 produces 的并集**——用来判断"这个名字是不是某个阶段的
// 产物"，不关心具体是哪个阶段。这个并集此前在 hooks/lib/state.mjs 的 validateState
// （校验 state.json 的 artifacts 的键）与 hooks/lib/artifact-drift.mjs 的
// compareArtifacts（账本比对要遍历的名字集合）各写了一份，两处都是 M1c 本轮新增
// （评审发现 4）。
//
// 两份**语义等价但写法不同**：validateState 那份构造的是 Set，compareArtifacts 那份
// 构造的是 Array——不是逐字相同的拷贝（这句话本身曾经写错，终审修复轮的定向复评发现 5
// 指出后改掉，别再往回抄）。统一成这里的 Set 顺带改变了一处边缘行为：compareArtifacts
// 那一侧如果同一个产物名出现在两个不同阶段的 produces 里，原来的 Array 会让下面的
// for 循环把它处理两次（重复的产物名在 drifted/missing/unrecorded 里重复上榜），改用
// Set 之后只处理一次。这个差**无害且当前不可达**：去重只能合并重复行、不可能把非空
// 列表变成空列表，而真实 stages.json 五个阶段的 produces 互不相同，这条边缘情形今天
// 走不到（复评已核实）。
//
// 两处实现没有 bug，但分叉的代价静默且不对称——若哪天只改了一份（比如"产物名允许带
// 路径分隔符"这类收紧/放宽），另一份不会有任何提示地继续用旧口径，两个"produces 并集"
// 就会答出不同的答案。本轮复评已经当场抓到过同族分叉复演一次（修复轮 3 (a)：同一条
// 正则写了两份，只放宽主判据那一份就全绿）——抽成单一真源，与本仓库已经做过的同类
// 抽法（hooks/lib/path-norm.mjs、hooks/lib/control-files.mjs、
// tests/helpers/agent-tools.mjs、tests/helpers/expected-agents.mjs）同一手法：多处
// 需要同一份知识时，只留一份，其余全部 import。
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
