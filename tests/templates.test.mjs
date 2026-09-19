import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CONTROL_FILES } from '../hooks/lib/control-files.mjs'
import { validateState } from '../hooks/lib/state.mjs'

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
  const produced = new Set(Object.values(stages).flatMap((s) => s.produces ?? []))
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
