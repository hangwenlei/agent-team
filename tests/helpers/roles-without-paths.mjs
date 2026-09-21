// 「故意不认领 `project.paths` 的角色」—— 单一真源，从 `templates/project.json` 派生。
//
// `available_roles` 减去 `paths` 的键，就是这一组（今天是 `at-qa` / `at-acceptance`，
// 由 `tests/templates.test.mjs` 的「多出来的正是不认领路径的那两个」钉着）。
// **不硬编码名字**：硬编码停在旧值时的表现是静默的——清单少一个，那个角色就再也不会
// 被下面两条不变量检查；清单多一个，检查会对着一个不存在的义务报红。
//
// ## 为什么必须是**同一份**派生，而不是两处各算一次（M2b Task 4 修复轮 1）
//
// 这一组角色身上挂着**两条互为因果的不变量**，此前它们**各有各的真源，可以静默分叉**：
//
//   1. `tests/commands.test.mjs` ·「`commands/at-init.md` 必须逐个点名禁止给这些角色建
//      `paths` 键」（裁定「paths 禁令要有守卫」）——**禁令**那一侧。
//   2. `tests/agents.test.mjs` ·「这些角色的正文必须写明 `paths` 里没有它的条目 →
//      写路径隔离对它早退放行」（本轮补）——**依据**那一侧。
//
// 第 1 条的失败文案里白纸黑字写着它存在的理由是「会让 `agents/` 下那份正文里『写路径
// 隔离连拒都不会拒你』当场变假」——**可是此前没有任何东西强制那份正文保留那句话**。
// 评审实测：把 `agents/at-qa.md` 与 `agents/at-acceptance.md` 里那一段整段删掉，
// 裸 `node --test` 仍然 558 / 0，**零红**。也就是说两边可以走到这一步：
// **禁令留着，它的依据消失。**
//
// （为什么零红：`at-qa` 靠与别人共享的那段红线**碰巧**还能过 `管不到` 那条判据；
// `at-acceptance` 不在 `HAS_BASH` 里，那三条红线判据一条都不作用于它。）
//
// 两条不变量现在由**同一个数组**驱动：一边动，另一边必然跟着动。这与
// `tests/helpers/command-names.mjs`、`tests/helpers/expected-agents.mjs`、
// `tests/helpers/agent-tools.mjs`、`hooks/lib/path-norm.mjs` 是同一手法——本仓库为
// 「同一份知识写两份真的会分叉」开过好几轮循环，这一次分叉的两半甚至**互相引用过对方**
// 而仍然分叉了。
//
// ⚠️ 这一组不含 `at-pm`：它连 `available_roles` 都不在（`tests/templates.test.mjs` 钉着），
// 而禁令那一侧确实也要点它的名。`at-pm` 那个字面量加在**消费方**
// （`tests/commands.test.mjs`），不加在这里——这里只回答「模板里谁没有 `paths` 条目」。
import { readFileSync } from 'node:fs'

const project = JSON.parse(
  readFileSync(new URL('../../templates/project.json', import.meta.url), 'utf8'),
)

export const ROLES_WITHOUT_PATHS = project.available_roles.filter(
  (r) => !Object.hasOwn(project.paths, r),
)

// ⭐ M3h：**另一侧**——模板里真的认领了 `paths` 的那些角色。
//
// 为什么挂在这个文件里，而不是在消费方自己 `JSON.parse` 一次 `templates/project.json`：
// 两侧是同一份数据的补集，**必须同一次读出来**。分开读的失效形状本文件上半段已经
// 记过一次（禁令与依据各有真源、静默分叉）；补集这一侧再开一个真源，就是同一个形状
// 第三次。消费方是 `tests/agents.test.mjs` 里「认领了 `paths` 的角色，正文必须写着
// 『只有那些』」那条——H3 写路径隔离在**角色正文侧**的第一道（`docs/11` §5.31）。
//
// ⚠️ 这里取的是 `paths` 的**键本身**，不是 `available_roles` 与它的交集。
// 两者今天相等，但它们答的不是同一个问题：这条不变量问的是「谁被划了地盘」，
// 而一个被划了地盘却不在 `available_roles` 里的角色，**照样受 H3 按那份前缀管**
// ——用交集会把它悄悄漏掉。
export const ROLES_WITH_PATHS = Object.keys(project.paths)
