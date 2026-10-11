# 每趟开头 reach.json 读不出也说没核

> 2026-10-11，分支 `r46-reach-unreadable-at-start`。第四十六轮（从开放边界索引挑）：`docs/79` §4「`reach.json` 在、却读不出来时不核」。只动门禁回传与判据。

## 0. 一句话结论

- 每趟开头写 `current-run` 时门禁核磁盘上的 `.agent-team/reach.json`（`docs/79`）。它在、却读不出来（被占用、它是个目录……）时原来一声不吭；现在【触达表】说
  它在、却读不出来、这一次没有核，照样给出按当前 `project.json` 与花名册算出来的那一份，叫项目经理原样重写（写不进去就告诉用户）。不是项目经理写指针的，照旧叫它冒泡。

## 1. 问题

- `docs/83` 把写 `reach.json` 那一刻「核不了也一声不吭」那一族关上了；每趟开头那一次核对还留着同一格：读不出就 `return null`。`/agent-team:at-status` 照它报
  各角色实际能写到哪里时也读不出，项目经理却没收到任何话，以为对上了。

## 2. 修法

- `hooks/gate.mjs` 的 `staleReachFor`：读 `reach.json` 抛的不是 ENOENT 时，记 `unreadable`，交给 `reachStaleNotice`。只读一次：短暂占用时多说一次，照着重写
  一份正确的也无害。
- `hooks/lib/ledger.mjs` 的 `reachStaleNotice` 加 `unreadable`：成因写「在、却读不出来（多半是被别的程序短暂占用，或者它不是一个文件），这一次没有核」，
  出路照旧给那份 JSON，补「写不进去就告诉用户」。
- `tests/reach-stale.test.mjs`：原来钉着「读不出不核」的那一句删掉，新加一条——读不出时说这一次没有核、给出的 JSON 等于按当前配置算的、不是项目经理写的叫它冒泡；
  读得出的照旧对得上不吭声；纯函数里 `unreadable` 盖过原文、不在照旧说不在。

## 3. 判据与变异

- 变异（备份在仓库外，改完逐字节还原，每刀跑全量），每一刀都红：读不出照旧不核、不在也当读不出、`reachStaleNotice` 不看 `unreadable`、去掉「写不进去就告诉用户」、
  成因去掉「这一次没有核」。

## 4. 仍然开着的边界

- **只在写 `current-run` 时核、只报不拦、at-status 自己不核**：照旧（`docs/79` §4）。
- **读不出的成因不细分**：被占用与它是个目录说同一句；写不进去的由项目经理告诉用户，门禁不替它删。

## 5. 没量到的

- 真实会话里每趟开头收到「在、却读不出来」之后，项目经理重写成功还是告诉用户。

## 6. 归属

- `hooks/gate.mjs`（`staleReachFor`）、`hooks/lib/ledger.mjs`（`reachStaleNotice`）；判据在 `tests/reach-stale.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/79` §4「`reach.json` 在、却读不出来时不核」：写了收口。
- `docs/00-开放边界.md`：`docs/79` §4 那一行改了，这一份的 §4、§5 登上。
