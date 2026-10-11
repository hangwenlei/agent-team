# project.json 里重复的键

> 2026-10-11，分支 `r33-project-dup-keys`。第三十三轮（从开放边界索引挑）：`docs/74` §4「只看 `state.json`」。

## 0. 一句话结论

- 项目经理写 `.agent-team/project.json` 时（有 run、没有 run 两条路——没有 run 是 `/agent-team:at-init` 写它的那一次），原文里同一个对象写了不止一次的键并进【project.json】的
  「要改」那一档，一键一行，跟 `state.json` 那一路同一个函数、同一句话（`docs/74`）。写 `current-run`、`state.json` 时不重复报。

## 1. 问题

- `paths` 写了两遍、或者 `paths` 里一个角色写了两遍，`JSON.parse` 只认最后一个：前一遍里的前缀悄悄丢掉，执行角色写那里时被写路径隔离拒，回传说的是「没有被任何角色认领」，
  看不出是 `project.json` 里写重了。这比 `state.json` 那一格更容易咬人。

## 2. 修法

- `hooks/gate.mjs`：`projectDupLines`（读写进去的那份原文、调 `state.mjs` 的 `duplicateKeyLines`，读不到给空）、`withDupFix`（并进 `validateProject` 报告的「要改」）；
  没有 run 那一支（账本回传触达表那一路）与有 run 时写 `project.json` 那一支各接一处。「要改」不扣下触达表（只有阻断扣下）。
- `tests/trusted-echo.test.mjs` 补了「`project.json` 原文里重复的键与外层路径是载荷」那一格。

## 3. 判据与变异

- `tests/gate-ledger-project.test.mjs` 加一条：没有 run 时 `paths` 写了两遍、有 run 时 `paths` 里 `at-backend` 写了两遍，都在「要改」里报（后一条带「在 "paths" 里」）；写 `current-run` 时不报。
- 变异（备份在仓库外，每一刀改完逐字节还原）：没有 run 那一路不接、有 run 那一路不接、写指针也报、并进阻断——每一刀都有判据红。

## 4. 仍然开着的边界

- **`reach.json` 不报**：它是项目经理照【触达表】原样抄的，门禁写完就重算核对（`docs/42`），抄重了键时那一条核对按解析后的值比。
- **只在写 `project.json` 那一次报**：之后写 `current-run`、`state.json` 不重复说；用户手改 `project.json` 留下的重复键，下次项目经理写它时才报。
- 上限、只报不拦、被拒的那一次看不到，与 `docs/74` §4 同一档。

## 5. 没量到的

- 真实会话里 `/agent-team:at-init` 写出重复的键、收到这一行之后改不改。

## 6. 归属

- `hooks/gate.mjs` 的 `projectDupLines`、`withDupFix` 与两处接线；判据在 `tests/gate-ledger-project.test.mjs`、`tests/trusted-echo.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/74` §4「只看 `state.json`」：写了收口一半（`project.json` 报了，`reach.json` 照旧不报）。
- `docs/00-开放边界.md`：`docs/74` §4 那一行改了，这一份的 §4、§5 登上。
