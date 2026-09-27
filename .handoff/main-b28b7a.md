---
branch: main
worktree: C:/Users/82370/Desktop/Agent-Team
---
> 更新时间：2026-09-27T07:38:24-07:00

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
- [x] 10. 桌面端实测：每个角色在 Background tasks 面板单独一条、View transcript 看全过程，同一段内真的并行（`docs/23`）；两份 README 补「怎么看每个角色」，随 `v0.6.2` 发布
- [x] 11. `docs/11` §5.36 订正（命令行里 `at-pm.md` 的 `model: sonnet` 生效，`--model` 盖过它）与 §5.37 收口（`at-resume` 第 2 节补「展开为空集不算齐了」并配判据，改前改后各量三个样本），随 `v0.7.0` 发布
- [ ] 12. `docs/11` §5.37「没量的」三条：在 S2 开头续跑（推断会在 S3 撞 H2）、项目经理跑在别的模型上、每边三个以上样本
- [x] 13. 两份 README 补「使用」一节（四条命令、一趟 run 怎么走、什么时候问你、产物落在哪），配一条「命令清单与 `commands/` 双向一致」的判据，随 `v0.7.1` 发布
- [x] 14. README 并成一份：`README.md` 里中文在前、英文在后，`README.zh-CN.md` 删除；同步判据改成对照同一文件的两半，随 `v0.7.2` 发布
- [x] 15. README 顶部 English 链接修好：分界锚点从 `<a name>` 改成 `<a id>`（GitHub 页面只按 `id` 跳，实测），随 `v0.7.3` 发布

## 🧠 本分支决策

- **H5b 那一行修法的前提**：`stop-gate` 只挂在 `SubagentStop` 上、不挂 `Stop`，所以主线程停下从不经过 H5b；带 `at-pm` 身份的 `SubagentStop` 在支持路径上只可能是 CLI 内部分叉。前提的另一半（花名册里没人能派 `at-pm`）由 `tests/roster-closure.test.mjs` 钉着——那条判据变红的那天，就是这一行前提失效的那天。
- **门禁留痕选 stderr、默认关**：现成通道（`--debug-file`、`--verbose`、OTel）都说不出是哪一道门禁；stdout 不能用，`PreToolUse` 的拒绝就是 stdout 上的 JSON，前面多一行字就会被当成纯文本。
- **`at-resume` 第 2 节把 `isStageDone` 对空集的答案写了出来，而不是只指回去**：只指不写，项目经理得去读 `hooks/lib/state.mjs` 才知道答案，而第 2 节正是它当场要判的地方。这是同一份知识的第二处，代价由 `tests/commands.test.mjs` 那条两半判据付——正文与 `isStageDone` 任一边单独改都红。

## ⏭️ 下一步

- 任务看板第 5 项最便宜：在一趟真实 run 上跑一次 `/agent-team:at-status`。
