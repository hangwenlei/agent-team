import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const roster = JSON.parse(
  readFileSync(new URL('../roster.json', import.meta.url), 'utf8'),
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
