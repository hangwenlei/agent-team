// M4e（docs/39 §2.2、§2.3、§2.4，审查第 26、39、25、43 条）：持 Bash 的执行角色的敏感操作红线、shell 说明，协调者怎么转述，
// 自检与 at-init 里新加的几句。
//
// 门禁不看 Bash（hooks.json 的 PreToolUse 只挂 Agent 与 Edit|Write|NotebookEdit），执行角色手里的 Bash 能发包、推送、删文件、
// 跑 git clean——那一层只剩正文。所以红线逐字同一句、六份都有，判据按 tools: 声明触发（持有 Bash 是能独立核实的事实），
// 不看正文用了哪个词（tests/agents.test.mjs 记过「换个同义词就整份被跳过」那一族）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { toolsDeclarationOf } from './helpers/agent-tools.mjs'
import { BUBBLE_MARK } from '../hooks/lib/deliverable.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8')
const bodyOf = (f) => read(`agents/${f}`).split(/^---\s*$/m).slice(2).join('---')
const stripWs = (s) => s.replace(/\s+/g, '')
const roster = JSON.parse(read('roster.json'))
const MAIN = JSON.parse(read('settings.json')).agent.replace(/^agent-team:/, '')

const AGENTS = readdirSync(url('agents')).filter((f) => f.endsWith('.md'))
const BASH_ROLES = AGENTS.filter((f) => toolsDeclarationOf(read(`agents/${f}`)).names.includes('Bash'))
// 执行角色：持 Bash、不是主会话。主会话（PM）碰到敏感操作是自己问用户（/agent-team:at 第 4 节的 sensitive），不冒泡。
const BASH_EXEC = BASH_ROLES.filter((f) => f !== `${MAIN}.md`)
// 协调者：派得到某个持 Bash 执行角色、又不是主会话的角色——执行角色为敏感操作冒泡，先到它们手里。
const COORDINATORS = Object.entries(roster)
  .filter(([k, v]) => k !== '__main__' && k !== MAIN && (v.can_delegate_to ?? []).some((r) => BASH_EXEC.includes(`${r}.md`)))
  .map(([k]) => `${k}.md`)

const RED_LINE =
  '- **敏感或不可逆的操作不做，停下冒泡**：用凭据、密钥或密码；会产生费用的操作；对外发送或发布（发包、部署）；`git push` 或改远端；' +
  '删除或覆盖不是这一趟产出的文件；动 CI/CD 与生产配置；动整棵工作树或历史的 `git` 命令（`clean`、`stash`、`reset`、`checkout`、' +
  '`switch`、`restore`、`rebase` 这类——没进版本库的 `.agent-team/` 会被一起清掉或藏起，进了版本库的 `state.json` 会被倒回去）。' +
  `碰到这样一步就停下，最后一条回复的第一行写「${BUBBLE_MARK}」，说清是哪一步、为什么要它——做不做由用户定。`
const SHELL_NOTE = '环境说明里提到 PowerShell，那不是你的工具。'
const RELAY = '为红线里的敏感操作冒泡的，你不定，原样冒泡给 PM（那要问用户）。'

/** 正文里「## 红线」那一节（到下一个二级标题止）；没有这一节返回空串。 */
function redLineSection(body) {
  const i = body.indexOf('## 红线')
  if (i < 0) return ''
  const j = body.indexOf('\n## ', i + 1)
  return body.slice(i, j < 0 ? undefined : j)
}
const hasRedLine = (body) => stripWs(redLineSection(body)).includes(stripWs(RED_LINE))

test('前置：持 Bash 的执行角色与协调者都派生得出来、不是空集——否则下面几条在空清单上恒绿', () => {
  assert.ok(BASH_EXEC.length > 0, '没有持 Bash 的执行角色')
  assert.ok(!BASH_EXEC.includes(`${MAIN}.md`), '主会话不该在执行角色里')
  assert.ok(COORDINATORS.length > 0, '派生不出协调者')
})

test('自检：红线判据只认「红线」那一节里的这一句，换行与缩进不计；少一项、挪到别的小节都不算', () => {
  const wrapped = RED_LINE.replace('；动 CI/CD', '；\n  动 CI/CD')
  assert.ok(hasRedLine(`## 红线\n\n${wrapped}\n\n## 冒泡给谁\n`))
  assert.ok(!hasRedLine(`## 红线\n\n${RED_LINE.replace('；`git push` 或改远端', '')}\n`))
  assert.ok(!hasRedLine(`## 你有 Bash\n\n${RED_LINE}\n\n## 红线\n\n- 别的\n`))
})

test('M4e 第 26、39 条：每个持 Bash 的执行角色，红线里都有同一句敏感操作红线（门禁不看 Bash，这一句是挡在不可逆操作前面的唯一一层）', () => {
  for (const f of BASH_EXEC) assert.ok(hasRedLine(bodyOf(f)), `${f} 的「## 红线」缺敏感操作那一句（逐字，空白不计）`)
})

test('M4e：持 Bash 的角色都知道自己唯一的 shell 是 Bash——环境说明里的 PowerShell 不是它的工具（M5f 里 PM 在 Bash 里调过 Get-FileHash）', () => {
  for (const f of BASH_ROLES) {
    const b = stripWs(bodyOf(f))
    assert.ok(b.includes(stripWs(SHELL_NOTE)), `${f} 缺「${SHELL_NOTE}」`)
    assert.ok(b.includes(stripWs('命令照 POSIX 写')), `${f} 缺「命令照 POSIX 写」`)
  }
})

test('M4e at-qa：冒泡只用于「S5 没交齐」与红线里的敏感操作；环境原因跑不起来照旧写进 06-test.md、不冒泡', () => {
  const qa = stripWs(bodyOf('at-qa.md'))
  assert.ok(qa.includes(stripWs('冒泡只用于上面「S5 没交齐」与下面红线里的敏感操作')), 'at-qa 的冒泡范围没跟上红线')
  assert.ok(qa.includes(stripWs('不要冒泡——那就是这一轮的测试结论')), 'at-qa 环境原因那一句丢了')
})

test('M4e 协调者：执行角色为红线里的敏感操作冒泡的，协调者不定、原样冒泡给 PM', () => {
  for (const f of COORDINATORS) assert.ok(stripWs(bodyOf(f)).includes(stripWs(RELAY)), `${f} 缺「${RELAY}」`)
})

test('M4e 第 43 条 at-pm 自检：工具面里没有 Bash（原生 Windows 没装 Git for Windows）就停下，告诉用户装好再来', () => {
  const pm = bodyOf(`${MAIN}.md`)
  const s = pm.slice(pm.indexOf('## 门禁自检'), pm.indexOf('**怎么判'))
  for (const k of ['**先看工具面**', '没有 `Bash`', 'Git for Windows', '停下']) assert.ok(s.includes(k), `自检一节缺「${k}」`)
})

test('M4e 第 25 条 at-pm 自检：平台报错里提到 EnterWorktree 或 bgIsolation 的，告诉用户那个设置或改用前台会话，不 git worktree add、不自己改设置', () => {
  const pm = bodyOf(`${MAIN}.md`)
  const s = pm.slice(pm.indexOf('**怎么判'), pm.indexOf('门禁没在跑时，把下面这段'))
  for (const k of ['`EnterWorktree`', '`bgIsolation`', '`"worktree": {"bgIsolation": "none"}`', '前台会话', '不要照平台的提示去 `git worktree add`', '不要自己改设置']) {
    assert.ok(s.includes(k), `自检第 3 支缺「${k}」`)
  }
})

test('M4e 第 39、25 条 at-init 收尾：git 仓库里建议把 .agent-team/ 加进 .gitignore（先问）、说清两边的坑；后台会话要设 bgIsolation，只告诉不代改', () => {
  const init = read('commands/at-init.md')
  const s = init.slice(init.indexOf('## 4. 收尾'))
  for (const k of ['`.gitignore`', '先问', '`git clean -fd`', '`git stash -u`', '`git checkout -- .`', '`"worktree": {"bgIsolation": "none"}`', '不替用户改设置']) {
    assert.ok(s.includes(k), `at-init 收尾缺「${k}」`)
  }
})
