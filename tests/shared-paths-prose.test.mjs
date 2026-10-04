// 根级共享文件与测试目录的认领（M4b，docs/36，全量审查第 21 条修法 1 的改形）。
//
// 不加 shared 键（理由与 docs/16 §3 的三样在 docs/36）。路径归属在 S0 由 /agent-team:at-init 写、布局在 S3 才定，两者之间
// 原来没有一步回头对齐：S5 的执行角色写 tsconfig.json、顶层 tests/ 被 H3 拒，冒泡、PM 中途改 project.json、再重派——真实 run
// 里撞上过（docs/14：PM 为躲开它把后端从 TS 改成了 JS）。改成四处正文：
//   S0  at-init 把磁盘上已有的根级清单、构建配置、测试目录列给每个会改它们的 S5 产者；
//   S3  架构师的 03-arch.md 带「落盘清单」一节，PM 推进出 S3 之前核它（推进之后 S4 里架构师改不了 03-arch.md）；
//   S4  PM 照清单逐行补：归它的产者自己的前缀盖不住的就补（已经归别人的也共列），只加不删；敏感位置先问用户；
//   S5  执行角色被拒时在实现记录里写「被写路径隔离拒绝」一节，补完重写、标「已解决」；PM 有没解决的条目就不推进，
//       逐条看拒绝理由（照方案改 / 补 paths 共列 / 改派认领者 / 不做），在 S5 里重派（不计返工）。
// 门禁看不出实现记录里写没写拒绝（H5b 只核在不在、空不空、旧不旧），这些判据钉的是句子；行为由真实会话核（docs/36 §4）。
// 几处共用的字面量（「被写路径隔离拒绝」「已解决」「落盘清单」、敏感位置清单、04-dispatch.md 第 5 节的标题）抽成常量或从真源读：
// 改名时各处一起红，不会只改一处。第一轮复核（docs/36 §3）：起点锚串必须在全文里唯一；关键词换成只在要钉的那一句里出现的短语，
// 否则同一段里别的句子会顶替它（例：「回退」被「不要回退改设计」顶替）；结论短语一起钉，认得出把「不算交齐」改成「照样算交齐」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stageRoles } from '../hooks/lib/stages.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const flat = (s) => s.replace(/\n[ \t>]*/g, '')
function between(text, a, b) {
  assert.equal(text.split(a).length - 1, 1, `起点锚串「${a.trim()}」在全文里不是恰好出现一次`)
  const i = text.indexOf(a)
  const j = b ? text.indexOf(b, i + a.length) : text.length
  assert.ok(j > i, `「${a.trim()}」之后找不到「${b}」`)
  return text.slice(i, j)
}
const paragraphs = (text) => text.split(/\n\s*\n/)
const has = (s, ...keys) => {
  for (const k of keys) assert.ok(s.includes(k), `缺「${k}」：${s.slice(0, 200)}…`)
}

const DENIAL = '被写路径隔离拒绝'
const RESOLVED = '已解决'
const LIST = '落盘清单'
// 敏感位置：PM 不照清单补、先问用户；架构师不列进清单、写进未决问题。两处用同一份。
const SENSITIVE = ['`.claude/`', '`.git/`', '`CLAUDE.md`', '`CLAUDE.local.md`', '`.mcp.json`', 'CI/CD', '部署与生产配置', '凭据文件']
const SECTION5 = (() => {
  const m = read('templates/04-dispatch.md').match(/^## 5\. (.+)$/m)
  assert.ok(m, 'templates/04-dispatch.md 没有第 5 节')
  return m[1].trim()
})()

const STAGES = JSON.parse(read('stages.json'))
const ROSTER = JSON.parse(read('roster.json'))
const S5_PRODUCERS = STAGES.S5.producers
// 同时还是别的段产者的角色（at-ui 也是 S2 的产者）：它那一句要限定在 S5，否则在 S2 被拒时会提前写出 S5 的实现记录，
// 到 S5 时交付物校验把它当成已经交了。
const otherStagesOf = (r) => Object.entries(STAGES).filter(([id, s]) => id !== 'S5' && stageRoles(s).includes(r)).map(([id]) => id)
const MULTI_STAGE = S5_PRODUCERS.filter((r) => otherStagesOf(r).length > 0)
// 协调者：花名册里派得出人的团队角色（主会话两条键除外）。根级前缀不列给它们。
const COORDINATORS = Object.entries(ROSTER)
  .filter(([r, e]) => r !== 'at-pm' && r !== '__main__' && Array.isArray(e.can_delegate_to) && e.can_delegate_to.length)
  .map(([r]) => r)

const AT = read('commands/at.md')
const S2 = flat(between(AT, '- **S2 产品设计**', '- **S3 技术对齐**'))
const S3 = flat(between(AT, '- **S3 技术对齐**', '- **S4 裁决**'))
const S4 = flat(between(AT, '- **S4 裁决**', '- **S5 实现**'))
const S5 = flat(between(AT, '- **S5 实现**', '### 回退'))

test('M4b 前置：S5 的产者不为空，其中有同时是别的段产者的角色；协调者不为空', () => {
  assert.ok(S5_PRODUCERS.length > 0)
  assert.ok(MULTI_STAGE.length > 0, '没有多段产者——下面那条「带 S5 限定」的判据在空转')
  assert.ok(COORDINATORS.length > 0)
})

test('M4b /at S2：at-ui 在 S2 被写路径隔离拒绝的不补 paths，代码路径留到 S4', () => {
  has(S2, '`S2` 被写路径隔离拒绝', '不补 `paths`', '留到 `S4`')
})

test('M4b /at S3：派架构师时要求 03-arch.md 带落盘清单，推进出 S3 之前核（根级文件、测试放哪），缺了在 S3 里重派', () => {
  has(S3, LIST, '推进出 `S3` 之前', '根级', '测试放哪', '在 `S3` 里重派', '不计返工', '${CLAUDE_PLUGIN_ROOT}/agents/at-architect.md')
})

test('M4b /at S4：推进出 S4 之前逐行补——自己的前缀盖不住的就补（已归别人的也共列），只加不删；敏感位置先问用户；请确认只看这次新加的', () => {
  has(
    S4,
    LIST,
    '推进出 `S4` 之前',
    '盖不住',
    '已经归别人的也补',
    '`S5` 产者名下',
    '`/agent-team:at-init` 第 2 节',
    '只往 `paths` 里加',
    '`available_roles`',
    '`.agent-team/` 下的一律不补',
    '`sensitive`',
    '`/agent-team:at-init` 第 3 节',
    '只看这次新加的前缀',
    '这一趟不加',
    `\`04-dispatch.md\` 的「${SECTION5}」`,
    '清单漏了的',
    '不要派 `at-architect` 去改 `03-arch.md`',
    '补的是认领，不是代写',
  )
  for (const s of SENSITIVE) has(S4, s)
  for (const c of COORDINATORS) has(S4, `\`${c}\``)
  // 「在写 04-dispatch.md 之前」会在返工轮里被跳过（04-dispatch.md 标了 accepted 就不写它）：触发点是推进出 S4。
  assert.ok(!S4.includes('在写 `04-dispatch.md` 之前'), S4)
  // 只补「没人认领」的会让共列永远补不进去（第一轮复核唯一的 high）。
  assert.ok(!S4.includes('却没人认领的前缀'), S4)
})

test('M4b /at S5：有没解决的被拒条目就不推进；逐条看理由；补 paths（共列）或改派或照方案改或不做；在 S5 里重派；推进之后才发现的记回退', () => {
  has(
    S5,
    DENIAL,
    RESOLVED,
    '这一段没做完，不要推进',
    '都返回',
    '照方案改，不补 `paths`',
    '追加进 `04-dispatch.md`',
    '改派认领者',
    '不做',
    '在 `S5` 里重派 `at-architect`',
    '同一段里重派，不计返工',
    '不要回退改设计',
    '不要自己替执行角色写',
    '推进之后才发现的',
    '回退之后、重派之前',
    '旧 run、返工轮都会这样',
  )
  assert.ok(!S5.includes('旧 run 里收到'), S5)
})

test('M4b /at 第 3 节「核实」：S5 的实现记录要读内容，有没解决的被拒条目那一份不算交齐', () => {
  const verify = flat(between(AT, '2. **核实**', '3. **记账**'))
  has(verify, DENIAL, RESOLVED)
  assert.ok(verify.split('。').some((x) => x.includes(RESOLVED) && x.includes('那一份不算交齐')), verify)
})

test('M4b /at 第 6 节：交付文档与汇报里写这一趟给 paths 补了哪些前缀（照 04-dispatch.md 那一节）；技术栈与 stack 不符提示重跑 at-init', () => {
  const s6 = flat(between(AT, '\n## 6. 收尾'))
  has(s6, '补的前缀（照 `04-dispatch.md` 那一节）', '补了哪些前缀', '`stack`', '`/agent-team:at-init`')
})

test('M4b /at-resume：S3/S4/S5 的核查不只挂在空集那一条——单列一条，空集与产物齐了都适用；产物齐了那一条读第 2–4 条与当前段那一条', () => {
  const r = read('commands/at-resume.md')
  const own = flat(paragraphs(r).find((p) => p.includes('- **不管展开出来是不是空集**')) || '')
  assert.ok(own, 'at-resume 里没有「不管展开出来是不是空集」那一条')
  has(own, DENIAL, RESOLVED, LIST, '不要记账推进', '`S4`', '在 `S5` 里重派')
  assert.ok(own.split('。').some((x) => x.includes(DENIAL) && x.includes('那一份不算交齐')), own)
  has(flat(r), '第 2–4 条')
  assert.ok(!flat(r).includes('已经在磁盘上的不要重派'), 'at-resume 还在说「已经在磁盘上的不要重派」')
})

test('M4b 架构师：03-arch.md 单列「落盘清单」一节——前缀粒度、归哪个 S5 产者、测试放在哪、用什么命令跑；改动小也要有；敏感位置不列', () => {
  const p = paragraphs(read('agents/at-architect.md')).find((x) => x.includes(LIST) && x.includes('粒度'))
  assert.ok(p, 'at-architect.md 里没有写落盘清单的那一段')
  const f = flat(p)
  has(f, '粒度', '`S5` 的哪个产者', '都写上', '放在哪', '用什么命令跑', '改动小也要有', '与 X 共列', '`.agent-team/` 下的不列')
  for (const s of SENSITIVE) has(f, s)
})

test('M4b 架构师：执行角色被写路径隔离拒了——点名别的角色就改派（被裁掉的冒泡）、改派之后让被拒的角色标已解决；几个都要改的冒泡给 PM 共列；其余冒泡给 PM 补 paths', () => {
  const f = flat(read('agents/at-architect.md'))
  has(f, '改派', '被裁掉的', '已解决：改由 X 做', '共列', '补 `paths`', '不要在同一条消息里并发派', '`S4` 里你改不了 `03-arch.md`')
})

test('M4b S5 的产者：被拒时在实现记录里写「被写路径隔离拒绝」一节，补完标「已解决」；多段产者那一句限定在 S5，别的段不要提前写', () => {
  for (const r of S5_PRODUCERS) {
    const p = paragraphs(read(`agents/${r}.md`)).find((x) => x.includes(DENIAL))
    assert.ok(p, `agents/${r}.md 里没有写「${DENIAL}」的那一段`)
    const f = flat(p)
    has(f, '05-impl', RESOLVED)
    if (MULTI_STAGE.includes(r)) {
      const head = f.split('：')[0]
      assert.ok(head.includes('`S5`') && !/`S[0-9]`/.test(head.replace(/`S5`/g, '')), `agents/${r}.md 那一段的段首要限定在 S5：${head}`)
      for (const id of otherStagesOf(r)) {
        assert.ok(f.split('。').some((x) => x.includes(`\`${id}\``) && x.includes('不要提前写')), `agents/${r}.md 没写在 ${id} 被拒时不要提前写实现记录`)
      }
    }
  }
})

test('M4b at-qa：开工前自查把缺的、有没解决的被拒条目的实现记录都算成没交齐；没开跑也写进 06-test.md', () => {
  const self = flat(between(read('agents/at-qa.md'), '## 你开工前先自己确认', '## 你有 `Bash`'))
  has(self, DENIAL, RESOLVED, '算没交齐', '没开跑', '写进 `06-test.md`')
})

test('M4b at-pm：红线写明 run 进行中也不自己写项目代码与配置；S2 里被拒的不补 paths', () => {
  const lines = read('agents/at-pm.md').split('\n')
  assert.ok(lines.some((l) => l.includes('run 进行中') && l.includes('不自己写项目代码')), 'agents/at-pm.md 里没有一行同时写着「run 进行中」与「不自己写项目代码」')
  has(flat(read('agents/at-pm.md')), '`S2` 里被拒的不补 `paths`')
})

test('M4b at-init：根级清单、构建配置、测试目录列给每个会改它们的 S5 产者，不列给协调者；空目录时是占位；举例不写通配', () => {
  const init = read('commands/at-init.md')
  const s2 = between(init, '## 2. 划分路径归属', '\n## 3')
  const f = flat(s2)
  has(f, '根级', '测试目录', '`S5` 产者', '占位', LIST, '`stack`、`build`、`test` 都只是占位')
  assert.ok(f.split('。').some((x) => x.includes('不列给') && COORDINATORS.every((c) => x.includes(`\`${c}\``))), '不列给协调者那一句不全')
  for (const m of s2.matchAll(/`([^`]+)`/g)) assert.ok(!/[*?]/.test(m[1]), `at-init 第 2 节的反引号里出现了通配：${m[1]}`)
  assert.match(init.split('\n').find((l) => l.startsWith('description:')), /S4/)
})

test('M4b 04-dispatch 模板：有第 5 节「这一趟给 paths 补的前缀」', () => {
  assert.equal(SECTION5, '这一趟给 paths 补的前缀')
})

test('M4b 正文不再把认领说成「目录前缀」——前缀也可以是单个文件', () => {
  for (const f of ['commands/at-init.md', ...['at-backend', 'at-frontend', 'at-architect', 'at-product', 'at-ui', 'at-ios', 'at-android'].map((r) => `agents/${r}.md`)]) {
    assert.ok(!read(f).includes('目录前缀'), `${f} 还在说「目录前缀」`)
  }
})

// 模板：根级文件只列给 S5 的产者（不给设计类角色），共用 npm 骨架的那一对（后端、前端）列的根级前缀相同；at-init 点名的那几份
// （「不是 Node 项目的，模板里 … 这几条不要带过去」）都在这一对名下，还有一个根级测试目录。
test('M4b 模板 project.json：根级前缀都归 S5 产者；后端与前端相同；at-init 点名的那几份都在；有根级测试目录', () => {
  const tpl = JSON.parse(read('templates/project.json'))
  const rootish = (p) => !p.replace(/\/$/, '').includes('/')
  const claims = Object.entries(tpl.paths).flatMap(([r, ps]) => ps.filter(rootish).map((p) => [r, p]))
  assert.ok(claims.length > 0, '模板里没有根级前缀')
  for (const [r, p] of claims) assert.ok(S5_PRODUCERS.includes(r), `${r} 不是 S5 的产者，却认领了根级前缀 ${p}`)
  const of = (r) => (tpl.paths[r] || []).filter(rootish).sort()
  assert.deepEqual(of('at-backend'), of('at-frontend'))
  const s2 = flat(between(read('commands/at-init.md'), '## 2. 划分路径归属', '\n## 3'))
  const from = s2.indexOf('不是 Node 项目的')
  const named = from >= 0 ? s2.slice(from, s2.indexOf('不要带过去', from)) : ''
  assert.ok(named, 'at-init 第 2 节没有「不是 Node 项目的」那一句')
  for (const m of named.matchAll(/`([^`]+)`/g)) {
    assert.ok(of('at-backend').includes(m[1]) && of('at-frontend').includes(m[1]), `at-init 点名的 ${m[1]} 不在模板后端、前端名下`)
  }
  assert.ok(of('at-backend').some((p) => p.endsWith('/') && /test/.test(p)), '模板里没有根级测试目录')
})

// 实测（docs/36 §4，L1、L3）：执行角色用 Bash 的 heredoc（cat > 文件 <<'E'）写了全部代码与实现记录——写路径隔离与账本都看不见这些
// 写入，被拒的那条路也就不会出现；L3 的实现记录还写着「本轮 Write 成功」。持 Bash 的团队角色（主会话除外）正文写明写文件用
// Write、Edit。集合从 tools 行派生。
test('M4b 持 Bash 的团队角色（主会话除外）：写文件用 Write、Edit，不用 Bash', () => {
  const settings = JSON.parse(read('settings.json'))
  const main = String(settings.agent).split(':').pop()
  const bashers = Object.keys(ROSTER)
    .filter((r) => r !== '__main__' && r !== main)
    .filter((r) => /^tools:.*\bBash\b/m.test(read(`agents/${r}.md`)))
  assert.ok(bashers.length > 0)
  for (const r of bashers) has(flat(read(`agents/${r}.md`)), '写文件用 `Write`、`Edit`，不用 `Bash`')
})
