// M4f（docs/41，审查第 21 条修法 3、第 27 条）：新行为的自动化测试归 S5 的产者写、缺测试怎么走；触达表里不受 paths 管的身份怎么说。
//
// 第 21 条修法 3：原来只有架构师正文提到「新行为的测试」，at-qa 发现缺测试之后 PM 没有路由——S6 推进放行，验收判不了回 S6，at-qa
// 又补不出测试，S6、S7 之间空转；在 S6 里派执行角色补测试被当成不记回退的重做拦下。裁定：S5 的产者写测试（落盘清单定位置），实现
// 记录带「测试」一节，PM 推进出 S5 之前读；at-qa 报缺测试算 S6 不通过、回 S5；验收因为缺测试判不了的也回 S5。门禁照旧不读内容，
// 这一层在正文里，承重的句子整句钉（空白不计）。S5 的产者从 stages.json 派生，不手写清单。
//
// M4f 复核（docs/41 §8）：
//   - 「不写测试」的例外原来认契约第 3 节与架构方案——第 3 节是 PM 自己写的，方案是架构师写的，被验的一方能单方面关掉整套机制；
//     用户中途批的「不要测试」记在修订记录里，反而不被认。现在只认两种：这一次没有新行为；契约第 1 节用户原话或第 4 节修订记录。
//   - 原来 S5 那一侧（产者、PM、at-resume、门禁提醒）收「写明了为什么」的任何理由，at-qa 那一侧只收两种——同一个缺口在 S5 放行、在
//     S6 判不通过，白吃一轮返工。现在各处用同一句（TEST_EXCEPT），整句钉在每一份里。
//   - 复核时有几刀在承重句后面另起一行追加放宽的例外、或者把 S5 那一条挪到别的段底下，全套不红：产者的那一节、at-qa 的那一段改成
//     整节、整段相等；S5、S3、S6/S7 那几条按小节切片再核。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stageRoles } from '../hooks/lib/stages.mjs'
import { IMPL_RECORD_NOTE, IMPL_RECORD_ROLE_NOTE, IMPL_RECORD_PEER_NOTE } from '../hooks/lib/ledger.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8').split(/\r?\n/).join('\n')
const bodyOf = (role) => read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const stages = JSON.parse(read('stages.json'))

// 一个二级标题底下那一节（不含标题行），到下一个二级标题为止。
function sectionUnder(text, heading) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^## /.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}
// 以 head 开头的那一行起、到下一个空行为止的那一段。
function paragraphFrom(text, head) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trimStart().startsWith(head))
  if (start < 0) return null
  const rest = lines.slice(start)
  const end = rest.findIndex((l) => l.trim() === '')
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}
// commands/at.md「各段的具体做法」里以 head 开头的那一条（到下一条「- **」或下一个标题为止）。
function bulletOf(text, head) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith(head))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('- **') || /^#{1,3} /.test(l))
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join('\n')
}

// S5 的产者：stages.json 里产出 05-impl/<role>.md 的那一段叫到的角色（at-architect 是协调者，不在 producers 里时也不算）。
const S5 = Object.entries(stages).find(([, s]) => Array.isArray(s.produces) && s.produces.some((p) => String(p).startsWith('05-impl/')))
const S5_PRODUCERS = S5 ? stageRoles(S5[1]).filter((r) => r !== 'at-architect' && r !== 'at-pm') : []

// 「不写测试」只认的两种情形——产者、at-qa、架构师、PM（/agent-team:at 的 S5 那一条）用同一句。
const TEST_EXCEPT =
  '新行为指这一次改动之后，程序对外表现出来、以前没有或者不一样的东西（接口、页面上的交互、数据怎么存怎么算）。不写自动化测试只有两种情形算数：' +
  '这一次没有新行为（只动了文档、设计稿或纯视觉样式，或者重构没有改变对外的表现）；契约第 1 节用户原话或第 4 节修订记录里，用户说了这部分不要测试。' +
  '别的理由（不好测、要真机、来不及、方案说不上测试框架）都不算。'

const TEST_DUTY =
  '在 `S5` 实现的每一条新行为，由你写自动化测试：照架构方案「落盘清单」定的位置与命令写、跑通。实现记录里写一节 `## 测试`：' +
  '每条新行为 → 测试文件或用例 → 命令 → 结果。' +
  TEST_EXCEPT +
  '属于这两种的，在那一节写明是哪一种：没有新行为的写改了什么，用户说了不要的引出那一句。真写不了、又不属于这两种的（例如项目没有测试框架、' +
  '方案也没定放哪），冒泡给派你的人，由 PM 问用户；用户的答复记进修订记录之后才算数。' +
  '缺了这一节、或者有新行为没有测试又不属于这两种情形的，这一段不算交齐——`at-qa` 会把缺的那几条判成「不通过：缺测试」，退回 `S5` 让你补。'

const QA_TESTS =
  '**新行为有没有自动化测试，也要核**：对照各份实现记录的「测试」一节、`03-arch.md` 与契约，逐条列出哪条新行为没有测试；有缺的，' +
  '`06-test.md` 的结论写「不通过：缺测试」，列出缺哪几条。' +
  TEST_EXCEPT +
  '实现记录说用户不要测试的，去契约第 1 节、第 4 节核那一句在不在；写了别的理由的，照样算缺，理由一并记下。「测试」一节缺了，不照上面' +
  '「S5 没交齐」冒泡，照这一段判。你不写测试（run 目录之外你写不了），也不冒泡（冒泡只用于「S5 没交齐」与红线里的敏感操作）。'

const QA_S5_GATE = '缺了，或者实现记录里有「被写路径隔离拒绝」一节、里面还有没标「已解决」的条目的，都算没交齐：**不要在残缺的实现上跑测试**'
const QA_WRITE = '你没有 `paths` 条目：run 目录之外，写路径隔离拒你的每一次 `Write`——你只写自己那份 `06-test.md`。'
const QA_RED =
  '**对你更紧一层**：`paths` 里没有你的条目，写路径隔离在 run 目录之外拒你的每一次写入——你只写自己那份 `06-test.md`；要改实现、补测试的，' +
  '照实写进 `06-test.md` 的结论（缺测试判「不通过：缺测试」），不用为这个冒泡，也不要拿 `Bash` 去写。`/agent-team:at-init`（写 ' +
  '`.agent-team/project.json` 的那条勘察命令）明确禁止给你建条目。'

const ACC_RED =
  '⚠️ **`paths` 里没有你的条目，意味着写路径隔离在 run 目录之外拒你的每一次写入**：你只写自己那份 `07-acceptance.md`；要改实现或别的文件的，' +
  '照实写进 `07-acceptance.md` 的结论（不合格的判没过），不用为这个冒泡。`/agent-team:at-init`（写 `.agent-team/project.json` 的那条勘察命令）' +
  '明确禁止给你建条目。'
const ACC_NO_TESTS =
  '判不了是因为新行为根本没有自动化测试的，写明是哪几条——那要回 `S5` 补测试（`S5`、`S6`、`S7` 各吃一轮返工额度），不是回 `S6` 补跑。'

const ARCH_DUTY = '交接包的完成定义里写上：为这一次的新行为补自动化测试（放在落盘清单定的位置），实现记录带「测试」一节。'
const ARCH_PLAN = '项目还没有测试框架的，补框架也列进来；觉得这一趟不该写测试的，不要自己定，写进未决问题，由 PM 问用户。'
const ARCH_READ = '读实现记录时也核「测试」一节：缺了、或者有新行为没有测试又不属于下面两种情形的，在 `S5` 里重派它补，补齐了再回报。' + TEST_EXCEPT

const AT_S3 = '方案说这个项目不写测试的（没有测试框架、也不打算补），不是架构师定得了的：照第 4 节问用户（`tradeoff`），答复记进修订记录。'
const AT_S5 =
  '**实现记录的「测试」一节也要读**：缺这一节、或者有新行为没有测试又不属于下面两种情形的，这一段同样没做完——在 `S5` 里重派 ' +
  '`at-architect`，由它重派那个执行角色补（同一段里重派，不计返工）。' +
  TEST_EXCEPT +
  '执行角色为写不了测试冒泡的，照第 4 节问用户（`tradeoff`；契约原话要求测试的是 `contract-conflict`），答复记进修订记录。' +
  '要不要测试不归你定：用户没说不要的，不要写进契约第 3 节——那一节写了也不算数。'
const AT_S67 =
  '- **S6 测试、S7 验收**：【阶段】说齐了、推进被放行，只说明结论交了，不说明过了。推进之前读结论：`06-test.md` 判不通过（含「不通过：缺测试」）、' +
  '`07-acceptance.md` 有没过或判不了的条目的，照下面「回退」或第 4 节处理，不要推进；写着环境跑不起来的，照第 4 节 `env-blocked` 问用户。'
const AT_BACK = '`06-test.md` 报新行为缺自动化测试的也算 S6 没过、回 S5，S7 验收因为缺测试判不了的同样回 S5、不回 S6——S5、S6、S7 各记一轮返工；'

const RESUME_S5 = '「测试」一节缺了、或者有新行为没有测试又不属于那一条列的两种情形的，同样不算——照同一节 `S5` 那一条处理、在 `S5` 里重派。'
// 挂在「产物齐了」那一条里：「不管展开出来是不是空集」那一条有 M4c 的判据不许出现「停在 S6」（tests/shared-paths-prose.test.mjs）。
const RESUME_S67 = '停在 `S6`、`S7` 的，「当前段那一条」是 `S6`、`S7` 那一条：记账之前先读结论，没过、判不了的不要记账推进，照那一条处理。'

const NOTE_PM = '「测试」一节缺了、或者有新行为没有测试又不属于那两种情形的，同样不算（门禁看不出这两点；做法与那两种情形见 /agent-team:at 第 3 节「各段的具体做法」里这一段那一条）。'
const NOTE_ROLE = '「测试」一节缺了、或者有新行为没有测试又不属于你正文「新行为要有自动化测试」那一节说的两种情形的'
const NOTE_PEER = '「测试」一节缺了、或者有新行为没有测试又不属于执行角色正文「新行为要有自动化测试」那一节说的两种情形的也不算'

const CONTRACT_S3 = '「不写自动化测试」不写在这里：要不要测试由用户定（第 1 节原话或第 4 节修订记录），写在这里也不算数'

const INIT_NOKEY =
  '- **也不要给 `at-qa` 与 `at-acceptance` 建键**：它们按设计不认领路径，不写实现代码，只写自己那份 run 产物。没有 `paths` 条目时，' +
  '`hooks/lib/writepath.mjs` 的 `decideWritePath` 在 run 目录之外拒它们的每一次写入——与下面「其余每个会被派到的角色都要有键」那一条一样' +
  '（`at-pm` 不参与路径认领，另行放行），这正是它们该有的样子，它们的正文红线也这样写。你给它们建了键，门禁就照键放行它们写那几个前缀，' +
  '等于在 run 目录之外给它们开了口子（`at-qa` 顺手写测试、`at-acceptance` 顺手改合格，正是它们被禁止的事）；账本会把这个键报出来。'

test('前置：S5 的产者从 stages.json 派生得出来、不是空集——否则下面那条在空清单上恒绿', () => {
  assert.ok(S5, 'stages.json 里找不到产出 05-impl/ 的那一段')
  assert.ok(S5_PRODUCERS.length > 0 && S5_PRODUCERS.includes('at-backend'), S5_PRODUCERS.join('、'))
})

test('M4f 第 21 条修法 3：S5 的每个产者「新行为要有自动化测试」那一节整节就是这一段——追加一句放宽的例外也红', () => {
  for (const role of S5_PRODUCERS) {
    const sec = sectionUnder(bodyOf(role), '## 新行为要有自动化测试')
    assert.ok(sec !== null, `agents/${role}.md 缺「## 新行为要有自动化测试」那一节`)
    assert.equal(stripWs(sec), stripWs(TEST_DUTY), `agents/${role}.md 那一节与约定的不一致（整节比对，空白不计）`)
  }
})

test('M4f 复核：「不写测试」的两种情形，产者、at-qa、架构师、/agent-team:at 的 S5 那一条用的是同一句', () => {
  for (const role of [...S5_PRODUCERS, 'at-qa', 'at-architect']) assert.ok(has(bodyOf(role), TEST_EXCEPT), `agents/${role}.md 缺那一句`)
  assert.ok(has(read('commands/at.md'), TEST_EXCEPT), 'commands/at.md 缺那一句')
  // 例外不认 PM 自己写的第 3 节、不认架构方案：那两处说要不要测试，各处都不再引。
  for (const f of [...S5_PRODUCERS.map((r) => `agents/${r}.md`), 'agents/at-qa.md', 'commands/at.md']) {
    assert.ok(!read(f).includes('契约第 3 节写了不要'), `${f} 还在认契约第 3 节`)
    assert.ok(!read(f).includes('方案定了这个项目不上测试框架'), `${f} 还在认架构方案`)
  }
})

test('M4f：架构师——完成定义写上补测试；落盘清单里补框架、不自己定不写测试；读实现记录时核「测试」一节（整段）', () => {
  const arch = bodyOf('at-architect')
  assert.ok(has(arch, ARCH_DUTY))
  assert.ok(has(arch, ARCH_PLAN))
  const para = paragraphFrom(arch, '读实现记录时也核「测试」一节')
  assert.ok(para !== null, 'agents/at-architect.md 缺「读实现记录时也核「测试」一节」那一段')
  assert.equal(stripWs(para), stripWs(ARCH_READ))
})

test('M4f：/agent-team:at 的 S5 那一条——「测试」一节那一段在 S5 这一条里（不是别的段底下），整段在', () => {
  const s5 = bulletOf(read('commands/at.md'), '- **S5 实现**')
  assert.ok(s5, 'commands/at.md 里找不到「- **S5 实现**」那一条')
  assert.ok(has(s5, AT_S5), 'S5 那一条里缺「测试」一节那一段（整段）')
})

test('M4f 复核：/agent-team:at 的 S3 那一条——方案说不写测试的，照第 4 节问用户', () => {
  const s3 = bulletOf(read('commands/at.md'), '- **S3 技术对齐**')
  assert.ok(s3 && has(s3, AT_S3), 'S3 那一条里缺「方案说这个项目不写测试的」那一句')
})

test('M4f 复核：/agent-team:at 有 S6、S7 那一条——齐了只说明结论交了，推进之前读结论；排在 S5 那一条之后、「回退」之前', () => {
  const at = read('commands/at.md')
  const b = bulletOf(at, '- **S6 测试、S7 验收**')
  assert.ok(b, 'commands/at.md 里找不到「- **S6 测试、S7 验收**」那一条')
  assert.equal(stripWs(b), stripWs(AT_S67))
  const pos = at.indexOf('- **S6 测试、S7 验收**')
  assert.ok(at.indexOf('- **S5 实现**') < pos && pos < at.indexOf('### 回退'), '那一条要排在 S5 那一条之后、「回退」之前')
})

test('M4f：/agent-team:at「回退」——06-test.md 报缺测试算 S6 没过、回 S5；验收因为缺测试判不了的同样回 S5、不回 S6，S5、S6、S7 各记一轮', () => {
  const at = read('commands/at.md')
  const back = at.slice(at.indexOf('### 回退'), at.indexOf('回退是一次 `state.json` 的写入'))
  assert.ok(has(back, AT_BACK), back.slice(0, 200))
})

test('M4f at-qa：核新行为有没有测试那一段整段就是这一段；「S5 没交齐」的条件里没有「测试」一节；写文件那一句与红线整句在', () => {
  const qa = bodyOf('at-qa')
  const para = paragraphFrom(qa, '**新行为有没有自动化测试，也要核**')
  assert.ok(para !== null, 'agents/at-qa.md 缺那一段')
  assert.equal(stripWs(para), stripWs(QA_TESTS), '那一段与约定的不一致（整段比对，空白不计）')
  assert.ok(has(qa, QA_S5_GATE), '「S5 没交齐」那一句变了——缺测试不该让 at-qa 冒泡「没开跑」')
  assert.ok(has(qa, QA_WRITE), '「你没有 paths 条目」那一句变了')
  assert.ok(has(qa, QA_RED), '红线里「对你更紧一层」那一条变了')
})

test('M4f at-acceptance：红线的出路是写进 07-acceptance.md、不用冒泡；判不了是因为没有测试的回 S5，并说清各吃一轮', () => {
  const acc = bodyOf('at-acceptance')
  assert.ok(has(acc, ACC_RED), '红线那一条变了')
  assert.ok(has(acc, ACC_NO_TESTS), '缺测试回 S5 那一句变了')
})

test('M4f at-resume：停在 S5 的，「测试」一节照那两种情形判；停在 S6、S7 的，「产物齐了」那一条里先读结论', () => {
  const r = read('commands/at-resume.md')
  assert.ok(has(r, RESUME_S5), 'S5 那一句变了')
  const done = bulletOf(r, '- **产物齐了**')
  assert.ok(done && has(done, RESUME_S67), '「产物齐了」那一条里缺 S6、S7 那一句')
})

test('M4f 门禁：执行段齐了的三句提醒（给 PM、给这一段的产者、给别的写者）都说「测试」一节', () => {
  assert.ok(IMPL_RECORD_NOTE.includes(NOTE_PM), IMPL_RECORD_NOTE)
  assert.ok(/被写路径隔离拒绝[^。]*已解决[^。]*那一份不算交齐/.test(IMPL_RECORD_NOTE), IMPL_RECORD_NOTE)
  assert.ok(IMPL_RECORD_ROLE_NOTE.includes(NOTE_ROLE), IMPL_RECORD_ROLE_NOTE)
  assert.ok(IMPL_RECORD_PEER_NOTE.includes(NOTE_PEER), IMPL_RECORD_PEER_NOTE)
})

test('M4f 复核：契约的格式与模板都说「不写自动化测试」不写进第 3 节', () => {
  assert.ok(has(read('skills/at-contract-format/SKILL.md'), CONTRACT_S3), 'skills/at-contract-format/SKILL.md 第 3 节那一行')
  assert.ok(has(read('templates/00-contract.md'), CONTRACT_S3), 'templates/00-contract.md 第 3 节')
})

test('M4f 复核：at-init 第 2 节不给 at-qa、at-acceptance 建键那一条整条在——门禁在 run 目录之外拒它们，建了键就是开了口子', () => {
  const init = read('commands/at-init.md')
  assert.ok(has(init, INIT_NOKEY), 'commands/at-init.md 第 2 节那一条变了')
  assert.ok(!init.includes('执行角色里只对它们'), '「执行角色里只对它们」是假话：没有键的执行角色都被拒')
})

test('M4f 第 27 条：at-status 的触达表单列不受 paths 管的身份，旧快照照前缀报并提示重跑 at-init', () => {
  assert.ok(
    has(
      read('commands/at-status.md'),
      '标了 `unrestricted: true` 的（项目经理）单列一行：它在 run 目录之外不受 `paths` 管、写哪都放行，不按前缀报。`reach.json` 里一个角色' +
        '都没有这个字段的，是旧快照：照前缀报，并提示用户重跑 `/agent-team:at-init` 刷新。',
    ),
  )
})

test('M4f 第 27 条：at-init 落盘触达表时，照回传把项目经理说成不受 paths 管', () => {
  assert.ok(has(read('commands/at-init.md'), '那一段把不受 `paths` 管的身份（项目经理）单列在前：收尾告诉用户时照这样说，不要把项目经理说成只能写那几个前缀。'))
})
