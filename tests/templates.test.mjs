import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CONTROL_FILES } from '../hooks/lib/control-files.mjs'
import { validateState } from '../hooks/lib/state.mjs'
import { producedNames } from '../hooks/lib/stages.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const readJson = (p) => JSON.parse(readFileSync(url(p), 'utf8'))
const roster = readJson('roster.json')
const stages = readJson('stages.json')

test('state.json 模板本身就是一份合法 state', () => {
  const r = validateState(readJson('templates/state.json'), { stages })
  assert.deepEqual(r.problems, [], r.problems.join('\n'))
})

test('state.json 模板的 contract_sha 是 PENDING——模板里不该有一个假哈希', () => {
  assert.equal(readJson('templates/state.json').contract_sha, 'PENDING')
})

// ——— 哪些顶层键是「少了就报」的，哪些不是 ———
//
// M3a Task 4。commands/at.md 建 run 那一段写着「模板的顶层键照着写，一个都不要省：
// **除 trimmed 以外**，少任何一个都会被账本回传报成状态不合法」，主规格 §4.4 里有
// 同一句的另一处。**那句话在 M3a 之前是没有例外的**——Task 1 给模板加了 trimmed，而
// validateState 对 trimmed 缺失**有意**不报（向后兼容：这个字段之前落盘的 run 里没有），
// 于是原来那句「少了会被账本回传报成状态不合法」当场对一个键变假，**而全仓没有任何
// 东西会响**。这条就是那句话的判据。
//
// ⚠️ 判据从 templates/state.json 派生，**不在测试里抄一份「模板有哪些键」**，理由与
// tests/commands.test.mjs 里那条「模板的键都在 /at 那段列举里」逐字相同：抄一份就是
// 第二处真源，往模板加键的人只会同时改模板和那份拷贝，判据永远不会红。
//
// ⚠️ 两条互为对方的正向自检锚，所以必须成对：
//   - 上面那条断言的是「删了就报」（problems 非空）。**它单独可能因为夹具坏了而恒真**
//     ——比如 readJson 读出来的根本不是一份合法 state，那么删哪个键都照样报。
//   - 下面那条断言同一套夹具、同一个删法，对 trimmed 得到的是 **problems 为空**。
//     它一红就说明「删一个键之后还能是合法 state」这件事做不到了，上面那条于是不再
//     是在检查「这个键承重」，而是在检查「这份夹具坏着」。
// 这正是「锚要钉在判据真正迭代的那一层」：锚钉的是删键这个动作本身，不是键的名字。
const stateTemplateKeys = () => Object.keys(readJson('templates/state.json'))
const withoutKey = (k) => {
  const s = readJson('templates/state.json')
  delete s[k]
  return validateState(s, { stages }).problems
}

test('state.json 模板里除 trimmed 之外的每个顶层键，删掉就会被 validateState 报', () => {
  for (const k of stateTemplateKeys()) {
    if (k === 'trimmed') continue
    assert.notDeepEqual(
      withoutKey(k),
      [],
      `templates/state.json 的 ${k} 删掉之后 validateState 一声不吭——` +
        'commands/at.md 建 run 那一段与主规格 §4.4 都写着「除 trimmed 以外，少任何一个都会被' +
        '账本回传报成状态不合法」，那句话因此对 ' + k + ' 变假了。' +
        '要么给这个键补上必填校验，要么把那两处正文里的例外名单改对——别只改一处。',
    )
  }
})

test('state.json 模板的 trimmed 删掉不报——向后兼容那条例外，也是上一条的正向锚', () => {
  assert.deepEqual(
    withoutKey('trimmed'),
    [],
    'trimmed 缺失被 validateState 报了。它是 M3a 后加的字段，对更早落盘的 state.json ' +
      '必须缺失即合法（/agent-team:at-resume 要去读那些 run）；同时这条还是上一条的' +
      '正向锚——它一红，就说明「删掉一个键之后仍然是合法 state」这件事本身做不到了，' +
      '上一条那些「删了就报」于是可能是夹具坏掉带来的恒真。',
  )
})

// Task 2 修复轮 1 · 修复 1：hooks/lib/readiness.mjs 的 decideReadiness 那条回归
// （H2 在真实初始状态下对 S2/S5 完全失效）整条推理都建立在这个前提上——
// commands/at.md 第 4 步在派发**并核实之后**才把 targetRole 累加进 roster，
// 所以 H2 跑的那一刻，state.json 的 roster 必然还不含正在被派的这个角色，而
// 这个模板就是每一次新 run 的起点。这条钉住前提本身没有漂移。
//
// 哪天有人把这个模板改成预填 roster（比如把发起这一趟的 at-pm 先塞进去），
// 这条测试会变红——那不是这条测试写错了，是提醒回头重新核一遍 H2 那条修复
// 的前提是否还成立（尤其是 hooks/lib/readiness.mjs 里那段"roster 必然还不含
// targetRole"的推导）。
test('state.json 模板的 roster 是 []——H2 修复 1 那条推理的前提', () => {
  assert.deepEqual(readJson('templates/state.json').roster, [])
})

// docs/09 账一驳掉的方向 (b) 就是「在 project.json 模板里把 .agent-team/ 划给
// at-pm」。控制文件不走角色认领（规格 §6.2.1），划给谁都是同一个概念两套机制。
test('project.json 模板的 paths 里不得出现 .agent-team', () => {
  const { paths } = readJson('templates/project.json')
  for (const [role, prefixes] of Object.entries(paths)) {
    for (const p of prefixes) {
      assert.ok(
        !p.replace(/\\/g, '/').split('/').includes('.agent-team'),
        `paths.${role} 里有 ${p}——控制文件不走角色认领（规格 §6.2.1 / docs/09 账一）`,
      )
    }
  }
})

test('project.json 模板的每个 paths 键都是花名册里的角色', () => {
  for (const role of Object.keys(readJson('templates/project.json').paths)) {
    assert.ok(Object.hasOwn(roster, role), `paths 里有 ${role}，但它不在 roster.json 里`)
  }
})

// ⚠️ M1b 终审 I4：这条测试的标题一直写「四类」，检查的却是 ['paths','stack','build',
// 'test'] —— 规格 §7.1 原文的四类是「路径归属、**可用班底**、技术栈、构建与测试命令」，
// 可用班底被整类丢掉了，而「四」这个数字靠 build/test 拆成两个键凑住。更要命的是
// 失败文案把 §7.1 引述成「路径归属、技术栈、构建与测试命令」——**三类**，也就是说
// 这条测试在一条重新引述规格的语句里把规格的一项静默删掉了。
//
// 真实代价已经落地：commands/at.md 只能把四个角色名硬编码进正文来算 never_invoked，
// 而那正是规格 §4.2 ④ 引用 aws-samples「安全架构师角色整个项目从未被调用且无人发现」
// 要防的东西——M2 加角色时 /at 会静默漏算。
//
// 现在检查五个键、四类信息，失败文案逐字对上 §7.1。
test('project.json 模板带齐 /at-init 要填的四类信息', () => {
  const p = readJson('templates/project.json')
  for (const k of ['paths', 'available_roles', 'stack', 'build', 'test']) {
    assert.ok(
      Object.hasOwn(p, k),
      `模板缺 ${k}（规格 §7.1：路径归属、可用班底、技术栈、构建与测试命令）`,
    )
  }
})

// available_roles 是「这个项目有哪些执行角色可用」，M1a ② 的形状在这里会重演：
// 一个花名册里不存在的名字写进模板，直到有真实派发撞上 H1 才会被发现。
// ⚠️ 它与 state.json 的 roster 语义不同：那个是「这一趟真正叫到了谁」（运行时累加），
// 这个是「这个项目有哪些角色可用」（配置，一次性）。never_invoked = 前者减后者。
test('project.json 模板的 available_roles 都是花名册里的角色，且不含 at-pm', () => {
  const { available_roles: roles } = readJson('templates/project.json')
  assert.ok(Array.isArray(roles) && roles.length > 0, 'available_roles 不是一个非空数组')
  for (const role of roles) {
    assert.ok(Object.hasOwn(roster, role), `available_roles 里有 ${role}，但它不在 roster.json 里`)
    assert.notEqual(
      role,
      'at-pm',
      'at-pm 是这一趟的驱动者，不参与「有没有被叫到」的统计——把它写进 available_roles ' +
        '会让 /at 的收尾永远把 PM 自己算成一个可能没被叫过的角色',
    )
  }
})

// M2a Task 2 / docs/11 §1.3：at-qa 与 at-acceptance 故意不认领任何 project.paths——
// 「可用班底」再也不能从 paths 的键集合派生，available_roles 是唯一来源。漏了它，
// /at 收尾会静默漏算 never_invoked，正是规格 §4.2 ④ 引用 aws-samples「安全架构师
// 角色整个多日项目从未被调用且无人发现」要防的东西。
test('available_roles 不等于 paths 的键集合——at-qa/at-acceptance 不认领路径，班底只能从 available_roles 读', () => {
  const p = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
  const pathKeys = Object.keys(p.paths).sort()
  const roles = [...p.available_roles].sort()
  assert.notDeepEqual(roles, pathKeys)
})

// 上面那条是否定式（notDeepEqual）：光有它时，两个集合以任何方式不等都会绿——包括
// 「paths 里多了个 available_roles 没有的角色」这种反向错误（那恰恰是危险的方向，
// H3 写路径隔离会把权限扩到一个未登记在案的角色头上）。这条是它的正向自检锚，钉死
// 「不等」具体是哪种不等：available_roles 比 paths 的键多，且多出来的正是不认领
// 路径的那两个角色，不多不少。
test('前置条件：available_roles 真的比 paths 的键多，且多出来的正是不认领路径的那两个', () => {
  const p = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
  const extra = p.available_roles.filter((r) => !Object.hasOwn(p.paths, r)).sort()
  assert.deepEqual(extra, ['at-acceptance', 'at-qa'])
})

// Task 2 评审发现 3：上面那条正向锚只算 available_roles − paths 这一个方向，**反方向
// 没有任何测试抓得住**——实测往 paths 里加一个 available_roles 里没有的角色
// （如 at-outsider，它在 roster.json 里真实存在），409 条全绿。
//
// 严重性要说准，不要照抄上面那段注释的措辞：评审 grep 过 available_roles 在 hooks/ 下的
// 消费面，**没有任何 hook 读它**（只有 paths 被 writepath.mjs 与 gate.mjs 消费）。所以
// 这不是 H3 的安全洞——H3 从不看 available_roles。真实代价局限在 /at 的班底核算：一个
// 拿到真实写权限（paths）的角色可以完全不出现在「可用班底」里，于是它连
// never_invoked 的分母都进不去，「这个角色到底算不算数」失去机械校验。
//
// ⚠️ **上面那句「没有任何 hook 读它」M3a 之后是假的（M3a Task 4 补标）。**
// M3a Task 2 的 Ruling 2 把产者交代判据的宇宙收窄到了 available_roles：
// hooks/gate.mjs 的 ledger 分支把 ctx.project?.available_roles 传进
// hooks/lib/coverage.mjs 的 decideCoverage。**available_roles 从此有第二个消费方，
// 而且它在 hook 里。**
//
// **代价跟着变，所以这条测试的严重性也要重说**：一个在 paths 里、却不在 available_roles
// 里的角色，今天**同时**掉出两个口径——收尾的 never_invoked 分母（旧的那一半），
// 以及**产者交代判据的宇宙**（新的那一半）。后者的表现是：它当了某一段的产者却从来
// 没被派，判据**也不会报它**，因为它压根没进宇宙。「这个角色到底算不算数」失去的不再
// 只是收尾时的机械校验，而是**运行中唯一会喊出「这个人没交代」的那条判据**。
//
// ⚠️ 这一条仍然**不是** H3 的安全洞——H3 到今天也不看 available_roles，那半句没变。
// 分开说是有意的：变假的是「有没有 hook 读它」，没变的是「H3 看不看它」。
test('paths 的每个键都在 available_roles 里——拿到写权限的角色不能不在班底名单上', () => {
  const p = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
  const orphan = Object.keys(p.paths).filter((r) => !p.available_roles.includes(r)).sort()
  assert.deepEqual(orphan, [])
})

test('前置条件：paths 非空——上一条否定断言不是在空集合上空转', () => {
  const p = JSON.parse(readFileSync(new URL('../templates/project.json', import.meta.url), 'utf8'))
  assert.ok(Object.keys(p.paths).length > 0)
})

// docs/09 账一实现约束 1：控制文件清单只有一处真源。模板里再抄一份就是第二处。
test('模板里不得再抄一份控制文件清单', () => {
  for (const f of readdirSync(url('templates'))) {
    const text = readFileSync(url(`templates/${f}`), 'utf8')
    const hits = CONTROL_FILES.filter((c) => !c.includes('*') && text.includes(c))
    assert.ok(
      hits.length <= 1,
      `templates/${f} 同时提到了 ${hits.join('、')}——那是在抄控制文件清单。` +
        `清单的单一真源是 hooks/lib/control-files.mjs`,
    )
  }
})

test('templates/ 下每个 .md 都对应 stages.json 的某个 produces', () => {
  // M2b Task 2：produces 现在有数组/对象两种形式（S2 是对象），flatMap 对对象值
  // 不展平，原地重算会静默产出一个混进对象的 Set，导致 has() 恒为 false。改用
  // producedNames(stages)（单一真源，已经走 expandProduces 认两种形式）。
  const produced = producedNames(stages)
  for (const f of readdirSync(url('templates')).filter((f) => f.endsWith('.md'))) {
    assert.ok(
      produced.has(f),
      `templates/${f} 不是任何阶段的 produces——要么阶段链漏了它，要么这个模板是孤儿`,
    )
  }
})

test('契约模板留出了 §5.3 要的修订块位置', () => {
  const text = readFileSync(url('templates/00-contract.md'), 'utf8')
  assert.match(text, /修订/)
})
