// skill 登记的判据共用的夹具：现造在临时目录里的假用户主目录（用户层 skill、git 克隆的 skill、已装插件清单与插件缓存）
// 与假项目根（带 .agent-team 与项目层 skill），不读真机的 ~/.claude。路径一律 realpath 过（macOS 的 /var 软链接）。
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

export function put(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

export const skillMd = (desc) => `---\nname: x\ndescription: ${desc}\n---\n\n正文\n`

export function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'at-skills-')))
  const home = join(root, 'home')
  const projectRoot = join(root, 'proj')
  const agentTeamDir = join(projectRoot, '.agent-team')
  mkdirSync(agentTeamDir, { recursive: true })
  put(join(home, '.claude', 'skills', 'plain', 'SKILL.md'), skillMd('普通的用户层 skill'))
  put(join(home, '.claude', 'skills', 'cloned', 'SKILL.md'), skillMd('从 GitHub 克隆的'))
  put(join(home, '.claude', 'skills', 'cloned', '.git', 'HEAD'), 'ref: refs/heads/main\n')
  put(join(projectRoot, '.claude', 'skills', 'local-one', 'SKILL.md'), skillMd('项目里的'))
  const pluginRoot = (v) => join(home, 'plugcache', 'ui-kit', v)
  const pluginSkillDir = join(pluginRoot('1.0.0'), 'skills', 'polish')
  put(
    join(pluginSkillDir, 'SKILL.md'),
    skillMd('把界面打磨得更好') + '先跑 `${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs`，再读 `${CLAUDE_PLUGIN_ROOT}/skills/polish/references/a.md`。\n',
  )
  put(join(pluginSkillDir, 'references', 'a.md'), '参考\n')
  put(join(home, 'plugcache', 'agent-team', '7.6.0', 'skills', 'at-ui-craft', 'SKILL.md'), skillMd('插件自己的'))
  const plugins = (uiKitVersion) => ({
    version: 2,
    plugins: {
      'ui-kit@mkt': [{ scope: 'user', installPath: pluginRoot(uiKitVersion), version: uiKitVersion }],
      'agent-team@mkt': [{ scope: 'user', installPath: join(home, 'plugcache', 'agent-team', '7.6.0'), version: '7.6.0' }],
    },
  })
  const writePlugins = (v) => put(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(plugins(v)))
  writePlugins('1.0.0')
  return { root, home, projectRoot, agentTeamDir, pluginRoot, pluginSkillDir, writePlugins }
}
