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
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, decisionOf, hermeticEnv } from './helpers/gate-runner.mjs'
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

test('boot.mjs 的静态 import 只有 node: 内建模块——插件自己的文件一律动态 import', () => {
  const text = readFileSync(new URL('../hooks/boot.mjs', import.meta.url), 'utf8')
  const statics = [...text.matchAll(/^\s*import\s[^('"]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  const bare = [...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  assert.ok(statics.length > 0, '一条静态 import 都没抠出来——先看正则，别让这条判据空转')
  for (const spec of [...statics, ...bare]) {
    assert.ok(spec.startsWith('node:'), `boot.mjs 静态 import 了 ${spec}；它坏掉时 boot.mjs 自己也加载不起来`)
  }
})
