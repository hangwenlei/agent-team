# 每趟开头核 reach.json

> 2026-10-11，分支 `r37-reach-stale`。第三十七轮（从开放边界索引挑）：`docs/42` §4「`reach.json` 只在 PM 写它的那一刻核」，也是 `docs/29` §5
> 「`reach.json` 写完之后会落后，at-status 不核它」（全量审查第 28 条的剩下那一半）。

## 0. 一句话结论

- 每趟开头项目经理写 `current-run` 的那一次，门禁按当前 `project.json` 与花名册重算触达表，与磁盘上的 `.agent-team/reach.json` 比：对不上（`project.json`
  在它写成之后改过、当初手抄出错）、写坏了、有写了不止一次的键、不在，【触达表】说出来，给出正确的那一份叫它原样重写。`project.json` 有阻断或插件问题时不核；
  写 `state.json` 等别的时机不核。

## 1. 问题

- `reach.json` 是项目经理照【触达表】手抄的快照，`/agent-team:at-status` 报各角色实际能写到哪里时读的就是它。`docs/42` 让门禁在项目经理写它的那一刻
  重算核对；之后 `project.json` 被手改（两趟之间用户改了 `paths`）、`reach.json` 被 `Bash` 改坏或删掉，门禁一声不吭，at-status 照旧照它报。
- 写 `project.json` 那一次【触达表】本来就给出新的一份；漏掉的是 `project.json` 不经项目经理改动的那几种（用户手改、at-init 在阻断处停下之后用户自己改好）。

## 2. 修法

- `hooks/lib/ledger.mjs`：原来 `reachCheckNotice` 里比对的那一段提成 `reachDiff(text, expected)`（对得上为 `null`；`invalid`、`dup`、`differ` 三种对不上——
  语义比较，键序、BOM、CRLF 不算不同，与写 `reach.json` 那一刻同一个口径）；新函数 `reachStaleNotice({ text, expected })`，`text` 为 `null` 是不在。
- `hooks/gate.mjs`：新函数 `staleReachFor(ctx)`——`project.json` 在、没有阻断与插件问题时读 `.agent-team/reach.json`（不在算 `null`；在却读不出来——占用之类——
  不核），按 `computeReach` 重算、交给 `reachStaleNotice`。账本在写 `current-run` 那一支（与【派发】同一处）调它。复核之后（§8）：写指针的人不是项目经理时
  （没有 run 的那一刻 H3 对谁都放行），与写 `reach.json` 那一刻同一个口径加一句「原样冒泡、不要自己重写」；「对不上」的成因里加上插件更新。

## 3. 判据与变异

- `tests/reach-stale.test.mjs`：纯函数——对得上不吭声（含 BOM、CRLF）；对不上、写坏了、有重复的键、不在各说一句、都提到 `/agent-team:at-status`、都给出正确的
  那一份。子进程——`project.json` 改宽了、`reach.json` 还是旧的：写 `current-run` 时【触达表】说它落后，给出的 JSON 就是按当前配置算的；对得上时不说；不在时说；
  `project.json` 有阻断时不核；写 `state.json` 时不核。
- 变异（备份在仓库外，每一刀改完逐字节还原）：写指针时不核、阻断时也核、不在不说、不比重复的键、对得上也说、不剥 BOM、写 `state.json` 也核——每一刀都有判据红。
- 复核之后（§8）补的：花名册读不出（拷一份插件、换掉花名册）时只说【插件】、不给触达表；`reach.json` 在却读不出（建成一个目录）不核；不是项目经理写的叫它冒泡；
  成因里有插件更新；`tests/trusted-echo.test.mjs` 的入口清单补上「每趟开头写 `current-run` 时的【触达表】」。变异：插件问题也核、读不出按不在说、不分写者、
  不经 `safeJson`——每一刀都有判据红。

## 4. 仍然开着的边界

- **只在写 `current-run` 时核**：一趟进行中 `project.json` 或 `reach.json` 被 `Bash`、被用户手改，要到下一次写 `current-run`（下一趟开头，或者
  `/agent-team:at-resume` 丢了指针、`/agent-team:at` 接回一趟时写回它）才说；指针在、直接续跑的那一趟不核。
- **只报不拦**：项目经理不照着重写，at-status 照旧照旧的那一份报。
- **at-status 自己不核**：它是正文，读 `reach.json` 原样报，不重算。
- **`reach.json` 在、却读不出来时不核**：与写它那一刻的核对同一档（`docs/42` §4「不核的几种时候一声不吭」那一族），不留痕。
  > **收口（2026-10-11，`docs/88`，v6.5.0）**：【触达表】说它在、却读不出来、这一次没有核，照样给出按当前配置算出来的那一份（写不进去就告诉用户）。
- **只给 JSON，不带审计正文**：写 `project.json` 那一次的【触达表】还列出哪些角色实际能写到的地方超出了自己认领的、哪些不受 `paths` 管，`/agent-team:at-init`
  要项目经理读一遍、向用户确认；两趟之间用户手改放宽了 `paths`，这一段只给新的 JSON，那份审计没有再说一遍。
- **`project.json` 有「要改」时照发**：给出的是按改之前的配置算的那一份；改完 `project.json` 那一次的【触达表】与写 `reach.json` 时的核对会再纠正，不卡住
  （与写 `project.json` 那一次有「要改」时照发同一个口径）。

## 5. 没量到的

- 真实会话里两趟之间改了 `project.json`、下一趟开头收到这一段之后照着重写 `reach.json`。

## 6. 归属

- `hooks/lib/ledger.mjs` 的 `reachDiff`、`reachStaleNotice`；`hooks/gate.mjs` 的 `staleReachFor` 与写 `current-run` 那一支；判据在 `tests/reach-stale.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/42` §4「`reach.json` 只在 PM 写它的那一刻核」：写了部分收口。
- `docs/29` §5「`reach.json` 是最近一次落盘时的快照」：写了部分收口。
- `docs/00-开放边界.md`：`docs/29` §5、`docs/42` §4 两行改了，这一份的 §4、§5 登上。

## 8. 复核与修订

第一版推上分支之后起了一个对抗复核的子代理：真实顺序下（at-init 之后第一趟、at-init 停下之后用户改好）主路径都对，照着回传重写之后两处核对都不再出声；没有 run、
指针指向坏的 run、UTF-16 的 `project.json` 都落在读不出运行上下文那一支、碰不到这里；十几种奇形 `project.json` 与极深嵌套的 `reach.json` 都不崩。没有高的，一个中等、几个小问题：

- **中 1：插件问题时不核这一道没有判据**——去掉它全量照绿，花名册读坏时同一次回传先是【插件】叫停下、接着【触达表】叫照着空表重写 `reach.json`。→ 补子进程判据。
- **低**：不是项目经理写指针时叫它重写一份它写不了的文件（→ 加冒泡那一句）；trusted-echo 的入口清单没补这条路（→ 补了）；`reach.json` 在却读不出不核没有判据（→ 补了）；
  「对不上」的成因漏了插件更新（→ 加上）；§4 说续跑不写 `current-run` 说过头（→ 改了）；更新记录说 at-status「不再」照旧的报说过头（→ 改了）；只给 JSON 不带审计
  正文、有「要改」时照发（→ 登在 §4）；花名册坏时 stderr 多一行「读不出来」（不改）。
