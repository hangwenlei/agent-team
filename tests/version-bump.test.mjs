// 发布纪律的机械判据（M3p，docs/24 §2.3）：推 main 就是发布，每次都要挪 version——
// 碰插件会加载的东西挪中间一位，只碰散文/文档/测试挪最后一位，任何一位不长到 10。
//
// docs/19 §9.2 当年裁定「只立纪律、不配判据」，理由是发布在这个仓库里没有机械表征：
// 放在 node --test 里的判据会在每一个开发中 commit 上红，红了等于没红。它同时写下了改判
// 条件——「出现 .github/workflows/，也就是有东西在 push 到 main 这个时刻真的跑一次」。
// 这一轮加了 CI，所以这条判据只在 CI 的「推 main / 向 main 提 PR」两个事件上跑
// （scripts/check-version-bump.mjs），比的是事件前后两个提交，不是树里的字。
// 这里只测纯函数：给定前后版本号与改动文件清单，判得对不对。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeVersionBump, PLUGIN_LOADED } from '../scripts/lib/version-bump.mjs'

const ok = (args) => judgeVersionBump(args).ok

test('只改文档、挪了最后一位 → 通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.8', changed: ['docs/x.md', 'README.md'] }), true)
})

test('只改文档、版本号没动 → 不通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.7', changed: ['README.md'] }), false)
})

test('碰了 hooks/、只挪了最后一位 → 不通过，理由点名要挪中间一位', () => {
  const r = judgeVersionBump({ before: '0.7.7', after: '0.7.8', changed: ['hooks/gate.mjs'] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /中间一位/)
  assert.match(r.reason, /hooks\/gate\.mjs/)
})

test('碰了 hooks/、挪了中间一位 → 通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.8.0', changed: ['hooks/gate.mjs'] }), true)
})

test('挪了第一位也算挪过中间一位 → 通过', () => {
  assert.equal(ok({ before: '0.9.3', after: '1.0.0', changed: ['agents/at-pm.md'] }), true)
})

test('插件会加载的每一类路径都被认出来——漏认一类，那类改动就能只挪最后一位混过去', () => {
  for (const path of [
    'agents/at-pm.md',
    'commands/at.md',
    'hooks/hooks.json',
    'skills/at-api-contract/SKILL.md',
    'templates/project.json',
    'settings.json',
    'stages.json',
    'roster.json',
  ]) {
    assert.equal(ok({ before: '0.7.7', after: '0.7.8', changed: [path] }), false, path)
  }
})

test('PLUGIN_LOADED 与上一条逐一列举的清单一致——多认或少认都要有人来改这里', () => {
  assert.deepEqual(
    [...PLUGIN_LOADED].sort(),
    ['agents/', 'commands/', 'hooks/', 'roster.json', 'settings.json', 'skills/', 'stages.json', 'templates/'],
  )
})

test('前缀不粘连：hooks-old.md 不是 hooks/ 下的文件', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.8', changed: ['hooks-old.md'] }), true)
})

test('任何一位长到 10 → 不通过', () => {
  const r = judgeVersionBump({ before: '0.7.9', after: '0.7.10', changed: ['README.md'] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /10/)
})

test('版本号不是三段纯数字（例如 -wip 后缀）→ 不通过', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.8-wip', changed: ['README.md'] }), false)
})

test('版本号往回挪 → 不通过', () => {
  assert.equal(ok({ before: '0.8.0', after: '0.7.9', changed: ['README.md'] }), false)
})

test('没有任何改动 → 通过，不要求挪版本号', () => {
  assert.equal(ok({ before: '0.7.7', after: '0.7.7', changed: [] }), true)
})

test('事件之前还没有 plugin.json（before 为 null）→ 只校验 after 的形状', () => {
  assert.equal(ok({ before: null, after: '0.1.0', changed: ['.claude-plugin/plugin.json'] }), true)
  assert.equal(ok({ before: null, after: 'x', changed: ['.claude-plugin/plugin.json'] }), false)
})
