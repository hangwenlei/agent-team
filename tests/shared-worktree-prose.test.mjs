// 全量审查第 39 条剩下的那一半「并行的执行角色共用一棵工作树」（docs/51 §1.2，M4p）：裁定门禁不强制串行——「还在跑」只能按派发记录与停下行认，
// 中断、被平台放过的子代理永远没有停下行，门禁会一直拒；共用工作树的冲突大半经 Bash（lockfile、node_modules、构建、端口），门禁看不见。
// 承重的是架构师正文那一句串行规矩：只改各自地盘的可以并发派，要改同一份文件的派一个、等它返回、读过实现记录再派下一个。原来没有判据钉它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const squash = (s) => s.replace(/\s+/g, '')

test('第 39 条：架构师正文的串行规矩——各自地盘的并发派，要改同一份文件的派一个、等它返回、读过实现记录再派下一个', () => {
  const arch = squash(readFileSync(join(ROOT, 'agents', 'at-architect.md'), 'utf8'))
  for (const k of [
    '只改各自地盘的几个执行角色，可以在一条消息里并发派；',
    '两个执行角色要改同一份文件（根级清单，例如 `package.json`，或者共列目录里的同一份文件）时，派一个、等它返回、读过它的实现记录再派下一个，不要放到后台。',
  ]) {
    assert.ok(arch.includes(squash(k)), `agents/at-architect.md 缺「${k}」`)
  }
})

test('第 39 条（复核 docs/51 §8）：/agent-team:at 里给项目经理看的那一份串行规矩', () => {
  const at = squash(readFileSync(join(ROOT, 'commands', 'at.md'), 'utf8'))
  const k = '架构师可以在一条消息里并发派多个执行角色（几个都要改同一份文件的除外：派一个、等它返回再派下一个）。'
  assert.ok(at.includes(squash(k)), `commands/at.md 缺「${k}」`)
})
