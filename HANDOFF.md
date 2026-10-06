<!-- sync:docs schema=2 -->
# HANDOFF

## 概览

agent-team：一个 Claude Code 插件，十角色软件开发 agent team。项目经理（`at-pm`）就是主会话，
沿阶段链 `S1`→`S8` 分层派发，执行顺序由 hook 门禁强制，业务验收独立成线。
已公开在 github.com/hangwenlei/agent-team，默认分支 `main`。

## 🚀 运行现状

- 形态：Claude Code 插件，零 npm 依赖，不部署任何服务、不监听任何端口；门禁要靠 Claude Code 启动时 PATH 上的 Node（下限是 `hooks/boot.mjs` 的 `MIN_NODE`）。
- 发布：**推 `main` 就是发布**。用户在自己的项目目录下经 `claude plugin marketplace add hangwenlei/agent-team --scope local`
  与 `claude plugin install agent-team@agent-team-marketplace --scope local` 安装。
- 当前版本以 `.claude-plugin/plugin.json` 的 `version` 为准，判据总数以 `node --test` 的实时输出为准 —— 这里不抄数字，写下来的数字会漂。
- 开发期加载不用装：`claude --plugin-dir <本仓库路径>`。

## 🔑 配置项清单

- `AGENT_TEAM_GATE_TRACE`（可选）：等于 `1` 时每道门禁每次 `exit 0` 往 stderr 留一行痕，默认关。
  `--bg` 会话必须经 `--settings` 的 `env` 传入，在 shell 里 export 传不到 hook（实测）。见 `docs/21-门禁留痕.md`。
- `CLAUDE_PLUGIN_ROOT`：由 CLI 注入，插件内部路径都从它解析，无需手动设置。
- 推送 GitHub 需要本机 `gh` 已登录；凭据在系统 keyring 里，不进仓库。

## 📁 重要文件

- `hooks/boot.mjs` — 门禁的进程入口（`hooks/hooks.json` 里每一道门禁注册的都是它）：先比 `process.versions.node` 与 `MIN_NODE`，太旧就不加载 `gate.mjs`；版本够就动态 import `gate.mjs`。两种失败都照 `checks.mjs` 的失败策略表收尾。
- `hooks/gate.mjs` — 门禁的判定主体，按 argv 分派检查项；`hooks/hooks.json` — 事件到检查项的注册，外加一条不走 node 的每轮自检提醒（UserPromptSubmit）。`hooks/lib/gate-check.mjs` — 门禁自检（协议在 `agents/at-pm.md` 的「门禁自检」一节）。
- `hooks/lib/` — 判定用的纯函数（`runctx.mjs` 读运行上下文、`trace.mjs` 门禁留痕、`retry-budget.mjs` 那份重试上限说明的单一真源等）。
- `agents/` — 各角色正文；`commands/` — 四条 `/agent-team:*` 命令。
- `stages.json` 阶段链；`roster.json` 花名册（派发白名单）；`templates/` 新 run 与 `project.json` 的模板；`settings.json` 把主会话钉成 `at-pm`。
- `docs/11-M1b-遗留与已知边界.md` — 已知边界登记簿；`docs/16-M2b-裁定记录.md` — 裁定记录与 §3 方法论语料。
- `docs/13`…`docs/44` — 带日期的实测记录；`docs/24` §5 是 2026-09-28 那次全量审查的冻结表（之后的现状写在它前面那串「更新」里，原文在它的附录）；
  `docs/39` 是 2026-10-05 对照 v2.2.0 的逐条核验与排序，下一轮从 `docs/39` §5 挑。
- `tests/` — 全部判据；`.github/workflows/ci.yml` 在三个系统上跑它们，推 main / 向 main 提 PR 时再跑 `scripts/check-version-bump.mjs`；`.github/workflows/min-node.yml` 把门禁子进程换到 `MIN_NODE` 上跑全部判据，Linux 上再用真的 Node 12.17 / 12.22 确认 boot.mjs 大声拒绝。

## 🧠 长期决策与理由

- **零 npm 依赖，不建 `package.json`。** 运行时的前提只有 PATH 上的 Node。
- **`hooks/` 下的代码不用晚于 `MIN_NODE` 的内建；boot.mjs 还要能在 Node 12.17 上解析**（不用顶层 await、`?.`、`??`、
  `Object.hasOwn`，内建模块写 `'fs'` 不写 `'node:fs'`），好在旧 Node 上大声拒绝而不是静默放行。门禁子进程一律经
  `tests/helpers/gate-runner.mjs` 起（`tests/gate-runner.test.mjs` 钉着），最低版本作业才换得动它们。理由在 `docs/28`。
- **任何角色都不授予 `Skill` / `SendMessage` / `ListAgents`**（规格 §6.1）。frontmatter 的 `skills:` 键是另一回事，允许。插件自带的 skill 不得声明 `context: fork`。
- **`at-outsider` 永远不进任何角色的 `Agent(...)` 宇宙，也不进任何 `can_delegate_to`。**
- **发布纪律：每次推 `main` 都挪 `version`** —— 只碰散文 / `docs/` / `tests/` 挪最后一位，碰插件会加载的东西挪中间一位，任何一位不长到 `10`。
  理由：`claude plugin update` 比的是 `version` 字符串，不是 commit。CI 在推 main / 向 main 提 PR 时核它（`scripts/check-version-bump.mjs`，
  「插件会加载的」清单的单一真源是 `scripts/lib/version-bump.mjs` 的 `PLUGIN_LOADED`）。main 没开分支保护，所以那是**事后**告警：
  先推功能分支、等 CI 全绿，再合进 main 推送。
- **`docs/11` §1–§4 原文一字不改，只追加 §5.x；带日期的实测记录正文不改，订正与收口写在旁边 —— 而且写在原话的标题底下**，只在新一节里指称它的收口，扫标题的人读不到。
- **一条注释不是一条判据。** 要防的事配判据；写不出来就按 `docs/16` §3 开头那条付三样（拒绝的判据长什么样、它打不红的那一刀、什么会让答案改变）。
- **列举，不报总数**（`docs/16` §3.1）。失效条件写成可观测状态或归属规则，不写成要人去数的阈值。
- **找缺陷靠变异验证，不靠读代码**（`docs/16` §3）。
- **README 对外只写结论，不写过程。** 不写「某版本上实测」这类叙述、CLI 版本号和 `docs/` 编号引用；用户要知道的用法与风险照写，
  被 `tests/readme-sync.test.mjs` 钉着的那几条事实换成不带过程的说法保留。过程与证据留在 `docs/`。
  运行前提（Node 与 Claude Code 的最低版本）属于用法，照写，由判据钉着；不写的是「在某版本上实测过」这类过程。
- **`project.json` 的形状问题只让 H3 看**：不把形状错误判成读不出运行上下文（那会让 H2、H5、ledger 一起降级，一个键名
  拼错交付物校验就停摆）。同一条问题按读者出两种说法：给 PM 的带改法，拼进给执行角色拒绝理由的只说问题本身（出路是
  冒泡）——`hooks/lib/project.mjs` 的 `audience`。插件装坏单列【插件】，不混进【project.json】。理由在 `docs/29`。
- **门禁判不出来而放行时，话说给能动手的人**：PM 自己发起的派发（H5a）与写 run 目录下的文件（ledger）上回传【门禁】、给
  用户一行固定的 `systemMessage`；`PreToolUse` 上不发受信块（几道 hook 的回传被平台并成一段、不标来源），`SubagentStop` 上
  什么都不发（exit 0 带回传等于拦截）。输出形状只由 `hooks/lib/fail-open.mjs` 的 `hookOutput` 定，写 stdout 只经 `emitHookJson`
  与 `denyAndExit`；`tests/helpers/gate-runner.mjs` 对每一次门禁子进程核平台契约。修法按 runctx 的 `cause` 选、按命令分，
  新写一句修法要照着做一遍、看门禁放不放行。理由在 `docs/30`。
- **问「这一段」的消费方按段取参与者，账本比对与 H2 有意整趟**：`state.json` 的 `stage_roles`（`{ 段: [角色] }`）是 `roster`
  按段拆开、同一个「叫到」口径，PM 在推进出那一段的同一次 Write 里记；`isStageDone` 的每一处调用、产者交代、at-qa/at-status/at-resume
  经 `hooks/lib/stages.mjs` 的 `participantsOf` 取（有字段、没这一段的键 = 还没记账 = 空集；没有字段的旧 run 退回 `roster`）。
  `compareArtifacts` 与 `decideReadiness` 仍传整趟 `roster`：当前段记账之前按段取是空集，前者漏报漂移、后者提前放行。理由在 `docs/32`。
- **返工轮靠回退那一刻的快照认上一轮的产物**：`state.json` 的 `rework_base`（`{ 产物名: sha 或 "accepted" }`）由回退那一次写入照磁盘记，
  之后到下一次回退为止原样带着；磁盘内容与它记的 sha 相同就是上一轮的，交没交、齐没齐的判据（`gate.mjs` 里 `isStageDone`、`decideDeliverable`、
  `decideReadiness` 的每一处调用，`tests/freshness-call-site.test.mjs` 钉着）都经 `hooks/lib/freshness.mjs`。接受原样要显式标 `"accepted"`，
  不许删条目（删得掉就能悄悄丢掉一条）；推进把关放在 H6，不靠事后回传。不用 mtime 与 `history.at`。理由在 `docs/33`。
- **返工到上限之后的批准由门禁记，不由 PM 写**：用户经规范标签「再返工一轮：回到 <段>」批准（`AskUserQuestion` 单选，或者对话里单独发这一句），
  两个记录器（`approval-ask`、`approval-prompt`）只在那一刻真会越限时往 `runs/<id>/approvals.jsonl` 追加一行，`covers` 是越限的段；上限 = 3 + 覆盖那一段的
  批准条数，`hooks/lib/budget.mjs` 是标签、上限与预判的单一真源。H6 在回退那一次写入就预判；写入前已有的 `history` 条目段名不许改。不记回退的重做
  按交付快照（`delivered.json`，推进或回退之后由门禁拍）判「交过」：H2 只管叶子角色的重派，H3 只管非 PM 改早段自己的产物，协调者派发时不判
  （`hooks/lib/redo.mjs`）。两份都是门禁专属文件，H3 对任何人的 Edit/Write 都拒、排在主线程豁免之前。理由在 `docs/34`。
- **收口由门禁核、之后冻结；返工轮里验证段的产物一律重新出**：`state.json` 的 `closed_at`（模板初值 null）是收口标记，「收没收口」只问
  `hooks/lib/closing.mjs` 的 `closedAt`（只认 ISO 时间）。收口那一次 H6 核最后一段的前置与产物，已收口之后 `closed_at`、`stage`、`history` 的条数
  不许再改（排在返工预算之前、不依赖阶段链），H2 拒派一切团队角色；交付之后的新改动另起一趟。`stages.json` 里 `"verifies": true` 的段
  （S6、S7、S8）的产物不许在 `rework_base` 里标 `"accepted"`——H6 与每一处给出「标 accepted」出路的回传都经 `stages.mjs` 的
  `mayAcceptProduct`。不按「上游这一轮改过没有」判：标了 accepted 就抹掉了那份基线。只有空白的产物不算交了，收口、交付快照、「交过」、
  H5b、H2 的前置、【阶段】与 H3 的兄弟检查共用 `text-norm.mjs` 的 `isBlankText`（经 `freshness.mjs` 的 `isBlank` 进 `artifactCurrent`），
  只改一处，出路就互相打架。理由在 `docs/35`。
- **主线程的 `tools:` 只封顶派发宇宙与主会话自己的工具面，不封顶子代理的工具**：每个角色拿自己 `tools:` 里的工具（实测），禁授三样
  （`Skill`、`SendMessage`、`ListAgents`）靠每一份自己的 `tools:` 行（`tests/tool-surface.test.mjs` 的逐份判据与「每份都解得出工具名」那条前置）。
  `at-pm` 拿不到用户的 MCP 与网页工具，README 两半写着、双向判据钉着。验证段的产者（主会话除外）不持 `Edit`——摩擦，不是屏障。插件
  `settings.json` 的 `agent` 写全名 `agent-team:at-pm`（裸名会被项目或用户层同名的 `at-pm.md` 抢先当上主会话），`tests/plugin-name-sync.test.mjs`
  从 `PLUGIN_PREFIX` 派生。门禁按剥前缀的名字认 PM 不收紧。理由在 `docs/36`。
- **根级文件共列，不加 `shared` 键**：根级清单、构建配置、顶层测试目录列给每个会改它们的 S5 产者；S3 的「落盘清单」与 S4「照清单补 `paths`」
  是对齐的那一步（加了 `shared` 也省不掉，前缀按字面比、S0 时文件还不存在）。S5 被拒的在实现记录里留「被写路径隔离拒绝」一节、标「已解决」，
  PM、at-resume、at-qa 按它判交没交齐，执行段「齐了」时门禁提醒先读它（`IMPL_RECORD_NOTE`）。理由在 `docs/36`。
- **冒泡的出口由门禁认，不改「交没交」**：H5b 在子代理已经被拦过一回（`stop_hook_active`）、最后一条回复的第一行以「冒泡：」开头时放它停下
  （`hooks/lib/deliverable.mjs` 的 `isBubbleStop`，标记的单一真源是 `BUBBLE_MARK`）；这一段的产物照旧算没交：下一段的前置（H2）与收口照常判缺、
  【阶段】不说齐了，推进那一次 H6 拒（M4d，`docs/38`）。
  拒绝文案只许诺门禁认的出口（`BUBBLE_EXIT`）——一句给出路的文案，要先问门禁认不认它。`at-qa` 的没开跑是冒泡，不写 `06-test.md`。父级一侧
  （前台派发跑完时 H5a、后台完成时完成核验）读同一个标记（`bubbleReason`，M4d）。理由在 `docs/37`、`docs/38`。
- **契约的账只认 `contract_sha`**：账本比对不看契约（`compareArtifacts` 排除 `CONTRACT_FILE`）；派发返回（H5a）与 PM 写 `state.json` 时拿
  `contract_sha` 比磁盘，对不上出【契约】——不报磁盘上算出来的值、不说「改成与磁盘一致」（照着磁盘改账就把漂移洗成了合法），合法修订的新值
  只从写契约那一次的回传来。升级类别从 `ESCALATION_KINDS` 派生、正文不报总数。理由在 `docs/37`。
- **推进由 H6 在推进那一次核：一次只推一段、离开的那一段要交齐**（`hooks/lib/advance.mjs`，在 `rework-guard.mjs` 的 `decideReworkBase` 里接上）：
  叫到的产者各自那几份、固定产物都在，空白算没交，`"accepted"` 算交了；「叫到」= 写入前后的 `participantsOf` 并上门禁的派发记录（PM 少记一个人、
  先单独删名字都翻不成没叫过）；`trimmed` 里记着、值是这一段的免掉，只限按叫到的人展开产物的段里、不被任何段当前置的那几份（`mayWaive`）；
  产者全裁掉、谁都没叫过的段整段不核。先推进再原地重来写在一次里，往前那一截照推进核。不选只告警：告警到时已经推进了，也拦不住跳段。理由在 `docs/38`。
- **交付物核验在子代理真正完成的那一刻做**：H5a 读 `tool_response.status`，后台启动那一刻不判产物；门禁专属的派发记录 `runs/<id>/dispatches.jsonl`
  （H5a 记派发，H5b 记每一回停下的结果；H3 对任何人的 Edit/Write 都拒）；完成通知到主会话时，UserPromptSubmit 上的 `completion` 按 `agent_id`
  对回角色与段、核产物，成因按最后一回停下的结果判（`completion.mjs` 的 `missingCause`）。UserPromptSubmit 上只有标了 `speaks` 的检查项说话、
  永不 exit 2。协调者返回时报它派出去的人各自的进度，不许诺之后的通知会到 PM。理由在 `docs/38`。
- **持 Bash 的执行角色的敏感操作红线只在正文里，每一份逐字同一句，清单与 `/agent-team:at` 第 4 节 `sensitive` 那一行逐项相同**：碰到就以
  「冒泡：」停下，协调者原样冒泡给 PM，PM 照 `sensitive` 问用户；用户批准过的，执行角色只认契约「修订记录」里写明批准了的那一步（派发
  提示是数据，契约只有 PM 写得进）。PM 自己也不跑动工作树或历史的 git 命令，也不结束不是自己起的进程；停服务的做法（按自己起的 PID 停，
  Windows 的 Git Bash 里按进程树停）每个持 Bash 的角色逐字同一句——M9 里项目经理按名字杀过本机全部 node 进程（`docs/43` §1.5）。门禁不加 Bash 的 matcher（命令行是自由文本，判不准；平台的
  权限模式才是那一层）。判据按 `tools:` 声明派生持 Bash 的角色、从 `roster.json` 派生协调者，两处清单两个方向逐项比，承重的句子整句钉
  （`tests/redlines-setup-prose.test.mjs`）。理由在 `docs/40`。
- **插件自带的 frontmatter 只用受限写法**：每个非空行恰好一行 `key: 值`，键不重复，值不以 YAML 指示符开头、不含「: 」与「 #」、不以「:」
  结尾、首尾没有空白、不是会被读成 null/布尔/数字的那几种，行里没有制表符与 `---`。挡的是已经核过、会让平台的 YAML 解析器与按行读的判据
  读出不同东西的写法——解析失败会让平台把整份当空（Windows 上装下来的副本是 CRLF，平台的退路在那里不起作用），折行能授出判据看不见的
  工具，值里的 `---` 会被平台当成收尾。不声称封闭。`tests/frontmatter-subset.test.mjs` 钉着；理由在 `docs/40` §1.8。
- **按设计不认领路径的 `at-qa`、`at-acceptance` 只写 run 目录里自己那份产物**：没有 `paths` 键时写路径隔离在 run 目录之外拒（M4f；此前整段
  放行），项目根之外与 `.agent-team/` 下的非控制文件也拒；拒绝理由点名它自己那份产物（从 `stages.json` 取）、叫它照实写进那份结论、
  不用为这个冒泡，不提怎么开口子；建了键的照键（`/agent-team:at-init` 禁止、账本报）。不受 `paths` 管的只剩项目经理与主线程——写路径隔离
  第 1 步、触达表的 `unrestricted` 与契约守卫是同一个函数（`hooks/lib/decide.mjs` 的 `exemptFromPaths`，`isContractWriter` 就是它）。
  正文那条判据同时核门禁行为（正文说拒，门禁就得真拒）。
  理由在 `docs/41`。
- **新行为的自动化测试归 S5 的产者写**：照落盘清单定的位置写，实现记录带「测试」一节，PM 推进出 S5 之前读；`at-qa` 核缺测试、判「不通过：
  缺测试」、不写不冒泡；缺测试的回退回 S5，验收因为缺测试判不了的也回 S5（S5、S6、S7 各一轮）。不写测试只认两种情形——这一次没有新行为；
  契约第 1 节用户原话或第 4 节修订记录里用户说了不要——产者、架构师、`at-qa`、`/agent-team:at` 逐字同一句；契约第 3 节是 PM 自己写的、架构方案
  是架构师写的，都不算（被验的一方不能单方面关掉它），别的理由由 PM 问用户。门禁不读内容。理由在 `docs/41`（§8 是复核）。
- **sha 一律用门禁给的值**：【产物】、账本比对的「没记」与「记账之后被改过」、`rework_base` 的拒绝理由都带门禁按磁盘算的值（先剥 BOM、
  折 CRLF），PM 照抄、不自己算、不照着磁盘改账；「没记」那一行注明门禁知道的写者（派发记录里谁在那一段被派出去过、项目经理自己的产物），
  收尾按注明的分开说，协调者转报下级的 sha。PM 写完 `reach.json`，门禁按当前 `project.json` 与花名册重算核对。产者交代并上门禁的派发记录：
  派发记录里有、`stage_roles` 没记的单列成「漏记」，看一眼磁盘之后补记。问用户之前先记一条 `answer` 为空串的 escalation，答复之后补上
  （正文与门禁的返工预算文字一个口径）；用户主动改需求不记 escalation，修订块标「用户主动提出」。理由在 `docs/42`（§8 是复核）。
- **整段裁掉与切走指针**：缺的前置是整段裁掉的那一段的产物时，H2 说清是整段裁掉、给两条路——回退到那一段补回来（照「回退」记；不记回退就派它
  补交，H5a 会说这次派发不该发生），或者把要它当前置的段也整段裁掉。「整段裁掉」在 H2、推进、收口三处同一个口径（`advance.mjs` 的
  `wholeStageTrimmed`），所以不在 `available_roles` 里的产者也要写进 `trimmed`。PM 写 `current-run` 时门禁列出别的、没收口的 run 里没停下的派发
  （【派发】，停下行按 `agent_id` 在所有 run 里认）；按 `agent_id` 把停下认回派它的那一趟照旧没做。理由在 `docs/43`。
- **项目经理只能是主会话、调用者认不出就拒**：H1 对 `agent_type` 在却不是非空字符串的拒；任何调用者派 `at-pm` 一律拒（花名册外的、裸名也拒）；
  受管辖的派发带非空 `name`（agent teams 的 teammate）拒，与 `isolation` 同形；项目经理被拒时说那个角色由谁派（从花名册现算）。认不出的调用者
  （`malformedCaller`）H1、H3 共用一个判断。主会话被设置里别的 agent 或启动时的 `--agent` 换掉时（实测：`agent_type` 是那个名字、没有 `agent_id`），
  自检与 H1、H3、H4 的拒绝理由末尾都说清身份与出路（`selfCheckIdentity`）；还没有 run 时 H3 对谁都放行，那是 at-init 自举的既有设计。`state.json`
  里的角色名写裸名，`validateState` 报带前缀的、`roster` ∩ `never_invoked`、项目经理进了 `roster`（只报、不拦）。理由在 `docs/44`。
- **外部值进模型读得到的文字（受信回传、拒绝理由、留痕），按值从哪来决定怎么引**：磁盘上谁都写得进的一律
  `quote`（一对双引号里）；调用方自己这次给的参数与由项目根拼出的路径用 `inline`；记录的 sha 用 `shaOrNote`；
  原样落盘的 JSON 用 `safeJson`；插件自己的名字原样。不按「值干不干净」判：一句祈使句不需要任何特殊字符。
  那张表与理由在 `docs/27` §2.1，判据是 `tests/trusted-echo.test.mjs`——新拼一个外部值，它的入口清单跟着补。

## ⚠️ 注意事项 / 坑

- **门禁的项目根不是 cwd**：从 cwd 往上找最近的 `.agent-team`（位于某个 `.agent-team` 目录里的不算），cwd 在启动项目（`CLAUDE_PROJECT_DIR`）里时不越过它（`hooks/lib/runctx.mjs` 的
  `projectRootFrom`，`docs/24` §2.1）。子进程测试的环境由 `tests/helpers/gate-runner.mjs` 的 `hermeticEnv` 剥掉 `CLAUDE_PROJECT_DIR` 与留痕开关；
  要测「变量生效」的用例自己加回来。
- **只在这台机器上成立的假设，CI 一跑就露**：macOS 的 `tmpdir()` 在 `/var` 软链接下，子进程 `process.cwd()` 给的是解析后的路径；
  GitHub 的 Windows runner 签出在 D 盘。夹具一律发 realpath，不写死盘符。产品侧同族的路径别名问题在 M3q 修了（`docs/25`）；还开着的边角登记在 `docs/25` §4。
- 用脚本往文件里写带 `\0` 之类转义的文字时，落盘后照样扫控制字节——这一轮就有一个真的 NUL 字节混进了注释。
- **写文件工具（Write / Edit）会把单反斜杠的 `\u2028` 这类转义换成真字符**：真字符进了正则字面量是语法错误，
  进了字符串就让判据测的是它自己。特殊字符一律用 `String.fromCharCode` 构造；写完扫一遍原始的行分隔符（`docs/27` §5）。
- **Bash 工具的 heredoc 会吃掉一半反斜杠**：带反斜杠的编辑脚本用写文件工具写，脚本里的反斜杠用 `String.fromCharCode(92)` 构造。
- **锚串替换不要用 `String.prototype.replace(a, b)`**：`b` 里的 `$'`、`$&` 会被展开成替换模式（`docs/26` §3 就这样把一段文档
  搅乱过）。用 `split(a).join(b)`，并断言命中次数。

- **换行符是混的**（`docs/11` §5.28）：索引统一 LF，`core.autocrlf=true` 让签出副本是 CRLF，被工具重写过的文件停在 LF。
  锚串替换要**断言命中数，并核对命中的是你要的那一处** —— 同一个实参有几处合法命中时，断言防不了砍错的那一刀。落盘后扫控制字节与行尾混用。
  扫行尾用 Node 或 `grep -U`：Git Bash 的 grep 不带 `-U` 看不见 CR，会报出假的「全是 LF」（`docs/39` §3）。
- **后台 agent 与主会话共用工作树时**，别 `git add -A` / `checkout` / `reset`；要并行就用隔离 worktree。
- `claude --resume` 不继承 `--plugin-dir`；local 安装下换了目录续会话，工具限制会整体掉光，而转录里看不出来。
- 后台探针用 `claude --bg`，不用 `-p`（`-p` 下异步派发会卡死——这是 CLI 2.1.276 上的实测，`docs/13` §5.1；2.1.286 上一个 `-p` 会话跑完过 5 次异步派发，`docs/33` §3；要靠 `-p` 之前先在当前版本上核；SDK 宿主（`-p --input-format stream-json`）的驱动要等后台子代理跑完再关输入——第一次 result 就关，子代理的权限请求会报 `AbortError: Stream closed`，会话等满 600 秒（`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`）后把它杀掉，`docs/35` §4 `efd26cb1`）。收尾对每个会话先 `claude stop` 再 `claude rm`：
  没 stop 过的会话在 `~/.claude.json` 里留着 `lastGracefulShutdown: false`，会一直挂在桌面应用侧边栏的「Other」下；
  `claude rm` 只删 `~/.claude/jobs/<id>/`，转录不动。
- 变异验证用 `cp` 备份与还原，不用 `git checkout` / `git restore`；备份放仓库外。
- 裸 `node --test`（仓库根，不带路径参数）；带路径参数会报出一个假的 `pass 0 / fail 1`。
- 仓库里不要建 `scratchpad/`：它不在 `.gitignore` 里，而 `node --test` 会递归收它下面的 `*.test.mjs`。
- **绝不 `claude plugin enable` / `disable`**：`enable` 接管正在跑的会话，`disable` 不把工具面还回来。
- **`agents/at-pm.md` 的 `model:` 不是摆设**：命令行里不带 `--model` 时，项目经理就跑在这一行写的模型上，删掉它会无声地
  掉回用户的默认模型；桌面应用起会话时总带 `--model`，所以在桌面端看不出来。见 `docs/11` §5.36 的订正。
- Git Bash 里设了 `MSYS_NO_PATHCONV=1` 之后，传给 node 的 `/c/...` 路径不再被转换，要写成 `C:/...`。
- 本机有一个同名的 `agent-team@skills-dir`（user 作用域、disabled，一条指向本工作树的软链）——不要碰；插件命令一律写全名 `<插件>@<市场>`。
- 子代理写不进 `.superpowers/`（harness 拒绝），它的报告正文要放进返回消息，由主会话落盘。
- `git merge -F -` 不读 stdin（只有 `git commit -F -` 读）；合并说明先写进仓库外的临时文件，再 `-F <文件>`。
- `README.md` 一份文件里中文在前、英文在后，以 `<a id="english"></a>` 那一行分界（已经没有 `README.zh-CN.md`）。
  改它之前先读 `tests/readme-sync.test.mjs` 各节的标题：两半的小节标题（含 `###`）要在 `HEADING_PAIRS` 里成对同序，
  `claude …` 命令行要中英镜像，阶段编号只准在同一行写全两个端点，「使用」一节要列全 `commands/` 下的命令，
  流程图的箭头数要等于阶段数——都有判据钉着。排版要按 GitHub 首页 README 栏的实际宽度看（1280 视口下 823px）：
  表格右列写太长，会把左列挤成好几行。本地预览可用 `gh api markdown -f mode=gfm -F text=@README.md`：警示块与 mermaid 都渲染得出，
  但它把段内换行当硬换行（README 页面不会），所以徽章要写在同一行。
- **SubagentStop 的平台事实**（CLI 2.1.286，`docs/37` §1.2）：`stop_hook_active` 被任何 SubagentStop hook 拦过一回之后，这次运行余下的每一回都为真，
  调工具也不清；续跑上限只数连续的拦截，两次停下之间调过工具就清零——交替调工具的子代理平台不封顶。SubagentStop 放行时递不出任何话给父级。
  探针插件没进仓库，平台升级后照 `docs/37` §1.2 的做法另搭一个重跑。
- **派发与完成通知的平台事实**（CLI 2.1.286，`docs/38` §1.3）：交互模式（终端、`--bg`）下 Agent 工具没有 `run_in_background`，一律后台；
  只有 `-p`、SDK 宿主能前台派（`PostToolUse` 在子代理跑完之后才到，`status` 是 `completed`）。完成通知每一条在主会话触发一次 UserPromptSubmit，
  `prompt` 就是那段 `<task-notification>` XML，同一个 task-id 会通知不止一次。嵌套派发的通知按模式路由：交互模式下孙代理的通知回到停车的协调者、
  `-p` 下协调者还在跑时也送给它——这两种情形主会话都只收到协调者那一条。子代理回报里出现指令形状的字样时，CLI 在最前面插一段 `[harness: …]` 注记。
- **拿内置浏览器验页面行为之前，先看面板显没显示**（`tabs_context` 会说）：面板隐藏时页面不渲染，`requestAnimationFrame`
  不跑，连 `window.scrollTo` 都不生效——点锚点「不动」、动画「不播」都会是假阴性。要么让面板显示，要么用 Playwright 无头浏览器测
  （它打不开 `file://`，本地页面要起 `python -m http.server` 再看；快照与截图只能写进仓库下的 `.playwright-mcp/`，测完删掉）。2026-09-27 就因此把一个能用的 `<a name>` 锚点误判成不能跳，多发了一版。

## ▶️ 常用命令

```sh
node --test
```

- 开发期加载：`claude --plugin-dir .`
- 打开门禁留痕：`claude --settings '{"env":{"AGENT_TEAM_GATE_TRACE":"1"}}'`
- 推 main 之前自查版本号：`node scripts/check-version-bump.mjs origin/main HEAD`
- 看 CI：`gh run list --branch <分支>`、`gh run view <id> --log-failed`
