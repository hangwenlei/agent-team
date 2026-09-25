---
branch: main
worktree: C:/Users/82370/Desktop/Agent-Team
---
> 更新时间：2026-09-25T04:01:13-07:00

## 📋 任务看板

- [x] 1. 门禁留痕（`AGENT_TEAM_GATE_TRACE`，默认关）——静默放行在转录里本来不留任何记录
- [x] 2. 修掉 H5b 误拦 CLI 内部分叉：分叉带的是主线程身份 `at-pm`，在 S1/S4/S8 被当成 PM 去核产物
- [x] 3. 清理已合入的子代理 worktree
- [x] 4. README 两处过期陈述已修正（完整跑通两趟、GitHub 安装下六道门禁都量过），随 `v0.6.1` 发布
- [ ] 5. `/agent-team:at-status` 的报法从没在真实链上跑过
- [ ] 6. `docs/18` §5 剩下三条：`trimmed` 写错格式时 PM 会不会改对、收窄失效时活会话里的 PM 怎么做、S5 上早段派过后段裁掉
- [ ] 7. `docs/19` 安装侧剩下的：私有仓库、`uninstall` 对正在跑的会话、上游动了之后重装、HTTP 与 HTTPS 同形是推论、活会话是内存快照还是读盘
- [ ] 8. `--agent` 把主线程换成别的团队角色时分叉带什么身份——只读过 CLI 源码，没实测
- [ ] 9. 新拉起的 CLI 后台服务继不继承 shell 环境（`docs/21` §7 第 3 条）——两轮都错过了时机

## 🧠 本分支决策

- **H5b 那一行修法的前提**：`stop-gate` 只挂在 `SubagentStop` 上、不挂 `Stop`，所以主线程停下从不经过 H5b；带 `at-pm` 身份的 `SubagentStop` 在支持路径上只可能是 CLI 内部分叉。前提的另一半（花名册里没人能派 `at-pm`）由 `tests/roster-closure.test.mjs` 钉着——那条判据变红的那天，就是这一行前提失效的那天。
- **门禁留痕选 stderr、默认关**：现成通道（`--debug-file`、`--verbose`、OTel）都说不出是哪一道门禁；stdout 不能用，`PreToolUse` 的拒绝就是 stdout 上的 JSON，前面多一行字就会被当成纯文本。

## ⏭️ 下一步

- 任务看板第 5 项最便宜：在一趟真实 run 上跑一次 `/agent-team:at-status`。
