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
