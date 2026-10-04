// M3y（docs/33，全量审查第 15 条）：rework_base 进了 state.json 之后，正文里那几句关键的话。
//
// 门禁按 rework_base 分辨上一轮的产物，而 rework_base 是 PM 照正文写的——回退怎么记、之后怎么带着、什么时候标 "accepted"，
// 正文里没写对，H6 就只剩拒绝这一条路（它的拒绝理由给得出整份值，但给不出「为什么要先记回退再派」）。这里钉的是那几句话
// 在不在、说没说对方向；措辞本身不钉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// from 那一行起、到下一个以 to 开头的行为止（不含）。
function section(text, from, to) {
  const start = text.indexOf(from)
  assert.ok(start >= 0, `找不到「${from}」`)
  const rest = text.slice(start + from.length)
  const end = rest.search(new RegExp(`\\n${to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  return end < 0 ? rest : rest.slice(0, end)
}
const AT = read('commands/at.md')
const REWIND = section(AT, '### 回退', '## ')

test('M3y：/at 第 3 节有「回退」一小节，写明先记回退、再派', () => {
  assert.match(REWIND, /先记回退，再派/)
})

test('M3y：「回退」写明同一次 Write 改 stage、history、rework、rework_base，离开的那一段照常记账', () => {
  assert.match(REWIND, /同一次 Write/)
  for (const k of ['`stage`', '`history`', '`rework`', '`rework_base`', '`roster`', '`stage_roles`']) assert.ok(REWIND.includes(k), `「回退」没提 ${k}`)
})

test('M3y：「回退」写明 rework_base 记什么——回到的那一段及之后各段在磁盘上的产物，更早各段原样带过来', () => {
  assert.match(REWIND, /回到的那一段及之后各段/)
  // 文档核对改的：带过来的只是合法条目，坏了的不带（MUT-R10 的判据钉着行为）。
  assert.match(REWIND, /更早各段的合法条目原样带过来（坏了的不带）/)
  assert.match(REWIND, /没有 `rework_base` 的旧 run 回退时同样要写/)
})

test('M3y：「回退」写明 H6 拒的时候照拒绝理由给的整份写，不要自己算', () => {
  assert.match(REWIND, /整份 `rework_base`[^。]*照它写，不要自己算/)
})

test('M3y：「回退」写明之后每一次写入原样带着、只许当前段及更早段标 "accepted"、推进时还旧会被拒', () => {
  assert.match(REWIND, /每一次写 `state\.json` 都原样带着 `rework_base`/)
  assert.match(REWIND, /`"accepted"`[^。]*只许当前段及更早段/)
  assert.match(REWIND, /推进出一段时[^。]*H6 拒/)
})

test('M3y：「回退」写明同一段里重派一个角色不是回退、不往 history 里追加', () => {
  assert.match(REWIND, /不是回退[^。]*不要往 `history` 里追加/)
})

test('M3y：「回退」写明 stage_roles 更早各段的名单不清空', () => {
  assert.match(REWIND, /`stage_roles` 里更早各段的名单不清空/)
})

test('M3y：/at 第 3 节的核实与记账两条都指向「回退」', () => {
  const s3 = section(AT, '## 3. 逐段推进', '### 回退')
  const verify = s3.slice(s3.indexOf('2. **核实**'), s3.indexOf('3. **记账**'))
  assert.match(verify, /返工轮[^。]*`rework_base`/)
  const ledger = s3.slice(s3.indexOf('3. **记账**'), s3.indexOf('4. 把这一段'))
  assert.match(ledger, /原样带着 `rework_base`/)
})

test('M3y：/at 建 run 那一段把 rework_base 列进先留空对象的那几个', () => {
  assert.match(section(AT, '## 1. 建 run', '## '), /`rework_base`[^。]*先留空对象/)
})

test('M3y：at-pm 的返工红线旁给出「回退」的可读路径', () => {
  const pm = read('agents/at-pm.md')
  const line = pm.split('\n').find((l) => l.includes('`rework_base`'))
  assert.ok(line, 'agents/at-pm.md 没提 rework_base')
  assert.ok(line.includes('`${CLAUDE_PLUGIN_ROOT}/commands/at.md`') && line.includes('「回退」'), line)
})

test('M3y：/at-resume 写明返工轮里「在磁盘上」不等于这一轮写过，推进被 H6 拒时照理由走，并给出「回退」的可读路径', () => {
  const resume = read('commands/at-resume.md')
  const block = resume.split(/\n\s*\n/).find((b) => b.includes('`rework_base`'))
  assert.ok(block, 'commands/at-resume.md 没提 rework_base')
  assert.match(block, /不等于这一轮写过/)
  assert.match(block, /H6/)
  assert.match(block, /`"accepted"`/)
  assert.ok(block.includes('`${CLAUDE_PLUGIN_ROOT}/commands/at.md`'))
})

test('M3y：/at-status 的报法列出 rework_base，并写明只列不判新旧', () => {
  const status = read('commands/at-status.md')
  assert.match(section(status, '## 3. 报什么', '## '), /返工基线:[^\n]*rework_base/)
  assert.match(status, /只列出来，不判新旧/)
})

test('M3y：at-qa 写明返工轮要在这一轮的实现上重跑，不拿上一轮的 06-test.md 交差', () => {
  const qa = read('agents/at-qa.md')
  assert.match(qa, /返工轮[^\n]*重跑/)
})

test('M3y：规格 §4.4 的示例带 rework_base、说明它的写法；§6 的 H6 那一行提到它', () => {
  const spec = read('docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md')
  const s44 = section(spec, '### 4.4 状态文件', '## 5.')
  assert.match(s44, /"rework_base": \{/)
  // 复核改的：带过来的条目沿用更早那次快照，「上一次回退那一刻」对它们不成立。
  assert.match(s44, /`rework_base` 记回退快照里各份产物的 sha/)
  assert.doesNotMatch(s44, /记上一次回退那一刻/)
  const h6 = spec.split('\n').find((l) => l.startsWith('| H6 |'))
  assert.ok(h6 && h6.includes('`rework_base`'), h6)
})

test('M3y：stages.README 的 H6 一节写到 rework_base', () => {
  const sec = section(read('stages.README.md'), '## H6 返工预算写时强制', '## ')
  assert.match(sec, /`rework_base`/)
  assert.match(sec, /decideReworkBase/)
})

// ---------------------------------------------------------------- 复核补的（M3y 对抗验证）

// 返工轮里推进进 history 里已有的一段，rework 那一段也要照派生量加 1——H6 只认派生量。原来正文只在回退那一次写入里提 rework，
// 照第 3 条记账会被 H6 拒一次（docs/15 那一趟真撞上过）。
test('M3y：/at 第 3 条写明返工轮里再进走过的段时 rework 那一段加 1；「回退之后」也说；at-pm 与 at-resume 跟上', () => {
  const s3 = section(AT, '## 3. 逐段推进', '### 回退')
  const ledger = s3.slice(s3.indexOf('3. **记账**'), s3.indexOf('4. 把这一段'))
  assert.match(ledger, /返工轮里推进进一段已经走过的[^。]*`rework` 里那一段加 1/)
  assert.match(REWIND, /返工轮里推进进一段已经走过的[^。]*`rework` 里那一段加 1/)
  assert.ok(read('agents/at-pm.md').split('\n').some((l) => l.includes('`rework_base`') && l.includes('`rework` 那一段也加 1')))
  assert.match(read('commands/at-resume.md'), /下一段在 `history` 里已经出现过时还有 `rework`/)
})

// 「原样带着」只到下一次回退为止：再次回退时 H6 要求回到的那一段及之后各段按磁盘重拍，照「不改值」写会被拒。
test('M3y：「原样带着」写明到下一次回退为止、再次回退照第三条重拍；回退那一次就可以标 accepted', () => {
  assert.match(REWIND, /原样带着 `rework_base`\*\*（到下一次回退为止）/)
  assert.match(REWIND, /再次回退时照上面第三条重记/)
  // 复核（真实会话）改的：回退那一次就可以标 accepted（只许回到的那一段及更早段），不用拖到「之后的写入」。
  assert.match(REWIND, /用户已经说过这一轮不用改的[^。]*这一次就可以把它的值写成 `"accepted"`[^。]*只许回到的那一段及更早段/)
  assert.doesNotMatch(REWIND, /在之后的写入里标/)
  const s3 = section(AT, '## 3. 逐段推进', '### 回退')
  assert.match(s3, /再次回退时照「回退」重记/)
})

// 阶段链最后一段没有「推进出去」这次写入，收口不经 H6——正文不能把兜底交给 H6。
// M4a（docs/35）订正：收口那一次写入（closed_at）现在经 H6（hooks/lib/closing.mjs）。三处都改说「把关在收口那一次」，
// 最后一段的产物是验证段的、只能重写。反向：commands/ 与 hooks/lib/ 下不再出现「收口不经 H6」。
test('M3y→M4a：最后一段的把关在收口那一次——/at「回退」、第 6 节收尾、/at-resume 都写明，且不再说「收口不经 H6」', () => {
  assert.match(REWIND, /最后一段没有「推进出去」这次写入，把关在收口那一次/)
  assert.match(section(AT, '\n## 6. 收尾', '## '), /收口那一次 H6 核：最后一段的前置与产物都在、不是空文件、读得出、不是上一轮的/)
  assert.match(read('commands/at-resume.md'), /最后一段没有「推进出去」这次写入，把关在收口那一次/)
  for (const f of ['commands/at.md', 'commands/at-resume.md', 'commands/at-status.md', 'agents/at-pm.md']) {
    assert.doesNotMatch(read(f), /收口不经 H6/, f)
  }
  for (const f of ['ledger.mjs', 'closing.mjs', 'rework-guard.mjs', 'freshness.mjs']) {
    assert.doesNotMatch(read(`hooks/lib/${f}`).replace(/^\s*\/\/.*$/gm, ''), /收口不经 H6/, f)
  }
})

// 一段没走完就回退：那一段还没派到的产者不写 trimmed（产者交代对链上晚于当前段的段不查，coverage.mjs）。
test('M3y：「回退」写明一段没走完就回退时，还没派到的产者不写进 trimmed', () => {
  assert.match(REWIND, /一段没走完就回退[^。]*还没派到的产者不写进 `trimmed`/)
})

// 【返工】只发给 PM；S1、S4、S8 的产物是它自己的。
test('M3y：「回退」里照【返工】重写时，PM 自己那几段的产物自己写', () => {
  assert.match(REWIND, /你自己那几段的产物自己写/)
})

// ============================================================================
// M3z（docs/34，全量审查第 16 条）：第 4 轮有了诚实的写法，不记回退的重做被门禁拦下之后，正文里那几句关键的话。
// 门禁拒绝理由里给得出规范标签与出路，给不出「什么时候问、问完怎么记、用户叫停怎么办」；这里钉那几句在不在、方向对不对。

const S4 = section(AT, '## 4. 什么时候必须停下来问用户', '## ')

test('M3z：「回退」写明 S7 验收要补测回 S6，门禁在派发与写入两帧拦不记回退的重做，只改 stage 被 H6 拒', () => {
  assert.match(REWIND, /S7 验收判不了、要人补跑测试，\n?回 S6/)
  assert.match(REWIND, /拦在派发那一帧/)
  assert.match(REWIND, /拦在写入那一帧/)
  assert.match(REWIND, /只改 `stage`、不往 `history` 追加，H6 拒/)
})

test('M3z：「回退」写明要问已经走过的那一段里干活的人，不要派它，读产物或问用户；协调者派发时不判', () => {
  assert.match(REWIND, /要问已经走过的那一段里干活的人点什么/)
  assert.match(REWIND, /自己读它的产物与代码，或者问用户/)
  assert.match(REWIND, /两个协调者，派发时门禁不判/)
})

test('M3z：/at 第 4 节写明返工预算耗尽怎么问——规范标签、单选、推荐不写进标签、门禁记、叫停、别的话、问不了、上限内不记', () => {
  assert.match(S4, /返工预算耗尽（`budget-exhausted`）不靠你自己数/)
  assert.match(S4, /再返工一轮：回到 <段>/)
  assert.match(S4, /`multiSelect` 设为 false/)
  assert.match(S4, /推荐写在问题正文或\n?\s*选项说明里，\*\*不要写进标签\*\*/)
  assert.match(S4, /门禁自己记下这条批准/)
  assert.match(S4, /用户选了「停在这里」：不回退也不推进/)
  assert.match(S4, /用户写了别的话：照原话办，它不算批准/)
  assert.match(S4, /问不了用户（工具面里没有 `AskUserQuestion`，例如不带权限提示工具的 `-p`、`--bg`）/)
  assert.match(S4, /上限内不用问，问了门禁也不记/)
})

// 「上限内的单角色重试」暗示同段重派也有一个上限、也许还计返工——它不计，也没有那个上限。六处一起改，留一处就是两种说法。
test('M3z：「上限内的单角色重试」在插件正文、模板、规格与门禁代码里一处都不剩', () => {
  const files = [
    'commands/at.md', 'commands/at-resume.md', 'commands/at-status.md', 'agents/at-pm.md', 'templates/04-dispatch.md',
    'docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md', 'hooks/lib/rework-guard.mjs',
  ]
  for (const f of files) assert.ok(!read(f).includes('上限内的单角色重试'), f)
  for (const f of ['commands/at.md', 'agents/at-pm.md', 'templates/04-dispatch.md']) {
    assert.match(read(f), /同一段里重派一个角色（不计返工）/, f)
  }
})

test('M3z：at-pm 指向第 4 节的返工批准；at-resume 说【返工预算】不靠改 state.json；at-status 列返工批准', () => {
  assert.match(read('agents/at-pm.md'), /第 3 轮之后还要再来一轮，得用户批准、由门禁记下/)
  const resume = read('commands/at-resume.md')
  assert.match(resume, /【返工预算】是例外：它不是改 `state\.json` 修得好的/)
  assert.match(resume, /批准还在（门禁记在 run 目录里/)
  assert.match(read('commands/at-status.md'), /返工批准:\s+<\.agent-team\/runs\/<run_id>\/approvals\.jsonl/)
})

test('M3z：at-architect、at-product 写明越过那一段之后派执行角色、改早段产物会被当成重做拦下，冒泡给 PM；at-acceptance 一次列全', () => {
  const arch = read('agents/at-architect.md')
  assert.match(arch, /`S5` 之后再派执行角色，会被当成不记回退的重做拦下/)
  assert.match(arch, /记回退是 PM 的事/)
  assert.match(read('agents/at-product.md'), /都会被门禁当成不记回退的重做拦下/)
  assert.match(read('agents/at-acceptance.md'), /一次把判不了的条目列全/)
})

test('M3z：规格 §4.2 ③ 写到用户经规范标签批准、门禁记下；§6 的 H6 那一行不再说「只拦减少」', () => {
  const spec = read('docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md')
  assert.match(spec, /\*\*第 3 轮之后（M3z 补/)
  assert.match(spec, /门禁自己记下这条批准（`runs\/<id>\/approvals\.jsonl`/)
  const h6 = spec.split('\n').find((l) => l.startsWith('| H6 |'))
  assert.ok(h6 && !h6.includes('只拦**减少**'), h6)
  assert.match(h6, /比写入前大才拒/)
})

// ============================================================================ M4a（docs/35）

const S6 = section(AT, '\n## 6. 收尾', '## ')
const S1 = section(AT, '\n## 1. 建 run', '## ')
const RESUME = read('commands/at-resume.md')
const STATUS = read('commands/at-status.md')
const PM = read('agents/at-pm.md')

test('M4a 回退：验证段的产物不能标 accepted、只追加一句「核过」不算——/at「回退」写明，并指向 stages.json 的 verifies', () => {
  assert.match(REWIND, /验证段（`\$\{CLAUDE_PLUGIN_ROOT\}\/stages\.json` 里写着 `"verifies": true` 的段/)
  assert.match(REWIND, /验证段的产物不在此列[^。]*H6 拒标[^。]*重跑之后重写/)
  assert.match(REWIND, /只追加一句「核过」不算重跑/)
})

// 复核（F3、F8）：收口成功不另发回传——「收到回传之后」改成「没被拒就是收好了」；never_invoked 先算、交付文档后写（文档里要写谁没被叫过）。
test('M4a 收尾：验收没过不收口；先算 never_invoked、再写 08-delivery.md；同一次 Write 记 never_invoked 与 closed_at；没被拒就是收好了', () => {
  assert.match(S6, /验收没过不收口/)
  assert.match(S6, /`08-delivery\.md`/)
  assert.match(S6, /用同一次 Write 记 `never_invoked` 与 `closed_at`/)
  assert.match(S6, /没被 H6 拒，就是收好了（收口成功不另发回传）/)
  const at = (s) => S6.indexOf(s)
  assert.ok(at('验收没过不收口') < at('**算一次**') && at('**算一次**') < at('写交付文档**') && at('写交付文档**') < at('用同一次 Write 记') && at('用同一次 Write 记') < at('就是收好了'), '顺序')
  assert.doesNotMatch(S6, /收到回传之后再告诉用户/)
})

test('M4a 复核 收尾：整段裁掉验收的没有 07，这一步跳过；补交的角色并进 roster 与 stage_roles、never_invoked 重算', () => {
  assert.match(S6, /整段裁掉了 `at-acceptance`[^。]*没有验收结论/)
  assert.match(S6, /补交的角色[^。]*并进 `roster` 与[^。]*`stage_roles`[^。]*`never_invoked` 重算/)
})

test('M4a 收尾：收口之后冻结、不再派人；新改动另起一趟（两条路），契约第 1 节逐字照抄这次的那几条消息；用户明说直接改照办并告知', () => {
  assert.match(S6, /收口之后[^。]*冻结[^。]*不再推进、回退或重开/)
  assert.match(S6, /请用户用 `\/agent-team:at <改动>`/)
  assert.match(S6, /照本文第 0–2 节自己建新 run[^。]*契约第 1 节逐字照抄用户提出这次改动的那几条消息/)
  assert.match(S6, /用户明说不走流程[^。]*照用户说的办[^。]*不经测试与验收/)
})

// 复核（A-5、F1、P4）：停在最后一段、没收口的，先看收不收得了口——验收过了、交付文档写了，就替它收口再建；收不了口的照「停在更早的段」问。
test('M4a 建 run：先看 current-run 那一趟——已收口不问；停在最后一段先看收不收得了口；停在更早段先问续跑还是另起；问不了就另起并告知；不算第 4 节那几类', () => {
  assert.match(S1, /`closed_at` 是一个时间（不是 null）[^。]*不用问/)
  assert.match(S1, /`stage` 是阶段链最后一段、没收口[^。]*验收结论[\s\S]{0,200}照第 6 节第二、四步\s*替它收口/)
  assert.match(S1, /收不了口[^。]*照下面「停在更早的段」\s*那一条问用户/)
  assert.match(S1, /停在更早的段、没收口[^。]*`AskUserQuestion`[^。]*续跑那一趟[^。]*另起这一趟/)
  assert.match(S1, /不属于第 4 节那几类：不记 escalation/)
  assert.match(S1, /问不了用户[^。]*另起这一趟[^。]*接回它的办法/)
})

test('M4a at-resume：已收口不续跑、新改动另起；停在最后一段、齐了没收口就照第 6 节收口', () => {
  assert.match(RESUME, /`closed_at` 是一个时间（不是 null）[^。]*已经收口[^。]*不续跑/)
  assert.match(RESUME, /没被 H6 拒就是收好了/)
  assert.match(RESUME, /`stage` 是阶段链最后一段[^。]*照\s[^。]*第 6 节收口/)
  assert.match(RESUME, /验证段（[^）]*）的产物不能标/)
})

test('M4a at-status：已收口的 run 当前阶段那一行标「已收口」，没被叫过为空写「无」', () => {
  assert.match(STATUS, /已收口（closed_at/)
  assert.match(STATUS, /已收口的 run[^。]*写「无」/)
})

test('M4a at-pm：S8 收口写收口标记；收口之后不派人、不记回退、不自己改项目代码；没收口的 run 不为新需求另起', () => {
  assert.match(PM, /S8[^。]*收口[^。]*`closed_at`/)
  assert.match(PM, /收口之后[^。]*不派人、不记回退[^。]*不自己改项目代码/)
  assert.match(PM, /没收口的 run[^。]*不能为了新需求另起一趟/)
  // 复核（F1、P5）：用户自己跑 /agent-team:at 带来新需求时照它第 1 节办；第 1 节那一问不在第 4 节那几类里。
  assert.match(PM, /用户跑 `\/agent-team:at` 带来新需求时[^。]*照它第 1 节办/)
  assert.match(PM, /第 1 节那一问[^。]*另算/)
})

// 复核（A-4、P3）：模板里 closed_at 的初值是 null，正文判收口不能说「有 closed_at」——每一趟新 run 字面上都「有」。
test('M4a 复核 正文不用「有 `closed_at`」判收口', () => {
  for (const f of ['commands/at.md', 'commands/at-resume.md', 'commands/at-status.md', 'agents/at-pm.md']) {
    assert.doesNotMatch(read(f), /有 `?closed_at`?/, f)
  }
})

// 复核（B-3）：门禁按内容的 sha 判新旧，只追加一句就算这一轮的——正文不许说「追加一句会被拦」。
test('M4a 复核 正文不说「只追加一句会被拦」', () => {
  for (const f of ['agents/at-qa.md', 'agents/at-acceptance.md', 'agents/at-pm.md', 'commands/at.md', 'commands/at-resume.md']) {
    assert.doesNotMatch(read(f), /追加一句[^。；\n]*会被拦/, f)
  }
  assert.match(read('agents/at-acceptance.md'), /门禁看不出你验没验/)
})

// 复核（B-2、P8、B-1）：补记跨过验证段的一律过不了，要拆开写；一次 Write 只记一次回退。
test('M4a 复核 回退记晚了：补记不能跨过验证段、拆开写；一次 Write 只记一次回退', () => {
  assert.match(REWIND, /补记跨过验证段[^。]*过不了[^。]*拆开/)
  assert.match(REWIND, /一次 Write 只记一次回退/)
})

// 复核（B-5）：重跑结果与上一轮相同，报告也要写明这一轮在哪一版上跑的、跑了哪些。
test('M4a 复核 at-qa：结果与上一轮相同也要写明这一轮在哪一版上跑的', () => {
  assert.match(read('agents/at-qa.md'), /结果与上一轮相同也要写明这一轮在哪一版实现上跑的、跑了哪些/)
})

test('M4a at-qa / at-acceptance：返工轮重跑，只追加一句「核过」不算', () => {
  assert.match(read('agents/at-qa.md'), /只追加一句「核过」不算重跑/)
  const acc = read('agents/at-acceptance.md').split(/\n\s*\n/).find((b) => b.includes('返工轮里要重新验'))
  assert.ok(acc && acc.includes('只追加一句「核过」不算'), 'at-acceptance 的「返工轮里要重新验」那一段没写只追加一句不算')
})

// ============================================================================ M4a 复核二（正文）

// PF-5、PF-6：第 1 节替旧 run 收口连同算 never_invoked、回复里告诉用户；整段裁掉验收的看交付文档。
test('M4a 复核二 建 run：替旧 run 收口照第 6 节第二、四步，回复里告诉用户；整段裁掉了验收的看交付文档', () => {
  assert.match(S1, /照第 6 节第二、四步\s*替它收口/)
  assert.match(S1, /告诉用户替上一趟收了口/)
  assert.match(S1, /整段裁掉了验收[^。]*看交付文档/)
  assert.match(S1, /验收没过或判不了、交付文档不在、收口被 H6 拒——都是收不了口/)
})

// PF-2、PF-3：第四步——补齐之后从第一步重走一遍；没有 stage_roles 的旧 run 只并进 roster；没叫过的才能补记 trimmed。
test('M4a 复核二 收尾第四步：补齐之后从第一步重走；旧 run 只并进 roster；trimmed 出路只给这一趟在那一段没叫过的', () => {
  assert.match(S6, /补齐了，从第一步重走一遍再收口/)
  assert.match(S6, /没有 `stage_roles` 的旧 run 只并进 `roster`/)
  assert.match(S6, /这一趟在那一段一个都没叫过它的[^。]*补记进\s*`trimmed`/)
  assert.match(S6, /整段裁掉了 `at-acceptance`（`trimmed` 里记着它在 S7、这一趟在 S7 没叫过它）/)
})

test('M4a 复核二 回退记晚了：拆开写的写法是「先只记回退」', () => {
  assert.match(REWIND, /拆开写：先只记回退/)
})

// PF-7：at-acceptance 的结论与上一轮相同也要写明这一轮依据的是哪一版。
test('M4a 复核二 at-acceptance：结论与上一轮相同也要写明这一轮依据的是哪一版、验了哪些', () => {
  assert.match(read('agents/at-acceptance.md'), /结论与上一轮相同也要写明这一轮依据的是哪一版、验了哪些/)
})

// ============================================================================ M4a 文档核对（正文）

// PG-1：「协调者叫来问可以」在最后一段（H2 拒派协调者）与收口之后（拒派一切团队角色）不成立。
test('M4a 核对 回退：协调者叫来问可以——写明最后一段与收口之后不行', () => {
  assert.match(REWIND, /两个协调者，派发时门禁不判[^。]*最后一段[^。]*收口之后/)
})

// PG-8：收口之后自己另起时，契约第 1 节抄的是用户提出这次改动的那几条消息，不是 $ARGUMENTS。
test('M4a 核对 第 2 节：收口之后自己另起时，第 1 节抄的不是 $ARGUMENTS', () => {
  const s2 = section(AT, '\n## 2. S1 录入', '## ')
  assert.match(s2, /收口之后[^。]*自己另起[^。]*不是 `\$ARGUMENTS`/)
})

// PG-7：at-resume——「产物齐了」那一条不适用于最后一段；最后一段补齐之后从第 6 节第一步重走。
test('M4a 核对 at-resume：产物齐了那一条排除最后一段；补齐之后从第一步重走', () => {
  assert.match(RESUME, /\*\*产物齐了\*\*（不是最后一段）/)
  assert.match(RESUME, /补齐之后照第 6 节从第一步重走一遍再收口/)
})

// PG-9：at-pm 的红线把第 1 节「问不了就另起并告知」那一支一起写上。
test('M4a 核对 at-pm：问不了用户时照第 1 节另起并告知', () => {
  assert.match(PM, /问不了用户就照第 1 节另起这一趟并告诉用户/)
})
