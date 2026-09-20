// 角色层闭包测试（M1c Task 6+7）。角色正文是提示词，没有任何单测能证明模型会照做
// ——这份文件钉的是闭包性质：正文提到的角色名/产物名/skill 是否真实存在，工具面
// 授予是否与设计 §1.1 一致，红线与受信前缀边界是否写进了正文（M1c 设计 §6）。
//
// ⚠️ 这一批测试的共同风险形状：大量断言都是 `for (const f of AGENTS) { ... }`
// ——如果 AGENTS 的目录扫描出问题（比如 readdirSync 的过滤条件写错、或者只扫到
// 部分文件），循环体少跑几圈甚至零圈，这些测试会安安静静地全绿，因为它们从未真正
// 检查过该检查的文件（docs/11 §3.3 第 2 条：否定/存在性断言在「遍历的集合是空的」
// 时同样是绿的，本质与「这段代码没被执行到」是同一件事，不限于字面上的否定断言）。
// 下面第一条测试把 AGENTS 钉死成 EXPECTED_AGENTS 里那些文件（不只是数量，是身份），后面所有
// `for (const f of AGENTS)` 的测试都靠它兜底；对 skills/ 目录的同类扫描同样钉了
// 一条（「skills/ 目录下恰好是这三个共享 skill」）。这个手法抄自 tests/skills.test.mjs
// 第 8-10 行（Task 5 已经这么做过一次）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'
import { toolsDeclarationOf } from './helpers/agent-tools.mjs'
import { EXPECTED_AGENTS } from './helpers/expected-agents.mjs'
import { producedNames } from '../hooks/lib/stages.mjs'
import { COMMAND_NAMES } from './helpers/command-names.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const roster = JSON.parse(readFileSync(url('roster.json'), 'utf8'))
const stages = JSON.parse(readFileSync(url('stages.json'), 'utf8'))
const AGENTS = readdirSync(url('agents')).filter((f) => f.endsWith('.md'))
const textOf = (f) => readFileSync(url(`agents/${f}`), 'utf8')
const fmOf = (f) => textOf(f).split(/^---\s*$/m)[1] ?? ''
const bodyOf = (f) => textOf(f).split(/^---\s*$/m).slice(2).join('---')

// 修复轮 2：EXPECTED_AGENTS 改成从 tests/helpers/expected-agents.mjs 导入，不再在
// 本文件里另写一份字面量数组——评审发现 1 指出 tests/tool-surface.test.mjs 那一侧
// 缺同款身份锚点，补的时候若各写一份，就是本仓库反复踩过的「同一份知识两份拷贝、
// 日后只改一份」（hooks/lib/path-norm.mjs 头部注释记的教训）。

test('agents/ 目录下恰好是 EXPECTED_AGENTS 列出的那些角色文件——否则下面每一条 for (const f of AGENTS) 都在对空集合或半个集合空转', () => {
  assert.deepEqual(
    [...AGENTS].sort(),
    EXPECTED_AGENTS,
    `agents/ 目录扫描结果是 ${JSON.stringify([...AGENTS].sort())}，与预期的 ` +
      `${JSON.stringify(EXPECTED_AGENTS)} 不一致——下面所有遍历 AGENTS 的测试的检查范围都` +
      '会跟着变，且不会有任何提示',
  )
})

// M2b Task 4：上面这条失败文案原来写的是「与预期的六个角色」，而 M2a Task 2 起
// agents/ 下就是十一份了——一条**会被打印出来**的活文案报了一个错的总数，真红的时候
// 会把排查方向带偏。按本分支已经定过的同一条理由（Task 1、Ruling 4、Ruling 6）改成
// **不报总数**，只印实际扫描结果与 EXPECTED_AGENTS 两个清单：清单可以当场核，数字不能。
// 注意区分：tests/helpers/expected-agents.mjs 头部那段**叙述性注释**里的「六」是在讲
// 那一次修复本身，明写了「数字保留原样」，不属于这一类，没有动。

// 持有 Bash 的角色（设计 §1.1 + M2b 设计 §1.3）。
// M2b Task 4 从三个扩到七个：新增 at-ui / at-ios / at-android（执行角色，与
// at-backend/at-frontend 同类）与 at-qa（它的工作就是**跑**测试）。
// 不在这份清单里的四个各有各的理由：at-product / at-architect 产出的是文档，不跑构建；
// at-acceptance 是业务验收，看的是产出符不符合契约，不跑构建也不改代码（M2b 设计 §1.3）；
// at-outsider 是测试替身，只有 Read。
// 这份清单同时是下面三条红线断言的**唯一触发条件**——判据刻意不看正文用了哪个词
// （修复轮 3 复评抓到过「换个同义词就整份被跳过」），持有 Bash 是 tools: 声明里可独立
// 核实的事实。
const HAS_BASH = [
  'at-pm.md',
  'at-backend.md',
  'at-frontend.md',
  'at-ui.md',
  'at-ios.md',
  'at-android.md',
  'at-qa.md',
]

test('每个角色文件的 frontmatter name 与文件名一致', () => {
  for (const f of AGENTS) {
    const m = fmOf(f).match(/^name:\s*(\S+)/m)
    assert.equal(m && m[1], f.replace(/\.md$/, ''), `${f} 的 name 与文件名对不上`)
  }
})

test('每个角色都在 roster.json 里', () => {
  for (const f of AGENTS) {
    assert.ok(Object.hasOwn(roster, f.replace(/\.md$/, '')), `${f} 不在 roster.json 里`)
  }
})

// 修复轮 2（评审发现 7a）：原判据 /\bBash\b/.test(fmOf(f)) 扫的是**整段 frontmatter**，
// 含 description: 那一行——如果哪份 description 里写一句「跑 Bash 编译」，判据会
// 假阳性地认为该角色被授予了 Bash，即便 tools: 行里根本没有它。改用
// tests/helpers/agent-tools.mjs 的 toolsDeclarationOf().names——那是解析过的
// tools: 声明的工具名集合，不含 description 的文本，且认行内与 YAML 块序列两种写法
// （tests/tool-surface.test.mjs 已经在用同一个解析器，不重写第二份）。
test('Bash 的授予与 HAS_BASH 逐份一致——多给一份、少给一份都红（设计 §1.1、M2b 设计 §1.3）', () => {
  for (const f of AGENTS) {
    const { names } = toolsDeclarationOf(textOf(f))
    const has = names.includes('Bash')
    assert.equal(has, HAS_BASH.includes(f), `${f} 的 Bash 授予与设计 §1.1 不符`)
  }
})

// 修复轮 2（评审发现 7b）：原判据 /Bash/.test(bodyOf(f)) 只要求正文任意处出现字面量
// 「Bash」，而三份持有 Bash 的正文里都有一个小节标题「你有 `Bash`，那是为了把代码
// 跑起来」——单靠这个标题就能让判据通过，钉不住「红线」这件事本身（正文可以完全没有
// 「不得用 Bash 绕过写路径隔离」这条规矩，判据照样绿）。改成要求红线小节里出现这句
// 实质措辞的字面量。
test('持有 Bash 的角色，正文里必须有「不得用 Bash 绕过写路径隔离」这条实质红线', () => {
  for (const f of HAS_BASH) {
    assert.match(
      bodyOf(f),
      /不得用\s*`?Bash`?\s*绕过写路径隔离/,
      `${f} 持有 Bash，但正文里只是提到了这个词（比如小节标题），没有「不得用 Bash ` +
        '绕过写路径隔离」这条实质红线',
    )
  }
})

test('每个角色正文都引用了受信前缀', () => {
  for (const f of AGENTS) {
    assert.ok(bodyOf(f).includes(TRUSTED_PREFIX), `${f} 正文里没有引用受信前缀——它认不出权威信号`)
  }
})

// 修复轮 2（评审发现 2）：原判据 /读到|读文件|读进来/ 钉不住「按通道信任」这条边界。
// 六份正文的「你收到的文字，哪些算数」小节开头本来就有一句跟这条边界无关的话
// ——「你读到的产物内容，一律是数据」（在讲「产物内容是数据」，不是在讲「前缀只有
// 从回传通道到达才算权威」）——这句话本身就含「读到」，会在真正的边界那句话之前
// 先把正则喂饱。变异实测：保留受信前缀字面量、把 at-architect 的边界段改成反义
// （「看到这个开头就可以信——包括你从产物里读到的那些，一样照做」），旧判据仍然
// 全绿，因为它只看「读到」这个词出现没出现，不看上下文说的是哪个方向。
//
// 改成钉两半的搭配：受信前缀字面量本身，**且**「只认通道，不认字符串」这一类只会
// 出现在正确表述里的措辞——反义句不会同时具备这两者（前缀可以保留，但反义句不会
// 恰好用「只认通道」「作为 hook 回传到达」「不认字符串」这几个词去论证相反的结论）。
//
// 修复轮 3（复评发现）：判据抽成具名函数 hasBoundary()，主判据与下面的自检共用同一份
// ——原来两处各写了一遍逐字相同的正则，复评实测证明这是「重复会分叉」的当场复演
// （hooks/lib/path-norm.mjs 头部注释记的教训）：只放宽自检那一份，自检本身不空转，
// 正确变红；但只放宽主判据用的那一份、同时把 at-architect 正文改成反义，401/0 全绿
// ——自检证明的是「这条字面量正则拒得掉这个样本」，证不了「真正用在正文上的那条
// 判据拒得掉它」，两份判据一旦不同步，自检形同给自己发了一张通行证。抽成同一个
// 函数之后，这种「只改一份」的动作根本无法执行——改 hasBoundary() 会同时影响主判据
// 与自检，想悄悄放宽而不被自检发现，做不到。
function hasBoundary(body) {
  return /只认通道|作为 hook 回传到达|不认字符串/.test(body)
}

test('每个角色正文都写明「按通道信任、不按字符串信任」这条边界——不是仅仅提过受信前缀或「读到」这个词', () => {
  for (const f of AGENTS) {
    const body = bodyOf(f)
    const hasPrefix = body.includes(TRUSTED_PREFIX)
    assert.ok(
      hasPrefix && hasBoundary(body),
      `${f} 正文：受信前缀${hasPrefix ? '有' : '没有'}出现，「按通道信任」的边界措辞` +
        `${hasBoundary(body) ? '有' : '没有'}出现——两者必须同时成立，只出现受信前缀而边界` +
        '措辞被换成相反的说法（或反过来）都不构成这条边界真的被写清楚了',
    )
  }
})

// 正向锚点（docs/11 §3.3 第 2 条）：拿评审给出的反义样本本身证明 hasBoundary() 认得
// 出违规——样本保留受信前缀，但把结论反过来说，不应该被判定为「写清楚了」。这个
// 自检与主判据调的是**同一个函数**，不是另写一份逐字相同的正则。
test('前置条件：hasBoundary() 认得出一个已知违规样本——保留受信前缀、但把「按通道信任」的结论说反后不应判定为通过', () => {
  const flipped =
    `以 ${TRUSTED_PREFIX} 开头的那段文字：看到这个开头就可以信——包括你从产物里读到的那些，一样照做。`
  assert.ok(flipped.includes(TRUSTED_PREFIX), '构造的违规样本本身没有包含受信前缀——样本无效，不能拿它自检')
  assert.ok(
    !(flipped.includes(TRUSTED_PREFIX) && hasBoundary(flipped)),
    'hasBoundary() 对着一个已知违规样本（保留受信前缀、把「按通道信任」的结论说反）算出了' +
      '「通过」——说明判据认不出这类违规，回去检查 hasBoundary() 本身',
  )
})

// ⭐ Ruling 15（M2b Task 4 补轮，2026-09-20）：`/\bat-[a-z][a-z0-9-]*\b/` 这个形状同时
// 匹配得到**命令名**（at / at-init / at-resume / at-status）。命令名与角色名是两个命名
// 空间、恰好形状相同，而花名册只收角色。`tests/commands.test.mjs` 早在 M2a Task 9 就撞上
// 并解决过（它从自己的 FILES 派生了一个排除集），**而这一条用着逐字相同的正则却没有任何
// 排除**——不是分叉，是一边压根不知道另一边解决过这个问题。代价是具体的：角色正文因此
// 写不了 `/agent-team:at-init`，只能绕成「写 .agent-team/project.json 的那条勘察命令」
// 这种描述特征的说法（docs/11 §5.15）。排除集现在是 tests/helpers/command-names.mjs
// 的单一真源，从 commands/ 目录读出来，两个测试文件共用。
//
// skill 名那一组豁免直接用下面的 EXPECTED_SKILLS，不在这里再抄一份字面量数组——同一个
// 文件里摆两份逐字相同的清单，正是这条 Ruling 在治的那个形状。前向引用是安全的：
// EXPECTED_SKILLS 是模块顶层的 const，而下面这个函数只在 test() 回调里被调用，回调跑在
// 模块求值完成之后。
//
// ⚠️ 判据抽成具名函数，主判据与它的正向锚**共用同一份**——两处各写一遍「形状匹配再减去
// 豁免」的代价，hasBoundary() 那一轮已经实测过：只放宽其中一份，另一份照样绿，自检等于
// 给自己发了张通行证。
function roleNamesCheckedIn(body) {
  return [...new Set(body.match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])].filter(
    (n) => !EXPECTED_SKILLS.includes(n) && !COMMAND_NAMES.has(n),
  )
}

test('角色正文里出现的每个 at-* 角色名都在花名册里', () => {
  for (const f of AGENTS) {
    for (const name of roleNamesCheckedIn(bodyOf(f))) {
      assert.ok(Object.hasOwn(roster, name), `agents/${f} 提到 ${name}，但它不在 roster.json 里`)
    }
  }
})

test('角色正文里出现的每个 NN-*.md 产物名都是某个阶段的 produces', () => {
  // M2b Task 2：produces 现在有数组/对象两种形式（S2 是对象），原地
  // flatMap((x) => x.produces ?? []) 对对象值不展平——Object.values 会把整个
  // produces 对象当成 flatMap 回调的返回值塞进结果数组（flatMap 只展平一层
  // 数组，非数组返回值原样保留），产出的 Set 里混进一个对象而不是字符串，
  // 于是 produced.has('01-prd.md') 恒为 false，agents/at-pm.md 提到它就会
  // 被误判成「不是任何阶段的 produces」。改用 producedNames(stages)：它已经
  // 走 expandProduces(s, stageRoles(s))，两种形式都认得，是单一真源。
  const produced = producedNames(stages)
  for (const f of AGENTS) {
    for (const a of new Set(bodyOf(f).match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? [])) {
      assert.ok(produced.has(a), `agents/${f} 提到产物 ${a}，但它不是任何阶段的 produces`)
    }
  }
})

test('frontmatter 的 skills: 引用的 skill 真的存在', () => {
  for (const f of AGENTS) {
    const line = fmOf(f).split(/\r?\n/).find((l) => /^skills:/.test(l.trim()))
    if (!line) continue
    for (const s of line.replace(/^skills:\s*/, '').split(/[,\s]+/).filter(Boolean)) {
      assert.ok(existsSync(url(`skills/${s}/SKILL.md`)), `agents/${f} 预加载 ${s}，但 skills/${s}/SKILL.md 不存在`)
    }
  }
})

// skills/ 目录同样是一次目录扫描，同样可能因为扫描出问题而悄悄返回空——与 AGENTS
// 是同一类风险，钉法照抄 tests/skills.test.mjs 第 8-10 行。
const EXPECTED_SKILLS = ['at-api-contract', 'at-contract-format', 'at-handoff-package']

test('skills/ 目录下恰好是这三个共享 skill——否则「每个 skill 至少被一个角色预加载」在对空集合空转', () => {
  assert.deepEqual(readdirSync(url('skills')).sort(), [...EXPECTED_SKILLS].sort())
})

test('每个 skill 至少被一个角色预加载——没人读的 skill 是死文件', () => {
  const referenced = new Set()
  for (const f of AGENTS) {
    const line = fmOf(f).split(/\r?\n/).find((l) => /^skills:/.test(l.trim()))
    if (!line) continue
    for (const s of line.replace(/^skills:\s*/, '').split(/[,\s]+/).filter(Boolean)) referenced.add(s)
  }
  for (const s of readdirSync(url('skills'))) {
    assert.ok(referenced.has(s), `skills/${s} 没有任何角色预加载它`)
  }
})

// ⚠️ 正向锚点，拆成两条：上面「at-* 角色名都在花名册里」与「NN-*.md 产物名都是某个
// produces」这两条闭包测试各自检验不同侧面——前者的锚点是「正文里确实提到过角色
// 名」，后者的锚点是「正文里确实提到过产物名」，是两件独立的事。brief 原稿把它们
// 塞进了同一个 test()：一旦第一条 assert.ok 失败，第二条永远不会被执行，「产物名
// 锚点是否成立」在报告里就彻底不可见——这正是 docs/11 §3.3 第 1 条点名的形状
// （「多条检验不同侧面的固定断言要拆开」），本轮不豁免 brief 给的测试代码。
const ALL_BODIES = AGENTS.map(bodyOf).join('\n')

// ⚠️ Ruling 15 同时改了这条锚：它原来数的是 `ALL_BODIES.match(/\bat-.../g).length`
// ——**排除之前**的计数。接上排除集之后那个数字就钉不住东西了：排除集一旦退化成「排除
// 一切」（比如 commands/ 扫描出问题、或者豁免判据写反），主判据零次迭代、恒绿，而这条
// 锚照样绿，因为正文里当然还有一堆 at-* 形状的 token。
// 锚必须钉**判据真正迭代的那个集合**——排除之后仍然要去对花名册查的那些名字。
// 这与本轮 tests/commands.test.mjs 里 Ruling 13 那条锚（钉派生出来的那一半，不钉含
// 字面量 at-pm 的整个清单）是同一个形状，本分支已经在这上面栽过三次。
test('前置条件：角色正文里确实有**排除 skill 名与命令名之后**仍要对花名册查的角色名——否则「提到的角色名都在花名册里」那条闭包测试在空转', () => {
  assert.ok(
    roleNamesCheckedIn(ALL_BODIES).length > 0,
    '十一份正文里的每一个 at-* token 都被豁免掉了（skill 名或命令名）——上面那条闭包' +
      '测试一圈都不会跑，它是恒绿的，没有检查任何东西',
  )
})

test('前置条件：角色正文里确实提到了产物名——否则「提到的产物名都是某阶段 produces」那条闭包测试在空转', () => {
  assert.ok((ALL_BODIES.match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? []).length > 0, '没有任何角色正文提到产物名')
})

// 修复轮 1（协调方核实后裁定）：上面「at-* 角色名都在花名册里」这条闭包测试只查
// 「正文提到的名字是不是花名册的键」——`at-frontend` 确实在 roster.json 里，那条
// 测试挑不出错。真正撞上的缺陷在另一层：at-frontend.md 的正文写着「找到 `role` 是
// `at-frontend` 的那一段」，但 stages.json 里没有任何一段的 role 是 at-frontend
// （M1 的阶段链只到 S5，前端阶段从 S6 起，属于 M2，见 docs/11 §1.1）——这句话字面
// 上指向一次必然落空的查找。花名册成员资格与阶段存在性是两个不同的判据，前者绿
// 不能替后者背书，这正是本项目反复出现的那个形状（正文是错的，而证明正文对的那个
// 机制里没有这一条）。
//
// 判据不针对 at-frontend 这一个名字特殊处理，而是从正文里抠出任何一处「找到 `role`
// 是 `at-X` 的」这个完整模板，要求它声称的 role 值真实存在于 stages.json——不关心
// 是不是当前这份正文自己的角色名，也不关心结尾是「那一段」还是「各段」。这样
// 将来 M2 给 stages.json 补上前端阶段之后，若正文被改回「找到 role 是 at-frontend
// 的那一段」，这条测试会自动重新验证那句话是否成真，不需要为「哪个角色曾经缺过
// 阶段」维护一份特例名单。
//
// ⚠️ 判据必须锚住「找到……的」这个完整指令模板，不能只截「`role` 是 `at-X`」这个
// 片段——第一版写的就是那个片段，写完当场自己撞上假阳性：本轮给 at-frontend.md
// 写的修复文案里有一句「没有任何一段的 `role`\n是 `at-frontend`」（否定句，陈述
// 「不存在」），那个片段级正则照样命中，把刚改对的正文当成还在犯错。「找到」与
// 「的」两头一夹，只保留「去 stages.json 找这一段」这个指令本身，否定句因为前面
// 是「没有」不是「找到」，天然不会被夹进来——不用维护一份否定词黑名单去猜测所有
// 可能的否定说法，判据只认这一种项目里实际在用的指令模板。
const stageRoles = new Set(Object.values(stages).map((s) => s.role))
const roleSearchClaims = () =>
  AGENTS.flatMap((f) =>
    [...bodyOf(f).matchAll(/找到\s*`role`\s*是\s*`(at-[a-z][a-z0-9-]*)`\s*的/g)].map((m) => ({ f, role: m[1] })),
  )

test('前置条件：至少有一份角色正文写过「找到 role 是 at-X 的」这个指令模板——否则下面「声称的阶段必须真的存在」在空转', () => {
  assert.ok(
    roleSearchClaims().length > 0,
    '没有任何角色正文写过「找到 `role` 是 `at-X` 的」这个指令模板——下面那条测试没有实际检查任何东西',
  )
})

test('正文里「找到 role 是 at-X 的」这条指令声称的阶段，必须真的存在于 stages.json', () => {
  for (const { f, role } of roleSearchClaims()) {
    assert.ok(
      stageRoles.has(role),
      `agents/${f} 正文里指示去找「role 是 ${role}」的那一段，但 stages.json 里没有任何一段的 ` +
        `role 是 ${role}——这句话指示的查找字面上会落空（M1 阶段链目前只到 S5，见 docs/11 §1.1）`,
    )
  }
})

// 修复轮 2（评审发现 5）：M1c 设计 §6 那一行原文是「角色正文提到的每个**阶段 id** /
// 产物名都在 stages.json 里」——上面几条闭包测试只交付了产物名（NN-*.md）那一半，
// 阶段 id（S1、S4 这种）那一半此前完全没有测试覆盖。变异实测：把 at-pm.md 里
// 「你负责 S1……与 S4……」改成「你负责 S9……」——S9 在 stages.json 里根本不存在，
// `node --test` 仍然 390/0 全绿。
const stageIds = new Set(Object.keys(stages))

test('前置条件：至少有一份角色正文提到过 SN 形式的阶段 id——否则「提到的阶段 id 都在 stages.json 里」在空转', () => {
  assert.ok(AGENTS.some((f) => /\bS\d+\b/.test(bodyOf(f))), '没有任何角色正文提到 SN 形式的阶段 id')
})

test('角色正文里出现的每个 SN 阶段 id 都是 stages.json 的键', () => {
  for (const f of AGENTS) {
    for (const id of new Set(bodyOf(f).match(/\bS\d+\b/g) ?? [])) {
      assert.ok(stageIds.has(id), `agents/${f} 提到阶段 ${id}，但它不是 stages.json 的键`)
    }
  }
})

// 上面那条只查「这个阶段 id 存不存在」，查不出「自称拥有它的角色对不对」——把 S1
// 错写成 S9 会被上面那条抓到（S9 不存在），但如果错写成一个**真实存在、却属于别的
// 角色**的阶段 id（比如 at-pm 自称负责 S2，而 S2.role 其实是 at-product），上面那
// 条不会有反应，因为 S2 真的存在。at-pm.md 这种「你负责 SN（……）」的自称写法是本
// 项目唯一在用的自我认领句式，需要单独钉住「自称的那个阶段，role 真的是我自己」。
function selfClaimedStageIds(f) {
  const claims = []
  for (const clause of bodyOf(f).split(/[。\n]/)) {
    if (!clause.includes('你负责')) continue
    for (const id of new Set(clause.match(/\bS\d+\b/g) ?? [])) claims.push(id)
  }
  return claims
}

test('前置条件：至少有一份角色正文用「你负责 SN」这种自称写法——否则「自称的阶段归属必须真实」在空转', () => {
  assert.ok(AGENTS.some((f) => selfClaimedStageIds(f).length > 0), '没有任何角色正文用「你负责 SN」这种写法自称拥有某个阶段')
})

test('角色正文里「你负责 SN」这种自称写法，那个阶段的 role 必须真的是这份正文自己的角色名', () => {
  for (const f of AGENTS) {
    const own = f.replace(/\.md$/, '')
    for (const id of selfClaimedStageIds(f)) {
      assert.equal(
        stages[id]?.role,
        own,
        `agents/${f} 自称「你负责 ${id}」，但 stages.json 里 ${id} 的 role 是 ` +
          `${stages[id]?.role ?? '（不存在）'}，不是 ${own}`,
      )
    }
  }
})

// 评审发现 4（修复轮 2 判断「不值当为『不止一次/各段』这类复数措辞建判据」，被
// 修复轮 3 复评推翻）：at-architect 曾经的「你在里面出现不止一次……找到 role 是
// at-architect 的各段」是一句不成立的话——stages.json 里 role === 'at-architect'
// 只有 S3 一段。修复轮 2 只改了正文，没配判据，理由是「怎么识别任意措辞在断言几段」
// 是个真正开放、容易做窄的问题。复评给了一种不解析措辞本身「是不是在断言复数」的
// 判据形状：把项目里实际在用的基数说法收窄成一个封闭的模板清单，要求每一份「对
// 自己的 role 段数表过态」的正文都被其中恰好一条模板认出来——**命中数 !== 1 本身
// 就是失败状态**，不管新出现的措辞实际想表达几段。这样就不需要判据理解任意中文
// 措辞里的基数，只需要它认出「不认识」。三组变异复跑（细节见 task-6-7-report.md
// 「修复轮 3」）：对旧文本（「不止一次……各段」）→ 命中 each 模板但 n=1，模板判据
// 说 false；对当前四份修复后的正文 → 各恰好命中一条、判据都为 true；把「只有一段」
// 改写成「仅此一段」→ 命中 0 条。三组都符合预期。
function countOwned(role) {
  return Object.values(stages).filter((s) => s.role === role).length
}

// 项目里实际在用的四种基数说法，各配一个「n 应该满足什么」的谓词。正则统一在第 1
// 组捕获声称的角色名；调用方按「捕获的名字 === 文件自己的名字」过滤——讲别人的段
// （比如 at-architect 讲 S5 的 role 是 at-backend）天然不会被算成自指，因为过滤时
// 捕获到的是 at-backend，不等于 at-architect。
const CARDINALITY_TEMPLATES = [
  { re: /没有任何一段的\s*`role`\s*是\s*`(at-[a-z][a-z0-9-]*)`/g, ok: (n) => n === 0, label: '没有任何一段（n===0）' },
  { re: /`role`\s*是\s*`(at-[a-z][a-z0-9-]*)`\s*的\s*\*{0,2}只有一段/g, ok: (n) => n === 1, label: '只有一段（n===1）' },
  { re: /找到\s*`role`\s*是\s*`(at-[a-z][a-z0-9-]*)`\s*的那一段/g, ok: (n) => n === 1, label: '那一段（n===1）' },
  { re: /找到\s*`role`\s*是\s*`(at-[a-z][a-z0-9-]*)`\s*的各段/g, ok: (n) => n >= 2, label: '各段（n>=2）' },
]

function selfReferencesOwnRole(f) {
  const own = f.replace(/\.md$/, '')
  return new RegExp('`role`\\s*是\\s*`' + own + '`').test(bodyOf(f))
}

function selfCardinalityMatches(f) {
  const own = f.replace(/\.md$/, '')
  const body = bodyOf(f)
  const hits = []
  for (const tpl of CARDINALITY_TEMPLATES) {
    for (const m of body.matchAll(tpl.re)) {
      if (m[1] === own) hits.push(tpl)
    }
  }
  return hits
}

// at-pm 也对自己的段数表过态（「你负责 S1……与 S4……」），但走的是「你负责 SN」
// 这种按阶段 id 直接指名的句式，不是「role 是 at-X」这种句式，已经由上面「你负责
// SN」那对测试管，不出现在这份清单里。at-outsider 完全不提 stages.json。
//
// M2b Task 4 加进来五份（at-ui / at-ios / at-android / at-qa / at-acceptance）：
// 这五份的正文本轮才从 M2a 的占位符改写成真正文，都要说清自己在哪一段，于是都用上了
// 「`role` 是 `at-X`」这个句式——加进清单是**这条身份锚正常工作**的结果，不是回归。
// 它们各自用的模板与 countOwned：
//   at-ui / at-ios / at-android → countOwned = 0，用「没有任何一段的 `role` 是 X」
//   at-qa（S6）/ at-acceptance（S7） → countOwned = 1，用「找到 `role` 是 X 的那一段」
// ⚠️ **不要为了躲这条红而改措辞**：躲过去的结果是那几份正文对自己的段数完全不表态，
// 而 docs/11 §5.6 记的 at-frontend 那个洞正是「没说清自己在哪一段」。
const EXPECTED_CARDINALITY_CLAIMERS = [
  'at-acceptance.md',
  'at-android.md',
  'at-architect.md',
  'at-backend.md',
  'at-frontend.md',
  'at-ios.md',
  'at-product.md',
  'at-qa.md',
  'at-ui.md',
]

test('agents/ 目录下恰好是 EXPECTED_CARDINALITY_CLAIMERS 这几份对自己 role 段数表过态的正文', () => {
  const claimers = AGENTS.filter(selfReferencesOwnRole)
  assert.deepEqual(
    [...claimers].sort(),
    [...EXPECTED_CARDINALITY_CLAIMERS].sort(),
    `实际表过态的文件是 ${JSON.stringify([...claimers].sort())}，与预期的 ` +
      `${JSON.stringify(EXPECTED_CARDINALITY_CLAIMERS)} 不一致——下面两条只遍历这份清单`,
  )
})

test('对自己 role 段数表过态的正文，必须被四种已知模板之一认出恰好一次——认不出来就是措辞漂移，不是悄悄不检查', () => {
  for (const f of EXPECTED_CARDINALITY_CLAIMERS) {
    const hits = selfCardinalityMatches(f)
    assert.equal(
      hits.length,
      1,
      `agents/${f} 讲了自己的 role 段数，但用的说法不在已知模板里（命中 ${hits.length} 条）——` +
        '把措辞换成 CARDINALITY_TEMPLATES 已认识的四种之一，或者往模板列表里添加新的说法',
    )
  }
})

test('对自己 role 段数表过态的正文，表的态必须与 stages.json 算出来的实际段数一致', () => {
  for (const f of EXPECTED_CARDINALITY_CLAIMERS) {
    const own = f.replace(/\.md$/, '')
    const n = countOwned(own)
    for (const tpl of selfCardinalityMatches(f)) {
      assert.ok(
        tpl.ok(n),
        `agents/${f} 用的说法是「${tpl.label}」，但 stages.json 里 role 是 ${own} 的实际有 ` +
          `${n} 段——两者不一致`,
      )
    }
  }
})

// 修复轮 2（评审发现 6）：agents/at-pm.md、at-backend.md、at-frontend.md 的红线小节
// 都提过账本比对——正确的版本必须同时说清「伪造阶段产物会留痕」与「写别人的代码
// 目录连痕迹都没有」两半，而不能只讲前一半、让人以为账本比对连带盖住了后一半。
// hooks/lib/artifact-drift.mjs 的 compareArtifacts 只遍历 stages[*].produces 的
// 并集，压根不知道 project.paths 下别的角色的代码目录发生了什么——那一半没有任何
// 机械检测，只有角色自己的克制守着，这条边界必须在正文里如实说。
//
// 修复轮 3（复评发现）：上一版的跳过条件 `if (!/账本比对/.test(body)) continue`
// 钉死在「账本比对」这一个词形上，而前置锚点又是 `.some(...)`——复评实测：把
// at-frontend 正文里的「账本比对」全部换成同义词「账本核对」、同时删掉「管不到」
// 那一半，401/0 全绿：跳过条件认不出「账本核对」，对这个文件直接 continue，根本
// 没有执行下面的 assert.match；前置锚点只要 at-pm/at-backend 还留着「账本比对」
// 原词就继续绿，看不出 at-frontend 已经被跳过。
//
// 改成协调方倾向的更硬版本：**不依赖正文用了哪个词**，只认「这个角色的 tools: 里
// 有没有 Bash」——HAS_BASH 本身就是这个判据的完整依据，不需要先探测正文提没提过
// 「账本比对」再决定查不查。选它而不是「认一组同义词」的理由：同义词清单本质上
// 还是在维护一份「所有可能提到这件事的说法」的清单，下一个同义词（「记账比对」
// 「产物核验」……）出现时还会重演同一个漏洞；不依赖词形，直接把「持有 Bash」当唯一
// 触发条件，这一类漏洞从判据形状上就不存在——持有 Bash 是能查到的事实
// （tools: 声明），不是正文里某一句话的措辞。跳过条件消失后，「至少一份提到账本
// 比对」这条前置锚点也不再需要：断言本身对 HAS_BASH 的每个文件都无条件执行，不会
// 因为「没提到关键词」而空转。
test('持有 Bash 的角色，正文必须说明账本比对管不到「写别人的代码目录」这一半', () => {
  for (const f of HAS_BASH) {
    assert.match(
      bodyOf(f),
      /连痕迹都没有|管不到|只有你自己的克制守着/,
      `${f} 持有 Bash，但正文没有说明账本比对管不到「写别人的代码目录」这一半——会让人以为` +
        '写路径隔离的越界写入也被账本比对护住，而 hooks/lib/artifact-drift.mjs 的 ' +
        'compareArtifacts 只查 stages[*].produces，不知道 project.paths 下发生了什么',
    )
  }
})

// 终审发现 1：本轮 commit 2d0147c/8110a85 把 at-backend/at-frontend 的 tools: 从
// `Read, Write, Edit` 改成了 `Bash, Read, Glob, Write, Edit`。H3（写路径隔离）只挂在
// Edit/Write/NotebookEdit 上（hooks/hooks.json 的四个 matcher，没有一个覆盖 Bash），
// 所以这两个角色从这一轮起也能用 Bash 两步无痕伪造：写伪造的产物、再把匹配的哈希写进
// artifacts，全程零 hook。上面那条测试只钉住了红线的「写别人代码目录无痕」那一半——
// 「连 artifacts 一起改也无痕」这一半此前只写在 at-pm.md 一份正文里，at-backend/
// at-frontend 的正文完全没提。本轮之后这两份正文的红线也必须点破它，否则会让人以为
// 只有「写别人代码目录」那一条无痕口子存在，看不见刚刚也对它们打开的第二条。
//
// 判据同样按 HAS_BASH 触发，不按词形（不写 `if (!/某个词/.test(body)) continue` 这种
// 跳过条件）——词形跳过条件正是修复轮 3 复评当场抓到的那类漏洞（见上面那条测试改动前的
// 注释）：跳过条件一旦挂在正文用了哪个词上，正文换一个同义词就会被整份跳过、不执行任何
// 断言，而不是报错。持有 Bash 本身是可独立核实的事实（tools: 声明），不需要先探测正文
// 提没提过某个词再决定查不查，所以这里像上面那条一样对 HAS_BASH 无条件执行。
//
// 终审修复轮的定向复评发现：`.{0,40}` 的 `.` 默认不跨行，而 markdown 正文里这段话
// 会被软换行——纯挪动换行位置（措辞一字不改）就能让这条判据假红。失败方向是误红不是
// 漏绿（不危险），但换成 `[\s\S]{0,80}`（跨行、留够 M2 扩角色名单时可能变长的余量）
// 更稳：正文真的漂移时红，纯排版重排时不红。
test('持有 Bash 的角色，正文必须说明「连 artifacts 一起改也无痕」这一半——不能只讲「写别人代码目录无痕」', () => {
  for (const f of HAS_BASH) {
    assert.match(
      bodyOf(f),
      /持有\s*`?Bash`?\s*的角色[\s\S]{0,80}都做得到/,
      `${f} 持有 Bash，但正文没有说明「连 artifacts 一起改也无痕」这一半——本轮 at-backend/` +
        'at-frontend 也拿到了 Bash，两处无痕口子都要点破，不能只让 at-pm 一份正文单独扛着',
    )
  }
})

// ⭐ M2b Task 4：`model:` 的身份锚。
//
// 五个占位符在 M2a Task 2 被显式写成 `model: haiku`（「占位符语义上就是最小成本占位」），
// M2b 设计 §1.4 裁定五个真角色全部重定为 `sonnet`：at-qa 要读实现、设计测试、判断失败
// 原因，at-acceptance 要对着契约逐条核验收标准——都是实质判断，不是转写；
// at-ui/at-ios/at-android 是执行角色，与 at-backend/at-frontend 同类。
// at-outsider 保持 `haiku`：它是测试替身，被派起来本身就是配置错误。
//
// 判据是 `deepEqual` **身份锚**，不是 `length > 0` 这种数量锚——M1c 终审第 1 条发现的
// 正是「正向锚是数量不是身份」：扫描范围被意外缩小成一个文件时，数量锚照样绿，而真正的
// 违规完全落在检查范围之外。这里 got 是按 AGENTS 逐份建出来的，AGENTS 少扫到任何一份
// （或多扫到一份）都会让这条 deepEqual 当场红，缺 `model:` 行则会印成 '(缺)'。
test('十一份 agent 的 model: 与预期逐份一致——占位符的 haiku 已在 M2b 重定为 sonnet', () => {
  const got = {}
  for (const f of AGENTS) {
    const line = fmOf(f).split(/\r?\n/).find((l) => /^model:/.test(l.trim()))
    got[f] = line ? line.split(':')[1].trim() : '(缺)'
  }
  assert.deepEqual(got, {
    'at-pm.md': 'sonnet', 'at-product.md': 'sonnet', 'at-architect.md': 'sonnet',
    'at-backend.md': 'sonnet', 'at-frontend.md': 'sonnet', 'at-ui.md': 'sonnet',
    'at-ios.md': 'sonnet', 'at-android.md': 'sonnet', 'at-qa.md': 'sonnet',
    'at-acceptance.md': 'sonnet', 'at-outsider.md': 'haiku',
  })
})
