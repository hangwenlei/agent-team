#!/usr/bin/env node
// 把仓库挂到 ~/.claude/skills/agent-team，使其以 agent-team@skills-dir 自动加载。
// Windows 用 junction（mklink /J），不需要管理员权限。

import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LINK = join(homedir(), '.claude', 'skills', 'agent-team')
const action = process.argv[2]

if (action === 'link') {
  if (existsSync(LINK)) {
    console.error(`已存在：${LINK}。先跑 unlink。`)
    process.exit(1)
  }
  execFileSync('cmd', ['/c', 'mklink', '/J', LINK, REPO], { stdio: 'inherit' })
  console.log(`已挂载 ${LINK} -> ${REPO}`)
  console.log('新开一个会话才会加载。')
} else if (action === 'unlink') {
  if (!existsSync(LINK)) {
    console.log('没有挂载，无需处理。')
    process.exit(0)
  }
  rmSync(LINK, { recursive: false, force: true })
  console.log(`已卸载 ${LINK}`)
} else {
  console.error('用法：node scripts/dev-link.mjs link|unlink')
  process.exit(1)
}
