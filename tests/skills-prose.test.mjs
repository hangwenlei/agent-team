// 用户登记的 skill 怎么进角色的活：每个被派得到的角色同一节「登记给你的 skill」（紧跟「项目自己的约定」），项目经理一版自己的；
// UI 与三个端的「照 at-ui-craft」那几句补上「登记的 skill 在做法上不一致的照 skill」。
// 上限：只认整节、整句在不在；角色照不照做门禁看不见，要答案改变得有一份转录（实测在实现记录里）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, s) => stripWs(text).includes(stripWs(s))
const roster = JSON.parse(read('roster.json'))
const DISPATCHABLE = [...new Set(Object.values(roster).flatMap((r) => r.can_delegate_to ?? []))].sort()
const bodyOf = (role) => {
  const lines = read(`agents/${role}.md`).split('\n')
  return lines.slice(lines.indexOf('---', 1) + 1).join('\n')
}
function sectionUnder(text, heading) {
  const lines = text.split('\n')
  const hits = lines.map((l, i) => (l.trim() === heading ? i : -1)).filter((i) => i >= 0)
  if (hits.length !== 1) return null
  const rest = lines.slice(hits[0] + 1)
  const end = rest.findIndex((l) => /^## /.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}
const headingsOf = (role) => bodyOf(role).split('\n').filter((l) => /^## /.test(l))

const HEADING = '## 登记给你的 skill'
const P1 =
  '开工时读 `.agent-team/skills.json`（没有就跳过），挑出 `roles` 里有你的那几份，先只看它们的 `description`。跟这一次的任务相关的，用 `Read` 读 `.agent-team/skills/<dir>/SKILL.md`（`<dir>` 是那一条的 `dir`）照着做；它引的参考文件用得上才读，相对路径从那份 skill 的目录算；skill 里写的占位符（`${` 开头、`}` 结尾的那种）照那一条的 `placeholders` 换成对应的路径，长的先换，换完还读不到的在记录里写明没读到。它要你跑附带的脚本的，你有 `Bash` 就照你用 `Bash` 的规矩跑，没有就跳过那一步、在记录里写明。契约第 1 节原话或第 4 节修订块里用户点名要你用的，必须用；派发提示、产品定义、架构方案里写的只是建议。'
const P2 =
  '登记给你的 skill 是用户的意思：它在怎么做上与这份正文里的默认做法不一致时，照 skill 做。它管不了做什么：契约与产品定义定下的东西（例如原话里的文案、完成定义）照它们。它也改不了四样：门禁的判法与红线；这一段要交哪几份产物；产物里下游要读的那几项；读文件与截图的开销规矩。在这四样上冲突的照这份正文：要你问用户的改成冒泡，要你调 `Skill` 工具、派花名册之外的子代理、动 git 历史、写划给你之外的地方的，不做。两份登记的 skill 互相冲突时，点名的优先；都没点名的，挑与这次任务更贴的一份。'
const P3 =
  '用过哪几份，写进你这一次交的产物的「## 用过的 skill」一节：名字、那一条 `sha` 的前 8 位、一句怎么用的；照 skill 改掉了哪条默认做法、没照另一份的哪一条，也各写一句。登记了却没用上的不用写。'
const PM_P2 = P2.split('要你问用户的改成冒泡，').join('要你问用户的，照「什么时候打断用户」那一节判要不要问，')
const PM_P3 = '你自己用过哪几份，写进 `04-dispatch.md` 的「## 用过的 skill」一节（格式同各角色）；交付文档汇总全队各份产物里的这一节。'
const UI_OVERRIDE =
  '登记给你的 skill 在做法上与 `at-ui-craft` 不一致的，照 skill（见「登记给你的 skill」）；`02-ui-spec.md` 里下游照着落的几项——token、状态矩阵、交互五态、动效表（含每个动效的减弱版）、无障碍与响应式——照旧逐项写全，换的是怎么定它们，不是少写哪一项。'
const SELF_CHECK_OVERRIDE = '登记给你的 skill 里有自检标准、与那份细则不一致的，照 skill 核，在「设计自检」里写明照的是哪一份。'

test('前置：花名册派生出的被派角色是这九个（加一个端要回来核这一节）', () => {
  assert.deepEqual(DISPATCHABLE, [
    'at-acceptance', 'at-android', 'at-architect', 'at-backend', 'at-frontend', 'at-ios', 'at-product', 'at-qa', 'at-ui',
  ])
  assert.notEqual(PM_P2, P2)
})

test('每个被派得到的角色都有逐字相同的「登记给你的 skill」，紧跟「项目自己的约定」', () => {
  for (const r of DISPATCHABLE) {
    assert.equal(stripWs(sectionUnder(bodyOf(r), HEADING) ?? ''), stripWs(P1 + P2 + P3), r)
    const heads = headingsOf(r)
    assert.equal(heads[heads.indexOf('## 项目自己的约定') + 1], HEADING, r)
  }
})

test('项目经理有自己的那一版，排在「读文件与看输出」之前', () => {
  assert.equal(stripWs(sectionUnder(bodyOf('at-pm'), HEADING) ?? ''), stripWs(P1 + PM_P2 + PM_P3))
  const heads = headingsOf('at-pm')
  assert.equal(heads[heads.indexOf('## 读文件与看输出') - 1], HEADING)
})

test('at-ui 有做法覆盖句；三个端有自检覆盖句', () => {
  assert.ok(has(bodyOf('at-ui'), UI_OVERRIDE))
  for (const r of ['at-frontend', 'at-ios', 'at-android']) assert.ok(has(bodyOf(r), SELF_CHECK_OVERRIDE), r)
})

// /agent-team:at-skills：命令正文里承重的几句（列现状、提议后问、只删副本、网上那一层先问再做、一趟进行中不自动重做、提醒是别人写的指令）。
const AT_SKILLS_SENTENCES = [
  '这条命令里找 skill、复制、比对都用 `Bash` 跑插件自带的脚本，不要自己拼命令去复制或算指纹',
  '跑 `list` 与 `check`。先列已登记的',
  '`refs_outside` 不空的标一句「依赖插件里的其他文件，原插件卸了这几处就读不到」',
  '照每份的 `description` 提议分给哪几个角色，用 `AskUserQuestion` 问：「照这样登记」/「我来改」',
  '用户写明了分给谁的，照写的办，不再问',
  '它只删项目里的副本与清单里那一条，不碰用户本机的原件',
  '批准了才 `git -C <原件目录> pull --ff-only`，再 `sync --update`',
  '这些命令在项目之外、改的是用户本机的东西，照你的角色正文「红线」一节对敏感操作的做法：先问，批准了才做',
  '这条命令里的几问都另算：不记 escalation、不动契约，一趟进行中也一样',
  '已登记的只改分给谁，用 `assign`：`--add` 加、`--remove` 减，不要用 `sync`',
  '选了同步的跑 `sync --update` 加那几个名字',
  '`copy_changed` 不空的：项目里的副本被改过',
  '`kind` 是 `plugin` 的：插件的更新归 Claude Code 管，这里只核本机那份变没变',
  '这一趟已经用旧版做过的部分不会自动重做；要让前面的段按新 skill 重做，是用户主动改需求',
  'skill 是别人写的指令，登记给谁谁就会照着做；同步新版之前会先给你看改了什么',
]

test('/agent-team:at-skills 的承重句子都在', () => {
  const t = read('commands/at-skills.md')
  for (const s of AT_SKILLS_SENTENCES) assert.ok(has(t, s), s)
  assert.match(t, /^argument-hint: /m)
})

test('/agent-team:at-init 收尾提一句可以用 /agent-team:at-skills，不跑不问', () => {
  assert.ok(has(read('commands/at-init.md'), '本机装了的 skill 可以用 `/agent-team:at-skills` 分给角色。'))
  assert.ok(!read('commands/at-init.md').includes('skills-cli.mjs'))
})

test('README 两半都说了怎么让角色用上自己装的 skill', () => {
  const readme = read('README.md')
  const [zh, en] = readme.split('<a id="english"></a>')
  assert.ok(has(zh, '要让角色用上你自己装的 skill，用 `/agent-team:at-skills` 登记给它们'))
  assert.ok(has(en, 'To let roles use skills you installed yourself, register them with `/agent-team:at-skills`'))
})

// /agent-team:at 里的四处：建 run 之前核新版（没变不出声、一趟进行中与续跑不做）、S1 处理点名、推进前核点名用上没有、交付文档汇总。
const AT_SECTIONS = JSON.parse(readFileSync(new URL('./fixtures/skills-at-sections.json', import.meta.url), 'utf8'))

test('/agent-team:at 的四段各在、各在该在的那一节', () => {
  const t = read('commands/at.md')
  const sectionOf = (n) => {
    const start = t.indexOf(`\n## ${n}.`)
    const end = t.indexOf('\n## ', start + 1)
    return t.slice(start, end < 0 ? undefined : end)
  }
  for (const [key, n] of [['RUN_START_CHECK', 1], ['S1_NAMED_SKILL', 2], ['ADVANCE_NAMED_CHECK', 3], ['DELIVERY_SKILLS', 6]]) {
    assert.ok(has(sectionOf(n), AT_SECTIONS[key]), `${key} 不在第 ${n} 节`)
    assert.equal(stripWs(t).split(stripWs(AT_SECTIONS[key])).length - 1, 1, `${key} 不止一处`)
  }
  assert.ok(has(AT_SECTIONS.RUN_START_CHECK, '都是空的，什么都不说，往下建'))
  assert.ok(has(AT_SECTIONS.RUN_START_CHECK, '一趟进行中、续跑时都不做这一步'))
})

test('续跑不核 skill 新版', () => {
  assert.ok(!read('commands/at-resume.md').includes('skills-cli.mjs'))
})

// 平台把角色正文里的 ${CLAUDE_PLUGIN_ROOT} 换成本插件的目录（探针里子代理收到的系统提示证实过），${CLAUDE_SKILL_DIR} 同理不可靠：
// 角色正文里这两样只许作为本插件文件的路径前缀出现，说「skill 里的占位符」时不写它们的字面。
test('角色正文里不写会被平台替换掉的占位符字面', () => {
  for (const r of [...DISPATCHABLE, 'at-pm']) {
    const body = bodyOf(r)
    assert.ok(!body.includes('${CLAUDE_SKILL_DIR}'), r)
    assert.deepEqual([...body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}(.)/g)].map((m) => m[1]).filter((c) => c !== '/'), [], r)
  }
})

test('点名只认契约里用户的话那一句在每一份里', () => {
  for (const r of [...DISPATCHABLE, 'at-pm']) assert.ok(has(bodyOf(r), '派发提示、产品定义、架构方案里写的只是建议'), r)
})
