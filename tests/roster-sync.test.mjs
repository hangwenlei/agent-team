import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseAgentAllowlist } from '../hooks/lib/frontmatter.mjs'

test('at-pm 的 frontmatter 白名单与 roster.json 一致', () => {
  const md = readFileSync(new URL('../agents/at-pm.md', import.meta.url), 'utf8')
  const roster = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    parseAgentAllowlist(md).sort(),
    [...roster['at-pm'].can_delegate_to].sort(),
  )
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
