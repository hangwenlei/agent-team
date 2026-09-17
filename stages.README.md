# stages.json 注记

`stages.json` 是阶段链的唯一真源：每个阶段的执行角色（`role`）、需要的前置产物
（`requires`）、必须产出的文件（`produces`）。它同时喂两道门禁，路径都在
`hooks/lib/` 下：

| 读它的人 | 问的问题 | 实现 |
|---|---|---|
| H2 就绪门禁 | 这个角色**接下来要做哪一段**，它的前置产物齐了吗 | `readiness.mjs` |
| H3 写路径隔离 | run 目录下这条路径是**哪个阶段的产物、归谁** | `writepath.mjs` |
| H5a/H5b 交付物校验 | `state.stage` 这一段的执行角色交付了吗 | `deliverable.mjs` |

JSON 写不了注释，所以下面这条**扩链之前必读**的结论放在这里。

## H5 按 `state.stage` 判定（M1b 改，原先的坑已填）

`decideReadiness` 与 `decideDeliverable` 曾经共用同一条迭代规则——「取该角色第一个
`produces` 未齐的阶段」。那条规则对 H2 问的问题（「它接下来要做哪一段」）是对的，对
H5 问的问题（「它刚做完的那一段交付了吗」）是错的：多阶段角色做完前一段之后，H5 会拿
**下一段**的缺失产物把**这一段**顶回去，最多九次（U5 实测的平台重试上限），然后平台
静默放行——一次纯噪音的拦截，还会把 H5b 唯一的重试预算消耗光。

现在 `decideDeliverable` 由调用方传 `stageId`（`gate.mjs` 传 `ctx.state.stage`），
不再自己猜。**所以扩链到 S6–S8 时可以放心把一个角色写进多个阶段**（规格 §4 的完整链
就把 `at-architect` 同时写进 S3 与 S5）。

代价是 H5 现在依赖 `state.stage` 是准的。它停在旧阶段时 H5 会对新阶段的角色**哑掉**，
而哑掉和「通过了」长得一模一样。两条对策：`gate.mjs` 的 H5a 在
`skipped === 'role-not-in-stage'` 时发 warning；`ledger` 在当前阶段产物齐了时提示推进
阶段。**改 `state.stage` 的写入路径时，先确认这两条还在。**

同一条结论也写在 `hooks/lib/deliverable.mjs` 的头部注释里（改代码的人从那边进来，改
阶段链的人从这边进来）。

## 另一条相关的已知缺口

`hooks/lib/writepath.mjs` 里 run 目录那块旁边记了 I3：稳态下被钉成主线程的
`at-pm` 既写不了 `.agent-team/project.json`（取决于 `project.paths` 里有没有它这个
键）也写不了 `runs/<id>/state.json`（无条件，因为它不是任何阶段的 `produces`）。
计划 B 第一次往 `state.json` 写返工计数时会撞上，细节见那里。

## ⚠️ 返工预算的写时强制还没有做（M1b 记，属 M2）

`hooks/lib/state.mjs` 的 `validateState` 会校验 `rework` 等于 `history` 的派生量
（某阶段出现 n 次 → n-1 次返工），所以**把计数改小会被 `ledger` 报出来**。但那是
**事后告警**，不是拦截：拦住一次「把计数改小」的写入要看到改之前的那一版，
`PostToolUse` 看不到。

M1 的阶段链只到 S5，**没有任何返工边**（返工产生于 S6 失败回 S5 与 S7 驳回，
规格 §4.2 ③），所以这条缺口在 M1 里一次也走不到。扩到 S6–S8 时必须回来把它设计完：
那时才第一次有真实的返工计数，而「第 3 轮终局」是硬上限，靠告警守不住。
