// M3x（docs/32，全量审查第 14 条）：stage_roles 进了 state.json 之后，正文里那几句关键的话
//
// 门禁按段取参与者（hooks/lib/stages.mjs 的 participantsOf），而 stage_roles 是 PM 照正文写的——正文里怎么记账、
// 谁读它、旧 run 怎么办，都是这条修法的一半。一条注释不是一条判据：下面每一条钉一句一旦写回旧口径就会让 PM
// 或执行角色做错事的话。按条目或段落定位，不在全文里找关键词——全文找词拦不住「词还在、挪到别处去了」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split('\r\n').join('\n')
const section = (text, from, to) => {
  const a = text.indexOf(from)
  const b = to ? text.indexOf(to, a + from.length) : text.length
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
test('M3x：/at 第 3 节第 3 条写明记账是同一次 Write，且点名 stage、history、roster、stage_roles、trimmed', () => {
  const item = numberedItem(AT_S3, 3)
  assert.match(item, /同一次/, 'commands/at.md 第 3 节第 3 条没写「同一次」写入')
  for (const k of ['stage', 'history', 'roster', 'stage_roles', 'trimmed']) {
    assert.ok(item.includes(`\`${k}\``), `commands/at.md 第 3 节第 3 条（记账）没点名 \`${k}\`——同一次 Write 要把它一起写进去`)
  }
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
  assert.match(sec, /旧 run[^\n]*`roster`/)
})

for (const f of ['commands/at-status.md', 'commands/at-resume.md']) {
  test(`M3x：${f} 第 2 节的展开口径经 participantsOf 取这一段叫到了谁`, () => {
    const sec = section(read(f), '## 2.', '## 3.')
    assert.match(sec, /stageRolesInRun\(stage, participantsOf\(state, stage\)\)/, `${f} 第 2 节的展开口径还是整趟 roster`)
    assert.match(sec, /`stage_roles`/)
  })
}

test('M3x：/at-resume 第 2 节「齐了」那一支指回 /at 的同一次 Write，空集那一支说的是还没记账', () => {
  const sec = section(read('commands/at-resume.md'), '## 2.', '## 3.')
  assert.match(sec, /\*\*产物齐了\*\*[^\n]*同一次 Write/)
  assert.match(sec, /空集只说明这一段还没记账/)
})

test('M3x：/at-status 第 2 节写明当前段还没记账时标「本段未记账」', () => {
  const sec = section(read('commands/at-status.md'), '## 2.', '## 3.')
  assert.match(sec, /本段未记账/)
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
