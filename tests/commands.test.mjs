import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CONTROL_FILES } from '../hooks/lib/control-files.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const readJson = (p) => JSON.parse(readFileSync(url(p), 'utf8'))
const roster = readJson('roster.json')
const stages = readJson('stages.json')
const stateTemplate = readJson('templates/state.json')
const FILES = ['at.md', 'at-init.md', 'at-resume.md', 'at-status.md']
const textOf = (f) => readFileSync(url(`commands/${f}`), 'utf8')

test('四条命令都在，没有多余的', () => {
  assert.deepEqual(readdirSync(url('commands')).sort(), [...FILES].sort())
})

// 拆成两条：brief 原稿是一个 for 循环里连着两句检验不同事情的 assert（有没有
// frontmatter、frontmatter 里有没有 description）。两句形状不同，不是同一个不变量
// 按数据遍历——同一文件的第一句先炸，这一文件的第二句、以及循环里排在它后面的其它
// 三个文件（两句都）会在这一轮里完全没机会跑。四条命令彼此独立，一条的 frontmatter
// 坏掉不该连带盖住另一条缺 description 这种不相关的事——这正是本仓库栽过两次的
// 归因遮蔽形状（见 403dccb），拆开让每句只守自己的不变量。
test('每条命令都有 frontmatter', () => {
  for (const f of FILES) {
    assert.match(textOf(f), /^---\r?\n/, `${f} 没有 frontmatter`)
  }
})

test('每条命令的 frontmatter 都有 description', () => {
  for (const f of FILES) {
    assert.match(textOf(f), /^description:/m, `${f} 的 frontmatter 缺 description`)
  }
})

// 规格 §6.1：这三个工具一律不授予。命令不该自己另开一条口子。
test('命令的 frontmatter 不得声明 Skill / SendMessage / ListAgents', () => {
  for (const f of FILES) {
    for (const bad of ['Skill', 'SendMessage', 'ListAgents']) {
      assert.doesNotMatch(
        textOf(f).split(/^---\s*$/m)[1] ?? '',
        new RegExp(`\\b${bad}\\b`),
        `${f} 的 frontmatter 提到了 ${bad}（规格 §6.1：一律不授予）`,
      )
    }
  }
})

// M1a ② 的形状：stages.json 第一天就把 S5 的 role 写成花名册里不存在的角色，
// 直到有真实派发撞上 H1 才会被发现。命令正文是第三个引用角色名的地方。
//
// ⚠️ Task 9 实现时发现：/\bat-[a-z][a-z0-9-]*\b/ 这个形状同时匹配得到命令自己的名字
// （at-init/at-resume/at-status——FILES 去掉 .md 后缀就是它们）。四条命令的正文会
// 互相提「跑 /at-init」「回到 /at 的第 3 节」这类合法的命令间引用，那不是角色名，
// 是命令名——两个命名空间形状恰好相同，但花名册只收角色。命令自己的名字不该被当成
// 角色名去对花名册查——排除掉这个集合。
const COMMAND_NAMES = new Set(FILES.map((f) => f.replace(/\.md$/, '')))
test('命令正文里出现的每个 at-* 角色名都在花名册里', () => {
  for (const f of FILES) {
    for (const name of new Set(textOf(f).match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])) {
      if (COMMAND_NAMES.has(name)) continue
      assert.ok(Object.hasOwn(roster, name), `commands/${f} 提到 ${name}，但它不在 roster.json 里`)
    }
  }
})

// M1a ⑦：at-pm 只能派 at-product / at-architect，at-backend 在第三层。
// 清单写「PM 派 at-backend」会被 H1 正确地拒掉，而那次拒绝很容易被记成别的问题。
//
// ⚠️ 评审发现：原来用 .find() 只看第一条命中行——at.md 里 at-backend/at-frontend
// 各自唯一的命中行（「你派不动 at-backend / at-frontend——花名册里 at-pm 只能派
// at-product 与……」）恰好带着豁免词 at-product，.find() 拿到这一行就判过，不管
// 文件里其它位置还有没有真违规行。评审实测：把一句真违规加在这行之后，.find() 还是
// 只看到这行、全绿；加在这行之前才会红——测试的抓力因此是位置相关的，而不是内容
// 相关的。改成遍历全部命中行，每一行独立过豁免判断，不再取决于加在哪个位置。豁免词
// 表另加了「派不动」「只能派」，直接对应「说明为什么不能直接派」这类行本身的措辞，
// 不再依赖这行恰好也提到 at-product 这个巧合。
//
// ⚠️⚠️ M1b 终审 I3：豁免表原来是 /at-architect|at-product|经|转|派不动|只能派/，
// 「经」与「转」是**裸字**，会被「已经」「经过」「转述」这类常用词命中——整张豁免表
// 被一个汉字击穿。实测：往 at.md 追加「契约**已经**定好了，这一步直接用 `Agent` 工具
// 派 `at-backend` 去写后端代码。」→ 304 pass / 0 fail；去掉「已经」两字的同一句 →
// 303/1。而且当时这条测试在 at.md 上只跑到 2 次断言（at-backend/at-frontend，同一行），
// 两次都命中豁免——它对 at.md **一个非豁免行都没判过**。
// 两个裸字直接删掉，只留不会被常用词误命中的四项：「派不动」「只能派」已经覆盖了
// 「说明为什么不能直接派」这类行本身的措辞，正文不需要靠「经/转」来豁免。
test('/at 不得指示 PM 直接派 at-pm 派不动的角色', () => {
  const t = textOf('at.md')
  const reachable = new Set(roster['at-pm'].can_delegate_to)
  for (const name of new Set(t.match(/\bat-[a-z][a-z0-9-]*\b/g) ?? [])) {
    if (name === 'at-pm' || reachable.has(name)) continue
    const lines = t.split(/\r?\n/).filter((l) => l.includes(name) && /派|dispatch|Agent/.test(l))
    for (const line of lines) {
      assert.ok(
        /at-architect|at-product|派不动|只能派/.test(line),
        `commands/at.md 有一行像是让 PM 直接派 ${name}：「${line.trim()}」——` +
          `at-pm 的 can_delegate_to 只有 ${[...reachable].join('、')}，H1 会拒`,
      )
    }
  }
})

// M1b 终审 I4 ⑤：「commands/ 正文里不得出现硬编码的角色名清单」。
//
// 判据是**语法形状**，不是语义：连续 ≥3 个角色名、中间只隔列表分隔符（/、、、,、，）
// 与空白/反引号/换行——那就是一份**枚举清单**，不是散文里提到角色。分散提及天然不
// 匹配，因为散文会在两个名字之间插入文字。
//
// 为什么阈值是 3 而不是 2：commands/at.md 有一行合法的说明「你派不动 `at-backend` /
// `at-frontend`——花名册里 `at-pm` 只能派 `at-product` 与 `at-architect`」，它是在讲
// **派发拓扑**（可由 roster.json 推出、另有一条测试守着），不是班底清单。那一行里最长
// 的一段连续枚举恰好是 2 个名字，所以 2 会误伤、3 不会。
//
// ⚠️ 已知边界，写下来而不是假装没有：这条测试抓的是最自然的那种写法（也正是被删掉
// 的那一段的写法）。用「和」「与」连接、或者拆成多行 bullet 的枚举**抓不到**。控制方
// 问过能不能写出一条有甄别力的断言——这一条对它要防的回归（M2 加角色时有人回头在正文
// 里列一份名单）是真有甄别力的（变异验证：把删掉的那一句加回去 → 这条变红），但它不
// 是一道完备的防线，真正的保证是 /at 的收尾读 project.json 的 available_roles。
const ROLE_LIST_RE = /(?:`?at-[a-z][a-z0-9-]*`?\s*[/、,，]\s*){2,}`?at-[a-z][a-z0-9-]*`?/g
test('commands/ 正文里不得出现硬编码的角色名清单——班底要从 project.json 读', () => {
  for (const f of FILES) {
    for (const m of textOf(f).matchAll(ROLE_LIST_RE)) {
      assert.fail(
        `commands/${f} 里写死了一份角色名清单：「${m[0].replace(/\s+/g, ' ')}」。` +
          '可用班底的真源是 .agent-team/project.json 的 available_roles（规格 §7.1，' +
          '由 /at-init 写）——正文里写死一份，M2 加角色那天 /at 会静默漏算，' +
          '而漏算的表现正是规格 §4.2 ④ 引用的那条：某个角色整个项目从未被调用，' +
          '且无人发现。',
      )
    }
  }
})

// 承重假设，记了三次从未被回答（docs/02 P0-#1/#2、docs/03 P0-3、docs/04 §6 开放
// 问题 3）：**插件根在会话工作目录之外**。命令正文里引用插件自带的文件（templates/、
// stages.json、roster.json）时若写裸相对路径，PM 会按会话工作目录去解析，什么都读
// 不到——而读不到模板的 PM 会照自己的记忆编一份 state.json，这在会话里长得跟正常
// 完全一样（M1b 终审 C3）。唯一的定位方式是 ${CLAUDE_PLUGIN_ROOT}。
//
// ⚠️ 这条测试只证明「正文写对了前缀」，**不证明 PM 真的读得到那个文件**——那需要
// 真实环境，见 docs/10 第 8 条。
const PLUGIN_OWNED = ['stages.json', 'roster.json', 'templates/']
const pluginSpansOf = (f) =>
  [...textOf(f).matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1])
    .filter((span) => PLUGIN_OWNED.some((p) => span.includes(p)))

// 正向锚点单独占一个 test()：下面那条是「每一个都要带前缀」，一条都没有时它零次
// 迭代、恒绿——空集合天然满足全称命题，这正是本仓库反复栽的形状。
test('前置条件：命令正文里确实引用了插件自带的文件——否则下面那条前缀测试在空转', () => {
  const total = FILES.reduce((n, f) => n + pluginSpansOf(f).length, 0)
  assert.ok(
    total > 0,
    `commands/ 下没有任何反引号路径提到 ${PLUGIN_OWNED.join(' / ')}——` +
      '下面那条测试一次都不会真正执行断言，通过是假的',
  )
})

test('命令正文引用插件自带的文件时必须带 ${CLAUDE_PLUGIN_ROOT} 前缀', () => {
  for (const f of FILES) {
    for (const span of pluginSpansOf(f)) {
      assert.ok(
        span.startsWith('${CLAUDE_PLUGIN_ROOT}/'),
        `commands/${f} 用裸相对路径引用了插件自带的文件：\`${span}\`。` +
          '插件目录不在用户项目里，裸相对路径按会话工作目录解析，PM 读不到它——' +
          '而读不到模板/阶段链的 PM 会自己编一份，失效形式是「看起来正常」。' +
          '写成 ${CLAUDE_PLUGIN_ROOT}/' + span,
      )
    }
  }
})

test('命令正文里出现的每个 NN-*.md 产物名都是 stages.json 的 produces', () => {
  const produced = new Set(Object.values(stages).flatMap((s) => s.produces ?? []))
  for (const f of FILES) {
    for (const a of new Set(textOf(f).match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? [])) {
      assert.ok(produced.has(a), `commands/${f} 提到产物 ${a}，但它不是 stages.json 里任何阶段的 produces`)
    }
  }
})

test('命令正文里出现的每个 .agent-team 路径都是控制文件或 run 目录下的产物', () => {
  const produced = new Set(Object.values(stages).flatMap((s) => s.produces ?? []))
  const ok = (rel) =>
    CONTROL_FILES.some((c) => new RegExp(`^${c.replace('*', '[^/]+')}$`).test(rel)) ||
    /^runs\/[^/]+\/?$/.test(rel) ||
    [...produced].some((p) => rel.endsWith(p))
  for (const f of FILES) {
    for (const m of new Set(textOf(f).match(/\.agent-team\/[A-Za-z0-9_./<>-]+/g) ?? [])) {
      const rel = m.replace('.agent-team/', '').replace(/[.]$/, '')
      assert.ok(
        ok(rel.replace(/<run[_-]?id>/g, 'RID')),
        `commands/${f} 提到 ${m}，它既不是控制文件（hooks/lib/control-files.mjs）` +
          `也不是 stages.json 的 produces`,
      )
    }
  }
})

// ⚠️ Task 9 实现时发现：原正则 /state\.json\s*的\s*`([a-z_]+)`/ 在四条命令的正文里
// 一次都不会匹配——正文一律把 state.json 自己也包在反引号里，紧跟在「json」后面的是
// 反引号而不是空白，\s* 跳不过那个反引号。加一个可选反引号修好了这个 0 匹配的假通过，
// 但评审指出覆盖面仍然太窄：三份文件里反引号包裹的字段名引用共 22 处，只够到 5 处
// ——原正则要求字段名紧跟在「state.json 的」后面，但 at.md §1 是「先提一次
// state.json，冒号后面顺着列 6 个字段」的写法，字段名和「state.json」本身并不相邻；
// history 在全文单独出现的次数也远不止「state.json 的 history」这一种写法。
//
// 改成：按空行切块，块里只要提到 state.json，就把块内所有反引号包裹、形状像字段名
// （纯小写字母加下划线——00-contract.md / at-product / Glob / S1 这类明显不是字段名
// 的写法各自带点号、连字符、大写字母，天然被这个形状过滤掉，不需要额外处理）的
// token 都当候选查一遍。
//
// 这样做会顺带捞到几个「形状像字段、又跟 state.json 挨在同一段，但其实不是 state.json
// 自己的顶层字段」的词，逐一核对过，显式豁免，不算进判定：
//   - slug：run id 格式里的一段（YYYYMMDD-HHmm-<slug>），根本不是字段。
//   - subagent_type：Agent 工具的参数名，跟 state.json 无关，只是说明写在同一段列表里。
//   - kind：escalations[] 每条记录自己的字段（规格 §5.3 的五类取值），不是 state.json
//     的顶层字段——两者经常在同一句话里一起出现（「往 state.json 的 escalations 追加
//     一条……kind 用上表里的取值」），位置上分不开，只能显式豁免。
//   - produces：stages.json 每个阶段自己的字段，不是 state.json 的字段——「把
//     state.json 的 stage 那一段的 produces」这句话里两者也挨在一起。
//   - available_roles：**project.json** 的字段（规格 §7.1 的「可用班底」），不是
//     state.json 的。两者必然出现在同一段里，因为 /at 的收尾正是拿它减去 state.json
//     的 roster 算出 never_invoked（M1b 终审 I4）。⚠️ 它和 state.json 的 roster 语义
//     不同，别把两个名单混成一个：available_roles 是「这个项目有哪些角色可用」
//     （配置，/at-init 写一次），roster 是「这一趟真正叫到了谁」（运行时逐段累加）。
const STATE_JSON_BLOCK_NON_FIELDS = new Set([
  'slug',
  'subagent_type',
  'kind',
  'produces',
  'available_roles',
])
test('/at 与 /at-resume 提到的 state.json 字段都在模板里', () => {
  const known = new Set(Object.keys(stateTemplate))
  for (const f of ['at.md', 'at-resume.md', 'at-status.md']) {
    for (const block of textOf(f).split(/\r?\n\s*\r?\n/)) {
      if (!block.includes('state.json')) continue
      for (const m of block.matchAll(/`([a-z_]+)`/g)) {
        const name = m[1]
        if (STATE_JSON_BLOCK_NON_FIELDS.has(name)) continue
        assert.ok(known.has(name), `commands/${f} 提到 state.json 的 ${name}，但模板里没有这个字段`)
      }
    }
  }
})

// docs/04 §9 ②：H3/H4/H5b 的拒绝父级只有转述，没有硬证据。PM 判断「这一段完成
// 没完成」必须 stat 磁盘，不能靠对话记忆或子代理回报。四条命令都要写明这一条。
test('每条命令都写明「核实磁盘，不信子代理自述」', () => {
  for (const f of FILES) {
    assert.match(textOf(f), /磁盘/, `commands/${f} 没有提到要核实磁盘`)
  }
})

test('/at 写明了五类升级条件的 kind 取值', () => {
  const t = textOf('at.md')
  for (const k of ['sensitive', 'contract-conflict', 'tradeoff', 'contract-hole', 'budget-exhausted']) {
    assert.ok(t.includes(k), `commands/at.md 没有写 escalations 的 kind 取值 ${k}`)
  }
})
