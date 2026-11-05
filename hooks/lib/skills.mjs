// 用户本机装的 skill 登记给角色：找出本机装了哪些、整份复制进项目的 .agent-team/skills/、记进 .agent-team/skills.json、
// 比对本机原件变没变。项目经理经 hooks/skills-cli.mjs 调用这里；角色只读复制进来的副本，不经 Skill 工具。
//
// 不是门禁：这里的函数会读写文件。只用 MIN_NODE 有的同步 API（不用 fs.cpSync，自己递归复制）。
// installed_plugins.json 只在这一个文件里读——它的格式是平台的，变了只改这一处。
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const SKILLS_REGISTRY = 'skills.json'
export const SKILLS_DIR = 'skills'

const SEP = String.fromCharCode(0)
const SCRIPT_EXT = new Set(['.sh', '.py', '.js', '.mjs', '.cjs', '.ps1', '.bat'])
const WINDOWS_BAD = new Set(['<', '>', '"', '/', '\\', '|', '?', '*'])

/** skill 名字 → 项目里副本的目录名：`:` 换成 `__`，Windows 不收的字符换成 `_`，去掉结尾的点与空格。 */
export function skillDirName(name) {
  const mapped = [...String(name).split(':').join('__')]
    .map((ch) => (WINDOWS_BAD.has(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
  return mapped.replace(/[. ]+$/, '')
}

// 目录下全部文件的相对路径（`/` 分隔、排好序），跳过 .git 目录；目录不在给空数组。
// skill 目录里面的软链接（文件的、目录的、Windows 的目录联接）一律不跟：一份 skill 里放一个指向 ~/.ssh 的链接，
// 复制时就会把它带进项目。skill 目录本身是软链接（用户常把克隆下来的仓库链进 ~/.claude/skills）照常读。
function filesUnder(dir) {
  const out = []
  const walk = (abs, rel) => {
    for (const d of readdirSync(abs, { withFileTypes: true })) {
      if (d.isSymbolicLink()) continue
      const childAbs = path.join(abs, d.name)
      const childRel = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        if (d.name !== '.git') walk(childAbs, childRel)
      } else if (d.isFile()) {
        out.push(childRel)
      }
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return out.sort()
}

function fileHash(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

/** 整份目录的指纹：按相对路径排序，逐个喂「路径 + 分隔 + 原始字节 + 分隔」，sha256 hex。跳过 .git，不折行尾。 */
export function hashSkillDir(dir) {
  const h = createHash('sha256')
  for (const rel of filesUnder(dir)) {
    h.update(rel + SEP)
    h.update(readFileSync(path.join(dir, ...rel.split('/'))))
    h.update(SEP)
  }
  return h.digest('hex')
}

/** 旧目录（项目里的副本）对新目录（本机原件）：哪些文件加了、删了、改了，按相对路径排序。 */
export function diffSkillDirs(oldDir, newDir) {
  const oldFiles = new Map(filesUnder(oldDir).map((r) => [r, fileHash(path.join(oldDir, ...r.split('/')))]))
  const newFiles = new Map(filesUnder(newDir).map((r) => [r, fileHash(path.join(newDir, ...r.split('/')))]))
  const out = []
  for (const rel of [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()) {
    if (!oldFiles.has(rel)) out.push({ rel, status: 'added' })
    else if (!newFiles.has(rel)) out.push({ rel, status: 'removed' })
    else if (oldFiles.get(rel) !== newFiles.get(rel)) out.push({ rel, status: 'modified' })
  }
  return out
}

// SKILL.md frontmatter 里 description 的值；没有 frontmatter、没有这个键都给空串。认单行值与 `>`、`|` 折行写法。
function descriptionOf(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0].trim() !== '---') return ''
  const end = lines.indexOf('---', 1)
  const body = end > 0 ? lines.slice(1, end) : []
  const i = body.findIndex((l) => /^description:/.test(l))
  if (i < 0) return ''
  const value = body[i].slice('description:'.length).trim()
  if (/^[>|][+-]?$/.test(value)) {
    const more = []
    for (const l of body.slice(i + 1)) {
      if (!/^\s+\S/.test(l)) break
      more.push(l.trim())
    }
    return more.join(' ')
  }
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

const PLUGIN_REF = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s`'"()<>\]，。；：、）]+)/g

/** 一份 skill 目录的说明：一句用途、有没有附带脚本、总字节数、越出自己目录的 ${CLAUDE_PLUGIN_ROOT} 引用。 */
export function readSkillMeta(dir) {
  const files = filesUnder(dir)
  const skillMd = path.join(dir, 'SKILL.md')
  const description = existsSync(skillMd) ? descriptionOf(readFileSync(skillMd, 'utf8')) : ''
  const has_scripts = files.some((r) => r.startsWith('scripts/') || SCRIPT_EXT.has(path.extname(r).toLowerCase()))
  const bytes = files.reduce((n, r) => n + statSync(path.join(dir, ...r.split('/'))).size, 0)
  const own = `skills/${path.basename(dir)}`
  const refs = new Set()
  for (const r of files.filter((f) => f.toLowerCase().endsWith('.md'))) {
    for (const m of readFileSync(path.join(dir, ...r.split('/')), 'utf8').matchAll(PLUGIN_REF)) {
      const ref = m[1].replace(/[.,;:]+$/, '')
      if (ref !== own && !ref.startsWith(`${own}/`)) refs.add(ref)
    }
  }
  return { description, has_scripts, bytes, refs_outside: [...refs].sort() }
}

// 一个目录下每个带 SKILL.md 的子目录（子目录本身是指向目录的软链接也算）。
function skillDirsIn(parent) {
  if (!existsSync(parent)) return []
  const isDirLike = (d) => {
    if (d.isDirectory()) return true
    if (!d.isSymbolicLink()) return false
    try {
      return statSync(path.join(parent, d.name)).isDirectory()
    } catch {
      return false
    }
  }
  return readdirSync(parent, { withFileTypes: true })
    .filter((d) => isDirLike(d) && existsSync(path.join(parent, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort()
}

// 一份登记的副本在项目里的目录：一律由名字推出来，不信清单里记的 dir（清单谁都能用 Bash 改）；
// 推出来不是 .agent-team/skills 下面的一层目录（空名字、`.`、`..`）给 null。
function copyPathOf(agentTeamDir, name) {
  const dir = skillDirName(name)
  if (!dir || dir === '.' || dir === '..') return null
  const base = path.resolve(agentTeamDir, SKILLS_DIR)
  const full = path.resolve(base, dir)
  return path.dirname(full) === base ? full : null
}

function samePath(a, b) {
  const n = (p) => {
    const r = path.resolve(p)
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return n(a) === n(b)
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * 本机装了哪些 skill：用户层（<home>/.claude/skills，目录里有 .git 的算 git）、项目层（<projectRoot>/.claude/skills）、
 * 已装插件带的（installed_plugins.json 每条的 installPath/skills）。selfPlugin 自己的不列。
 * 插件清单读不出来不影响另外两类，进 errors。
 */
export function discoverSkills({ home, projectRoot, selfPlugin = 'agent-team' }) {
  const installed = []
  const errors = []
  const add = (dir, base) => installed.push({ ...base, path: dir, ...readSkillMeta(dir) })

  const userRoot = path.join(home, '.claude', 'skills')
  for (const name of skillDirsIn(userRoot)) {
    const dir = path.join(userRoot, name)
    add(dir, { name, ref: `user/${name}`, kind: existsSync(path.join(dir, '.git')) ? 'git' : 'user' })
  }
  const projectSkills = path.join(projectRoot, '.claude', 'skills')
  for (const name of skillDirsIn(projectSkills)) {
    add(path.join(projectSkills, name), { name, ref: `project/${name}`, kind: 'project' })
  }

  const listFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json')
  if (existsSync(listFile)) {
    let list = null
    try {
      list = JSON.parse(readFileSync(listFile, 'utf8'))
    } catch (e) {
      errors.push({ source: 'installed_plugins.json', message: `读不出来：${e.message}` })
    }
    if (list !== null && !isPlainObject(list?.plugins)) {
      errors.push({ source: 'installed_plugins.json', message: '认不出它的格式（没有 plugins 对象）' })
      list = null
    }
    const seen = new Set()
    for (const [key, entries] of Object.entries(list?.plugins ?? {})) {
      const pluginName = key.split('@')[0]
      if (pluginName === selfPlugin || !Array.isArray(entries)) continue
      for (const entry of entries) {
        if (!isPlainObject(entry) || typeof entry.installPath !== 'string') continue
        let unverified = false
        if (entry.scope !== 'user') {
          if (typeof entry.projectPath === 'string') {
            if (!samePath(entry.projectPath, projectRoot)) continue
          } else {
            unverified = true
          }
        }
        const skillsRoot = path.join(entry.installPath, 'skills')
        for (const dirName of skillDirsIn(skillsRoot)) {
          const ref = `${pluginName}:${dirName}`
          if (seen.has(ref)) continue
          seen.add(ref)
          add(path.join(skillsRoot, dirName), {
            name: ref,
            ref,
            kind: 'plugin',
            plugin: key,
            version: typeof entry.version === 'string' ? entry.version : null,
            plugin_root: entry.installPath,
            ...(unverified ? { scope_unverified: true } : {}),
          })
        }
      }
    }
  }
  installed.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return { installed, errors }
}

/** 读 .agent-team/skills.json。文件不在给空清单；不是 JSON 或形状不对抛错，不改文件。 */
export function readRegistry(agentTeamDir) {
  const file = path.join(agentTeamDir, SKILLS_REGISTRY)
  if (!existsSync(file)) return { skills: {} }
  let reg
  try {
    reg = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`skills.json 读不出来：${e.message}`)
  }
  if (!isPlainObject(reg) || !isPlainObject(reg.skills)) throw new Error('skills.json 读不出来：顶层要是一个带 skills 对象的对象')
  return reg
}

function writeRegistry(agentTeamDir, reg) {
  mkdirSync(agentTeamDir, { recursive: true })
  writeFileSync(path.join(agentTeamDir, SKILLS_REGISTRY), `${JSON.stringify(reg, null, 2)}\n`)
}

function copyDir(src, dst) {
  rmSync(dst, { recursive: true, force: true })
  for (const rel of filesUnder(src)) {
    const to = path.join(dst, ...rel.split('/'))
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(path.join(src, ...rel.split('/')), to)
  }
  mkdirSync(dst, { recursive: true })
}

// 用户给的名字或 ref → installed 里的那一条；对不上、对上几条都给错误消息。
function resolveSkill(installed, wanted) {
  const byRef = installed.filter((s) => s.ref === wanted)
  if (byRef.length === 1) return { skill: byRef[0] }
  const byName = installed.filter((s) => s.name === wanted)
  if (byName.length === 1) return { skill: byName[0] }
  if (byName.length > 1) return { error: `本机有几份都叫 ${wanted}，用 ref 指明是哪一份：${byName.map((s) => s.ref).join('、')}` }
  return { error: `本机没有找到 ${wanted}` }
}

/** 整份复制进项目、写清单。roles 为 null 时沿用清单里原有的角色；新登记却没给角色的报错。 */
export function syncSkills({ agentTeamDir, installed, names, roles, now }) {
  const reg = readRegistry(agentTeamDir)
  const synced = []
  const errors = []
  for (const wanted of names) {
    const { skill, error } = resolveSkill(installed, wanted)
    if (error) {
      errors.push({ name: wanted, message: error })
      continue
    }
    const key = skill.name
    const finalRoles = roles ?? reg.skills[key]?.roles ?? null
    if (!Array.isArray(finalRoles) || finalRoles.length === 0) {
      errors.push({ name: wanted, message: `${key} 还没登记过，要说分给哪几个角色` })
      continue
    }
    const copyPath = copyPathOf(agentTeamDir, key)
    if (!copyPath) {
      errors.push({ name: wanted, message: `${key} 这个名字推不出副本的目录名` })
      continue
    }
    const dir = path.basename(copyPath)
    copyDir(skill.path, copyPath)
    const sha = hashSkillDir(skill.path)
    const source = { kind: skill.kind, ref: skill.ref, path: skill.path }
    if (skill.kind === 'plugin') Object.assign(source, { plugin: skill.plugin, version: skill.version, plugin_root: skill.plugin_root })
    reg.skills[key] = { dir, description: skill.description, roles: [...finalRoles], source, sha, synced_at: now }
    synced.push({ name: key, dir, sha })
  }
  if (synced.length) writeRegistry(agentTeamDir, reg)
  return { synced, errors }
}

/** 只改登记过的 skill 分给谁，不复制。 */
export function assignRoles({ agentTeamDir, names, roles }) {
  const reg = readRegistry(agentTeamDir)
  const assigned = []
  const errors = []
  for (const name of names) {
    if (!isPlainObject(reg.skills[name])) {
      errors.push({ name, message: `${name} 还没登记` })
      continue
    }
    reg.skills[name].roles = [...roles]
    assigned.push(name)
  }
  if (assigned.length) writeRegistry(agentTeamDir, reg)
  return { assigned, errors }
}

/** 本机原件对清单：没变、变了（附改了哪些文件）、原件不见了、项目里的副本不见了。按来源的 ref 重新认原件，插件升级换目录照样认得。 */
export function checkSkills({ agentTeamDir, installed }) {
  const reg = readRegistry(agentTeamDir)
  const result = { unchanged: [], changed: [], missing: [], copy_missing: [] }
  for (const name of Object.keys(reg.skills).sort()) {
    const entry = reg.skills[name]
    const copyPath = copyPathOf(agentTeamDir, name)
    if (!copyPath || !existsSync(copyPath)) {
      result.copy_missing.push(name)
      continue
    }
    const src = installed.find((s) => s.ref === entry?.source?.ref)
    if (!src) {
      result.missing.push(name)
      continue
    }
    if (hashSkillDir(src.path) === entry.sha) {
      result.unchanged.push(name)
      continue
    }
    const item = { name, files: diffSkillDirs(copyPath, src.path), source_path: src.path, copy_path: copyPath }
    if (entry.source.kind === 'plugin') Object.assign(item, { version_from: entry.source.version ?? null, version_to: src.version ?? null })
    result.changed.push(item)
  }
  return result
}

/** 删掉项目里的副本与清单里那一条；本机原件不碰。 */
export function removeSkills({ agentTeamDir, names }) {
  const reg = readRegistry(agentTeamDir)
  const removed = []
  const errors = []
  for (const name of names) {
    const entry = reg.skills[name]
    if (!isPlainObject(entry)) {
      errors.push({ name, message: `${name} 没登记过` })
      continue
    }
    const copyPath = copyPathOf(agentTeamDir, name)
    if (!copyPath) {
      errors.push({ name, message: `${name} 这个名字推不出副本的目录名，没有删任何东西` })
      continue
    }
    rmSync(copyPath, { recursive: true, force: true })
    delete reg.skills[name]
    removed.push(name)
  }
  if (removed.length) writeRegistry(agentTeamDir, reg)
  return { removed, errors }
}

/** 能登记 skill 的角色：花名册里派得到的，加上项目经理。别的（包括测试替身）抛错。 */
export function assertRoles(roles, roster) {
  if (!Array.isArray(roles) || roles.length === 0) throw new Error('要说分给哪几个角色')
  const allowed = new Set(['at-pm', ...Object.values(roster ?? {}).flatMap((r) => (Array.isArray(r?.can_delegate_to) ? r.can_delegate_to : []))])
  for (const r of roles) {
    if (!allowed.has(r)) throw new Error(`${r} 不是能登记 skill 的角色（能登记的：${[...allowed].sort().join('、')}）`)
  }
}
