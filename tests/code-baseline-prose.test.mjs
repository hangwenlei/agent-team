// 第 39 条（docs/49，M4n）：返工回到 S5 之前的段时，S5 写进项目的代码还在工作树里，原来谁也说不清这一趟改过什么。S4 写派发裁决时用不改工作树、
// 暂存内容与历史的 git 命令记下代码基线（04-dispatch.md 第 6 节）；走过 S5 之后回到 S5 之前，照它列出改过的文件，要不要退回基线照 sensitive 问用户；
// 批准退回的只按文件退、不用整棵树的命令、不碰 .agent-team/。门禁不跑 git、不读这一节，判据钉的是正文与模板里承重的那几句。
// 复核（docs/49 §8）：还没有提交、monorepo 的子目录、未跟踪的目录、中文文件名、删掉的文件、更早建的 run，原来都没说；「退回」原来没限定做法。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
// 比之前去掉全部空白：正文按显示宽度折行。
const squash = (s) => s.replace(/\s+/g, '')
const has = (text, k) => squash(text).includes(squash(k))

function section(text, head) {
  const lines = text.split(/\r?\n/)
  const i = lines.findIndex((l) => l.startsWith(head))
  if (i < 0) return null
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

const TEMPLATE = [
  '在项目根跑，只用不改工作树、暂存内容与历史的 git 命令',
  '`git rev-parse --show-toplevel` 报错的，写「不是 git 仓库」',
  '`git rev-parse --verify -q HEAD` 的输出（没有输出的写「还没有提交」）',
  '`git --no-optional-locks -c core.quotepath=off status --porcelain -uall -- .` 里 `.agent-team/` 之外的条目（没有就写「干净」）',
  '不 add、不 commit、不打 tag、不 stash',
  '这一节照抄上一次记的，不重记',
  '上一次没有这一节的（更早建的 run、漏记了），写「没记」，不补记',
]
test('第 39 条：04-dispatch.md 有「代码基线」一节——在项目根、不改仓库的命令、几种情形怎么写、返工轮不重记', () => {
  const sec = section(read('templates/04-dispatch.md'), '## 6. 代码基线')
  assert.ok(sec, 'templates/04-dispatch.md 里没有「## 6. 代码基线」')
  for (const k of TEMPLATE) assert.ok(has(sec, k), `代码基线那一节缺「${k}」`)
})

test('第 39 条：/agent-team:at 的 S4 写派发裁决时记代码基线', () => {
  const at = read('commands/at.md')
  const s4 = at.slice(at.indexOf('- **S4 裁决**'), at.indexOf('- **S5 实现**'))
  assert.ok(s4.length > 0, '前置：找不到 S4 那一条')
  assert.ok(has(s4, '以及代码基线（模板那一节：在项目根用不改工作树、暂存内容与历史的 git 命令记，不 add、不 commit、不打 tag、不 stash）'), s4.slice(0, 200))
})

const ROLLBACK = [
  '**走过 `S5` 之后回到 `S5` 之前的段，代码不跟着回退**',
  '照 `04-dispatch.md`「代码基线」那一节记的',
  '`git -c core.quotepath=off diff --name-status <基线> -- .`',
  '照第 4 节的 `sensitive` 问要不要把代码退回基线',
  '问的时候点明会丢什么',
  '只按文件退列出来的那几份',
  '不用 `reset`、`clean`、`checkout`、`stash` 这类整棵树的命令，不碰 `.agent-team/`',
  '批准的那几条命令写进契约的修订记录',
  '同一趟里问过、用户说留着的',
  '基线写着「不是 git 仓库」或「没记」的，照实告诉用户代码退不回去，列出各份实现记录里写过的文件',
  '回到 `S5` 本身不用问',
]
test('第 39 条：/agent-team:at 的「回退」——回到 S5 之前，照基线列出改过的文件，退不退回照 sensitive 问用户、只按文件退', () => {
  const at = read('commands/at.md')
  const rb = at.slice(at.indexOf('### 回退'), at.indexOf('## 4. 什么时候必须停下来问用户'))
  assert.ok(rb.length > 0, '前置：找不到「回退」一节')
  for (const k of ROLLBACK) assert.ok(has(rb, k), `「回退」一节缺「${k}」`)
})

// docs/99：收口写交付文档时列出这一趟改了哪些文件——照代码基线、与「回退」同一套只读 git 命令；`.agent-team/` 与 `.playwright-mcp/` 不列；
// 基线时已有改动的路径单列；基线记不了账的照实写、改按实现记录列。收口时告诉用户这份清单在哪，收不收进版本库由用户自己做（不给选项、不跑命令）。
const DELIVERY = [
  '交付文档里还要写**这一趟改了哪些文件**',
  '照 `04-dispatch.md`「代码基线」那一节记的情形',
  '与第 3 节的「回退」同一套只读 git 命令列出新增、修改、删除的文件',
  '`git -c core.quotepath=off diff --name-status <基线> -- .` 列出改过、新加、删掉的',
  '再用那一节的 `status` 命令补上没进版本库的新文件',
  // 复核（docs/99 §9）：没有提交时 status 里已有的文件都是 `??`，比得出的只有新加、删掉；那时就在的文件一句话说明，不逐个列。
  '基线写着「还没有提交」的，没有可比的提交：拿那一节记的 `status` 与现在的比，只分得出新加、删掉的文件',
  '那时就在的文件这一趟改没改看不出来，写一句说明、不逐个列',
  '这一趟里用户做了第一次提交的，也照实写明比不准',
  '`.agent-team/` 与 `.playwright-mcp/`',
  '下的不列',
  '那时就已经有改动的路径单独列一组，注明是这一趟之前就有的改动',
  '这份单子是自基线以来的',
  '基线写着「不是 git 仓库」或「没记」的，写明这一趟对不了账，改照各份实现记录里写过的文件列',
  '只列、不动',
]
const TELL = [
  '这一趟改了哪些文件，告诉用户在 `08-delivery.md` 的哪一节',
  '收不收进版本库、怎么收，由用户自己做',
  '不列提交、丢弃这类选项让用户挑',
  '你也不跑动工作树或历史的 `git` 命令',
]
test('docs/99：收口写交付文档时列出这一趟改了哪些文件；收口时告诉用户在哪、收不收进版本库由用户自己做', () => {
  const at = read('commands/at.md')
  const s6 = at.slice(at.indexOf('## 6. 收尾'))
  const three = s6.slice(s6.indexOf('**三、写交付文档**'), s6.indexOf('**四、'))
  const five = s6.slice(s6.indexOf('**五、'), s6.indexOf('**收口之后这一趟就冻结了**'))
  assert.ok(three.length > 0 && five.length > 0, '前置：找不到第三步或第五步')
  for (const k of DELIVERY) assert.ok(has(three, k), `第三步缺「${k}」`)
  for (const k of TELL) assert.ok(has(five, k), `第五步缺「${k}」`)
  // 只用只读的 git 子命令：与「回退」列文件那一句同一套（diff、status）。
  const used = [...three.matchAll(/git (?:--no-optional-locks )?(?:-c \S+ )?([a-z-]+)/g)].map((m) => m[1])
  assert.ok(used.length > 0, '前置：第三步一条 git 命令都没认出来')
  for (const sub of used) assert.ok(['diff', 'status'].includes(sub), `第三步用了 git ${sub}`)
})

test('第 39 条：项目经理的红线与续跑接上代码基线——批准的退回不算代笔；停在 S4 的续跑核这一节', () => {
  assert.ok(has(read('agents/at-pm.md'), '用户批准、写进修订记录的退回代码基线不算，照 `/agent-team:at` 的「回退」只按文件退'), 'agents/at-pm.md')
  assert.ok(has(read('commands/at-resume.md'), '`04-dispatch.md` 要有「代码基线」一节，没有就照模板那一节现在补上'), 'commands/at-resume.md')
})
