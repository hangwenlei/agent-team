# 界面设计的做法与 skills 写全名

> 2026-10-16，分支 `claude/zen-kilby-822b9a`。`at-ui` 的正文只有流程与门禁规则，没有任何设计方法；本轮把几份许可宽松的设计方法
> 用自己的话改写成插件自己的 skill `at-ui-craft`，经 frontmatter 的 `skills:` 预加载给 `at-ui`；顺带把九个子代理角色与项目经理的 `skills:` 改写成全名。
> 同时在开工的另一条线（S6 只读代码审查与 README）写 `docs/96`，本轮写 `docs/97`。

## 0. 一句话结论

- **`at-ui` 有了设计方法**：新 skill `skills/at-ui-craft/`——主体 `SKILL.md`（先读项目已有的设计来源、两遍定视觉方向、token 与层级、状态与交互、动效、
  无障碍底线、响应式、内容诚实、S2 交什么、S5 交付前自检），细则在 `references/` 下五份按需 `Read`（动效、无障碍与质量、iOS、Android、自检）。
  `at-ui` 预加载它与 `at-api-contract`。
- **界面规格送得到实现者手里**：架构师派 S5 界面实现时，交接包「输入产物路径」必须点名 `02-ui-spec.md` 与 `02-wireframe.html`；`at-frontend`、`at-ios`、
  `at-android` 落地界面前先读这两份，交之前照 `references/self-check.md` 核。不改 `stages.json` 的 `requires`。
- **`at-api-contract` 加「端点之外的接头」**：两个 S5 产者之间不走 HTTP 的接头（组件、共享类型、事件、本地存储格式）写清名字、所在文件、签名或字段、
  谁产出、谁使用、出错时怎样。
- **`skills:` 一律写全名 `agent-team:at-*`**：实测裸名会被项目层的同名 skill 抢先，全名精确命中插件那一份（§3）。判据钉全名。

## 1. 起因：本轮调研的结论

- **`at-ui` 原先零设计方法**：`agents/at-ui.md` 只讲在哪一段、写哪里、红线与冒泡，审美、设计 token、动效、无障碍、视觉自检一个词都没有。规格可不可实现
  只靠「交互状态一一列全」那一句。
- **`02-*` 不是任何段的前置**：`stages.json` 里 S3 只要 `00-contract.md`、`01-prd.md`，S5 只要 `03-arch.md`、`04-dispatch.md`。界面规格能不能到 S5 实现者手里，
  全看架构师写交接包时记不记得点名。
- **只改写进自有 skill，不跨插件引用**：任何角色都不授 `Skill` 工具（不变）；能让子代理「直接用上」的只有 frontmatter 的 `skills:` 预加载（`docs/13` §3.6 路径 A 实测
  对子代理生效）。跨插件写 `skills: frontend-design:frontend-design` 这类引用不用，理由三条：
  1. 对方插件没装时，预加载只在调试日志里警告、静默跳过——角色以为自己有方法，其实没有；
  2. 上游改了内容，本插件的 `version` 不跟着挪，用户 `claude plugin update` 拿不到也觉察不到，行为却变了；
  3. 原文里「先问用户」「派子代理」「装这个包」这类指令会原样进来，而 `at-ui` 没有 `AskUserQuestion`，写路径隔离也会拒它写约定目录。
- **不把截图类 MCP 列进 `tools:`**：`docs/36` 那条「不给任何角色加 MCP」照旧。要推翻它之前先实测三件事：子代理里 `Read` 能不能看 PNG；`tools:` 里写了用户没配的
  MCP 时子代理能不能照常起；桌面端嵌套的后台派发能不能用内置浏览器。本轮自检只分「看过」「从源码推断」「没核」三栏，截图那一档登进开着的边界（§5）。
- **不用的来源**：

  | 来源 | 不用的理由 |
  |---|---|
  | baoyu-design | 没有授权声明 |
  | 21st.dev、v0、Stitch | 要 API key，并把项目内容外发给第三方服务 |
  | React Bits | 许可证带 Commons Clause |
  | Aceternity UI | 保留所有权利 |
  | Impeccable 整装 | 插件会带 hooks；只取文字（Apache-2.0） |
  | GSAP 库 | 非开源许可（取材的文字里也不引它） |

## 2. 裁定

### 2.1 取材与改写

取材八份（许可证本轮逐个核过，版权行照录在仓库根的 `THIRD_PARTY_NOTICES.md`）：Anthropic 的 frontend-design（Apache-2.0）、vercel-labs/web-interface-guidelines
（MIT，取 `AGENTS.md`）、emilkowalski/skills（MIT）、LottieFiles/motion-design-skill（MIT）、Dammyjay93/interface-design（MIT）、oil-oil/oil-frontend（MIT）、
pbakaus/impeccable（Apache-2.0，只取文字）、ehmo/platform-design-skills（MIT）。全部用自己的话改写、改成中文，不逐字搬原文。

不搬的：要人在环的步骤（改成「写假设，需要拍板时以『冒泡：』交给派你的角色」）、派子代理、装东西的命令、写约定目录（会被写路径隔离拒）、联网、厂商引导、版本断言。

声明文件放仓库根、不放进 `skills/at-ui-craft/`：`tests/runtime-prose.test.mjs` 本轮扩到 `skills/` 下全部 `.md`（references 也是模型运行时读的），声明里的许可证正文
不是给模型读的，放进去会被当成运行时正文扫；`tests/hygiene.test.mjs` 扫仓库根的 `.md` 只查「Ruling 加数字」，许可证正文不撞。

### 2.2 `at-frontend` 不预加载 `at-ui-craft`

`SKILL.md` 主体约 4600 个字符（汉字约 2500 个），每次派发多注入几千 token。`at-frontend` 在 S5 里不只做界面（状态管理、接口调用、构建配置），每一次派发都付这笔
不划算；它要的设计决定已经写在 `02-ui-spec.md` 里。改成正文里写明「落地界面之前先读界面规格」，交之前按需 `Read` 自检那一份（约 1500 字符），`at-ios`、`at-android`
再按需读各自平台那一份。设计方法本身只给做设计的 `at-ui`。

### 2.3 不改 `requires`

把 `02-ui-spec.md`、`02-wireframe.html` 加进 S5 的 `requires` 会牵动整段裁掉（S2 裁掉时 S5 永远缺前置）与 `isStageDone`、H2 的前置判定，另作裁定；本轮只靠架构师正文
与三个端的正文，登进开着的边界（§5）。

### 2.4 `skills:` 写全名

CLI 2.1.301 解析 `skills:` 时先在全部 skill 里按名字精确匹配，用户或项目层有同名的 skill 会先命中——与插件 `settings.json` 的 `agent` 写全名同一个理由（`docs/36`）。
十份带 `skills:` 的 frontmatter（九个子代理角色与项目经理）一律改写成 `agent-team:at-*`。项目经理是主会话，`skills:` 对它不生效（`docs/13` §5.2），照样写全名，
免得两种写法并存。`tests/agents.test.mjs` 加一条「每一项都写全名」，存在性判据剥掉 `PLUGIN_PREFIX` 再查目录。

## 3. 实测：全名预加载

照 `docs/13` §3.6 路径 A。CLI 2.1.301，`claude --bg --plugin-dir <本工作树>`，会话 `d37331cd`。工作目录是本工作树下的临时子目录（继承工作树的信任），
里面放一份项目层的诱饵 skill `.claude/skills/at-handoff-package/SKILL.md`，「交接包」一节只有「诱饵甲、乙、丙」三项。此时 `at-architect` 已改成
`skills: agent-team:at-handoff-package, agent-team:at-api-contract`，`at-product` 还是裸名 `skills: at-handoff-package`。

项目经理用 `Agent` 依次派两人，派发提示原样一句：不要调用任何工具，列出 `at-handoff-package`「交接包」一节的编号小标题，预加载了 `at-api-contract` 的再列五项。

| 角色 | 写法 | 复述的「交接包」 | `at-api-contract` | 子代理的 `tool_use` |
|---|---|---|---|---|
| `at-architect` | 全名 | 目标、约束、输入产物路径、未决问题、完成定义、验收回传通道（插件那份） | 方法与路径、请求体、成功响应、失败响应、副作用 | 0 |
| `at-product` | 裸名 | 诱饵甲、诱饵乙、诱饵丙（项目层那份） | 说没有预加载 | 0 |

派发提示原文（转录里的 `tool_use.input.prompt`）不含任何 skill 正文。结论：**全名精确命中插件那一份；裸名被项目层的同名 skill 抢先**——不只是源码读出来的推断。
收尾：`claude stop d37331cd`、`claude rm d37331cd`，临时子目录删掉。项目经理开头两次写 `.agent-team/gate-check` 是门禁自检（被拒，磁盘上没有留下文件）。

## 4. 修法与判据

- 新文件：`skills/at-ui-craft/SKILL.md`、`skills/at-ui-craft/references/{motion,a11y-quality,platform-ios,platform-android,self-check}.md`、`THIRD_PARTY_NOTICES.md`。
- `skills/at-api-contract/SKILL.md`：加「端点之外的接头」一节。
- `agents/at-ui.md`：预加载 `at-ui-craft`、`at-api-contract`；正文加一段「设计做法按预加载的 `at-ui-craft` 走」。
- `agents/at-architect.md`：派界面实现时交接包「输入产物路径」点名两份界面产物，不走 HTTP 的接头照 `at-api-contract` 写进方案。
- `agents/at-frontend.md`、`agents/at-ios.md`、`agents/at-android.md`：「落地界面之前先读界面规格」一段。
- 十份 frontmatter 的 `skills:` 写全名。
- 判据：`tests/skills.test.mjs` 的 `SKILLS` 与 `tests/agents.test.mjs` 的 `EXPECTED_SKILLS` 加 `at-ui-craft`；`tests/agents.test.mjs` 加「每一项都写全名」、
  存在性与「至少被一个角色预加载」剥前缀；`tests/runtime-prose.test.mjs` 扫 `skills/` 下全部 `.md`，身份锚加 `references/motion.md`。

## 5. 仍然开着的边界

- **截图自检这一档没有**：自检只分「看过」「从源码推断」「没核」，`at-ui` 与三个端看不看得到页面取决于手里有什么工具；把截图类 MCP 或内置浏览器给子代理之前，
  先实测 §1 那三件事（子代理里 `Read` 看 PNG、`tools:` 写了用户没配的 MCP 时能否照常起、桌面端嵌套的后台派发能否用内置浏览器），再决定推不推翻 `docs/36` 那一条。
- **`02-*` 不是 S5 的前置**：界面规格到不到实现者手里靠架构师正文那一句与三个端正文那一段，门禁不核交接包里点没点名、实现者读没读；要不要加进 S5 的
  `requires` 另作裁定（牵动整段裁掉、`isStageDone`、H2）。
- **设计质量门禁不读**：规格里有没有状态矩阵、动效表有没有减弱版、线框是不是离线能开、实现记录里有没有「设计自检」，都靠正文与 `at-qa`、`at-acceptance` 读，门禁不核内容。
- **上游更新不跟**：改写是本轮这一刻的取舍，上游以后的改进不会自动进来（有意，§1）。

## 6. 没量到的

- 真实一趟里 `at-ui` 照不照 `at-ui-craft` 做：两遍法有没有真的复核、状态矩阵全不全、线框离线能不能开。本轮只实测了预加载本身（§3），没有跑一趟带界面的 run。
- 预加载了三份 skill 之后 `at-ui` 的首轮上下文多了多少、会不会挤掉别的东西，没量。
- 用户层（`~/.claude/skills/`）同名 skill 抢裸名，本轮只量了项目层那一种；按同一条精确匹配推断同样会抢。

## 7. 归属

- `skills/at-ui-craft/`、`skills/at-api-contract/SKILL.md`、`agents/at-ui.md`、`agents/at-architect.md`、`agents/at-frontend.md`、`agents/at-ios.md`、`agents/at-android.md`、
  另外五份 frontmatter 的 `skills:` 行、`THIRD_PARTY_NOTICES.md`、`HANDOFF.md`（长期决策补一句）、`docs/00-开放边界.md`；判据见 §4。

## 8. 版本与两条线

另一条线（`docs/96`）也挪中间一位。先合进 `main` 的那条拿 7.1.0，后合的在合之前并入最新 `main`、改成 7.2.0，`CHANGELOG.md` 最上面按合并顺序各一行。
`docs/96` 那条线先合进 `main`、拿了 7.1.0；本分支并入最新 `main` 之后改成 7.2.0。

## 9. 复核

派一个子代理对抗复核（只读），改了这些：前端那一段指向了它没有的「平台差异」，改成冒泡给架构师；自检清单里改设计的几条标「设计专项」，执行角色只记下、冒泡；
S2 的自检写进 `02-ui-spec.md`（规格加第 11 节），不写进 `05-impl/at-ui.md`；`at-ui` 在 S5 照 `03-arch.md` 定的接头实现、没定的冒泡，不自己定；架构师定接头那一句挪到
「定方案与接口契约」；`SKILL.md` 与 `references/motion.md` 的时长分档、快捷键不加动画对齐；自检统一成三栏；三个端补「没有这两份时照交接包写明的设计来源、也没写就冒泡」；
skill 与 references 末尾各加一行指回 `THIRD_PARTY_NOTICES.md`（Apache-2.0 第 4 条的改动说明，稳妥起见）；本文两处数字订正。
