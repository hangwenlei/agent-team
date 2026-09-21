---
description: 显示当前 run 的阶段、产物、返工计数、主动裁掉的角色、没被叫过的角色、待办升级与各角色的实际写入触达
---

你是 AT-PM。这条命令**只读不写**，不要在这里推进任何阶段、不要改任何文件。

带 `${CLAUDE_PLUGIN_ROOT}` 前缀的路径在**插件目录**里，连着前缀一起读；以 `.agent-team/` 开头的
路径才在用户项目里。插件装在用户项目之外，去掉前缀的裸相对路径按会话工作目录
解析，那样什么都读不到。

## 1. 读

- `.agent-team/current-run` → run id。没有就告诉用户当前没有进行中的 run。
- `.agent-team/runs/<run_id>/state.json`
- `.agent-team/project.json`、`.agent-team/reach.json`
- 插件的 `${CLAUDE_PLUGIN_ROOT}/stages.json`（阶段链）

## 2. 产物那一栏必须去磁盘上看

对每个阶段**这一趟该有的产物**，用 `Glob` 确认文件在不在，**按磁盘的结果报**。
不要报 `state.json` 的 `artifacts` 字段说的——那是上一次记账时的样子。
两者不一致时**两个都报出来**，并指出不一致本身就是一条要处理的事。

⚠️ **不要直接拿 `produces` 字段当文件名清单用。** 它有两种形式（数组 / 对象），而且数组
形式里可能是**模式**（含 `<role>` 占位符）而不是字面文件名——照字面 `Glob` 会对着一个
永远不存在的名字报 ✗。正确的口径是 `hooks/lib/stages.mjs` 的
`expandProduces(stage, stageRolesInRun(stage, roster))`——`roster` 取 `state.json` 里这一趟
派了谁。展开规则**只在那一处**，这里不复述；要看它说了什么，读
`${CLAUDE_PLUGIN_ROOT}/stages.README.md` 的「`produces` 的两种形式」。

## 3. 报什么

```
run:        <run_id>
当前阶段:    <stage>（<该阶段的执行角色>）
契约:        <contract_sha 的前 12 位>，磁盘上<在/不在>
产物:        逐阶段列，每个后面标 ✓ / ✗（按磁盘）
返工:        <rework 逐阶段；全 0 就写「无」>
主动裁掉:    <trimmed 逐条「<角色> @ <它被裁掉的那一段>」；空就写「无」>
没被叫过:    <never_invoked；在「主动裁掉」里出现过的，后面标「（已声明裁剪）」；空就写「暂无，本趟还没走完」>
待办升级:    <escalations 里 answer 为空的；没有就写「无」>
```

⚠️ **「主动裁掉」与「没被叫过」不是一回事，别合成一行报。** `state.json` 的 `trimmed`
是**当段写下的决定**（PM 按需组队，明说这一趟不用它），`never_invoked` 是**收口时算出来的结果**
（可用班底减去这一趟叫到的人）。一个被裁掉的角色最后两边都会有它——所以「没被叫过」
那一行要把它标出来：**剩下没被标的，才是「没人注意到」的那一种**，而那正是规格 §4.2 ④
要防的。读不到 `trimmed`（M3a 之前落盘的 run 没有这个字段）就把「主动裁掉」写成
「这一趟没有记录」，不要写「无」——**「没裁过」和「没记过」是两件事。**

## 4. 触达表

读 `.agent-team/reach.json`，按角色列出：**它自己认领的路径**，以及**它实际能写到的
地方**。凡是后者超出前者的，标出来，并写明是经哪条派发链扩大的（`reach.json` 的
`widenedBy` 里有）。

措辞用「当前配置下，`at-product` 实际还能写到 `docs/ui/`（经 at-product → at-ui）」，
**不要**说成「限制」或者「越权」。**这不是一道闸，它不拦任何东西：写路径隔离只挡**
`Edit`/`Write` 的直接写入，一个角色把写入转手派发给那条路径的合法拥有者就绕过去了
（规格 §6.4）。这张表的价值是把这件事摆上台面，让改花名册的人看得见自己改动的后果。

（上面那个例子是拿 `computeReach` 对当前的花名册
（`${CLAUDE_PLUGIN_ROOT}/roster.json`）与 `${CLAUDE_PLUGIN_ROOT}/templates/project.json`
真算出来的，不是编的。上一版举的是「`at-product` → `at-backend` 写到 `src/server/`」——
M2b Task 3 把那条边删了，那个例子在当前配置下不可能发生。命令运行时读 `reach.json` 取真值，
所以样例错了不会真的输出假话，但它会把措辞往一个不存在的场景上带。）

`reach.json` 不存在时说明 `/agent-team:at-init` 之后没有落盘过触达表，提示用户重跑 `/agent-team:at-init`。
