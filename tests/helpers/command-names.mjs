// `commands/` 下每条命令的名字（去掉 `.md`）—— 单一真源。
//
// 为什么需要它（Ruling 15，M2b Task 4 补轮）：
//
// `/\bat-[a-z][a-z0-9-]*\b/` 这个形状**同时匹配得到命令名**——`at-init`、`at-resume`、
// `at-status`、`at`。命令名与角色名是**两个命名空间，恰好形状相同**，而花名册只收角色。
// 所以凡是拿这个形状去对 `roster.json` 查的判据，都必须先把命令名排除掉，否则一句
// 合法的「跑 `/agent-team:at-init`」会被判成「提到了一个不在花名册里的角色」。
//
// `tests/commands.test.mjs` 的「命令正文里出现的每个 at-* 角色名都在花名册里」早在
// M2a Task 9 就撞上并解决过这件事（那里从自己的 `FILES` 派生了一个排除集）；
// **而 `tests/agents.test.mjs` 的「角色正文里出现的每个 at-* 角色名都在花名册里」用着
// 逐字相同的正则，却没有任何排除**。两边不是分叉——是**一边压根不知道另一边解决过这个
// 问题**。代价是具体的：角色正文因此写不了 `/agent-team:at-init`，只能绕成「写
// `.agent-team/project.json` 的那条勘察命令」这种描述特征的说法，而那是给 agent 读的
// 作业指令，**指名道姓比描述特征可操作得多**（`docs/11` §5.15）。
//
// 抽成一份、两个测试文件都 import，手法与本仓库做过的同一族完全一致：
// `hooks/lib/path-norm.mjs`（两份逐字相同的 `norm()` 真的分叉过）、
// `hooks/lib/control-files.mjs`、`tests/helpers/agent-tools.mjs`（M1b 终审 C2：两份行
// 扫描只改了一份，规格 §6.1 的唯一机械防线被一次合法的 YAML 改写整体架空）、
// `tests/helpers/expected-agents.mjs`。结论每次都一样：多处需要同一份知识时只留一份。
//
// ⚠️ **从目录读出来，不硬编码那几个名字**。硬编码的话，将来加一条命令时这份清单会停在
// 旧值，而「停在旧值」在这里的表现是**静默放宽**：新命令的名字不在排除集里，任何引用它
// 的正文都会被判成引用了一个不存在的角色——或者反过来，清单里留着一个已删命令的名字，
// 那个名字就再也不会被当成角色名检查。两个方向都不会有任何提示。
// `commands/` 目录是这件事唯一的事实来源（`tests/commands.test.mjs` 的「四条命令都在，
// 没有多余的」钉着它与那份 `FILES` 清单一致）。
import { readdirSync } from 'node:fs'

export const COMMAND_NAMES = new Set(
  readdirSync(new URL('../../commands/', import.meta.url))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, '')),
)
