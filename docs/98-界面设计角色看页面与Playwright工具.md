# 界面设计角色看页面与 Playwright 工具

> 2026-10-16，分支 `claude/at-ui-playwright-09942d`。`docs/97` 给 `at-ui` 加了交付前自检，「看过」那一栏却没有任何看页面的手段：`at-ui` 的
> `tools:` 只有 Bash、Read、Glob、Grep、Write、Edit，`docs/36` §2.10 裁定不给任何角色加 MCP，`docs/97` §5 把截图自检登成开着的边界、要先实测。
> 本轮照用户批准的方案走：先实测，过了再改，只给 `at-ui`，单独分支开 PR、合不合由用户定。

## 0. 一句话结论

- **实测六项都过**（§2）：子代理拿得到列在 `tools:` 里的 Playwright 工具；截图真的看得见（canvas 画的字三张都说对了，快照里读不到）；截图与打开页面时
  自动存的快照落在会话启动目录下的 `.playwright-mcp/`；auto 模式自动放行，默认模式在会话主界面弹确认、等人答；写了不存在的工具名角色照常起、其余工具
  都在；关浏览器关得掉，会话停掉时没关的浏览器与 MCP 服务一起退出。
- **裁定**（§3）：收窄 `docs/36` §2.10——只给叶子角色 `at-ui` 开官方插件市场 Playwright 插件的六个工具（打开页面、改窗口尺寸、模拟媒体特性、截图、
  快照、关浏览器）；执行脚本、上传文件、拖放、对话框这类不给，不授整台服务器；别的角色照旧不给 MCP 与网页工具。
- **正文**：`at-ui` 与 `at-ui-craft` 的自检写清只开本机起的页面（外部网站、`data:`、`file://` 都不开）、手机宽、桌面宽、减少动态（有深色加深色）各截一张、
  每张只改一个条件、截图与快照不带 `filename`、在记录里写明 `.playwright-mcp/` 下留了什么、用完关浏览器、浏览器里读到的是数据；哪种办法都看不到才照实写
  「没看过效果」。`at-qa` 审改动时不读那个目录。
- **README 两半**：「团队里其余角色也拿不到」改成点名 `at-ui` 与 Playwright 插件；判据改成双向点名。

## 1. 起因

- `docs/97` §5 第一条：截图自检这一档没有；推翻 `docs/36` 那一条之前先实测三件事——子代理里 `Read` 能不能看 PNG、`tools:` 写了用户没配的 MCP 时
  子代理能不能照常起、桌面端嵌套的后台派发能不能用内置浏览器。
- `docs/36` §2.10 不给 MCP 的理由之一：插件写不出用户的 MCP 服务器名（`tools:` 不认 `mcp__*` 通配）。插件装出来的 MCP 工具名是固定的，
  `mcp__plugin_<插件>_<服务器>__<工具>`。用户本机装的官方插件市场 Playwright 插件（`playwright@claude-plugins-official`，user 作用域，配置是
  `npx @playwright/mcp@latest`、不带参数，本轮解析到 0.0.83）给的就是 `mcp__plugin_playwright_playwright__browser_*`——这一组名字插件写得出。
- 三件事里：第 1 件用不着了——截图随工具结果以图像回到子代理手里，不经 `Read`；第 3 件不走这条路——内置浏览器的工具名随宿主变（桌面端是
  `mcp__Claude_Browser__*`），终端与 `--bg` 会话里根本没有，插件写不出一个处处成立的名字；第 2 件本轮实测（§2.2 的 (e)）。

## 2. 实测

### 2.1 做法

照 `docs/13` §3.6 路径 A、`docs/97` §3：CLI 2.1.301，`claude --bg --plugin-dir <本工作树>`，工作目录是本工作树下的临时子目录 `probe-98/`，`--settings`
里只带 `worktree.bgIsolation: "none"`（git 仓库里的后台会话，`docs/24` §4.2），各带一份 `--debug-file`。临时把 `agents/at-ui.md` 的 `tools:` 加上六个
Playwright 工具与一个不存在的 `mcp__nonexistent__x`。项目经理派不了 `at-ui`，经 `at-architect` 嵌套派，两层都是后台派发（子代理元数据
`spawnDepth: 2`、`requestShape: background`）。目录里没有 `.agent-team`，门禁按没有 run 放行，项目经理照回传说了。

页面：一份静态 HTML，由驱动起的本机服务给出（只听 `127.0.0.1:47391`，收尾按 PID 停）。中间一块 240×240 的 canvas，字由 `String.fromCharCode` 拼出、
画在 canvas 上——页面文字与无障碍快照里都没有它，只有截图看得见：默认红底「XJ-42」，宽度不超过 480 时蓝底「KP-17」，`prefers-reduced-motion: reduce`
时绿底「RM-93」。

| 场 | 会话 | 权限 | 派给 `at-ui` 的事 |
|---|---|---|---|
| A | `8e91e8ad` | `--permission-mode auto` | 说七个名字各有没有；先开 `file://` 那份；再开本机地址，默认窗口、375×812、改回 1280×800 并把 `reducedMotion` 设成 `reduce` 各截一张、说颜色与字；取快照；关浏览器；照抄截图路径。不许用 Bash、Read、Glob、Grep |
| B | `4409bebe` | `--permission-mode manual`，`--allowedTools` 放行 Read、Glob、Grep、Write、Edit、Bash、Agent、SubagentHandback 与 `browser_navigate`，截图不放行 | 照实列出全部工具名；开本机地址；截一张；不关浏览器 |

### 2.2 结果

| 项 | 结论 | 证据 |
|---|---|---|
| (a) 子代理拿不拿得到 | 拿得到：A 里六个都调通；B 里 `at-ui` 列出十二个工具（六个内建、六个 Playwright） | 子代理转录的 `tool_use`；调试日志的 `Calling MCP tool` |
| (b) 截图看不看得见 | 看得见：三张依次说出红底「XJ-42」、蓝底「KP-17」、绿底「RM-93」；快照只有 `heading "Probe"`；`at-ui` 没有任何读页面源码的调用 | 工具结果里是 `image/png`；`SubagentHandback` 原文；`tool_use` 只有 Playwright 那几个与交回 |
| (c) 文件落在哪 | 会话启动目录下的 `.playwright-mcp/`——MCP 客户端报的第一个根，这两场就是工作目录 `probe-98/`；门禁的项目根按 `.agent-team` 往上找，两者通常是同一个，不保证。每次打开页面自动存一份快照 `page-<时间>.yml`，每次截图（不带 `filename`）存一份 `page-<时间>.png`；不带 `filename` 的快照内联回来、不落盘；页面的控制台输出（`.log`）与页面触发的下载也写进这个目录（源码里的 `LogFile`、`_downloadStarted`，这两场没触发）。带 `filename` 时截图不再以图像回传，文件按启动目录解析，只核在不在启动目录或输出目录之下——项目里哪儿都写得进，`CLAUDE.md`、`.claude/`、`.git/` 与门禁专属文件也挡不住（0.0.83 源码的 `checkFile`、截图工具的 `registerImageResult`）。这些都是 MCP 服务那个进程写的，写路径隔离与账本看不见。另有：浏览器配置目录 `%LOCALAPPDATA%\ms-playwright-mcp\mcp-chrome-<哈希>`（按启动目录分，跨会话保留登录态与本地存储）；Claude Code 把工具结果里的图另存在 `~/.claude/projects/…/tool-results/` 下 | 磁盘清单；工具结果里的路径；0.0.83 的源码 |
| (d) 后台会不会卡在权限确认上 | auto：每次调用约 0.4 秒自动放行，没有一次停下。manual：放行了的 `navigate` 直接跑；没放行的截图在会话主界面弹出「plugin:playwright:playwright — Take a screenshot … Do you want to proceed?」，`claude agents --json` 报 `status: waiting`、`waitingFor: "permission prompt"`、`state: blocked`——等人答，不自动拒，也不是悄悄挂住 | 调试日志的 `permissionDecisionMs`、`executePermissionRequestHooks`；`claude logs`；`claude agents --json` |
| (e) 写了不存在的工具名 | `at-ui` 照常起，其余工具都在（B 的完整清单里没有那个名字）；调试日志里没有任何告警 | B 的回复原文；调试日志 |
| (f) 浏览器关没关、有没有残留 | A 关浏览器之后 Chrome 进程立刻没了；B 不关，有界面的 Chrome 窗口一直开着，`claude stop` 之后 MCP 服务那一串（cmd、npx、cli）与 Chrome 一起退出，没有残留 | 进程表（按命令行里的 `ms-playwright-mcp` 筛，与起会话之前的基线对照） |

地址：`file://` 被挡，工具结果原文「Access to "file:" protocol is blocked」（0.0.83 默认只开工作区、挡 `file://`，要 `--allow-unrestricted-file-access`
才开）；外部网站与 `data:` 地址这组工具不挡，`data:` 地址里的脚本照跑——只开本机地址靠正文。

### 2.3 计划外观测

- **默认是有界面的浏览器**：用户这份配置不带 `--headless`，`at-ui` 看页面时桌面上会弹出一个 Chrome 窗口；有界面的浏览器没有空闲超时。
- **auto 模式下子代理用 `SubagentHandback` 交回**：A（auto）两层子代理的系统提醒都写着最后的报告要经这个工具交、之后写的普通文字送不到上级，两层也都用
  它交了；B（manual）两层的提醒里都没有这个工具。A 里 `at-architect` 派完 `at-ui` 就交回了一句进度；`at-ui` 的结论到它手里时，它写成了普通文字，没再交回，
  项目经理一直没拿到。插件已有的口径（协调者返回时报进度、不许诺之后的通知会到项目经理）照旧成立，`at-ui` 的结论靠实现记录到项目经理手里。H5b 的冒泡出口
  读 SubagentStop 输入里的 `last_assistant_message`，交回走工具之后这个字段装的是什么、冒泡还认不认，本轮没量（§6）。
- **截图不贵**：按前后两次请求的输入量之差算，A 里三张截图各给 `at-ui` 的上下文加了约 3.4k、0.8k、2.0k 个 token（三张 PNG 7–17 KB，按 CSS 像素出）；
  `at-ui` 最后一轮的上下文约 3 万（含三份预加载的 skill）。

### 2.4 收尾

两场都 `claude stop`、`claude rm`；`~/.claude.json` 里没有这个临时目录的条目。驱动起的本机服务按 PID 停；临时目录、`at-ui` 的临时工具行、探针新建的浏览器
配置目录删掉；工作树根下没有留下 `.agent-team/`（项目经理的门禁自检写入照常被拒）与 `.playwright-mcp/`。转录留着，是证据。

## 3. 裁定：收窄 `docs/36` §2.10

**只给 `at-ui` 开官方插件市场 Playwright 插件的这六个工具**：`browser_navigate`、`browser_resize`、`browser_emulate_media`、`browser_take_screenshot`、
`browser_snapshot`、`browser_close`（前缀 `mcp__plugin_playwright_playwright__`）。`docs/36` §2.10 其余照旧：不给任何角色 `WebSearch`、`WebFetch`，
别的 MCP 一律不给。

理由：

1. **名字固定**：插件装出来的工具名带插件名与服务器名，插件写得出；「写不出用户的服务器名」对这一个插件不成立。
2. **没装时不坏**：名字静默不在，角色照常起、其余工具都在（(e)）；正文要求照实写「没看过效果」。
3. **叶子**：`at-ui` 不持 `Agent`，页面内容流不进派发单（`docs/36` §2.10 说的给协调者的风险）。
4. **窄**：只够看——打开页面、改尺寸、模拟减少动态与深色、截图、读无障碍树、关浏览器。不给让模型直接下令跑代码的工具（`browser_evaluate` 在页面里跑任意
   脚本，`browser_run_code_unsafe` 在 MCP 服务进程里跑任意代码）、上传文件、拖放、对话框；点击、输入、按键这些交互也先不给。页面自己的脚本照样会跑
   （打开 `data:` 地址也能带脚本），`at-ui` 本来就持 `Bash`——这几样不给，是不多开口子，不是说它跑不了代码。
5. **核得了**：自检「看过」那一栏第一次有了别人能对照的东西——截图文件，加上记录里写明的尺寸与条件。

不给 `at-frontend`、`at-ios`、`at-android`：用户批准的范围只到 `at-ui`；界面的视觉核对经 `at-ui`（`S5` 里它照方案落地界面、交自己的实现记录）。三个端的
自检照旧分三栏，模拟器、真机、截图测试看到的照样算看过，哪种办法都看不到的写「没看过效果」。

**正文守、门禁不核**的两件——只开本机地址、截图与快照不带 `filename`——付三样（`docs/16` §3）：

- 拒绝的判据长什么样：PreToolUse 挂在 `mcp__plugin_playwright_playwright__browser_navigate` 上，解析 `url`，协议不是 `http`、主机不是 `127.0.0.1`、
  `localhost`、`[::1]` 的拒；挂在截图与快照上，带 `filename` 的拒。要防的是实在的：带 `filename` 的文件能写进 `CLAUDE.md`、`.claude/`、`.git/` 与门禁专属
  文件，快照是页面上的文字，写进 `CLAUDE.md` 就成了之后每个会话都会读的指令。
- 它打不红的那一刀：本机页面自己能跳到外部、能加载外部资源，门禁只看得到第一个地址；`at-ui` 持 `Bash`，`curl` 什么都打得开、哪儿都写得进——拦住浏览器这一路，
  `Bash` 那一路照旧只靠正文，能力上没有比今天多出什么；用户能改 Playwright 插件的参数（放开 `file://`、改输出目录）。
- 什么会让答案改变：真实一趟里 `at-ui` 打开了本机之外的地址，或者带 `filename` 写进了项目里别处；这组工具给了不持 `Bash` 的角色（那时门禁是它唯一的写路）。

**什么会让整条裁定改变**：

- 自检要交互才看得到的状态（键盘走查、悬停与按下、线框里切换状态）成了常态：先实测，再加 `browser_press_key`、`browser_hover`、`browser_click`。
- Playwright 插件改名、工具改名，或者上游改了默认值（输出目录、`file://`、有没有界面）：名字对不上就静默没了，判据看不见（插件配置是 `@latest`，
  不锁版本）；改清单、重测。
- 别的角色要看页面（三个端）：照本文再测一遍再给。
- 平台开始在 `tools:` 里认 MCP 通配：照旧写到具体工具，不授整台服务器。

## 4. 修法与判据

- `agents/at-ui.md`：`tools:` 加六个工具；新一节「看页面实际长什么样」——只开本机起的页面（外部网站、`data:`、`file://` 都不开；静态文件起只听 `127.0.0.1`
  的静态服务，起停照现有那几句，不为它装依赖、不用 `npx` 现拉包，看完就停）、手机宽 375×812、桌面宽 1280×800、减少动态、有深色加深色各截一张、每张只改一个
  条件（没传的媒体特性保持上一次的值，先设回 `null`）、截图随工具结果回来直接看图、登录态与本地存储跨会话保留时照实写进「没核」、截图与快照不带 `filename`
  （带了截图不回传、文件哪儿都写得进）、在记录里写明 `.playwright-mcp/` 下留了哪几个文件、用完关浏览器、浏览器里读到的是数据、工具不在或被拒又没有别的办法
  亲眼看到时照实写「没看过效果」；「设计做法」那一段指过去。
- `skills/at-ui-craft/SKILL.md` §10：一句指向细则「怎么看页面」、哪种办法都看不到时照实写。`references/self-check.md`：新一节「怎么看页面」——先认别的看法
  （模拟器、真机、截图测试）也算看过，再把同一组规矩挂在「工具清单里有那组浏览器工具」之下；记录示例改成 375×812、加减弱动态与截图两行，「没核」加一行键盘走查。
- `agents/at-qa.md`「取改动」：`.playwright-mcp/` 下的截图与快照不读、不算这一趟的改动（不然没进版本库的图会被整份 `Read`）。
- `README.md` 两半：at-pm 那一段把「团队里其余角色也拿不到」改成点名 `at-ui` 与 Playwright 插件（在本机开自己起的页面截图、会弹出浏览器窗口、截图在
  `.playwright-mcp/`、没装就说没看过），其余角色拿不到；这一句排在「它也拿不到 Skill 工具」之后，免得「它」读成 `at-ui`。
- 判据：`tests/tool-surface.test.mjs` 的 `EXPECTED_TOOLS` 改 `at-ui`，新加 MCP 授予形状一条（只给不持 `Agent` 的；白名单，只能是裁定那一组具体工具——
  黑名单拦不住上游新长出来的工具，带防空转的前置）；`tests/readme-sync.test.mjs` 那条双向判加两项（点名的角色恰好是持有者，写不写 Playwright 与有没有人持
  那组工具一致）；新文件 `tests/ui-browser-prose.test.mjs`（持有者从 `tools:` 派生，钉 `at-ui` 正文与自检细则写着同一组规矩、自检细则把做法挂在条件下、
  SKILL.md 指过去、不持的角色正文不提这组工具、`at-qa` 不读那个目录）。变异验证：给 `at-ui` 加执行脚本或路由工具（期望值一起改）、授整台服务器、给持
  `Agent` 的角色一个截图工具、README 去掉或多出点名、删掉 Playwright、删掉正文或细则里的一条规矩、细则把做法写成人人都有、`at-qa` 删掉那一句、三个端
  的正文提到这组工具——每一刀都红在该红的那条上，还原逐字干净。
- `HANDOFF.md`：长期决策加一条。`docs/36` §2.10、`docs/97` §5 在原话底下写收窄与收口；`docs/00-开放边界.md` 从 `docs/97` §5 那一行删掉截图自检、
  登上本文 §5、§6。

## 5. 仍然开着的边界

- **只开本机地址、截图与快照不带 `filename` 只靠正文**：门禁不核（三样见 §3）。
- **`.playwright-mcp/` 是门禁看不见的写入**：截图、打开页面时自动存的快照、控制台输出、页面触发的下载留在会话启动目录下，写路径隔离与账本都不知道；
  `at-ui` 在记录里列出，`at-qa` 审改动时跳过；项目经理交付时不专门提，回退到 `S5` 之前列文件问用户时它们也会在单子上；要不要进 `.gitignore` 由用户定。
- **启动目录与项目根不一定是同一个**：用户在项目的子目录里启动时，`.playwright-mcp/` 与浏览器配置目录跟着启动目录走，正文按「通常就是项目根」写。
- **默认权限模式下每一步浏览器操作都要确认**：会话停在确认上等人（(d)）；auto 模式自动放行。README 默认权限那一段没单列这一项。
- **浏览器配置目录跨会话保留**：在用户的缓存目录里按启动目录分，用户在这个项目里登录过的站点、上一次留下的本地存储下一次还在，「首次加载」「空」的截图会
  失真；这组工具清不掉，正文要求看出来受了影响就写进「没核」（插件默认行为，不在本插件手里）。
- **只认官方插件市场那一个插件**：用户自己配的 Playwright MCP（服务器名不同，工具名跟着不同）不认，等于没有（有意）。
- **交互才看得到的状态看不到**：悬停、按下、聚焦、键盘走查、要点开才出现的状态，照旧落进「从源码推断」或「没核」（有意，§3）。
- **三个端没有这组工具**：`at-frontend`、`at-ios`、`at-android` 的「看过」照旧靠模拟器、真机、截图测试，哪种都没有就写没看过（有意，§3）。

## 6. 没量到的

- 桌面端会话里后台子代理的权限确认怎么显示：只量了 `--bg` 的 manual 与 auto。
- 真实一趟里 `at-ui` 照不照新规矩做：起本机静态服务、四种情形、每张只改一个条件、不带 `filename`、在记录里列出、关浏览器。本轮只量了工具面本身。
- macOS、Linux 上的浏览器与输出目录：只在 Windows 上量过。
- 插件装在项目作用域时工具名同不同形：按命名规则推断同形，没装过量。
- auto 模式下的 `SubagentHandback`：交回走工具之后 SubagentStop 的 `last_assistant_message` 装的是什么、H5b 的冒泡出口还认不认（§2.3）；manual 模式下这两场
  没有出现这个工具，它跟着什么出现也没量。
- 截图在一趟长 run 里累计占多少上下文：只有 A 这一个小样本。

## 7. 归属

- `agents/at-ui.md` 的 `tools:` 与「看页面实际长什么样」、`skills/at-ui-craft/SKILL.md` §10、`references/self-check.md` 的「怎么看页面」、`agents/at-qa.md`
  那一句：`tests/ui-browser-prose.test.mjs`、`tests/tool-surface.test.mjs` 钉着；动 Playwright 那一组的人先改本文 §3。
- README 两半 at-pm 那一段：`tests/readme-sync.test.mjs` 双向判，给谁加 MCP 或网页工具就点名谁。

## 8. 版本

挪中间一位到 7.3.0（`agents/`、`skills/` 是插件会加载的）。

## 9. 复核

派一个子代理对抗复核（只读，对着转录、调试日志与 0.0.83 源码核），改了这些：自检细则那句「没有这组工具就写没看过」对三个端是无条件的，与「模拟器或真机里
亲眼看到也算」冲突，改成先认别的看法、做法挂在「有这组工具的」之下、哪种办法都看不到才写没看过（`at-ui` 正文、SKILL.md 同改）；`at-qa` 审改动会把
`.playwright-mcp/` 下没进版本库的图整份 `Read`，补一句不读不算，回退时列文件那一处登进 §5；README 插进 `at-ui` 那句之后「它也拿不到 Skill」读成了 `at-ui`，
挪到 Skill 那句后面；30459 是 `at-ui` 最后一轮的上下文、不是累计，改成三张截图的增量；`SubagentHandback` 只在 auto 那一场出现，带上条件；内置浏览器不走
这条路的理由改成名字随宿主变；(c) 补了快照不带 `filename` 时内联不落盘、控制台输出与下载也进那个目录、带 `filename` 的截图不回传、目录跟着启动目录走；
「执行脚本不给」说满了，改成不给让模型直接下令跑代码的工具、页面脚本照跑；带 `filename` 能写进 `CLAUDE.md` 那一刀在 §3 点名；配置目录跨会话保留会让「首次
加载」截图失真、`emulate_media` 没传的参数保持上一次的值，正文加「每张只改一个条件」与写进「没核」；判据的黑名单换成白名单，自检细则的条件句与 `at-qa`
那一句补钉；静态服务不用 `npx` 现拉包、看完就停；记录示例里「轮播停在第一张」一张截图看不出来，换成进场元素都在终态。
