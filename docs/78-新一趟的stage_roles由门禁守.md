# 新一趟的 stage_roles 由门禁守

> 2026-10-11，分支 `r36-stage-roles-key`。第三十六轮（从开放边界索引挑）：`docs/32` §4「新 run 漏写 `stage_roles` 时静默退回整趟口径」，
> 也是 `docs/55` §4「漏写的照旧静默」。

## 0. 一句话结论

- 按段判的门禁（【阶段】、推进、产者交代、交付物核验……）认 `state.json` 有没有 `stage_roles` 这个键：没有就当更早落盘的 run，按整趟 `roster` 判。
  新 run 漏写它，门禁一声不吭地退回旧口径。现在 H6 在两个时刻拒：建 run 的那一次（写之前 `state.json` 不在）不带 `stage_roles`；写入之前有 `stage_roles`、
  这次写入把它去掉了。旧 run 从来没有这个键，两条都碰不到它。`/agent-team:at` 第 1 节写明。

## 1. 问题

- `validateState` 对 `stage_roles` 缺失不报——旧 run 本来就没有它，报了会叫旧 run 半路加上（`/agent-team:at` 第 3 节明令不要：之前走过、没补键的那几段会被当成
  没记账）。`docs/55` 只做了拼错的那一半（认不出的键点出 `stage_roles`）。
- 从 `state.json` 本身分不出新旧：拿 `closed_at`、`rework_base` 在不在认也不准——旧 run 在新插件下续跑，回退会写进 `rework_base`、收口会写进 `closed_at`。
- 门禁看得准新旧的是建 run 的那一次：写之前文件不在，这一次照的是现行模板（原话记录的绑定认的也是这一刻，`docs/50`、`docs/58`）。建出来之后，
  「写入之前有它」本身就说明这是新的一趟。

## 2. 修法

- `hooks/lib/rework-guard.mjs` 的 `decideStageRolesKey({ before, after, creating })`：新内容是对象、没有 `stage_roles` 键时——`creating` 为真拒（`STAGE_ROLES_CREATE`），
  写入之前是对象、有这个键拒（`STAGE_ROLES_DROP`）；别的放行。只管键在不在，值的形状归 `validateState`。
- `hooks/gate.mjs` 的 H6：排在 `decideRework` 之后调它，`creating` 与原话绑定（`settleWords`）同一个条件：写入之前的读不到（`beforeText === null`）。
  写入之前的在、却不是合法 JSON（修复路）不算建 run，照旧放行。
- `commands/at.md` 第 1 节：例外名单那一句照旧（账本的校验对 `trimmed`、`stage_roles`、`rework_base`、`closed_at` 都向后兼容），后面加一句 `stage_roles` 另有一道。

## 3. 判据与变异

- `tests/stage-roles-key.test.mjs`：
  - 纯函数：建 run 不带拒、带了放行；写入之前有、这次去掉了拒；值写成别的（不是对象）不归这一条；旧 run 不带、旧 run 加上都放行；写入之前读不出（不是建 run）
    不判；新内容不是对象不判。
  - 子进程：照真实顺序建 run——项目经理直接 Write `runs/<id>/state.json`（目录还不在），不带拒、带了放行；有 `stage_roles` 的一趟去掉它拒、旧 run 照常写放行；
    写入之前的不是合法 JSON，修复写入不带它照常放行。
  - 正文：第 1 节有那两句，排在例外名单那一句后面。
- 按旧规矩不带 `stage_roles` 建 run 的夹具补上了它（`tests/gate-user-words.test.mjs` 的 `stateOf`、`tests/gate-rework.test.mjs` 那一条建 run）。
- 变异（备份在仓库外，每一刀改完逐字节还原）：建 run 不核、去掉不核、门禁永远不当建 run、门禁不调、读不出也当建 run（原来那条「把坏掉的 state.json 修回去」也红）、
  值不是对象也拒——每一刀都有判据红。

## 4. 仍然开着的边界

- **不经 Write 建的不核**：`Bash` 写出来的 `state.json`、门禁不在时建的一趟，第一次经 H6 的写入已经不是建 run；之后有没有 `stage_roles` 照旧分不出新旧（§2「`Bash`
  不经门禁」那一族）。
- **只管键在不在**：值写成 `[]`、字符串这类，`validateState` 报【state.json】，只报不拦；按段判的消费方把它当没有这一段的记录。
- **认「建 run」靠写入之前读不到文件**：读不到的成因不只是不在（权限之类的 I/O 错误也算），那时不带 `stage_roles` 的写入同样被拒；与原话绑定同一个条件。
- **另外三个后加的键建 run 时少了照旧不报**：`trimmed` 缺了当空、`rework_base` 回退时才生成、`closed_at` 收口时写——缺了不改变判法。
- **旧 run 照旧没有它**（有意）：门禁对它们按整趟 `roster` 判。

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
