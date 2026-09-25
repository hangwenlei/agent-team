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

- `hooks/gate.mjs` — 全部门禁的入口，按 argv 分派检查项；`hooks/hooks.json` — 事件到检查项的注册。
- `hooks/lib/` — 判定用的纯函数（`runctx.mjs` 读运行上下文、`trace.mjs` 门禁留痕、`retry-budget.mjs` 那份重试上限说明的单一真源等）。
- `agents/` — 各角色正文；`commands/` — 四条 `/agent-team:*` 命令。
- `stages.json` 阶段链；`roster.json` 花名册（派发白名单）；`templates/` 新 run 与 `project.json` 的模板；`settings.json` 把主会话钉成 `at-pm`。
- `docs/11-M1b-遗留与已知边界.md` — 已知边界登记簿；`docs/16-M2b-裁定记录.md` — 裁定记录与 §3 方法论语料。
- `docs/13`…`docs/22` — 带日期的实测记录。
- `tests/` — 全部判据。

## 🧠 长期决策与理由

- **零运行时依赖，不建 `package.json`。**
- **任何角色都不授予 `Skill` / `SendMessage` / `ListAgents`**（规格 §6.1）。frontmatter 的 `skills:` 键是另一回事，允许。插件自带的 skill 不得声明 `context: fork`。
- **`at-outsider` 永远不进任何角色的 `Agent(...)` 宇宙，也不进任何 `can_delegate_to`。**
- **发布纪律：每次推 `main` 都挪 `version`** —— 只碰散文 / `docs/` / `tests/` 挪最后一位，碰插件会加载的东西挪中间一位，任何一位不长到 `10`。
  理由：`claude plugin update` 比的是 `version` 字符串，不是 commit。它是纪律不是机制，没有判据兜底。
- **`docs/11` §1–§4 原文一字不改，只追加 §5.x；带日期的实测记录正文不改，订正与收口写在旁边 —— 而且写在原话的标题底下**，只在新一节里指称它的收口，扫标题的人读不到。
- **一条注释不是一条判据。** 要防的事配判据；写不出来就按 `docs/16` §3 开头那条付三样（拒绝的判据长什么样、它打不红的那一刀、什么会让答案改变）。
- **列举，不报总数**（`docs/16` §3.1）。失效条件写成可观测状态或归属规则，不写成要人去数的阈值。
- **找缺陷靠变异验证，不靠读代码**（`docs/16` §3）。

## ⚠️ 注意事项 / 坑

- **换行符是混的**（`docs/11` §5.28）：索引统一 LF，`core.autocrlf=true` 让签出副本是 CRLF，被工具重写过的文件停在 LF。
  锚串替换要**断言命中数，并核对命中的是你要的那一处** —— 同一个实参有几处合法命中时，断言防不了砍错的那一刀。落盘后扫控制字节与行尾混用。
- **后台 agent 与主会话共用工作树时**，别 `git add -A` / `checkout` / `reset`；要并行就用隔离 worktree。
- `claude --resume` 不继承 `--plugin-dir`；local 安装下换了目录续会话，工具限制会整体掉光，而转录里看不出来。
- 后台探针用 `claude --bg`，不用 `-p`（`-p` 下异步派发会卡死）。
- 变异验证用 `cp` 备份与还原，不用 `git checkout` / `git restore`；备份放仓库外。
- 裸 `node --test`（仓库根，不带路径参数）；带路径参数会报出一个假的 `pass 0 / fail 1`。
- 仓库里不要建 `scratchpad/`：它不在 `.gitignore` 里，而 `node --test` 会递归收它下面的 `*.test.mjs`。
- **绝不 `claude plugin enable` / `disable`**：`enable` 接管正在跑的会话，`disable` 不把工具面还回来。
- Git Bash 里设了 `MSYS_NO_PATHCONV=1` 之后，传给 node 的 `/c/...` 路径不再被转换，要写成 `C:/...`。
- 本机有一个同名的 `agent-team@skills-dir`（user 作用域、disabled，一条指向本工作树的软链）——不要碰；插件命令一律写全名 `<插件>@<市场>`。
- 子代理写不进 `.superpowers/`（harness 拒绝），它的报告正文要放进返回消息，由主会话落盘。

## ▶️ 常用命令

```sh
node --test
```

- 开发期加载：`claude --plugin-dir .`
- 打开门禁留痕：`claude --settings '{"env":{"AGENT_TEAM_GATE_TRACE":"1"}}'`
