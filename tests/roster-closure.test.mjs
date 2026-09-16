import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const roster = JSON.parse(
  readFileSync(new URL('../roster.json', import.meta.url), 'utf8'),
)

const stages = JSON.parse(
  readFileSync(new URL('../stages.json', import.meta.url), 'utf8'),
)

test('每个条目都有 can_delegate_to 数组', () => {
  for (const [caller, entry] of Object.entries(roster)) {
    assert.ok(
      Array.isArray(entry.can_delegate_to),
      `${caller} 的 can_delegate_to 不是数组`,
    )
  }
})

test('can_delegate_to 里出现的每个名字本身也是花名册的键', () => {
  for (const [caller, entry] of Object.entries(roster)) {
    for (const target of entry.can_delegate_to) {
      assert.ok(
        Object.hasOwn(roster, target),
        `${caller} 可派发 ${target}，但 ${target} 不在花名册里——` +
          `受管辖角色能派出不受管辖的 agent，级联逃逸链条就此打开`,
      )
    }
  }
})

// stages.json 是第二个引用角色名的文件（第一个是 roster.json 自己），引入时
// 没有被这张网罩住——它第一天就把 S5 的 role 写成了 roster.json 里根本不
// 存在的 at-backend，直到有真实派发撞上 H1 才会被发现（Task 2 评审 I1）。
// 把「stages.json 引用的角色都在 roster.json 花名册里」也变成跟上面两条
// 一样的闭包不变量，防止同类角色名漂移再来一次。
test('stages.json 里每个阶段的 role 都必须是 roster.json 的键', () => {
  for (const [stageId, entry] of Object.entries(stages)) {
    assert.ok(
      Object.hasOwn(roster, entry.role),
      `${stageId} 声明执行角色 ${entry.role}，但 ${entry.role} 不在 roster.json 里——` +
        `H1 派发门禁会拒掉任何派向它的派发，这个阶段永远跑不到`,
    )
  }
})
