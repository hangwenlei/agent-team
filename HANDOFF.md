<!-- sync:docs schema=2 -->
# HANDOFF

## 概览

agent-team：一个 Claude Code 插件，十角色软件开发 agent team。项目经理（`at-pm`）就是主会话，
沿阶段链 `S1`→`S8` 分层派发，执行顺序由 hook 门禁强制，业务验收独立成线。
已公开在 github.com/hangwenlei/agent-team，默认分支 `main`。

## 🚀 运行现状

- 形态：Claude Code 插件，零运行时依赖，不部署任何服务、不监听任何端口。
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

- `hooks/boot.mjs` — 门禁的进程入口（`hooks/hooks.json` 注册的是它），只动态 import `gate.mjs`，判定代码加载失败时照 `checks.mjs` 的失败策略表收尾。
- `hooks/gate.mjs` — 门禁的判定主体，按 argv 分派检查项；`hooks/hooks.json` — 事件到检查项的注册。
- `hooks/lib/` — 判定用的纯函数（`runctx.mjs` 读运行上下文、`trace.mjs` 门禁留痕、`retry-budget.mjs` 那份重试上限说明的单一真源等）。
- `agents/` — 各角色正文；`commands/` — 四条 `/agent-team:*` 命令。
- `stages.json` 阶段链；`roster.json` 花名册（派发白名单）；`templates/` 新 run 与 `project.json` 的模板；`settings.json` 把主会话钉成 `at-pm`。
- `docs/11-M1b-遗留与已知边界.md` — 已知边界登记簿；`docs/16-M2b-裁定记录.md` — 裁定记录与 §3 方法论语料。
- `docs/13`…`docs/24` — 带日期的实测记录；`docs/24` §5 是 2026-09-28 那次全量审查逐条的现状（原文在它的附录），下一轮从那里挑。
- `tests/` — 全部判据；`.github/workflows/ci.yml` 在三个系统上跑它们，推 main / 向 main 提 PR 时再跑 `scripts/check-version-bump.mjs`。

## 🧠 长期决策与理由

- **零运行时依赖，不建 `package.json`。**
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

## ⚠️ 注意事项 / 坑

- **门禁的项目根不是 cwd**：从 cwd 往上找最近的 `.agent-team`，cwd 在启动项目（`CLAUDE_PROJECT_DIR`）里时不越过它（`hooks/lib/runctx.mjs` 的
  `projectRootFrom`，`docs/24` §2.1）。子进程测试的环境由 `tests/helpers/gate-runner.mjs` 的 `hermeticEnv` 剥掉 `CLAUDE_PROJECT_DIR` 与留痕开关；
  要测「变量生效」的用例自己加回来。
- **只在这台机器上成立的假设，CI 一跑就露**：macOS 的 `tmpdir()` 在 `/var` 软链接下，子进程 `process.cwd()` 给的是解析后的路径；
  GitHub 的 Windows runner 签出在 D 盘。夹具一律发 realpath，不写死盘符。**产品侧同族的路径别名问题还开着**（`docs/24` §3，下一轮优先）。
- 用脚本往文件里写带 `\0` 之类转义的文字时，落盘后照样扫控制字节——这一轮就有一个真的 NUL 字节混进了注释。

- **换行符是混的**（`docs/11` §5.28）：索引统一 LF，`core.autocrlf=true` 让签出副本是 CRLF，被工具重写过的文件停在 LF。
  锚串替换要**断言命中数，并核对命中的是你要的那一处** —— 同一个实参有几处合法命中时，断言防不了砍错的那一刀。落盘后扫控制字节与行尾混用。
- **后台 agent 与主会话共用工作树时**，别 `git add -A` / `checkout` / `reset`；要并行就用隔离 worktree。
- `claude --resume` 不继承 `--plugin-dir`；local 安装下换了目录续会话，工具限制会整体掉光，而转录里看不出来。
- 后台探针用 `claude --bg`，不用 `-p`（`-p` 下异步派发会卡死）。收尾对每个会话先 `claude stop` 再 `claude rm`：
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
