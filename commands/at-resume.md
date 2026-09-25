---
description: 从 state.json 续跑当前 run —— 压缩之后或换一个会话时用
---

你是 AT-PM。这条命令让你重新拿到当前这趟 run 的位置。**上下文可能已经被压缩，
所以不要凭记忆，一切以磁盘为准。**

带 `${CLAUDE_PLUGIN_ROOT}` 前缀的路径在**插件目录**里，连着前缀一起读；以 `.agent-team/` 开头的
路径才在用户项目里。插件装在用户项目之外，去掉前缀的裸相对路径按会话工作目录
解析，那样什么都读不到。

## 1. 读回位置

1. 读 `.agent-team/current-run` 拿到 run id。读不到就告诉用户还没有进行中的 run，
   让他跑 `/agent-team:at <需求>`。
2. 读 `.agent-team/runs/<run_id>/state.json`。
3. 读 `.agent-team/project.json`（路径归属）。

## 2. 核实磁盘，不要相信状态文件说的一切

`state.json` 记的是**上一次有人记账时**的样子，磁盘才是现在的样子。两者会脱节。

对照插件的 `${CLAUDE_PLUGIN_ROOT}/stages.json`，把 `state.json` 的 `stage` 那一段**这一趟
该有的产物**逐个去磁盘上 `Glob` 一遍。

⚠️ **不要直接拿 `produces` 字段当文件名清单用。** 它有两种形式（数组 / 对象），而且数组
形式里可能是**模式**（含 `<role>` 占位符）而不是字面文件名——照字面 `Glob` 一个
`05-impl/<role>.md` 永远查不到，结果是把一段已经做完的 S5 判成「产物不齐」、白白重跑。
正确的口径是 `hooks/lib/stages.mjs` 的
`expandProduces(stage, stageRolesInRun(stage, roster))`——`roster` 取 `state.json` 里这一趟
派了谁。展开规则**只在那一处**，这里不复述（复述就是第二份）；要看它说了什么，
读 `${CLAUDE_PLUGIN_ROOT}/stages.README.md` 的「`produces` 的两种形式」。

展开之后：

- **展开出来是空集 → 不算齐了。** 空集说明这一段的产者这一趟还一个都没派（刚进 S2 或 S5
  时就是这样），从这一段继续派。「全部都在磁盘上」对空集是真命题，照字面判会把整段跳过。
  判「齐了」的口径只在 `hooks/lib/state.mjs` 的 `isStageDone` 一处，它对空集答「没齐」。
- **产物齐了** → 这一段其实已经做完，只是没记账。把 `stage` 推到下一段并往 `history`
  追加一条，然后从那一段继续。
- **产物不齐** → 从这一段继续，先看缺哪个产物、该派谁。

契约那一段（`00-contract.md`）**不要重写**。它是这趟 run 的需求基线，S1 之后就冻结了；
要改只能走升级流程（见 `/agent-team:at` 的第 4 节）。

## 3. 状态文件有问题时

写 `state.json` 之后你会收到账本回传。如果它报了问题（返工计数与 `history` 对不上、
`history` 最后一条与 `stage` 分叉、`contract_sha` 漂移之类），**先修它再往下跑**。
带着一份不自洽的状态继续，后面每一步的判断都建立在它上面。

## 4. 接着跑

回到 `/agent-team:at` 的第 3 节，按同一套动作推进：派 → 去磁盘核实 → 记账。
派发同样的规矩：执行角色在第三层，S5 要派 `at-architect` 去分发。

先用一段话告诉用户你读到的位置：哪一趟 run、停在哪一段、磁盘上已经有哪些产物、
你打算从哪儿接着跑。
