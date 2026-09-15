import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseAgentAllowlist } from '../hooks/lib/frontmatter.mjs'
import { PLUGIN_PREFIX } from '../hooks/lib/decide.mjs'

const bare = (n) => (n.startsWith(PLUGIN_PREFIX) ? n.slice(PLUGIN_PREFIX.length) : n)

test('at-pm 的 frontmatter 白名单与 roster.json 一致（前缀归一化后）', () => {
  const md = readFileSync(new URL('../agents/at-pm.md', import.meta.url), 'utf8')
  const roster = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    parseAgentAllowlist(md).map(bare).sort(),
    [...roster['at-pm'].can_delegate_to].sort(),
  )
})

// 实测：tools: Agent(...) 白名单是**过滤注册表**的，而插件 agent 的注册名带前缀。
// 白名单里写裸名会让交集为空，平台报 "Available agents: none"，
// PM 于是一个角色都派不出去——而这个故障是静默的，其余测试无一会发现。
test('at-pm 的白名单必须写全限定名，否则平台过滤后一个都不剩', () => {
  const md = readFileSync(new URL('../agents/at-pm.md', import.meta.url), 'utf8')
  const names = parseAgentAllowlist(md)
  assert.ok(names.length > 0, 'at-pm 的 tools 里没有 Agent(...) 白名单')
  for (const n of names) {
    assert.ok(
      n.startsWith(PLUGIN_PREFIX),
      `白名单项 ${n} 不是全限定名：平台按 ${PLUGIN_PREFIX}xxx 注册，` +
        `写裸名会把可派发集合过滤成空集`,
    )
  }
})

test('没有 Agent(...) 时返回空数组', () => {
  assert.deepEqual(parseAgentAllowlist('---\ntools: Read, Glob\n---\n正文'), [])
})

test('能解析带空格的列表', () => {
  assert.deepEqual(
    parseAgentAllowlist('---\ntools: Agent( a , b ), Read\n---\n正文'),
    ['a', 'b'],
  )
})
