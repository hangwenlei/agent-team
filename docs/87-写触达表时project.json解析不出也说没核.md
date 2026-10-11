# 写触达表时 project.json 解析不出也说没核

> 2026-10-11，分支 `r45-reach-broken-project`。第四十五轮（从开放边界索引挑）：`docs/83` §4「`project.json` 读得到、却解析不出时……不提 `reach.json` 没核」。
> 只动门禁回传与判据。

## 0. 一句话结论

- 写 `.agent-team/reach.json` 时 `project.json` 读得到、却解析不出（或者不是一个 JSON 对象）：原来写 reach.json 那一条缝放过它，落到「它在别处被弄坏」那一条缝，
  只说 `project.json` 的问题——没核被读成了对上。现在同一次回传里两段：先说【触达表】这一次没有核（`project.json` 解析不出、改好之后照写它那一次的【触达表】重写），
  再接【project.json】那一段（有没有 run、是不是 UTF-16，照旧分；出路与前一段同一条，复核之后，§8）。
- 复核时顺带核实：「run 进行中、`project.json` 这一刻读不出」那一条（`docs/83` §4 第二条）早在 `docs/83` §8 加重读时就关上了，这一轮补了有 run 的判据。

## 1. 问题

- `docs/83` 让写 `reach.json` 时核不了的几种都说一句「这一次没有核」，唯独 `project.json` 读得到、却解析不出那一种照旧落到「它在别处被弄坏」那一条缝：那一段
  说 `project.json` 坏了、怎么改，不提 `reach.json` 没核。`/agent-team:at-init` 写的是「这一次没再收到【触达表】，就是对上了」——收到的只有【project.json】
  那一段、没有【触达表】，照这一句就被读成了对上。

## 2. 修法

- `hooks/gate.mjs` 账本写 `reach.json` 那一条缝：重读过 `project.json`、读得到原文却不是对象的，一次回传两段——`reachUnchecked(REACH_PROJECT_BROKEN)`
  在前，`brokenProjectNotice`（`justWritten: false`、`reach: true`，有没有 run、UTF-16 照原样判）在后；不是项目经理写的，前一段叫它把这两段原样冒泡
  （`REACH_FOR_OTHERS_BOTH`）。下面「它在别处被弄坏」那一条缝不再走到这一种（`emitHookJson` 写完就退出）。
- `hooks/lib/ledger.mjs` 的 `brokenProjectNotice` 加 `reach`（复核之后，§8）：写的是 `reach.json` 时，有 run 也给没有 run 那一句出路（改好 project.json 就会
  收到报告与【触达表】那一段），不说「原样重写一次刚才那个文件拿回传」「哈希回传不了」。
- `tests/reach-unchecked.test.mjs`：一条——有 run、没有 run 都说这一次没有核，两段的先后，出路钉住、不说「刚写进去的」与那两句，有 run 时那一段说「run 进行中」、
  留痕，没有 run 时不说、不留痕，UTF-16 的点明编码；不是对象的（`[1, 2]`）、不是项目经理写的叫它把这两段冒泡。`docs/83` §8 那一条（短暂占用）有 run 时也跑。

## 3. 判据与变异

- 变异（备份在仓库外，改完逐字节还原，每刀跑全量），每一刀都红：
  - 第一版：新那一支关掉、两段顺序对调、去掉 `project.json` 那一段、UTF-16 恒假、「run 进行中」恒假、写者恒当项目经理、不是对象的不算。
  - 复核之后：【触达表】的出路改成「过一会儿原样再写」；`justWritten` 恒真；UTF-16 只在没有 run 时点明；有 run 时不留痕；去掉 `reach: true`；冒泡只说这一段；
    `brokenProjectNotice` 不看 `reach`。
- 打不红的：有 run 时把写者一律当项目经理（那时非项目经理的写入在 H3 就被拒了，只剩 Pre/Post 之间的竞态，§4）。

## 4. 仍然开着的边界

- **只报不拦**：项目经理照旧可以在核不了的时候写 `reach.json`；at-status 照它报（`docs/83` §4 第三条）。
- **不是项目经理收到的【project.json】那一段**：UTF-16 那一支开头是「用 Write 整份重写 project.json」，到末尾才说只有项目经理该改它——靠前一段叫它把这两段冒泡；
  有 run 时写者恒当项目经理那一刀打不红（只剩竞态）。

## 5. 没量到的

- 真实会话里 at-init 写 `reach.json` 时 `project.json` 坏着，项目经理先改 `project.json` 再照【触达表】重写，还是直接停下。

## 6. 归属

- `hooks/gate.mjs`（账本写 `reach.json` 那一条缝、`REACH_PROJECT_BROKEN`、`REACH_FOR_OTHERS_BOTH`）、`hooks/lib/ledger.mjs`（`brokenProjectNotice` 的 `reach`）；
  判据在 `tests/reach-unchecked.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/83` §4「`project.json` 读得到、却解析不出时」：写了收口。
- `docs/83` §4「run 进行中、`project.json` 这一刻读不出」：写了订正（早已关上）。
- `docs/00-开放边界.md`：`docs/83` §4 那一行改了，这一份的 §4、§5 登上。

## 8. 复核与修订

第一版（6d0da00）推上分支之后起了一个对抗复核的子代理。下面这些核过了：
- 新那一支只在运行上下文读不出的那一支里；`readProjectConfig` 只因解析失败或不是对象返回假，形状问题不会被误判成解析不出。
- 空文件、只有 BOM、`null`、数组、字符串、尾逗号两种 run 状态下都两段齐出，UTF-8 带 BOM 的合法对象照常核，读的次数不变。
- 两段并成一个受信块、没有 `systemMessage`；新拼的只有常量，trusted-echo 不用登记。

两个中等、七个低：

- **中 1：有 run 时两段给了两种出路**——【触达表】叫它照新的【触达表】重写，【project.json】那一段叫它「原样重写一次刚才那个文件拿回传」、说哈希回传不了（对
  `reach.json` 都不对）。→ `brokenProjectNotice` 加 `reach`，两段同一条出路。
- **中 2：出路与 `justWritten: false` 没有判据**——出路改成别的、`justWritten` 改成真（会说「刚写进去的 project.json」）全绿。→ 钉住。
- **低 1：UTF-16 只在没有 run 时点明、有 run 时不留痕，两刀打不红**。→ 有 run 也跑 UTF-16；判据核 stderr。
- **低 2：有 run 时把写者一律当项目经理打不红**——碰不到（只剩竞态）。→ 登在 §4。
- **低 3：不是项目经理写的，「把这一段原样冒泡」只盖住前一段**，上去的是悬空的「下一段说怎么改」。→ 改成「把这两段原样冒泡」；UTF-16 那一支的语气登在 §4。
- **低 4：`gate.mjs` 几处注释过时**（说解析不出的照旧落到下面那条缝）。→ 改准。
- **低 5：§1 把 at-init 的话引反了**——「没收到核对结果不等于对上了」是门禁的话，at-init 写的是「没再收到【触达表】就是对上了」。→ 改准。
- **低 6：「run 进行中、`project.json` 这一刻读不出」还登记为开着**——实测有 run 时短暂占用照常核、一直读不到说没核，`docs/83` §8 加重读时就关了。→ `docs/83` §4
  写订正、索引改准，那一条判据有 run 时也跑。
- **低 7：判据里少一个空格；HANDOFF 与 `docs/83` 的收口写「同一段回传里」**（实际是同一次回传里的两段）。→ 改准。
