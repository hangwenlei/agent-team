// 并行微调——正文那一层：微调不写 current-run、开着微调与放弃这一趟的问法、认领冲突冒泡、共用页面服务、at-resume 与 at-status 认得微调的归属。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ABANDON_LABEL } from '../hooks/lib/abandon.mjs'
import { TAKEOVER_LABEL } from '../hooks/lib/owner.mjs'

const NL = String.fromCharCode(10)
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
const TWEAK = read('commands/at-tweak.md')
const AT = read('commands/at.md')

function section(text, n) {
  const start = text.indexOf(NL + `## ${n}.`)
  assert.ok(start >= 0, `找不到第 ${n} 节`)
  const rest = text.slice(start + 1)
  const end = rest.indexOf(NL + '## ', 1)
  return end < 0 ? rest : rest.slice(0, end)
}

test('at-tweak.md：建 run 不写 current-run；第 1 节有「先收尾那一趟」「当成那一趟的下一轮」与完整需求开着时的问法；第 6 节「放弃」指向 at 的「放弃这一趟」', () => {
  const s1 = section(TWEAK, 1)
  assert.ok(!s1.includes('建目录、写 `current-run`'), '旧写法删掉')
  assert.ok(s1.includes('**不写 `current-run`**'))
  assert.ok(s1.includes('「先收尾那一趟」') && s1.includes('「当成那一趟的下一轮」'))
  assert.ok(s1.includes('「放弃这一趟」'))
  const s6 = section(TWEAK, 6)
  assert.ok(s6.includes('`/agent-team:at` 第 1 节「放弃这一趟」'))
})

test('at-tweak.md：第 3 节讲认领冲突（不叫它绕开）与共用页面服务；第 4 节先看失败碰到的是不是这一趟改的；第 5 节停服务时说明别的微调可能还在用', () => {
  const s3 = section(TWEAK, 3)
  assert.ok(s3.includes('另一个微调正在改它'))
  assert.ok(s3.includes('不另起'))
  assert.ok(section(TWEAK, 4).includes('另一个还开着的微调'))
  assert.ok(section(TWEAK, 5).includes('别的微调还开着'))
})

test('at.md 第 1 节：「有微调开着」「放弃这一趟」两段，放弃的问法与写法逐字', () => {
  const s1 = section(AT, 1)
  assert.ok(s1.includes('**有微调开着**'))
  assert.ok(s1.includes('**放弃这一趟**'))
  assert.ok(s1.includes(`标签逐字写「${ABANDON_LABEL}」与「不放弃」`))
  assert.ok(s1.includes('"abandoned": true'))
  assert.ok(s1.includes('带 `"abandoned": true` 的是放弃了'))
})

test('at-resume.md：认得这个会话名下的微调、接手别的会话的微调；丢了指针时不把指针写到微调身上', () => {
  const r = read('commands/at-resume.md')
  const s1 = section(r, 1)
  assert.ok(s1.includes('【微调】'))
  assert.ok(s1.includes(TAKEOVER_LABEL))
  assert.ok(s1.includes('不要把指针写到它们身上'))
})

test('at-status.md：列出没收口的各趟、归哪个会话、最后一次动静；放弃了的标「（放弃）」', () => {
  const s = read('commands/at-status.md')
  assert.ok(s.includes('【微调】'))
  assert.ok(s.includes('（放弃）'))
  assert.ok(s.includes('最后一次动静'))
})

const ROLE_LINE = '写一个文件被门禁以「另一个微调正在改它」拒了：不要换路径、不要改用 Bash 绕开，以「冒泡：」停下，把拒绝理由原样回报项目经理。'

test('五个开发角色的「在微调里」都带认领冲突那一句（五份那一节仍逐字相同，由 tweak-prose 钉着）', () => {
  for (const r of ['at-backend', 'at-frontend', 'at-ui', 'at-ios', 'at-android']) {
    const t = read(`agents/${r}.md`)
    const at = t.indexOf(NL + '## 在微调里' + NL)
    const red = t.indexOf(NL + '## 红线' + NL)
    assert.ok(t.slice(at, red).includes(ROLE_LINE), r)
  }
})

test('项目经理正文：微调不写 current-run、几个会话可以各跑一趟；README 两半说得出并行与放弃', () => {
  const pm = read('agents/at-pm.md')
  assert.ok(pm.includes('微调不写 `current-run`'))
  const readme = read('README.md')
  const [zh, en] = readme.split('<a id="english"></a>')
  assert.ok(zh.includes('几个会话可以同时各跑一趟微调') && zh.includes('「放弃这一趟」'))
  assert.ok(en.includes('several sessions') && en.includes('abandon'))
})
