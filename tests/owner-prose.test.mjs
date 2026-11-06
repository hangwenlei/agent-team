// 一趟只归一个会话——正文那一层：/agent-team:at 第 1 节与 /agent-team:at-resume 第 1 节各有「别的会话的一趟」一段，逐字带门禁认的规范标签
// （hooks/lib/owner.mjs 是单一真源）；门禁拒绝理由与【会话】里点名的小节在正文里真的有；at-status 报归属。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SUPPLEMENT_LABEL,
  END_LABEL,
  TAKEOVER_LABEL,
  TAKEOVER_CLOSE_LABEL,
  BACK_LABEL,
  ownerDenyReason,
  sessionNotice,
} from '../hooks/lib/owner.mjs'

const NL = String.fromCharCode(10)
const read = (name) => readFileSync(new URL(`../commands/${name}.md`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
// 「## 1.」到下一个「## 」之间。
function section1(text) {
  const start = text.indexOf(NL + '## 1.')
  assert.ok(start >= 0, '找不到第 1 节')
  const rest = text.slice(start + 1)
  const end = rest.indexOf(NL + '## ', 1)
  return end < 0 ? rest : rest.slice(0, end)
}
const NAME = '别的会话的一趟'

test('at.md 第 1 节有「别的会话的一趟」，逐字带四个标签，且排在「先看 current-run 指着的那一趟」之前', () => {
  const s = section1(read('at'))
  const at = s.indexOf('**' + NAME + '**')
  assert.ok(at >= 0, '第 1 节里要有加粗的「' + NAME + '」')
  const look = s.indexOf('**先看 `.agent-team/current-run` 指着的那一趟**')
  assert.ok(look > at, '「' + NAME + '」要排在「先看 current-run 指着的那一趟」之前')
  const part = s.slice(at, look)
  for (const label of [SUPPLEMENT_LABEL, END_LABEL, TAKEOVER_CLOSE_LABEL, BACK_LABEL]) assert.ok(part.includes('「' + label + '」'), label)
  assert.ok(part.includes('【会话】'), '这一段从【会话】回传起')
  assert.ok(part.includes('补充需求：'), '给用户一句能原样发过去的话')
  assert.ok(part.includes('/agent-team:at-resume'), '原会话没了的出路')
  assert.ok(part.includes('不记 escalation'), '这一问不记 escalation')
})

test('at-resume.md 第 1 节有「别的会话的一趟」，逐字带「回那个会话」「在这个会话接手」', () => {
  const s = section1(read('at-resume'))
  const at = s.indexOf('**' + NAME + '**')
  assert.ok(at >= 0, '第 1 节里要有加粗的「' + NAME + '」')
  for (const label of [BACK_LABEL, TAKEOVER_LABEL]) assert.ok(s.slice(at).includes('「' + label + '」'), label)
  assert.ok(s.slice(at).includes('【会话】'))
})

// /clear 会换一个新的会话 id（CLI 2.1.310 实测）：同一个窗口清空之后就成了「别的会话」。问法、拒绝理由都要说清这算原来那个会话已经关了，
// 不然用户看着同一个窗口会选「回那个会话」，然后找不到它。
test('同一个窗口里用过 /clear 的，算原来那个会话已经关了：两份命令的那一段与拒绝理由都这么说', () => {
  for (const cmd of ['at', 'at-resume']) {
    const s = section1(read(cmd))
    const part = s.slice(s.indexOf('**' + NAME + '**'))
    assert.ok(part.includes('/clear'), cmd)
  }
  assert.match(ownerDenyReason({ runId: 'r1', kind: 'run', via: 'create' }), /\/clear/)
})

test('两处接手的题面都要原样写着那一趟的 run id（门禁凭它认用户批的是哪一趟）', () => {
  for (const cmd of ['at', 'at-resume']) {
    const s = section1(read(cmd))
    const part = s.slice(s.indexOf('**' + NAME + '**'))
    assert.ok(part.includes('题面里必须原样写着那一趟的 run id'), cmd)
  }
})

test('门禁拒绝理由与【会话】里点名的小节在正文里都找得到', () => {
  const texts = [
    ownerDenyReason({ runId: 'r1', kind: 'run', via: 'create' }),
    sessionNotice({ command: 'at', runId: 'r1' }),
    sessionNotice({ command: 'at-resume', runId: 'r1' }),
  ]
  const refs = new Set()
  for (const t of texts) for (const m of t.matchAll(/\/agent-team:([a-z-]+) 第 1 节「([^」]+)」/g)) refs.add(m[1] + '|' + m[2])
  assert.deepEqual([...refs].sort(), ['at-resume|' + NAME, 'at|' + NAME])
  for (const r of refs) {
    const [cmd, name] = r.split('|')
    assert.ok(section1(read(cmd)).includes('**' + name + '**'), cmd + ' 第 1 节没有「' + name + '」')
  }
})

test('at-status.md 报归属：回传里有【会话】的，说它归另一个会话', () => {
  const t = read('at-status')
  assert.ok(t.includes('【会话】'))
  assert.ok(t.includes('归另一个会话'))
})
