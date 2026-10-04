// 根级共享文件与测试目录的认领（M4b，docs/36，全量审查第 21 条修法 1 的改形）。
//
// 不加 shared 键（理由与 docs/16 §3 的三样在 docs/36）。路径归属在 S0 由 /agent-team:at-init 写、布局在 S3 才定，两者之间
// 原来没有一步回头对齐：S5 的执行角色写 tsconfig.json、顶层 tests/ 被 H3 拒，冒泡、PM 中途改 project.json、再重派——真实 run
// 里撞上过（docs/14：PM 为躲开它把后端从 TS 改成了 JS）。改成四处正文：
//   S0  at-init 把磁盘上已有的根级清单、构建配置、测试目录列给每个会改它们的 S5 产者；
//   S3  架构师的 03-arch.md 带「落盘清单」一节，PM 推进出 S3 之前核它（推进之后架构师改不了 03-arch.md）；
//   S4  PM 照清单只往 paths 里加前缀（自动加载的位置与 CI/CD 先问用户），记进 04-dispatch.md；
//   S5  执行角色被拒时在实现记录里写「被写路径隔离拒绝」一节，补完重写、标「已解决」；PM 有没解决的条目就不推进，
//       补 paths、在 S5 里重派（不计返工）。
// 门禁看不出实现记录里写没写拒绝（H5b 只核在不在、空不空、旧不旧），这些判据钉的是句子；行为由真实会话核（docs/36 §4）。
// 几处共用的字面量（「被写路径隔离拒绝」「已解决」「落盘清单」）抽成常量：改名时各处一起红，不会只改一处。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stageRoles } from '../hooks/lib/stages.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const flat = (s) => s.replace(/\n[ \t>]*/g, '')
function between(text, a, b) {
  const i = text.indexOf(a)
  assert.ok(i >= 0, `找不到「${a}」`)
  const j = b ? text.indexOf(b, i + a.length) : text.length
  assert.ok(j > i, `「${a}」之后找不到「${b}」`)
  return text.slice(i, j)
}
const paragraphs = (text) => text.split(/\n\s*\n/)

const DENIAL = '被写路径隔离拒绝'
const RESOLVED = '已解决'
const LIST = '落盘清单'

const STAGES = JSON.parse(read('stages.json'))
const S5_PRODUCERS = STAGES.S5.producers
// 同时还是别的段产者的角色（at-ui 也是 S2 的产者）：它那一句要限定在 S5，否则在 S2 被拒时会提前写出 S5 的实现记录，
// 到 S5 时交付物校验把它当成已经交了。
const MULTI_STAGE = S5_PRODUCERS.filter((r) =>
  Object.entries(STAGES).some(([id, s]) => id !== 'S5' && stageRoles(s).includes(r)),
)

const AT = read('commands/at.md')
const S3 = flat(between(AT, '- **S3 技术对齐**', '- **S4 裁决**'))
const S4 = flat(between(AT, '- **S4 裁决**', '- **S5 实现**'))
const S5 = flat(between(AT, '- **S5 实现**', '### 回退'))

test('M4b 前置：S5 的产者不为空，其中有同时是别的段产者的角色', () => {
  assert.ok(S5_PRODUCERS.length > 0)
  assert.ok(MULTI_STAGE.length > 0, '没有多段产者——下面那条「带 S5 限定」的判据在空转')
})

test('M4b /at S3：派架构师时要求 03-arch.md 带落盘清单，推进出 S3 之前核它，缺了在 S3 里重派', () => {
  for (const s of [LIST, '推进出 `S3` 之前', '在 `S3` 里重派', '不计返工']) assert.ok(S3.includes(s), `S3 那一条缺「${s}」`)
})

test('M4b /at S4：推进出 S4 之前照落盘清单只往 paths 里加；敏感位置先问用户；回传照 at-init 第 3 节；不派架构师改 03-arch.md；补的是认领不是代写', () => {
  for (const s of [
    LIST,
    '推进出 `S4` 之前',
    '只往 `paths` 里加',
    '`available_roles`',
    '`sensitive`',
    '`/agent-team:at-init` 第 3 节',
    '不要派 `at-architect` 去改 `03-arch.md`',
    '补的是认领，不是代写',
  ]) {
    assert.ok(S4.includes(s), `S4 那一条缺「${s}」`)
  }
  // 「在写 04-dispatch.md 之前」会在返工轮里被跳过（04-dispatch.md 标了 accepted 就不写它）：触发点是推进出 S4。
  assert.ok(!S4.includes('在写 `04-dispatch.md` 之前'), S4)
})

test('M4b /at S5：实现记录里有没解决的被拒条目就不推进；补 paths、在 S5 里重派架构师；不回退改设计、不代写；推进之后才发现的记回退', () => {
  for (const s of [DENIAL, RESOLVED, '不要推进', '在 `S5` 里重派 `at-architect`', '不要回退改设计', '不要自己替执行角色写', '回退']) {
    assert.ok(S5.includes(s), `S5 那一条缺「${s}」`)
  }
})

test('M4b /at 第 3 节「核实」：S5 的实现记录要读内容，有没解决的被拒条目不算交齐', () => {
  const verify = flat(between(AT, '2. **核实**', '3. **记账**'))
  assert.ok(verify.includes(DENIAL) && verify.includes(RESOLVED), verify)
})

test('M4b /at 第 6 节：交付文档与汇报里写这一趟给 paths 补了哪些前缀', () => {
  const s6 = flat(between(AT, '## 6. 收尾'))
  assert.ok((s6.match(/补的前缀|补了哪些前缀/g) || []).length >= 2, s6.slice(0, 400))
})

test('M4b /at-resume：S5 有没解决的被拒条目不算齐、不记账推进；S3 没有落盘清单也不算齐；不再说「已经在磁盘上的不要重派」', () => {
  const r = flat(read('commands/at-resume.md'))
  for (const s of [DENIAL, RESOLVED, LIST, '不要记账推进']) assert.ok(r.includes(s), `at-resume 缺「${s}」`)
  assert.ok(!r.includes('已经在磁盘上的不要重派'), 'at-resume 还在说「已经在磁盘上的不要重派」')
})

test('M4b 架构师：03-arch.md 单列「落盘清单」一节，按前缀粒度、写归哪个 S5 产者、测试放哪；改动小也要有', () => {
  const body = read('agents/at-architect.md')
  const p = paragraphs(body).find((x) => x.includes(LIST))
  assert.ok(p, 'at-architect.md 里没有写落盘清单的那一段')
  const f = flat(p)
  for (const s of ['粒度', '`S5` 的哪个产者', '测试', '改动小也要有']) assert.ok(f.includes(s), `落盘清单那一段缺「${s}」`)
})

test('M4b 架构师：执行角色被写路径隔离拒了——点名别的角色就改派、几个都要改的冒泡给 PM 共列、其余冒泡给 PM 补 paths', () => {
  const body = flat(read('agents/at-architect.md'))
  for (const s of ['改派', '共列', '补 `paths`', '不要在同一条消息里并发派']) assert.ok(body.includes(s), `at-architect.md 缺「${s}」`)
})

test('M4b S5 的产者：被拒时在实现记录里写「被写路径隔离拒绝」一节，补完标「已解决」；多段产者那一句限定在 S5', () => {
  for (const r of S5_PRODUCERS) {
    const p = paragraphs(read(`agents/${r}.md`)).find((x) => x.includes(DENIAL))
    assert.ok(p, `agents/${r}.md 里没有写「${DENIAL}」的那一段`)
    const f = flat(p)
    assert.ok(f.includes('05-impl') && f.includes(RESOLVED), `agents/${r}.md 那一段缺 05-impl 或「${RESOLVED}」：${f}`)
    if (MULTI_STAGE.includes(r)) assert.ok(f.includes('`S5`'), `agents/${r}.md 是多段产者，那一句要限定在 S5：${f}`)
  }
})

test('M4b at-qa：开工前自查把有没解决的被拒条目的实现记录算成没交齐', () => {
  const self = flat(between(read('agents/at-qa.md'), '## 你开工前先自己确认', '## 你有 `Bash`'))
  assert.ok(self.includes(DENIAL) && self.includes(RESOLVED), self)
})

test('M4b at-pm：红线写明 run 进行中也不自己写项目代码与配置', () => {
  assert.ok(
    read('agents/at-pm.md').split('\n').some((l) => l.includes('run 进行中') && l.includes('不自己写项目代码')),
    'agents/at-pm.md 里没有一行同时写着「run 进行中」与「不自己写项目代码」',
  )
})

test('M4b at-init：根级清单、构建配置、测试目录列给每个会改它们的 S5 产者；空目录时是占位；举例不写通配', () => {
  const init = read('commands/at-init.md')
  const s2 = between(init, '## 2. 划分路径归属', '\n## 3')
  const f = flat(s2)
  for (const s of ['根级', '测试目录', '`S5` 产者', '占位', '落盘清单']) assert.ok(f.includes(s), `at-init 第 2 节缺「${s}」`)
  for (const m of s2.matchAll(/`([^`]+)`/g)) assert.ok(!/[*?]/.test(m[1]), `at-init 第 2 节的反引号里出现了通配：${m[1]}`)
  assert.match(init.split('\n').find((l) => l.startsWith('description:')), /S4/)
})

test('M4b 04-dispatch 模板：有「这一趟给 paths 补的前缀」一节', () => {
  assert.ok(read('templates/04-dispatch.md').includes('这一趟给 paths 补的前缀'))
})

test('M4b 正文不再把认领说成「目录前缀」——前缀也可以是单个文件', () => {
  for (const f of ['commands/at-init.md', ...['at-backend', 'at-frontend', 'at-architect', 'at-product', 'at-ui', 'at-ios', 'at-android'].map((r) => `agents/${r}.md`)]) {
    assert.ok(!read(f).includes('目录前缀'), `${f} 还在说「目录前缀」`)
  }
})

// 模板：根级文件只列给 S5 的产者（不给设计类角色），共用 npm 骨架的那一对（后端、前端）列的根级前缀相同。
test('M4b 模板 project.json：有根级前缀；每个根级前缀的认领者都是 S5 的产者；后端与前端的根级前缀相同', () => {
  const tpl = JSON.parse(read('templates/project.json'))
  const rootish = (p) => !p.replace(/\/$/, '').includes('/')
  const claims = Object.entries(tpl.paths).flatMap(([r, ps]) => ps.filter(rootish).map((p) => [r, p]))
  assert.ok(claims.length > 0, '模板里没有根级前缀')
  for (const [r, p] of claims) assert.ok(S5_PRODUCERS.includes(r), `${r} 不是 S5 的产者，却认领了根级前缀 ${p}`)
  const of = (r) => (tpl.paths[r] || []).filter(rootish).sort()
  assert.deepEqual(of('at-backend'), of('at-frontend'))
  assert.ok(of('at-backend').length > 0)
})
