// path-norm.mjs 此前只被间接测过（经 control-files.test.mjs / writepath.test.mjs /
// contract-guard.test.mjs 各自的用例）。评审 I-2：underDir 是从 hooks/lib/writepath.mjs
// 与 hooks/gate.mjs 的 ledger 分支里抽出来的第三份路径判定——这个模块自己的头部
// 注释讲的就是"两边各写一份、然后真的分叉了"（I1）的教训，underDir 现在是唯一一份，
// 该有自己的直接测试，不能只靠间接覆盖。
//
// 每条断言各自占一个 test()：上一个任务（Task 5）栽在同一个 test() 里多段断言
// 互相遮蔽归因——排在前面的断言一失败就抛，后面的根本没机会证明自己守的东西有必要。
// 这里两条要害断言（"target 等于 dir 本身"与"前缀粘连不算"）各自独立成块，
// 分别对应评审要求的两次塌回验证。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { underDir } from '../hooks/lib/path-norm.mjs'

const DIR = '/proj/.agent-team'

// 塌回验证 1（评审 I-2）：把 underDir 里 `t === d ||` 那半去掉，这条必须红——
// 去掉之后 underDir(DIR, DIR) 会落到 `t.startsWith(`${d}/`)`，而 DIR 后面没有
// 多出来的 "/"，判定变成 false。
test('underDir：target 等于 dir 本身时为 true', () => {
  assert.equal(underDir(DIR, DIR), true)
})

test('underDir：target 是 dir 下面的文件时为 true', () => {
  assert.equal(underDir('/proj/.agent-team/current-run', DIR), true)
})

test('underDir：target 是 dir 下面的多层子目录时也为 true', () => {
  assert.equal(underDir('/proj/.agent-team/runs/r1/state.json', DIR), true)
})

// 塌回验证 2（评审 I-2）：把 `startsWith(`${d}/`)` 改成 `startsWith(d)`（去掉
// 斜杠），这条必须红——".agent-team-backup" 确实以 ".agent-team" 这个字符串
// 开头，但它是 dir 的兄弟目录，不是子目录；少了末尾那个 "/"，字符串前缀比对
// 分不清"子目录"和"名字恰好粘在一起的兄弟目录"。
test('underDir：前缀粘连不算——/proj/.agent-team-backup 对 /proj/.agent-team 必须 false', () => {
  assert.equal(underDir('/proj/.agent-team-backup/project.json', DIR), false)
})

test('underDir：target 是 dir 的兄弟目录（同前缀但不同名）时为 false', () => {
  assert.equal(underDir('/proj/.agent-team2', DIR), false)
})

test('underDir：target 是 dir 的父目录时为 false——方向不能反', () => {
  assert.equal(underDir('/proj', DIR), false)
})

test('underDir：.. 穿越绕不过去——norm 会先 resolve', () => {
  // 看起来像 dir 下面的东西，但 .. 把它带到 dir 外面去了。
  assert.equal(underDir('/proj/.agent-team/../outside.json', DIR), false)
})

test('underDir：.. 穿越回到 dir 内部时仍然算 true——resolve 之后确实在里面', () => {
  assert.equal(underDir('/proj/.agent-team/runs/r1/../../project.json', DIR), true)
})

test('underDir：退化输入（target/dir 各自为 undefined 或空串）一律返回 false，不抛', () => {
  assert.equal(underDir(undefined, DIR), false)
  assert.equal(underDir('', DIR), false)
  assert.equal(underDir('/proj/.agent-team/current-run', undefined), false)
  assert.equal(underDir('/proj/.agent-team/current-run', ''), false)
})
