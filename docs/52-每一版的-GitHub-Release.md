# 每一版的 GitHub Release

> 2026-10-07，M4q，分支 `m4q-github-release`。第十轮，从 `docs/00-开放边界.md` §1 挑的：第 45 条剩下的「GitHub Release 没有任何记录处置过」——
> `docs/47` 做了 tag 与 `CHANGELOG.md`，没提 Release；载荷挪进子目录照旧暂缓。

## 0. 一句话结论

- 推 `main` 之后，CI 的 `tag` 作业打完 tag，再给这一版（`plugin.json` 的版本）建一条 GitHub Release：名字是 tag，正文是 `CHANGELOG.md` 里这一版
  那一行。tag 不在远端不建，已经有了不动，远端标着的「最新」那一条版本更高时不抢「最新」。历史上的各版不补（有意，§1.2）。

## 1. 修法与裁定

### 1.1 建这一版的 Release

- `scripts/github-release.mjs`（CLI 外壳）读 `plugin.json` 的版本与 `CHANGELOG.md`，交给 `scripts/lib/release.mjs` 的 `ensureRelease`；正文取自
  `scripts/lib/version-bump.mjs` 的 `changelogEntry`（与版本检查同一个行格式，版本号整段比）。经 GitHub 的 REST API 依次：
  1. 查 tag 在不在远端：不在就不建、算失败——建 Release 时 tag 不在，GitHub 会在默认分支的 HEAD 上新打一个，而一版的 tag 要打在 `plugin.json`
     第一次是它的那个提交上（`docs/47`）；
  2. 查这一版的 Release 在不在：在就不动、算成功（作业重跑不重复建）；
  3. 查远端标着的最新一条：它的版本更高时，这一条建出来不抢「最新」（重跑一个旧版的作业时会这样）；没有、或者认不出版本号的，照常标最新。版本号按数比；
  4. 建：`tag_name` 与 `name` 都是 tag，正文是那一行，不是草稿、不是预发布。
- 哪一步回的不是预期的状态、或者调用抛了异常，都算失败、不往下走，退出码 1——作业红，重跑即可。`CHANGELOG.md` 里没有这一版、版本号不是 x.y.z、
  缺令牌或仓库名时不调 API；CLI 缺环境变量时说一句就停。
- `ci.yml` 的 `tag` 作业在打 tag 那一步之后加一步，`if: ${{ !cancelled() }}`：打 tag 那一步红了也跑。补不上的旧版 tag（`docs/47` 的订正：GITHUB_TOKEN
  推不了指向「带着与 main 现在不同的工作流文件」的提交的 tag）会让打 tag 那一步一直红，跟着不跑就永远建不出这一版的 Release；这一步自己先核 tag 在不在
  远端，照跑不会建错。令牌是作业的 `github.token`，这个作业本来就有 `contents: write`。

### 1.2 历史上的各版不补（有意）

- **拒绝的做法**：照 tag 那样，把远端缺 Release 的各版都补上。
- **不补的理由**：在 Watch 里订了 Release 的人每一条收一封通知，补历史就是一次收一串；Release 页按建的时间排，补出来的旧版会挤在最前面；
  各版改了什么，tag 与 `CHANGELOG.md` 都有了。
- **什么会让答案改变**：有用户要钉某一个旧版、需要它的 Release 页；或者 Release 页成了用户找更新记录的主要入口。
- 第一条 Release 是合并这一轮的那一版（3.3.1）。

## 2. 判据与变异

- `tests/github-release.test.mjs`：
  - `changelogEntry`：取这一版那一行，版本号整段比（3.3.1 不认 3.3.10 那一行），CRLF 也认，没有给 null；
  - `ensureRelease`（经假的 fetch，不碰网络）：建（请求体整份核，令牌与 API 版本头）；已有不动；tag 不在远端不建、也不再往下查；「最新」按版本号的数比
    （3.3.10 比 3.3.9 新、比 3.3.1 新），认不出版本号的照常标；各步回错的状态与抛异常都算失败；缺东西不调 API；
  - CLI：缺 `GITHUB_TOKEN` 或 `GITHUB_REPOSITORY` 时退出码 1、只说一句；
  - `ci.yml`：那一步在 `tag` 作业里、排在打 tag 之后、红了也跑、令牌经 env 传。

变异（备份在仓库外，改完逐字节还原）各红：tag 不在远端也往下走；查 tag、查 Release、查最新、建，各步回错不算失败；已有的也再建；一律标最新；版本号
按字符串比；认不出版本号的不标最新；正文不用 `CHANGELOG.md` 那一行；建成草稿；不带令牌头；异常不接住；缺令牌也调 API；`CHANGELOG.md` 没有这一版也建；
版本号按前缀认；CLI 缺环境变量也往下走；CI 那一步跟着打 tag 红；CI 不传令牌。第一版里「版本号按字符串比」「CLI 缺环境变量也往下走」两刀存活，
补了 3.3.9 对 3.3.10 那一格与「只说一句」之后打红。

## 3. 实测

- 对真的 GitHub API 跑了一遍 `ensureRelease`（本机 `gh` 的令牌；查询照发，建的那一次拦下不发）：3.3.0 的 tag 查得到（200），它的 Release 与「最新」
  都没有（404），拦下的请求体是 3.3.0 那一行、标最新；不存在的一版，tag 查不到（404），不往下走。仓库里一条 Release 都没建。
- CI 里第一次真建 Release 在合并这一轮之后，结果写在合并之后的收口里。

## 4. 仍然开着的边界

- **历史上的各版没有 Release**（§1.2，有意）。
- **Release 正文只有 `CHANGELOG.md` 那一行**：没有附件（插件装的是整个仓库，没有构建产物），没有逐提交的说明。
- **建失败只是作业红**：tag 已经打上、插件已经能更新；Release 要重跑作业才补得上，不重跑就一直缺着（下一版的作业只建下一版的）。
- **载荷挪进子目录**：照旧暂缓（`docs/47` §4）。

## 5. 没量到的

- CI 里用 `github.token` 真建一条 Release（合并之后看）。
- 订了 Release 的人收到的通知长什么样。

## 6. 归属

- `scripts/github-release.mjs`、`scripts/lib/release.mjs` 的 `ensureRelease`、`scripts/lib/version-bump.mjs` 的 `changelogEntry`、`ci.yml` 的 `tag` 作业；
  判据在 `tests/github-release.test.mjs`。

## 7. 受影响的旧说法

以本文为准，原话不改，订正与收口写在原话的标题底下：

- `docs/39` §2.4（第 45 条）：写了收口（Release 那一点）。
- `docs/24` §5：追加了这一轮的更新。
- `docs/51` §3「复核修订推上去之后的结果写在合并之后的收口里」：上一轮合并之后的结果补在那一节标题底下。
- `docs/00-开放边界.md`：第 45 条那一行改了，这一份的 §4、§5 登上。
