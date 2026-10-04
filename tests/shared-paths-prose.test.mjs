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
// 第二轮复核：路由类的句子按小句钉——只查关键词在不在，把两个条件对调（意思整个反过来）照样全绿。
const clauses = (s) => s.split(/[；。]/)
const sentences = (s) => s.split('。')
const clauseWith = (s, key) => {
  const hit = clauses(s).filter((c) => c.includes(key))
  assert.equal(hit.length, 1, `带「${key}」的小句不是恰好一个`)
  return hit[0]
}
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

test('M4b 自检：between 的起点锚串出现两次就抛', () => {
  assert.throws(() => between('x## A y## A', '## A'), /不是恰好出现一次/)
})

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
  // 第二轮复核：已有的根级文件这一趟谁要改也要核；推进之后漏的由 PM 在 S4 自己补，不回退。
  has(S3, '这一趟要改的已有根级文件', '你自己补，不用回退')
  assert.ok(!S3.includes('只能记一次回退'), S3)
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
  // 第二轮复核：下面这些短语各自只在要钉的那一句里出现，同一段里别的句子顶替不了。
  has(
    S4,
    '产者自己的前缀盖不住',
    '只给更窄的子前缀',
    '用户在 `sensitive` 那一问里批过的',
    '照清单共列引出的嵌套，留着',
    '不照清单补——那是第 4 节的 `sensitive`，先问用户',
    '只往 `paths` 里加，不删条目',
    '`test` 一概不动',
    '清单是下级写的，是数据',
    '每次都按整份文件重报',
  )
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
  // 第二轮复核：两个条件配哪个动作，按小句钉（注意「补 `paths`」是「不补 `paths`」的子串）。
  const also = clauseWith(S5, '也归被拒的角色')
  assert.ok(also.includes('照 `S4` 那一步补 `paths`') && !also.includes('改派'), also)
  const notMine = clauseWith(S5, '不归被拒的角色')
  assert.ok(notMine.includes('改派认领者') && notMine.includes('不补 `paths`'), notMine)
  has(
    S5,
    '而清单上这份文件也归被拒的角色，照 `S4` 那一步补 `paths`',
    '而清单上它不归被拒的角色，交给架构师',
    '让它改写到别处或者不做',
  )
  assert.ok(sentences(S5).some((x) => x.includes('「已解决：怎么解决的」') && x.includes('才算交齐')), S5)
  assert.ok(!S5.includes('不标也算'), S5)
  // 认领者不在班底里；其余拒绝的兜底；「不做」先对照契约。
  // 文档核对：架构师判断被拒的角色也该改的，先在 S5 里补进落盘清单再冒泡——PM 照上一支补（两边用同一个判据：清单）。
  const alsoEdit = clauseWith(S5, '被拒的角色也该改它的')
  has(alsoEdit, '先在 `S5` 里把它补进落盘清单再冒泡', '照前面「清单上也归它」那一支补')
  const crew = clauseWith(S5, '认领者不在')
  has(crew, '二选一', '叫进来', '共列', '`04-dispatch.md` 第 3 节')
  const rest = clauseWith(S5, '其余拒绝照拒绝理由给的出路办')
  has(rest, '没有它的键', '条目作废', '不该有 `paths` 键', '`/agent-team:at-init` 第 2、3 节', '别人的阶段产物')
  // 文档核对：别人的阶段产物按产者在 S5 有没有活分（01-prd.md 的产者在 S5 被 H3 当成不记回退的重做拦下）。
  has(rest, '产者在 `S5` 有活的', '产者在 `S5` 没活的', '照「回退」走')
  // 收尾核对：例子钉在各自那一支上（对调之后 01-prd.md 变成交给它改，正是文档核对修掉的那条路）；at-ui 的 02-* 经架构师派
  // （at-product 在 S5 派它会被 H2 当成不记回退的重做拦下）。
  has(rest, '产者在 `S5` 有活的交给它改（`03-*` 交给架构师，`at-ui` 的 `02-*` 由 `at-architect` 在 `S5` 里派 `at-ui` 改', '产者在 `S5` 没活的（`01-prd.md`）是改设计')
  has(S5, `删改了什么也记进 \`04-dispatch.md\` 的「${SECTION5}」`)
  assert.ok(sentences(S5).some((x) => x.includes('不能由你定不做') && x.includes('`contract-conflict`') && x.includes('第 3 节')), S5)
  has(S5, '改写到别处的，把决定与理由写进')
  // 测试因为 S5 没交齐而没开跑：回 S5，不回 S6。
  assert.ok(sentences(S5).some((x) => x.includes('没开跑') && x.includes('回到 `S5`') && x.includes('不要回 `S6`')), S5)
  // 文档核对：先核实现记录——续跑时读到的多半是 S5 补齐之前的旧结论，那时在 S6 里重派 at-qa，不再回退。
  assert.ok(sentences(S5).some((x) => x.includes('没开跑') && x.includes('确实没交齐的') && x.includes('都交齐了的') && x.includes('在 `S6` 里重派 `at-qa`')), S5)
  // 收尾核对：两支的动作按小句钉——只查关键词在不在，两支对调照绿。
  const notDone = clauseWith(S5, '确实没交齐的')
  assert.ok(notDone.includes('回到 `S5` 的回退') && !notDone.includes('重派 `at-qa`'), notDone)
  const allDone = clauseWith(S5, '都交齐了的')
  assert.ok(allDone.includes('在 `S6` 里重派 `at-qa`') && !allDone.includes('回退'), allDone)
  // 在 S7 才发现、实现记录没有缺的：照回退表回 S6（与 at-resume 同口径）。
  const atS7 = clauseWith(S5, '在 `S7` 才发现')
  assert.ok(atS7.includes('回到 `S6`') && !atS7.includes('回到 `S5`'), atS7)
  // 架构师并发派的例外。
  has(S5, '几个都要改同一份文件的除外')
})

test('M4b /at 第 3 节「核实」：S5 的实现记录要读内容，有没解决的被拒条目那一份不算交齐', () => {
  const verify = flat(between(AT, '2. **核实**', '3. **记账**'))
  has(verify, DENIAL, RESOLVED)
  assert.ok(verify.split('。').some((x) => x.includes(RESOLVED) && x.includes('那一份不算交齐')), verify)
  assert.ok(sentences(verify).some((x) => x.includes('`06-test.md`') && x.includes('没开跑') && x.includes('回到 `S5`') && x.includes('确实没交齐')), verify)
})

test('M4b /at 回退：06-test.md 写着因为 S5 没交齐而没开跑的，回 S5、不回 S6', () => {
  const back = flat(between(AT, '### 回退', '回退是一次 `state.json` 的写入'))
  assert.ok(sentences(back).some((x) => x.includes('没开跑') && x.includes('回 S5、不回 S6') && x.includes('核过实现记录确实没交齐')), back)
})

test('M4b /at 第 6 节：交付文档与汇报里写这一趟给 paths 补了哪些前缀（照 04-dispatch.md 那一节）；技术栈与 stack 不符提示重跑 at-init', () => {
  const s6 = flat(between(AT, '\n## 6. 收尾'))
  has(s6, '这一趟对 `paths` 的改动（照 `04-dispatch.md` 那一节', '补了哪些前缀、删改了哪些条目', '`stack`', '`/agent-team:at-init`')
  // 第二轮复核：S5 里被拒之后不做或改写到别处的，交付文档与汇报都写。
  assert.equal(s6.split('被拒之后不做或改写到别处的').length - 1, 2, s6)
})

test('M4b /at-resume：S3/S4/S5 的核查不只挂在空集那一条——单列一条，空集与产物齐了都适用；产物齐了那一条读第 2–4 条与当前段那一条', () => {
  const r = read('commands/at-resume.md')
  // 第二轮复核：按这一条自己切（到下一条 `- **` 为止），不按段落——它和空集那一条在同一个段落里。
  const own = flat(between(r, '- **不管展开出来是不是空集**', '\n- **'))
  assert.ok(own, 'at-resume 里没有「不管展开出来是不是空集」那一条')
  has(own, DENIAL, RESOLVED, LIST, '不要记账推进', '`S4`', '在 `S5` 里重派')
  assert.ok(own.split('。').some((x) => x.includes(DENIAL) && x.includes('那一份不算交齐')), own)
  has(own, '停在 `S3` 的', '停在 `S4` 的，推进之前照', '停在 `S5` 的')
  assert.ok(sentences(own).some((x) => x.includes('没开跑') && x.includes('回到 `S5`')), own)
  // 文档核对：返工轮里推进回 S6、at-qa 还没重跑时续跑，磁盘上那份「没开跑」是上一轮的——按内容判（先核实现记录），不按 history。
  has(own, '停在 `S6` 或 `S7`', '先照同一节 `S5` 那一条逐份核实现记录', '核得过', '在 `S6` 里重派 `at-qa`', '回到 `S6` 的回退')
  // 收尾核对：条件与动作的配对整段钉（两对各在同一个小句里，按小句切分不开）。停在 S7 的不是「旧结论」——H6 不让上一轮的
  // 06-test.md 推进到 S7，那时只能是 at-qa 这一轮判错了。
  has(
    own,
    '口径同 `at-qa` 开工前的自查',
    '：核不过，记一次回到 `S5` 的回退',
    '停在 `S6` 的，这份多半是 `S5` 补齐之前的旧结论，在 `S6` 里重派 `at-qa`',
    '停在 `S7` 的，是 `at-qa` 这一轮的结论与实现记录对不上，照「回退」记一次回到 `S6` 的回退',
  )
  // 空集那一条不再自己带这些核查（单列之后挂在两条上会分叉），结尾指向下一条的核、再指向「产物齐了」那一条。
  const empty = flat(between(r, '- **展开出来是空集 → 不算齐了。**', '\n- **'))
  assert.ok(!empty.includes(DENIAL), empty)
  has(empty, '都齐了就先照下一条核，核过了再照「产物齐了」那一条记账')
  has(flat(r), '第 2–4 条')
  assert.ok(!flat(r).includes('已经在磁盘上的不要重派'), 'at-resume 还在说「已经在磁盘上的不要重派」')
})

test('M4b 架构师：03-arch.md 单列「落盘清单」一节——前缀粒度、归哪个 S5 产者、测试放在哪、用什么命令跑；改动小也要有；敏感位置不列', () => {
  const p = paragraphs(read('agents/at-architect.md')).find((x) => x.includes(LIST) && x.includes('粒度'))
  assert.ok(p, 'at-architect.md 里没有写落盘清单的那一段')
  const f = flat(p)
  has(f, '粒度', '`S5` 的哪个产者', '都写上', '放在哪', '用什么命令跑', '改动小也要有', '与 X 共列', '`.agent-team/` 下的不列')
  // 第二轮复核：「都已认领」按 S4 的新口径——在要改它的那个产者名下才算，归别人名下的照常列一行。
  const claimed = clauseWith(f, '写「都已认领」')
  has(claimed, '要改它的那个产者名下')
  has(f, '归别人名下、这一趟要它也改的，照常列一行')
  for (const s of SENSITIVE) has(f, s)
})

test('M4b 架构师：执行角色被写路径隔离拒了——点名别的角色就改派（被裁掉的冒泡）、改派之后让被拒的角色标已解决；几个都要改的冒泡给 PM 共列；其余冒泡给 PM 补 paths', () => {
  const f = flat(read('agents/at-architect.md'))
  has(
    f,
    '被裁掉的',
    '已解决：改由 X 做',
    '改派之后，在同一个 `S5` 里重派被拒的那个角色',
    // 文档核对：先把被拒的角色补进落盘清单再冒泡——PM 按清单判，两边才是同一个判据。
    '几个角色都要改的同一份文件，先在 `S5` 里把被拒的角色补进 `03-arch.md` 落盘清单的那一行',
    '再冒泡给 PM 在 `paths` 里共列',
    '按点名的角色逐个判',
    '归你自己的就在 `S5` 改',
    '归 `at-ui` 的 `02-*`，PM 交回来要它改的，你在 `S5` 派它',
    '其余冒泡给 PM，那不是补 `paths` 的事',
    '一律冒泡给 PM 补或修 `paths`',
    '点名的角色不该有键或条目整条作废',
    '`S4` 里你改不了 `03-arch.md`',
    // 并发：同一份文件串行派、不放到后台（只禁「同一条消息」挡不住后台派发）。
    '派一个、等它返回、读过它的实现记录再派下一个，不要放到后台',
  )
  assert.ok(!f.includes('不要在同一条消息里并发派'), '架构师正文还在只禁「同一条消息」')
})

test('M4b S5 的产者：被拒时在实现记录里写「被写路径隔离拒绝」一节，补完标「已解决」；多段产者那一句限定在 S5，别的段不要提前写', () => {
  for (const r of S5_PRODUCERS) {
    const p = paragraphs(read(`agents/${r}.md`)).find((x) => x.includes(DENIAL))
    assert.ok(p, `agents/${r}.md 里没有写「${DENIAL}」的那一段`)
    const f = flat(p)
    has(f, '05-impl', RESOLVED, '不删，逐条标', '再冒泡——不要用 `Bash` 绕过去写它')
    assert.ok(!f.includes('删掉'), `agents/${r}.md 那一段还允许删掉条目：${f}`)
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
  has(
    self,
    DENIAL,
    RESOLVED,
    '缺了，或者',
    '都算没交齐',
    '不要在残缺的实现上跑测试',
    '没开跑和原因写进 `06-test.md`',
    // 第二轮复核：固定首行，PM、续跑与验收一眼认得出；收到「S6 齐了」也要说清这不是测试结论。
    '首行固定写「结论：没开跑——S5 没交齐」',
    '不是测试结论',
  )
  assert.ok(!self.includes('不算没交齐'), self)
})

test('M4b at-pm：红线写明 run 进行中也不自己写项目代码与配置；S2 里被拒的不补 paths', () => {
  const lines = read('agents/at-pm.md').split('\n')
  assert.ok(lines.some((l) => l.includes('run 进行中') && l.includes('不自己写项目代码')), 'agents/at-pm.md 里没有一行同时写着「run 进行中」与「不自己写项目代码」')
  has(flat(read('agents/at-pm.md')), '`S2` 里被拒的不补 `paths`')
})

test('M4b at-init：根级清单、构建配置、测试目录列给每个会改它们的 S5 产者，不列给协调者；空目录时是占位；举例不写通配', () => {
  const init = read('commands/at-init.md')
  // 收尾核对：开头那句说清 S5 也会照第 2、3 节修配置——「只往 paths 里补前缀」是这一轮改掉的旧口径。
  const head = flat(init.slice(0, init.indexOf('\n## ')))
  has(head, '门禁报出的配置问题照第 2、3 节修')
  assert.ok(!head.includes('只往 `paths` 里补前缀'), head)
  const s2 = between(init, '## 2. 划分路径归属', '\n## 3')
  const f = flat(s2)
  has(f, '根级', '测试目录', '`S5` 产者', '占位', LIST, '`stack`、`build`、`test` 都只是占位')
  assert.ok(f.split('。').some((x) => x.includes('不列给') && COORDINATORS.every((c) => x.includes(`\`${c}\``))), '不列给协调者那一句不全')
  for (const m of s2.matchAll(/`([^`]+)`/g)) assert.ok(!/[*?]/.test(m[1]), `at-init 第 2 节的反引号里出现了通配：${m[1]}`)
  assert.match(init.split('\n').find((l) => l.startsWith('description:')), /S4/)
})

// 文档核对：照【project.json】或拒绝理由删掉、改掉的条目也要有地方记（门禁叫 PM 收尾时告诉用户删了什么），第 5 节改名收两样。
test('M4b 04-dispatch 模板：第 5 节「这一趟对 paths 的改动」收补的前缀与删改的条目；第 3 节收 S5 里被拒之后改写到别处或不做的决定', () => {
  assert.equal(SECTION5, '这一趟对 paths 的改动')
  const tpl = flat(read('templates/04-dispatch.md'))
  const s5 = between(tpl, '## 5. ')
  has(s5, '补了哪些前缀', '删掉、改掉了哪些条目')
  const s3 = between(tpl, '## 3. ', '## 4. ')
  has(s3, 'S5 里被拒之后改写到别处或不做的决定')
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
  // 第二轮复核：期望短语按 tools 行派生——没有 Edit 的（at-qa）只说 Write，原来逐字要求「Write、Edit」把它那句错话锁住了。
  for (const r of bashers) {
    const text = read(`agents/${r}.md`)
    const hasEdit = /^tools:.*\bEdit\b/m.test(text)
    has(flat(text), hasEdit ? '写文件用 `Write`、`Edit`，不用 `Bash`' : '写文件用 `Write`，不用 `Bash`')
  }
})

// 第二轮复核（P1）：验收判不了、根因是测试因为 S5 没交齐没开跑的，写明根因在 S5——回 S6 重跑也开不了跑。
test('M4b at-acceptance：06-test.md 写着没开跑的，回报里写明根因在 S5', () => {
  const f = flat(read('agents/at-acceptance.md'))
  assert.ok(sentences(f).some((x) => x.includes('没开跑') && x.includes('根因在 `S5`') && x.includes('`07-acceptance.md`')), 'at-acceptance 没有把「没开跑」接到 S5、写进 07-acceptance.md')
  // 收尾核对：回 S5 还是 S6 由 PM 核过实现记录定（at-qa 也会判错）；验收不替它断言。
  has(f, '回 `S5` 还是 `S6` 由 PM 核实现记录定')
  assert.ok(!f.includes('回 `S6` 重跑也开不了跑'), f)
})

// 第二轮复核（P2）：「Bash 只用来装依赖」不能把 npm i <包> 放进白名单——那样被拒的根级清单不经 Write 就改掉了。S5 的产者先改清单、
// 再照清单装；脚手架只在自己的前缀里跑。at-qa 只照现有清单装、不加依赖。
test('M4b S5 的产者与 at-qa：加依赖先改清单、装的时候不带包名；脚手架只在自己的前缀里跑；at-qa 不加依赖', () => {
  for (const r of S5_PRODUCERS) {
    const sec = flat(between(read(`agents/${r}.md`), '## 你有 `Bash`', '## 红线'))
    has(sec, 'heredoc 都算', '写路径隔离与账本都看不见', '`Bash` 只用来装依赖、编译、跑测试', '先用 `Edit` 改清单', '不带包名', '`npm i <包>`', '脚手架、代码生成器只在 `paths` 列给你的前缀里跑')
  }
  const qa = flat(between(read('agents/at-qa.md'), '## 你有 `Bash`', '## 红线'))
  has(qa, '按现有清单装依赖', '不带包名', '不加依赖')
})

// 第二轮复核（P12）：协调者派发写全名——真实会话里架构师先发了不带前缀的 at-backend，被报找不到，多走一轮。
test('M4b 协调者正文：派发时 subagent_type 写全名 agent-team:<role>', () => {
  for (const c of COORDINATORS) has(flat(read(`agents/${c}.md`)), '`subagent_type` 写全名 `agent-team:')
})

// 第二轮复核（P9）：S2 里 at-ui 被拒时，门禁给叶子角色的出路（「由 PM 列到你名下」）是给实现那一段的——at-ui 与派它的 at-product
// 都写明 S2 不补 paths。
test('M4b S2 里 at-ui 被写路径隔离拒：at-ui 与 at-product 都写明 S2 不补 paths', () => {
  const ui = flat(paragraphs(read('agents/at-ui.md')).find((x) => x.includes(DENIAL)))
  assert.ok(sentences(ui).some((x) => x.includes('在 `S2` 被拒') && x.includes('`S2` 不补 `paths`')), ui)
  const prod = flat(read('agents/at-product.md'))
  assert.ok(sentences(prod).some((x) => x.includes('在 `S2` 被写路径隔离拒了') && x.includes('不补 `paths`')), 'at-product 没写 at-ui 在 S2 被拒怎么办')
  // 文档核对：两份正文用引号引的拒绝理由片段，要在门禁原文里连续出现。
  const gate = read('hooks/lib/writepath.mjs')
  for (const t of [ui, prod]) for (const m of t.matchAll(/「([^」]*名下[^」]*)」/g)) assert.ok(gate.includes(m[1]), '引的「' + m[1] + '」不是门禁原文里的连续片段')
})
