// 项目经理经 Bash 调的 skill 命令行，不是门禁（hooks.json 里不注册它）：
//   node skills-cli.mjs <list|sync|assign|check|remove> [名字…] [--roles a,b] [--add a,b] [--remove a,b] [--update] [--home <目录>]
// sync 对已登记、本机原件又变了的要带 --update（换版本之前先问过用户）；assign 用 --add/--remove 增减、--roles 整份换。
// 项目根照门禁的找法（往上找最近的 .agent-team）；--home 缺省是本机用户主目录（测试传夹具目录）。
// stdout 恰好一份 JSON（两格缩进）。正常退出码 0，单条失败进 errors；找不到项目、清单读不出来、用法不对、角色不认得：
// 输出 {"error": "…"}，退出码 2。
import os from 'node:os'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { projectRootFrom } from './lib/runctx.mjs'
import {
  assertRoles,
  assignRoles,
  checkSkills,
  discoverSkills,
  readRegistry,
  removeSkills,
  syncSkills,
} from './lib/skills.mjs'

const SUBCOMMANDS = ['list', 'sync', 'assign', 'check', 'remove']

function parseArgs(argv) {
  const [sub, ...rest] = argv
  const names = []
  const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  let roles = null
  let add = null
  let remove = null
  let update = false
  let home = null
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--roles') roles = list(rest[++i])
    else if (rest[i] === '--add') add = list(rest[++i])
    else if (rest[i] === '--remove') remove = list(rest[++i])
    else if (rest[i] === '--update') update = true
    else if (rest[i] === '--home') home = rest[++i] ?? null
    else if (rest[i].startsWith('--')) throw new Error(`认不出的选项：${rest[i]}`)
    else names.push(rest[i])
  }
  return { sub, names, roles, add, remove, update, home }
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`)
}

function main() {
  const { sub, names, roles, add, remove, update, home } = parseArgs(process.argv.slice(2))
  if (!SUBCOMMANDS.includes(sub)) throw new Error(`认不出的子命令：${sub ?? '（没写）'}，只认 ${SUBCOMMANDS.join('、')}`)
  const projectRoot = projectRootFrom(process.env, process.cwd())
  const agentTeamDir = path.join(projectRoot, '.agent-team')
  if (!existsSync(agentTeamDir)) throw new Error(`在 ${projectRoot} 及其上层找不到 .agent-team，先跑 /agent-team:at-init`)
  const roster = JSON.parse(readFileSync(new URL('../roster.json', import.meta.url), 'utf8'))
  const reg = readRegistry(agentTeamDir)
  for (const given of [roles, add, remove]) if (given !== null) assertRoles(given, roster)
  if (['sync', 'assign', 'remove'].includes(sub) && names.length === 0) throw new Error(`${sub} 要写至少一个名字`)
  if (sub === 'assign' && roles === null && add === null && remove === null) throw new Error('assign 要带 --add、--remove 或 --roles')
  const found = () => discoverSkills({ home: home ?? os.homedir(), projectRoot })
  const now = new Date().toISOString()

  if (sub === 'list') {
    const { installed, errors } = found()
    const refs = new Set(installed.map((s) => s.ref))
    const withRoles = installed.map((s) => {
      const entry = reg.skills[s.name]
      const mine = entry && entry.source && entry.source.ref === s.ref
      return { ...s, registered_roles: mine ? entry.roles : [] }
    })
    const registered_missing = Object.keys(reg.skills).filter((n) => !refs.has(reg.skills[n]?.source?.ref)).sort()
    return emit({ installed: withRoles, registered_missing, errors })
  }
  if (sub === 'sync') {
    const { installed, errors } = found()
    const r = syncSkills({ agentTeamDir, installed, names, roles, now, update })
    return emit({ ...r, errors: [...errors, ...r.errors] })
  }
  if (sub === 'assign') return emit(assignRoles({ agentTeamDir, names, roles, add: add ?? [], remove: remove ?? [] }))
  if (sub === 'remove') return emit(removeSkills({ agentTeamDir, names }))
  const { installed, errors } = found()
  return emit({ ...checkSkills({ agentTeamDir, installed }), errors })
}

try {
  main()
} catch (e) {
  emit({ error: e && e.message ? e.message : String(e) })
  process.exitCode = 2
}
