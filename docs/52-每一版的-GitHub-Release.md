# 每一版的 GitHub Release

> 2026-10-07，M4q，分支 `m4q-github-release`。第十轮，从 `docs/00-开放边界.md` §1 挑的：第 45 条剩下的「GitHub Release 没有任何记录处置过」——
> `docs/47` 做了 tag 与 `CHANGELOG.md`，没提 Release；载荷挪进子目录照旧暂缓。正文是复核修订之后的样子，复核与改了什么在 §8。

## 0. 一句话结论

- 推 `main` 之后，CI 的 `tag` 作业打完 tag，再给 3.3.1 起、还没有 Release 的各版建一条 GitHub Release：名字是 tag，正文是 `CHANGELOG.md` 里这一版
  那一行。认法与打 tag 同一份——tag 不在远端、或者在远端指向的不是认法要的那个提交，不建；已经有了不动；远端标着的「最新」那一条版本更高时不抢「最新」。
  3.3.1 之前的各版不补（有意，§1.2）。

## 1. 修法与裁定

### 1.1 建 Release

- `scripts/github-release.mjs`（CLI 外壳）照 `tag-release.mjs` 的认法算出每一版的 tag 该打在哪个提交上（`scripts/lib/release.mjs` 的 `pluginVersionEntries`
  与 `firstCommitPerVersion`，两个 CLI 共用一份），取 3.3.1 起的各版（`releaseTargets`：按版本号从低到高，按数比），逐版交给 `ensureRelease`；正文取自
  `scripts/lib/version-bump.mjs` 的 `changelogEntry`（与版本检查同一个行格式，版本号整段比）。哪一版没建成，别的照建，退出码 1。
- `ensureRelease` 经 GitHub 的 REST API 依次：
  1. 查 tag 在不在远端：不在就不建、算失败——建 Release 时 tag 不在，GitHub 会在默认分支的 HEAD 上新打一个，打错地方；
  2. 核 tag 指着的提交（附注 tag 剥开到提交）是不是认法要的那个：不是就不建、算失败，说出两头——打 tag 那一步对这个 tag 报的是同一个冲突、不挪已有的
     tag，这里也不在错的地方建；
  3. 查这一版的 Release 在不在：在就不动、算成功（作业重跑不重复建）；
  4. 查远端标着的最新一条：它的版本更高时，这一条建出来不抢「最新」（补建一个旧版、重跑一个旧版的作业时会这样）；没有、或者认不出版本号的，照常标最新；
  5. 建：`tag_name` 与 `name` 都是 tag，正文是那一行，不是草稿、不是预发布，不带 `target_commitish`（tag 已经在远端，Release 跟着它）。
- 哪一步回的不是预期的状态、或者调用抛了异常，都算失败、不往下走。`CHANGELOG.md` 里没有这一版、版本号不是 x.y.z、不知道 tag 该在哪个提交、缺令牌
  或仓库名时不调 API；CLI 缺环境变量时说一句就停。
- `ci.yml` 的 `tag` 作业在打 tag 那一步之后加一步，`if: ${{ !cancelled() }}`：打 tag 那一步红了也跑。补不上的旧版 tag（`docs/47` 的订正：GITHUB_TOKEN
  推不了指向「带着与 main 现在不同的工作流文件」的提交的 tag，GitHub 按 ref 逐个拒、别的照推，`docs/48`）会让打 tag 那一步一直红，跟着不跑就永远建不出
  这一版的 Release；这一步自己核 tag 在不在、指没指对，照跑不会建错。令牌是作业的 `github.token`，这个作业本来就有 `contents: write`。
- 一次推送带进好几版（例如上一次推 main 红了、没走到 tag 作业，下一次带着两版进来）：打 tag 那一步把缺的 tag 都补上，这一步把 3.3.1 起缺 Release 的
  各版都建上。

### 1.2 3.3.1 之前的各版不补（有意）

- **拒绝的做法**：照 tag 那样，把远端缺 Release 的各版从头补上。
- **不补的理由**：在 Watch 里订了 Release 的人每一条收一封通知，从头补就是一次收一大串；Release 页按建的时间排，补出来的旧版会挤在最前面；
  各版改了什么，tag 与 `CHANGELOG.md` 都有了。
- **什么会让答案改变**：有用户要钉某一个旧版、需要它的 Release 页；或者 Release 页成了用户找更新记录的主要入口。
- 起点是 `scripts/lib/release.mjs` 的 `RELEASE_FLOOR`（3.3.1，合并这一轮的那一版）；`CHANGELOG.md` 开头那一段写着同一句。

## 2. 判据与变异

- `tests/github-release.test.mjs`：
  - `changelogEntry`：取这一版那一行，版本号整段比（3.3.1 不认 3.3.10 那一行），CRLF 也认，没有给 null；
  - `releaseTargets`：3.3.1 起的各版，按版本号从低到高、按数比；
  - `ensureRelease`（经假的 fetch，不碰网络）：建（请求体整份核——不带 `target_commitish`；令牌、API 版本头、`User-Agent`）；已有不动；tag 不在远端不建、
    也不再往下查；tag 指向别的提交不建、说出两头，附注 tag 剥开之后再比、剥不开说回的状态；「最新」按版本号的数比（3.3.10 比 3.3.9 新、比 3.3.1 新），
    认不出版本号的照常标；各步回错的状态与抛异常都算失败；缺东西不调 API；
  - CLI：缺 `GITHUB_TOKEN` 或 `GITHUB_REPOSITORY` 时退出码 1、只说一句；在临时仓库里（`plugin.json` 依次是 3.3.0、3.3.1、3.3.2）经 `--import` 预载的假 fetch
    （`tests/fixtures/fake-github-fetch.mjs`）端到端跑：从低到高建 3.3.1、3.3.2，3.3.0 不碰，令牌与仓库名从环境变量来，建成退出码 0；建被拒退出码 1；
    一版的 tag 指错了，那一版不建、别的照建、退出码 1；
  - `ci.yml`：那一步就在 `tag` 作业里、排在打 tag 之后，这一步的几行逐行核（红了也跑、令牌经 env 传、不吞退出码），作业里没有 `continue-on-error`，别处
    不跑它。
- `tests/release.test.mjs` 照旧钉着打 tag 的认法（`pluginVersionEntries` 抽进 lib 之后，`tag-release.mjs` 走同一份）。

变异（备份在仓库外，改完逐字节还原）各红：

- 第一版的刀：tag 不在远端也往下走；查 tag、查 Release、查最新、建，各步回错不算失败；已有的也再建；一律标最新；版本号按字符串比；认不出版本号的
  不标最新；正文不用 `CHANGELOG.md` 那一行；建成草稿；不带令牌头；异常不接住；缺令牌也调 API；`CHANGELOG.md` 没有这一版也建；版本号按前缀认；
  CLI 缺环境变量也往下走；CI 那一步跟着打 tag 红；CI 不传令牌。第一版里「版本号按字符串比」「CLI 缺环境变量也往下走」两刀先存活，补了 3.3.9 对 3.3.10
  那一格与「只说一句」之后打红。
- 复核报存活、修订之后打红的：CLI 退出码恒 0、反过来，不认 `GITHUB_TOKEN`，读错仓库名，不传 fetch，发错版本号；CI 把 `if` 注释掉、吞掉退出码、那一步
  或整个作业 `continue-on-error`、挪进一个 `needs: [tag]` 的新作业；`tagVersion` 去掉尾锚（`v9.9.9-rc1` 那一格）；删掉 `User-Agent`。
- 修订新加的路径：不比 tag 指着的提交；附注 tag 不剥开；剥不开不算失败；不知道该在哪个提交也往下走；CLI 不按 3.3.1 起、一版没建成就停、只建 HEAD
  那一版；`releaseTargets` 不按版本排、不含 3.3.1 本身；版本历史不按 first-parent。
- 存活、不补判据的一刀：建成的判断从「回 201」放宽成「不到 400」——GitHub 建成只回 201，放宽了也认不出别的。

## 3. 实测

- 对真的 GitHub API 跑了 `ensureRelease`（本机 `gh` 的令牌；查询照发，建的那一次拦下不发）：3.3.0 的 tag 查得到（200，轻量 tag，`object.type` 是
  `commit`、`object.sha` 是合并提交 `784201e`）；认法要的就是它时往下走——它的 Release 与「最新」都没有（404），拦下的请求体是 3.3.0 那一行、标最新；
  假装认法要的是别的提交时不建、说出两头；不存在的一版，tag 查不到（404），不往下走。仓库里一条 Release 都没建。
- 分支第一次推（`6c753fb`）ci 三个系统与 min-node 全绿；复核修订推上去之后的结果、CI 里第一次真建 Release，写在合并之后的收口里。

## 4. 仍然开着的边界

- **3.3.1 之前的各版没有 Release**（§1.2，有意）。
- **Release 正文只有 `CHANGELOG.md` 那一行**：没有附件（插件装的是整个仓库，没有构建产物），没有逐提交的说明。
- **建失败只是作业红**：tag 已经打上、插件已经能更新；没建成的那一版，下一次推 main 时补（3.3.1 起缺的都补），等不及就重跑作业。
- **「最新」先读后写，不是原子的**：两次推 main 的 tag 作业并发时，有一个很小的窗口会把旧的一版标成最新。
- **手工建的草稿看不见**：查 Release 的那一问只认已发布的；有人给某一版手工建了草稿，这里当它没有、再建一条（或者被 GitHub 拒、作业红）。
- **载荷挪进子目录**：照旧暂缓（`docs/47` §4）。

## 5. 没量到的

- CI 里用 `github.token` 真建一条 Release（合并之后看）。
- 给一个指向旧提交（那个提交里的工作流文件与 main 现在不同）的已有 tag 建 Release 时，`github.token` 会不会像推这种 tag 一样被拒：GitHub 的文档说
  `target_commitish`（不传时是默认分支最新的提交）改过工作流时会拒；这里不传它、tag 已经在远端，平台按哪个提交判没量过。补建、重跑旧版的作业才会碰上。
- 订了 Release 的人收到的通知长什么样。

## 6. 归属

- `scripts/github-release.mjs`；`scripts/lib/release.mjs` 的 `ensureRelease`、`releaseTargets`、`pluginVersionEntries`（`tag-release.mjs` 也用它）与
  `RELEASE_FLOOR`；`scripts/lib/version-bump.mjs` 的 `changelogEntry`；`ci.yml` 的 `tag` 作业。判据在 `tests/github-release.test.mjs`，假的 API 在
  `tests/fixtures/fake-github-fetch.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/39` §2.4（第 45 条）：写了收口（Release 那一点）。
- `docs/24` §5：追加了这一轮的更新。
- `docs/51` §3「复核修订推上去之后的结果写在合并之后的收口里」：上一轮合并之后的结果补在那一节标题底下。
- `docs/00-开放边界.md`：第 45 条那一行改了，这一份的 §4、§5 登上。

## 8. 复核与修订

`6c753fb` 推上去之后一路对抗复核（代码、工作流与文档一起看，变异在仓库外的副本里做）。几个端点的语义、`make_latest` 用字符串、建成回 201、所需权限、
`!cancelled()` 的行为（前一步失败照跑、作业取消不跑、`needs` 失败整个作业跳过）都核过没问题；`CHANGELOG.md` 最长的一行进 Release 正文渲染得和原文一样。

- **中 1　这一版的 tag 指错了提交时，Release 照样建在它上面**：打 tag 那一步对冲突报错、不挪，`!cancelled()` 让这一步照跑，原来只看 tag 在不在。在功能
  分支上照 HANDOFF 的做法在本地补 tag，tag 就落在功能分支的提交上，`--no-ff` 合并之后认法要的是合并提交。**改**：照打 tag 的认法算出该在哪个提交、
  剥开附注 tag 再比，对不上不建（§1.1 第 2 步）；两个 CLI 的认法抽成一份（`pluginVersionEntries`）。
- **中 2　CLI 读到环境变量之后那条路没有判据**：退出码恒 0 或反过来、不认 `GITHUB_TOKEN`、读错仓库名、不传 fetch、发错版本号，单文件全绿，其中三刀整套也绿。
  **改**：临时仓库加 `--import` 预载的假 fetch，端到端跑 CLI（§2）。
- **低**：
  - CI 那一步只核字面，注释掉 `if`、`|| true`、`continue-on-error`、挪进 `needs: [tag]` 的新作业都存活——改成截到下一个作业、逐行核、作业里不许吞错；
  - 一次推送带进好几版时只建 HEAD 那一版，`CHANGELOG.md` 开头「3.3.1 起每一版」说过了头——改成 3.3.1 起缺的都补（§1.1 最后一条）；
  - 「最新」先读后写不原子、手工建的草稿看不见——登进 §4；
  - 已有 tag 指向的提交里工作流文件不同时 `github.token` 会不会被拒没量过——登进 §5；请求体整份核着，不带 `target_commitish`；
  - 三刀无害存活：`tagVersion` 去掉尾锚、删掉 `User-Agent`——补了 `v9.9.9-rc1` 那一格与头里的 `User-Agent`，打红；建成放宽成「不到 400」——不补（§2）。
