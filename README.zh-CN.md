# agent-team

agent-team 是一支十角色软件开发 agent team：项目经理为主会话，分层派发任务，执行顺序由门禁强制，业务验收独立成线。

**Status:** M0 — foundation validation, not yet usable.

## 安装

尚未发布到市场。插件进入可用状态后（M0 之后）补充安装说明。

## 已知边界

> 写路径隔离对 `Edit`/`Write` 是硬约束，对 `Bash` 是软约束。执行角色保留 Bash 以运行构建与测试，而 Bash 可以写文件（`echo >`、`sed -i`）。本插件不是沙箱。

## License

MIT — 见 [LICENSE](./LICENSE)。
