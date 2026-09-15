# agent-team

agent-team 是一支十角色软件开发 agent team：项目经理为主会话，分层派发任务，执行顺序由门禁强制，业务验收独立成线。

**Status:** M0 — foundation validation, not yet usable.

## 安装

尚未发布到市场。插件进入可用状态后（M0 之后）补充安装说明。

## 已知边界

> 写路径隔离对 `Edit`/`Write` 是硬约束，对 `Bash` 是软约束。执行角色保留 Bash 以运行构建与测试，而 Bash 可以写文件（`echo >`、`sed -i`）。本插件不是沙箱。

> 启用本插件会把 `settings.json` 的 `agent` 键接管**这台机器上此后开的每一个新会话**，不分项目，只要插件保持启用状态——不仅限于本仓库里的会话。每个新会话都会变成 `at-pm`，而它的工具面只有 `Agent(...)`、`Read`、`Glob`，在无关项目里干不了正常工作。用完实验立刻停用插件：`claude plugin disable agent-team@skills-dir`（裸写 `agent-team`、不带 `@skills-dir` 会报 `not found in any editable settings scope`）。

## Development

跑测试一律用裸 `node --test`，从仓库根目录执行，不带任何路径参数。本机实测：`node --test tests/` **不会发现** `tests/` 下的测试文件，而是静默报一个 `pass 0 / fail 1` 的幻影失败，且无论被测代码是修好了还是还坏着，这个失败都一模一样——接手排查的人会去找一个根本不存在的 bug。

## License

MIT — 见 [LICENSE](./LICENSE)。
