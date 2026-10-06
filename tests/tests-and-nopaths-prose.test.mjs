// M4f（docs/41，审查第 21 条修法 3、第 27 条）：新行为的自动化测试归 S5 的产者写、缺测试怎么走；触达表里不受 paths 管的身份怎么说。
//
// 第 21 条修法 3：原来只有架构师正文提到「新行为的测试」，at-qa 发现缺测试之后 PM 没有路由——S6 推进放行，验收判不了回 S6，at-qa
// 又补不出测试，S6、S7 之间空转；在 S6 里派执行角色补测试被当成不记回退的重做拦下。裁定：S5 的产者写测试（落盘清单定位置），实现
// 记录带「测试」一节，PM 推进出 S5 之前读；at-qa 报缺测试算 S6 不通过、回 S5；验收因为缺测试判不了的也回 S5。门禁照旧不读内容，
// 这一层在正文里，承重的句子整句钉（空白不计）。S5 的产者从 stages.json 派生，不手写清单。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stageRoles } from '../hooks/lib/stages.mjs'
import { IMPL_RECORD_NOTE } from '../hooks/lib/ledger.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8')
const bodyOf = (role) => read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const stages = JSON.parse(read('stages.json'))

// S5 的产者：stages.json 里产出 05-impl/<role>.md 的那一段叫到的角色（at-architect 是协调者，不在 producers 里时也不算）。
const S5 = Object.entries(stages).find(([, s]) => Array.isArray(s.produces) && s.produces.some((p) => String(p).startsWith('05-impl/')))
const S5_PRODUCERS = S5 ? stageRoles(S5[1]).filter((r) => r !== 'at-architect' && r !== 'at-pm') : []

const TEST_DUTY =
  '在 `S5` 实现的每一条新行为，由你写自动化测试：照架构方案「落盘清单」定的位置与命令写、跑通。实现记录里写一节 `## 测试`：' +
  '每条新行为 → 测试文件或用例 → 命令 → 结果。写不了测试的（契约第 3 节写了不要，或者方案定了这个项目不上测试框架），在那一节写明为什么。' +
  '缺了这一节、或者新行为没有测试也没写明为什么，这一段不算交齐——`at-qa` 会把缺的那几条判成不通过，退回 `S5` 让你补。'

test('前置：S5 的产者从 stages.json 派生得出来、不是空集——否则下面那条在空清单上恒绿', () => {
  assert.ok(S5, 'stages.json 里找不到产出 05-impl/ 的那一段')
  assert.ok(S5_PRODUCERS.length > 0 && S5_PRODUCERS.includes('at-backend'), S5_PRODUCERS.join('、'))
})

test('M4f 第 21 条修法 3：S5 的每个产者都写着同一段——新行为的自动化测试由你写、实现记录带「测试」一节、写不了的写明为什么', () => {
  for (const role of S5_PRODUCERS) assert.ok(has(bodyOf(role), TEST_DUTY), `agents/${role}.md 缺「新行为要有自动化测试」那一段（整段）`)
})

test('M4f：架构师派执行角色时，交接包的完成定义里写上补测试与「测试」一节', () => {
  assert.ok(has(bodyOf('at-architect'), '交接包的完成定义里写上：为这一次的新行为补自动化测试（放在落盘清单定的位置），实现记录带「测试」一节。'))
})

test('M4f：/agent-team:at 的 S5 那一条——推进出 S5 之前读「测试」一节，缺了在 S5 里经架构师重派补', () => {
  assert.ok(
    has(
      read('commands/at.md'),
      '**实现记录的「测试」一节也要读**：缺这一节、或者新行为没有测试也没写明为什么的，这一段同样没做完——在 `S5` 里重派 `at-architect`，' +
        '由它重派那个执行角色补（同一段里重派，不计返工）。',
    ),
  )
})

test('M4f：/agent-team:at「回退」——06-test.md 报缺测试算 S6 没过、回 S5；验收因为缺测试判不了的同样回 S5、不回 S6', () => {
  const at = read('commands/at.md')
  const back = at.slice(at.indexOf('### 回退'), at.indexOf('回退是一次 `state.json` 的写入'))
  assert.ok(has(back, '`06-test.md` 报新行为缺自动化测试的也算 S6 没过、回 S5，S7 验收因为缺测试判不了的同样回 S5、不回 S6；'), back.slice(0, 200))
})

test('M4f at-qa：核新行为有没有测试，缺的判「不通过：缺测试」并列出来；不写测试、不冒泡；契约或方案说不要测试的照实记、不判不通过', () => {
  assert.ok(
    has(
      bodyOf('at-qa'),
      '**新行为有没有自动化测试，也要核**：对照各份实现记录的「测试」一节与 `03-arch.md`，逐条列出哪条新行为没有测试；有缺的，' +
        '`06-test.md` 的结论写「不通过：缺测试」，列出缺哪几条。你不写测试（run 目录之外你写不了），也不冒泡（冒泡只用于「S5 没交齐」与红线里的敏感操作）。' +
        '契约第 3 节写了不要测试、或者方案定了这个项目不上测试框架的，照实记下来，不判不通过。',
    ),
  )
})

test('M4f at-acceptance：判不了是因为新行为没有自动化测试的，写明是哪几条——那要回 S5 补，不是回 S6 补跑', () => {
  assert.ok(has(bodyOf('at-acceptance'), '判不了是因为新行为根本没有自动化测试的，写明是哪几条——那要回 `S5` 补测试，不是回 `S6` 补跑。'))
})

test('M4f at-resume：停在 S5 的，「测试」一节缺了、或者新行为没有测试也没写明为什么的，同样不算交齐', () => {
  assert.ok(has(read('commands/at-resume.md'), '「测试」一节缺了、或者新行为没有测试也没写明为什么的，同样不算——照同一节 `S5` 那一条处理、在 `S5` 里重派。'))
})

test('M4f 门禁：执行段齐了时给 PM 的提醒（IMPL_RECORD_NOTE）也说「测试」一节', () => {
  assert.ok(IMPL_RECORD_NOTE.includes('「测试」一节缺了、或者新行为没有测试也没写明为什么的，同样不算'), IMPL_RECORD_NOTE)
  assert.ok(/被写路径隔离拒绝[^。]*已解决[^。]*那一份不算交齐/.test(IMPL_RECORD_NOTE), IMPL_RECORD_NOTE)
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
