// 需求稿（docs/95）的纯函数那一层：/agent-team:at 建 run 之前，项目经理把问清的需求整理成需求稿，用 AskUserQuestion 单选问要不要照它开始，
// 题面就是整份需求稿；用户选了规范标签，批准记录器把题面记成这一次的原话（source: 'ask'）。这里核：认回答（briefAnswer）、记录的来源
// （pendingRecord、readWords）、对不上时按来源说（wordsMismatchText）、给项目经理的那一段（briefNotice）。子进程那一层在 tests/gate-brief.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BRIEF_LABEL, USER_WORDS_FILE, briefAnswer, briefNotice, pendingRecord, readWords, wordsMismatchText } from '../hooks/lib/user-words.mjs'
import { approvalIntent } from '../hooks/lib/budget.mjs'
import { deliverIntent } from '../hooks/lib/verdict.mjs'

const NL = String.fromCharCode(10)
const DRAFT = ['要做什么、为什么：给待办加一个截止日期，过期的标红', '给谁用：自己', '做完的样子：', '1. 新建待办时能选截止日期', '2. 过期的待办标红', '不做：提醒推送', '约束：不加依赖'].join(NL)

// PostToolUse:AskUserQuestion 的 tool_response（只放要用的键）。
const asked = (answer, { question = DRAFT, multiSelect = false, extra = {}, notes = null } = {}) => ({
  questions: [{ question, header: '需求定稿', multiSelect, options: [{ label: BRIEF_LABEL, description: '' }, { label: '再改改', description: '' }] }],
  answers: { [question]: answer },
  ...(notes === null ? {} : { annotations: { [question]: { notes } } }),
  ...extra,
})

test('briefAnswer：选了「照这份需求开始」的那道题，题面原样就是需求稿；推荐后缀与空白不计', () => {
  assert.deepEqual(briefAnswer(asked(BRIEF_LABEL)), { draft: DRAFT })
  assert.deepEqual(briefAnswer(asked(BRIEF_LABEL + '（推荐）')), { draft: DRAFT })
  assert.deepEqual(briefAnswer(asked(' 照这份 需求开始 ')), { draft: DRAFT })
  // 题面原样：行尾空白、空行都不动（契约第 1 节对它核时自己会去掉不计的东西）。
  const raw = '做一个待办应用  ' + NL + NL + '能加、能删'
  assert.deepEqual(briefAnswer(asked(BRIEF_LABEL, { question: raw })), { draft: raw })
})

test('briefAnswer：没有像批准需求稿的回答回 null（门禁不出声）', () => {
  for (const tr of [null, 'x', {}, { answers: 'x' }, asked('再改改'), asked('照原话直接开始'), asked('再返工一轮：回到 S2'), asked('照现状交付'), asked(42)]) {
    assert.equal(briefAnswer(tr), null, JSON.stringify(tr))
  }
})

test('briefAnswer：像批准却不记——多选、数组、标签夹了别的话、题面空、带备注、离开键盘、要追问、另写了话、不止一道题选了它', () => {
  const why = (tr) => briefAnswer(tr)?.why
  assert.equal(why(asked(BRIEF_LABEL, { multiSelect: true })), 'multi')
  assert.equal(why(asked([BRIEF_LABEL])), 'array')
  assert.equal(why(asked(BRIEF_LABEL + '，但是第 2 条去掉')), 'malformed')
  assert.equal(why(asked(BRIEF_LABEL, { question: '  ' })), 'blank')
  assert.equal(why(asked(BRIEF_LABEL, { notes: '第 2 条去掉' })), 'notes')
  assert.deepEqual(briefAnswer(asked(BRIEF_LABEL, { notes: '   ' })), { draft: DRAFT }, '只有空白的备注不算备注')
  assert.equal(why(asked(BRIEF_LABEL, { extra: { afkTimeoutMs: 60000 } })), 'afk')
  assert.equal(why(asked(BRIEF_LABEL, { extra: { followUp: true } })), 'follow-up')
  assert.equal(why(asked(BRIEF_LABEL, { extra: { response: '等一下' } })), 'response')
  const two = {
    questions: [{ question: DRAFT, multiSelect: false }, { question: DRAFT + '（另一份）', multiSelect: false }],
    answers: { [DRAFT]: BRIEF_LABEL, [DRAFT + '（另一份）']: BRIEF_LABEL },
  }
  assert.equal(why(two), 'several')
})

test('briefAnswer：同一次问里别的题选了别的（项目经理不该这么问）不碍事；返工与照现状交付的认法不认这个标签', () => {
  const tr = {
    questions: [{ question: DRAFT, multiSelect: false }, { question: '颜色？', multiSelect: false }],
    answers: { [DRAFT]: BRIEF_LABEL, '颜色？': '红' },
  }
  assert.deepEqual(briefAnswer(tr), { draft: DRAFT })
  assert.equal(approvalIntent(BRIEF_LABEL), null)
  assert.equal(deliverIntent(BRIEF_LABEL), null)
})

test('pendingRecord 与 readWords：记录带来源——需求稿是 ask，命令带的参数与没有这个键的旧记录是 command', () => {
  const ask = pendingRecord({ at: 't', sessionId: 's-1', args: DRAFT, runsBefore: ['r0'], source: 'ask' })
  assert.equal(ask.source, 'ask')
  assert.equal(readWords(JSON.stringify(ask)).source, 'ask')
  assert.equal(pendingRecord({ at: 't', sessionId: 's-1', args: 'x', runsBefore: [] }).source, 'command')
  assert.equal(pendingRecord({ at: 't', sessionId: 's-1', args: 'x', runsBefore: [], source: 'whatever' }).source, 'command')
  const old = { at: 't', session_id: 's-1', args: 'x', runs_before: [], binding: null, bound: 'r1', dropped: null }
  assert.equal(readWords(JSON.stringify(old)).source, 'command', '这一版之前记的没有 source，是命令带的参数')
  assert.equal(readWords(JSON.stringify({ ...old, source: 'ASK' })).source, 'command')
})

test('wordsMismatchText：来源是 ask 时说「对不上用户批准的需求稿」、点规范标签；别的照命令带的参数说', () => {
  const m = { kind: 'line', line: 2, want: '给谁用：自己', got: '给谁用：大家' }
  const ask = wordsMismatchText(m, 'ask')
  assert.ok(ask.startsWith('契约第 1 节对不上用户批准的需求稿（门禁在用户点「' + BRIEF_LABEL + '」时记下了它'), ask)
  assert.ok(ask.includes(USER_WORDS_FILE) && ask.includes('第 1 节第 2 行应是'), ask)
  assert.ok(!ask.includes('/agent-team:at 后面写的原话'), ask)
  for (const t of [wordsMismatchText(m), wordsMismatchText(m, 'command')]) assert.ok(t.startsWith('契约第 1 节对不上用户在 /agent-team:at 后面写的原话'), t)
})

test('briefNotice：记下了说照它建这一趟、第 1 节逐字照抄；用户那一侧的原因叫它改好再问、不要建 run；门禁这一侧记不下叫用户贴在命令后面重发', () => {
  const ok = briefNotice()
  assert.ok(ok.startsWith('【需求稿】门禁记下了用户批准的这份需求稿'), ok)
  for (const k of ['契约第 1 节逐字照抄它', '推进出第一段时门禁拿它核', '批准之前就建好的 run 不认它']) assert.ok(ok.includes(k), k)
  for (const why of ['afk', 'follow-up', 'response', 'notes', 'multi', 'array', 'malformed', 'blank', 'several']) {
    const t = briefNotice(why)
    assert.ok(t.startsWith('【需求稿】用户这次的回答没有记成批准：') && t.includes('在那之前不要建 run') && t.includes(`「${BRIEF_LABEL}」`), `${why}：${t}`)
    assert.ok(!t.includes('回答的形状认不出'), `${why} 有自己的说法`)
  }
  for (const why of ['no-session', 'no-agent-team', 'write-failed']) {
    const t = briefNotice(why)
    assert.ok(t.startsWith('【需求稿】门禁没有记下') && t.includes('/agent-team:at 后面重发') && t.includes('不要照现在这样往下建 run'), `${why}：${t}`)
  }
})
