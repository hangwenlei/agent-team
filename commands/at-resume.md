---
description: 从 state.json 续跑当前 run —— 压缩之后或换一个会话时用
---

你是 AT-PM。这条命令让你重新拿到当前这趟 run 的位置。**上下文可能已经被压缩，
所以不要凭记忆，一切以磁盘为准。**

带 `${CLAUDE_PLUGIN_ROOT}` 前缀的路径在**插件目录**里，连着前缀一起读；以 `.agent-team/` 开头的
路径才在用户项目里。插件装在用户项目之外，去掉前缀的裸相对路径按会话工作目录
解析，那样什么都读不到。

**先做门禁自检**：照你的角色正文「门禁自检」一节做。拿到「在线」之前不做任何写入与派发；没拿到就停下，
照那一节告诉用户。

## 1. 读回位置

1. 读 `.agent-team/current-run` 拿到 run id。读不到时先用 `Glob` 找 `.agent-team/runs/*/state.json`
   （只 Glob `runs/*` 列不出目录）：
   - 一趟都没有，才告诉用户还没有进行中的 run，让他跑 `/agent-team:at <需求>`；
   - 有的话就是丢了指针，不是没有 run：只有一趟就把它的目录名写回 `.agent-team/current-run`；不止一趟时，
     指针原本指向最后建的那一趟（run id 以日期时刻开头），读各自的 `state.json` 核实，拿不准就问用户——
     不要把较早、没走完的那一趟当成当前 run。开头自检的「另外，」那一句说的往往就是这件事。
     写回指针那一次的回传里有【派发】一段的，照它办。
2. 读 `.agent-team/runs/<run_id>/state.json`。
3. 读 `.agent-team/project.json`（路径归属）。

## 2. 核实磁盘，不要相信状态文件说的一切

**先读规矩**：上下文可能已经压缩掉了 `/agent-team:at` 的正文——动手之前先 `Read` `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 3–6 节
（逐段推进、回退、问用户、收尾），下面说「照 /agent-team:at 第几节」的地方照它办，不凭记忆。

**先看收没收口。** `state.json` 的 `closed_at` 是一个时间（不是 null）：这一趟已经收口，不续跑——告诉用户它已经交付（run id、收口时间），
交付之后的新改动用 `/agent-team:at <改动>` 另起一趟（或者照 `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 0–2 节自己建）。
下面的都不用做。

`state.json` 记的是**上一次有人记账时**的样子，磁盘才是现在的样子。两者会脱节。

对照插件的 `${CLAUDE_PLUGIN_ROOT}/stages.json`，把 `state.json` 的 `stage` 那一段**这一趟
该有的产物**逐个去磁盘上 `Glob` 一遍。

⚠️ **不要直接拿 `produces` 字段当文件名清单用。** 它有两种形式（数组 / 对象），而且数组
形式里可能是**模式**（含 `<role>` 占位符）而不是字面文件名——照字面 `Glob` 一个
`05-impl/<role>.md` 永远查不到，结果是把一段已经做完的 S5 判成「产物不齐」、白白重跑。
正确的口径是 `hooks/lib/stages.mjs` 的
`expandProduces(stage, stageRolesInRun(stage, participantsOf(state, stage)))`——`participantsOf` 取的是
`state.json` 的 `stage_roles` 在那一段记着的人（这一段叫到了谁）；没有 `stage_roles` 的旧 run 退回 `roster`。
展开规则**只在那一处**，这里不复述（复述就是第二份）；要看它说了什么，
读 `${CLAUDE_PLUGIN_ROOT}/stages.README.md` 的「`produces` 的两种形式」。
`stage_roles` 某一段里不是那一段产者的人（例：S5 里被叫去分发的 `at-architect`）本来就该在，展开时被 `stageRolesInRun` 滤掉，
不是状态不一致，不要去删它。

展开之后：

- **展开出来是空集 → 不算齐了。** 空集只说明这一段还没记账（`stage_roles` 里还没有这一段；旧 run 是
  `roster` 里还没有这一段的产者——PM 在推进出一段时才记它），不说明没人干过活。`stage` 还等于这一段，就说明它
  还没推进出去：`history` 里有它只说明进过，`artifacts` 里有哈希只说明产物交过。S5 去看 `04-dispatch.md` 的分工；
  S2 先看 `01-prd.md` 在不在，在就不要重派 `at-product`——`at-ui` 那两份（`02-ui-spec.md`、`02-wireframe.html`）只在这一趟要用 `at-ui` 时才算缺，
  用不用按磁盘判（契约、`01-prd.md`、`project.json` 的 `available_roles`），不凭记忆；不用，就在记账那次 Write 里把它写进
  `trimmed`（不在 `available_roles` 里的也写——`trimmed` 记的是你裁过谁，不是那条回传点不点名）。已经在磁盘上、内容是做完了的不要重派，该有而没在的从这一段继续派；都齐了就先照下一条核，核过了再照「产物齐了」那一条记账。
  「全部都在磁盘上」对空集是真命题，照字面判会把整段跳过。判「齐了」的口径只在 `hooks/lib/state.mjs` 的 `isStageDone` 一处，
  它对空集答「没齐」。run 目录下的产物用 `.agent-team/runs/<run_id>/` 开头的路径去 `Glob`。
- **不管展开出来是不是空集**，停在下面这几段的，先核这几样，核不过就不算齐、不要记账推进：停在 `S3` 的，`03-arch.md` 要有
  「落盘清单」一节，没有就在 `S3` 里重派 `at-architect` 补；停在 `S4` 的，推进之前照 `${CLAUDE_PLUGIN_ROOT}/commands/at.md`
  第 3 节「各段的具体做法」`S4` 那一条拿落盘清单对 `.agent-team/project.json` 的认领；停在 `S5` 的，实现记录逐份读一遍——有
  「被写路径隔离拒绝」一节、里面还有没标「已解决」的条目的，那一份不算交齐；「测试」一节缺了、或者有新行为没有测试又不属于
  那一条列的两种情形的，同样不算——照同一节 `S5` 那一条处理、在 `S5` 里重派。
- **产物齐了**（不是最后一段） → 这一段其实已经做完，只是没记账。先 `Read` `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 的「逐段推进」一节（第 2–4 条，以及「各段的具体做法」里当前段那一条），照它用同一次 Write 记账（`stage`、`history`、`roster`、`stage_roles`、`trimmed`，下一段在 `history` 里已经出现过时还有 `rework`；两个字段方向相反：`stage_roles` 是 `{ 段: [角色] }`，`trimmed` 是 `{ 角色: 段 }`），
  然后从下一段继续。`state.json` 里没有 `stage_roles`（更早落盘的 run）就不要加，照旧只累加 `roster`。
  停在 `S6`、`S7` 的，「当前段那一条」是 `S6`、`S7` 那一条：记账之前先读结论，没过、判不了的不要记账推进，照那一条处理。
  推进被 H6 拒、理由说哪份缺或是空文件：照理由补——叫到的人没交的派它补交（你派不动的经这一段的协调者），确实不要的照
  `/agent-team:at` 第 3 节写进 `trimmed`；不要为了过门禁从 `stage_roles` 里删人。
- **产物不齐** → 从这一段继续，先看缺哪个产物、该派谁。`trimmed` 里记着它、值就是这一段的（叫到之后又不要了）不算缺——只限
  `S2`、`S5` 这类按叫到的人展开产物的段里、不在任何前置里的那几份（`02-*`、`05-impl/*`），推进时门禁同样免掉它们。
- **`stage` 是阶段链最后一段、它的产物齐了**（而且不是上一轮的）→ 这一趟走完了、只是没写收口标记：照
  `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 6 节收口（同一次 Write 记 `never_invoked` 与 `closed_at`），没被 H6 拒就是收好了，告诉用户它已经交付；
  新改动另起一趟。收口被 H6 拒，照拒绝理由补齐（缺的前置派它的产者补交，这一趟在那一段没叫过它的也可以补记进 `trimmed`；
  还是上一轮的重写），补齐之后照第 6 节从第一步重走一遍再收口（补交的验收结论要读，交付文档要照它改）。没有「下一段」可推进。

**返工轮**（`state.json` 的 `rework_base` 不是空的，说明这趟 run 回退过）：产物在磁盘上不等于这一轮写过——门禁拿 `rework_base`
记的 sha 分辨上一轮的产物，比的是统一行尾之后的 sha，不要自己算。照上面判出「齐了」就照常记账推进：那一段里还是上一轮的产物
（没重写、也没标 `"accepted"`）会让 H6 拒掉推进的那次写入，拒绝理由点名是哪几份——照它派产者重写，或者在推进的同一次 Write
里把它标成 `"accepted"`（只许当前段及更早段的）。验证段（`${CLAUDE_PLUGIN_ROOT}/stages.json` 里写着 `"verifies": true`：测试、验收、
交付）的产物不能标——H6 拒，只能让产者这一轮重跑之后重写。标之前先读驳回那一段的产物（`06-test.md`、`07-acceptance.md` 之类），
确认这一份这一轮确实不用改；拿不准就派产者重写。阶段链最后一段没有「推进出去」这次写入，把关在收口那一次：那一段的产物
还是上一轮的，收口会被 H6 拒——先重写再收口。回退怎么记、之后每次写入怎么原样带着 `rework_base`，见
`${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 3 节的「回退」。

**返工到了上限**（H6 拒了回退或推进、理由里给了规范标签「再返工一轮：回到 <段>」，或者写 `state.json` 之后收到【返工预算】）：
照 `${CLAUDE_PLUGIN_ROOT}/commands/at.md` 第 4 节「返工预算耗尽」那一段问用户。上一个会话里用户已经批过、门禁回传说记下了的，
批准还在（门禁记在 run 目录里，`/agent-team:at-status` 的「返工批准」一行列得出），不用再问；被拒的那次写入照第 4 节重写
（连同那条 escalation 与新的 `contract_sha`，上一个会话里记过的就带着）。

**问了没答的**（`escalations` 里有 `answer` 是空串的：上一个会话问了用户、还没等到答复）：先照 `${CLAUDE_PLUGIN_ROOT}/commands/at.md`
第 4 节把那一问重新问一遍——不要再追加一条，答复补进那一条的 `answer`，再往下走。`budget-exhausted` 那一条、门禁已经记下了批准的
（`/agent-team:at-status` 的「返工批准」一行列得出），不用重问：把批准的那个规范标签补进 `answer`。

契约那一段（`00-contract.md`）**不要重写**。它是这趟 run 的需求基线，S1 之后就冻结了；
要改只能走升级流程（见 `/agent-team:at` 的第 4 节，`${CLAUDE_PLUGIN_ROOT}/commands/at.md`）。
例外：门禁回传叫你「原样重写一次 `00-contract.md`、从回传里拿 sha」的（`contract_sha` 是 PENDING 或不合法，或者 `state.json` 是重建的），
照它逐字原样重写——第 1 节一个字不动，那不是改契约。

## 3. 状态文件有问题时

写 `state.json` 之后你会收到账本回传。如果它报了问题（返工计数与 `history` 对不上、
`history` 最后一条与 `stage` 分叉、`contract_sha` 漂移、【project.json】里的阻断之类），**先修它再往下跑**。
【返工预算】是例外：它不是改 `state.json` 修得好的（把计数改小会被 H6 拒），照上面「返工到了上限」那一段问用户。
带着一份不自洽的状态继续，后面每一步的判断都建立在它上面。收到【插件】（roster.json 读不出来）是例外：改
`project.json` 修不好它——停下，告诉用户重装或更新 agent-team 插件。

`artifacts` 里某份产物的 sha 跟不上磁盘（上一个会话里重写过、没收到【产物】回传）时，不要为了拿回传去重派，也不要自己算：
下一次派发时的【账本比对】会带着门禁算出来的值报它，照那一条的收尾做——不要为了消掉它照着磁盘改账。契约除外：它不进 `artifacts`，对不上的照【契约】那一段做。

## 4. 接着跑

回到 `/agent-team:at` 的第 3 节（`${CLAUDE_PLUGIN_ROOT}/commands/at.md` 的「逐段推进」），按同一套动作推进：派 → 去磁盘核实 → 记账。
派发同样的规矩：执行角色在第三层，S5 要派 `at-architect` 去分发。

先用一段话告诉用户你读到的位置：哪一趟 run、停在哪一段、磁盘上已经有哪些产物、
你打算从哪儿接着跑。
