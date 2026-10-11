# 写触达表时 project.json 解析不出也说没核

> 2026-10-11，分支 `r45-reach-broken-project`。第四十五轮（从开放边界索引挑）：`docs/83` §4「`project.json` 读得到、却解析不出时……不提 `reach.json` 没核」。
> 只动门禁回传与判据。

## 0. 一句话结论

- 写 `.agent-team/reach.json` 时 `project.json` 读得到、却解析不出（或者不是一个 JSON 对象）：原来写 reach.json 那一条缝放过它，落到「它在别处被弄坏」那一条缝，
  只说 `project.json` 的问题——没核被读成了对上。现在同一段回传里先说【触达表】这一次没有核（`project.json` 解析不出、改好之后照写它那一次的【触达表】重写），
  再接【project.json】那一段（有没有 run、是不是 UTF-16，照旧分）。

## 1. 问题

- `docs/83` 让写 `reach.json` 时核不了的几种都说一句「这一次没有核」，唯独 `project.json` 读得到、却解析不出那一种照旧落到「它在别处被弄坏」那一条缝：那一段
  说 `project.json` 坏了、怎么改，不提 `reach.json` 没核。`/agent-team:at-init` 写着没收到核对结果不等于对上了，可这一次收到的是一段回传——读的人分不清
  那段回传有没有核过触达表。

## 2. 修法

- `hooks/gate.mjs` 账本写 `reach.json` 那一条缝：重读过 `project.json`、读得到原文却不是对象的，一次回传两段——`reachUnchecked(REACH_PROJECT_BROKEN)`
  在前，`brokenProjectNotice`（`justWritten: false`，有没有 run、UTF-16 照原样判）在后；不是项目经理写的，前一段照旧叫它原样冒泡。下面「它在别处被弄坏」
  那一条缝不再走到这一种（`emitHookJson` 写完就退出）。
- `tests/reach-unchecked.test.mjs`：一条——有 run、没有 run 都说这一次没有核，两段的先后，有 run 时那一段说「run 进行中」、没有 run 时不说；不是对象的
  （`[1, 2]`）、不是项目经理写的叫它冒泡；UTF-16 的点明编码。

## 3. 判据与变异

- 变异（备份在仓库外，改完逐字节还原，每刀跑全量），每一刀都红：新那一支关掉、两段顺序对调、去掉 `project.json` 那一段、UTF-16 恒假、「run 进行中」恒假、
  写者恒当项目经理、不是对象的不算。

## 4. 仍然开着的边界

- **run 进行中、`project.json` 这一刻读不出**：照旧（`docs/83` §4 第二条）。
- **只报不拦**：项目经理照旧可以在核不了的时候写 `reach.json`；at-status 照它报（`docs/83` §4 第三条）。

## 5. 没量到的

- 真实会话里 at-init 写 `reach.json` 时 `project.json` 坏着，项目经理先改 `project.json` 再照【触达表】重写，还是直接停下。

## 6. 归属

- `hooks/gate.mjs`（账本写 `reach.json` 那一条缝、`REACH_PROJECT_BROKEN`）；判据在 `tests/reach-unchecked.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/83` §4「`project.json` 读得到、却解析不出时」：写了收口。
- `docs/00-开放边界.md`：`docs/83` §4 那一行改了，这一份的 §4、§5 登上。
