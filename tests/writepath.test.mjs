import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideWritePath } from '../hooks/lib/writepath.mjs'

const PROJECT = {
  paths: {
    'at-backend': ['src/server/', 'src/shared/'],
    'at-frontend': ['src/web/', 'src/shared/'],
  },
}
const RUN = '/proj/.agent-team/runs/r1'

const call = (role, filePath) =>
  decideWritePath({ role, filePath, project: PROJECT, runDir: RUN })

test('写自己名下的路径放行', () => {
  assert.equal(call('at-backend', '/proj/src/server/api.ts').decision, 'allow')
})

test('写别人名下的路径拒绝', () => {
  const r = call('at-backend', '/proj/src/web/App.tsx')
  assert.equal(r.decision, 'deny')
})

test('拒绝理由点名这条路径归谁', () => {
  const r = call('at-backend', '/proj/src/web/App.tsx')
  assert.match(r.reason, /at-frontend/)
})

test('共享路径对两个角色都放行', () => {
  assert.equal(call('at-backend', '/proj/src/shared/types.ts').decision, 'allow')
  assert.equal(call('at-frontend', '/proj/src/shared/types.ts').decision, 'allow')
})

test('谁都没认领的路径拒绝，并说明要先在 project.json 里认领', () => {
  const r = call('at-backend', '/proj/docs/readme.md')
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /project\.json/)
})

test('本趟 run 目录下的产物一律放行——那是流程产物不是代码', () => {
  assert.equal(call('at-backend', `${RUN}/05-impl/at-backend.md`).decision, 'allow')
})

test('不在 project.paths 里的角色不归本门禁管，放行', () => {
  assert.equal(call('at-worker-a', '/proj/anything.ts').decision, 'allow')
})

test('project 为 null 时放行——尚未跑过勘察', () => {
  const r = decideWritePath({ role: 'at-backend', filePath: '/proj/x.ts', project: null, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('路径里的 .. 不能用来逃出自己的地盘', () => {
  const r = call('at-backend', '/proj/src/server/../web/App.tsx')
  assert.equal(r.decision, 'deny')
})

// 以下是简报用例之外补的退化输入覆盖（任务说明「简报的用例里有几条，自己再想一遍
// 还有没有漏的」）。前三条钉住 decideWritePath 对「取不出可用文件路径」的输入一律
// allow——这不是「放过了」，是刻意的：H3 只能对「看得懂的目标路径」表态，看不懂
// 目标时不表态，交给别的门禁或人工判断（fail closed 的入口保护已经在 gate.mjs 的
// isValidInput/tool_name 校验里做了，不是这个纯函数的职责）。

test('filePath 缺失（undefined）时放行——没有可判定的目标路径', () => {
  const r = decideWritePath({ role: 'at-backend', filePath: undefined, project: PROJECT, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('filePath 不是字符串（数字）时放行——没有可判定的目标路径', () => {
  const r = decideWritePath({ role: 'at-backend', filePath: 42, project: PROJECT, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('filePath 是空字符串时放行——没有可判定的目标路径', () => {
  const r = decideWritePath({ role: 'at-backend', filePath: '', project: PROJECT, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

// Windows 原生反斜杠路径：resolve()/sep 的归一化必须真的在这台机器上验证过，
// 不能只靠 POSIX 风格的字符串测试心理暗示"应该也对"。用单个反斜杠开头
// （不带盘符）模拟"当前盘符根"，跟 PROJECT/RUN 用的 '/proj/...' 是同一种
// "无盘符绝对路径"，唯一变量是分隔符本身。
test('Windows 反斜杠路径与 POSIX 前缀等价放行——分隔符差异不能造成误判', () => {
  const r = call('at-backend', '\\proj\\src\\server\\api.ts')
  assert.equal(r.decision, 'allow')
})

test('Windows 反斜杠路径写别人地盘同样被拒——不是"反斜杠绕过检查"', () => {
  const r = call('at-backend', '\\proj\\src\\web\\App.tsx')
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /at-frontend/)
})

// 相对路径：resolve() 会把它锚定在 process.cwd()（测试跑在仓库根），而不是
// base（由 runDir 推出的项目根，这里是 /proj）。字符串上看着像"落在自己地盘
// 里"的相对路径，解析后其实落在完全无关的位置——必须不能被误判成 allow，
// 否则一个相对路径就能绕过前缀比对（比对的是解析后的绝对路径，不是原始字符串）。
test('相对路径按 cwd 解析，不会被误判成落在调用者自己的地盘里', () => {
  const r = call('at-backend', 'src/server/api.ts')
  assert.notEqual(r.decision, 'allow')
})
