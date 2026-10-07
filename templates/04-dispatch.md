# 04 派发裁决 —— PM 对 S3 对齐结果（`03-alignment.md`）的决断

> run id：<run_id>
> 阶段：S4（执行者 at-pm）
> 前置：`01-prd.md`、`03-arch.md`

## 1. 本趟班底

<按需组队。列出这趟真正要叫的角色，以及**每个没被叫的角色为什么不叫**
（不在这里写 state.json 的 never_invoked：它收口时才算，见 /agent-team:at 第 6 节）。防的是某个角色（例如安全架构师）
整个项目从未被调用、且无人发现。

⚠️ 被裁掉的角色里，凡是**某一段的产出角色**，还有另一处要写：它在**被裁的那一段**就该
写进 state.json 的 trimmed（谁、在哪一段），那一份是给判据读的。这一节写的是**理由**
——trimmed 不收理由，同一份知识不留两处。两个字段答的也不是同一个问题：trimmed 是当段
写下的决定，never_invoked 是收口时算出来的结果。>

## 2. 分工

| 角色 | 要做什么 | 完成定义 | 产物 |
|---|---|---|---|

## 3. 裁决与理由

<S3 对齐（`03-alignment.md` 的未决问题）里出现的分歧，PM 在这里定。PM 自决的范围：技术选型、班底裁剪、
驳回路由、代码风格与目录命名、同一段里重派一个角色（不计返工）。S5 里被拒之后改写到别处或不做的决定、认领者不在班底里时
二选一的那个决定，也追加在这里（用户在 contract-conflict 里定的，注明对应第 4 节哪一条）。>

## 4. 没有自决、已升级给用户的

<必须问用户的那几类。每条对应 state.json 的 escalations[] 里一条，kind 用同一个取值：
sensitive / contract-conflict / tradeoff / contract-hole / budget-exhausted / env-blocked。>

## 5. 这一趟对 paths 的改动

<照 03-arch.md 的「落盘清单」往 .agent-team/project.json 的 paths 里补了哪些前缀、补在谁名下；S5 里补的也追加在这里。
照【project.json】或拒绝理由删掉、改掉了哪些条目、为什么（S1 里改的，写这份文件时补记）。收尾时告诉用户——补的前缀留给以后各趟。
没改就写「无」。>

## 6. 代码基线

<写这份文件时项目代码的样子：走过 S5 之后要回到 S5 之前时，拿它对照这一趟（自基线以来）改了什么。在项目根跑，只用不改工作树、
暂存内容与历史的 git 命令：`git rev-parse --show-toplevel` 报错的，写「不是 git 仓库」；`git rev-parse --verify -q HEAD` 的输出
（没有输出的写「还没有提交」）；`git --no-optional-locks -c core.quotepath=off status --porcelain -uall -- .` 里 `.agent-team/` 之外的
条目（没有就写「干净」）。不 add、不 commit、不打 tag、不 stash：这些会改仓库，要跑先照 /agent-team:at 第 4 节的 sensitive 问用户。
返工轮回到 S4 重写这份文件时，这一节照抄上一次记的，不重记；上一次没有这一节的（更早建的 run、漏记了），写「没记」，不补记——走过 S5 之后
补记的，会把这一趟的改动当成基线。>
