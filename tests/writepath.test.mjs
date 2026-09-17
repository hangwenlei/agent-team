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
// S4 与 S1 同属 at-pm：夹具照抄仓库根真实 stages.json 的这条事实（整理项 4），
// 让"同一角色多个阶段"这条在纯函数这一层也有覆盖，见下面那条用例。
const STAGES = {
  S1: { role: 'at-pm', requires: [], produces: ['00-contract.md'] },
  S2: { role: 'at-product', requires: [], produces: ['01-prd.md'] },
  S4: { role: 'at-pm', requires: [], produces: ['04-dispatch.md'] },
  S5: { role: 'at-backend', requires: [], produces: ['05-impl/at-backend.md'] },
  S6: { role: 'at-frontend', requires: [], produces: ['05-impl/at-frontend.md'] },
}

const AT = '/proj/.agent-team'

const call = (role, filePath) =>
  decideWritePath({ role, filePath, project: PROJECT, runDir: RUN, stages: STAGES, agentTeamDir: AT })

// ——— docs/09 账一：控制文件 ———

test('PM 能写 run 的 state.json——账一要解的正是这个死锁', () => {
  assert.equal(call('at-pm', `${RUN}/state.json`).decision, 'allow')
})

test('PM 能写 project.json / current-run / reach.json', () => {
  assert.equal(call('at-pm', `${AT}/project.json`).decision, 'allow')
  assert.equal(call('at-pm', `${AT}/current-run`).decision, 'allow')
  assert.equal(call('at-pm', `${AT}/reach.json`).decision, 'allow')
})

test('主线程（MAIN）也是 PM，同样能写控制文件', () => {
  assert.equal(call('__main__', `${RUN}/state.json`).decision, 'allow')
})

test('执行角色写 state.json 被拒，理由说明这是控制文件', () => {
  const r = call('at-backend', `${RUN}/state.json`)
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /控制文件/)
  assert.match(r.reason, /PM/)
})

test('执行角色写 project.json 被拒——收紧了「不在 paths 里的角色就放行」那条口子', () => {
  // at-outsider 不在 PROJECT.paths 里。控制文件分支没加之前，它会命中
  // decideWritePath 里 Object.hasOwn(owners, role) 那条早退而被**放行**。
  const r = call('at-outsider', `${AT}/project.json`)
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /控制文件/)
})

test('账一 #2：PM 仍然不能伪造别人阶段的产物', () => {
  // 01-prd.md 是阶段产物不是控制文件。夹具里 at-pm 只有 S1/S4，所以这条走的是
  // 「run 目录下只有自己阶段的产物可写」那条，不是控制文件分支。
  const r = call('at-pm', `${RUN}/01-prd.md`)
  assert.equal(r.decision, 'deny')
  assert.doesNotMatch(r.reason, /控制文件/)
})

test('不传 agentTeamDir 时控制文件分支不触发，保持既有行为', () => {
  const r = decideWritePath({
    role: 'at-pm', filePath: `${RUN}/state.json`,
    project: PROJECT, runDir: RUN, stages: STAGES,
  })
  assert.equal(r.decision, 'deny')
})

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

// 整理项 4：producesOf 是把该角色**所有**阶段的 produces 累加起来的，不是只看
// 第一个阶段。at-pm 同时是 S1（00-contract.md）与 S4（04-dispatch.md）的执行者，
// 两份都得能写。这是 hooks/lib/writepath.mjs 里 I3 那段缺口注释里唯一还正确的
// 行为，也是 hooks/lib/deliverable.mjs 里 I4 那条错误语义的对照面——没有测试
// 钉住的话，将来改 producesOf（比如为了修 I4 而改成"只看某一段"）会静默丢掉它。
test('同一角色多个阶段的 produces 都能写——producesOf 累加所有阶段，不是只看第一个', () => {
  assert.equal(call('at-pm', `${RUN}/00-contract.md`).decision, 'allow')
  assert.equal(call('at-pm', `${RUN}/04-dispatch.md`).decision, 'allow')
})

// 整理项 12：这里原本写的是 at-worker-a——c3dc888 已经把这个 M0 占位名整体
// 改掉了（at-worker-a→at-backend、at-worker-b→at-frontend），Task 3 评审明确
// 裁定过它不该在新测试里复活（readiness.test.mjs 与 deliverable.test.mjs 都已
// 照做并留了注释），Task 4 写这份文件时又写了回来。这条用例的语义是"一个真实
// 存在、但不在 project.paths 里的角色"，roster.json 里的 at-outsider 才对得上
// （它就是为"在花名册里但不参与阶段链"这件事准备的对照角色）。
test('不在 project.paths 里的角色不归本门禁管，放行', () => {
  assert.equal(call('at-outsider', '/proj/anything.ts').decision, 'allow')
})

test('project 为 null 时，run 目录外的普通路径放行——尚未跑过勘察，per-role 隔离没有判据', () => {
  const r = decideWritePath({ role: 'at-backend', filePath: '/proj/x.ts', project: null, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

// 全分支评审 I1：上一条的"放行"只该覆盖 project.paths 那一段。run 目录保护
// 只依赖 runDir/stages，跟 project.json 在不在没有关系——而旧版本把
// `!project.paths → allow` 写在整个函数最前面，于是 run 正在跑、
// project.json 不在时（runctx.mjs 明确允许这种状态：project 为 null 且
// ctx.ok 为 true），整块 run 目录收紧变成彻底的空操作：角色可以在 run 目录下
// 随便写，凭空伪造别人阶段的产物去满足 H2 的 requires，或者直接改 state.json。
// 上面那五条"run 目录下…拒绝"的用例全都带着 project: PROJECT，一条也没有
// 覆盖缺席路径，它们在证明一件自己没在守的事。这条钉住缺席路径。
test('project 为 null 时，run 目录下写别人阶段的产物仍然拒绝——run 目录保护不挂在 project.json 上', () => {
  const r = decideWritePath({
    role: 'at-backend',
    filePath: `${RUN}/05-impl/at-frontend.md`,
    project: null,
    runDir: RUN,
    stages: STAGES,
  })
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /at-frontend/)
  assert.match(r.reason, /S6/)
})

test('project 为 null 时，run 目录下写 state.json 仍然拒绝——它是 H4/H5 的状态来源', () => {
  const r = decideWritePath({
    role: 'at-backend',
    filePath: `${RUN}/state.json`,
    project: null,
    runDir: RUN,
    stages: STAGES,
  })
  assert.equal(r.decision, 'deny')
})

test('project 为 null 时，run 目录下写自己阶段的产物仍然放行——收紧的是别人的地盘，不是自己的', () => {
  const r = decideWritePath({
    role: 'at-backend',
    filePath: `${RUN}/05-impl/at-backend.md`,
    project: null,
    runDir: RUN,
    stages: STAGES,
  })
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

// 整理项 3：这条断言是对的，但原来的理由在生产里不成立，改注释不改断言。
// 原注释说"否则一个相对路径就能绕过前缀比对"——真实 hook 的 cwd 就是项目根
// （gate.mjs 用 process.cwd() 当 ROOT_PROJECT），所以角色传相对路径时
// resolve() 会把它正确锚定在项目根上、合法落进自己的地盘并被放行，那里没有
// 绕过可言。这条测试实际钉的是另一件事：**比对的是 resolve() 之后的绝对路径，
// 不是原始字符串**。在这个夹具里 cwd（跑测试的仓库根）与 base（由 runDir 推出
// 的 /proj）故意不是同一个地方，于是"看着像落在 src/server/ 里"的相对路径解析
// 后落在完全无关的位置，必须不是 allow——如果哪天有人把实现改成拿原始字符串
// 做 startsWith 比对，这条会红。
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
//
// 整理项 13：用 node:test 的 { skip } 选项，不用 `if (...) return`。后者在 POSIX
// 上是"函数体一行没跑就直接判通过"，`node --test` 的输出里跟真的跑过、断言过
// 没有区别；{ skip } 会把它标成 skipped，"这条没跑"这件事看得见。
// tests/contract-guard.test.mjs 早就改用 { skip } 并在注释里点名了这个差别，
// 只是没回头改这里。
test(
  'Windows 盘符大小写不同视为同一路径——不能误判成未认领',
  { skip: process.platform !== 'win32' },
  () => {
    const r = call('at-backend', 'c:\\proj\\src\\server\\api.ts')
    assert.equal(r.decision, 'allow')
  },
)

test(
  'Windows 路径段大小写不同视为同一路径——不能误判成未认领',
  { skip: process.platform !== 'win32' },
  () => {
    const r = call('at-backend', 'C:\\proj\\SRC\\server\\api.ts')
    assert.equal(r.decision, 'allow')
  },
)

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
