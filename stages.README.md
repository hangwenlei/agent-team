# stages.json 注记

`stages.json` 是阶段链的唯一真源：每个阶段的执行角色（`role`）、允许的产出角色
（`producers`，可选）、需要的前置产物（`requires`）、必须产出的文件（`produces`）。
它同时喂下面这些门禁，路径都在 `hooks/lib/` 下（M2b 终审 B6：这里原先写的是「**两道**」
而紧跟的表是三行——与本文件下面自己立的「列举，不报总数」正面冲突，非本轮造成，一并改）：

| 读它的人 | 问的问题 | 实现 |
|---|---|---|
| H2 就绪门禁 | 这个角色**接下来要做哪一段**，它的前置产物齐了吗 | `readiness.mjs` |
| H3 写路径隔离 | run 目录下这条路径是**哪个阶段的产物、归谁** | `writepath.mjs` |
| H5a/H5b 交付物校验 | `state.stage` 这一段的执行角色交付了吗 | `deliverable.mjs` |

JSON 写不了注释，所以下面这条**扩链之前必读**的结论放在这里。

## `producers` 与 `<role>`（M2a 补，M2b 改）

`role` 字段的语义是「这一阶段的主执行者」。**没有 `producers` 的阶段只写它就够**。

> ⚠️ **这一句上一版写的是「单产者阶段（S1–S4、S6–S8）只写它就够」，M2b 终审改掉
> （2026-09-20）。** M2b 把 S2 改成了 `producers: ["at-product","at-ui"]` + 对象形式的
> `produces`，那句话的三层意思对 S2 **全假**：S2 不是单产者、`producers` 不缺省、
> 「只写 `role` 就够」不成立。**改成按条件说（「没有 `producers` 的阶段」），不再枚举
> 阶段号**——枚举会在下一次扩链或改形状时再假一次，而条件不会。
>
> 这一节此前**从头到尾没有一个字提到 `produces` 的对象形式**——那是 M2b 唯一的机制
> 改动，而这份文件自称是「扩链之前必读」。主规格 §4 补了两种形式的对照表、
> `expandProduces` 的 docstring 也写了，只有这份专职说明书没跟。下面补上。

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

### `produces` 的两种形式（M2b 补）

多产者阶段有两种形状，`produces` 跟着有两种形式：

| 形式 | 写法 | 用在 |
|---|---|---|
| 数组 | `["05-impl/<role>.md"]` | 所有产者交**同一个模式**的东西 |
| 对象 | `{"at-product": ["01-prd.md"], "at-ui": [...]}` | 各交各的，产物名互不相同 |

S5 是第一种（一个模式配 N 个角色），S2 是第二种（`at-product` 交 `01-prd.md`，
`at-ui` 交 `02-ui-spec.md` 与 `02-wireframe.html`）。完整对照与理由见主规格 §4 阶段表
下方「注记（M2b 补）」那一条。

⚠️ **两种形式的展开都收在 `hooks/lib/stages.mjs` 的 `expandProduces` 一处**——它是全部
消费方的单一真源，**不要在任何调用点另写分支**，也不要在正文里复述展开规则（那会是
第二份）。要知道「某一阶段这一趟该有哪些产物」，走 `expandProduces(stage,
stageRolesInRun(stage, roster))`；要知道「某个名字是不是任何一个合法产者的产物」，走
`producedNames`。两者答的是不同的问题，见 `stages.mjs` 头部。

**`<role>` 的展开按消费方不同而不同**，完整表格与理由见主规格 §4 阶段表下方
「注记（M2a 补）」那一条——这里不重复抄一遍，防的正是 `docs/11` §1.5 第 2 点点名的
那种漂移（同一份清单在两处各抄一份，改一处另一处不会有任何提示地继续用旧口径）。
摘要，逐个消费方各自的集合：

| 消费方 | `<role>` 展开成 |
|---|---|
| H3 写路径（`writepath.mjs` 的 `stageOwnerOfRunPath`） | 写入者自己 |
| `ledger` 的 `produce` 回传 | 写入者自己——与上一行共用同一个 `stageOwnerOfRunPath` |
| `isStageDone`（推进判据） | `roster ∩ producers` |
| 账本比对 `compareArtifacts` 的 `drifted` / `missing` | `roster ∩ producers` |
| 账本比对 `compareArtifacts` 的 `unrecorded` | 全部 `producers` |
| `validateState` 的 artifacts 键校验 | 全部 `producers` |
| `/at-resume` 的「产物齐没齐」核盘（`commands/at-resume.md`） | `roster ∩ producers` |
| `/at-status` 的产物那一栏（`commands/at-status.md`） | `roster ∩ producers` |

⚠️ **`compareArtifacts` 占两行不是笔误，M3a Task 3 之后它内部就是两个口径。**
`drifted`/`missing` 问的是「**这一趟**该有的对不对得上」，`roster` 是对的口径；
`unrecorded` 问的是「**磁盘上有谁没交代的东西**」，那个问题从来就不该被 `roster` 闸住
——理由与那条边界的完整论证在 `hooks/lib/artifact-drift.mjs` 的 M3a 注释块里，
这里不抄第二份。**上一版这张表给 `compareArtifacts` 写的是单独一行 `roster ∩ producers`**，
改口径之后那一行就成了对一半。

⚠️ **上一版这句引导语写的是「五个消费方」，而表当时已经是七行。** 非本轮造成，一并改掉：
本文件自己立的规矩就是「列举，不报总数」（见本文件下面 S5 那一节末尾），
而报出来的那个总数会在下一次给表加行的时候静默变假——这一次正是被加行撞出来的。

⚠️ **`/at-resume` 与 `/at-status` 那两行是 M2b 终审 B5 补的**（原文写的是「最后两行」
——那是靠位置定位，加一行就会指错人，一并改成点名）。那两条命令是正文层**唯一被要求自己展开 `produces`**
的地方，此前既不在这张表里、也没有指向 `expandProduces`——**它们没有任何口径**。
两份正文当时写的是「把 `produces` 逐个去磁盘上 `Glob` 一遍」，而有些阶段的
`produces` 不是字面文件名的扁平数组（S2 是对象形式，S5 是含 `<role>` 的模式）。
照字面执行，S5 会去 `Glob` 字符串 `05-impl/<role>.md`，永远查不到 → `/at-resume` 判
「产物不齐」→ **重跑一段已经做完的 S5**。两份正文现在都指向 `expandProduces`。

单一真源是 `hooks/lib/stages.mjs`（`stageRoles`/`expandProduces`/`stageRolesInRun`/
`expectedArtifacts`/`producedNames`）。混用两个集合会重演 `docs/11` §5.6 那个缺口
（M1 期间 `produces` 被写成字面量，前端干完活写不进自己的实现记录）。

**H2（`readiness.mjs`）与 H5（`deliverable.mjs`）不在上表**：这两道闸问的是「`role`
这一个角色」的问题（H2 问它接下来要做哪一段、H5 问它交付了没有），不是「`<role>`
展开成哪些人」的问题，`role` 字段本身不变。但 H5 内部判定「交付了没有」时要拿
**这一次被判的那个 `role`** 去展开 `stage.produces`——
`decideDeliverable` 直接用字面量 `stage.produces`（`["05-impl/<role>.md"]`）去比
`artifactExists` 会永远比不出来，等于让 H5b 永久拦截 `at-backend` 完成 S5、H5a
永久报「产物缺失」，不管磁盘上是否真的写出了 `05-impl/at-backend.md`。这是
Task 4 落地 `<role>` 模式时随手发现、brief 与设计文档都没提到的一处必须一起改的
地方（`decideDeliverable` 现在用 `expandProduces(stage, [role])` 而不是
`stage.produces` 本身），完整论证见 `hooks/lib/deliverable.mjs` 头部注释与
`tests/deliverable.test.mjs`。

⚠️ **这一段上一版有两句是假的，M2b Task 4 改掉（2026-09-20）。** 原文写着 H5 拿到的
`role`「此刻已经等于 `stage.role`，前一步刚判过相等」，以及「**这不是给「谁被 H5 判」
这件事扩大范围**——其它 producers（`at-frontend`/`at-ui`/`at-ios`/`at-android`）返回时
**仍然落进** `skipped: 'role-not-in-stage'`，H5 的判定范围仍然只有 `role` 那一个角色」。

**两句自 M2a Task 9 起都不成立**：Task 9 把 `decideDeliverable` 的归属判据从
`stage.role !== role`（单数）改成了 `!stageRoles(stage).includes(role)`（含 `producers`），
**走到展开那一步的 `role` 从此是 `producers` 里的任意一个**。真实行为是：`S5` 的五个
producer **各自返回时各自被判一次**，每次只展开自己那一份 `05-impl/<自己>.md`。
「一次调用只判一个角色」是真的，「只判 `role` 字段那一个角色」是假的——上一版把前者
写成了后者。真正走 `skipped: 'role-not-in-stage'` 的是**不在 `producers` 里**的角色
（`at-architect` 在 `S5` 是派发发起者、不是产者），`tests/deliverable.test.mjs` 里
「S5 多产者：不在 producers 里的角色仍然是 role-not-in-stage」那条钉着这一侧。

`hooks/lib/deliverable.mjs` 的头部注释里有**逐字同族的一份，而且它活在那段注释自己做的
更正下面**（注释开头就更正过「走到这里的 `role` 必然等于 `stage.role`」，随后又写
「那些人走的是上面的 `role-not-in-stage` 分支」），已一并改掉：**更正只作用到了它逐字
点名的那一句上，同一个说法在同一段注释里活过了自己的更正。**

## H5 按 `state.stage` 判定（M1b 改，原先的坑已填）

`decideReadiness` 与 `decideDeliverable` 曾经共用同一条迭代规则——「取该角色第一个
`produces` 未齐的阶段」。那条规则对 H2 问的问题（「它接下来要做哪一段」）是对的，对
H5 问的问题（「它刚做完的那一段交付了吗」）是错的：多阶段角色做完前一段之后，H5 会拿
**下一段**的缺失产物把**这一段**顶回去，最多九次（U5 实测的平台重试上限），然后平台
静默放行——一次纯噪音的拦截，还会把 H5b 唯一的重试预算消耗光。

现在 `decideDeliverable` 由调用方传 `stageId`（`gate.mjs` 传 `ctx.state.stage`），
不再自己猜。**所以一个角色可以放心写进多个阶段**（规格 §4 的完整链就把 `at-architect`
同时写进 S3 与 S5）。上一版这里写的是「所以**扩链到 S6–S8 时**可以放心……」——那是一条
预言，而 M2 已经把链接上了，它不再是预言。同文件「H5a 的静默集合」那一节的同族预言
M2b Task 3 已经改成陈述（「**已经重算过了**……不再是一条预言」），这一句当时漏了，
Task 4 修复轮 1 补（裁定「豁免不覆盖被证伪的预测」：叙述性注释豁免的是「记录当时的事实」，不是「预测未来」）。

代价是 H5 现在依赖 `state.stage` 是准的。它停在旧阶段时 H5 会对新阶段的角色**哑掉**，
而哑掉和「通过了」长得一模一样。两条对策：`gate.mjs` 的 H5a 在
`skipped === 'role-not-in-stage'` 时发 warning；`ledger` 在当前阶段产物齐了时提示推进
阶段。**改 `state.stage` 的写入路径时，先确认这两条还在。**

同一条结论也写在 `hooks/lib/deliverable.mjs` 的头部注释里（改代码的人从那边进来，改
阶段链的人从这边进来）。

## H5a 的「静默集合」（M2b Task 3 第三次重算；前两次：M1b 终审提出、M2a Task 6 第一次实做）

`gate.mjs` 的 H5a 在 `skipped === 'role-not-in-stage'` 时，会先排掉「返回的是一个合法的
层级协调者，**且当前阶段确实还没做完**」再发 warning——否则它会在 S5 正路上必然误报（`/at`
的 S5 是「派 `at-architect` 去分发」，而 `S5.role` 是 `at-backend`），而最省事的消警告方式
（把 `state.stage` 改回旧阶段）恰好制造它警告的那个失效。

被静默的**充要条件**曾经只有一半（M1b 终审记的版本）：**返回的角色能（传递地）派发到
`stages[state.stage].role`。** 这条在 M1 里是完整的——S5 是 M1 的最后一段，「`state.stage`
停在旧阶段」这个失效形状在 M1 里根本走不到，所以静默集合非空但覆盖不到任何真实的失效。
**接上 S6–S8 之后这条近似不再充分**：实际在 S6、而 `state.stage` 还停在 S5 时，任何能传递
派到 `at-backend` 的协调者返回都会被静默——那正是「停在旧阶段」的标准形状，也正是这条告警
存在的理由。M2a Task 6 补上了缺的那一半（`docs/11` §1.1 点名、§5.8 结清）：

被静默的**充要条件现在是两条同时成立**：

1. 返回的角色能（传递地）派发到 `stages[state.stage].role`（`isCoordinatorFor`，判据不变）；
2. **且** `stages[state.stage]` 这一段的产物尚未全部齐备（`isStageDone`，M2a 新增的一半）。

只满足第 1 条、不满足第 2 条时，改判成**报**——协调者身份没变，但产物已经齐了、
`state.stage` 却没有随之推进，这正是「停在旧阶段」。逐段核过，覆盖到 S1–S8：

| `state.stage` | 该段 `role` | 谁派得到它 | 第 1 条会成立吗 | 会被静默吗 |
|---|---|---|---|---|
| S1 | `at-pm` | 没有角色派得到 `at-pm`（`tests/roster-closure.test.mjs` 钉着） | 不会 | 不会——不看第 2 条，第 1 条已经否了 |
| S2 | `at-product` | `__main__`、`at-pm` | 实际上不会——返回的角色不会是它们 | 不会 |
| S3 | `at-architect` | `__main__`、`at-pm` | 实际上不会——返回的角色不会是它们 | 不会 |
| S4 | `at-pm` | 没有角色派得到 `at-pm` | 不会 | 不会——同 S1 |
| S5 | `at-backend` | `__main__`、`at-pm`、`at-architect` | **会**——靠的是 `at-architect`；`at-pm`/`__main__` 虽然也派得到，但返回的角色不会是它们 | **看第 2 条**：这一趟派的执行角色都交了 → 报（停在旧阶段）；没交齐 → 静默（合法协调） |
| S6 | `at-qa` | `__main__`、`at-pm` | 实际上不会——返回的角色不会是它们 | 不会 |
| S7 | `at-acceptance` | `__main__`、`at-pm` | 实际上不会——返回的角色不会是它们 | 不会 |
| S8 | `at-pm` | 没有角色派得到 `at-pm` | 不会 | 不会——同 S1 |

「谁派得到它」这一列是拿 `computeReach` 对**改完之后**的真实 `roster.json` 逐阶段跑出来的，
不是手推的，也不是照着上一版改的（上一版的 S5 行本身就是错的，见本节末尾）。

**S5 是当前花名册下唯一一段第 1 条会成立的阶段**，所以 M2a 补的第 2 条也只在这一段真正
改变行为——`state.stage` 停在 S6/S7/S8 时，第 1 条已经否了，第 2 条不影响结论（`isStageDone`
仍然会算，只是短路：`false || 不管什么` 恒为 `true`，一样报）。**这不是巧合，是当前花名册的
拓扑决定的**——但 M2b Task 3 之后，拓扑决定它的方式有**两种**，不再只有一种：

- **第一类：真的没有任何人派得到。** 只有 `at-pm` 属于这一类（`tests/roster-closure.test.mjs`
  钉着），S1 / S4 / S8 三段靠它。
- **第二类：只有 `at-pm`/`__main__` 派得到，而返回的角色不会是它们**——没有任何角色派得到
  `at-pm`，`__main__` 则根本不是一个能被派出去的 agent（它是「没被 `settings.json` 的 `agent`
  键钉住的主会话」这一种身份，见 `docs/05-M0-结论.md`）。S2 / S3 / S6 / S7 四段靠它。

**S6 / S7 在 M2b Task 3 里从第一类换到了第二类。** 上一版这张表给 S6/S7 写的理由是「没有
角色派得到 `at-qa`（当前花名册）」；本任务给花名册加上 `at-pm`/`__main__` → `at-qa` 与
`at-acceptance` 两条边之后，那句话不再成立。**结论（不会被静默）没变，理由变了**——只把
结论抄过来、不改理由，就是把一句已经失效的话继续留着。上一版表底下那句「花名册变了（比如
哪天有角色能派到 `at-qa`）这张表要跟着重算」预言的正是本任务：**已经重算过了**，上面这张表
记的是重算之后的结果，不再是一条预言。判据本身（上面两条充要条件）不用改。

**S5 行还掉了一个角色：`at-product`。** M2b Task 3 按规格 §4 把 `at-product` 的
`can_delegate_to` 从 `["at-backend"]` 改成 `["at-ui"]`（S2 是「at-product → at-ui」，S5 的
分发是 `at-architect` 的事），于是 `at-product` 不再传递派得到 `at-backend`，也就不再落在 S5
的协调者一侧。`hooks/gate.mjs` 的 `isCoordinatorFor` 上方与 `tests/gate-deliverable.test.mjs`
里那两段「被静默的不止 `at-architect`」的说明都是讲这条边的，已随本次改动一并更新。

**顺带修掉的一处事实错误**：上一版 S5 行写的是「`at-architect`、`at-product`（两个都会，
不止 `at-architect`）」，漏了 `at-pm`/`__main__`——它们经 `at-pm → at-architect → at-backend`
同样传递派得到，而 S2/S3 两行本来就老老实实列了它们，只有 S5 这一行漏了；括号里那个「两个」
还明确报了一个没人核过的总数。**列举，不报总数：清单可以用 `computeReach` 核，数字不能。**

⚠️ **这张表算的是判据第 1 条的口径：`stages[stageId].role`，单数。** M2b Task 3 实测过另一种
口径（「派得到该段任意一个 `producer`」）：两者在当前拓扑下**不等价**，S2 与 S5 两段的协调者
集合都会变。**裁定「保留 `.role` 单数」，代码不动**——判据问的是「这次返回的角色有没有可能
就是跑这一段的那个人」，而 `at-product → at-ui` 这条边是为 S2 存在的、不是 S5 的实现分发，
拓扑分不清一条边是为哪一段存在的。逐阶段 diff、五条理由与失效条件（**某一段的真协调者派不到
那一段的 `role` 时这条判据才失效**，今天八段都不满足）记在
`docs/11-M1b-遗留与已知边界.md` §5.12。

`isStageDone` 在这里的调用**新增**在 `hooks/gate.mjs` 的 `CHECK === 'deliverable'` 分支，
与 `CHECK === 'ledger'` 分支里那处（阶段推进提示用）是两个独立调用点，互不共享——两处都要
在，改一处不代表另一处也改了。**传参的写法**三处一致（这里、`compareArtifacts`、
`readiness`）：`ctx.state?.roster` 不是数组时传 `undefined`，宁可多报不要漏报。

⚠️ **但「传进去之后退回全部 `producers`」只对 `isStageDone` 与 `readiness` 说得通。**
上一版这句写的是「`roster` 参数的口径与 `compareArtifacts`/`readiness` 一致：……
（退回全部 `producers`）」——M3a Task 3 之后它只剩一半真：`compareArtifacts` 内部已经是
两个口径，`drifted`/`missing` 吃这个参数，**`unrecorded` 根本不看它**（见上面那张消费方表）。
传 `undefined` 还是传一份真 `roster`，对 `unrecorded` 一个字的差别都没有。
**三处的写法一致，不等于三处拿它干同一件事。**

**账本比对不受这张静默表约束**（`docs/11` §5.8 结清的裁定）：`buildDriftNotice` 的三个清单
（`drifted`/`missing`/`unrecorded`）只要非空就照发，跟这次返回是不是合法协调、当前阶段有没有
`done` 都无关——它审的是「产物内容对不对得上账」，是独立于「阶段有没有推进」的另一个问题，
两者故意分开判定，即使同一次 `emitLedger` 调用会把两条都发出来。

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

## H6 返工预算写时强制（M1b 记为缺口，M2a Task 5 已实现）

`hooks/lib/state.mjs` 的 `validateState` 会校验 `rework` 等于 `history` 的派生量
（某阶段出现 n 次 → n-1 次返工），所以**把计数改小会被 `ledger` 报出来**——但那只是
**事后告警**（`kind === 'ledger'`、`failClosed:false`），不是拦截：拦住一次「把计数
改小」的写入要看到改之前的那一版，`PostToolUse` 看不到。

**写时强制现在由 H6 承担**（`hooks/lib/rework-guard.mjs` 的 `decideRework` +
`hooks/gate.mjs` 的 `CHECK === 'rework'` 分支）：挂在 `PreToolUse` 的
`^(Edit|Write|NotebookEdit)$` matcher 上，触发时磁盘上还是旧版、`tool_input` 里是
新版，两边都在手上，能在写入落盘前把「history 整体变短」「某阶段计数变少」
「`rework` 低于 `history` 派生值」「`rework` 超过硬上限 3」这四类写入拦下来，
`failClosed: true`。只对 `runs/*/state.json` 生效，不豁免任何调用者（含 PM 自己）。

两道校验都要在，不是新的取代旧的：H6 挡的是「这一次写入本身」；`validateState` 兜的
是 H6 覆盖不到的路径（比如没有经过 Edit/Write 而是被别的手段写坏的 `state.json`）。
完整设计与判据逐条理由见 `hooks/lib/rework-guard.mjs` 头部——不在这里重复第二遍，
这份文件已经记着「重复会分叉」的教训（见本文件其它小节）。
