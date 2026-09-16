# stages.json 注记

`stages.json` 是阶段链的唯一真源：每个阶段的执行角色（`role`）、需要的前置产物
（`requires`）、必须产出的文件（`produces`）。它同时喂两道门禁，路径都在
`hooks/lib/` 下：

| 读它的人 | 问的问题 | 实现 |
|---|---|---|
| H2 就绪门禁 | 这个角色**接下来要做哪一段**，它的前置产物齐了吗 | `readiness.mjs` |
| H3 写路径隔离 | run 目录下这条路径是**哪个阶段的产物、归谁** | `writepath.mjs` |
| H5a/H5b 交付物校验 | 这个角色**刚做完的那一段**交付了吗 | `deliverable.mjs` |

JSON 写不了注释，所以下面这条**扩链之前必读**的结论放在这里。

## ⚠️ 扩到 S6–S8 之前必须先改 `deliverable.mjs`

`decideReadiness` 与 `decideDeliverable` 用的是同一条迭代规则：**取该角色第一个
`produces` 未齐的阶段**。这条规则对 H2 问的问题是对的，对 H5 问的问题是错的——
多阶段角色做完前一段之后，H5 会拿**下一段**的缺失产物把**这一段**顶回去。

今天不可达：当前 `stages.json` 里唯一的多阶段角色是 `at-pm`（S1 + S4），而
`roster.json` 里没有任何角色能派发它（`tests/roster-closure.test.mjs` 钉住这条），
它也不触发 `SubagentStop`，所以这条错误规则一次也走不到。

一旦扩链就是真实误拦：规格 §4 的完整阶段链把 `at-architect` 同时写进 S3 与 S5。
用一份这样的 stages 实测（`at-architect` 刚交完 S3，`03-arch.md` 已在磁盘上，
S5 的产物当然还没有）：

```
H5（"刚做完的 S3 交付了吗"）: { ok: false, stageId: 'S5', missing: ['05-impl/index.md'] }
H2（"接下来要做哪一段"）    : { decision: 'allow' }
```

H5b 会用 `exit 2` 把交完 S3 的 `at-architect` 反复顶回去要 S5 的产物，最多九次
（U5 实测的平台重试上限，见 `docs/07-U5-U6-U8-实测结论.md` §1），然后平台静默
放行。一次纯噪音的拦截，还会把 H5b 唯一的重试预算消耗光——真正该拦的下一次就
拦不住了。

**改法的方向**（属计划 B，不在 M1a 范围内）：让调用方把"刚结束的阶段 id"传进
`decideDeliverable`，不要让它自己猜。`readRunContext` 现在已经把 `state.stage`
读出来了，却没有任何调用方用它，那很可能就是这个入参。

同一条结论也写在 `hooks/lib/deliverable.mjs` 的头部注释里（改代码的人从那边进来，
改阶段链的人从这边进来）。

## 另一条相关的已知缺口

`hooks/lib/writepath.mjs` 里 run 目录那块旁边记了 I3：稳态下被钉成主线程的
`at-pm` 既写不了 `.agent-team/project.json`（取决于 `project.paths` 里有没有它这个
键）也写不了 `runs/<id>/state.json`（无条件，因为它不是任何阶段的 `produces`）。
计划 B 第一次往 `state.json` 写返工计数时会撞上，细节见那里。
