// hooks/hooks.json 里的检查名（"delegation"）与 hooks/gate.mjs 里 CHECK === 'delegation'
// 的判断是同一个字面量的两处硬编码，此前没有任何测试对账过。两者一旦漂移
// （改名漏改一处、手滑打错字），gate.mjs 对未知检查名会零输出、exit 0——
// 这与插件改名导致 plugin-name-sync 测试崩红是同一类失效，但方向更糟：
// 那边吵闹（一律拒绝，立刻发现），这边安静（一律放行，永远发现不了）。
// 这份测试就是守住 hooks.json 与 gate.mjs 之间的这条隐性契约。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { KNOWN_CHECKS } from '../hooks/lib/checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const hooksConfig = JSON.parse(
  readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'),
)

function findAgentEntry() {
  return hooksConfig.hooks?.PreToolUse?.find((e) => e.matcher === '^Agent$')
}

test('PreToolUse 钩子数组存在且非空', () => {
  assert.ok(Array.isArray(hooksConfig.hooks?.PreToolUse), 'hooks.json 缺少 PreToolUse 数组')
  assert.ok(hooksConfig.hooks.PreToolUse.length > 0, 'PreToolUse 数组是空的')
})

test('存在一项 matcher 精确锚定为 "^Agent$"', () => {
  assert.ok(
    findAgentEntry(),
    'hooks.json 的 PreToolUse matcher 必须是锚定的 "^Agent$"；未锚定的 "Agent" ' +
      '会误配将来任何名字里含 Agent 的工具，而那种调用没有 subagent_type，' +
      '会被「未指定 subagent_type」那条拒掉——fail closed 在错误的地方，理由也文不对题',
  )
})

test('该项的 hook 是 exec 形式：command 为 node，且带 args 数组', () => {
  const entry = findAgentEntry()
  assert.ok(entry, 'hooks.json 里找不到 matcher 精确为 "^Agent$" 的注册项（见上一条测试）')
  const hook = entry.hooks[0]
  assert.equal(hook.type, 'command')
  assert.equal(hook.command, 'node')
  assert.ok(Array.isArray(hook.args), 'hook.args 不是数组')
})

test('args[0] 把 ${CLAUDE_PLUGIN_ROOT} 替换成仓库根之后指向真实存在的文件', () => {
  const entry = findAgentEntry()
  assert.ok(entry, 'hooks.json 里找不到 matcher 精确为 "^Agent$" 的注册项（见上一条测试）')
  const hook = entry.hooks[0]
  const resolved = hook.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)
  assert.ok(
    existsSync(resolved),
    `${resolved} 不存在——hooks.json 里写的路径与仓库里的实际文件已经漂移`,
  )
})

test('args[1] 是 gate.mjs 的 KNOWN_CHECKS 认得的检查名', () => {
  const entry = findAgentEntry()
  assert.ok(entry, 'hooks.json 里找不到 matcher 精确为 "^Agent$" 的注册项（见上一条测试）')
  const hook = entry.hooks[0]
  assert.ok(
    KNOWN_CHECKS.has(hook.args[1]),
    `hooks.json 注册的检查名 ${JSON.stringify(hook.args[1])} 不在 gate.mjs 的 ` +
      `KNOWN_CHECKS 里——两处已经漂移，gate.mjs 会对这个检查项一律 deny` +
      `（未知检查名现在 fail closed，但注册漂移本身仍是需要修的配置错误）`,
  )
})

// 上面几条只校验「存在一项 matcher 精确为 ^Agent$」，从不检查 hooks.json 里
// 其它注册项——往数组里再塞一条伪造条目（哪怕 command 是 bash、args 指向
// 不存在的文件），其它既有测试照样全绿。这条不变量对*每一个*注册项都成立，
// 但刻意不要求「每一项 matcher 都必须是 ^Agent$」：writepath（H3）、contract
// （H4）迟早会注册在 Edit|Write|NotebookEdit 这组 matcher 上——那样写的话
// 这条测试必错。writepath 本来在 Task 1 就注册，评审时撤回并挪到了 Task 4
// （判定逻辑落地的那一步）：判定逻辑不在就注册，等于提前打开一条「读不到
// stdin 就拒绝真实 Edit/Write」的 fail-closed 路径。
function allHookCommands() {
  const groups = Object.values(hooksConfig.hooks ?? {}).flat()
  return groups.flatMap((group) => group.hooks ?? [])
}

test('hooks.json 里的每一个注册项都是零依赖 node 调用、参数完整、指向真实文件与已知检查名', () => {
  const commands = allHookCommands()
  assert.ok(commands.length > 0, 'hooks.json 里一个 hook 命令都没有')
  for (const hook of commands) {
    const label = JSON.stringify(hook)
    assert.equal(hook.type, 'command', `${label} 的 type 不是 "command"`)
    assert.equal(
      hook.command,
      'node',
      `${label} 的 command 不是 "node"——本插件是零依赖插件，所有 hook 必须走 node`,
    )
    assert.ok(
      Array.isArray(hook.args) && hook.args.length > 0,
      `${label} 缺少非空的 args 数组`,
    )
    const resolved = hook.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)
    assert.ok(
      existsSync(resolved),
      `${label} 的 args[0]（解析后为 ${resolved}）不存在——与仓库里的实际文件已经漂移`,
    )
    assert.ok(
      KNOWN_CHECKS.has(hook.args[1]),
      `${label} 的 args[1]（检查名 ${JSON.stringify(hook.args[1])}）不在 gate.mjs 的 KNOWN_CHECKS 里`,
    )
  }
})
