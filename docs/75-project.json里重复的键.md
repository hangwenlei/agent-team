# project.json 里重复的键

> 2026-10-11，分支 `r33-project-dup-keys`。第三十三轮（从开放边界索引挑）：`docs/74` §4「只看 `state.json`」。

## 0. 一句话结论

- 项目经理写 `.agent-team/project.json` 时（有 run、没有 run 两条路——没有 run 是 `/agent-team:at-init` 写它的那一次），原文里同一个对象写了不止一次的键并进【project.json】的
  「要改」那一档，一键一行，跟 `state.json` 那一路同一个函数、同一句话（`docs/74`）。写 `current-run`、`state.json` 时不重复报。
- 复核之后（§8）：句尾换成「前面那几个里要留的（例如前一遍里的前缀）并进最后那一个，再删掉前面几个」（`state.json` 那一路照旧）；每趟开头写 `current-run` 时也报
  （读磁盘上那份 `project.json`），写 `state.json` 时不报；`reach.json` 抄重了键也算对不上、给出正确的那一份；`/agent-team:at-init` 第 2 节写明同一个键只写一次。

## 1. 问题

- `paths` 写了两遍、或者 `paths` 里一个角色写了两遍，`JSON.parse` 只认最后一个：前一遍里的前缀悄悄丢掉，执行角色写那里时被写路径隔离拒，回传说的是「没有被任何角色认领」，
  看不出是 `project.json` 里写重了。这比 `state.json` 那一格更容易咬人。

## 2. 修法

- `hooks/gate.mjs`：`projectDupLines`（读写进去的那份原文、调 `state.mjs` 的 `duplicateKeyLines`，读不到给空）、`withDupFix`（并进 `validateProject` 报告的「要改」）；
  没有 run 那一支（账本回传触达表那一路）与有 run 时写 `project.json` 那一支各接一处。「要改」不扣下触达表（只有阻断扣下）。
- `tests/trusted-echo.test.mjs` 补了「`project.json` 原文里重复的键与外层路径是载荷」那一格。
- 复核之后：`state.mjs` 的 `duplicateKeyLines` 加 `merge` 选项（`projectDupLines` 用它）；有 run 那一支写 `current-run` 时也并进，读 `join(agentTeamDir, 'project.json')`；
  `ledger.mjs` 的 `reachCheckNotice` 见到 `duplicateKeys` 非空就当对不上；`commands/at-init.md` 第 2 节 `paths` 那几条加一句；挂错位置的注释挪回 `approvalDiagnostic` 头上。

## 3. 判据与变异

- `tests/gate-ledger-project.test.mjs`：没有 run 时 `paths` 写了两遍、有 run 时 `paths` 里 `at-backend` 写了两遍，都在「要改」里报（后一条带「在 "paths" 里」），句尾说并进；
  复核之后：写 `current-run` 时报、写 `state.json` 时不报；跟 `validateProject` 本来就报的「要改」（给 `at-pm` 建了键）同时在、两个重复键都列出来；run 在却读不出时写
  `project.json` 也报；`reach.json` 抄重了键给出正确的那一份；`at-init` 那一句。
- 变异（备份在仓库外，每一刀改完逐字节还原）：没有 run 那一路不接、有 run 那一路不接、写指针也报（第一版的口径）、并进阻断——每一刀都有判据红。复核之后又加了：替换
  不并进（起初存活：断言里的 `"at-pm"` 在后面的【触达表】JSON 里本来就有，改成核那一行的原话才红）、写 `state.json` 也报、只在没有 run 时接、只报第一条、句尾不说并进、
  写指针不报、`reach.json` 重复键照放、`at-init` 不写——每一刀都有判据红。

## 4. 仍然开着的边界

- **写 `state.json` 时不报**：与「写 `state.json` 只报阻断」同一个口径；两趟之间用户手改留下的，下一趟开头写 `current-run` 时报。
- 上限、只报不拦、被拒的那一次看不到，与 `docs/74` §4 同一档。

## 5. 没量到的

- 真实会话里 `/agent-team:at-init` 写出重复的键、收到这一行之后改不改。

## 6. 归属

- `hooks/gate.mjs` 的 `projectDupLines`、`withDupFix` 与两处接线；判据在 `tests/gate-ledger-project.test.mjs`、`tests/trusted-echo.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/74` §4「只看 `state.json`」：写了收口（`project.json` 写它与写 `current-run` 时报，`reach.json` 抄重了键算对不上）。
- `docs/00-开放边界.md`：`docs/74` §4 那一行改了，这一份的 §4、§5 登上。

## 8. 复核与修订

第一版推上分支之后起了一个对抗复核的子代理：接线两条路都实测报出来了（Write、Edit、全大写路径、反斜杠、BOM 加 CRLF），只有阻断才扣下触达表。没有高的，两个中等、几处小问题，
都在这一轮改了：

- **中 1：句尾照搬 `state.json` 那一路**——「删掉前面几个不改变门禁读到的值」，在 `project.json` 里前面那一遍往往正是想要的前缀，照做就把丢掉的东西删干净了（实测项目经理
  照这句删掉 `lib/`，执行段照样被拒）。→ `merge` 选项，句尾叫人把要留的并进最后那一个。
- **中 2：写 `current-run` 时不报，跟那个时机「三档全报、让旧配置在 S1 就露面」的理由对不上**（用户手改留下的重复键正是这一种）。→ 写 `current-run` 时也报，读磁盘上那份。
- **低**：「要改」那一档的定义（at-init 明令不许的）罩不住重复键（→ at-init 第 2 节加一句）；`reach.json` 不报的理由站不住（抄重了键核对静默通过，at-status 照原文读可能读到前一遍；
  → 算对不上）；几刀打不红（→ 补格，见 §3）；注释挂错了地方（→ 挪回去）。
