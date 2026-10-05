import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTROL_FILES, isControlFile } from '../hooks/lib/control-files.mjs'

const AT = '/proj/.agent-team'

test('四个控制文件都认得出来', () => {
  assert.equal(isControlFile('/proj/.agent-team/current-run', AT), true)
  assert.equal(isControlFile('/proj/.agent-team/project.json', AT), true)
  assert.equal(isControlFile('/proj/.agent-team/reach.json', AT), true)
  assert.equal(isControlFile('/proj/.agent-team/runs/r1/state.json', AT), true)
})

test('任意 run 的 state.json 都算控制文件，不只是当前那个', () => {
  assert.equal(isControlFile('/proj/.agent-team/runs/other-run/state.json', AT), true)
})

test('阶段产物不是控制文件', () => {
  assert.equal(isControlFile('/proj/.agent-team/runs/r1/00-contract.md', AT), false)
  assert.equal(isControlFile('/proj/.agent-team/runs/r1/05-impl/at-backend.md', AT), false)
})

test('* 不跨路径段——多一层或少一层都不匹配', () => {
  assert.equal(isControlFile('/proj/.agent-team/runs/state.json', AT), false)
  assert.equal(isControlFile('/proj/.agent-team/runs/r1/x/state.json', AT), false)
})

test('.agent-team 之外的同名文件不是控制文件', () => {
  assert.equal(isControlFile('/proj/src/project.json', AT), false)
  assert.equal(isControlFile('/proj/.agent-team-backup/project.json', AT), false)
})

test('.agent-team 目录本身不是控制文件', () => {
  assert.equal(isControlFile(AT, AT), false)
})

test('路径穿越绕不过去——norm 会先 resolve', () => {
  assert.equal(isControlFile('/proj/.agent-team/runs/r1/../../project.json', AT), true)
  assert.equal(isControlFile('/proj/.agent-team/../outside.json', AT), false)
})

test('退化输入一律返回 false，不抛', () => {
  assert.equal(isControlFile(undefined, AT), false)
  assert.equal(isControlFile('', AT), false)
  assert.equal(isControlFile('/proj/.agent-team/project.json', undefined), false)
  assert.equal(isControlFile('/proj/.agent-team/project.json', ''), false)
})

// docs/09 账一：控制文件之所以比「例外」准，靠的是它是一个闭集合且可枚举。
// 这条测试钉住「可枚举」这半边：清单变长了，实现者必须回来看一眼 templates/
// 与四条命令正文是否需要同步，以及规格 §6.2.1 的措辞。
test('控制文件清单是闭集合，改了要回头同步规格 §6.2.1 与命令正文', () => {
  assert.deepEqual([...CONTROL_FILES].sort(), [
    'current-run',
    'project.json',
    'reach.json',
    'runs/*/state.json',
  ])
})

// ============================================================================
// M3z（docs/34，全量审查第 16 条）：门禁专属文件——门禁自己写、任何人（含 PM 与主线程）的 Edit/Write/NotebookEdit 都拒。
// approvals.jsonl 是返工批准记录，PM 写得进它就能给自己批第 4 轮；delivered.json 是交付快照，改得了它就能让重做的判据失效。
import { GATE_FILES, leafName, mayBeGateFile, isGateFile, mayBeStateFile } from '../hooks/lib/control-files.mjs'

test('M3z 门禁专属文件清单是闭集合', () => {
  assert.deepEqual([...GATE_FILES].sort(), ['runs/*/approvals.jsonl', 'runs/*/delivered.json', 'runs/*/dispatches.jsonl'])
})

test('M3z isGateFile：任意项目、任意 run 下的 approvals.jsonl、delivered.json；它们不是控制文件（PM 也写不了）', () => {
  for (const p of ['/proj/.agent-team/runs/r1/approvals.jsonl', '/proj/.agent-team/runs/other/delivered.json', '/elsewhere/.agent-team/runs/r9/APPROVALS.JSONL']) {
    assert.equal(isGateFile(p), true, p)
    assert.equal(isControlFile(p, AT), false, p)
  }
})

test('M3z isGateFile：多一层、少一层、.agent-team 之外、退化输入都不算', () => {
  for (const p of ['/proj/.agent-team/approvals.jsonl', '/proj/.agent-team/runs/r1/x/delivered.json', '/proj/src/delivered.json', '/proj/runs/r1/delivered.json', '', undefined]) {
    assert.equal(isGateFile(p), false, String(p))
  }
  assert.equal(isGateFile('/proj/.agent-team/runs/r1/../r2/approvals.jsonl'), true)
  assert.equal(isGateFile('/proj/.agent-team/runs/r1/approvals.jsonl/../x'), false)
})

test('M3z leafName：剥流后缀、结尾的点与空格，转小写', () => {
  assert.equal(leafName('C:\\p\\.agent-team\\runs\\r1\\APPROVALS.JSONL::$DATA'), 'approvals.jsonl')
  assert.equal(leafName('/p/runs/r1/delivered.json. '), 'delivered.json')
  assert.equal(leafName('/p/runs/r1/state.json:x'), 'state.json')
  assert.equal(leafName(''), '')
})

test('M3z mayBeGateFile：按规范化之后的末段认，写法认不出时也认；别的名字、8.3 短名不认', () => {
  for (const p of ['C:\\p\\.agent-team\\runs\\r1\\approvals.jsonl::$DATA', '/p/runs/r1/APPROVALS.JSONL.', '/p/delivered.json']) {
    assert.equal(mayBeGateFile(p), true, p)
  }
  for (const p of ['/p/runs/r1/state.json', '/p/runs/r1/approvals.jsonl.bak', '/p/runs/r1/APPROV~1.JSO', '', null]) {
    assert.equal(mayBeGateFile(p), false, String(p))
  }
})

test('M3z mayBeStateFile 与 mayBeGateFile 共用一份末段规范化（行为不变）', () => {
  assert.equal(mayBeStateFile('C:\\p\\runs\\r1\\STATE.JSON::$DATA'), true)
  assert.equal(mayBeStateFile('/p/runs/r1/STATE~1.JSO'), true)
  assert.equal(mayBeStateFile('/p/runs/r1/approvals.jsonl'), false)
})

// 变异 C07：isGateFile 的末段不过 leafName 时，Windows 上照样全绿（norm 折小写）；流后缀那一种两个平台都靠它。
test('变异 C07：isGateFile 认带流后缀、结尾带点的末段', () => {
  assert.equal(isGateFile('/proj/.agent-team/runs/r1/approvals.jsonl::$DATA'), true)
  assert.equal(isGateFile('/proj/.agent-team/runs/r1/delivered.json:x'), true)
})
