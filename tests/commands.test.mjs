import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CONTROL_FILES } from '../hooks/lib/control-files.mjs'
import { PLUGIN_PREFIX } from '../hooks/lib/decide.mjs'
import { TRUSTED_PREFIX } from '../hooks/lib/trusted.mjs'
import { producedNames } from '../hooks/lib/stages.mjs'

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

// M1a ⑦：at-backend / at-frontend 这些实现角色在第三层，at-pm 派不动它们。清单写
// 「PM 派 at-backend」会被 H1 正确地拒掉，而那次拒绝很容易被记成别的问题。
//
// ⚠️ 判据取的是 roster['at-pm'].can_delegate_to（下面 reachable 那一行），不是写死的
// 名单——这条注释原来写的是「at-pm 只能派 at-product / at-architect」，M2b Task 3 给
// at-pm 加了 at-qa / at-acceptance 两条边之后当场成了假话，而它是注释、一条测试都不会
// 因此变红（docs/11 §5.13）。**注释里不再复述那份清单**，要知道就读 roster.json。
//
// ⚠️ 评审发现：原来用 .find() 只看第一条命中行——at.md 里 at-backend/at-frontend
// 各自唯一的命中行（当时的原文是「你派不动 at-backend / at-frontend——花名册里 at-pm
// 只能派 at-product 与……」）恰好带着豁免词 at-product，.find() 拿到这一行就判过，不管
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
// `at-frontend`——执行角色在第三层」，它是在讲**派发拓扑**（可由 roster.json 推出、另有
// 一条测试守着），不是班底清单。那一行里最长的一段连续枚举恰好是 2 个名字，所以 2 会
// 误伤、3 不会。（M2b Task 3 修复轮 1 把那一行后半句「花名册里 at-pm 只能派 at-product
// 与 at-architect」删了——加边之后它成了假话——但前半句那两个名字没动，这条理由照旧。）
//
// ⚠️ 已知边界，写下来而不是假装没有：这条测试抓的是最自然的那种写法（也正是被删掉
// 的那一段的写法）。用「和」「与」连接、或者拆成多行 bullet 的枚举**抓不到**。控制方
// 问过能不能写出一条有甄别力的断言——这一条对它要防的回归（M2 加角色时有人回头在正文
// 里列一份名单）是真有甄别力的（变异验证：把删掉的那一句加回去 → 这条变红），但它不
// 是一道完备的防线，真正的保证是 /at 的收尾读 project.json 的 available_roles。
//
// ⚠️ 正则的**源文本**单独拎出来，两处各自 new 一个对象，不共享同一个正则实例。
// 带 `g` 的正则是有状态的：`.test()` 与 `.exec()`/`matchAll` 会推进 `lastIndex`。
// 下面那条自检如果直接拿 ROLE_LIST_RE 去 `assert.match`（内部走 `.test()`），
// 它会从上一次遗留的 lastIndex 往后找——做出的是一条**时好时坏**的锚点，跑第二次
// 就可能不匹配。自检用一份不带 `g` 的副本，两边都没有跨调用的状态。
const ROLE_LIST_SOURCE = '(?:`?at-[a-z][a-z0-9-]*`?\\s*[/、,，]\\s*){2,}`?at-[a-z][a-z0-9-]*`?'
const ROLE_LIST_RE = new RegExp(ROLE_LIST_SOURCE, 'g')

// 正向锚点，独立占一个 test()。
//
// 下面那条不变量是**纯否定断言**（有 match 就 assert.fail），正文干净时一个断言都
// 不执行——复评实跑证明：把 ROLE_LIST_RE 换成 /THIS_WILL_NEVER_MATCH_ANYTHING/g，
// 这个文件 14/14 全绿，那条测试什么都没在守。这是本分支为「否定断言没有正向锚点」
// 开的**第四轮**循环（Task 5 拆断言、Task 6 的 I-1 空断言、终审 I7，现在这条），
// 而同一个 commit 的邻居（「前置条件：命令正文里确实引用了插件自带的文件」↔
// 「必须带 ${CLAUDE_PLUGIN_ROOT} 前缀」）用的就是正确手法，这一条漏了。
//
// 样本用**顿号**形式，不用被删掉的那条斜杠形式——换一种分隔符能顺带证明这条判据
// 不是只认一种写法。
test('前置条件：ROLE_LIST_RE 认得出一份硬编码的角色名清单——否则下面那条否定断言恒绿', () => {
  const probe = '花名册里 `at-product`、`at-architect`、`at-backend` 这几个执行角色中'
  assert.match(
    probe,
    new RegExp(ROLE_LIST_SOURCE),
    `ROLE_LIST_RE 连这份明显是清单的样本都认不出来（${JSON.stringify(probe)}）——` +
      '下面那条「不得出现硬编码的角色名清单」是纯否定断言，判据失效时它不会报错，' +
      '只会一个断言都不执行然后全绿，跟正文真的干净长得一模一样',
  )
})

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
  // M2b Task 2：produces 现在有数组/对象两种形式（S2 是对象），flatMap 对对象值
  // 不展平，原地重算会静默产出一个混进对象的 Set，导致 has() 恒为 false。改用
  // producedNames(stages)（单一真源，已经走 expandProduces 认两种形式）。
  const produced = producedNames(stages)
  for (const f of FILES) {
    for (const a of new Set(textOf(f).match(/\b\d{2}-[a-z][a-z0-9-]*\.md\b/g) ?? [])) {
      assert.ok(produced.has(a), `commands/${f} 提到产物 ${a}，但它不是 stages.json 里任何阶段的 produces`)
    }
  }
})

test('命令正文里出现的每个 .agent-team 路径都是控制文件或 run 目录下的产物', () => {
  // M2b Task 2：produces 现在有数组/对象两种形式（S2 是对象），flatMap 对对象值
  // 不展平，原地重算会静默产出一个混进对象的 Set，导致 has() 恒为 false。改用
  // producedNames(stages)（单一真源，已经走 expandProduces 认两种形式）。
  const produced = producedNames(stages)
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

// ——— 命令之间的互相引用必须带插件命名空间 ———
//
// 插件组件的命名空间是**无条件**加的，不是只在撞名时才加。官方插件参考原文：
// 「This name is used for namespacing components. For example, in the UI, the agent
// `agent-creator` for the plugin with name `plugin-dev` will appear as
// `plugin-dev:agent-creator`.」
// 所以这四条命令的真实调用名是 `/agent-team:at-init`，不是 `/at-init`。
//
// 为什么要钉住：命令正文里到处是「让用户先跑 X」「回到 X 的第 3 节」这类互相引用。写成
// 裸名的话，PM 与用户照着敲会得到一个**按那个名字并不存在**的命令——与 stages.json 第一天
// 把 S5 的 role 写成花名册里没有的角色是同一个形状（docs/08 ②）：一条指向不存在之物的
// 跨文件引用，只有真有人敲进去才会暴露，而在那之前所有测试都是绿的。
//
// 前缀取自 hooks/lib/decide.mjs 的 PLUGIN_PREFIX，它由 tests/plugin-name-sync.test.mjs
// 钉死与 .claude-plugin/plugin.json 的 name 一致——插件改名时这三处一起动，不会分叉。
//
// ⚠️ 这条判据是文档结论，不是实测：本项目还没有在真实会话里敲过任何一条命令。
// docs/10 第 1 条负责核实文档与实际一致。

// `/` 后面至少要有一个词字符：命令正文里有一个单独的 `/`（讲路径分隔符的），不是命令引用。
// 每次调用新建一个 RegExp 对象：带 g 标志的正则共享 lastIndex，复用同一个对象会做出
// 时好时坏的断言——本仓库刚为这个坑栽过一次（见 b13612c）。
const slashTokenRe = () => /`\/([A-Za-z0-9][A-Za-z0-9:_-]*)/g

// ⚠️ 正向锚点。下面两条都是「不得出现 X」形状的断言——正文干净时它们一个断言都不执行，
// 判据写错了也照样全绿。本仓库为这个形状开过四轮循环（403dccb、Task 6 I-1、终审 I7、
// b13612c），规矩是：纯否定断言必须配一条自检，拿一个已知违规样本证明判据仍然认得出它。
test('前置条件：斜杠命令的判据认得出裸名引用——否则下面两条恒绿', () => {
  const sample = '让用户先跑 `/at-init`，然后 `/at <需求>`，再看 `/at-status`。'
  assert.deepEqual(
    [...sample.matchAll(slashTokenRe())].map((m) => m[1]),
    ['at-init', 'at', 'at-status'],
  )
})

test('命令正文里的斜杠命令引用必须带插件命名空间', () => {
  for (const f of FILES) {
    for (const [, token] of textOf(f).matchAll(slashTokenRe())) {
      assert.ok(
        token.startsWith(PLUGIN_PREFIX),
        `commands/${f} 引用了 \`/${token}\`——插件组件的命名空间是无条件加的，真实调用名是 ` +
          `\`/${PLUGIN_PREFIX}${token}\`。写裸名的话，照着敲会得到一个不存在的命令。`,
      )
    }
  }
})

test('命令正文引用的每条斜杠命令都真的存在于 commands/', () => {
  const known = new Set(FILES.map((f) => f.replace(/\.md$/, '')))
  for (const f of FILES) {
    for (const [, token] of textOf(f).matchAll(slashTokenRe())) {
      if (!token.startsWith(PLUGIN_PREFIX)) continue // 缺前缀由上一条报，这里只查名字
      const name = token.slice(PLUGIN_PREFIX.length)
      assert.ok(
        known.has(name),
        `commands/${f} 引用了 \`/${token}\`，但 commands/ 下没有 ${name}.md——` +
          `跨文件引用指向了一个不存在的命令`,
      )
    }
  }
})

// 终审发现 3：受信前缀（规格 §6.5）的单一真源是 hooks/lib/trusted.mjs 的 TRUSTED_PREFIX。
// 六份 agents/*.md 对它的引用由 tests/agents.test.mjs:91-95（从 trusted.mjs import 常量，
// 断言 bodyOf(f).includes(TRUSTED_PREFIX)）钉住，但 commands/at.md:41 与
// commands/at-init.md:42 各自硬编码了一份同样的字面量「agent-team 账本回传」，没有被
// 任何测试钉住。hooks/lib/trusted.mjs 头部注释自己写着「commands/at.md 与
// commands/at-init.md 的正文都引用了这个字符串」——模块知道这两份拷贝存在，却没有东西
// 保证它们同步。终审实测过：把 commands/at.md:41 的「账本回传」改成「账本回报」，
// `node --test` 仍然全绿（403/0），说明这份拷贝此前确实是自由漂移的。
//
// 手法照抄 tests/agents.test.mjs 那条：从 trusted.mjs import 常量，这里不写字面量；
// 断言正文 .includes(TRUSTED_PREFIX)——常量改了，这两份命令正文若没跟着改，这条测试会
// 先于人发现分叉。放在 commands.test.mjs（消费方的测试文件）而不是 trusted.test.mjs
// （真源自己的测试文件），是为了跟 agents.test.mjs 那条判据同一种手法：真源的测试只
// 验证真源自己（trusted.test.mjs 已经在做这件事），「谁引用了真源、引用对不对」这件事
// 该由引用方自己的测试文件钉住，与 tool-surface.test.mjs/command-tool-closure.test.mjs
// 分别守 agents/ 与 commands/ 自己的工具面是同一个道理。
//
// at-resume.md 与 at-status.md 不在这份清单里：grep 全仓库确认过它们的正文只是散文提及
// 「账本回传」这个概念（不带 `agent-team` 前缀，不是这个字面量的拷贝），.includes() 天然
// 不会命中，硬把它们塞进清单只会让断言对着一个从不成立的期望空转。
const FILES_WITH_TRUSTED_PREFIX = ['at.md', 'at-init.md']

test('commands/at.md 与 commands/at-init.md 的正文必须引用受信前缀——这是那两份硬编码拷贝唯一的机械保证', () => {
  for (const f of FILES_WITH_TRUSTED_PREFIX) {
    assert.ok(
      textOf(f).includes(TRUSTED_PREFIX),
      `commands/${f} 正文里没有引用受信前缀 ${JSON.stringify(TRUSTED_PREFIX)}——hooks/lib/` +
        'trusted.mjs 头部写着这份正文引用了这个字符串，但此前没有测试钉住，常量改了这里' +
        '不会跟着变',
    )
  }
})
