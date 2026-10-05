// 审查第 37 条前半（M4c，docs/37）：正文里契约的记账只说一份账。门禁那一半在 tests/gate-contract-sha.test.mjs。
//
// 原来三处正文（/agent-team:at 第 4 节、契约格式 skill、契约模板）都说「只做其中一件（只改 contract_sha 或只记 escalation）会被报成
// 契约漂移」——门禁分不出两件都做与只做一件，escalation 记没记任何门禁都不核，这句话从来不成立。现在说真话：contract_sha 没跟上的，
// 之后每一次派发返回、每一次写 state.json 都报【契约】；escalation 那一条门禁不核，靠 PM 做全。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const flat = (s) => s.replace(/\n[ \t>]*/g, '')
const sentences = (s) => s.split(/[。；]/)
const has = (s, ...keys) => {
  for (const k of keys) assert.ok(s.includes(k), `缺「${k}」：${s.slice(0, 200)}…`)
}

const THREE = ['commands/at.md', 'skills/at-contract-format/SKILL.md', 'templates/00-contract.md']

test('M4c 三处正文不再说「只做（改）其中一件会被报成契约漂移」，改说真话：没跟上的每次派发返回、每次写 state.json 都报；escalations 门禁不核', () => {
  for (const f of THREE) {
    const t = flat(read(f))
    assert.ok(!/只(做|改)其中一件/.test(t), `${f} 还在说「只做其中一件」`)
    assert.ok(
      sentences(t).some((x) => x.includes('contract_sha') && x.includes('派发返回') && x.includes('state.json') && x.includes('【契约】')),
      `${f}：没有一句同时说出 contract_sha 没跟上、派发返回与写 state.json 时都会报【契约】`,
    )
    assert.ok(sentences(t).some((x) => x.includes('escalations') && x.includes('门禁不核')), `${f}：没有说 escalations 那一条门禁不核`)
  }
})

test('M4c /agent-team:at：契约不进 artifacts（第 1 节记 contract_sha 那里说），回退快照里契约的值取 contract_sha', () => {
  const at = flat(read('commands/at.md'))
  has(at, '契约不进 `artifacts`', '契约取 `contract_sha`')
})

test('M4c at-status、at-resume：读 artifacts 的那几句点明契约除外', () => {
  has(flat(read('commands/at-status.md')), '`00-contract.md` 不进 `artifacts`')
  has(flat(read('commands/at-resume.md')), '契约除外')
})

test('M4c at-acceptance：不再说契约由「账本比对那条链」对账（契约已经移出账本比对）', () => {
  const f = flat(read('agents/at-acceptance.md'))
  assert.ok(!f.includes('账本比对那条链'), f)
  has(f, 'contract_sha')
})
