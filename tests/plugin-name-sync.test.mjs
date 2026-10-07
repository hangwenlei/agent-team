import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PLUGIN_PREFIX, stripPluginPrefix } from '../hooks/lib/decide.mjs'

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

// M4b（docs/36，P8/P8b）：插件 settings.json 的 agent 写全名。平台解析 agent 键时先找完全同名、再找「:名字」后缀——写裸名
// "at-pm" 时，项目里或用户层一份自己的 at-pm.md（agentType 就是 "at-pm"）会抢先当上主会话（P8 实测：项目里放一份
// tools: Read 的 at-pm.md，主会话就成了它）；门禁按剥掉前缀的名字认 PM，冒名者还会拿到控制文件的写权。markdown agent 的
// 名字不许含冒号，写全名就没有谁撞得上（P8b，2.1.286 与 2.1.278 上核过）。
// 前缀从 PLUGIN_PREFIX 取（上面那条把它和 plugin.json 的 name 锁在一起）：插件改名时两条接力——PLUGIN_PREFIX 没跟上红上一条，跟上了而 settings.json 没跟上红这一条。全名找不到时平台只告警、
// 退回默认主会话——主会话不再是 PM、门禁一路按主线程放行，而这一层不会出声，所以这里不写字面量。
// M4o（docs/50）：原话记录器只认本插件的 at——hooks.json 的 matcher、checks.mjs 声明的 matcher、门禁认的命令名都从插件名来。插件改名时
// 三处没跟上，记录器就再也不触发，契约第 1 节一声不响地不再核。
test('M4o 原话记录器认的命令是 PLUGIN_PREFIX + at：hooks.json 与 checks.mjs 的 matcher、user-words.mjs 的 AT_COMMAND', async () => {
  const hooks = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'))
  const { CHECKS } = await import('../hooks/lib/checks.mjs')
  const { AT_COMMAND } = await import('../hooks/lib/user-words.mjs')
  const want = `^${PLUGIN_PREFIX}at$`
  assert.equal(CHECKS['user-words'].matcher, want)
  assert.equal(hooks.hooks.UserPromptExpansion?.[0]?.matcher, want)
  assert.equal(AT_COMMAND, `${PLUGIN_PREFIX}at`)
  assert.ok(existsSync(new URL('../commands/at.md', import.meta.url)), '插件里得有 at 这条命令')
})

test('M4b settings.json 的 agent 是插件全名（PLUGIN_PREFIX + at-pm），剥掉前缀后对得上一份 agents/*.md', () => {
  const settings = JSON.parse(readFileSync(new URL('../settings.json', import.meta.url), 'utf8'))
  assert.equal(
    settings.agent,
    `${PLUGIN_PREFIX}at-pm`,
    'settings.json 的 agent 不是插件全名。写裸名时，项目或用户层同名的 at-pm.md 会抢先当上主会话（docs/36 P8）。',
  )
  assert.ok(existsSync(new URL(`../agents/${stripPluginPrefix(settings.agent)}.md`, import.meta.url)), settings.agent)
})
