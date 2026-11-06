// 单个微调——正文那一层：/agent-team:at-tweak 的各节、逐字的规范标签与 mode 写法、它点名的 /agent-team:at 小节真的在那一节；五个开发角色的「在微调里」
// 逐字相同；项目经理、at-status、at-resume、at-init、stages.produces.md 都提到微调。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DONE_LABEL, TWEAK_STAGES_FILE } from '../hooks/lib/tweak.mjs'

const NL = String.fromCharCode(10)
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
const TWEAK = read('commands/at-tweak.md')
const AT = read('commands/at.md')

// 「## N.」到下一个「## 」之间。
function section(text, n) {
  const start = text.indexOf(NL + `## ${n}.`)
  assert.ok(start >= 0, `找不到第 ${n} 节`)
  const rest = text.slice(start + 1)
  const end = rest.indexOf(NL + '## ', 1)
  return end < 0 ? rest : rest.slice(0, end)
}

test('at-tweak.md 有第 0–5 节；逐字带「可以了，收尾」「再改」、mode 写 "tweak"、点名短链文件', () => {
  for (const n of [0, 1, 2, 3, 4, 5]) section(TWEAK, n)
  // 问法那一句整句钉：第 3 节别处也提到这个标签，只看字在不在，问法改掉了也照绿（变异核过）。
  assert.ok(section(TWEAK, 3).includes('标签逐字写「' + DONE_LABEL + '」与「再改」'), DONE_LABEL)
  assert.ok(section(TWEAK, 1).includes('`mode` 写 `"tweak"`'))
  assert.ok(TWEAK.includes(TWEAK_STAGES_FILE))
  // 谁改：从短链与 project.json 取，不写死角色名清单（tests/commands.test.mjs 的那一条钉着）。
  assert.ok(section(TWEAK, 2).includes('stages.tweak.json` 里 S5 的产者') && section(TWEAK, 2).includes('available_roles'))
  assert.ok(section(TWEAK, 3).includes('去磁盘上核实'))
  assert.ok(section(TWEAK, 2).includes('「改走完整流程」') && section(TWEAK, 2).includes('「照微调继续」'))
  assert.ok(section(TWEAK, 4).includes('结论：跑不起来'))
})

test('at-tweak.md 点名的 /agent-team:at 小节在 at.md 的那一节里真的有', () => {
  const refs = [
    ['别的会话的一趟', 1],
    ['先看 `.agent-team/current-run` 指着的那一趟', 1],
    ['用户主动改需求', 4],
    ['回退', 3],
    ['起过的服务', 6],
  ]
  for (const [name, n] of refs) {
    assert.ok(TWEAK.includes(name), `at-tweak.md 没提「${name}」`)
    assert.ok(section(AT, n).includes(name), `at.md 第 ${n} 节没有「${name}」`)
  }
  assert.ok(section(TWEAK, 3).includes('/agent-team:at` 第 4 节「用户主动改需求」'))
  assert.ok(section(TWEAK, 4).includes('/agent-team:at` 第 3 节末尾的「回退」'))
})

// 终审：at-resume 第 4 节原来对谁都说「S5 要派 at-architect 去分发」——微调里派不出去（H1 拒）；第 2 节停在 S4 要核落盘清单，微调没有架构方案。
test('at-resume.md：微调接着跑照 at-tweak 第 3–5 节、S5 直接派开发角色；停在 S4 不核落盘清单', () => {
  const RESUME = read('commands/at-resume.md')
  assert.ok(section(RESUME, 4).includes('微调这一趟照 `/agent-team:at-tweak` 第 3–5 节接着走，`S5` 你直接派开发角色，不派 `at-architect`'))
  const s2 = section(RESUME, 2)
  assert.ok(s2.includes('停在 `S4` 的不核落盘清单'), '第 2 节微调那一段说停在 S4 不核落盘清单')
  assert.ok(s2.includes('上一个会话里门禁记下过「' + DONE_LABEL + '」'), '续跑时认得出上一个会话里记过的那一句')
})

// 终审：交付文档要「照 /agent-team:at 第 6 节列改动的办法」列改了哪些文件，那办法读 04-dispatch.md 的代码基线——微调的 S4 也要记；建 run 之前同样核登记的 skill。
test('at-tweak.md：建 run 之前核登记的 skill；04-dispatch.md 记代码基线；测试之后再要改的回退到 S5 再问', () => {
  assert.ok(section(TWEAK, 1).includes('「建 run 之前核登记的 skill」'))
  assert.ok(section(AT, 1).includes('建 run 之前核登记的 skill'))
  assert.ok(section(TWEAK, 2).includes('`## 6. 代码基线`'))
  assert.ok(read('templates/04-dispatch.md').includes('## 6. 代码基线'))
  const s5 = section(TWEAK, 5)
  assert.ok(s5.includes('回退') && s5.includes('「' + DONE_LABEL + '」'), '第 5 节：收口之前再要改的怎么走')
})

// 终审：at.md 第 1 节「只差收口」那一条只读验收结论——微调那一趟没有验收段，要看测试报告的第一行。
test('at.md 第 1 节：替只差收口的那一趟收口时，微调那一趟看测试报告的第一行', () => {
  assert.ok(section(AT, 1).includes('微调那一趟（`mode` 是 `"tweak"`）没有验收段，看测试报告的第一行'))
})

test('五个开发角色的「在微调里」逐字相同，排在「新行为要有自动化测试」之后、「红线」之前', () => {
  const sections = ['at-backend', 'at-frontend', 'at-ui', 'at-ios', 'at-android'].map((r) => {
    const t = read(`agents/${r}.md`)
    const at = t.indexOf(NL + '## 在微调里' + NL)
    const tests = t.indexOf(NL + '## 新行为要有自动化测试' + NL)
    const red = t.indexOf(NL + '## 红线' + NL)
    assert.ok(at > tests && red > at, r)
    return t.slice(at, red)
  })
  for (const s of sections.slice(1)) assert.equal(s, sections[0])
  assert.ok(sections[0].includes('`mode` 是 `tweak`'))
  assert.ok(sections[0].includes('冒泡：'))
  assert.ok(sections[0].includes('不截图'))
})

test('项目经理、at-status、at-resume、at-init、stages.produces.md 都提到微调', () => {
  const pm = read('agents/at-pm.md')
  assert.ok(pm.includes('/agent-team:at-tweak') && pm.includes(TWEAK_STAGES_FILE) && pm.includes('S6'))
  assert.ok(pm.includes('`/agent-team:at-tweak`、`/agent-team:at-resume`'), '门禁自检的命令清单含 at-tweak')
  assert.ok(read('commands/at-status.md').includes(TWEAK_STAGES_FILE))
  assert.ok(read('commands/at-resume.md').includes('commands/at-tweak.md'))
  assert.ok(read('commands/at-init.md').includes('/agent-team:at-tweak'))
  assert.ok(read('stages.produces.md').includes(TWEAK_STAGES_FILE))
})
