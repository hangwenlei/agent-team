# 一段该交哪些产物

`/agent-team:at-resume` 与 `/agent-team:at-status` 要回答「某一段的产物齐没齐」时照这里展开。规则的单一真源是
`${CLAUDE_PLUGIN_ROOT}/hooks/lib/stages.mjs` 的 `expandProduces`，这里写的是它做什么；两边对不上时以代码为准。

## `produces` 的三种写法

`${CLAUDE_PLUGIN_ROOT}/stages.json` 里每一段的 `produces` 列这一段要交的产物。`producers` 列这一段允许交东西的角色；没有 `producers` 的段，
产者只有 `role` 那一个。

| 写法 | 例子（`${CLAUDE_PLUGIN_ROOT}/stages.json`） | 这一段要交的 |
|---|---|---|
| 字面文件名的数组 | S3 的 `["03-arch.md", "03-alignment.md"]` | 数组里的每一份，与这一段叫到了谁无关 |
| 含 `<role>` 的数组 | S5 的 `["05-impl/<role>.md"]` | 这一段叫到的每个产者各一份，`<role>` 换成它的角色名（例：`05-impl/at-backend.md`）；数组里不含 `<role>` 的条目照字面算一份 |
| 对象 | S2 的 `{"at-product": ["01-prd.md"], "at-ui": ["02-ui-spec.md", "02-wireframe.html"]}` | 这一段叫到的每个产者自己名下的那几份；对象里没有它的键，它在这一段不交东西 |

照字面拿后两种去 `Glob` 查不到东西：`05-impl/<role>.md` 不是文件名，对象也不是文件名清单。

## 「这一段叫到的产者」怎么取

1. 读 `state.json` 的 `stage_roles` 里这一段的键：那是这一段叫到的人。没有 `stage_roles` 字段的旧 run，退回整趟的 `roster`。
2. 只留这一段的产者（`producers`，没有就是 `role`）。`stage_roles` 里不是这一段产者的人（例：S5 里负责分发的 `at-architect`）
   本来就该在，展开时去掉，不是状态不一致，不要去删它。
3. 照上面那张表展开。

`stage_roles` 有、却还没有这一段的键：这一段还没记账（项目经理在推进出一段时才记它），后两种写法按人展开的那部分是空的。**空不算齐了**——
怎么判、怎么报，照命令正文里那一节。键在、值是 `[]`：记了账、这一段一个产者都没叫（整段裁掉的段就是这样），后两种写法按人展开的那部分
同样是空的。

有 `stage_roles` 的 run，别拿整趟 `roster` 去展开：`at-ui` 在 S2 交过东西，S5 就会去等一份它没被派去写的实现记录。
