// M3v（docs/30，全量审查第 12 条）：门禁判不出来而放行时说给谁听、说什么。这里钉纯函数这一层（hooks/lib/fail-open.mjs）：
// 输出长什么样（平台契约）、按原因选的修法、unknown-stage 的两支、门禁自检理由的追加句。子进程那一层在
// tests/gate-fail-open.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAUSES,
  GATE_NAME,
  crashContext,
  dispatchNoRunNotice,
  dispatchUnreadableNotice,
  hookOutput,
  ledgerUnreadableNotice,
  runContextFix,
  selfCheckAppendix,
  systemMessage,
  unknownStageDesc,
  unknownStageFix,
  unknownStageNotice,
} from '../hooks/lib/fail-open.mjs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'
import { decideDeliverable, isKnownStage } from '../hooks/lib/deliverable.mjs'

const EVENTS = ['PreToolUse', 'PostToolUse', 'SubagentStop', 'UserPromptSubmit', undefined, 'bogus']
const PARTS = [
  {},
  { contexts: [] },
  { contexts: ['【门禁】一段'] },
  { systemMessage: 'agent-team 一行' },
  { contexts: ['【门禁】一段', '【账本比对】另一段'], systemMessage: 'agent-team 一行' },
  { contexts: [null, '', 3] },
]

// 平台契约（调研 F3、F6、F12）：fail open 的输出里出现 permissionDecision 的 allow 会绕过权限确认，continue:false 会停整轮，
// 两份 JSON 会让回传全丢，hookEventName 与事件不符会让整份输出作废。
test('hookOutput：对任何事件、任何入参，stdout 要么为空、要么是恰好一份不带决策字段的 JSON 对象', () => {
  for (const event of EVENTS) {
    for (const parts of PARTS) {
      const { stdout } = hookOutput(event, parts)
      if (stdout === '') continue
      const v = JSON.parse(stdout)
      assert.equal(typeof v, 'object')
      assert.ok(!('decision' in v) && !('continue' in v), `${event}：${stdout}`)
      const hso = v.hookSpecificOutput
      if (hso !== undefined) {
        assert.equal(hso.hookEventName, event)
        assert.ok(!('permissionDecision' in hso), `${event}：${stdout}`)
        assert.equal(typeof hso.additionalContext, 'string')
      }
      if ('systemMessage' in v) assert.equal(typeof v.systemMessage, 'string')
    }
  }
})

test('hookOutput：PostToolUse 上几段并成一份受信块，systemMessage 在顶层', () => {
  const { stdout, bug } = hookOutput('PostToolUse', { contexts: ['【门禁】甲', '【账本比对】乙'], systemMessage: 'agent-team 一行' })
  assert.equal(bug, null)
  const v = JSON.parse(stdout)
  assert.deepEqual(Object.keys(v).sort(), ['hookSpecificOutput', 'systemMessage'])
  assert.ok(v.hookSpecificOutput.additionalContext.startsWith(TRUSTED_PREFIX))
  assert.equal(v.hookSpecificOutput.additionalContext.split(TRUSTED_PREFIX).length - 1, 1)
  assert.match(v.hookSpecificOutput.additionalContext, /【门禁】甲\n\n【账本比对】乙/)
  assert.equal(v.systemMessage, 'agent-team 一行')
})

test('hookOutput：PostToolUse 上什么都没有时不写 stdout；只有 systemMessage 时不带 hookSpecificOutput', () => {
  assert.equal(hookOutput('PostToolUse', {}).stdout, '')
  assert.equal(hookOutput('PostToolUse', { contexts: [null, ''] }).stdout, '')
  assert.deepEqual(JSON.parse(hookOutput('PostToolUse', { systemMessage: 'x' }).stdout), { systemMessage: 'x' })
})

// PreToolUse 上几道 hook 的 context 被平台并成一段、不标来源（会话 ccf48d1e）：本插件的受信块排在前面时，后面紧跟的别家
// 文字读起来就是它的续行。所以 PreToolUse 上结构上不发受信块，只许 systemMessage。
test('hookOutput：PreToolUse 上不发受信块——contexts 丢掉并报 BUG，systemMessage 照发', () => {
  const a = hookOutput('PreToolUse', { contexts: ['【门禁】甲'] })
  assert.equal(a.stdout, '')
  assert.match(a.bug, /BUG/)
  const b = hookOutput('PreToolUse', { contexts: ['【门禁】甲'], systemMessage: 'agent-team 一行' })
  assert.deepEqual(JSON.parse(b.stdout), { systemMessage: 'agent-team 一行' })
  assert.ok(!b.stdout.includes(TRUSTED_PREFIX))
  assert.equal(hookOutput('PreToolUse', { systemMessage: 'x' }).bug, null)
})

// SubagentStop 上 exit 0 带 additionalContext 等于拦截（续跑、计入 CLAUDE_CODE_STOP_HOOK_BLOCK_CAP、换掉子代理的回报）；
// systemMessage 只进子代理的转录。stop-gate 与 deliverable 共用一段代码，靠这一道结构闸，不靠逐条 notice 前的 CHECK 判断。
test('hookOutput：SubagentStop 与其它事件上 stdout 永远为空，有东西要发就报 BUG', () => {
  for (const event of ['SubagentStop', 'UserPromptSubmit', undefined, 'bogus']) {
    assert.equal(hookOutput(event, { contexts: ['【门禁】甲'], systemMessage: 'x' }).stdout, '')
    assert.match(hookOutput(event, { contexts: ['【门禁】甲'] }).bug, /BUG/)
    assert.equal(hookOutput(event, {}).bug, null)
  }
})

test('runContextFix：每个原因各有一句修法，互不相同', () => {
  const texts = CAUSES.map((c) => runContextFix(c))
  for (const t of texts) assert.ok(typeof t === 'string' && t.length > 10)
  assert.equal(new Set(texts).size, CAUSES.length)
  assert.deepEqual([...CAUSES].sort(), ['plugin', 'pointer', 'project', 'runs', 'state'])
})

test('runContextFix：丢指针给找法与多 run 的规则，不列目录名', () => {
  const t = runContextFix('pointer')
  assert.match(t, /\.agent-team\/runs\/\*\/state\.json/)
  assert.match(t, /只 Glob `runs\/\*` 列不出目录/)
  assert.match(t, /最后建的那一趟/)
  assert.match(t, /问用户/)
  assert.match(t, /\/agent-team:at 第 1 节/)
})

test('runContextFix：project、plugin、runs 三种原因不把 PM 指去修 current-run 或 state.json', () => {
  for (const c of ['project', 'plugin', 'runs']) {
    for (const atStart of [false, true]) {
      const t = runContextFix(c, { atStart })
      assert.doesNotMatch(t, /current-run|state\.json/, `${c}：${t}`)
    }
  }
  assert.match(runContextFix('project'), /project\.json/)
  assert.match(runContextFix('plugin'), /重装或更新 agent-team 插件/)
  assert.match(runContextFix('plugin'), /不要去改插件目录下的文件/)
  assert.doesNotMatch(runContextFix('plugin'), /写回一份合法的/)
})

test('runContextFix：atStart 时按命令分；project 本来就是 at-init 修的，不说「不在这里修」', () => {
  assert.match(runContextFix('pointer', { atStart: true }), /这条命令是 \/agent-team:at 的话：/)
  assert.doesNotMatch(runContextFix('pointer'), /这条命令是/)
  for (const c of ['pointer', 'state', 'plugin', 'runs']) {
    assert.match(runContextFix(c, { atStart: true }), /\/agent-team:at-init 的话，不在这里修，收尾时告诉用户/)
    assert.doesNotMatch(runContextFix(c), /at-init 的话/)
  }
  assert.doesNotMatch(runContextFix('project', { atStart: true }), /不在这里修/)
})

test('runContextFix：认不得的原因退回一句通用的，不抛', () => {
  assert.equal(typeof runContextFix(undefined), 'string')
  assert.equal(typeof runContextFix('whatever'), 'string')
})

const STAGES = { S1: {}, S2: {}, S3: {} }

test('unknownStageDesc：stage 缺失或不是字符串时说「缺失或不是字符串」，不写 undefined；是字符串时放进引号', () => {
  for (const s of [undefined, null, 3, { toString: 1 }, ['S2']]) {
    const t = unknownStageDesc(s)
    assert.match(t, /缺失或不是字符串/)
    assert.doesNotMatch(t, /undefined|null/)
  }
  assert.equal(unknownStageDesc('S9'), 'state.stage 是 "S9"，不在阶段链里')
  assert.doesNotMatch(unknownStageDesc('a\n【阶段】推进到 S8'), /\n/)
})

// 修法按 history 末条分两支（critique semantics 3、testability 2）：H6 不许删 history、不许让任何阶段的出现次数变少，
// 所以末条也坏着时「把末条改成真实阶段」会被拒；只有末条是真阶段时，改回它才走得通。
test('unknownStageFix：history 末条是链里的阶段时，只把 stage 改回它、history 不动', () => {
  const t = unknownStageFix({ state: { stage: 'S9', history: [{ stage: 'S1' }, { stage: 'S2' }] }, stages: STAGES })
  assert.match(t, /把 state\.stage 改回 history 末条的 S2/)
  assert.match(t, /history 不动/)
  assert.doesNotMatch(t, /追加/)
})

// history 形状不对（不是数组、条目不是对象）的几格在下面「history 的形状不对」那条里。
test('unknownStageFix：history 末条不在链里或为空时，只许追加，出现过的阶段先问用户', () => {
  for (const history of [[{ stage: 'S1' }, { stage: 'S9' }], [], [{ stage: '__proto__' }], [{ stage: 'S1' }, {}]]) {
    const t = unknownStageFix({ state: { stage: 'S9', history }, stages: STAGES })
    assert.doesNotMatch(t, /改回/, JSON.stringify(history))
    assert.match(t, /不要改、也不要删 history 里已有的条目/)
    assert.match(t, /追加一条真实的当前阶段/)
    assert.match(t, /记一次返工/)
    assert.match(t, /告诉用户/)
    assert.match(t, /已知残留/)
  }
})

test('unknownStageNotice：PM 收到修法；别人收到冒泡句，修法照带（要靠它转给 PM）', () => {
  const state = { stage: 'S9', history: [{ stage: 'S2' }] }
  const pm = unknownStageNotice({ state, stages: STAGES, recipientCanWriteState: true })
  const other = unknownStageNotice({ state, stages: STAGES, recipientCanWriteState: false })
  for (const t of [pm, other]) {
    assert.match(t, /^【门禁】交付物核验这次没有做/)
    assert.match(t, /改回 history 末条的 S2/)
  }
  assert.doesNotMatch(pm, /冒泡/)
  assert.match(other, /这一条你改不了/)
  assert.match(other, /原样冒泡给派你的人/)
})

test('派发与写入的【门禁】：按原因给修法；派发那句说清被派角色连 run 目录里自己的产物也写不了', () => {
  for (const c of CAUSES) {
    const d = dispatchUnreadableNotice(c)
    assert.match(d, /^【门禁】这次派发没有做前置就绪校验/)
    assert.match(d, /包括 run 目录里它自己的产物/)
    assert.doesNotMatch(d, /run 目录之外/)
    assert.ok(d.includes(runContextFix(c)))
    const l = ledgerUnreadableNotice(c)
    assert.match(l, /^【门禁】这次写入没有回传/)
    assert.match(l, /不要自己算/)
    assert.match(l, /别的文件本来就没有回传/)
    assert.ok(l.includes(runContextFix(c)))
  }
  assert.match(dispatchUnreadableNotice('pointer'), /现在修好，它后面的写入就能过/)
  assert.doesNotMatch(dispatchUnreadableNotice('plugin'), /现在修好/)
})

test('no-run 派发那句：说明是有意的放行，给条件分支，不下「先用……」的祈使句', () => {
  const t = dispatchNoRunNotice()
  assert.match(t, /^【门禁】/)
  assert.match(t, /有意的放行/)
  assert.match(t, /告诉用户可以用 \/agent-team:at 起一趟 run/)
  assert.doesNotMatch(t, /先用/)
})

// systemMessage 只给用户看（不进模型），画在界面上：只许固定文字加插件自己的名字，用 README 的门禁名，
// 不用内部名，不拼任何磁盘值（critique testability 3、behavior 5）。
test('systemMessage：固定文字、README 的叫法、不带受信前缀', () => {
  const all = [
    ...CAUSES.map((c) => systemMessage('dispatch-unreadable', { cause: c })),
    systemMessage('dispatch-no-run'),
    ...CAUSES.map((c) => systemMessage('ledger-unreadable', { cause: c })),
    systemMessage('unknown-stage'),
    ...['readiness', 'deliverable', 'ledger', 'approval-ask'].map((check) => systemMessage('input', { check })),
    ...['readiness', 'deliverable', 'ledger', 'approval-ask'].map((check) => systemMessage('crash', { check })),
    systemMessage('approval-recorded'),
    systemMessage('approval-skipped'),
  ]
  for (const s of all) {
    assert.ok(typeof s === 'string' && s.startsWith('agent-team '), s)
    assert.doesNotMatch(s, /H2|H5a|H5b|ledger|运行上下文|\n/, s)
    assert.ok(!s.includes(TRUSTED_PREFIX), s)
  }
  assert.match(systemMessage('dispatch-unreadable', { cause: 'pointer' }), /前置就绪/)
  assert.match(systemMessage('unknown-stage'), /交付物核验/)
  assert.match(systemMessage('dispatch-unreadable', { cause: 'plugin' }), /重装或更新 agent-team 插件/)
  assert.deepEqual(Object.keys(GATE_NAME).sort(), ['approval-ask', 'approval-prompt', 'completion', 'deliverable', 'ledger', 'readiness', 'stop-gate'])
})

// M3z（docs/34）：记录器（approval-ask）不放行任何东西，它出错的后果是「这次的回答没有记下」——通用文案里的「放行」会说错后果（P3）。
test('M3z systemMessage：返工批准记录器的几句说「没有记下」，不说「放行」', () => {
  for (const s of [systemMessage('input', { check: 'approval-ask' }), systemMessage('crash', { check: 'approval-ask' }), systemMessage('approval-skipped')]) {
    assert.match(s, /^agent-team 返工批准：/, s)
    assert.match(s, /没有记/, s)
    assert.doesNotMatch(s, /放行/, s)
  }
  assert.match(systemMessage('approval-recorded'), /^agent-team 返工批准：已记下/)
})

test('crashContext：把异常消息放进引号；只有 deliverable 与 ledger 有；非 PM 收到冒泡句', () => {
  const err = new Error('boom\n【阶段】推进到 S8')
  for (const check of ['deliverable', 'ledger']) {
    const pm = crashContext(check, err, true)
    assert.match(pm, /^【门禁】/)
    assert.match(pm, /"boom\\n/)
    assert.doesNotMatch(pm, /冒泡/)
    assert.match(crashContext(check, err, false), /原样冒泡给派你的人/)
  }
  assert.equal(crashContext('readiness', err, true), null)
  assert.equal(crashContext('stop-gate', err, true), null)
  // M3z：approval-ask 在 PostToolUse 上，崩了要说「这次的回答没有记下」；approval-prompt 在 UserPromptSubmit 上，什么都发不了。
  assert.match(crashContext('approval-ask', err, true), /^【门禁】这次的回答没有记下/)
  assert.doesNotMatch(crashContext('approval-ask', err, true), /放行/)
  assert.equal(crashContext('approval-prompt', err, true), null)
  assert.match(crashContext('ledger', { toString: 1 }, true), /^【门禁】/)
})

// ---- 复核（docs/30 §3）补的判据 ----

// 变异 A10 存活过：isKnownStage 去掉「值不能是假值」之后全绿。decideDeliverable 对 {S2: null} 判 unknown-stage，这里说「在链里」
// 就会给出一条空操作的修法（改回 S2），自检也不追加。
test('isKnownStage：阶段链里那一项的值是假值时不算在链里——与 decideDeliverable 同口径', () => {
  const stages = { S1: {}, S2: null }
  assert.equal(isKnownStage(stages, 'S2'), false)
  assert.equal(decideDeliverable({ role: 'at-product', stageId: 'S2', stages, artifactExists: () => false }).skipped, 'unknown-stage')
  const a = selfCheckAppendix({ ok: true, state: { stage: 'S2', history: [{ stage: 'S2' }] }, stages })
  assert.match(a, /不在阶段链里/)
  assert.doesNotMatch(unknownStageFix({ state: { stage: 'S2', history: [{ stage: 'S2' }] }, stages }), /改回/)
})

// 复核（wording 第 0 条）：PM 在读不到运行状态时写了别的角色的产物，修好之后 H3 不让它再写——「原样再写一次」对它走不通。
test('ledgerUnreadableNotice：原样重写只说给契约与 PM 自己阶段的产物；别人的产物叫产者重交', () => {
  const t = ledgerUnreadableNotice('pointer')
  assert.match(t, /若这是契约或你自己阶段的产物/)
  assert.match(t, /写的是别的角色的产物的话，修好之后写路径门禁不让你再写它：派它的产者重交一次/)
  // 第二轮增量审查：S5 的执行角色、at-ui 不在 PM 的派发名单上，照字面派会被派发白名单拒。
  assert.match(t, /它不在你的派发名单上的话，经派得到它的那一层转派/)
})

// 复核（wording 第 1 条）：末条是真阶段、更早的条目里有坏阶段时走支 1，照做之后写 state.json 的回传仍报那条坏阶段，
// 而 H6 不许改它。
test('unknownStageFix 支 1：history 里还有别的坏阶段时，补一句那是已知残留', () => {
  const dirty = unknownStageFix({ state: { stage: 'S3x', history: [{ stage: 'S1' }, { stage: 'S2x' }, { stage: 'S3' }] }, stages: STAGES })
  assert.match(dirty, /改回 history 末条的 S3/)
  assert.match(dirty, /已知残留/)
  const clean = unknownStageFix({ state: { stage: 'S3x', history: [{ stage: 'S1' }, { stage: 'S3' }] }, stages: STAGES })
  assert.doesNotMatch(clean, /已知残留/)
})

// 复核（wording 第 2 条）：history 不是由 {stage, at} 对象组成的数组时，H6 的计数不认它——「会拒」「出现过就记返工」都不成立。
test('unknownStageFix：history 的形状不对时不引 H6 的说法，叫 PM 照写 state.json 时的回传改', () => {
  for (const history of [['S1', 'S2', 'S3'], { S1: 't' }, undefined, [{ stage: 'S1' }, 'S2'], [null], [{ stage: 'S1' }, ['S2'], { stage: 'S3' }]]) {
    const t = unknownStageFix({ state: { stage: 'S9', history }, stages: STAGES })
    assert.match(t, /history 的形状也不对/, JSON.stringify(history))
    assert.doesNotMatch(t, /返工预算门禁会拒|记一次返工|改回/, JSON.stringify(history))
    assert.match(t, /返工计数只许增/)
  }
  assert.match(unknownStageFix({ state: { stage: 'S9', history: [] }, stages: STAGES }), /追加一条真实的当前阶段/)
})

// 复核（wording 第 3 条）：命令开头的追加句要分命令——/agent-team:at 要建新 run 时不该先去修一趟即将被替下的旧 run；
// at-resume 里「一趟都没有 state.json」时不该自己补建。
// 第二轮真实会话（docs/30 §3）：通用修法排在前、「/agent-team:at 照建」排在后时，8 次里 3 次先改了旧 run，两次还用新需求
// 覆盖了旧契约；「收尾时告诉用户」0/4 生效。所以 /agent-team:at 那一支排第一、明写不碰旧 run 目录，告诉用户不挂在「收尾」上。
const AT_BRANCH = '这条命令是 /agent-team:at 的话：不要写原来那趟 run 目录下的任何文件，照第 1 节另起一个 run id 建新 run'
const TELL_NOW = '这一轮回复用户时（不论停在哪一步）'
test('命令开头：丢指针、state.json 坏、stage 不在链里——/agent-team:at 那一支排第一，不碰旧 run，这一轮就告诉用户', () => {
  const texts = {
    pointer: runContextFix('pointer', { atStart: true }),
    state: runContextFix('state', { atStart: true }),
    'unknown-stage': selfCheckAppendix({ ok: true, state: { stage: 'S9', history: [{ stage: 'S2' }] }, stages: STAGES }),
  }
  for (const [k, t] of Object.entries(texts)) {
    assert.ok(t.includes(AT_BRANCH), `${k}：${t}`)
    assert.ok(t.includes(TELL_NOW), `${k}：${t}`)
    assert.match(t, /这条命令是 \/agent-team:at-resume 的话：/, k)
    assert.ok(t.indexOf(AT_BRANCH) < t.indexOf('这条命令是 /agent-team:at-resume 的话'), `${k}：/agent-team:at 那一支要排在修法之前`)
    assert.doesNotMatch(t, /收尾时告诉用户旧|旧 run 的问题收尾时/, k)
  }
  for (const c of ['project', 'runs', 'plugin']) assert.ok(!runContextFix(c, { atStart: true }).includes(AT_BRANCH), c)
  const p = texts.pointer
  assert.match(p, /不要自己补 state\.json，也不要删目录/)
  assert.ok(p.indexOf('/agent-team:at-resume 的话') < p.indexOf('用 Glob'), '丢指针的找法属于 at-resume 那一支')
})

// 第二轮真实会话：state.json 从零重建时，PM 用 Bash 自己算 contract_sha（LF 的夹具上碰巧对得上，CRLF 签出的契约上就不对）。
test('runContextFix(state)：认不出来的 contract_sha 写 PENDING，从回传里拿；告诉用户是重建的', () => {
  const t = runContextFix('state')
  assert.match(t, /认不出来的 contract_sha 写 PENDING/)
  assert.match(t, /原样重写一次 00-contract\.md/)
  assert.match(t, /告诉用户/)
  // 第三轮真实会话：at-resume 里 3/3 仍用 Bash 自己算（「认不出来」读成了「算不出来」）；两次还 cd 进 run 目录、把 state.json
  // 写进了嵌套的 .agent-team。
  assert.match(t, /不要用 Bash 自己算/)
})

// 第二轮增量审查：这一轮新加的三处判定此前没有判据，删掉任何一处全套照绿。
test('runContextFix(plugin, atStart)：要建或续 run 的命令在这里停下（at-init 不停）', () => {
  assert.match(runContextFix('plugin', { atStart: true }), /要建或续 run 的命令在这里停下/)
})

// 真实会话（docs/30 §3）：修法只说「当前 run 的 state.json」时，haiku 把它写到了项目根。
test('runContextFix(state)：写明 state.json 在哪', () => {
  assert.ok(runContextFix('state').includes('`.agent-team/runs/<current-run 里的 run id>/state.json`'))
})

test('selfCheckAppendix：no-run、ok 且阶段在链里时不追加', () => {
  assert.equal(selfCheckAppendix({ ok: false, kind: 'no-run' }), '')
  assert.equal(selfCheckAppendix({ ok: true, state: { stage: 'S2' }, stages: STAGES }), '')
  assert.equal(selfCheckAppendix(undefined), '')
})

test('selfCheckAppendix：unreadable 按原因给修法（命令开头的口径）；stage 不在链里给 unknown-stage 的修法', () => {
  const a = selfCheckAppendix({ ok: false, kind: 'unreadable', cause: 'pointer' })
  assert.match(a, /^另外，/)
  assert.ok(a.includes(runContextFix('pointer', { atStart: true })))
  const b = selfCheckAppendix({ ok: true, state: { stage: 'S9', history: [{ stage: 'S2' }] }, stages: STAGES })
  assert.match(b, /^另外，/)
  assert.match(b, /不在阶段链里/)
  assert.match(b, /改回 history 末条的 S2/)
  const c = selfCheckAppendix({ ok: false, kind: 'unreadable', cause: 'plugin' })
  assert.match(c, /重装/)
  assert.doesNotMatch(c, /写回一份合法的/)
})

// M4a（docs/35）：修坏的 state.json 时，收口标记照原样保留——丢了它就是悄悄重开一趟已经交付的 run（不留痕）。写回之后
// H6 的收口判据会对写入后的那一份重核一遍（写入前读不出来也核）。
test('M4a 修法（state）：照原样保留的清单里有 closed_at', () => {
  assert.match(runContextFix('state'), /history、rework、artifacts、rework_base、closed_at 照原样保留/)
})
