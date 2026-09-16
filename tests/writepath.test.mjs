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

// Important 2（评审三轮）：run 目录下的合法写入集不再是"目录下任何东西"，
// 而是"调用者自己阶段的 produces"，判据来自 stages.json。夹具形状照抄
// 仓库根真实 stages.json 的风格（role + requires + produces）。
const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S5: { role: 'at-backend', requires: [], produces: ['05-impl/at-backend.md'] },
  S6: { role: 'at-frontend', requires: [], produces: ['05-impl/at-frontend.md'] },
}

const call = (role, filePath) =>
  decideWritePath({ role, filePath, project: PROJECT, runDir: RUN, stages: STAGES })

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

// Important 2（评审三轮）：旧版本"run 目录下的产物一律放行"名不副实——
// 代码实际放行的是整个 run 目录，不分是不是"自己那份"。收紧后只放行
// 调用者自己阶段（stages[s].role === role）的 produces；run 目录下其余
// 一切（别人的产物、state.json 等状态文件）都要走下面几条新用例。
test('写自己阶段的 produces 放行——这才是"自己那份"真正的边界', () => {
  assert.equal(call('at-backend', `${RUN}/05-impl/at-backend.md`).decision, 'allow')
})

test('写别人阶段的 produces 拒绝，理由点名归哪个角色、哪个阶段', () => {
  const r = call('at-backend', `${RUN}/05-impl/at-frontend.md`)
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /at-frontend/)
  assert.match(r.reason, /S6/)
})

// H2 就绪门禁的 artifactExists 就是在 runDir 下解析的，如果角色能自由写
// state.json，就等于能伪造 H2/H4/H5 的判据；而且 state.json 本来就不是
// 任何阶段的 produces，不是"流程产物"。
test('写 run 目录下的 state.json 拒绝——它不是任何阶段的产物，不能被角色直接改', () => {
  const r = call('at-backend', `${RUN}/state.json`)
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /产物/)
})

test('写 run 目录下任意非产物文件拒绝——不是"目录下随便什么"都能写', () => {
  const r = call('at-backend', `${RUN}/random-notes.txt`)
  assert.equal(r.decision, 'deny')
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

// Important 1（评审三轮）：resolve() 保留调用方给的原始大小写，base 的
// 盘符来自 process.cwd()——两者不同源，大小写可能对不齐。Windows 文件
// 系统大小写不敏感，同一个文件不该因为盘符或路径段大小写不同就被判成
// "没有被任何角色认领"（方向是误 deny，不是绕过，但拒绝理由是一句错误
// 指控，会把排查方向带偏）。这两条只在 Windows 上有意义——POSIX 文件
// 系统大小写敏感，'src' 与 'SRC' 真的是两个不同路径，不该做同样的归一化。
test('Windows 盘符大小写不同视为同一路径——不能误判成未认领', () => {
  if (process.platform !== 'win32') return
  const r = call('at-backend', 'c:\\proj\\src\\server\\api.ts')
  assert.equal(r.decision, 'allow')
})

test('Windows 路径段大小写不同视为同一路径——不能误判成未认领', () => {
  if (process.platform !== 'win32') return
  const r = call('at-backend', 'C:\\proj\\SRC\\server\\api.ts')
  assert.equal(r.decision, 'allow')
})

// Minor 3（评审三轮）：project.paths[role] 不是数组时（比如手误写成字符串
// 或 null），旧代码会在 underAny 的 prefixes.some 上抛 TypeError——外层
// try/catch 兜得住（fail closed），但用户看到的是"门禁异常：prefixes.some
// is not a function"，而不是指向真正问题（project.json 配置形状不对）的
// 消息。这条钉住：不抛异常，且理由要指向 project.json 本身。
test('project.paths[role] 不是数组时拒绝，理由指向 project.json 配置错误——不抛异常', () => {
  const project = { paths: { 'at-backend': 'src/server/' } } // 手误写成字符串，不是数组
  const r = decideWritePath({
    role: 'at-backend',
    filePath: '/proj/src/server/api.ts',
    project,
    runDir: RUN,
    stages: STAGES,
  })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /project\.json/)
})
