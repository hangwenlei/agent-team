# stage_roles 记成空数组时的报法

> 2026-10-11，分支 `r39-stage-roles-empty`。第三十九轮（从开放边界索引挑）：`docs/48` §4「`stage_roles` 里一段的值是 `[]`（记了账、一个都没叫）时，
> `/agent-team:at-status` 与 `/agent-team:at-resume` 怎么报那一段，正文没写」。

## 0. 一句话结论

- 门禁对 `[]` 与还没有这一段的键同一个口径：`participantsOf` 给空、`isStageDone` 答「没齐」、不并派发记录（`docs/77`）。两条命令照同一个口径说：
  `/agent-team:at-resume` 把记成 `[]` 的段算进「还没记账」、照磁盘核，不按「全部都在磁盘上」跳过；`/agent-team:at-status` 先看 `trimmed`——这一段的产者都在
  `trimmed` 里、值是这一段的标「整段裁掉」，否则标「记了账、一个产者都没叫」，两种都不报成「这一段没有产物该在」，也不报 ✗。

## 1. 问题

- 按段展开产物（`expandProduces(stage, stageRolesInRun(stage, participantsOf(state, stage)))`）对 `[]` 给空集。at-status 原来只对「有 `stage_roles` 却还没有这一段的键」
  说「本段未记账」，记成 `[]` 的段落进「展开不为空的照常报」那一句之外——照字面它没有一份产物该在，报成什么正文没写。
- at-resume 原来把空集写成「这一段还没记账（`stage_roles` 里还没有这一段）」，记成 `[]` 的段读起来不是这一种；照「全部都在磁盘上」对空集是真命题判，会把整段跳过。

## 2. 修法

- `commands/at-resume.md`：「展开出来是空集」那一条，括号里加「或者这一段记的是 `[]`」。
- `commands/at-status.md`：「本段未记账」那一段后面加一段——记成 `[]` 时先看 `trimmed`，分「整段裁掉」与「记了账、一个产者都没叫」，还停在这一段的多半是先记了个空、
  照「本段未记账」那样按磁盘报；两种都不报成「这一段没有产物该在」、不报 ✗。

## 3. 判据与变异

- `tests/stage-roles-empty-prose.test.mjs`：at-resume 那一句带上 `[]`；at-status 有那一段、里面有 `trimmed`、两种标法与「不报 ✗」，排在「本段未记账」之后、S5 实现记录那一段之前。
- 变异（备份在仓库外，每一刀改完逐字节还原）：at-resume 不提 `[]`、at-status 不说不报 ✗、at-status 不分 `trimmed`——每一刀都有判据红。

## 4. 仍然开着的边界

- **at-status、at-resume 是正文**：判据只核写没写，模型照不照着报没有判据去跑（`docs/42` §4 那一条）。
- **「整段裁掉」照 `trimmed` 认**：门禁的整段裁掉还要这一段一个都没叫过（派发记录里也没有，`advance.mjs` 的 `wholeStageTrimmed`）；at-status 读不读派发记录正文没写，
  派过又裁掉的会被它也标成「整段裁掉」。

## 5. 没量到的

- 真实会话里 `stage_roles` 记成 `[]` 之后跑 at-status、at-resume 的报法。

## 6. 归属

- `commands/at-status.md`、`commands/at-resume.md`；判据在 `tests/stage-roles-empty-prose.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/48` §4「`stage_roles` 里一段的值是 `[]`」：写了收口。
- `docs/00-开放边界.md`：`docs/48` §4 那一行改了，这一份的 §4、§5 登上。
