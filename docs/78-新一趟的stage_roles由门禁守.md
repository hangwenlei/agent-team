# 新一趟的 stage_roles 由门禁守

> 2026-10-11，分支 `r36-stage-roles-key`。第三十六轮（从开放边界索引挑）：`docs/32` §4「新 run 漏写 `stage_roles` 时静默退回整趟口径」，
> 也是 `docs/55` §4「漏写的照旧静默」。

## 0. 一句话结论

- 按段判的门禁（【阶段】、推进、产者交代、交付物核验……）认 `state.json` 有没有 `stage_roles` 这个键：没有就当更早落盘的 run，按整趟 `roster` 判。
  新 run 漏写它，门禁一声不吭地退回旧口径。现在 H6 在两个时刻拒：建 run 的那一次（写之前 `state.json` 读不到、这一趟的目录里还没有门禁在 `state.json`
  落盘之后才写的文件）`stage_roles` 不是对象；写入之前它是对象、这次写入不是了（去掉、改成 `null` 或数组）。没有这个键的旧 run 两条都碰不到（半路加上的
  除外，§4）。`/agent-team:at` 第 1 节写明，第 3 节补了「已经加上了的别再删」；`state.json` 读不出来时门禁给的修法也说了原文里没有它的旧 run 不要加。
  认值不只认键、认「建 run」的写法，是两轮复核之后定的（§8）。

## 1. 问题

- `validateState` 对 `stage_roles` 缺失不报——旧 run 本来就没有它，报了会叫旧 run 半路加上（`/agent-team:at` 第 3 节明令不要：之前走过、没补键的那几段会被当成
  没记账）。`docs/55` 只做了拼错的那一半（认不出的键点出 `stage_roles`）。
- 从 `state.json` 本身分不出新旧：拿 `closed_at`、`rework_base` 在不在认也不准——旧 run 在新插件下续跑，回退会写进 `rework_base`、收口会写进 `closed_at`。
- 门禁看得准新旧的是建 run 的那一次：写之前文件不在，这一次照的是现行模板（原话记录的绑定认的也是这一刻，`docs/50`、`docs/58`）。建出来之后，
  「写入之前有它」多半说明这是新的一趟（旧 run 半路违规加上的除外，§4）。

## 2. 修法

- `hooks/lib/rework-guard.mjs` 的 `decideStageRolesKey({ before, after, creating })`：新内容是对象、`stage_roles` 不是对象时——`creating` 为真拒
  （`STAGE_ROLES_CREATE`），写入之前的 `stage_roles` 是对象拒（`STAGE_ROLES_DROP`）；别的放行。写入之前的值本来就不是对象的不拦（消费方早已把它当旧 run，
  【state.json】叫改成对象）。
- `hooks/gate.mjs` 的 H6：排在 `decideRework` 之后、原话绑定（`settleWords`）之前调它。`creating`：写入之前的读不到（`beforeText === null`），而且这一趟的
  目录里没有一份门禁在 `state.json` 落盘之后才写的文件（`GATE_FILES`：派发记录、批准记录、契约基线、交付快照、原话记录；复核核过它们不会在建 run 之前出现）。
  目录里只有契约（先写了契约再建 run）、系统杂文件、空子目录的照样算建 run；跑过一阵的一趟丢了 `state.json` 照着重建不算；写入之前的在、却不是合法 JSON
  （修复路）不算；看不清（`existsSync` 出错答 false）算建 run。
- `hooks/lib/fail-open.mjs` 的 state 修法：照原样保留的那一串加上 `stage_roles`，并说原文里没有它的旧 run 不要加。
- `commands/at.md` 第 1 节：例外名单那一句照旧（账本的校验对 `trimmed`、`stage_roles`、`rework_base`、`closed_at` 都向后兼容），后面加一句 `stage_roles` 另有一道。

## 3. 判据与变异

- `tests/stage-roles-key.test.mjs`：
  - 纯函数：建 run 不带拒、带了放行；写入之前有、这次去掉了拒；建 run 与写入之前是对象时，值写成 `[]`、`null`、字符串也拒；写入之前的值本来就坏了，去掉或
    改成对象都放行；旧 run 不带、旧 run 加上都放行；写入之前读不出（不是建 run）不判；新内容不是对象不判。
  - 子进程：照真实顺序建 run——项目经理直接 Write `runs/<id>/state.json`（目录还不在），不带拒、带了放行；有 `stage_roles` 的一趟去掉它拒、旧 run 照常写放行；
    写入之前的不是合法 JSON，修复写入不带它照常放行。复核之后：Edit 建 run（`old_string` 为空串）不带拒、带了放行，Edit 去掉那一行拒；`/agent-team:at` 之后
    建 run 被这一条拒，项目一级的原话记录不记 `binding`。第二轮复核之后：先建空目录、先写了契约、目录里有系统杂文件或空子目录，都在第二趟（`runs/` 下已经有
    别的一趟）上建 run，不带拒、带了放行；跑过一阵的一趟（门禁专属文件逐份各试一次）`state.json` 丢了，不带它的重建放行；state 修法里有那一句。
  - 正文：第 1 节有那两句，排在例外名单那一句后面。
- 按旧规矩不带 `stage_roles` 建 run 的夹具补上了它（`tests/gate-user-words.test.mjs` 的 `stateOf`、`tests/gate-rework.test.mjs` 那一条建 run）。
- 变异（备份在仓库外，每一刀改完逐字节还原）：建 run 不核、去掉不核、门禁永远不当建 run、门禁不调、读不出也当建 run（原来那条「把坏掉的 state.json 修回去」也红）、
  值不是对象也拒——每一刀都有判据红。复核之后：新内容只认键、写入之前只认键、目录不空也当建 run、只对 Write 判、挪到原话绑定之后——每一刀都有判据红；
  「读不出也当建 run」现在是等价变异（读得到原文就说明文件在、目录不空）。第二轮复核之后：看上一级目录、永远没见过、永远见过、只认派发记录、目录不空就算
  见过（第一轮修订的认法）、修法不提 `stage_roles`——每一刀都有判据红。

## 4. 仍然开着的边界

- **不经 Write 建的不核**：`Bash` 写出来的 `state.json`、门禁不在时建的一趟，第一次经 H6 的写入已经不是建 run；之后有没有 `stage_roles` 照旧分不出新旧（§2「`Bash`
  不经门禁」那一族）。
- **写入之前的值本来就坏了不拦**：`stage_roles` 已经是 `[]`、`null` 之类时，消费方把这一趟当旧 run（`participantsOf` 退回整趟 `roster`），`validateState`
  报【state.json】、只报不拦；去掉它也放行。
- **写坏之后再修**：新 run 的 `state.json` 被写坏（`Bash` 写的、UTF-16、截成 0 字节），再照修法用 Write 修复、修复的内容里漏了 `stage_roles`——写入之前
  读得出却解析不了，不算建 run，「去掉」那一条也看不到它原来有键，放行，之后这一趟静默按旧口径判。
- **跑过一阵的新 run 的 `state.json` 丢了**：目录里有门禁专属文件，照着重建不算建 run，不带 `stage_roles` 的重建放行，同样静默退回旧口径。
- **从没跑起来的旧 run 丢了 `state.json`**：目录里一份门禁专属文件都没有（还没派过人、没推进出第一段），照着重建算建 run，要带 `stage_roles`。
- **旧 run 半路加上之后去不掉**：没有这个键的旧 run 被加上 `{}`（违规，或者 `state.json` 丢了照修法重建时照模板写上了），再去掉的写入被拒；出路是照
  【state.json】报出来的那几段逐段补记（`/agent-team:at` 第 3 节写着）。分不出这一趟是旧 run 加上的、还是新 run 本来就有的。
- **另外三个后加的键建 run 时少了照旧不报**：`trimmed` 缺了当空、`rework_base` 回退时才生成、`closed_at` 收口时写——缺了不改变判法。
- **旧 run 照旧没有它**（有意）：门禁对它们按整趟 `roster` 判。
- **认「建 run」靠门禁专属文件不在**：`Bash` 往新目录里放一份同名文件，这一次就不算建 run、不核（§2「`Bash` 不经门禁」那一族）；`existsSync` 看不清时算建 run。

## 5. 没量到的

- 真实会话里项目经理建 run 时漏写 `stage_roles`、被 H6 拒了之后照模板补上。

## 6. 归属

- `hooks/lib/rework-guard.mjs` 的 `decideStageRolesKey`、`STAGE_ROLES_CREATE`、`STAGE_ROLES_DROP`；`hooks/gate.mjs` 的 H6 那一处调用；`commands/at.md` 第 1 节；
  判据在 `tests/stage-roles-key.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/32` §4「新 run 漏写或拼错 `stage_roles`」：写了收口。
- `docs/55` §4「漏写的照旧静默」：写了收口。
- `docs/00-开放边界.md`：`docs/32` §4、`docs/55` §4 两行改了，这一份的 §4、§5 登上。

## 8. 复核与修订

第一版推上分支之后起了一个对抗复核的子代理：照真实顺序建 run（`/agent-team:at` 展开、项目经理直接 Write `runs/<id>/state.json`）、Edit 建 run 与 Edit 删键、
BOM 与 CRLF 的文件、旧 run 续跑、照拒绝理由去做能不能通过、与 H6 别的判据的先后，都核过没问题；被拒的建 run 不留下原话绑定的半截状态。没有高的，两个中等、四个小问题：

- **中 1：只认键不认值**——建 run 时写 `"stage_roles": []` 或 `null`、已有 `{}` 的一趟改成 `null`，H6 都放行；`participantsOf` 对不是对象的值退回整趟 `roster`，
  走的正是这一轮要关的静默退路。§4 写的「当没有这一段的记录」也不对。→ 认值：新内容的 `stage_roles` 要是对象，写入之前是对象的这一次也得是对象；写入之前
  本来就坏了的不拦（与【state.json】叫改成对象的出路不打架）。
- **中 2：两刀变异打不红**——只对 Write 判（判据里没有一条 Edit）、把这一条挪到原话绑定之后（被拒的建 run 会在项目一级的原话记录里留下 `binding`）。
  → 补 Edit 建 run、Edit 删键、被拒时不记 `binding` 三格。
- **低**：旧 run 半路违规加上 `{}` 之后去不掉，文档与更新记录「旧 run 碰不到」说过头（→ `/agent-team:at` 第 3 节补出路，§0、§4、更新记录改了）；读不出
  `state.json`（被别的进程锁住）、`state.json` 丢了要重建，都被当成建 run、理由说错事、把旧 run 引去加键（→ 认「建 run」要目录不在或为空）；写坏之后再修
  漏了键那一路没登（→ 登在 §4）；新代码插在 `replayEdit` 的文档注释与函数之间（→ 挪到前面）。

修订推上分支之后起了第二个复核的子代理，专查两条改写（认值、认「建 run」）：正路上四种建 run 的走法（平台建目录、先建空目录、第二趟各两种）都拒得住，照拒绝理由
去做能过、不留原话绑定；门禁专属文件不会在建 run 之前出现；认值与 `participantsOf` 同一个口径。没有高的，两个中等、四个小问题：

- **中 1：先写了契约再建 run 那条路被放回去了**（第一轮修订造成的退步）——目录里有 `00-contract.md`，不算「空」，不带 `stage_roles` 放行；同一次写入原话绑定照旧
  当它是建 run、记下 `binding`，落盘之后一字不提。这条路是门禁自己的回传引过去的（读不出运行上下文时的修法、【指针】）。→ 认「建 run」改成目录里没有门禁
  专属文件：只有契约、系统杂文件的照样算建 run，跑过一阵的一趟重建不算。
- **中 2：两刀变异打不红**——看上一级目录、只认目录不在（空目录不算）。判据里建 run 时 `runs/` 总是空的、目录总是不在。→ 补先建空目录、第二趟各几格。
- **低**：列不出目录（EACCES 之类）静默放行（→ 改了之后看不清算建 run）；`.DS_Store`、`desktop.ini`、空子目录让建 run 不核（→ 改了之后照样核）；旧 run 的
  `state.json` 丢了、照门禁的修法重建，被引去加键、加上之后去不掉（→ 修法加一句「原文里没有 stage_roles 的旧 run 不要加」，§4 登上）；`docs/32`、`docs/55` 的
  收口、判据头注释、看板第 93 项、`/agent-team:at` 第 1 节还是第一版的说法（→ 改了）。
