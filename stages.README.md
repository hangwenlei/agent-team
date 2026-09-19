# stages.json 注记

`stages.json` 是阶段链的唯一真源：每个阶段的执行角色（`role`）、允许的产出角色
（`producers`，可选）、需要的前置产物（`requires`）、必须产出的文件（`produces`）。
它同时喂两道门禁，路径都在 `hooks/lib/` 下：

| 读它的人 | 问的问题 | 实现 |
|---|---|---|
| H2 就绪门禁 | 这个角色**接下来要做哪一段**，它的前置产物齐了吗 | `readiness.mjs` |
| H3 写路径隔离 | run 目录下这条路径是**哪个阶段的产物、归谁** | `writepath.mjs` |
| H5a/H5b 交付物校验 | `state.stage` 这一段的执行角色交付了吗 | `deliverable.mjs` |

JSON 写不了注释，所以下面这条**扩链之前必读**的结论放在这里。

## `producers` 与 `<role>`（M2a 补）

`role` 字段的语义是「这一阶段的主执行者」，单产者阶段（S1–S4、S6–S8）只写它就够。
S5（实现）不一样：`at-backend`/`at-frontend`/`at-ui`/`at-ios`/`at-android` 都要各自
在 S5 产出自己的实现记录，`produces` 因此写成一个**模式**——`["05-impl/<role>.md"]`
——而不是五个字面量。`stages.json` 用 `producers` 字段列出这一阶段允许的产出角色：

```json
"S5": {
  "role": "at-backend",
  "producers": ["at-backend", "at-frontend", "at-ui", "at-ios", "at-android"],
  "requires": ["03-arch.md", "04-dispatch.md"],
  "produces": ["05-impl/<role>.md"]
}
```

**`<role>` 的展开按消费方不同而不同**，完整表格与理由见主规格 §4 阶段表下方
「注记（M2a 补）」那一条——这里不重复抄一遍，防的正是 `docs/11` §1.5 第 2 点点名的
那种漂移（同一份清单在两处各抄一份，改一处另一处不会有任何提示地继续用旧口径）。
摘要，五个消费方各自的集合：

| 消费方 | `<role>` 展开成 |
|---|---|
| H3 写路径（`writepath.mjs` 的 `stageOwnerOfRunPath`） | 写入者自己 |
| `ledger` 的 `produce` 回传 | 写入者自己——与上一行共用同一个 `stageOwnerOfRunPath` |
| `isStageDone`（推进判据） | `roster ∩ producers` |
| 账本比对 `compareArtifacts` | `roster ∩ producers` |
| `validateState` 的 artifacts 键校验 | 全部 `producers` |

单一真源是 `hooks/lib/stages.mjs`（`stageRoles`/`expandProduces`/`stageRolesInRun`/
`expectedArtifacts`/`producedNames`）。混用两个集合会重演 `docs/11` §5.6 那个缺口
（M1 期间 `produces` 被写成字面量，前端干完活写不进自己的实现记录）。

**H2（`readiness.mjs`）与 H5（`deliverable.mjs`）不在上表**：这两道闸问的是「`role`
这一个角色」的问题（H2 问它接下来要做哪一段、H5 问它交付了没有），不是「`<role>`
展开成哪些人」的问题，`role` 字段本身不变。但 H5 内部判定「交付了没有」时要拿
`role`（此刻已经等于 `stage.role`，前一步刚判过相等）去展开 `stage.produces`——
`decideDeliverable` 直接用字面量 `stage.produces`（`["05-impl/<role>.md"]`）去比
`artifactExists` 会永远比不出来，等于让 H5b 永久拦截 `at-backend` 完成 S5、H5a
永久报「产物缺失」，不管磁盘上是否真的写出了 `05-impl/at-backend.md`。这是
Task 4 落地 `<role>` 模式时随手发现、brief 与设计文档都没提到的一处必须一起改的
地方（`decideDeliverable` 现在用 `expandProduces(stage, [role])` 而不是
`stage.produces` 本身），完整论证见 `hooks/lib/deliverable.mjs` 头部注释与
`tests/deliverable.test.mjs`。**这不是给「谁被 H5 判」这件事扩大范围**——其它
producers（`at-frontend`/`at-ui`/`at-ios`/`at-android`）返回时仍然落进
`skipped: 'role-not-in-stage'`，H5 的判定范围仍然只有 `role` 那一个角色，改动
只是让「`role` 自己」这唯一被判的一支不再恒假。

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

## ⚠️ 扩到 S6–S8 时要回来重算 H5a 的「静默集合」（M1b 终审记）

`gate.mjs` 的 H5a 在 `skipped === 'role-not-in-stage'` 时，会先用花名册的传递闭包排掉
「返回的是一个合法的层级协调者」再发 warning——否则它会在 S5 正路上必然误报（`/at` 的 S5
是「派 `at-architect` 去分发」，而 `S5.role` 是 `at-backend`），而最省事的消警告方式
（把 `state.stage` 改回旧阶段）恰好制造它警告的那个失效。

被静默的**充要条件**是：**返回的角色能（传递地）派发到 `stages[state.stage].role`。**

在 M1 的链上这条是完整的，逐段核过：

| `state.stage` | 该段 `role` | 谁派得到它 | 会被静默吗 |
|---|---|---|---|
| S1 / S4 | `at-pm` | 没有角色派得到 `at-pm`（`tests/roster-closure.test.mjs` 钉着） | 不会 |
| S2 / S3 | `at-product` / `at-architect` | 只有 `at-pm` 与 `__main__` | 实际上不会——返回的角色不会是它们 |
| S5 | `at-backend` | `at-architect`、`at-product` | **会**（两个都会，不止 `at-architect`） |

而 S5 是 M1 的最后一段，所以「`state.stage` 停在旧阶段」这个失效形状在 M1 里**根本不存在**
——静默集合非空，但它覆盖不到任何真实的失效。

**M2 接上 S6–S8 之后缺一角**：实际在 S6、而 `state.stage` 还停在 S5 时，任何能传递派到
`at-backend` 的协调者返回都会被静默——**那正是「停在旧阶段」的标准形状**。扩链时按上面那条
充要条件把新的静默集合重算一遍，并确认每一段的「停在旧阶段」还有可听见的信号（H5a 之外
还有 `ledger` 的阶段推进提示，两条对策见上一节，缺一不可）。

## 另一条相关的缺口（M1b 已解决）

M1a 在 `hooks/lib/writepath.mjs` 里记过一条 I3：稳态下被 `settings.json` 钉成主线程的
`at-pm` 既写不了 `.agent-team/project.json`（取决于 `project.paths` 里有没有它这个键）
也写不了 `runs/<id>/state.json`（无条件，因为它不是任何阶段的 `produces`）——而
`§4.2 ③` 的返工计数、`/at-resume` 的续跑、`/at-init` 的重跑都要它写。

**M1b 已经解掉它**（`docs/09-M1b-入口决策.md` 账一 → 规格 §6.2.1），那段 I3 注释块也已
不在。解法是引入一个**概念**而不是一条例外：`.agent-team/` 下的文件分成两类，判据不同。

| | 是什么 | 谁能写 | 判据在哪 |
|---|---|---|---|
| **控制文件** | 编排层自己的账本：`current-run`、`project.json`、`reach.json`、`runs/<id>/state.json` | 只有 PM | `hooks/lib/control-files.mjs` 的 `CONTROL_FILES`（**单一真源**） |
| **阶段产物** | `stages[*].produces` 列出的文件 | 只有该阶段自己的角色 | 就是这个 `stages.json` |
| 其余 | run 目录下其它任何文件 | 一律 deny | —— |

（M2a 核实：`docs/11` §1.5 第 2 点说上面这一行「又抄了一遍四项控制文件清单」、
「没有任何东西保证它跟着 CONTROL_FILES 变」——这条记录写于 2026-09-17 更早的一次
提交，但同一天更晚的 `03cb951`（`test: stages.README.md 的控制文件表格补防抄回归`）
已经把这个缺口堵上了：`tests/stages-readme.test.mjs` 专门做「抽表格这一格 → 归一化
`<id>`/`*` → 与 `CONTROL_FILES` 集合相等」的对账，并配了独立自检锚证明抽取器没有
空转（`docs/11` §3.3 第 2 条那类「零迭代恒绿」）。`docs/11` §1–§4 是该文件自己规定
“原文一个字不改”的区块，这处漂移没有被追记进 §5，读起来仍像未解决——**这里当场
核实清楚：已解决，不是本任务的活。** 保留字面量清单是刻意的，删掉它会导致
`tests/stages-readme.test.mjs` 两条测试双双变红（已实测，见 task-4-report.md）；
要看控制文件具体是哪几个，去读 `hooks/lib/control-files.mjs`。）

两条边界都要在：控制文件那条解开了死锁；阶段产物那条保住了「H2 的判据对所有角色
（**含 PM**）不可伪造」——把整个 `.agent-team/` 放给 PM 会让它在 run 目录下凭空造出
`01-prd.md`，而 `artifactExists` 在 `runDir` 下解析、H2 拿它当前置产物的判据。

`hooks/lib/writepath.mjs` 里控制文件那一段**必须排在 run 目录块与 `project.paths`
块之前**：两头的既有判据对控制文件都是错的，而且方向相反（一个太紧、一个太松）。
改那个函数的判定顺序之前先读那里的注释。

## ⚠️ 返工预算的写时强制还没有做（M1b 记，属 M2）

`hooks/lib/state.mjs` 的 `validateState` 会校验 `rework` 等于 `history` 的派生量
（某阶段出现 n 次 → n-1 次返工），所以**把计数改小会被 `ledger` 报出来**。但那是
**事后告警**，不是拦截：拦住一次「把计数改小」的写入要看到改之前的那一版，
`PostToolUse` 看不到。

M1 的阶段链只到 S5，**没有任何返工边**（返工产生于 S6 失败回 S5 与 S7 驳回，
规格 §4.2 ③），所以这条缺口在 M1 里一次也走不到。扩到 S6–S8 时必须回来把它设计完：
那时才第一次有真实的返工计数，而「第 3 轮终局」是硬上限，靠告警守不住。
