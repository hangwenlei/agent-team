// M4i（docs/44）：docs/39 §5 第四轮「H1 与花名册」的正文——第 36 条（派发裁决模板不再叫 S4 写 never_invoked、/agent-team:at 写明记账用裸名）、
// 第 42 条（README 两半写明不支持 agent teams 的 teammate）、第 22 条（README 两半写明设置里别的 agent 会盖掉项目经理、出路）。门禁那一半在
// tests/decide.test.mjs（H1）、tests/gate-check.test.mjs（自检报身份）、tests/state.test.mjs（带前缀的名字、交集）。承重的句子整句钉（空白不计）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n')
const stripWs = (s) => s.replace(/\s+/g, '')
const has = (text, sentence) => stripWs(text).includes(stripWs(sentence))
const README = read('README.md')
const [ZH, EN] = [README.slice(0, README.indexOf('<a id="english"></a>')), README.slice(README.indexOf('<a id="english"></a>'))]
const section = (text, head) => text.slice(text.indexOf(head), text.indexOf('\n## ', text.indexOf(head) + head.length))

// ---- 第 36 条 ----

test('M4i 第 36 条：派发裁决模板第 1 节不再叫 S4 写 never_invoked——它收口时才算', () => {
  const t = read('templates/04-dispatch.md')
  assert.ok(!t.includes('后者写进 state.json 的 never_invoked'), '模板还叫 S4 写 never_invoked')
  assert.ok(has(t, '（不在这里写 state.json 的 never_invoked：它收口时才算，见 /agent-team:at 第 6 节）'))
})

const AT_BARE =
  '角色名写裸名（`at-product`，不带 `agent-team:` 前缀）——派发时 `subagent_type` 写全名，记账不带；`roster`、`stage_roles`、`trimmed`、' +
  '`never_invoked` 都一样，带前缀的按段的判据认不出。'
test('M4i 第 36 条：/agent-team:at 第 3 节第 4 条——记账写裸名', () => {
  const at = read('commands/at.md')
  const s = at.slice(at.indexOf('4. 把这一段真正叫到的角色累加进 `roster`'), at.indexOf('⚠️ **「叫到」的口径，说死在这里**'))
  assert.ok(has(s, AT_BARE), s)
})

// ---- 第 42 条、第 22 条：README 两半的「已知边界」 ----

const ZH_TEAMS =
  '> **不支持 agent teams 的 teammate。** 开了 agent teams（实验功能）时，团队角色仍要作为子代理派出去：带 `name` 的派发会起成 teammate，' +
  '门禁看不见它停下，派发白名单会拒掉这类派发。'
const EN_TEAMS =
  '> **Agent teams teammates are not supported.** With agent teams (experimental) on, team roles must still be dispatched as subagents: a ' +
  'dispatch with a `name` starts a teammate, whose stop the gates cannot see, so the dispatch whitelist refuses it.'
const ZH_AGENT =
  '> **设置里的 `agent` 会盖掉项目经理。** 用户、项目或本地设置里写了别的 `agent`，主会话就不是 `agent-team:at-pm`，团队跑不起来（门禁自检' +
  '会说出来）：去掉那一项设置，或者起会话时加 `--agent agent-team:at-pm`。'
const EN_AGENT =
  '> **An `agent` in your settings overrides the project manager.** If user, project or local settings name another `agent`, the main ' +
  'session is not `agent-team:at-pm` and the team cannot run (the gate self-check says so): remove that setting, or start the session ' +
  'with `--agent agent-team:at-pm`.'
test('M4i 第 42、22 条：README 两半的已知边界——不支持 teammate；设置里的 agent 会盖掉项目经理与出路', () => {
  const zh = section(ZH, '## 已知边界')
  const en = section(EN, '## Known Limitations')
  assert.ok(has(zh, ZH_TEAMS), '中文半缺 teammate 那一条')
  assert.ok(has(en, EN_TEAMS), '英文半缺 teammate 那一条')
  assert.ok(has(zh, ZH_AGENT), '中文半缺设置里的 agent 那一条')
  assert.ok(has(en, EN_AGENT), '英文半缺设置里的 agent 那一条')
})
