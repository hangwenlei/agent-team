# state.json 里认不出的键

> 2026-10-10，M4t，分支 `m4t-state-unknown-keys`。第十三轮，从 `docs/00-开放边界.md` §3 挑的：`docs/18` §5「`validateState` 不拒未知键（例如拼成
> `trimed`）」与 `docs/32` §4「新 run 漏写或拼错 `stage_roles` 时静默退回整趟口径」的拼错那一半。

## 0. 一句话结论

- 原来 `state.json` 里拼错的键门禁不读、一声不吭：`trimmed` 拼成 `trimed`，整段裁掉不算数；`stage_roles` 拼成 `stage_role`，按段的判据退回整趟 `roster`。
  现在 `validateState` 报认不出的键，像哪个已知键就点出它（「是不是 trimmed？」），进账本回传的【state.json】那一块。只报不拦。

## 1. 修法

- `hooks/lib/state.mjs` 的 `STATE_KEYS`：`state.json` 的键，与 `templates/state.json` 逐项相同（判据钉着，两边谁多谁少都红）。
- `validateState` 对每个不在里面的键报一行：「认不出的键 "…"：门禁不读它，它想写的那个字段等于没写——是不是 …？」。像不像按去掉下划线、连字符与
  空白、折成小写之后的编辑距离判，两步以内取最近的那一个；都不像就不猜，列出 `state.json` 的键。键名是磁盘上的值，过 `quote`。
- 只报不拦：H6 不读这一条（拦了，旧版本留下的过时字段会让每一次写 `state.json` 都被拒）；【state.json】那一块的出路照旧是「改完再继续」。

## 2. 判据与变异

- `tests/state-unknown-keys.test.mjs`：已知键与模板逐项相同、模板本身不报；拼错的各报一行、点出像的那一个（少一两个字母、下划线、连字符、大小写、
  分隔符堆叠、两个字母写错各一格）；不像的不猜、列出全部键；几个各报一行，键名过 `quote`。
- `tests/trusted-echo.test.mjs`：认不出的键本身是载荷，【state.json】不回显。

变异（备份在仓库外，改完逐字节还原）各红：不报认不出的键；不点像的那一个；只认差一步的；差三步的也认；不去分隔符；不折小写；已知键漏一个；键名
不过 `quote`；没像的也不列键；编辑距离里替换不算一步。存活的一刀：「取第一个像的、不取最近的」——今天的这些键长短差得开，找不出一个键名离前面
某个已知键两步以内、又离后面某个更近，与原代码等价。

## 3. 实测

- 没起真实会话：报告走账本回传的【state.json】那一块，与 `validateState` 别的几条同一条路。
- 分支 CI 的结果写在合并之后的收口里。

## 4. 仍然开着的边界

- **漏写的照旧静默**：新 run 没写 `stage_roles`，从 `state.json` 本身分不出它是新 run 漏写、还是没有这个字段的旧 run，照旧退回整趟口径。
- **只报不拦**：项目经理不改，拼错的字段照旧等于没写。
- **只看顶层的键**：`stage_roles`、`trimmed`、`rework_base` 里面的键（段名、角色名、产物名）有各自的检查，这一条不管。

## 5. 没量到的

- 真实会话里项目经理收到「认不出的键」之后改不改对（`docs/18` §5.1 问的是同一件事）。

## 6. 归属

- `hooks/lib/state.mjs` 的 `STATE_KEYS` 与 `validateState` 末尾那一段（`lookalikeKey`、`editDistance`）；判据在 `tests/state-unknown-keys.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/18` §5.1「`validateState` 不拒未知键」：写了收口。
- `docs/32` §4「新 run 漏写或拼错 `stage_roles`」：写了收口（拼错的那一半）。
- `docs/54` §3「分支 CI 的结果写在合并之后的收口里」：上一轮合并之后的结果补在那一节标题底下。
- `docs/00-开放边界.md`：`docs/18` §5、`docs/32` §4 那两行改了，这一份的 §4、§5 登上。
