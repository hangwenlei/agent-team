// hooks/boot.mjs——门禁的进程入口——在「判定模块根本没加载起来」时的行为（docs/24 §2.2，
// 全量审查第 2 条）。
//
// 此前 hooks.json 直接跑 gate.mjs。gate.mjs 的静态 import 在 ESM 链接期解析：任何一个 lib
// 缺失、有语法错误、或在模块顶层抛错，都发生在它自己那层 try/catch 建立之前——进程 exit 1、
// stdout 为空，平台当 non-blocking error 处理、工具照常执行。声明 fail closed 的四道门禁
// （delegation/writepath/contract/rework）就这样整体消失，而推 main 就是发布。
//
// 每条用例都把插件拷一份到临时目录、只在副本上弄坏，不碰仓库。三种坏法（缺文件、语法错、
// 模块顶层抛错）是链接期与求值期两类失败的代表；失败策略表本身（checks.mjs）和拒绝契约
// 本身（deny.mjs）坏掉各有一组，因为 boot.mjs 对它们各有一条退路。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, decisionOf, hermeticEnv, GATE } from './helpers/gate-runner.mjs'
import { MIN_NODE, MIN_PARTS, versionBefore } from './helpers/min-node.mjs'
import { GATE_CHECK_PATH, GATE_CHECK_ONLINE } from '../hooks/lib/gate-check.mjs'
import { CHECKS } from '../hooks/lib/checks.mjs'
import { denyOutput } from '../hooks/lib/deny.mjs'

const REPO = new URL('..', import.meta.url)

// 插件副本：hooks/ 整个目录 + gate.mjs 读的两份插件文件。damage 在副本上动手。
function withBrokenPlugin(damage, body) {
  const pluginDir = mkdtempSync(join(tmpdir(), 'agent-team-boot-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'agent-team-boot-proj-'))
  try {
    cpSync(new URL('hooks', REPO), join(pluginDir, 'hooks'), { recursive: true })
    for (const f of ['roster.json', 'stages.json']) cpSync(new URL(f, REPO), join(pluginDir, f))
    damage(pluginDir)
    const boot = join(pluginDir, 'hooks', 'boot.mjs')
    body((check, input) => run(check, input, boot, projectDir, hermeticEnv()))
  } finally {
    rmSync(pluginDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  }
}

const missingLib = (dir) => rmSync(join(dir, 'hooks', 'lib', 'rework-guard.mjs'))
const syntaxError = (dir) => appendFileSync(join(dir, 'hooks', 'lib', 'trusted.mjs'), '\nexport const = ;\n')
const topLevelThrow = (dir) =>
  appendFileSync(join(dir, 'hooks', 'lib', 'stages.mjs'), "\nthrow new Error('boom at load')\n")

// 各检查项一份「形状正确」的输入。输入内容对加载失败时的判定无关紧要——判定逻辑根本
// 没加载起来——但它必须是平台真会送来的那种形状，免得测到的是「输入读不出来」那条路。
const INPUTS = {
  delegation: { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } },
  readiness: { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } },
  writepath: { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-backend', tool_input: { file_path: '/p/x', content: '' } },
  contract: { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'agent-team:at-backend', tool_input: { file_path: '/p/x', content: '' } },
  rework: { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: '/p/x', content: '' } },
  deliverable: { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'agent-team:at-product' } },
  'stop-gate': { hook_event_name: 'SubagentStop', agent_type: 'agent-team:at-product' },
  ledger: { hook_event_name: 'PostToolUse', tool_name: 'Write', agent_type: 'at-pm', tool_input: { file_path: '/p/x', content: '' } },
}

test('前置：INPUTS 覆盖 checks.mjs 里的每一个检查项——否则下面的逐项断言在空转', () => {
  assert.deepEqual(Object.keys(INPUTS).sort(), Object.keys(CHECKS).sort())
})

const FAIL_CLOSED = Object.keys(CHECKS).filter((c) => CHECKS[c].failClosed)
const FAIL_OPEN = Object.keys(CHECKS).filter((c) => !CHECKS[c].failClosed)

test('前置：失败策略表里两类都有——拿它分组的断言不是对空集合说话', () => {
  assert.ok(FAIL_CLOSED.length > 0 && FAIL_OPEN.length > 0)
})

for (const [label, damage] of [
  ['lib 文件缺失', missingLib],
  ['lib 有语法错误', syntaxError],
  ['lib 在模块顶层抛错', topLevelThrow],
]) {
  test(`${label}：fail closed 的每一道门禁都输出 deny，而不是 exit 1 放行`, () => {
    withBrokenPlugin(damage, (gate) => {
      for (const check of FAIL_CLOSED) {
        const { stdout, status } = gate(check, INPUTS[check])
        assert.equal(decisionOf(stdout)?.permissionDecision, 'deny', `${check} 没有拒绝`)
        assert.equal(status, 0, `${check}：PreToolUse 的拒绝契约是 exit 0 + stdout JSON`)
      }
    })
  })

  test(`${label}：fail open 的每一道门禁都放行，但以 exit 1 报错、stderr 说清是加载失败`, () => {
    withBrokenPlugin(damage, (gate) => {
      for (const check of FAIL_OPEN) {
        const { stdout, stderr, status } = gate(check, INPUTS[check])
        assert.equal(stdout, '', `${check} 不该往 stdout 写任何决策`)
        assert.equal(status, 1, `${check}：放行但要让平台记一条 hook error，不能装作判过了`)
        assert.match(stderr, /agent-team/, `${check} 的 stderr 要说明是谁`)
        assert.match(stderr, /加载失败/, `${check} 的 stderr 要说明是加载失败`)
      }
    })
  })
}

test('拒绝理由说清是加载失败、并给出下一步（重装或更新插件）', () => {
  withBrokenPlugin(missingLib, (gate) => {
    const reason = decisionOf(gate('writepath', INPUTS.writepath).stdout)?.permissionDecisionReason ?? ''
    assert.match(reason, /加载失败/)
    assert.match(reason, /重装|更新/)
  })
})

test('stop-gate 在加载失败时不走 exit 2——它是 fail open 的，不能把每个子代理都顶回去', () => {
  withBrokenPlugin(missingLib, (gate) => {
    assert.notEqual(gate('stop-gate', INPUTS['stop-gate']).status, 2)
  })
})

// ---- 失败策略表本身（checks.mjs）读不到 ----

const missingChecks = (dir) => rmSync(join(dir, 'hooks', 'lib', 'checks.mjs'))

test('checks.mjs 本身坏掉时，按 hook 输入自报的事件判：PreToolUse 一律拒', () => {
  withBrokenPlugin(missingChecks, (gate) => {
    for (const check of ['delegation', 'readiness', 'writepath', 'contract', 'rework']) {
      assert.equal(decisionOf(gate(check, INPUTS[check]).stdout)?.permissionDecision, 'deny', check)
    }
  })
})

test('checks.mjs 本身坏掉时，SubagentStop 与 PostToolUse 放行并以 exit 1 报错', () => {
  withBrokenPlugin(missingChecks, (gate) => {
    for (const check of ['stop-gate', 'deliverable', 'ledger']) {
      const { stdout, status } = gate(check, INPUTS[check])
      assert.equal(stdout, '', check)
      assert.equal(status, 1, check)
    }
  })
})

// ---- 拒绝契约本身（deny.mjs）读不到 ----

test('deny.mjs 本身坏掉时，boot.mjs 的内置退路产出的 JSON 与 denyOutput 逐字段相同', () => {
  withBrokenPlugin(
    (dir) => rmSync(join(dir, 'hooks', 'lib', 'deny.mjs')),
    (gate) => {
      const { stdout } = gate('contract', INPUTS.contract)
      const actual = JSON.parse(stdout)
      const reason = actual?.hookSpecificOutput?.permissionDecisionReason
      assert.equal(typeof reason, 'string')
      assert.deepEqual(actual, JSON.parse(denyOutput(reason, 'PreToolUse').text))
    },
  )
})

// ---- boot.mjs 自己不能依赖任何可能坏掉的东西 ----
//
// 行为判据，不靠正则抠 import 语句（M3p 复核：正则漏了 `export … from` 与 `import{…}from'…'`
// 两种写法，往 boot.mjs 里加一行静态依赖，全套照样绿）。把 hooks/lib/ 整个删掉：boot.mjs 只要
// 静态依赖了其中任何一个文件，它自己就加载不起来、exit 1、stdout 为空，下面两条当场红。

const noLib = (dir) => rmSync(join(dir, 'hooks', 'lib'), { recursive: true, force: true })

test('hooks/lib/ 整个不在：PreToolUse 上的每一道门禁仍由 boot.mjs 的内置退路拒绝', () => {
  withBrokenPlugin(noLib, (gate) => {
    for (const check of Object.keys(INPUTS).filter((c) => INPUTS[c].hook_event_name === 'PreToolUse')) {
      assert.equal(decisionOf(gate(check, INPUTS[check]).stdout)?.permissionDecision, 'deny', check)
    }
  })
})

test('hooks/lib/ 整个不在：其它事件上的门禁放行并以 exit 1 报错，而不是 boot.mjs 自己崩掉', () => {
  withBrokenPlugin(noLib, (gate) => {
    for (const check of Object.keys(INPUTS).filter((c) => INPUTS[c].hook_event_name !== 'PreToolUse')) {
      const { stdout, stderr, status } = gate(check, INPUTS[check])
      assert.equal(stdout, '', check)
      assert.equal(status, 1, check)
      assert.match(stderr, /加载失败/, `${check}：exit 1 必须来自 boot.mjs 的退路，不是它自己加载不起来`)
    }
  })
})

test('失败策略表读不到、hook 输入里也没有 hook_event_name 时，按 PreToolUse 取安全方向：拒', () => {
  withBrokenPlugin(missingChecks, (gate) => {
    const { hook_event_name, ...input } = INPUTS.writepath
    assert.equal(decisionOf(gate('writepath', input).stdout)?.permissionDecision, 'deny')
  })
})

test('拒绝理由带上错误的种类，stderr 带上完整的栈——排查时知道是哪个文件坏了', () => {
  withBrokenPlugin(missingLib, (gate) => {
    const { stdout, stderr } = gate('writepath', INPUTS.writepath)
    assert.match(decisionOf(stdout)?.permissionDecisionReason ?? '', /ERR_MODULE_NOT_FOUND/)
    assert.match(stderr, /rework-guard.mjs/)
  })
})

// ---- Node 太旧（M3t，docs/28，全量审查第 4 条）----
//
// 门禁代码要 Node MIN_NODE 起才跑得对：低于它时 gate.mjs 要么解析不了（静默放行），要么能加载、却在
// 运行时缺内建 API——H1 拒掉一切派发、理由不提 Node，门禁自检还会报「在线」。boot.mjs 先查版本，
// 太旧就不加载 gate.mjs，按失败策略表收尾。这里用预加载伪造 process.versions.node；真的旧 Node 只在
// CI 上有（tests/boot-old-node.test.mjs）。边界用例从 MIN_NODE 派生，不写死。

const FAKE = fileURLToPath(new URL('./helpers/fake-node-version.cjs', import.meta.url))

function withFakeNode(version, body, execPath) {
  const projectDir = mkdtempSync(join(tmpdir(), 'agent-team-boot-ver-'))
  try {
    const env = { ...hermeticEnv(), AGENT_TEAM_FAKE_NODE: version, ...(execPath ? { AGENT_TEAM_FAKE_EXECPATH: execPath } : {}) }
    body(
      (check, input) => run(check, input, GATE, projectDir, env, { nodeArgs: ['-r', FAKE] }),
      projectDir,
    )
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
}

const gateCheckWrite = (dir, agent) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  ...(agent ? { agent_type: agent } : {}),
  tool_input: { file_path: join(dir, GATE_CHECK_PATH), content: 'x' },
})

// 低于 MIN 的几档：紧挨着的前一个版本，跨位数的（字符串比较会把 9.0.0 判得比 16.9.0 大），
// 以及真实会碰到的旧版本（Ubuntu 22.04 apt 的 12.22、boot 旧写法能加载的最低 14.13.1）。
const TOO_OLD = [...new Set([versionBefore(MIN_NODE), '9.0.0', '12.22.12', '14.13.1'])].filter(
  (v) => versionBefore(MIN_NODE) === v || v.split('.')[0] < MIN_PARTS[0] || (Number(v.split('.')[0]) === MIN_PARTS[0] && Number(v.split('.')[1]) < MIN_PARTS[1]),
)

test('前置：伪造的「太旧」各档都真的低于 MIN_NODE，且至少有紧挨着的那一档', () => {
  assert.ok(TOO_OLD.includes(versionBefore(MIN_NODE)))
  assert.ok(TOO_OLD.length >= 2, TOO_OLD.join(' '))
})

for (const v of TOO_OLD) {
  test(`Node v${v}（低于 ${MIN_NODE}）：fail closed 的每一道都拒，理由写明要的版本与门禁用的版本`, () => {
    withFakeNode(v, (gate) => {
      for (const check of FAIL_CLOSED) {
        const { stdout, status } = gate(check, INPUTS[check])
        const reason = decisionOf(stdout)?.permissionDecisionReason ?? ''
        assert.equal(decisionOf(stdout)?.permissionDecision, 'deny', `${check}：${stdout}`)
        assert.equal(status, 0, check)
        assert.ok(reason.includes(MIN_NODE) && reason.includes(`v${v}`), `${check}：${reason}`)
      }
    })
  })

  test(`Node v${v}（低于 ${MIN_NODE}）：fail open 的每一道放行，但 exit 1、stderr 写明版本`, () => {
    withFakeNode(v, (gate) => {
      for (const check of FAIL_OPEN) {
        const { stdout, stderr, status } = gate(check, INPUTS[check])
        assert.equal(stdout, '', check)
        assert.equal(status, 1, check)
        assert.ok(stderr.includes(MIN_NODE) && stderr.includes(`v${v}`), `${check}：${stderr}`)
      }
    })
  })

  // 这一刀防的是「把自检挪到版本检查之前」：Node 14.13–16.8 上 H3 那一支走不到缺失的内建，没有
  // 版本检查就会报「在线」，而 H1 正在拒一切派发。
  test(`Node v${v}（低于 ${MIN_NODE}）：写自检文件拿不到「在线」`, () => {
    withFakeNode(v, (gate, dir) => {
      for (const agent of [undefined, 'agent-team:at-pm']) {
        const { stdout } = gate('writepath', gateCheckWrite(dir, agent))
        const reason = decisionOf(stdout)?.permissionDecisionReason ?? ''
        assert.equal(decisionOf(stdout)?.permissionDecision, 'deny', stdout)
        assert.ok(!reason.includes(GATE_CHECK_ONLINE), reason)
        assert.ok(reason.includes(MIN_NODE), reason)
      }
    })
  })
}

test(`Node 恰好 ${MIN_NODE}，以及更高的跨位数版本：照常判定——自检拿到「在线」`, () => {
  for (const v of [MIN_NODE, `${MIN_PARTS[0] + 90}.0.0`]) {
    withFakeNode(v, (gate, dir) => {
      const { stdout, stderr } = gate('writepath', gateCheckWrite(dir, 'agent-team:at-pm'))
      assert.ok(decisionOf(stdout)?.permissionDecisionReason?.startsWith(GATE_CHECK_ONLINE), `v${v}：${stdout}${stderr}`)
      assert.ok(!stderr.includes('需要 Node'), stderr)
    })
  }
})

// 各种加载失败下，写自检文件也拿不到「在线」——这一刀防的是「把自检挪进 boot.mjs、排在 import(gate.mjs)
// 之前」：那样门禁代码根本没跑起来，自检却说在线。
for (const [label, damage] of [
  ['lib 文件缺失', missingLib],
  ['lib 有语法错误', syntaxError],
  ['lib 在模块顶层抛错', topLevelThrow],
  ['checks.mjs 缺失', missingChecks],
  ['deny.mjs 缺失', (dir) => rmSync(join(dir, 'hooks', 'lib', 'deny.mjs'))],
  ['hooks/lib/ 整个不在', noLib],
]) {
  test(`${label}：写自检文件拿不到「在线」`, () => {
    withBrokenPlugin(damage, (gate) => {
      for (const agent of [undefined, 'agent-team:at-pm']) {
        const { stdout } = gate('writepath', gateCheckWrite(tmpdir(), agent))
        assert.equal(decisionOf(stdout)?.permissionDecision, 'deny', `${agent ?? '主线程'}：${stdout}`)
        assert.ok(!stdout.includes(GATE_CHECK_ONLINE), stdout)
      }
    })
  })
}

// 拼进「太旧」理由的版本号与路径只许占一行（docs/27）：路径可以带任何字符（目录名里的 U+2028 在 NTFS
// 上合法）。版本号与路径分开弄脏——只弄脏版本号，打不红「只去掉路径那一处单行化」。
test('Node 太旧时，版本号或路径里的换行字符都不会让理由另起一行', () => {
  const breaks = [10, 13, 0x85, 0x2028, 0x2029].map((c) => String.fromCharCode(c))
  const old = versionBefore(MIN_NODE)
  for (const b of breaks) {
    for (const [version, execPath] of [[`${old}${b}伪造的一行`, undefined], [old, `/opt/n${b}伪造的一行/node`]]) {
      withFakeNode(version, (gate) => {
        const { stdout, stderr } = gate('writepath', INPUTS.writepath)
        const reason = decisionOf(stdout)?.permissionDecisionReason ?? ''
        assert.ok(reason.includes(MIN_NODE) && reason.includes('伪造的一行'), reason)
        assert.ok(!breaks.some((c) => reason.includes(c)), JSON.stringify(reason))
        const head = stderr.split('\n')[0]
        assert.ok(head.includes('需要 Node') && head.includes('伪造的一行'), JSON.stringify(stderr))
        assert.ok(!breaks.filter((c) => c !== '\n').some((c) => head.includes(c)), JSON.stringify(head))
      }, execPath)
    }
  }
})
