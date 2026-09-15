import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PLUGIN_PREFIX } from '../hooks/lib/decide.mjs'

test('PLUGIN_PREFIX 与 plugin.json 的 name 保持一致', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'),
  )
  assert.equal(
    PLUGIN_PREFIX,
    `${manifest.name}:`,
    '插件改名后 PLUGIN_PREFIX 没跟着改：前缀归一化会失效，' +
      '门禁将回退到「一律拒绝」，而其余测试仍然全绿',
  )
})
