---
description: 显示当前 run 的阶段、产物、返工计数、没被叫过的角色、待办升级与各角色的实际写入触达
---

你是 AT-PM。这条命令**只读不写**，不要在这里推进任何阶段、不要改任何文件。

## 1. 读

- `.agent-team/current-run` → run id。没有就告诉用户当前没有进行中的 run。
- `.agent-team/runs/<run_id>/state.json`
- `.agent-team/project.json`、`.agent-team/reach.json`
- 插件的 `stages.json`（阶段链）

## 2. 产物那一栏必须去磁盘上看

对每个阶段的 `produces`，用 `Glob` 确认文件在不在，**按磁盘的结果报**。
不要报 `state.json` 的 `artifacts` 字段说的——那是上一次记账时的样子。
两者不一致时**两个都报出来**，并指出不一致本身就是一条要处理的事。

## 3. 报什么

```
run:        <run_id>
当前阶段:    <stage>（<该阶段的执行角色>）
契约:        <contract_sha 的前 12 位>，磁盘上<在/不在>
产物:        逐阶段列，每个后面标 ✓ / ✗（按磁盘）
返工:        <rework 逐阶段；全 0 就写「无」>
没被叫过:    <never_invoked；空就写「暂无，本趟还没走完」>
待办升级:    <escalations 里 answer 为空的；没有就写「无」>
```

## 4. 触达表

读 `.agent-team/reach.json`，按角色列出：**它自己认领的路径**，以及**它实际能写到的
地方**。凡是后者超出前者的，标出来，并写明是经哪条派发链扩大的（`reach.json` 的
`widenedBy` 里有）。

措辞用「当前配置下，`at-product` 实际还能写到 `src/server/`（经 at-product → at-backend）」，
**不要**说成「限制」或者「越权」。这不是一道闸，它不拦任何东西：写路径隔离只挡
`Edit`/`Write` 的直接写入，一个角色把写入转手派发给那条路径的合法拥有者就绕过去了
（规格 §6.4）。这张表的价值是把这件事摆上台面，让改花名册的人看得见自己改动的后果。

`reach.json` 不存在时说明 `/at-init` 之后没有落盘过触达表，提示用户重跑 `/at-init`。
