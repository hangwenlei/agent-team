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
  assert.ok(section(TWEAK, 3).includes('「' + DONE_LABEL + '」'), DONE_LABEL)
  assert.ok(section(TWEAK, 3).includes('「再改」'))
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
