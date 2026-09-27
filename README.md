# agent-team

简体中文 | [English](#english)

agent-team 是一支十角色软件开发 agent team：项目经理为主会话，分层派发任务，执行顺序由门禁强制，业务验收独立成线。一趟完整的 run 沿阶段链从 `S1` 走到 `S8`。

**状态：** 十角色，阶段链 `S1`–`S8`，真实环境完整跑通过两趟——**两趟完整的 run** 都只在 `--plugin-dir` 下实测过。两条安装路径后来各自单独实测过：从本地目录市场装（加载、`at-pm` 接管、命令与角色解析、每个可派发角色的工具面、六道门禁、续会话与卸载），以及从已发布的 GitHub 仓库装（同上，减去续会话）。

## 安装

本仓库已经发布在 github.com/hangwenlei/agent-team，仓库根带着一份 `.claude-plugin/marketplace.json`，里面声明的市场名叫 `agent-team-marketplace`——所以 CLI 可以直接从 GitHub 把它装上。两条命令都在你想让这支团队干活的那个项目目录下执行：

```sh
claude plugin marketplace add hangwenlei/agent-team --scope local
claude plugin install agent-team@agent-team-marketplace --scope local
```

CLI v2.1.278 上，在一个一次性探针工程里实测：市场走 HTTPS 克隆下来，安装回执写着 `scope: local`，在那个工程目录里跑 `claude plugin list` 看到的是 local 作用域、已启用。四条 `/agent-team:*` 命令全部展开得到，九个可派发角色解析得到、各自带着它们在 `agents/` 下声明的那几行 `tools:`，主会话被钉成 `at-pm`，而一次花名册之外的派发被逐字顶回，用的就是别的加载方式打的那同一段话。六道门禁这一轮量到三道；另外三道——写路径隔离、契约保护与停止门禁——要先有一趟进行中的 run 才有可拒的事，后来在同一种安装上摆好一趟 run 之后也逐道量到了真拒绝与真拦截，所以六道门禁现在都在 GitHub 安装下量过（`docs/19-远端安装路径实测.md`）。

**从 GitHub 装上的是一份冻住的副本，不是一条连回本仓库的活线。** 安装会定到一个 commit、记下它的哈希，再把一份脱离 git 的副本解到 `~/.claude/plugins/cache/` 下——而插件内部的每一条路径解析到的都是**那份副本**，既不是市场留下的那个克隆，也不是你的工作树。实测：那份副本与上游那个 commit 除了 CLI 自己加的一个标记文件之外逐字节一致，它自己不带任何 git 元数据，而加载起来的会话从头到尾没有引用过别的任何地方。**以本地目录为源的市场**把同样那几条路径解析到那个目录本身，所以你从哪种源装，决定的是插件真正在读什么。

**那份副本不会自己跟着本仓库走——而 `claude plugin update` 搬不搬得动它，取决于一个字符串。** 在一个实测期间**真的往前推过历史**的 git 远端上量的：什么都不做，副本一个字节不变；跑 `claude plugin marketplace update <市场>`，动的只有市场自己那个克隆，它走到新 commit 上去了，而**装好的那份副本原地不动**。承重的是 `claude plugin update <插件>@<市场> --scope local`：**它比的是插件清单里那个 `version` 字符串，不是 commit**——上游真的领先了一个 commit、克隆也已经站在那个 commit 上，这条命令打出来的是 `is already at the latest version (0.1.0)`，然后什么都不做。只有版本号变了它才动，而且是在旧目录**旁边**解出一个新版本目录，不是把旧的改写掉。已经在跑的东西还要再慢一格：一个横跨了一次成功更新的活会话，之后仍然展开旧版本的命令正文——与 CLI 自己打的 `Restart to apply changes.` 一致。这整条链后来在 GitHub 上的本仓库自己身上又跑了一遍：趁 `main` 还停在某个 commit 时装下一份，让仓库在这份副本原地不动的情况下往前推一个版本，再量更新。每一步的形状都一样，更新后那份副本与推上去的那棵树逐个文件相同——包括一个在旧的那一份里根本不存在的测试文件。

**本仓库在公开那一天推了三次，那个字符串一次都没动过，所以那三次里的修复谁也没收到——而 `claude plugin update` 还告诉他们已经是最新的。** 现在这件事有规矩了，不再靠运气：**每一次推 `main` 都会把清单里的 `version` 往上挪一格**，规矩本身写在下面的「开发」那一节里。所以 `claude plugin update <插件>@<市场> --scope local` 值得跑，而且通常真的有东西可取。**但它是一条规矩，不是一个机制——本仓库没有任何测试会因为有人忘了它而变红。** 不依赖任何人记性的那条路是重装一遍，在持有这份安装的那个项目目录下执行：

```sh
claude plugin uninstall agent-team@agent-team-marketplace --scope local
claude plugin install agent-team@agent-team-marketplace --scope local
```

对着 GitHub 上的本仓库实测：`install` 会**先**把市场克隆从远端刷新一遍，再把 cache 里那份副本**整个重写**——哪怕同一个版本号的目录已经躺在那里也照重写不误：往旧副本里加的一行没了，从旧副本里拿走的一份文件回来了，结果与一次全新安装逐个文件相同。**没有量到的是把这整条链连上游真的往前走一起跑一遍**；两半各自量过。

**另外两条实测过的路径都在本地。** `--plugin-dir` 指向你自己那份克隆，什么都不用装：

```sh
claude --plugin-dir /path/to/agent-team
```

或者把那份克隆本身声明成市场：`claude plugin marketplace add /path/to/agent-team --scope local`，再 `claude plugin install agent-team@agent-team-marketplace --scope local`，同样在项目目录下执行。两种装法插件都只被声明进这个项目的 `.claude/settings.local.json`，别处一个字不写——不需要 `claude plugin enable`，也不影响任何别的项目。CLI v2.1.278 上与一个 `--plugin-dir` 对照臂并排实测：接管、四条 `/agent-team:*` 命令、每个可派发角色的 `tools:` 行、六道门禁，两边完全一致。任何一种 `--scope local` 安装换来的都是斜杠命令真的能用、续会话不用带参数；代价是下面两段。

**`--scope local` 并没有把一切都关在项目里。** 安装同时会往 `~/.claude/plugins/` 下写全机器共享的条目，还会在 `~/.claude/plugins/cache/` 里留一份插件副本，而 `claude plugin uninstall` **不会**删掉它。`cache/` 下的东西只增不减：一次真的生效了的更新会多出一个新版本目录、旧的原封不动，而卸载两个都不删。于是在这台机器的任何目录下跑 `claude plugin list` 都会列出这个插件——只是在安装它的那个项目之外一律显示为 `disabled`，而**真正决定加载与否的是后者**。如果你机器上已经有另一个叫 `agent-team` 的插件，一切引用都要写成 `<插件>@<市场>` 的全限定名：卸载的回执只把裸名回给你，它不说自己卸的是哪一个。事后再用 `claude plugin marketplace remove <市场> --scope local` 把市场摘掉，它自己那个克隆确实会被清掉，全机器共享的那几个索引文件也逐行回到动手前的样子（两种安装来源各比对过一次）——但那份 cache 副本连这一步也活得下来，只能手工删。

**插件自带的 `settings.json` 里那个 `agent` 键会把主会话钉成 `at-pm`。** 这是设计如此——项目经理**就是**主会话——三种加载方式都实测确认过：会话转录里有一条 `agent-setting` 记录，值是 `"agentSetting":"agent-team:at-pm"`，CLI 的会话抬头也印着 `@agent-team:at-pm`。它的实际含义是：你刚起的这个会话不再是一个通用会话，而它同样不是一个窄会话。把它指向一个你在乎的项目之前，先读「已知边界」。

**续会话也要每次都带 `--plugin-dir`——`claude --resume` 不继承它。** CLI v2.1.276 实测：续一个由 `--plugin-dir` 起的会话而不带这个参数，CLI 会打印 `Continuing with the default tools and system prompt — the agent's tool restrictions no longer apply.`，插件的 `/agent-team:*` 命令随之全部解析不到，主会话回落到默认工具面。这个插件的全部隔离能力都压在角色的 `tools:` 声明上，所以一次忘带就把它们整体卸掉了。注意 `/agent-team:at-resume` 与 `claude --resume` 不是一回事：前者是插件命令，恢复的是 run 的**状态**；后者是 CLI 参数，恢复的是**会话**本身。

**按 local 作用域装上之后，同一种失效仍然存在，只是触发条件变了——在错的目录里续会话。** v2.1.278 上、以本地目录为源的那种装法实测：在持有这份安装的那个项目目录里续，一切照旧，而且**什么参数都不用带**；把同一个会话换到别的目录去续，CLI 会打印上面那同一句话，因为角色是按你**此刻**所在的工作目录解析的，不是按会话最初起在哪里。这里没有参数可忘，所以它比前一种更难察觉——而且去翻转录也救不了你：工具面已经掉光之后，转录仍然一条接一条地把这个会话记成 `at-pm`。

**用完就把会话结束掉，下一个会话不带 `--plugin-dir` 起，或者把它卸掉。** 不要去用 `claude plugin disable`——一个会话的工具面在它的生命周期内是固定的，而实测确认 `disable` **不会**把它还回来。`claude plugin enable` 是镜像的另一半问题：它会接管已经在跑的会话。本项目把这两条都给自己禁了，它拿到的每一份实测数据，要么是用 `--plugin-dir` 取的，要么是用 local 作用域安装取的。`claude plugin uninstall <插件>@<市场> --scope local` 实测过——GitHub 那条来源与本地目录那条各量了一次：那个目录下**下一个**新起的会话完全干净，没有接管、没有命令、没有角色，工具面也回到默认。但它对**已经在跑的**会话说明不了任何事，而那正是 `disable` 栽的那一处。

**下面这些没有量到——而且每一条都说清楚它是哪一种没量到。** 任何一种安装下跑一趟完整的 `S1`–`S8`：本项目那两趟端到端的 run 都是在 `--plugin-dir` 下取的，所以阶段链那些断言请当成关于那一条路径的断言。GitHub 安装下的续会话：只在以本地目录为源的那种装法下量过，这一轮没有重测。私有仓库：本仓库是公开的，市场是匿名走 HTTPS 克隆下来的，所以一份需要凭据的 fork 会怎么样，一次都没试过。重装那条方子也没有连着「上游真的往前走」跑完整条链，只有两半各自量过。**版本号往回退**、或者根本不是 semver 的版本号，同样没试。而一个活会话到底是把插件注册表缓在内存里、还是每次都去读一条并没有挪过的路径，这一条被放着没动：更新是在旁边新开目录的，旧目录还在，两种机制给出的可见答案一样。**这些都不是环境不允许，也不是这件事的结构上做不到；它们只是没做。** 最后一条是另一种：全部实测都取自后台（`--bg`）或 `-p` 会话，所以这里任何一条想从交互终端复核一遍，都需要一个人坐在键盘前。

## 使用

装好之后，在那个项目目录里起一个会话——这个会话就是项目经理——然后用下面四条命令：

- `/agent-team:at-init` —— **先跑它，每个项目一次。** 项目经理勘察这个项目的技术栈、目录布局、构建与测试命令，写出 `.agent-team/project.json`：每个角色能写哪些目录、这个项目用得上哪些角色、怎么构建和测试。写路径隔离就按这份文件判，所以 `/agent-team:at` 发现没有它会先停下，让你跑这一条。它还会写一份 `.agent-team/reach.json`，列出算上派发之后各角色实际能写到的地方。两份都读一遍；分工不对，就跟项目经理说，或者重跑这一条。
- `/agent-team:at <需求>` —— **起一趟 run。** 需求用你自己的话写，项目经理会把它逐字抄进契约 `00-contract.md`，之后每个角色的产出都对着这段原话验收。然后它沿阶段链从 `S1` 一路带到 `S8`，不用你逐段催。
- `/agent-team:at-status` —— **看进度。** 只读不写：当前在哪一段、每份产物在不在磁盘上、各段返工了几轮、主动裁掉了谁、谁一次都没被叫过、有没有在等你回答的问题，以及各角色实际能写到哪里。这条命令还没在一趟真实的 run 上跑过。
- `/agent-team:at-resume` —— **接着跑。** 上下文被压缩之后、或者换了一个会话时用：项目经理从磁盘上读回这一趟的位置，核实产物，再从断的地方继续。它和 CLI 的 `--resume` 参数不是一回事，见「安装」。

**一趟 run 里发生什么。** 项目经理先把需求冻结成契约，然后逐段派人：产品写需求文档（需要时再由产品派 UI 出界面规格和线框图），架构师出技术方案，项目经理自己定这一趟叫谁、怎么分工，架构师再把实现分给后端、前端等执行角色——同一段里的执行角色并行干活——之后是测试和业务验收，最后项目经理收口交付。实现那一段的角色项目经理派不动，要经架构师分发，越级的派发会被派发白名单拦下。谁能派谁以 `roster.json` 为准，每一段谁来做、交什么以 `stages.json` 为准（说明见 `stages.README.md`），这里都不复述。

**什么时候会来问你。** 项目经理是团队里唯一跟你说话的角色，而且只在五类事上停下来问：敏感操作（凭据或密钥、会产生费用、对外发送或发布、删除或覆盖不是这一趟产出的文件、`git push` 或改远端、动 CI/CD 与生产配置）；某个角色的产出和契约冲突，或者契约里的两条没法同时满足；两个方案都满足契约但不能兼得，而且差别你感受得到；需求本身自相矛盾或缺关键信息；返工次数用完了还不通过。问的时候会引契约原文，给 2–4 个具体选项和各自的后果，并写上它的推荐，不问开放式问题——在桌面应用里，这会显示成一张带选项的卡片。你的回答会作为修订追加进契约。契约不管的技术选型、裁掉哪些角色、驳回后交给谁返工、代码风格与目录命名，它自己定，不来问你。完整定义在 `commands/at.md` 第 4 节。

**东西落在哪。**

- `.agent-team/project.json`、`.agent-team/reach.json`：勘察结果，每一趟 run 都复用。
- `.agent-team/current-run`：当前这一趟的 run id。
- `.agent-team/runs/<run_id>/`：一趟 run 的全部产物——从契约 `00-contract.md` 开始，之后是各段的产物（实现那一段每个执行角色各交一份）——外加这一趟的账本 `state.json`。
- 代码本身写进 `project.json` 分给各角色的目录里。

想看每个角色具体在干什么，见下一节。

## 怎么看每个角色

在桌面应用里跑一趟时，项目经理就是你正在看的这个会话；其余角色是它派出去的**子代理**，一次派发在对话里只收成一行灰色小字（比如「Ran an agent, finished 6 background tasks」）。**要看每个角色，点那一行**：右侧会打开 Background tasks 面板，每个角色单独一条——包括架构师自己再派出去的下级——写着状态、用时、用量与工具调用次数。点某一条的 **View transcript**，就能看到那个角色的完整过程：交给它的任务原文、它读了哪些文件、改了什么、跑了什么命令、最后交回的报告。

同一段里的角色是**并行**的：实现那一段，后端与前端同时在跑，各占一条。整趟 run 仍然只是一个会话，在侧边栏上挂在你的项目下面，不会冒出一堆单独的会话。

另外两件值得知道的事。**角色能看，但不能直接对话**：只有项目经理跟你说话，角色有问题会报给它，由它来问你。**项目经理用的是你在应用里选的模型**，其余角色用它们定义里写的 `sonnet`——实测主会话跑在应用里选的模型上，角色跑在 Sonnet 上。以上都是在桌面应用里实测的，完整记录在 `docs/23-桌面端角色可见性实测.md`。命令行里有一处不同：不带 `--model` 时，项目经理跑在 `agents/at-pm.md` 写的 `sonnet` 上，带了就听 `--model` 的。桌面应用起会话时总会带上 `--model`，所以在那里是你选的模型说了算（实测，见 `docs/11` §5.36）。

## 已知边界

> 写路径隔离对 `Edit`/`Write`/`NotebookEdit` 是硬约束——但**只对在 `project.json` 里认领了路径的角色**。一个路径都不认领的那两个，`at-qa` 与 `at-acceptance`，整段跳过这道检查：在 run 目录之外它直接早退放行，于是它们可以把文件建到任何地方。而 `Bash` 根本没有任何 hook 看着：执行角色保留它是为了跑构建与测试，而 `Bash` 可以写文件（`echo >`、`sed -i`）。`at-qa` 两半都占。本插件不是沙箱。

> 加载本插件会把主会话交给 `at-pm`——而 `at-pm` 不是一个窄角色。它的工具面是 `Bash`、`Write`、`Edit`、`Read`、`Glob`、`AskUserQuestion` 以及 `Agent(...)` 那份派发白名单，所以一个被接管的会话能干一个普通会话能干的一切事，不分它此刻指着哪个项目。这个接管不是自限的：把它挡在目标项目之内的是角色正文，不是它的工具面。`--plugin-dir` 之下，波及面至少被限定在你自己用那个参数起的那些会话里。把插件按机器全局启用是另一回事——那会作用到**这台机器上此后开的每一个新会话，不分项目**，只要它保持启用状态——而本项目不那么做（见「安装」）。按 local 作用域安装落在两者之间，而且是实测过的——不论它的市场源是一个本地目录还是 GitHub 上的本仓库，波及面都限定在声明了它的那**一个项目目录**，卸载（`claude plugin uninstall <插件>@<市场> --scope local`）之后那个目录下新起的会话完全干净。

> 一道门禁判定放行、又没什么要说的那一次，默认在会话转录里**不留任何记录**——CLI 自己会把输出为空的那次成功运行过滤掉。所以一趟干净的 run 既证明不了门禁跑过，也证明不了它们没跑。要让每一次门禁调用都留一行，起会话时加 `--settings '{"env":{"AGENT_TEAM_GATE_TRACE":"1"}}'`（在 shell 里 export 这个变量，传不到 `--bg` 会话的 hook——实测）。之后每道门禁每次都写一行 `agent-team gate-trace check=<门禁> …`，CLI 会把它记进转录、标上那道门禁自己的状态文案；这一行不进模型上下文。默认关，关着时输出与此前逐字节相同。怎么数、怎么判读、它说不出什么，见 `docs/21-门禁留痕.md`。

> 门禁假定主会话是 `at-pm`——就是「安装」一节说的那个钉。你要是用 `--agent` 把它换成本插件的另一个角色，每道门禁都会把你的主会话当成那个角色来判，CLI 自己在后台起的那些分叉（进度摘要、提示建议）也一样，因为它们带的是主会话的身份：交付物门禁于是可能在那个角色的阶段没做完时拦下它们。最后这一半是读 CLI 源码得出的，没有实测。默认的钉之下，这些分叉是放行的——实测过，修前修后两趟都记在 `docs/22-内部分叉的身份.md`。

## 开发

**推 `main` 是本项目唯一的发布事件，所以每一次推 `main` 都要把 `.claude-plugin/plugin.json` 里的 `version` 往上挪一格。** 那个字符串是 `claude plugin update` 唯一会去比的东西——一次不动它的推送，对已经装好的人来说等于没发生，而 CLI 还会主动告诉他们「已经是最新版本」。这一次推送只碰了散文、`docs/` 或 `tests/`，挪最后一位；碰了插件真正会加载的任何东西——`agents/`、`commands/`、`hooks/`、`skills/`、`settings.json`、`stages.json`、`roster.json`、`templates/`，或者 `.claude-plugin/` 下那两份清单——挪中间那一位。**在有人把「CLI 到底怎么比两个版本串」量出来之前，不要让任何一位数长到 `10`**：`0.9.0` → `0.10.0` 如果按 semver 解析是往前走，按文本比较则是**往后退**，而这里量过的每一次递增都是两种读法一致的那种。**整套测试里没有任何一条钉着上面这些**，这是裁定，不是漏掉：最顺手的那条判据——把 `HEAD` 的版本号与「最近一次改那几个目录时的版本号」比——会在每一个正常工作日的全程都红着，而一条按设计就红着的判据，人会学会不看它。

跑测试一律用裸 `node --test`，从仓库根目录执行，不带任何路径参数。本机实测：`node --test tests/` **不会发现** `tests/` 下的测试文件，而是静默报一个 `pass 0 / fail 1` 的幻影失败，且无论被测代码是修好了还是还坏着，这个失败都一模一样——接手排查的人会去找一个根本不存在的 bug。

## 许可

MIT — 见 [LICENSE](./LICENSE)。

---

<a id="english"></a>

# agent-team

[简体中文](#agent-team) | English

agent-team is a ten-role software development agent team: the project manager runs as the main session, dispatches work through a layered role hierarchy, sequencing is enforced by gates, and business acceptance runs as an independent track. A full run walks the stage chain from `S1` to `S8`.

**Status:** a ten-role team on an `S1`–`S8` stage chain, run end to end twice on real infrastructure — both full runs were measured under `--plugin-dir` only. Both installed paths have since been measured on their own: from a local-directory marketplace (loading, the `at-pm` takeover, command and role resolution, every dispatchable role's tool surface, all six gates, resume and uninstall) and from the published GitHub repository (the same, less resume).

## Installation

This repository is published at github.com/hangwenlei/agent-team, and its root carries a `.claude-plugin/marketplace.json` declaring a marketplace named `agent-team-marketplace` — so the CLI can install it from GitHub directly. Run both commands from the project directory you want the team to work in:

```sh
claude plugin marketplace add hangwenlei/agent-team --scope local
claude plugin install agent-team@agent-team-marketplace --scope local
```

Measured on CLI v2.1.278, in a throwaway project directory: the marketplace clones over HTTPS, the install reports `scope: local`, and `claude plugin list` run inside that project shows the plugin at local scope and enabled. All four `/agent-team:*` commands expand, the nine dispatchable roles resolve carrying exactly the `tools:` lines they declare under `agents/`, the main session comes up pinned to `at-pm`, and a dispatch outside the roster is refused in the same wording the other load paths print. Three of the six gates were exercised that way; the other three — write-path isolation, contract protection and the stop gate — need a run in progress before they have anything to refuse, and a later round, with a run staged on the same kind of install, drove each of them to a real refusal, so all six are now measured under a GitHub install (`docs/19-远端安装路径实测.md`).

**What a GitHub install loads is a frozen copy, not a live link to this repository.** The install resolves one commit, records its hash, and unpacks a detached copy under `~/.claude/plugins/cache/` — and that copy, not the marketplace's clone and not your working tree, is what every path inside the plugin resolves against. Measured: the copy matched the upstream commit byte for byte apart from one marker file the CLI adds, it carries no git metadata of its own, and the loaded session referenced nothing else anywhere. A marketplace sourced from a local directory resolves those same paths to that directory instead, so which source you install from decides what the plugin is actually reading.

**That copy never follows this repository on its own, and whether `claude plugin update` moves it comes down to a single string.** Measured against a git remote whose history was genuinely advanced mid-measurement: leave it alone and the copy does not change; run `claude plugin marketplace update <marketplace>` and only the marketplace's own clone moves to the new commit, while the installed copy stays exactly where it was. The decisive one is `claude plugin update <plugin>@<marketplace> --scope local`, which compares the `version` string in the plugin manifest and **not** the commit: with upstream a real commit ahead and the clone already sitting on it, the command printed `is already at the latest version (0.1.0)` and did nothing. It moves only when the version string changes, and then it unpacks a *new* version directory beside the old one rather than rewriting it. Anything already running is a further step behind: a session that was live across a successful update kept expanding the old command bodies, matching the `Restart to apply changes.` the CLI prints. That whole chain was then run once more against this repository on GitHub itself: a copy installed while `main` was at one commit, the repository pushed forward a version while that copy sat there, and the update measured afterwards. Every step came out the same, and the updated copy matched the pushed tree file for file — including a test file that does not exist at all in the older one.

**This repository was pushed to three times on the day it went public and that string moved in none of them, so none of those fixes reached anyone who had already installed — and `claude plugin update` told them they were up to date.** That is now a rule instead of an accident: every push to `main` bumps the manifest `version`, and the rule is spelled out under Development below. So `claude plugin update <plugin>@<marketplace> --scope local` is worth running, and will normally have something to fetch. **It is a rule and not a mechanism, though — no test in this repository turns red if someone forgets it.** The path that does not depend on anyone remembering is to reinstall, from the project directory that holds the install:

```sh
claude plugin uninstall agent-team@agent-team-marketplace --scope local
claude plugin install agent-team@agent-team-marketplace --scope local
```

Measured against this repository on GitHub: `install` refreshes the marketplace clone from the remote first, then rewrites the cached copy in full even though a directory for that same version was already sitting there — a file added to the stale copy was gone afterwards, a file taken out of it was back, and the result was identical to a clean install file for file. What was not measured is that whole chain end to end with upstream genuinely moving; each half was.

**The other two measured paths are local.** `--plugin-dir` points at your own clone and installs nothing at all:

```sh
claude --plugin-dir /path/to/agent-team
```

Or declare the clone itself as the marketplace: `claude plugin marketplace add /path/to/agent-team --scope local` and then `claude plugin install agent-team@agent-team-marketplace --scope local`, again from the project directory. Either way the plugin is declared in that project's `.claude/settings.local.json` and nowhere else — no `claude plugin enable`, and no effect on any other project. Measured on CLI v2.1.278 side by side with a `--plugin-dir` control: the takeover, the four `/agent-team:*` commands, every dispatchable role's `tools:` line and all six gates came out identical across the two. Any `--scope local` install buys you working slash commands and a resume that needs no flag; what it costs is the next two paragraphs.

**`--scope local` does not keep everything inside the project.** The install also writes machine-global entries under `~/.claude/plugins/`, and leaves a copy of the plugin in `~/.claude/plugins/cache/` that `claude plugin uninstall` does **not** remove. What is under `cache/` only ever grows: an update that does take effect adds a directory for the new version and leaves the old one untouched, and uninstalling removes neither. `claude plugin list` will therefore list the plugin from any directory on the machine — shown as `disabled` everywhere except the project that installed it, which is the part that actually governs what loads. If your machine already has another plugin named `agent-team`, name every reference `<plugin>@<marketplace>`: the uninstall confirmation line prints the bare name back at you and does not say which one it removed. Dropping the marketplace afterwards with `claude plugin marketplace remove <marketplace> --scope local` does clear its own clone and returns the machine-global index files to exactly what they were, measured line by line for both install sources — but the cache copy survives that too, and has to be deleted by hand.

**The plugin ships a `settings.json` whose `agent` key pins the main session to `at-pm`.** That is the design — the project manager *is* the main session — and all three load paths were measured to do it: the session transcript carries an `agent-setting` record reading `"agentSetting":"agent-team:at-pm"`, and the CLI prints `@agent-team:at-pm` in the session header. What it means in practice is that the session you just started is no longer a general-purpose session, and it is not a narrow one either. Read Known Limitations before pointing one at a project you care about.

**Pass `--plugin-dir` on every resume as well — `claude --resume` does not inherit it.** Measured on CLI v2.1.276: resuming a `--plugin-dir` session without the flag makes the CLI print `Continuing with the default tools and system prompt — the agent's tool restrictions no longer apply.`, the plugin's `/agent-team:*` commands stop resolving, and the main session falls back to the default tool surface. Every isolation property this plugin has rides on the roles' `tools:` declarations, so one forgetful resume takes all of them off at once. Note that `/agent-team:at-resume` and `claude --resume` are not the same thing: the first is a plugin command that restores *run state*, the second is a CLI flag that restores the *session*.

**A local-scope install has the same failure with a different trigger — resume in the wrong directory.** Measured on v2.1.278, under the local-directory marketplace: resume inside the project directory that holds the install and everything survives, with no flag to pass at all. Resume that same session from anywhere else and the CLI prints the same line as above, because the agent is resolved against the working directory you are in *now*, not the one the session started in. There is no flag to forget here, which makes it the harder of the two to catch — and checking the transcript will not save you: it goes on recording the session as `at-pm` after the tool restrictions are already gone.

**To stop, end the session; start the next one without `--plugin-dir`, or uninstall.** Do not reach for `claude plugin disable` — a session's tool surface is fixed for its lifetime, and disabling was measured *not* to hand it back. `claude plugin enable` has the mirror-image problem: it takes over sessions that are already running. This project has banned both for itself, and every measurement it has was taken either with `--plugin-dir` or with a local-scope install. `claude plugin uninstall <plugin>@<marketplace> --scope local` was measured — for the GitHub install as well as the local-directory one — to leave the *next* session in that directory completely clean: no pin, no commands, no roles, and the default tool surface back. It says nothing about a session already running, which is the case `disable` fails at.

**Not measured — and each one says which kind of not-measured it is.** A full `S1`–`S8` run under any install: both end-to-end runs this project has were taken under `--plugin-dir`, so read the stage-chain claims as claims about that path. Resume under a GitHub install: measured under the local-directory marketplace only, not re-measured here. A private repository: the marketplace was added anonymously over HTTPS because this one is public, so what a fork behind credentials does was never exercised. Nor was the reinstall recipe run end to end with upstream genuinely moving, only its two halves. Nor a version string that goes *backwards*, or one that is not semver at all. And whether a live session holds its plugin registry in memory or simply re-reads a path that has not moved was left alone, because the update leaves the old directory in place and both mechanisms produce the same visible answer. **None of those is barred by the environment or by the shape of the thing; they were simply not done.** The last one is a different kind: every measurement was taken in a background (`--bg`) or `-p` session, so checking any of it from an interactive terminal needs a person at a keyboard.

## Usage

Once it is installed, start a session in that project directory — that session is the project manager — and use these four commands:

- `/agent-team:at-init` — **run it first, once per project.** The project manager surveys the project's stack, layout, and build and test commands, and writes `.agent-team/project.json`: which directories each role may write, which roles this project can use, and how to build and test. Write-path isolation judges against this file, so `/agent-team:at` stops and asks you to run this command first when the file is missing. It also writes `.agent-team/reach.json`, listing where each role can actually write once dispatch is taken into account. Read both; if the split is wrong, tell the project manager, or run this command again.
- `/agent-team:at <requirement>` — **start a run.** Write the requirement in your own words; the project manager copies it verbatim into the contract, `00-contract.md`, and every role's output is later checked against those exact words. It then drives the run along the stage chain from `S1` to `S8` without you prompting each stage.
- `/agent-team:at-status` — **check progress.** Read-only: the current stage, whether each deliverable is on disk, rework rounds per stage, roles deliberately left out, roles never called, any question still waiting for your answer, and where each role can actually write. This command has not yet been run against a real run.
- `/agent-team:at-resume` — **pick up where it stopped.** Use it after the context has been compacted, or in a new session: the project manager reads the run's position back from disk, checks the deliverables, and continues from there. It is not the CLI's `--resume` flag — see Installation.

**What happens in a run.** The project manager first freezes your requirement as the contract, then dispatches stage by stage: the product role writes the requirements (and, when needed, sends the UI role for the UI spec and wireframe); the architect writes the technical plan; the project manager itself decides who works on this run and how the work is split; the architect hands the implementation to the implementation roles — backend, frontend and the rest — which work in parallel within a stage; then come testing and business acceptance; finally the project manager wraps up and delivers. The project manager cannot dispatch the implementation roles itself: they go through the architect, and a dispatch that skips a level is blocked by the dispatch whitelist. Who may dispatch whom is defined in `roster.json`, and which role does each stage and what it hands over in `stages.json` (explained in `stages.README.md`); this README repeats neither.

**When it stops to ask you.** The project manager is the only role that talks to you, and it stops to ask about five kinds of things only: sensitive actions (credentials or keys, anything that costs money, sending or publishing outside, deleting or overwriting files this run did not produce, `git push` or other remote changes, CI/CD and production config); a role's output conflicting with the contract, or two clauses of the contract that cannot both be met; two options that both satisfy the contract but cannot both be had, with a difference you would notice; a requirement that contradicts itself or lacks key information; and rework that still fails after its budget is used up. Each question quotes the contract, offers two to four concrete options with their consequences, and gives its recommendation — never an open-ended question; in the desktop app it shows up as a card with the options. Your answer is appended to the contract as a revision. Technology choices the contract does not care about, which roles to leave out, who reworks a rejected deliverable, and code style and naming are decided without asking you. The full definitions are in section 4 of `commands/at.md`.

**Where things land.**

- `.agent-team/project.json`, `.agent-team/reach.json` — the survey, reused by every run.
- `.agent-team/current-run` — the id of the current run.
- `.agent-team/runs/<run_id>/` — everything one run produces: the contract `00-contract.md` first, then each stage's deliverables (one per implementation role in the implementation stage), plus the run's ledger `state.json`.
- The code itself goes into the directories `project.json` assigns to each role.

To watch each role at work, see the next section.

## Watching each role

When you run it in the desktop app, the project manager is the session you are looking at; every other role is a **subagent** it dispatches, and in the conversation each dispatch collapses into a single grey line (for example "Ran an agent, finished 6 background tasks"). **To watch the roles, click that line**: the Background tasks panel opens on the right with one entry per role — including the ones the architect dispatches in turn — showing its status, run time, token use and tool-call count. **View transcript** on an entry opens that role's whole run: the task it was handed, the files it read, what it changed, the commands it ran and the report it handed back.

Roles within one stage run **in parallel**: during implementation the backend and frontend run at the same time, each as its own entry. The whole run is still a single session, filed under your project in the sidebar, not a scatter of separate sessions.

Two more things worth knowing. **You can watch a role, but not talk to it**: only the project manager talks to you; a role reports its questions up and the project manager asks you. **The project manager runs on whatever model you picked in the app**, while the other roles run on the `sonnet` their definitions name — measured: the main session ran on the model selected in the app, the roles on Sonnet. All of this was measured in the desktop app; the full record is `docs/23-桌面端角色可见性实测.md`. The CLI differs on one point: without `--model`, the project manager runs on the `sonnet` named in `agents/at-pm.md`, and `--model` overrides it. The desktop app always passes `--model` when it starts a session, which is why your pick wins there (measured; see `docs/11` §5.36).

## Known Limitations

> Write-path isolation is a hard constraint on `Edit`/`Write`/`NotebookEdit` — but only for roles that claim paths in `project.json`. The roles that claim none, `at-qa` and `at-acceptance`, skip that check entirely: outside the run directory it returns early and allows, so they can create files wherever they like. And no hook watches `Bash` at all: executor roles keep it to run builds and tests, and `Bash` can write files (`echo >`, `sed -i`). `at-qa` holds both halves. This plugin is not a sandbox.

> Loading this plugin hands the main session to `at-pm` — and `at-pm` is not a narrow role. Its tool surface is `Bash`, `Write`, `Edit`, `Read`, `Glob`, `AskUserQuestion` and the `Agent(...)` dispatch whitelist, so a taken-over session can do everything an ordinary session can do, in whatever project it happens to be pointed at. The takeover is not self-limiting: what keeps it inside the intended project is the role's prompt, not its tool surface. Under `--plugin-dir` the blast radius is at least bounded to the sessions you start with that flag. Enabling the plugin machine-wide is a different proposition — it would apply to **every new session on this machine, in every project**, for as long as it stayed enabled — and this project does not do that (see Installation). A local-scope install sits between the two, and was measured there — whether its marketplace is a local directory or this repository on GitHub, the blast radius is the one project directory that declares it, and a new session in that directory comes back completely clean after `claude plugin uninstall <plugin>@<marketplace> --scope local`.

> A gate that lets a call through and has nothing to say leaves **no record at all** in the session transcript by default — the CLI itself drops a hook's successful run when its output is empty. So a clean run cannot prove the gates ran, nor that they did not. To make every gate invocation leave one line, start the session with `--settings '{"env":{"AGENT_TEAM_GATE_TRACE":"1"}}'` (exporting the variable in your shell does not reach the hooks of a `--bg` session — measured). Each gate then writes an `agent-team gate-trace check=<gate> …` line that the CLI files in the transcript under that gate's own status message; the line never reaches the model's context. It is off by default, and off means byte-for-byte the same output as before. How to count and read those lines, and what they cannot tell you: `docs/21-门禁留痕.md`.

> The gates assume the main session is `at-pm` — the pin described under Installation. If you override it with `--agent` pointing at another of this plugin's roles, every gate judges your main session as that role — and judges the CLI's own background forks (progress summaries, prompt suggestions) the same way, because they carry the main session's identity: the deliverable gate can then stop those forks while that role's stage is unfinished. That last part is read from the CLI source, not measured. Under the default pin those forks are let through — measured, with the before-and-after runs in `docs/22-内部分叉的身份.md`.

## Development

**Pushing to `main` is this project's only release event, so every push to `main` bumps `version` in `.claude-plugin/plugin.json`.** That string is the only thing `claude plugin update` compares — a push that leaves it alone reaches nobody who already installed, and the CLI actively tells them they are up to date. Bump the patch digit when the push touched only prose, `docs/` or `tests/`; bump the minor digit when it touched anything the plugin loads — `agents/`, `commands/`, `hooks/`, `skills/`, `settings.json`, `stages.json`, `roster.json`, `templates/`, or either file under `.claude-plugin/`. Do not let any digit reach `10` until someone measures how the CLI compares two of these strings: `0.9.0` → `0.10.0` moves forward if it parses them as semver and *backwards* if it compares them as text, and every increment measured here so far is one where both readings agree. **Nothing in the test suite enforces any of this**, and that is a deliberate choice rather than an oversight: the obvious check — compare the version at `HEAD` against the version as of the last commit touching those directories — would be red through the whole of every ordinary working day, and a check that is red by design gets ignored.

Run the test suite with a bare `node --test` from the repository root, with no path arguments. On this machine, `node --test tests/` does **not** discover the files under `tests/` — it silently reports a phantom `pass 0 / fail 1` instead, identically whether the code under test is fixed or broken, which sends anyone debugging the "failure" chasing a bug that doesn't exist.

## License

MIT — see [LICENSE](./LICENSE).
