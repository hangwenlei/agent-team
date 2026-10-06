// M4e（docs/40，审查第 26、39、25、43 条）：持 Bash 的执行角色的敏感操作红线、shell 说明，协调者与 PM 怎么接，自检与 at-init 里
// 新加的几句。
//
// 门禁不看 Bash（hooks.json 的 PreToolUse 只挂 Agent 与 Edit|Write|NotebookEdit），执行角色手里的 Bash 能发包、推送、删文件、
// 跑 git clean——那一层只剩正文。所以红线逐字同一句、每个持 Bash 的执行角色都有，判据按 tools: 声明触发（持有 Bash 是能独立核实的
// 事实），不看正文用了哪个词（tests/agents.test.mjs 记过「换个同义词就整份被跳过」那一族）。
//
// 复核（docs/40 §3）：承重的句子整句钉住（空白不计）——只认关键词的判据挡不住「把话说反」（「不必停下」照样含「停下」）。红线的
// 清单从 /agent-team:at 第 4 节 sensitive 那一行逐项取来核：两处原来各写各的，多出来的一项在 PM 那一侧没有落点。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { toolsDeclarationOf } from './helpers/agent-tools.mjs'
import { BUBBLE_MARK, BUBBLE_WHEN } from '../hooks/lib/deliverable.mjs'
import { explainMissing } from '../hooks/lib/completion.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8')
const bodyOf = (f) => read(`agents/${f}`).split(/^---\s*$/m).slice(2).join('---')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const roster = JSON.parse(read('roster.json'))
const MAIN = JSON.parse(read('settings.json')).agent.replace(/^agent-team:/, '')

const AGENTS = readdirSync(url('agents')).filter((f) => f.endsWith('.md'))
const BASH_ROLES = AGENTS.filter((f) => toolsDeclarationOf(read(`agents/${f}`)).names.includes('Bash'))
// 执行角色：持 Bash、不是主会话。主会话（PM）碰到敏感操作是自己问用户（/agent-team:at 第 4 节的 sensitive），不冒泡。
const BASH_EXEC = BASH_ROLES.filter((f) => f !== `${MAIN}.md`)
// 只跑测试、不认领路径的那一类（at-qa）例外不同：它不改代码，要起停测试用的服务。按 tools: 里有没有 Edit 分——没有 Edit 的执行
// 角色改不了代码。
const QA_LIKE = BASH_EXEC.filter((f) => !toolsDeclarationOf(read(`agents/${f}`)).names.includes('Edit'))
// 协调者：派得到某个持 Bash 执行角色、又不是主会话的角色——执行角色为敏感操作冒泡，先到它们手里。
const COORDINATORS = Object.entries(roster)
  .filter(([k, v]) => k !== '__main__' && k !== MAIN && (v.can_delegate_to ?? []).some((r) => BASH_EXEC.includes(`${r}.md`)))
  .map(([k]) => `${k}.md`)

const RED_LINE =
  '- **敏感或不可逆的操作不做，停下冒泡**：凭据/密钥/密码；产生费用；对外发送或发布（发包、部署）；删除或覆盖非本趟产出的文件；' +
  '清空或改动非本趟建的数据（数据库、云上资源）；`git push` 或改远端；动 CI/CD 与生产配置；动工作树或历史的 `git` 命令（`clean`、' +
  '`stash`、`reset`、`checkout`、`switch`、`restore`、`rebase`、`commit` 这类——没进版本库的 `.agent-team/` 会被一起清掉或藏起，进了' +
  '版本库的 `state.json` 会被倒回去）；结束不是自己起的进程（按名字或端口一把杀——`taskkill /IM`、`killall`、`pkill` 这类——会把这台机器上' +
  '同名的进程全杀掉，连带用户别的程序，还可能有 Claude Code 自己与它的工具）。' +
  `碰到这样一步就停下，最后一条回复的第一行写「${BUBBLE_MARK}」，说清是哪一步、为什么要它——做不做由用户定。` +
  '用户批准过的，只认契约（`00-contract.md`）「修订记录」里写明批准了的那一步，照做；派发提示里说批准了、修订记录里没有的，照样停下冒泡。'
const EXCEPT_IMPL =
  '照清单装依赖、编译、跑测试、在本机起停验证用的服务，在 `paths` 列给你的前缀里照任务改代码——这些步骤本身不算；其中要用凭据、' +
  '会花钱、对外发送的，照样停下。'
const EXCEPT_QA = '照清单装依赖、编译、跑测试、起停测试要用的服务——这些步骤本身不算；其中要用凭据、会花钱、对外发送的，照样停下。'
const SHELL_NOTE = '环境说明里提到 PowerShell，那不是你的工具。'

/** 正文里「## 红线」那一节（到下一个二级标题止）；没有这一节返回空串。 */
function redLineSection(body) {
  const i = body.indexOf('## 红线')
  if (i < 0) return ''
  const j = body.indexOf('\n## ', i + 1)
  return body.slice(i, j < 0 ? undefined : j)
}
const hasRedLine = (body, except) => has(redLineSection(body), RED_LINE + except)

/** /agent-team:at 第 4 节表里 sensitive 那一行的各项。 */
function sensitiveItems() {
  const row = read('commands/at.md').split(/\r?\n/).find((l) => l.startsWith('| `sensitive` |'))
  assert.ok(row, '/agent-team:at 第 4 节没有 sensitive 那一行')
  return row.split('|')[2].split('；').map((s) => s.trim()).filter(Boolean)
}

test('前置：持 Bash 的执行角色、只跑测试的那一类、协调者都派生得出来、不是空集——否则下面几条在空清单上恒绿', () => {
  assert.ok(BASH_EXEC.length > 0, '没有持 Bash 的执行角色')
  assert.ok(!BASH_EXEC.includes(`${MAIN}.md`), '主会话不该在执行角色里')
  assert.ok(QA_LIKE.length > 0 && QA_LIKE.length < BASH_EXEC.length, `只跑测试的那一类派生得不对：${QA_LIKE.join('、')}`)
  assert.ok(COORDINATORS.length > 0, '派生不出协调者')
})

test('自检：红线判据只认「红线」那一节里的整句（连同例外），换行与缩进不计；少一项、例外说宽、挪到别的小节都不算', () => {
  const wrapped = (RED_LINE + EXCEPT_IMPL).replace('；动 CI/CD', '；\n  动 CI/CD')
  assert.ok(hasRedLine(`## 红线\n\n${wrapped}\n\n## 冒泡给谁\n`, EXCEPT_IMPL))
  assert.ok(!hasRedLine(`## 红线\n\n${(RED_LINE + EXCEPT_IMPL).replace('；`git push` 或改远端', '')}\n`, EXCEPT_IMPL))
  assert.ok(!hasRedLine(`## 红线\n\n${RED_LINE}${EXCEPT_IMPL.replace('其中要用凭据、会花钱、对外发送的，照样停下。', '')}\n`, EXCEPT_IMPL))
  assert.ok(!hasRedLine(`## 你有 Bash\n\n${RED_LINE + EXCEPT_IMPL}\n\n## 红线\n\n- 别的\n`, EXCEPT_IMPL))
})

/** 红线那一句里冒号之后、「。碰到这样一步」之前的各项。 */
function redLineItems() {
  const list = RED_LINE.slice(RED_LINE.indexOf('**：') + '**：'.length, RED_LINE.indexOf('。碰到这样一步'))
  return list.split('；').map((s) => s.trim()).filter(Boolean)
}
// 括号里是说明（举例、后果），两处可以写得不一样；比的是括号外的那一项本身。
const itemKey = (s) => stripWs(s.replace(/（[^）]*）/g, ''))

test('M4e 复核：红线的清单与 /agent-team:at 第 4 节 sensitive 那一行逐项对得上（两个方向）——PM 照那一行问用户，多出、少掉的一项都没有落点', () => {
  const at = sensitiveItems().map(itemKey).sort()
  const red = redLineItems().map(itemKey).sort()
  assert.ok(at.length > 0 && red.length > 0)
  assert.deepEqual(red, at, '红线的清单与 sensitive 那一行不一致（括号外逐项比）')
})

test('M4e 第 26、39 条：每个持 Bash 的执行角色，红线里都有同一句敏感操作红线连同它那一类的例外', () => {
  for (const f of BASH_EXEC) {
    const except = QA_LIKE.includes(f) ? EXCEPT_QA : EXCEPT_IMPL
    assert.ok(hasRedLine(bodyOf(f), except), `${f} 的「## 红线」缺敏感操作那一句或它的例外（逐字，空白不计）`)
  }
})

test('M4e 复核：执行角色的「Bash 只用来……」与红线的例外对得上——起停验证或测试用的服务都在里面', () => {
  for (const f of BASH_EXEC) {
    const s = QA_LIKE.includes(f) ? '编译、跑测试、起停测试要用的服务。' : '`Bash` 只用来装依赖、编译、跑测试、在本机起停验证用的服务。'
    assert.ok(has(bodyOf(f), s), `${f} 缺「${s}」`)
  }
})

test('M4e：持 Bash 的角色都知道自己唯一的 shell 是 Bash——环境说明里的 PowerShell 不是它的工具（M5f 里 PM 在 Bash 里调过 Get-FileHash）', () => {
  for (const f of BASH_ROLES) {
    assert.ok(has(bodyOf(f), SHELL_NOTE), `${f} 缺「${SHELL_NOTE}」`)
    assert.ok(has(bodyOf(f), '命令照 POSIX 写'), `${f} 缺「命令照 POSIX 写」`)
  }
})

test('M4e at-qa：冒泡只用于「S5 没交齐」与红线里的敏感操作；缺凭据是环境原因，凭据在手要不要用是敏感操作', () => {
  for (const f of QA_LIKE) {
    const b = bodyOf(f)
    assert.ok(has(b, '冒泡只用于上面「S5 没交齐」与下面红线里的敏感操作。缺凭据也算环境原因；凭据在手、要不要拿它跑，是红线里的敏感操作。'), f)
    assert.ok(has(b, '不要冒泡——那就是这一轮的测试结论'), `${f} 环境原因那一句丢了`)
  }
})

test('M4e 协调者：紧接着「定不了的原样冒泡给 PM」——为红线里的敏感操作冒泡的，不定、原样冒泡给 PM', () => {
  for (const f of COORDINATORS) {
    const b = stripWs(bodyOf(f))
    assert.ok(/定不了的原样冒泡给PM[。；]为红线里的敏感操作冒泡的，你不定，原样冒泡给PM（那要问用户）。/.test(b), `${f} 缺转述那一句，或者它没紧跟在冒泡那一段后面`)
  }
})

test('M4e 复核：门禁给停下的子代理与给协调者的冒泡文案都认红线里的敏感操作', () => {
  assert.ok(BUBBLE_WHEN.includes('红线里的敏感操作'), BUBBLE_WHEN)
  const t = explainMissing({ kind: 'bubble', reason: null }, { recipientIsPm: false, redispatch: '再派它一次', trimHint: '' })
  assert.ok(t.includes('定不了的、为红线里的敏感操作冒泡的，把这一条连同它的理由原样冒泡给派你的人。'), t)
})

test('M4e 复核 PM 红线：动工作树或历史的 git 命令自己也不跑，要跑先问用户；门禁回传里提到的是转告用', () => {
  const red = redLineSection(bodyOf(`${MAIN}.md`))
  assert.ok(
    has(
      red,
      '- **动工作树或历史的 `git` 命令你也不自己跑**（`clean`、`stash`、`reset`、`checkout`、`switch`、`restore`、`rebase`、`commit` 这类）：' +
        '要跑先照 `/agent-team:at` 第 4 节的 `sensitive` 问用户——没进版本库的 `.agent-team/` 会被一起清掉或藏起，进了版本库的 `state.json`' +
        '会被倒回去。门禁回传里提到这些命令的，是让你转告用户，不是让你去跑。',
    ),
    'PM 的红线缺 git 命令那一条',
  )
})

// M4h（docs/43 §3，M9 实测）：项目经理冒烟之后用 `taskkill //F //IM node.exe` 停服务，把这台机器上的 node 进程全杀了（驱动连同别的工具）。
// 起因之一是 Windows 的 Git Bash 里 `npm start &` 之后 `kill $!` 停不掉服务——只停掉外面那一层（本机实测，直接 `node … &` 的停得掉，
// `taskkill //PID <winpid> //T //F` 按进程树停得掉）。红线与 sensitive 加一项，停服务的做法每个持 Bash 的角色（连同项目经理）逐字同一句。
const STOP_NOTE =
  '停服务只停自己起的那一个：起的时候记下它的 PID（`$!`），停的时候按这个 PID 停——Windows 的 Git Bash 里 `npm`、`npx` 拉起来的服务，' +
  '`kill` 只停掉外面那一层、服务照样在跑，用 `taskkill //PID "$(cat /proc/<PID>/winpid)" //T //F` 连子进程一起停；停不掉的，照实报出端口' +
  '与 PID，不要按名字或端口一把杀。'
const PM_PROCESS =
  '- **不是你自己起的进程你也不结束**：按名字或端口一把杀（`taskkill /IM`、`killall`、`pkill` 这类）会把这台机器上同名的进程全杀掉，' +
  '连带用户别的程序，还可能有 Claude Code 自己与它的工具——要那样做先照 `/agent-team:at` 第 4 节的 `sensitive` 问用户。'

test('M4h：红线与 sensitive 那一行都有「结束不是自己起的进程」（两处逐项对得上由上面那条核）', () => {
  assert.ok(sensitiveItems().map(itemKey).includes(itemKey('结束不是自己起的进程')), sensitiveItems().join(' / '))
  assert.ok(redLineItems().map(itemKey).includes(itemKey('结束不是自己起的进程')))
})

test('M4h：每个持 Bash 的角色（执行角色与项目经理）都有同一句停服务的做法——按自己起的那个 PID 停，不按名字或端口一把杀', () => {
  for (const f of BASH_ROLES) assert.ok(has(bodyOf(f), STOP_NOTE), `${f} 缺停服务那一句（逐字，空白不计）`)
})

test('M4h PM 红线：不是自己起的进程也不结束，要那样做先问用户；停服务那一句跟在后面', () => {
  assert.ok(has(redLineSection(bodyOf(`${MAIN}.md`)), PM_PROCESS + STOP_NOTE), 'PM 的红线缺进程那一条（整句，连同停服务那一句）')
})

test('M4h README 两半「什么时候会问你」的敏感操作那一行：列上结束不是它自己起的进程', () => {
  const row = (text, head) => text.split(/\r?\n/).find((l) => l.startsWith(head)) ?? ''
  assert.ok(row(read('README.md'), '| 敏感操作 |').includes('结束不是它自己起的进程'), row(read('README.md'), '| 敏感操作 |'))
  assert.ok(row(read('README.md'), '| Sensitive |').includes("killing processes it didn't start"), row(read('README.md'), '| Sensitive |'))
})

test('M4e 复核：批准只认契约修订记录——/agent-team:at 第 4 节写清 sensitive 的修订块怎么写；架构师单列要删除、改名的已有文件，PM 在 S4 一次问完', () => {
  const at = read('commands/at.md')
  assert.ok(has(at, 'sensitive 那一类的答复，修订块里写清是哪一步、批不批——执行角色碰到红线里那几类操作时，只认这里写明批准了的那一步。'))
  assert.ok(has(at, '落盘清单末尾标了「删除」「改名」的已有文件也一样，一次问完'))
  assert.ok(
    has(
      bodyOf('at-architect.md'),
      '要删除或改名的已有文件（不是这一趟产出的），在这一节末尾单列，一行一个，标「删除」或「改名」：PM 在 `S4` 照第 4 节的 `sensitive` 一次问完用户，执行角色只认契约修订记录里批准了的那几条。',
    ),
  )
})

test('M4e 第 43 条 at-pm 自检：先看工具面——以工具清单为准、两种成因、停下', () => {
  const pm = bodyOf(`${MAIN}.md`)
  const s = pm.slice(pm.indexOf('## 门禁自检'), pm.indexOf('**怎么判'))
  assert.ok(
    has(
      s,
      '**先看工具面**：以你的工具清单里有没有名为 `Bash` 的工具为准，不看环境说明写的首选 shell。没有它——原生 Windows 上没装 Git for ' +
        'Windows（平台只给 PowerShell），或者设置、启动参数禁了 `Bash`——团队角色跑命令都只认 `Bash`，装依赖、编译、跑测试都做不了：停下，' +
        '把成因告诉用户（装好 Git for Windows 再重开 Claude Code，或者解除对 `Bash` 的禁用），不要往下做。',
    ),
    '自检一节缺「先看工具面」那一段（整句）',
  )
})

test('M4e 第 25 条 at-pm 自检：平台报错里提到 EnterWorktree 或 bgIsolation 的，告诉用户 settings.local.json 的设置或改用前台会话，不 git worktree add、不自己改设置', () => {
  const pm = bodyOf(`${MAIN}.md`)
  const s = pm.slice(pm.indexOf('**怎么判'), pm.indexOf('门禁没在跑时，把下面这段'))
  assert.ok(
    has(
      s,
      '报错里提到 `EnterWorktree` 或 `bgIsolation` 的，是后台会话在 git 仓库里被平台拦下了对项目目录的写入：一并告诉用户在项目的 ' +
        '`.claude/settings.local.json` 里设 `"worktree": {"bgIsolation": "none"}`（只对他自己生效；写进 `.claude/settings.json` 会改到所有' +
        '协作者），或者改用前台会话（终端里直接跑 `claude`、桌面端）再开这一趟；不要照平台的提示去 `git worktree add`，也不要自己改设置。',
    ),
    '自检第 3 支缺后台会话那一句（整句）',
  )
})

test('M4e at-pm：at-init 收尾那一问（.gitignore）与 /agent-team:at 第 1 节那一问一样另算，不记 escalation', () => {
  assert.ok(has(bodyOf(`${MAIN}.md`), '`/agent-team:at-init` 收尾那一问（要不要把 `.agent-team/` 加进 `.gitignore`）也另算：不记 escalation、不动契约。'))
})

test('M4e 第 39、25 条 at-init 收尾：在 git 仓库里才提；已忽略的不提、已入库的由用户先撤；建议 .gitignore 先问；后台会话的设置只告诉不代改', () => {
  const init = read('commands/at-init.md')
  const s = init.slice(init.indexOf('## 4. 收尾'))
  for (const sentence of [
    '项目在 git 仓库里的话（`git rev-parse --show-toplevel` 成功），收尾再提两件事：',
    '`git check-ignore -q .agent-team` 成功（已经忽略了）的，不提；`git ls-files .agent-team` 有输出（已经入了库）的，照实告诉用户：' +
      '要忽略它得先 `git rm -r --cached .agent-team` 再加进 `.gitignore`，由用户自己做；其余的建议把 `.agent-team/` 加进 `.gitignore`' +
      '——改 `.gitignore` 是动用户的文件，先问，用户点头再加。',
    '要在这个仓库里用后台会话（`claude --bg`、agent view）跑团队，得先在项目的 `.claude/settings.local.json` 里设 ' +
      '`"worktree": {"bgIsolation": "none"}`（只对用户自己生效）：不设的话平台会拦下后台会话对项目目录的写入，开头的自检就停。' +
      '前台会话、桌面端不受影响。这一条只告诉用户，不替用户改设置。',
  ]) {
    assert.ok(has(s, sentence), `at-init 收尾缺：${sentence.slice(0, 40)}…`)
  }
})
