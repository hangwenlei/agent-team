#!/usr/bin/env node
// 把仓库挂到 ~/.claude/skills/agent-team，使其以 agent-team@skills-dir 自动加载。
// Windows 用 junction（mklink /J），不需要管理员权限。

import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LINK = join(homedir(), '.claude', 'skills', 'agent-team')
const action = process.argv[2]

// 不能用 existsSync：它会跟随 junction，目标被删被移之后返回 false，
// 而路径上的重解析点其实还在，此时 link 会撞上「已存在」而报一坨栈。
// lstatSync 问的是「这个路径上有没有东西」，能识别悬空 junction。
function pathExists(p) {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

if (action === 'link') {
  if (pathExists(LINK)) {
    console.error(`已存在：${LINK}。先跑 unlink。`)
    process.exit(1)
  }
  // mklink /J 不会创建父目录，而干净机器上 ~/.claude/skills 往往还不存在。
  mkdirSync(dirname(LINK), { recursive: true })
  try {
    execFileSync('cmd', ['/c', 'mklink', '/J', LINK, REPO], { stdio: 'inherit' })
  } catch (err) {
    console.error(`挂载失败：${err.message}`)
    console.error(`手动排查：mklink /J "${LINK}" "${REPO}"`)
    process.exit(1)
  }
  console.log(`已挂载 ${LINK} -> ${REPO}`)
  console.log('新开一个会话才会加载。')
} else if (action === 'unlink') {
  if (!pathExists(LINK)) {
    console.log('没有挂载，无需处理。')
    process.exit(0)
  }
  // ⚠️ recursive 必须保持 false，永远不要改成 true。
  // 实测：LINK 是 junction 时，这行只删链接本身，目标目录与内容完好；
  // 若 LINK 恰好是个真目录，它抛 ERR_FS_EISDIR 什么都不删（安全的失败）。
  // 改成 recursive: true 就会在后一种情形下连内容一起删掉。
  rmSync(LINK, { recursive: false, force: true })
  console.log(`已卸载 ${LINK}`)
} else {
  console.error('用法：node scripts/dev-link.mjs link|unlink')
  process.exit(1)
}
