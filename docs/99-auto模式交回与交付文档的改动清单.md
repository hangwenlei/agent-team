# auto 模式的交回与交付文档的改动清单

> 2026-10-16，分支 `claude/handback-probe-465253`。`docs/98` 的探针撞见：auto 权限模式下子代理的最终报告改走 `SubagentHandback` 工具交回。门禁认冒泡、
> 记停下行读的是 SubagentStop 输入里的 `last_assistant_message`，父级一侧读完成通知的 `<result>`；交回走工具之后这些字段装的是什么，没人量过（`docs/98` §2.3、§6）。
> 用户在桌面端用的正是 auto 模式。本轮照用户批准的方案：先量，坏了再修；同一个 PR 里顺带做「S8 交付文档列出这一趟改了哪些文件」。

## 0. 一句话结论

- **改之前，门禁在 auto 模式下不认交回的冒泡**（§2）：交回之后那一回 SubagentStop 没有 `last_assistant_message`、`stop_hook_active` 为假，任何字段都不带报告原文；
  H5b 照缺产物拦了，平台把这一拦丢掉（调试日志原文 `Stop hook block discarded (turn ended by tool result, no model re-invoke)`），派发记录却记成 `block`。
  项目经理直接派的子代理，交回结束的那一次完成通知只进转录、不触发 UserPromptSubmit，完成核验根本没跑；协调者那一场完成核验跑了，`<result>` 里没有报告，
  把执行角色的冒泡说成「多半是平台的续跑上限到了」。manual 对照照旧。没撞上 `flagged`、`withheld`。
- **改之后认**（§3、§5）：H5b 那一道判定挪到交回之前（PreToolUse:SubagentHandback，拒了交回就没发生、子代理照常往下跑）；交回送达时记停下行，
  H5b 认出交回之后的那一回停下、不拦（只认这一回）；完成核验认项目经理收到的交回消息。改后实测：第一次交回被拒，`at-qa` 照理由再交回一次被放行，
  项目经理在交回消息到达那一刻就收到交付物核验（那一次与 manual 那场逐字相同；复核之后交回消息的冒泡不再引理由，§3.3、§9）。
- **交付文档**（§3.6）：`/agent-team:at` 收口第三步加「这一趟改了哪些文件」，照代码基线、与「回退」同一套只读 git 命令列；收口时告诉用户在哪，
  收不收进版本库由用户自己做。

## 1. 起因

- `docs/98` §2.3：auto 那一场两层子代理的系统提醒都写着最后的报告要经 `SubagentHandback` 交、之后写的普通文字送不到上级；manual 那一场没有这个工具。
- 门禁读报告原文的地方三处：H5b 的冒泡出口（`isBubbleStop` 读 `last_assistant_message`）、H5b 的停下行（`r.ok` 那一支也按它记 `bubble` 或 `pass`）、
  父级一侧（后台完成时完成核验读 `<task-notification>` 的 `<result>`，前台派发跑完时 H5a 读 `tool_response.content`）。

## 2. 实测

### 2.1 做法

照 `docs/98` §2.1：CLI 2.1.301，`claude --bg --plugin-dir <本工作树>`，工作目录是本工作树下的临时子目录，`--settings` 带 `worktree.bgIsolation: "none"`、
`env` 里 `AGENT_TEAM_GATE_TRACE=1`，各带一份 `--debug-file`。另加两样：`claudeMdExcludes` 排除本仓库与上一层的 `CLAUDE.md`（不然探针里的每个角色都读一遍维护者的
HANDOFF，`docs/98` 那两场就是这样）；一个只记录不表态的钩子，把 SubagentStart、SubagentStop、UserPromptSubmit 与 `Agent`、`SubagentHandback` 两个工具的
PreToolUse、PostToolUse 的原始输入追加进探针目录外的一个文件（stdout 一个字不写、永远 exit 0）——门禁的留痕只有检查项名与退出码，不带输入。

每个目录造一份最小的 `.agent-team`，按真实顺序写：`project.json` → `current-run` → `runs/<id>/state.json`（`contract_sha` 照门禁的算法、`artifacts` 记齐、
`stage_roles` 记到当前段之前）→ 各段产物；门禁专属文件一份都不造。起会话之前拿门禁本身模拟一遍要发生的派发（H1、H2），都放行；`state.json` 过 `validateState`。
给项目经理的话：只派一次、派发提示原文一字不改、等通知、原样抄出收到的东西。派发提示叫角色不读不写、直接结束，最后报告第一行写「冒泡：探针：…」，
「报告怎么交、交到哪，照你所在环境的系统提醒做；被门禁拦回来的，照拦截理由做」。

| 场 | 会话 | 权限 | 段与派发 |
|---|---|---|---|
| A | `64657363` | `--permission-mode auto` | S6，项目经理直接派 `at-qa` |
| B | `cec37ae2` | `--permission-mode manual`，`--allowedTools` 放行 Read、Glob、Grep、Write、Edit、Bash、Agent | 同 A |
| C | `29a569da` | auto | S5，项目经理派 `at-architect`，它派 `at-backend` |
| D（改后） | `4ecf3289` | auto | 同 A |

### 2.2 结果

| 项 | 结论 | 证据 |
|---|---|---|
| (a) SubagentStop 输入里装的是什么 | 交回之后那一回（A 的 `at-qa`、C 的 `at-backend`）：键是 `session_id`、`transcript_path`、`cwd`、`scratchpad_dir`、`prompt_id`、`permission_mode`（`"auto"`）、`agent_id`、`agent_type`、`effort`、`hook_event_name`、`stop_hook_active`（`false`）、`agent_transcript_path`、`background_tasks`（列着它自己、`running`）、`session_crons`——**没有 `last_assistant_message`，也没有别的字段带着报告**。源码：这个字段是「停下之前最后一条助手消息里的文字块」，交回那一条只有工具调用，没有文字就不带这个键。报告原文只出现在三处：`SubagentHandback` 的 PreToolUse、PostToolUse 输入（`tool_input.message`）、收件人那一侧的交回消息、子代理自己的转录。B：两回停下都带 `last_assistant_message`，就是报告原文 | 抓取钩子的原始输入；CLI 源码里拼 SubagentStop 输入那一段 |
| (b) H5b 认不认这次冒泡 | **不认**。A：SubagentStop 只来一回，H5b 照缺 `06-test.md` exit 2，平台丢掉这一拦，`at-qa` 的转录止于交回的工具结果（`finished: true`）；派发记录是一行 `dispatch`、一行 `stop` / `block`，再没有别的。C 的 `at-backend` 同样一行 `block`；`at-architect` 三回停下都是 `pass`（S5 里它不是产者）。B：`block` 之后第二回带冒泡、`stop_hook_active` 为真，记 `bubble`——与 `docs/37` 一样 | 调试日志 `Stop hook block discarded (turn ended by tool result, no model re-invoke)`；三场的 `dispatches.jsonl`；子代理转录 |
| (c) 项目经理收到了什么 | A：先收到一条 `isMeta` 的 user 消息（`origin.kind: "peer"`、`handback: true`），触发 UserPromptSubmit，`prompt` 是 `<agent-message from="<agent_id>">`、一行顶格的框（`[Subagent hand-back] The text below is the final report of a subagent …`）、缩进两格的报告、`</agent-message>`；完成核验不认它，没出声。6.8 秒后完成通知到了，带 `queueTranscriptOnly: true`：只进转录，不触发 UserPromptSubmit、不开新的一轮——**完成核验一次都没跑**。它的 `<result>` 是「This agent's report was delivered to you as a message from "<agent_id>" (its SubagentHandback call). Read it there; it is not repeated here.」，XML 里没有 handback 之类的字段。C：项目经理收到 `at-architect` 的交回消息，之后一条完成通知照常触发了 UserPromptSubmit（`<result>` 同样只说已经交回），完成核验报进度，把 `at-backend` 那一行说成「门禁最后一回拦了它，它却结束了（多半是平台的续跑上限到了）」——**成因说错了**。B：完成通知 `<result>` 就是报告原文，完成核验说它冒泡了、引出理由 | 抓取的 UserPromptSubmit 输入；项目经理的转录（附件 `hook_additional_context`、通知那一行的 `queueTranscriptOnly`） |
| (d) 协调者交回之后再写的文字 | **送不到**。C 里 `at-architect` 派完 `at-backend`，先以普通文字停下（「at-backend 已派出，还在运行…」，没交回；它派出去的人还在跑，项目经理那边什么通知都没收到）；`at-backend` 的交回送到它手里，它醒来把报告原文交回给项目经理；之后它又被唤醒一回（`at-backend` 的完成通知），写的「报告原文已经交给派我的人，这边没有别的要做」没有送到项目经理，项目经理那条通知的 `<result>` 指的仍是先前那次交回。对照 `docs/98` 的 A：那一场 `at-architect` 派完就交回了一句进度，`at-ui` 的结论到它手里时写成普通文字，项目经理一直没拿到 | 抓取的输入（`SubagentStart` 三次、两次 `SubagentHandback`）；项目经理的转录 |
| (e) `flagged`、`withheld` | **没撞上**。四场里每一次交回都照常送达，没有 SECURITY WARNING；没有子代理不交回就结束。没有为它们另造场景 | 抓取的输入；转录 |

### 2.3 源码里的几件事（CLI 2.1.301）

- 交回只在权限模式是 auto、而且一个开关开着时启用（环境变量 `CLAUDE_CODE_SENDMESSAGE_HANDBACK`，没设时取服务端的默认，现在是开）；manual 下没有这个工具。
- 一次运行只交一份；空报告拒；调用结束这一次运行。报告作为一条消息送到派它的人：每一行缩进两格，框那一行顶格，框之上可以有一段同样缩进的注记。
- auto 模式对交回的审查：判为拦的不扣下，照常送达、框之上加一段「SECURITY WARNING: auto mode blocked this subagent's report. Reason: …」（`flagged`）；
  审查请求被安全过滤拒掉的，同样送达、加一段「…UNREVIEWED…」；审查跑不了的照常送达，框之上同样加一段说审查没跑成的注记（不标 `flagged`，算 `send`）。
  `withheld` 是什么都没送到。
- 子代理没调用交回就以文字结束：平台在收尾处补一句「[handback-send-enforce] Your report has not been delivered. Call SubagentHandback(…) now」，最多 3 次；
  始终不交回的，上级收到的是「The subagent ended without delivering a report through SubagentHandback, so no report was delivered. Its unsent text is not shown.」。

### 2.4 收尾

四场都 `claude stop`、`claude rm`，`~/.claude.json` 里没有这几个临时目录的条目；临时目录删掉（最后一个在会话退出之后才删得掉）；按起会话之前的进程基线核过，
没有残留（多出来的一个 Chrome 渲染进程是用户自己的浏览器扩展，命令行里没有 `ms-playwright`）。转录、调试日志、抓到的原始输入与四份派发记录留在维护者的
临时目录里，是证据。

## 3. 裁定与修法

### 3.1 拦在交回之前

交回结束这一次运行，之后的拦截平台一律丢掉——SubagentStop 上无论读到什么都拦不回来，修读法不够。能拦的只剩交回本身：PreToolUse:SubagentHandback
的拒绝让这次交回没有发生（D 实测：拒绝以 `is_error` 的工具结果回到子代理手里，它照常往下跑），工具输入里就是报告原文。

新检查项 `handback`（PreToolUse，matcher `^SubagentHandback$`，与 H5b 一样 fail open）照 H5b 同一个判定：`decideDeliverable` 的缺、空、还旧，或者验证段的结论第一行读不出
（`verdictStopReason`）；认冒泡用同一个 `isBubbleStop`，「最后一条回复」就是交回的报告，「已经被拦过一回」按派发记录里它有没有拦截行认（PreToolUse 输入里没有
`stop_hook_active`）。拒的那一回与 H5b 拦的一样记 `block`；拒绝理由是 H5b 那一份，末尾接一句 `HANDBACK_DENIED`（上面的「最后一条回复」「停下」在交回时指什么、
被拦的交回没有送出去、照做之后再交回一次）。放行不记——交回还可能没送达。拦截行记不下的（认不出 `agent_id`、派发记录写不进），
下一回认不出「拦过一回」，带冒泡的交回会一直被拒、冒泡的出口走不通：那一回带着冒泡的就放行、留痕（H5b 的「拦过一回」是平台给的，不受写盘影响；复核补的）。

### 3.2 送达时记停下行，H5b 认出交回结束

新检查项 `handback-sent`（PostToolUse，matcher `^SubagentHandback$`）：工具结果 `success` 为真时记一行停下，报告第一行是冒泡标记记 `bubble`，不是记 `pass`，
都带 `via: "handback"`。H5b 见到这个子代理在派发记录里最后一条停下行带着它，就知道这一回停下是交回结束的：不拦，照那一行的结果再记一行、不带 `via`
（`completion.mjs` 的 `endedByHandback`）——只认交回之后的这一回，它之后被唤醒（用户续上它、它自己的后台子代理完成）再停下照常判（安全审查报的，§9）。

不在 PreToolUse 放行时记：放行不等于送达（别的 hook 还能拒，平台还有几种「Nothing was sent」）。不靠 `prompt_id` 对：它是主会话那一轮的编号、不分子代理——
A 里交回那一刻还是派它的那一轮，接着那一回停下已经换成交回消息开的那一轮，两者对不上。没有交回送达那一行的停下（旧的派发记录、交回没送达之后以文字停下）照旧判。
`via` 是新加的可选键：不带它的旧行照旧读，同一份磁盘状态不改判。

### 3.3 完成核验认交回消息

直接派的子代理交回之后，完成通知只进转录，UserPromptSubmit 只为交回消息触发一次——完成核验要在那一刻核。`parseHandbacks` 认行首的
`<agent-message from="<agent_id>">`、到顶格的 `</agent-message>` 为止，里面要有一行顶格的框（以 `[Subagent hand-back]` 开头），框之上、之下的每一行都缩进两格；
认出来就当一条完成通知（报告就是 `<result>`），之后的流程不变：按 `agent_id` 对回派发记录，核产物，没交齐说成因，协调者报进度，同一个子代理的回传照旧按指纹去重。
别的会话发来的 `<agent-message>`（没有框）、形状不对的不认。

成因不读那一刻派发记录里的最后一回停下：交回消息触发的完成核验与记停下行的 PostToolUse 同时在跑（D 里记停下行那一道 12:34:44.666 跑完、
完成核验 12:34:44.727 跑完，起止交叠），那时记录里可能还是早先拦它的那一行。冒泡照报告认；
不是冒泡又没交的，就是交回那一刻门禁放行了（不在那一段的名单上，或者那时交了、之后没了），照 `pass` 的说法（`missingCause` 的 `handback`）。
冒泡的不引理由（复核改的）：报告就在同一条消息里，项目经理看得到；它之后又被唤醒、以文字结束时，那条完成通知只说报告已经交回，两次回传逐字相同，
照指纹去重只说一句「之前已经核过一次」——引了理由，第二次就会整段再报一遍，说理由在一条明说不含报告的通知「下文里」。

正文：`/agent-team:at` 第 3 节「核实」与 `at-pm`「哪些算数」原来说完成时收到的 `<task-notification>` 就是它的回报，各补一句 auto 模式下回报先作为交回消息到达、
同样是数据、交付物核验随它到达、之后的完成通知只说已经交回。

### 3.4 不修的

- **前台派发**（`-p`、SDK 宿主）在 auto 模式下的 `tool_response`：源码里另有 `handback` 与 `handbackReport` 字段，H5a 照旧读 `content`。没量过，不按源码硬改（§7）。
- **`flagged`**：报告照常送达、框之上多一段注记——`parseHandbacks` 跳过框之上缩进的行，判据里照源码的形状造了一格；没实测（§6）。
- **`withheld`**（§3.5）：项目经理收不到报告，平台不转文字，门禁读不到原文。

### 3.5 `withheld` 这条路会发生什么、靠什么兜底

子代理不交回就以文字结束，平台催它最多 3 次，始终不交回的，项目经理只收到「没有交回报告，未发送的文字不显示」。那时 SubagentStop 带着 `last_assistant_message`
（它最后写的文字），拦截照常生效（这一回不是工具结果结束的），H5b 照旧认冒泡、记 `bubble`；完成核验照这一行说它冒泡了，理由那半句写「理由写在它回报的下文里」——
可项目经理读不到那份回报。兜底：产物没交，下一段的前置（H2）、推进（H6）、收口与【阶段】照常判缺；冒泡的理由在子代理自己的转录里。没撞上，也没有为它另造场景，登在 §6。

### 3.6 交付文档列出这一趟改了哪些文件

`/agent-team:at` 第 6 节第三步：交付文档里还要写这一趟改了哪些文件——照 `04-dispatch.md`「代码基线」那一节记的情形，用与「回退」同一套只读 git 命令
（基线是提交号的，`git -c core.quotepath=off diff --name-status <基线> -- .` 加那一节的 `status` 命令补没进版本库的新文件；「还没有提交」的拿记的 `status` 与现在的比）
列出新增、修改、删除；`.agent-team/` 与 `.playwright-mcp/` 下的不列；基线那时已经有改动的路径单列一组（这一趟又改没改，diff 分不出）；单子是自基线以来的，
用户自己的改动也在里面、照实写明；基线写着「不是 git 仓库」或「没记」的，写明对不了账，改照各份实现记录列；只跑这几条只读命令。第五步：告诉用户这份清单
在交付文档的哪一节；收不收进版本库、怎么收由用户自己做——不列提交、丢弃这类选项，项目经理照旧不跑动工作树或历史的 git 命令（红线不变）。门禁不读这一节（正文守）。

## 4. 修法与判据

- `hooks/lib/checks.mjs`：加 `handback`（PreToolUse，`SubagentHandback`）、`handback-sent`（PostToolUse，`SubagentHandback`），都 fail open；`fail-open.mjs` 的
  `GATE_NAME` 两项都叫「交付物核验」。`hooks/hooks.json` 注册两条（statusMessage「校验交回…」「记录交回…」）；`docs/00-现行参考.md` 的判读表跟上。
- `hooks/gate.mjs`：H5 共用段接上两道新检查项（同一个角色解析、运行上下文、按 `agent_id` 认别的一趟、记停下行）；`handback` 照 3.1 拒或放；`handback-sent` 照 3.2 记；
  H5b 先问 `endedByHandback`；别的一趟派出去的照旧不按这一趟核，送达记回那一趟（`dispatchLogAt`）。完成核验的通知并上 `parseHandbacks`。
- `hooks/lib/completion.mjs`：`stopLine` 可选 `via`；`readDispatchLog` 多记每个子代理最后一条停下行；`endedByHandback`、`HANDBACK_FRAME`、`parseHandbacks`；`missingCause` 加 `handback`。
  头部注释补 2.1.301 的平台事实。`hooks/lib/deliverable.mjs`：`HANDBACK_DENIED`。`hooks/` 下没有用到晚于 `MIN_NODE` 的内建，`boot.mjs` 没动。
- 正文：`commands/at.md` 第 3 节「核实」与第 6 节第三、五步，`agents/at-pm.md`「哪些算数」。
- 判据：新文件 `tests/gate-handback.test.mjs`，夹具照抓到的键造（交回前后两个 PreToolUse、PostToolUse，交回结束那一回没有 `last_assistant_message` 的 SubagentStop，
  manual 那种带文字的 SubagentStop，带框的交回消息）：拒、拦过一回之后放行、送达记 `bubble`/`pass`、接着那一回停下不另记、没送达不记且之后照 H5b 判、旧形状照旧、
  新形状停下而没有送达那一行（上一版的派发记录）照旧拦、首行核验、完成核验认交回消息（冒泡、交了、不认识的、不是冒泡又没交）、协调者进度、`parseHandbacks`
  认与不认的几种（含伪造的框与收尾、CRLF、框之上的注记与它没缩进的一行）、不带 `via` 的旧行照旧读、别的一趟派出去的（交回前不按这一趟拒、送达记回那一趟、
没送达不记、带冒泡记 `bubble`、停下不另记）、交回消息与之后那条只说已经交回的完成通知按指纹去重、拦截行记不下时带冒泡的放行、带项目经理身份的交回不归它管、
不在当前段的角色与不是团队角色的子代理交回放行且不记、交回之后那一回停下只跳一次（被唤醒之后再停下照常判）。`tests/trusted-echo.test.mjs` 加一格：交回消息里报告第一行冒泡的理由读到了、不回显（锚点认「理由写在它回报的下文里」那一句）。`tests/advance-completion-prose.test.mjs` 钉正文那两句，`tests/code-baseline-prose.test.mjs`
  钉交付文档那一段与第五步，并核第三步只用 `diff`、`status`。按检查项表派生的几份（`boot`、`gate-trace` 的矩阵与判读表、`fail-open` 的叫法）补两道新检查项。
- 变异验证（逐刀备份在仓库外、跑完逐字还原）三十一刀都红在该红的那份上：交回前不拒、当作已拦过、送达记录不带 `via`、没送达也记、H5b 不认交回结束、完成核验不认交回消息、
  拒绝理由不接那一句、成因不认交回、不核缩进、不折 CRLF、交回结束不看 `via`、停下行永远带 `via`、交付文档不排除截图目录、用了会改仓库的 git、基线时已有的改动不单列、
  收口给提交菜单、「核实」与 `at-pm` 各删一句、不注册交回前那一道、别的一趟交回前照这一趟判、别的一趟停下照记、别的一趟送达不带 `via`；复核之后补的七刀：带项目经理身份不短路、别的一趟送达恒记 `pass`、
别的一趟没送达也记、框之上不核缩进、不在这一段也拒、拦截行记不下照拒、交回消息照引理由；安全审查之后补的两刀：交回之后那一回不记（一直跳过）、别的一趟停下恒记 `pass`。

## 5. 改完之后的实测（D）

同 A 的做法、同一份派发提示，`probe-99-v6`，会话 `4ecf3289`：

- `at-qa` 第一次交回（报告第一行是冒泡）：门禁拒，派发记录一行 `block`；它收到的工具结果是 `is_error`，原文「PreToolUse:SubagentHandback hook error: at-qa 在 S6 应当产出
  06-test.md，但 06-test.md 还没有写到磁盘上。…（这一次交回被门禁拦下了，报告没有送出去。…照上面做完，再交回一次。）」。
- 两秒后它把同一份报告再交回一次：门禁放行，送达，派发记录一行 `bubble`、`via: "handback"`；接着那一回 SubagentStop 门禁 exit 0、不另记，调试日志里没有 `discarded`。
- 项目经理在交回消息到达那一刻收到「⚠️ 交付物校验：at-qa 在 S6 冒泡了："探针：这一次不跑测试"。它这一段该交的没交齐：06-test.md 还没有。…」——这一段的指纹与
  B（manual）那一场派发记录里的 `told` 行逐字相同。之后的完成通知照旧 `queueTranscriptOnly`。这是复核之前的版本：复核之后交回消息的冒泡不再引理由
  （§3.3），这一句变成「冒泡了（理由写在它回报的下文里）」，只在判据里核过，没再起会话。

协调者那一场（C）改后没重跑：执行角色交回冒泡之后协调者返回时的进度那一行只在判据里核过（§7）。

## 6. 仍然开着的边界

- **`withheld` 那条路项目经理读不到报告**：完成核验说它冒泡了、理由写在回报里，回报却没送到；兜底是产物照常判缺、子代理的转录（§3.5）。
- **`flagged` 照源码的形状认**：框之上缩进的注记跳过；没实测过。
- **交回消息靠 CLI 的框那一行认**：CLI 改了那一行的开头或缩进规矩，完成核验认不出交回消息，退回到只认完成通知——auto 下直接派的那一类又没人核；判据钉得住夹具，钉不住平台。
- **交回过的子代理又被唤醒之后再交回**（用户续上它，或者它自己派出去的后台子代理完成时把它唤醒——C 场的 `at-architect` 交回之后就被唤醒过一次）：
  那一次运行的停下 H5b 照常判；交回之前那一道把上一次运行的拦截行也算成「拦过一回」，第一回带冒泡就放行（平台也只许一次运行交一份，再交回送不出去）。
- **派发记录 Bash 写得进**：持 Bash 的角色伪造一行交回送达，能让 H5b 跳过一回停下；伪造拦截行，能让带冒泡的交回第一回就放行。与子代理自己写「冒泡：」
  换来的放行同级——H5 是流程辅助、不做安全边界，产物照旧由下一段的前置、推进、收口判缺（有意；同一个用户、持 Bash 的子代理面前，签名用的密钥与转录都藏不住）。
- **协调者在它派出去的人停下之前就交回**（`docs/98` 的 A 见过）：之后的结论到不了项目经理；协调者正文没改，项目经理靠磁盘、【阶段】、推进时的 H6 兜底。
- **交付文档的改动清单门禁不读**：只靠正文；单子是自基线以来的，用户自己的改动混在里面，正文要求照实写明。

## 7. 没量到的

- `-p`、SDK 宿主下 auto 模式的前台派发：`tool_response` 里交回的报告在哪个字段（源码有 `handbackReport`），H5a 认不认冒泡。
- 桌面端会话里交回消息、只进转录的完成通知怎么显示：只量了 `--bg`。
- `flagged`、`withheld` 两种：没撞上，没为它们另造场景。
- 改后的协调者那一场：执行角色交回冒泡、协调者再交回，项目经理收到的进度那一行。
- macOS、Linux。

## 8. 版本

挪中间一位到 7.4.0（`hooks/`、`commands/`、`agents/` 是插件会加载的）。

## 9. 复核

派一个子代理对抗复核（只读，对着四场的原始输入、调试日志、派发记录、转录与 2.1.301 的源码核，跑了八份单文件判据）。改了这些：

- 交回之前那一道的冒泡出口靠拦截行写盘成功：写不成（或者认不出 `agent_id`）时下一回认不出「拦过一回」，冒泡出口永远走不通——改成拦截行记不下时带冒泡的放行、
  留痕（`appendDispatchLog` 回报写没写成），补判据（派发记录换成目录让写入失败）。
- §6 那一条写的「只有用户手动续得上」与 C 场自己的证据对不上：交回过的子代理会被它自己的后台子代理的完成通知唤醒——先改了措辞；
  安全审查之后改成被唤醒之后的停下 H5b 照常判（见下）。
- 交回消息带引号的理由与之后那条只说「已经交回」的完成通知回传指纹不同，会整段再报一次——改成交回消息不引理由（§3.3），补去重的判据；回显判据那一格改成读到了、不回显。
- 判据缺口五处（带项目经理身份的短路、别的一趟带冒泡与没送达、框之上没缩进、不在当前段与不是团队角色的交回）都补了，变异各一刀，都红。
- §2.3「审查跑不了的照常送达」漏了框之上那段注记；§3.3 原来引 A 场说「同一毫秒」，A 场那时还没有记停下行的那一道，改引 D 场的交叠。
- `/agent-team:at` 第三步「还没有提交」那一支：没有提交时基线里已有的文件都是 `??`，比得出的只有新加、删掉，原文照「修改」与「从 diff 里分不出来」写不通——单写一句，
  已有的文件一句话说明、不逐个列，中途有了第一次提交的照实写比不准。

提交、推送之后，`security-guidance` 插件的自动安全审查报了两条（同一处代码）：

- **过期标记让 H5b 一直失效**：成立，与上面第二条是同一个缺口——见到最后一条停下行是交回送达记的就跳过，对之后的每一回停下都生效。改成只跳过交回之后的那一回：
  跳过时照那一行的结果再记一行（不带 `via`），被唤醒之后再停下照常判；补判据（唤醒之后的停下照常拦）与两刀变异。它建议的另一条路「停下的输入里没有
  `last_assistant_message` 才跳过」没采用：交回那一条助手消息里同时写了文字时（模型在调用工具之前常写一句），那一回停下照样带这个键，拦了照样被丢掉，还会误记成拦。
- **派发记录可以伪造**：这份文件 Edit/Write 写不进、Bash 写得进，是早已登记的限制；伪造一行换来跳过一回停下，与子代理自己写「冒泡：」换来的放行同级，
  产物照旧由下一段的前置、推进、收口判缺。它建议的签名、核对转录，在同一个用户、持 Bash 的子代理面前都藏不住（转录也写得进）。没改代码，登进 §6。
