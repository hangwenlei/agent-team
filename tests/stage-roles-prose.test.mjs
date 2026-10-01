// M3x（docs/32，全量审查第 14 条）：stage_roles 进了 state.json 之后，正文里那几句关键的话
//
// 门禁按段取参与者（hooks/lib/stages.mjs 的 participantsOf），而 stage_roles 是 PM 照正文写的——正文里怎么记账、
// 谁读它、旧 run 怎么办，都是这条修法的一半。一条注释不是一条判据：下面每一条钉一句一旦写回旧口径就会让 PM
// 或执行角色做错事的话。按条目或段落定位，不在全文里找关键词——全文找词拦不住「词还在、挪到别处去了」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split('\r\n').join('\n')
// 节尾只认行首的标题：正文里引用别处「## 3.」这样的字样时，不把它当成这一节的结尾（复核时撞上过）。
const section = (text, from, to) => {
  const a = text.indexOf(from)
  const b = to ? text.indexOf(`\n${to}`, a + from.length) : text.length
  assert.ok(a >= 0 && b > a, `找不到「${from}」到「${to}」那一节——节标题改了的话，这条判据的定位要跟着改`)
  return text.slice(a, b)
}
// 编号条目：行首「N. 」开头，到下一个行首「M. 」或节尾为止（条目下的缩进段落算在条目里）。
const numberedItem = (sec, n) => {
  const m = sec.match(new RegExp(`(?:^|\\n)${n}\\. [\\s\\S]*?(?=\\n\\d+\\. |$)`))
  assert.ok(m, `这一节里找不到第 ${n} 条`)
  return m[0]
}

const AT = read('commands/at.md')
const AT_S3 = section(AT, '## 3. 逐段推进', '## 4.')

// 分两次写的话，推进的那一次落盘时刚走完的那一段还没记它叫到了谁，产者交代会把那一段的产者当成漏派点名——
// 误报和真漏派长得一模一样。这一条今天就成立（M3x 之前第 3 步推进、第 4 步再累加 roster）。
// ⚠️ 只在指令那一半里找：条目后面的理由段（「为什么必须是同一次」）里也有「同一次」和 `stage_roles`、`trimmed`，
// 不切掉它，指令句被删了理由句照样替它充数（复核的变异 m22a、m34 就这样全绿过）。切点找不到时大声失败，不退回整条。
const RATIONALE = '**为什么必须是同一次**'
test('M3x：/at 第 3 节第 3 条的指令写明记账是同一次 Write，且点名 stage、history、roster、stage_roles、trimmed', () => {
  const item = numberedItem(AT_S3, 3)
  const cut = item.indexOf(RATIONALE)
  assert.ok(cut > 0, `commands/at.md 第 3 节第 3 条里找不到理由段的标题「${RATIONALE}」——它改了名，这条判据的切点要跟着改`)
  const instr = item.slice(0, cut)
  assert.match(instr, /同一次 Write/, 'commands/at.md 第 3 节第 3 条的指令没写「同一次 Write」')
  for (const k of ['stage', 'history', 'roster', 'stage_roles', 'trimmed']) {
    assert.ok(instr.includes(`\`${k}\``), `commands/at.md 第 3 节第 3 条的指令（记账）没点名 \`${k}\`——同一次 Write 要把它一起写进去`)
  }
})

test('M3x：/at 第 3 节第 4 条首行写明它与第 3 条的推进是同一次写入', () => {
  const head = numberedItem(AT_S3, 4).replace(/^\n/, '').split('\n')[0]
  assert.match(head, /同一次写入/, 'commands/at.md 第 3 节第 4 条读起来像推进之后的另一步')
  assert.match(head, /`stage_roles`/)
})

test('M3x：/at 第 3 节「叫到」的口径那一段写明它同样管 stage_roles', () => {
  const block = AT_S3.split(/\n\s*\n/).find((b) => b.includes('「叫到」的口径'))
  assert.ok(block, 'commands/at.md 第 3 节里找不到「叫到」的口径那一段')
  assert.match(block, /`stage_roles`/, '「叫到」的口径那一段没提 stage_roles——它与 roster 是同一个口径，按段拆开')
})

test('M3x：/at 第 3 节写明返工轮把这一轮叫到的并进 stage_roles 那一段、不删旧的', () => {
  assert.match(AT_S3, /返工[^\n]*`stage_roles`[^\n]*不删/, 'commands/at.md 第 3 节没写返工轮怎么记 stage_roles（并入、不删）')
})

test('M3x：/at 第 3 节写明没有 stage_roles 的旧 run 不要加它', () => {
  assert.match(AT_S3, /没有 `stage_roles`[^\n]*不要加/, 'commands/at.md 第 3 节没写旧 run（没有 stage_roles）怎么办')
})

// 产者交代按段判之后，「既不在 roster 也不在 trimmed 就报」对带 stage_roles 的 run 不准了。
test('M3x：/at 第 3 节描述产者交代判据时不再说「既不在 roster 也不在 trimmed」', () => {
  assert.doesNotMatch(AT_S3, /既不在 `roster` 也不在 `trimmed`/)
  assert.match(AT_S3, /既不在 `stage_roles` 那一段里/)
})

test('M3x：at-qa 自查 S5 交齐时读 stage_roles.S5（旧 run 看 roster）', () => {
  const sec = section(read('agents/at-qa.md'), '## 你开工前先自己确认 `S5` 交齐了', '## ')
  assert.match(sec, /`stage_roles`/, 'agents/at-qa.md 的自查还按整趟 roster——at-ui 在 S2 叫过，它会去等一份 S5 根本没派的实现记录')
  // 钉主句本身：括注里的 stage_roles 与旧 run 撑不起一个改回「这一趟 roster 提到的每一个」的主句。
  assert.match(sec, /producers` 里，\s*`state\.json` 的\s*`stage_roles`\s*在\s*`S5`/, 'at-qa 自查的主句没按 stage_roles 的 S5 那一段说')
  assert.match(sec, /旧 run[^\n]*`roster`/)
})

for (const f of ['commands/at-status.md', 'commands/at-resume.md']) {
  test(`M3x：${f} 第 2 节的展开口径经 participantsOf 取这一段叫到了谁`, () => {
    const sec = section(read(f), '## 2.', '## 3.')
    assert.match(sec, /stageRolesInRun\(stage, participantsOf\(state, stage\)\)/, `${f} 第 2 节的展开口径还是整趟 roster`)
    assert.match(sec, /`stage_roles`/)
  })
}

const RESUME = read('commands/at-resume.md')
const RESUME_S2 = section(RESUME, '## 2.', '## 3.')
const bulletOf = (sec, head) => {
  const m = sec.match(new RegExp(`\\n- ${head}[\\s\\S]*?(?=\\n- |\\n\\n|$)`))
  assert.ok(m, `找不到以「${head}」开头的那一条`)
  return m[0]
}

test('M3x：/at-resume 第 2 节「齐了」那一支指回 /at 的同一次 Write，空集那一支说的是还没记账', () => {
  const done = bulletOf(RESUME_S2, '\\*\\*产物齐了\\*\\*')
  assert.match(done, /同一次 Write/)
  assert.match(RESUME_S2, /空集只说明这一段还没记账/)
})

// 续跑时 PM 手上没有 /agent-team:at 的正文（主会话没有 Skill 工具），不给可读的路径就读不到那几条规矩——
// 真实会话里没读到的几次都把 trimmed 写成了 { 段: [角色] }（docs/32 §3）。
test('M3x：/at-resume「产物齐了」那一支给出 at.md 的可读路径、两个字段的方向，并写明旧 run 不加 stage_roles', () => {
  const done = bulletOf(RESUME_S2, '\\*\\*产物齐了\\*\\*')
  assert.ok(done.includes('`${CLAUDE_PLUGIN_ROOT}/commands/at.md`'), '「产物齐了」那一支没给 at.md 的路径')
  assert.match(done, /`stage_roles` 是 `\{ 段: \[角色\] \}`[^\n]*`trimmed` 是 `\{ 角色: 段 \}`/)
  assert.match(done, /没有 `stage_roles`[^\n]*不要加/, '「产物齐了」那一支没写旧 run（没有 stage_roles）不要加')
})

test('M3x：/at-resume 里引用 /agent-team:at 某一节的段落，都带着 at.md 的可读路径', () => {
  const paras = RESUME.split(/\n\s*\n/).filter((p) => p.includes('`/agent-team:at`') && /节/.test(p))
  assert.ok(paras.length > 0, '前置：commands/at-resume.md 里找不到引用 /agent-team:at 某一节的段落——这条判据空转了')
  for (const p of paras) {
    assert.ok(p.includes('`${CLAUDE_PLUGIN_ROOT}/commands/at.md`'), `这一段引用了 /agent-team:at 的某一节，却没给可读路径：${p.slice(0, 80)}`)
  }
})

// S2 的空集那一支：at-ui 那两份只在这一趟要用 at-ui 时才算缺。写成判齐的必要条件，被裁的 at-ui 会被当成没交、去补派。
test('M3x：/at-resume 空集那一支不把 at-ui 的两份写成 S2 齐了的必要条件，不用它时指去 trimmed', () => {
  const empty = bulletOf(RESUME_S2, '\\*\\*展开出来是空集')
  assert.match(empty, /`at-ui` 那两份[^。]*只在这一趟要用 `at-ui` 时才算缺/)
  assert.match(empty, /`trimmed`/)
})

// 只对展开出空集的段标：PM 自己做的段永远没有键，产物固定的段与参与者无关——它们照常按展开结果报。
test('M3x：/at-status 第 2 节只对展开出空集、还没记账的段标「本段未记账」', () => {
  const sec = section(read('commands/at-status.md'), '## 2.', '## 3.')
  assert.match(sec, /展开出来是空集[^。]*`stage_roles`[^。]*本段未记账/)
})

// at-architect 那一段原来说「那条判据按角色名判、不按段……看不见」——带 stage_roles 的 run 上它看得见了，
// 冒泡仍然必要，理由换成「它只在推进出去之后才报，报出来时你那句理由不在里面」。
test('M3x：at-architect 的「不要指望后面有判据兜底」不再说那条判据按角色名判、看不见', () => {
  const block = read('agents/at-architect.md').split(/\n\s*\n/).find((b) => b.includes('不要指望后面有判据兜底'))
  assert.ok(block, 'agents/at-architect.md 里找不到「不要指望后面有判据兜底」那一段')
  assert.doesNotMatch(block, /它\*\*按角色名判，不按段\*\*/)
  assert.match(block, /`stage_roles`/)
})

test('M3x：规格 §4.4 的示例带 stage_roles，例外句点名 trimmed 与 stage_roles', () => {
  const spec = read('docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md')
  const sec = section(spec, '### 4.4 状态文件', '## 5.')
  assert.match(sec, /"stage_roles": \{/)
  assert.match(sec, /除 `trimmed` 与 `stage_roles` 外每一个都报/)
})

test('M3x：at-pm 的「怎么写、为什么」指回 at.md 时给出可读路径', () => {
  const block = read('agents/at-pm.md').split(/\n\s*\n/).find((b) => b.includes('逐段推进那一节'))
  assert.ok(block, 'agents/at-pm.md 里找不到指回「逐段推进那一节」的那一段')
  assert.ok(block.includes('`${CLAUDE_PLUGIN_ROOT}/commands/at.md`'))
})

// stages.README「`produces` 的两种形式」一节是 /at-status、/at-resume 运行时让模型去读的。那里教人怎么展开的引导句
// 要是还只写整趟 roster，按段的消费方就会被教回第 14 条那个错。
test('M3x：stages.README「produces 的两种形式」里教人展开的引导句同时提到 participantsOf', () => {
  const sec = section(read('stages.README.md'), '## `produces` 的两种形式', '## ')
  const guides = sec.split(/\n\s*\n/).filter((p) => p.includes('stageRolesInRun(stage,'))
  assert.ok(guides.length > 0, '前置：那一节里找不到 stageRolesInRun(stage, 的引导句——这条判据空转了')
  for (const g of guides) assert.match(g, /participantsOf/, `这一段教人展开却没提按段取：${g.slice(0, 80)}`)
})

test('M3x：stages.README 的 H5a 静默表 S5 那一行按 stage_roles 的 S5 说，旧 run 看 roster', () => {
  const row = read('stages.README.md').split('\n').find((l) => /^\| S5 \|/.test(l))
  assert.ok(row, 'stages.README.md 里找不到 H5a 静默表的 S5 行')
  assert.match(row, /`stage_roles\.S5`/)
  assert.match(row, /旧 run[^|]*`roster`/)
})

// 规格 §4.4 的示例要能当一份真的账照着写：各段的 stage_roles 合起来就是 roster（validateState 双向核它）。
test('M3x：规格 §4.4 示例里 stage_roles 各段合起来恰好是 roster', () => {
  const sec = section(read('docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md'), '### 4.4 状态文件', '## 5.')
  const m = sec.match(/```json\n([\s\S]*?)\n```/)
  assert.ok(m, '规格 §4.4 里找不到 json 示例')
  const ex = JSON.parse(m[1])
  assert.deepEqual([...new Set(Object.values(ex.stage_roles).flat())].sort(), [...ex.roster].sort())
  // 示例下面那句说「S5 里也记着被叫去分发的架构师」——口径与 /at 的例子一致，示例要真的照着写（复核的变异 r6 拿掉它全绿）。
  assert.ok(ex.stage_roles.S5.includes('at-architect'), '规格 §4.4 示例的 S5 没记分发的架构师，与示例下面那句、与 /at 的口径不一致')
})

test('M3x：规格 §4 母表的按段那一行列着产者交代（decideCoverage）', () => {
  const row = read('docs/superpowers/specs/2026-09-15-agent-team-plugin-design.md').split('\n').find((l) => l.includes('这一段叫到的人') && l.startsWith('> |'))
  assert.ok(row, '规格 §4 母表里找不到按段的那一行')
  assert.match(row, /decideCoverage/)
})
