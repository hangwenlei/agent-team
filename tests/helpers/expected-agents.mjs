// agents/ 目录下六个角色文件的完整文件名——单一真源。
//
// 修复轮 2（评审发现 1）：`tests/tool-surface.test.mjs` 与 `tests/agents.test.mjs` 都
// 需要「agents/ 目录下恰好是这六个文件」这条身份锚点，此前只有后者有（写成
// `deepEqual` 身份比对），前者的前置条件断言仍是 `AGENT_FILES.length > 0`——只证明
// 「扫到了至少一个文件」，证不了「扫到的就是这六个」。变异实测：把 `AGENT_FILES` 的
// 过滤条件改成只匹配 `pm.md`（模拟过滤条件写错、部分扫描），同时给
// `agents/at-backend.md` 授予 `Skill`/`SendMessage`/`ListAgents`——因为扫描结果只剩
// `at-pm.md` 一个文件，禁授工具那条否定断言只检查了这一个文件，`at-backend.md` 的
// 真实违规完全不在检查范围内，`node --test` 全绿。这正是 M1b 终审 C2 的同一个文件、
// 同一条测试、同一族失败（C2 是「块序列写法绕过解析」，这次是「扫描范围本身被缩小」），
// C2 之后补的是 `tests/helpers/agent-tools.mjs` 这个解析器，但补的是「怎么解析一条
// tools: 声明」，没有补「扫到的文件集合本身对不对」这一层——两次失败发生在不同的层，
// 但都是「没有身份锚点，只有非空/长度锚点」这同一个根因。
//
// 抽成单一真源、两个文件共用一份，而不是各自写一份字面量数组：本仓库为「同一份知识
// 写两份真的会分叉」开过好几轮循环（`hooks/lib/path-norm.mjs` 头部注释记着两份逐字
// 相同的 `norm()` 真的分叉过），这六个文件名就是这样一份知识——两个测试文件各写一份
// 硬编码数组，日后加/删角色时只改一份、另一份留着旧值，比对会悄悄失效。
export const EXPECTED_AGENTS = [
  'at-architect.md',
  'at-backend.md',
  'at-frontend.md',
  'at-outsider.md',
  'at-pm.md',
  'at-product.md',
]
