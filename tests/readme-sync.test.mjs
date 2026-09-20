// 两份 README 与两份插件清单 —— 它们是陌生人读到的第一份东西，而在 M2c 之前
// 它们是这个仓库**最后一块完全没有守卫的散文**。
//
// 为什么需要这一份（M2c）：
//
// 两份 README 是 M0（9/15）写的，当时插件只有六个 agent、链止于 S5、`at-pm` 的
// `tools:` 里还没有 `Bash`/`Write`/`Edit`。到 M2b 收口时，它们里面至少有四处断言
// 已经与仓库现状对不上，其中最贵的一处是**把有风险的说成没风险**：
// 「`at-pm` 的工具面只有 `Agent(...)`、`Read`、`Glob`，所以它在无关项目里干不了
// 正常工作」——而今天被接管的那个会话拿着 `Bash` + `Write` + `Edit`。那句话所在
// 的整节恰恰是陌生人用来判断「装上它安不安全」的那一节。
//
// 四处里没有一处会让任何测试变红。这正是 `docs/16` 方法论那一节反复记的那件事：
// **一句会过期的话，只有被判据钉住才不会过期。** 本文件把 README 里可机械核的
// 那几类断言逐类接上真源。
//
// 写法仿 `tests/stages-readme.test.mjs`（从散文里抽清单、对真源比、每条抽取器
// 配一条正向自检锚）与 `tests/plugin-name-sync.test.mjs`（「两个源头必须保持
// 一致」的独立小文件）。**抽取器一律写成本文件内的具名函数，主判据与锚共用
// 同一份**——`docs/16` §3.2：锚要钉在判据真正进入 `assert` 的那一层。
//
// ⚠️ **本文件钉的是「可机械核的那一半」，不是正文的论证。** 上面那处最贵的过期，
// 真正错的是论证（「工具面窄 ⇒ 接管的代价有限」），而论证不可机械核。可机械核的
// 是**论证的前提**：那一段有没有把 `at-pm` 真实的工具面一个不漏地写出来。下面
// 「`at-pm` 工具面」那条钉的就是它——前提一旦重新变假，论证会跟着红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { toolsDeclarationOf } from './helpers/agent-tools.mjs'
import { EXPECTED_AGENTS } from './helpers/expected-agents.mjs'
import { ROLES_WITHOUT_PATHS } from './helpers/roles-without-paths.mjs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8')

const README_EN = 'README.md'
const README_ZH = 'README.zh-CN.md'
// 四份「对外表面」文件：两份 README 加两份清单。角色数那条断言四份都写了。
const OUTWARD_FILES = [README_EN, README_ZH, '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']

const STAGES = JSON.parse(read('stages.json'))
const STAGE_IDS = Object.keys(STAGES)

// ---------------------------------------------------------------------------
// 一、两份 README 的小节标题一一对应（互为真源）
// ---------------------------------------------------------------------------
//
// 两份 README 今天内容一一对应，M2c 之前**没有任何东西保证它继续对应**。实际的
// 失效形式已经在仓库里出现过：中文那份的 `## Development` 与 `## License` 两个
// 小节标题从 M0 起就没翻译过——两份的结构一致、文字不一致，而这种不一致只有人
// 逐行比才看得见。
//
// 跨语言的「对应」没有单一真源可派生：`Installation` 与「安装」谁也推不出谁。
// 所以这里把**配对本身**写成一张表——它就是那条对应关系的真源，两份 README 是
// 它的两半。改任何一份而不改另一份，这条当场红。
const HEADING_PAIRS = [
  ['# agent-team', '# agent-team'],
  ['## Installation', '## 安装'],
  ['## Known Limitations', '## 已知边界'],
  ['## Development', '## 开发'],
  ['## License', '## 许可'],
]

// 抽标题时要跳过围栏代码块：安装那一节里有一个 ```sh 块，将来有人往里写一行以
// `#` 开头的 shell 注释，不跳围栏就会把它当成一个小节标题抠出来。
function headingsOf(text) {
  const out = []
  let inFence = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s/.test(line)) out.push(line.trim())
  }
  return out
}

// ⭐ 正向自检锚：钉的是**抽取器本身**，不是它今天在真实文件上算出来的清单。
// 钉在合成样本上（手法同 tests/stages-readme.test.mjs 的 H5a 表自检），免得
// 自检自己变成两份 README 的第三份拷贝。
test('自检：headingsOf() 抽得出标题、且跳得过围栏代码块里以 # 开头的行', () => {
  const sample = ['# 标题', '正文', '```sh', '# 这是 shell 注释，不是小节标题', '```', '## 小节', '### 更深一层'].join(
    '\n',
  )
  assert.deepEqual(headingsOf(sample), ['# 标题', '## 小节', '### 更深一层'])
})

test('README.md 的小节标题序列与配对表的英文那一半逐条一致', () => {
  assert.deepEqual(
    headingsOf(read(README_EN)),
    HEADING_PAIRS.map(([en]) => en),
    '两份 README 是互为真源的镜像：改了一份的小节结构，另一份与本文件的 HEADING_PAIRS 要一起改',
  )
})

test('README.zh-CN.md 的小节标题序列与配对表的中文那一半逐条一致', () => {
  assert.deepEqual(
    headingsOf(read(README_ZH)),
    HEADING_PAIRS.map(([, zh]) => zh),
    '两份 README 是互为真源的镜像：改了一份的小节结构，另一份与本文件的 HEADING_PAIRS 要一起改',
  )
})

// ---------------------------------------------------------------------------
// 二、「十角色」—— 真源是 agents/ 下的角色文件减去测试替身
// ---------------------------------------------------------------------------
//
// `docs/16` §3.1 的规矩是「列举，不报总数」：数字不可核。**但它给的判据是
// 「能不能用一条写得下来的命令核出来」**——角色数正好能，所以这里选的是
// 「加判据」那一条路，不是「删掉数字」。
//
// 测试替身要不要算进「这支团队有几个角色」：不算。`at-outsider` 在 `agents/` 下
// 有文件、在花名册里也真实存在，但它不在任何 `can_delegate_to` 里、也不在
// `templates/project.json` 的 `available_roles` 里——它是**被派起来本身就是配置
// 错误**的那个角色（`tests/agents.test.mjs` 把它的模型钉在 `haiku` 时写的就是
// 这个理由）。对外说「十角色」说的是这支团队，不是 `agents/` 的文件数。
//
// ⚠️ 这里有一个字面量（`at-outsider`），而本仓库对字面量清单的纪律是「从数据
// 派生，不硬编码」。它留在这里的代价由下面两条兜住：
//   - 「清单里的名字都真的存在」——清单停在旧值（比如替身改了名）时红；
//   - 「交叉核」——产品角色集合同时要等于 `settings.json` 的 `agent` 加上
//     `templates/project.json` 的 `available_roles`。**两条互相独立的派生对不上
//     就红**，所以往 `agents/` 里加一个真角色而忘了把它写进班底，不会静默。
const TEST_DOUBLE_ROLES = ['at-outsider']
const PRODUCT_ROLES = EXPECTED_AGENTS.map((f) => f.replace(/\.md$/, '')).filter(
  (r) => !TEST_DOUBLE_ROLES.includes(r),
)

test('前置条件：TEST_DOUBLE_ROLES 里的每个名字都真的在 agents/ 下——清单停在旧值时这条红', () => {
  const missing = TEST_DOUBLE_ROLES.filter((r) => !EXPECTED_AGENTS.includes(`${r}.md`))
  assert.deepEqual(
    missing,
    [],
    '测试替身清单里有 agents/ 下不存在的名字：它已经不再从角色数里被减掉了，而「十角色」那句话会跟着漂',
  )
})

test('交叉核：产品角色 = settings.json 的 agent + templates/project.json 的 available_roles', () => {
  const settings = JSON.parse(read('settings.json'))
  const project = JSON.parse(read('templates/project.json'))
  assert.deepEqual(
    [...PRODUCT_ROLES].sort(),
    [...new Set([settings.agent, ...project.available_roles])].sort(),
    'agents/ 减去测试替身，与「主会话角色 + 可用班底」两个真源算出来的对不上——' +
      '往 agents/ 里加了真角色却没写进 available_roles，或者反过来。先确认哪一侧漏了，' +
      '再决定对外那句角色数要不要跟着改',
  )
})

// 「N 角色 / N-role」这个形状的断言。词表只认写得出的那几个数——写了一个表里
// 没有的词（比如「十个角色」这种换了说法的），这条抽取器返回空，下面那条「四份
// 文件都写了角色数」的锚当场红。**静默放宽在这里是不可能的**：主判据遍历抽出来
// 的断言，而锚遍历的是文件清单，两条迭代的层不同。
const ROLE_COUNT_WORDS = new Map([
  ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12], ['thirteen', 13],
  ['八', 8], ['九', 9], ['十', 10], ['十一', 11], ['十二', 12], ['十三', 13],
])

function roleCountClaims(text) {
  const out = []
  for (const m of text.matchAll(/([A-Za-z]+|\d+)-role\b/g)) out.push(m[1])
  for (const m of text.matchAll(/([一二三四五六七八九十]+|\d+)角色/g)) out.push(m[1])
  return out.map((w) => ROLE_COUNT_WORDS.get(w.toLowerCase()) ?? (/^\d+$/.test(w) ? Number(w) : null))
}

// ⭐ 正向自检锚：钉判据函数本身——两种写法都认得，光秃秃的 `role`/`角色` 不算
// 断言（否则每一句提到角色的话都会被当成一个数字断言），形状对上而词表里没有的
// 写法要显式落成 null 而不是被悄悄丢掉。
//
// ⚠️ 还有一种落不进这个形状的写法（「十个角色」这类中间插了量词的），抽取器
// **一个都抠不出来**。那不是漏网：上一层的锚（「四份对外文件都真的写了角色数」）
// 遍历的是文件清单，不是抽出来的断言，所以那种改写会在锚那一层红。两条判据
// 迭代的层不同，正是 `docs/16` §3.2 那条规矩要的效果。
test('自检：roleCountClaims() 认得出英文与中文两种写法，且不把光秃秃的「角色」算成断言', () => {
  assert.deepEqual(
    roleCountClaims('a ten-role team, 十角色, 11-role, 十一角色, 每个角色, each role, a fifteen-role team'),
    [10, 11, null, 10, 11],
  )
})

test('四份对外文件都真的写了角色数——否则下一条在空清单上空转', () => {
  for (const f of OUTWARD_FILES) {
    assert.ok(
      roleCountClaims(read(f)).length > 0,
      `${f} 里一条角色数断言都抠不出来：要么那句话被删了，要么它换了一种 roleCountClaims() ` +
        '不认得的写法——后一种会让下一条判据静默空转',
    )
  }
})

test('四份对外文件写的角色数都等于 agents/ 下的产品角色数', () => {
  for (const f of OUTWARD_FILES) {
    for (const n of roleCountClaims(read(f))) {
      assert.equal(
        n,
        PRODUCT_ROLES.length,
        `${f} 对外说的角色数与 agents/ 下的产品角色（${PRODUCT_ROLES.join('、')}）对不上。` +
          '改数字之前先确认是角色真的增减了，还是对外那句话本来就该换成列举',
      )
    }
  }
})

// ---------------------------------------------------------------------------
// 三、`at-pm` 的工具面 —— 真源是 agents/at-pm.md 的 tools: 行
// ---------------------------------------------------------------------------
//
// **这是本文件最要紧的一条。** M0 写下的那句「`at-pm` 的工具面只有 `Agent(...)`、
// `Read`、`Glob`」，在 M1c 给 `at-pm` 加上 `Bash`/`Write`/`Edit` 的那一刻起就是
// 假的，而且假在**把有风险的说成没风险**这一侧——`docs/16` §3.7 记的那条
// （「把已经做到的说成没做到」比「把真的说成假的」更贵）的镜像。
//
// 钉法是**集合相等**，不是「危险的那几个有没有被点名」：后者在 `at-pm` 新拿到
// 一个工具时不会红（只要旧的那几个还在）。集合相等则是双向的——多写一个不存在
// 的工具也红。
//
// 定位判据用的是「引用块里提到 `at-pm` 的那一段」，不是「第二段引用块」：
// 按位置定位正是 `docs/16` §3.1 那三条细则（行号、序号、总数）判死的那一族。
// ⚠️ 触发条件本身可以被措辞绕开（`docs/16` §3.2 第四条）——有人把那一段改写成
// 不出现 `at-pm` 四个字，这里就抠出空串。那不会静默：空串里一个工具名都没有，
// 集合相等当场红。
function limitationsBlock(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('>'))
    .join('\n')
}

function atPmParagraph(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('>') && l.includes('at-pm'))
    .join('\n')
}

// 反引号 span 里、去掉括号参数之后形如工具名的 token。`Agent(...)` 取 `Agent`，
// `at-pm` / `--plugin-dir` / `project.json` 这些不是工具名的 token 被首字母大写
// 这条形状挡掉。判据只扫反引号包住的 span，与 `docs/11` §2 第 7 条记的那条已知
// 边界同款（没加反引号的工具名它抓不到）。
function toolTokensIn(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].split('(')[0].trim())
    .filter((t) => /^[A-Z][A-Za-z]*$/.test(t))
}

const AT_PM_TOOLS = toolsDeclarationOf(read('agents/at-pm.md')).names

// ⭐ 正向自检锚：钉抽取器本身，钉在合成样本上。同时证明它**认得出哪一段**——
// 不含 `at-pm` 的那一段引用块里的工具名不能混进来。
test('自检：atPmParagraph() + toolTokensIn() 只从提到 at-pm 的那段引用块里抠工具名', () => {
  const sample = [
    '## Known Limitations',
    '',
    '> 另一段边界，提到 `NotebookEdit` 与 `at-qa`，但不提那个主会话角色。',
    '',
    '> 加载本插件会把主会话交给 `at-pm`，它的工具面是 `Bash`、`Read` 与 `Agent(agent-team:at-qa)`。',
    '',
    '不在引用块里的一行，提到 `Grep`。',
  ].join('\n')
  assert.deepEqual(toolTokensIn(atPmParagraph(sample)), ['Bash', 'Read', 'Agent'])
})

test('前置条件：agents/at-pm.md 的 tools: 解得出非空的工具名清单', () => {
  assert.ok(
    AT_PM_TOOLS.length > 0,
    'agents/at-pm.md 的 tools: 声明解出来是空的——下面那条集合相等会拿一个空集合去比，' +
      '而真正该报的是这份声明本身读不出来',
  )
})

for (const f of [README_EN, README_ZH]) {
  test(`${f} 的已知边界那一节把 at-pm 的工具面一个不漏地写出来了`, () => {
    assert.deepEqual(
      [...new Set(toolTokensIn(atPmParagraph(read(f))))].sort(),
      [...new Set(AT_PM_TOOLS)].sort(),
      `${f} 写的 at-pm 工具面与 agents/at-pm.md 的 tools: 行对不上。` +
        '⚠️ 这一节是陌生人用来判断「装上它安不安全」的那一节，而它在 M0 到 M2b 之间' +
        '一直把风险说小了（写着工具面只有 Agent/Read/Glob，实际有 Bash+Write+Edit）。' +
        '**不要只把工具名单改齐**：那一段的论证靠的就是这份名单，名单变了要回去确认' +
        '「接管的真实代价是什么」那句话还成不成立',
    )
  })
}

// ---------------------------------------------------------------------------
// 四、阶段链的端点 —— 真源是 stages.json 的键
// ---------------------------------------------------------------------------
//
// 两份 README 写的是「一趟完整的 run 沿阶段链从 S1 走到 S8」。M0 写这两份文件
// 时链止于 S5，M2a 才接到 S8——同一句话在 M0 与今天是两个不同的真值。
//
// README 是对外表面，不该抄一份阶段链（那会是第二份真源，`docs/11` §5.18 C1 就是为
// 这个判的「不补 S6–S8 的逐段正文」）。所以这一节钉的是**端点**。
//
// ## ⚠️ 这一节被重写过一次，原因值得逐字记下来——它是本任务照出来的一个新形状
//
// **第一版判据把整份文件收敛成一个去重序列，只取首尾**：
//
//     function stageIdsIn(text) {
//       return [...new Set([...text.matchAll(/`(S\d+)`/g)].map((m) => m[1]))]
//     }
//     assert.deepEqual([named[0], named.at(-1)], [STAGE_IDS[0], STAGE_IDS.at(-1)])
//
// 它在**只有一句话提阶段编号**的时候是对的。M2c 后来往 `Status:` 那一行里又写了一次
// `S1`–`S8`——**那是一句真话**，而它正好把序列的尾巴顶回 `S8`。从那一刻起，标语那一句
// 里的 `S8` 改成 `S5`（**M0 当年真实的过期值，也正是这个任务存在的理由**）
// **整套全绿**：那个 `S5` 既不是首个新编号、也不是最后一个，落在中间被静默。
//
// 时间旅行核过（评审用 `git show` 逐版本跑的同一刀）：`Status:` 还是 `M0 — …`
// （不含任何阶段编号）的那个版本上，同一刀抠出 `['S1','S5']`，**红**；
// 加进那句真话之后抠出 `['S1','S8']`，**绿**。
//
// > **不是「散文过期了」，不是「锚钉错了半边」，是「加进去一句真话，让一句假话变得
// > 测不出来」——因为判据是收敛的，不是迭代的。**
//
// 为什么隔壁那条角色数（第二节 B）没被同样弄坏：**B 遍历抠出来的每一条断言，
// 这一条取首尾**。第一版的注释里已经写出了这个区别，**但没有把它推到「所以 D 会被
// 第二份拷贝掩盖」这一步**。
//
// ## 重写之后的形状：逐行迭代，不收敛
//
// 抽取器**按行**返回，整份文件不再被压成一个序列。
//
// ## ⚠️ 第二轮：同一个形状在**锚**那一层原样复活过一次（评审 F6）
//
// 上面那次重写之后，两条主判据确实是逐条迭代的了，**但配给它们的那条锚仍然是收敛的**
// ——它把每一行的编号 `flatMap` 成一个集合，再问「两个端点都在不在这个集合里」。
// 实测：只把标语那句的 `` to `S8` `` 换成 `onward`（**链端点那句话被删掉了**），
// **全绿**；标语与 `Status:` 两处**都**不再提 `S8` 时，锚才红。
//
// > **锚只在最后一份拷贝消失时才说话，而把它顶绿的正是 `Status:` 行里那句真话
// > ——与上一轮那次一字不差的机制，只是下移了一层。**
//
// ⚠️ **而当时写下的两处断言都是假的，这一条比行为本身更该记**：
//
// 1. 锚自己的注释写着「文件里一个阶段编号都没有时……**而那恰恰意味着这句话被整个
//    删掉了**」——后半句不成立：那句话可以被整个删掉而锚照样绿。
// 2. 「盖不住的那一半」那段把它说成结构性的：「要管住后者**只能**钉第几行怎么写」。
//    **不是「只能」。** 在只有一份拷贝的文件上，逐行的判据本来就管得住；
//    **当时管不住是第二份拷贝造成的**，不是判据的固有上限。
//
// **第 2 条是上一轮那次「无条件」的同一个推理错误**：把**第二份拷贝造成的盲区**
// 写成**判据的固有上限**。同一个错误在它自己那一次的修复里又犯了一遍——**两次都是
// 写下了一个判断而没有去验它。**
//
// ## 今天的形状：三条，全部逐行/逐编号，没有一条跨行取并集
//
//   · **每一个编号都得是端点之一** —— 迭代**每一个编号**；
//   · **每一行只要提了阶段编号，写的就得是那两个端点、按顺序、不多不少**
//     —— 迭代**每一行**，`deepEqual` 整行的编号序列；
//   · **锚：至少有一行完整写出了那两个端点** —— 逐行判定后取存在量词。
//
// 第二条是这一轮的要害：它把「这一行说了一半」判成违规，所以
// 「`from `S1` to onward`」当场红，**不再依赖别的行有没有说对**。
//
// ⚠️ 锚仍然只回答「这份文件还谈不谈这条链」，**不回答「哪一句在谈」**——但它已经不是
// 收敛式的了：它逐行判定、任何一行独立满足即可，不把不同行的值揉在一起。真正钉住
// 「那句话还在」的是第二条。
//
// ⚠️ 这三条比第一版**严**：README 里提不了中间阶段（写 `S3` 红），也不能只提一个端点。
// **有意的**——要在对外表面上写中间某一段、或者只提半条链的那一天，红的那一刻正是该
// 停下来想「要不要在这里造第二份阶段链」的时刻（`docs/11` §5.18 C1）。
//
// ⚠️ **今天仍然盖不住的**：把那句话改写成**一个阶段编号都不提**（「走到独立的验收
// 轨道」），三条都不会红——那一行不再进入任何一条的迭代，而锚被另一行满足。
// **这一条是第二份拷贝造成的，不是结构上不可能**：两份 README 各自只有一处提链时，
// 文件里不再出现 `S8`，端点锚当场红；有第二份拷贝时另一份把它顶绿。
//
// 要在**有第二份拷贝**的前提下也管住，需要的是**让锚也逐处迭代，而不是取并集**
// ——**与这一轮主判据的修法是同一条**。定位「哪一处」至少有两条路：
//
//   · **按行号定位**（「第几行必须怎么写」）——那是 `docs/16` §3.1 判死的那一族，不走；
//   · **按内容定位**：例如要求「**声称一趟完整 run 的那句话**」与「**`Status:` 那一行**」
//     **各自**独立含两个端点——判据键在**这句话是什么**，不在它是第几行，
//     因而也不受第二份拷贝影响（它要求**每一处**都说全，不是**并集**说全）。
//
// ⚠️ **第二条路本轮没有实现、没有验过**，这里只记为一条**可选路径**，不是「这样做就
// 管得住」。**这一整段本身就是一条能力断言**，而本文件为「写下判断却没有去验」这个
// 形状已经连栽两轮（上一轮的「无条件」、这一轮的「只能钉第几行」）——所以未验的那半
// 必须逐字标出来，不能写成结论。
//
// ⚠️ **行内不去重**（评审 F7）：上一版每行 `new Set`，于是
// 「`` from `S1` to `S1` ``」被塌成 `['S1']`——逐编号那条过（`S1` 是端点）、跨度那条
// 因为长度不足 2 **整条跳过**，**全绿**，而那是一句货真价实的假话，也是改端点时最自然
// 的一种手滑。现在保留原始顺序与重复，自检锚的样本里专门有一行带重复编号。
function stageIdLines(text) {
  return text
    .split(/\r?\n/)
    .map((line, i) => ({
      no: i + 1,
      // ⚠️ 不去重、不排序：重复本身就是一种违规形状（见上面 F7），
      // 顺序本身也承重（方向写反要红）。
      ids: [...line.matchAll(/`(S\d+)`/g)].map((m) => m[1]),
    }))
    .filter((r) => r.ids.length > 0)
}

// ⭐ 正向自检锚：钉抽取器本身。三件事一起钉：
//   ① **逐行、不跨行收敛**——收敛式实现会把前两行揉成一个序列，逐行式不会；
//   ② **行内不去重**——第三行带重复编号，塌缩式实现会把它变成长度 1；
//   ③ 没有反引号的编号不算。
test('自检：stageIdLines() 逐行返回、行内不去重，不把整份文件收敛成一个序列', () => {
  const sample = [
    '从 `S1` 开始',
    '中途 `S4`',
    '手滑写成 `S1` 到 `S1`',
    '完整跨度：`S1` 到 `S8`',
    '没有反引号的 S9 不算',
  ].join('\n')
  assert.deepEqual(stageIdLines(sample), [
    { no: 1, ids: ['S1'] },
    { no: 2, ids: ['S4'] },
    { no: 3, ids: ['S1', 'S1'] },
    { no: 4, ids: ['S1', 'S8'] },
  ])
})

const CHAIN_ENDPOINTS = [STAGE_IDS[0], STAGE_IDS.at(-1)]

// 一行「完整写出了这条链」= 它的编号序列逐字等于那两个端点。主判据与锚共用这一份。
function isFullChainLine(ids) {
  return ids.length === CHAIN_ENDPOINTS.length && ids.every((id, i) => id === CHAIN_ENDPOINTS[i])
}

// ⭐ 自检：判据函数本身认得出四种违规形状——少一个端点、重复、方向写反、过期值。
// 用已知违规样本那一款（手法同 `tests/agents.test.mjs` 的 `statesPathsEscape()` 自检），
// 因为这四种正是上面两轮实测抓到的全部形状。
test('自检：isFullChainLine() 认得出「只说一半」「重复」「方向写反」「过期值」四种违规', () => {
  assert.ok(isFullChainLine([...CHAIN_ENDPOINTS]))
  assert.ok(!isFullChainLine([CHAIN_ENDPOINTS[0]]), '只说一半应当判不通过（评审 F6 那一刀）')
  assert.ok(
    !isFullChainLine([CHAIN_ENDPOINTS[0], CHAIN_ENDPOINTS[0]]),
    '同一个端点写两遍应当判不通过（评审 F7 那一刀）',
  )
  assert.ok(!isFullChainLine([...CHAIN_ENDPOINTS].reverse()), '方向写反应当判不通过')
  assert.ok(!isFullChainLine([CHAIN_ENDPOINTS[0], 'S99']), '端点过期应当判不通过')
})

for (const f of [README_EN, README_ZH]) {
  // ⭐ 锚：防两条主判据零次迭代。**逐行判定后取存在量词，不跨行取并集**——
  // 上一版就是跨行取并集，于是一行的真话把另一行的假话顶绿了（评审 F6）。
  test(`${f} 里至少有一行完整写出了 stages.json 的两个端点——否则下面两条零次迭代恒绿`, () => {
    const lines = stageIdLines(read(f))
    assert.ok(
      lines.some((r) => isFullChainLine(r.ids)),
      `${f} 里没有任何一行完整写出了 ${JSON.stringify(CHAIN_ENDPOINTS)}——` +
        '下面那两条判据会零次迭代、恒绿，而「这支团队的链走到哪」是对外表面最基本的' +
        `一条事实。今天抠出来的是 ${JSON.stringify(lines)}`,
    )
  })

  test(`${f} 里出现的每一个阶段编号都是 stages.json 的端点之一`, () => {
    for (const { no, ids } of stageIdLines(read(f))) {
      for (const id of ids) {
        assert.ok(
          CHAIN_ENDPOINTS.includes(id),
          `${f} 第 ${no} 行写了 ${id}，而 stages.json 的端点是 ` +
            `${JSON.stringify(CHAIN_ENDPOINTS)}。两种可能：① 它是一个**过期值**` +
            '（M0 写这两份文件时链止于 S5，M2a 才接到 S8——这正是 M2c 存在的理由）；' +
            '② 你想在对外表面上提一段中间阶段，那等于在这里造第二份阶段链，先想清楚' +
            '要不要（docs/11 §5.18 C1）。⚠️ 这条判据是**逐个编号**跑的，不是把整份' +
            '文件收敛成首尾一对——第一版就是收敛的，结果另一句真话把这句假话盖住了',
        )
      }
    }
  })

  test(`${f} 里每一行只要提了阶段编号，写的就是那两个端点、按顺序、不多不少`, () => {
    for (const { no, ids } of stageIdLines(read(f))) {
      assert.ok(
        isFullChainLine(ids),
        `${f} 第 ${no} 行提了阶段编号，抠出来是 ${JSON.stringify(ids)}，` +
          `而这条链的端点是 ${JSON.stringify(CHAIN_ENDPOINTS)}。四种常见形状：` +
          '**只说了一半**（把「to S8」改成「onward」这一类——评审 F6 那一刀，上一版全绿）、' +
          '**同一个端点写两遍**（评审 F7 那一刀，改端点时最自然的手滑，上一版也全绿）、' +
          '**方向写反**、**端点过期**。⚠️ 这条判据**逐行**跑：这一行说了一半，' +
          '不会因为别的行说全了就放过——上一版的锚就是跨行取并集，被另一句真话顶绿了。' +
          '对外表面上提这条链，要么完整地提，要么一个编号都不提',
      )
    }
  })
}

// ---------------------------------------------------------------------------
// 五、「不认领路径的那些角色」—— 真源是 templates/project.json
// ---------------------------------------------------------------------------
//
// 已知边界第一段现在写着「写路径隔离是硬约束，但只对认领了路径的角色；一个都不
// 认领的那两个整段跳过这道检查」。这半句是 M2b 才写下来的事实（`docs/11` §5.14：
// `decideWritePath` 在 `!Object.hasOwn(owners, role)` 时早退放行，而 `at-qa` 还
// 持有 `Bash`），M0 的 README 里没有它——**旧那句「写路径隔离对 Edit/Write 是硬
// 约束」对这两个角色是假的，而且假在把风险说小了那一侧。**
//
// `tests/helpers/roles-without-paths.mjs` 已经是这一组角色的单一真源（它自己的
// 头部记着：此前「禁令」与「依据」两条不变量各有各的真源，可以静默分叉）。这里
// 是它的第三个消费方——不在这里自己再算一次 `available_roles − paths`。
test('前置条件：ROLES_WITHOUT_PATHS 非空——否则下一条在空清单上空转', () => {
  assert.ok(
    ROLES_WITHOUT_PATHS.length > 0,
    'templates/project.json 的 available_roles 减去 paths 的键算出来是空集合——' +
      '下一条对外表面的判据会一个角色都不检查',
  )
})

for (const f of [README_EN, README_ZH]) {
  test(`${f} 的已知边界那一节逐个点名了不认领路径的那些角色`, () => {
    const block = limitationsBlock(read(f))
    for (const role of ROLES_WITHOUT_PATHS) {
      assert.ok(
        block.includes(role),
        `${f} 的已知边界没提 ${role}，而它在 templates/project.json 里一个 project.paths 都不认领` +
          '——写路径隔离对它在 run 目录之外整段早退放行（docs/11 §5.14）。' +
          '这是陌生人判断「装上它安不安全」要用的事实，不能只留在 docs 里',
      )
    }
  })
}

// ---------------------------------------------------------------------------
// 六、Development 那一节的「裸 node --test，不带路径参数」
// ---------------------------------------------------------------------------
//
// 这一条与上面五条不是同一类：它断言的不是仓库里的某份数据，而是**本机上
// `node --test tests/` 的行为**（「不会发现 tests/ 下的测试文件，只报一个幻影的
// pass 0 / fail 1」）。仓库里没有第二份可比的拷贝——`docs/11` 记的是另一个事实
// （裸 `node --test` 从仓库根**递归收集**，所以 `scratchpad/` 也在内），其余同族
// 的话只活在 `docs/superpowers/plans/` 那几份冻结的计划里，那些是历史记录，不该
// 被当成真源。
//
// 所以这条直接去问那个行为本身：`docs/16` §3.1 的「判据比清单更可核」。
// 它红的含义很明确——README 那一段的**前提**变了，该改的是那一段，不是这条断言。
//
// ⚠️ 递归守卫：万一哪天 `node --test tests/` 真的发现得了测试文件，子进程会把整
// 套测试（包括本文件）再跑一遍，而本文件会再起一个子进程。环境变量把这条链在第
// 一层掐断。`docs/16` §3.8 的那条判据（「我造的这个东西会不会进某个判据的输入
// 集合」）在这里是「我起的这个进程会不会把我自己再起一遍」。
const SELFTEST_CHILD = 'AGENT_TEAM_README_SELFTEST_CHILD'
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))

test('Development 那一节的前提今天仍然成立：node --test tests/ 发现不了 tests/ 下的测试', (t) => {
  if (process.env[SELFTEST_CHILD]) {
    t.skip('递归守卫：本进程已经是这条断言起的子进程')
    return
  }
  // ⚠️ `NODE_TEST_CONTEXT` 必须从子进程环境里拿掉：`node --test` 给每个测试文件
  // 的进程都设着它，而子进程一旦继承到，Node 会判定「在测试文件内部递归调用
  // run()」，打印一行 warning 之后**跳过收集文件**——那样这条断言量的就不是
  // `node --test tests/` 的收集行为，而是 Node 的递归保护。
  //
  // ⚠️ **这句话的后半截曾经写成「恒绿且毫无意义」，那是假的，已改。** 实测（评审
  // 复现、本轮再核）：`NODE_TEST_CONTEXT=child node --test tests/` 只打印一行
  // recursion warning，**一条 pass / fail 行都不打印**，所以下面那两条 `assert.match`
  // 必然失败——**去掉这个 `delete`，这条判据是红的，不是绿的。**
  // 「恒绿」是它的**对偶**才会有的毛病：同一个形状下，一条写成「断言输出里**不含**
  // 某某」的判据会拿着一段 warning 文本判通过。`delete` 本身依然是必需的，
  // 理由不是「否则恒绿」，是**否则量的是 Node 的递归保护、不是收集行为**——
  // 红得对不对，和红不红是两件事。
  const env = { ...process.env, [SELFTEST_CHILD]: '1' }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--test', 'tests/'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const hint =
    '——两份 README 的 Development 一节写着「本机实测 node --test tests/ 不会发现 tests/ 下的' +
    '测试文件，只报一个 pass 0 / fail 1 的幻影失败」。这条断言红了说明那个前提变了：' +
    '去改那两段正文（两份都要改），不要改这条断言。实际输出：\n' +
    out.split(/\r?\n/).filter(Boolean).slice(-8).join('\n')
  assert.match(out, /\bpass 0\b/, `node --test tests/ 的 pass 数不再是 0${hint}`)
  assert.match(out, /\bfail 1\b/, `node --test tests/ 的 fail 数不再是 1${hint}`)
})

// ---------------------------------------------------------------------------
// 七、`Status:` 那一行 —— 它写的每一条都要有判据钉着
// ---------------------------------------------------------------------------
//
// M0 写的是 `Status: M0 — foundation validation, not yet usable.`，到 M2b 收口时
// 它已经与现状对不上了；而用户这次定下来的做法**不是换一个更新的档位词**，是
// **换掉档位词这种写法本身**——`alpha` / `beta` / `usable` / `production-ready`
// 这类词**没有真源，没有人能核**（`docs/16` §3.1 判死的那一族）。
//
// 新的那一行只陈述四件事，每一件都有判据：
//
//   · 十角色              —— 本文件第二节（B），真源是 `agents/*.md` 减去测试替身；
//   · 阶段链 `S1`–`S8`     —— 本文件第四节（D），真源是 `stages.json` 的首尾两个键；
//   · 真实环境完整跑通过一趟 —— 下面这条，真源是 `docs/15-M2b-实测结论.md`；
//   · 仅在 `--plugin-dir` 下实测 —— 下面这条，依据是 `docs/15` §8.1。
//
// 前两条**不需要在这里重复**：B 与 D 扫的是整份文件，`Status:` 行里那一份「十角色」
// 与那两个阶段编号自动落进它们的判据里，**因为 B 与 D 都是逐条迭代的**。
//
// ⚠️ **这段话原来写的是「无条件被 B/D 覆盖」，当时对 D 是假的，已改。** 写下它的那个
// commit（也就是新增这一整节的那个）里，D 还是**收敛式**的——把整份文件抠成一个去重
// 序列只取首尾。`Status:` 这一行新加的 `S1`–`S8` 是一句真话，而它正好把序列的尾巴顶回
// `S8`，于是标语那一句里的过期值被静默。**一句真话把一句假话盖住了。** D 已经在第四节
// 重写成逐行迭代，那一节的注释里记着完整经过；这里只留更正本身：**「无条件」这个词当时
// 不该写，它断言的是一个没有核过的性质。**
//
// ⚠️ **判据盖不住的那一半，写清楚**：没有任何东西阻止有人把这一行整个换成一个档位词。
// 这是**有意的边界**，不是漏掉——档位词是开放集合，按词形穷举它有结构性上限
// （`docs/16` §3.4）。盖住的是两件具体的事：那一行里的角色数与阶段编号由 B/D 逐条覆盖
// （**凡是写出来的都得对**，但没人强制它一定要写出来）；而 `--plugin-dir` 这个限定
// 不能被悄悄删掉（下面第二条）。
//
// ⚠️ 中文那份的标签这一轮也翻了（`**Status:**` → `**状态：**`），两份是镜像。
// 判据认两种标签，靠合成样本自检钉住「两种都认得」。
function statusLineOf(text) {
  return text.split(/\r?\n/).find((l) => /^\*\*(Status:|状态：)\*\*/.test(l)) ?? null
}

// ⭐ 正向自检锚：钉抽取器本身——两种标签都认得，而且不把正文里别的加粗开头行当成它。
test('自检：statusLineOf() 认得出英文与中文两种标签，且不把别的加粗行当成 Status 行', () => {
  assert.equal(statusLineOf('# 标题\n\n**Status:** 英文那行\n\n**Note:** 别的加粗行\n'), '**Status:** 英文那行')
  assert.equal(statusLineOf('# 标题\n\n**状态：** 中文那行\n\n**注意：** 别的加粗行\n'), '**状态：** 中文那行')
  assert.equal(statusLineOf('# 标题\n\n**Note:** 只有别的加粗行\n'), null)
})

for (const f of [README_EN, README_ZH]) {
  test(`${f} 的 Status: 行带着「仅 --plugin-dir」这个限定`, () => {
    const line = statusLineOf(read(f))
    assert.ok(line, `${f} 里找不到 Status: 那一行——它是最多人只读这一行就走的位置`)
    assert.ok(
      line.includes('--plugin-dir'),
      `${f} 的 Status: 行里没有 --plugin-dir 这个限定。这个插件的全部实测都是在 ` +
        '--plugin-dir 下取的（docs/15 §1 的四条操作纪律第 1 条：全程未使用 claude plugin ' +
        'enable），而 docs/15 §8.1 明写正式安装下的结论「没验」。Status 这一行比正文更容易' +
        '被当成对插件本身的断言，限定不能在这里被悄悄删掉',
    )
  })
}

// 真源：`docs/15-M2b-实测结论.md`。两条判据各问一件事，各占一个 test()。
const DOCS15 = read('docs/15-M2b-实测结论.md')

// 那趟真实 run 跑完的链写成 `S<数字>→S<数字>`，文中出现多处（§0 的一句话结论、
// §3.0 的会话表、§3.8 的小节标题、§6.3 之前那句）。判据把**每一处**都抠出来，
// 不挑其中一处——挑一处就是按位置定位，`docs/16` §3.1 那三条细则判死的那一族。
//
// ⚠️ **一次收窄，它是实测逼出来的**：第一版判据只认 `S\d+→S\d+` 这个形状，在真文档
// 上当场多抠出一个 `S6→S5`——那是**阶段回退**（`docs/15` §6.1 记的「`stage` 回退过
// 两次」），不是链端点。同一个箭头形状承载着两种完全不同的意思。收窄成**只认向前
// 的那一种**（后一个编号更大），回退天然落在外面。
//
// 按 `docs/16` §3.2 第 2 条（判据每加一次收窄，锚就跟着往里挪一层），下面那条自检
// **必须带一个回退样本**：光证明它抠得出 `S1→S8` 证不了这次收窄还在。
function measuredChainEndpoints(text) {
  return [
    ...new Set(
      [...text.matchAll(/\b(S(\d+))→(S(\d+))\b/g)]
        .filter((m) => Number(m[4]) > Number(m[2]))
        .map((m) => `${m[1]}→${m[3]}`),
    ),
  ]
}

// ⭐ 正向自检锚：钉抽取器本身，钉在合成样本上——不抄真文档的内容，免得自检自己
// 变成 docs/15 的第二份拷贝。三件事一起钉：去重、不认没有箭头的编号、**不认回退**。
test('自检：measuredChainEndpoints() 抠得出去重后的端点对，且不把阶段回退算成一趟跑完的链', () => {
  assert.deepEqual(
    measuredChainEndpoints('这一趟 S1→S8 跑完了，再提一次 S1→S8；单独的 S4 不算；stage 回退过（S6→S5）也不算'),
    ['S1→S8'],
  )
})

// ⚠️ 判据是「**含**」，不是「恰好只有一个」。第一版写的是
// `deepEqual(measuredChainEndpoints(DOCS15), [expected])`，那等于要求
// **`docs/15` 里永远只许出现一个向前箭头**——往那份文档里新增一句「另一趟探针只跑到
// `S1→S4` 就停了」就会当场变红，而那是一次完全正常的补记。更糟的是失败文案在那个触发
// 下会说「Status 那句话的前提变了」「不要改 docs/15」，**把唯一正确的修法堵死了**。
// 这一条要问的只有一件事：**那趟跑完整条链的 run，它的端点还是今天的端点吗**。
test('Status: 那句「真实环境完整跑通过一趟」今天仍然成立——docs/15 里仍有一趟跑到今天这两个端点的 run', () => {
  const expected = `${STAGE_IDS[0]}→${STAGE_IDS.at(-1)}`
  const found = measuredChainEndpoints(DOCS15)
  assert.ok(
    found.includes(expected),
    '两份 README 的 Status: 行声称「真实环境完整跑通过一趟」，真源是 ' +
      `docs/15-M2b-实测结论.md 记的那趟 run。今天从它里面抠出来的向前跨度是 ` +
      `${JSON.stringify(found)}，里面没有 ${expected}。**两个触发，修法相反，先分清是哪一个：**\n` +
      `  ① stages.json 的端点变了（现在是 ${expected}），而 docs/15 记的那趟 run 跑的是别的——` +
      '**Status: 那句话的前提变了**，「完整」二字不再成立。改 README，或者重新跑一趟并补一份' +
      '实测记录。⚠️ **不要去改 docs/15**：它是冻结的实测记录，记的是当时跑完的是哪一段，' +
      '永远为真（docs/16 §3.5：豁免的是「记录当时的事实」）。\n' +
      '  ② stages.json 没变，是 docs/15 里那几处跨度被改动了——那就去核对那次改动是不是误改，' +
      '**该改回去的是 docs/15**。\n' +
      '  （判据只问「含不含」，所以往 docs/15 里新增别的跨度记录不会红——那条过严的写法' +
      '已经改掉了。）',
  )
})

// 第二条：两份 README 不得再把**正式安装路径**说成没实测过。
//
// ⚠️ **这一条换过真源，而换掉它的理由本身比它守的东西更值钱。**
//
// 它原来断言的是「`docs/15` 里还找得到『正式安装……环境不允许』那个小节标题」，
// 失败文案写着自己是「那个方向上唯一的守卫」，红了就回去改 README。
//
// **它红不了。** `docs/15` 是冻结的实测记录（`docs/16` §3.5：豁免的是「记录当时的
// 事实」），那个标题永远不会消失，所以那条断言**恒为真**。M2d 把正式安装路径实测掉
// （`docs/17`）、把两份 README 里三处过期表述整段改写之后，**整套仍然全绿，
// 包括它自己**——它声称守着的那件事当场发生了，而它一声没吭。
//
// 这同时是两个已记形状的实物：`docs/11` §5.13（「一个不变量被写错了」和「它从来
// 没被写下来」在套件里长得一模一样，都是全绿）与 §5.19 的第三问（「同一刀砍下去，
// 还有谁本该说话？」）。**成因是一句可以直接照做的话**：一条判据如果把真源选在
// **不会变的文件**上，它就不是判据，是一句注释。冻结文档能当**历史**的锚，
// 不能当**现状**的锚。
//
// 换成活的那一侧——两份 README 自己，`docs/17` 当锚。三条各问一件事：
//   · 锚：`docs/17` 在，而且它记的确实是 `--scope local` 那条路；
//   · 正向：两份 README 的安装那一节都写着那条实测过的第二条路；
//   · 反向：本轮退役的那几句原话不许原样回来。
//
// ⚠️ **盖不住的那一半，写清楚**：反向那条钉的是**一张退役原话清单**，不是
// 「任何把正式安装说成没测过的写法」。后者是开放集合，按词形穷举它有结构性上限
// （`docs/16` §3.4）。换一种措辞把同一件事说回去，反向这条不会红；只有那个人
// **同时**把 `--scope local` 从安装那一节删掉，正向那条才会红。两条都绕开的写法
// 确实存在，这里不假装盖住了它。
//
// ⚠️ **暴露面不止「措辞」，还包括命令行参数值写错——这一款单独点名**（M2d 定向评审 F6）。
// 评审自己下的那一刀：把安装那一节里的 `--scope local` 改成 **`--scope user`**
// （**本项目明令禁止的作用域**——两份 README 的收场那一段正是为它写的），
// 段内别处仍留着 `--scope local`、退役原话一句没写回来 —— **整套全绿，一条没红。**
//
// 成因是结构性的，不是这条判据写窄了：**两份 README 之间唯一被机械比对的结构性镜像
// 是小节标题**（本文件第一节那张 HEADING_PAIRS）。**没有任何判据比对两份里的命令行**，
// 所以中英两份可以就「装的时候用哪个作用域」**互相矛盾**，而套件不响。
// **本轮不为它加判据**（M2d 裁定：不扩范围）；这里做的只是把它从「将来也许有人绕得开」
// 降级成**一个已经被演示过的具体实例**——下一个人不必再自己想一遍它长什么样。
const DOCS17 = 'docs/17-正式安装路径实测.md'

// M2d 之前两份 README 里的原话，逐字抄下来。它们描述的状态已经不成立了
// （`docs/17` §2 的七条全部有结论），原样写回去就是把已经做到的说成没做到。
const RETIRED_CLAIMS = [
  'the formally installed path is untested',
  '正式安装的路径没测',
  'The only load path this project has ever measured is `--plugin-dir`',
  '本项目唯一实测过的加载方式是 `--plugin-dir`',
  'a properly installed plugin (`claude plugin install`) rather than `--plugin-dir`',
  '正式安装的插件（`claude plugin install`）而非 `--plugin-dir`',
]

function retiredClaimsIn(text) {
  return RETIRED_CLAIMS.filter((c) => text.includes(c))
}

// 安装那一节的正文：从配对表里那一对标题起，到下一个 `## ` 止。标题不硬编码，
// 从 HEADING_PAIRS 取——中英两份的标题文字不同，而那张表已经是它们的真源。
function installSectionOf(text, heading) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^##\s/.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

// ⭐ 正向自检锚：钉两个抽取器本身，钉在合成样本上。
// `installSectionOf` 要证明它**停在下一个小节**（否则「安装那一节里写着 X」会退化成
// 「整份文件里某处写着 X」，判据当场变宽）；`retiredClaimsIn` 要证明它**逐条返回命中**
// 而不是只答一个布尔。
test('自检：installSectionOf() 抠得到那一节且停在下一个小节，retiredClaimsIn() 逐条返回命中', () => {
  const sample = ['# 标题', '## 安装', '正文甲', '', '## 已知边界', '正文乙'].join('\n')
  assert.equal(installSectionOf(sample, '## 安装'), '正文甲\n')
  assert.equal(installSectionOf(sample, '## 没有这一节'), null)
  assert.deepEqual(retiredClaimsIn('前面 正式安装的路径没测 后面'), ['正式安装的路径没测'])
  assert.deepEqual(retiredClaimsIn('一句都没有'), [])
})

test('前置条件：RETIRED_CLAIMS 非空——空清单会让下面那条反向判据零次迭代恒绿', () => {
  assert.ok(RETIRED_CLAIMS.length > 0, 'RETIRED_CLAIMS 被清空了，反向那条判据什么都不再拦')
})

test('锚：docs/17 在，且它记的就是 --scope local 那条正式安装路径', () => {
  let text
  try {
    text = read(DOCS17)
  } catch {
    assert.fail(
      `读不到 ${DOCS17}。下面两条判据的全部依据是「正式安装路径已经实测过」，而那份实测` +
        '记录就是它。如果这份文档是被有意删掉/改名的，那两条判据要跟着重新想一遍——' +
        '不要只把这里的文件名改掉了事',
    )
  }
  assert.ok(
    text.includes('--scope local'),
    `${DOCS17} 里找不到 --scope local。它记的是「用 local 作用域把插件正式装上」这条路，` +
      '两份 README 的安装那一节引的就是它；这个词不在了，说明那份记录已经不是原来那件事',
  )
})

for (const [i, f] of [README_EN, README_ZH].entries()) {
  const heading = HEADING_PAIRS[1][i]
  test(`${f} 的安装那一节写着那条实测过的第二条路（--scope local）`, () => {
    const section = installSectionOf(read(f), heading)
    assert.ok(section, `${f} 里找不到 ${heading} 那一节`)
    assert.ok(
      section.includes('--scope local'),
      `${f} 的安装那一节里没有 --scope local。docs/17 把正式安装路径逐条实测过了：` +
        '加载、at-pm 接管、命令与角色解析、九个可派发角色的工具面（与 --plugin-dir 逐字一致）、' +
        '六道门禁、续会话、卸载。**把这条路从安装说明里删掉，等于把已经做到的说成没做到**' +
        '（docs/16 §3.7：这一族没有任何测试会因此变红，代价是下一个人照着它白做工）。\n' +
        '  如果真的是要删——比如那条路后来被发现不可靠——那要先改 docs/17 或者补一份新的' +
        '实测记录，再回来改这一条，不要只删 README',
    )
  })

  test(`${f} 里没有本轮退役的那几句原话`, () => {
    const hit = retiredClaimsIn(read(f))
    assert.deepEqual(
      hit,
      [],
      `${f} 里又出现了 M2d 退役掉的原话：${JSON.stringify(hit)}。\n` +
        '  这几句描述的是「正式安装路径没实测过」，而 docs/17 §2 那张表七条全部有结论。\n' +
        '  ⚠️ 这一条钉的是一张**退役原话清单**，不是任何把正式安装说成没测的写法——' +
        '它红了说明有人把旧句子原样写了回来，多半是一次回滚或一次复制粘贴，' +
        '去看那次改动是不是误改',
    )
  })
}

// ---------------------------------------------------------------------------
// 八、安装说明里那两条 CLI 行为 —— 真源是实测记录的原文
// ---------------------------------------------------------------------------
//
// M2c 评审 F5 指出的缺口：第一节到第七节钉住的都是「数据 ↔ 散文」这一类，而安装说明
// 里还有两条断言的是**一次实测观察到的 CLI 行为**——
//
//   · `claude --resume` 不继承 `--plugin-dir`，README 里**逐字引了 CLI 打印的那句话**；
//   · `claude plugin disable` **不**把工具面还回来。
//
// 它们与被钉住的那几条写在同一节、**读起来同等可靠**，而在 F5 之前是零守卫的散文：
// 实测过——把中文那份的 `--resume` 那一段**整段删掉**全绿；把 `disable` 那段**说成
// 反面**（「用 disable 就能把工具面还回来」）也全绿。
//
// 手法与第七节那条（`docs/15` 的端点）同一个：**README 的引述 ↔ 实测记录的原文**。
// 两份 README 各一半，真源各自是 `docs/11` §5.5 与 `docs/04` §9 ③。
const DOCS11 = read('docs/11-M1b-遗留与已知边界.md')
const DOCS04 = read('docs/04-本机实测结论.md')

// 归一化：去掉强调星号、反引号、引用块前缀，再把所有空白压成一个空格。
// 三份文件里这句 CLI 原话的排版各不相同——`docs/11` 把它写成跨两行的引用块并且在
// 句中加了 `**`，README 把它整句塞进一对反引号里。**排版不同不等于引述不同**，
// 判据不该被换行位置绊倒（`docs/11` §5.19 记过同族的一次：`.` 默认不跨行造成假红）。
function normalizeQuote(s) {
  return s
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// CLI 那句原话：从 `Continuing with the default tools` 起，到第一个 `apply.` 为止。
// 认头尾两个锚点、不认中间——中间那半截正是这条引述唯一承重的部分
// （`the agent's tool restrictions no longer apply`），它变了就该红。
const CLI_QUOTE_HEAD = 'Continuing with the default tools'
const CLI_QUOTE_TAIL = 'apply.'

function resumeQuoteOf(text) {
  const flat = normalizeQuote(text)
  const i = flat.indexOf(CLI_QUOTE_HEAD)
  if (i < 0) return null
  const j = flat.indexOf(CLI_QUOTE_TAIL, i)
  if (j < 0) return null
  return flat.slice(i, j + CLI_QUOTE_TAIL.length)
}

// ⭐ 正向自检锚：钉抽取器本身，钉在合成样本上。三件事一起钉：跨行能拼起来、强调星号
// 与引用块前缀被吃掉、找不到时返回 null（而不是返回空串——空串会让下面那条
// `assert.equal` 在两边都抠不到时**两个空串相等而恒绿**）。
test('自检：resumeQuoteOf() 跨行与强调排版都能归一化，抠不到时返回 null', () => {
  const asDoc = '> Continuing with the default tools and system prompt — **the agent restrictions\n> no longer apply.**\n'
  const asReadme = '正文里 `Continuing with the default tools and system prompt — the agent restrictions no longer apply.` 后面还有话。'
  const expected = 'Continuing with the default tools and system prompt — the agent restrictions no longer apply.'
  assert.equal(resumeQuoteOf(asDoc), expected)
  assert.equal(resumeQuoteOf(asReadme), expected)
  assert.equal(resumeQuoteOf('这一段里没有那句 CLI 原话。'), null)
})

// ⭐ 锚二：真源那一侧必须真的有这句话。它是空的时候，下面那条 `assert.equal` 会变成
// 「两边都是 null」——**恒绿**。这条锚就是防这个（`docs/16` §3.2：锚要钉在判据真正
// 进入 assert 的那一层）。
test('锚：docs/11 §5.5 里仍然有那句 CLI 原话——否则下面两条会拿两个 null 相等而恒绿', () => {
  assert.ok(
    resumeQuoteOf(DOCS11),
    'docs/11-M1b-遗留与已知边界.md 里抠不出 CLI 打印的那句 ' +
      `${JSON.stringify(CLI_QUOTE_HEAD)}…${JSON.stringify(CLI_QUOTE_TAIL)}——` +
      '它是两份 README 安装说明里那条 --resume 警告的真源，真源没了，下面两条就没有基准',
  )
})

for (const f of [README_EN, README_ZH]) {
  test(`${f} 逐字引的那句 CLI 原话与 docs/11 §5.5 记的一致`, () => {
    assert.equal(
      resumeQuoteOf(read(f)),
      resumeQuoteOf(DOCS11),
      `${f} 安装说明里引的那句 CLI 原话与 docs/11 §5.5 记的对不上（抠出 null 就是那一段` +
        '被删掉了）。这一条是对外表面上**唯一**一处逐字引用平台原文的地方，而它承重的是' +
        '「续一次会话就能让整套工具面隔离静默消失」这件事——引述漂了、或者整段没了，' +
        '读的人不会有任何提示。要改就两边一起改，并回去确认 docs/13 §5.6 的完整经过',
    )
  })
}

// ---- `claude plugin disable` 不把工具面还回来 ----
//
// 这一条没有可逐字比对的平台原文（`docs/04` §9 ③ 记的是中文结论），所以钉法换成
// `tests/agents.test.mjs` 的 `statesPathsEscape()` 那一款：**前提与结论两半都要**，
// 并配一条**已知违规样本**自检——保留前提、把结论说反，判据必须判不通过。
// 评审实测过的那一刀正是这个形状（「用 disable 就能把工具面还回来」）。
//
// ⚠️ 两份 README 措辞不同语，所以这张表有两行。它不是「同一份知识的两份拷贝」——
// 跨语言的措辞本来就没有可派生的单一真源，与本文件第一节的 HEADING_PAIRS 同理。
const DISABLE_CLAIM = {
  [README_EN]: {
    premise: /tool surface is fixed for its lifetime/,
    negation: /disabling was measured not to hand it back/,
    flipped:
      'Do not reach for claude plugin disable — a session tool surface is fixed for its lifetime, and disabling hands it back.',
  },
  [README_ZH]: {
    premise: /工具面在它的生命周期内是固定的/,
    negation: /disable\s*不会把它还回来/,
    flipped: '不要去用 claude plugin disable——一个会话的工具面在它的生命周期内是固定的，而 disable 会把它还回来。',
  },
}

function disableLineOf(text) {
  return text.split(/\r?\n/).find((l) => l.includes('claude plugin disable')) ?? null
}

function statesDisableDoesNotRestore(line, claim) {
  const flat = normalizeQuote(line)
  return claim.premise.test(flat) && claim.negation.test(flat)
}

// ⭐ 正向自检锚（已知违规样本那一款）：判据必须认得出「保留前提、把结论说反」。
// 没有它，判据被放宽成只查前提时主判据会恒绿——而那正是这条要防的失效方向。
test('自检：statesDisableDoesNotRestore() 对「保留前提、把结论说反」的样本判不通过', () => {
  for (const [f, claim] of Object.entries(DISABLE_CLAIM)) {
    assert.ok(
      !statesDisableDoesNotRestore(claim.flipped, claim),
      `${f} 那一行的判据对着一个已知违规样本（保留「工具面在会话生命周期内固定」这个前提、` +
        '把「disable 不会还回来」这个结论说反）算出了「通过」——判据认不出这类违规，回去检查它',
    )
  }
})

// ⭐ 锚二：真源那一侧。`docs/04` §9 ③ 是这条结论的唯一出处，也是本项目「绝不用
// plugin enable / disable，一律 --plugin-dir」这条纪律的依据。
test('锚：docs/04 §9 ③ 仍然记着「disable 之后工具面没有恢复」——README 那一段的依据', () => {
  assert.match(
    normalizeQuote(DOCS04),
    /plugin disable 之后同一会话的工具面没有恢复/,
    'docs/04-本机实测结论.md 里找不到「plugin disable 之后同一会话的工具面没有恢复」。' +
      '两份 README 的安装说明拿它当「用完怎么收场」那一段的依据，本项目「绝不用 plugin ' +
      'enable、一律 --plugin-dir」这条纪律也压在它上面。如果这条后来被推翻了，' +
      '要改的是 README 与纪律，不是把这条断言删掉',
  )
})

for (const [f, claim] of Object.entries(DISABLE_CLAIM)) {
  test(`${f} 的收场那一段两半都在：工具面在会话生命周期内固定，且 disable 不会还回来`, () => {
    const line = disableLineOf(read(f))
    assert.ok(line, `${f} 里找不到提到 claude plugin disable 的那一段——brief 第二节点名必须写的四条之一`)
    assert.ok(
      statesDisableDoesNotRestore(line, claim),
      `${f} 那一段没有同时说清两半：**前提**（一个会话的工具面在它的生命周期内是固定的）` +
        '与**结论**（实测确认 disable 不会把它还回来，docs/04 §9 ③）。只留前提、或者把结论' +
        '说反（「用 disable 就能把工具面还回来」），读的人会照着一个本项目自己已经禁用的' +
        '做法去收场——而那个做法不起作用，他不会收到任何提示',
    )
  })
}

// ---------------------------------------------------------------------------
// 九、两份 README 里的命令行互为镜像 —— 真源是**两份自己**
// ---------------------------------------------------------------------------
//
// M2d 定向评审 F6 下的那一刀：把英文那份安装说明里的 `--scope local` 改成
// **`--scope user`**（**本项目明令禁止的作用域**——两份 README 的收场那一段正是为它写的），
// 段内别处仍留着 `--scope local`、退役原话一句没写回来 —— **整套 624 / 0，一条没红。**
//
// 缺口是结构性的，不是第七、八节写窄了：在这一节之前，**两份 README 之间唯一被机械
// 比对的结构性镜像是小节标题**（第一节那张 `HEADING_PAIRS`）。正文各自被各自的真源钉着
// （角色数钉 `agents/`、阶段链钉 `stages.json`、CLI 原话钉 `docs/11` §5.5），
// **唯独没有任何一条把两份的命令行放在一起看**——于是中英两份可以就「装的时候用哪个
// 作用域」**互相矛盾**，而套件不响。
//
// 这与 M2c 的头号发现同一类：那次是 `at-pm` 的工具面**在安全那一节**被说小了
// （本文件头部记着）。这次是**安装命令里可能写着被禁的作用域**。
// 两次都是「一条安全相关、且可机械核的断言没有守卫」。
//
// ⚠️ **范围上有一处与裁定的字面不同，写在这里**：裁定说的是「**围栏代码块内**的命令行」。
// 实测两份 README 的围栏块里**各只有一行** `claude --plugin-dir …`；
// 而 `--scope local` 那几条命令**全都住在行内反引号里**，评审那一刀砍中的正是行内的一条。
// **只扫围栏块的判据会从出生起就打不红那一刀。** 所以这里扫**两处**：围栏块 + 行内 code。
// 这不是扩范围，是让判据真的盖住裁定点名要盖的那件事。
//
// ⚠️ **真源是「两份互相之间一致」，不是某个字面量。** 不要把它改写成「命令行必须等于
// 某某字面串」——那会在仓库里造出**第三份拷贝**，而三份拷贝要维护的不变量比两份更多。
// 下面变异第 3 刀（两份同时改成同一个新值，**不该红**）钉的就是这一点。

// 抠出两份里的 claude 命令行，**按文档顺序**，围栏块与行内 code 两处都要。
// 顺序是有意义的：两份是逐段镜像的，某一条被挪到别处也是一种分叉。
// ⚠️ 行内 code 的正则不跨行（`[^`\n]+`）——两份 README 今天没有跨行的反引号 span，
// 将来若有，这里会漏掉它；漏掉的表现是两份的清单长度对不上，**那会红，不会静默**。
function commandLinesOf(text) {
  const out = []
  let inFence = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(line.trim())
      continue
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) out.push(m[1].trim())
  }
  return out.filter((s) => /^claude(\s|$)/.test(s))
}

// 归一化：丢掉**操作数**，留下**子命令与参数**。
//
// 为什么要丢：两份里合法地写着不同的操作数——英文 `<plugin>@<marketplace>`，
// 中文 `<插件>@<市场>`；路径两份都写 `/path/to/agent-team`，但它是示例、不是断言。
// **它们的不同是翻译，不是矛盾。**
//
// 为什么参数值要留：`--scope local` 与 `--scope user` 的差别**不是翻译**，
// 它是两份 README 在教人做两件不同的事，而其中一件是本项目明令禁止的。
// 参数值留着，那一刀才红。
function normalizeCommand(cmd) {
  return cmd
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !t.startsWith('<')) // 占位符操作数
    .filter((t) => !/[\\/]/.test(t)) // 示例路径
    .filter((t) => !/[^ -]/.test(t)) // 非 ASCII 的 token：中文占位符的第二道网
    .join(' ')
}

// 主判据与锚**共用这一份**——`docs/16` §3.2：锚要钉在判据真正进入 assert 的那一层。
// 下面三条自检与最后那条主判据调用的都是 `commandShapeOf`，不是它的某个半成品。
const commandShapeOf = (text) => commandLinesOf(text).map(normalizeCommand)

// ⭐ 正向自检锚之一：钉抽取器**两处都抠**，且不把非命令的 code span 当成命令。
test('自检：commandLinesOf() 围栏块与行内 code 两处都抠得出，且不把非命令的 code span 当成命令', () => {
  const sample = ['正文 `claude plugin list` 正文', '```sh', 'claude --plugin-dir /x', '```', '一个 `tools:` 不是命令'].join(
    '\n',
  )
  assert.deepEqual(commandLinesOf(sample), ['claude plugin list', 'claude --plugin-dir /x'])
})

// ⭐ 正向自检锚之二：钉归一化**丢的是操作数、留的是参数值**。
// 两半一起钉：占位符与路径必须被丢掉（否则中英两份永远对不上，判据变成恒红），
// 参数值必须被留下（否则 `--scope user` 那一刀打不红，判据变成恒绿）。
test('自检：normalizeCommand() 丢掉占位符与路径操作数，保留子命令与参数值', () => {
  assert.equal(
    normalizeCommand('claude plugin uninstall <plugin>@<marketplace> --scope local'),
    'claude plugin uninstall --scope local',
  )
  assert.equal(normalizeCommand('claude plugin uninstall <插件>@<市场> --scope local'), 'claude plugin uninstall --scope local')
  assert.equal(normalizeCommand('claude --plugin-dir /path/to/agent-team'), 'claude --plugin-dir')
})

// ⭐ 已知违规样本：判据必须**判不通过**。样本取的就是评审那一刀的形状。
// 光证明它在今天这两份真文件上是绿的，证不了它认得出违规（那正是 F6 之前的状态）。
test('自检：判据认得出已知违规——一份写 --scope local、另一份写 --scope user 不算镜像', () => {
  assert.notDeepEqual(
    commandShapeOf('装的时候用 `claude plugin install x --scope user`'),
    commandShapeOf('装的时候用 `claude plugin install x --scope local`'),
  )
})

test('前置条件：两份 README 都抠得出非空的命令清单——否则下面那条在两个空数组上恒绿', () => {
  assert.ok(
    commandShapeOf(read(README_EN)).length > 0 && commandShapeOf(read(README_ZH)).length > 0,
    '有一份 README 里一条 claude 命令都抠不到。两个空数组 deepEqual 是通过的，' +
      '所以下面那条主判据会在「命令全被删光」这个最该红的场景下恒绿——先修这里',
  )
})

test('两份 README 里的命令行互为镜像——同一组命令、同一组参数、同一个顺序', () => {
  assert.deepEqual(
    commandShapeOf(read(README_EN)),
    commandShapeOf(read(README_ZH)),
    '两份 README 教人敲的命令对不上了。**真源是两份互相之间一致**，不是这条断言里的某个' +
      '字面量——所以修法是去看那次改动动了哪一份，把另一份跟上，**不要**把命令抄进这个文件。\n' +
      '  ⚠️ 最贵的一种触发：一份写 `--scope local`、另一份写 `--scope user`。' +
      '后者是本项目明令禁止的作用域（两份 README 的收场那一段正是为它写的），' +
      '而读中文那份和读英文那份的人会装出两种波及面完全不同的东西。\n' +
      '  （操作数不比：`<plugin>@<marketplace>` 与 `<插件>@<市场>`、以及示例路径，' +
      '两份合法地不同——那是翻译，不是矛盾。比的是子命令与参数，含参数值。）',
  )
})

// ⚠️ **盖不住的那一半，按 `docs/16` §3 开头那三样写齐。**
//
// **先说这条判据自己最容易被误读的地方**：它钉的是**镜像**，不是**正确**。
// **两份一起写错仍然全绿**——两份都改成 `--scope user`，这一条一声不响。
// 这不是漏，是它的定义：镜像判据的真源是两份自己。**「两份一致」与「两份对」是两件事。**
//
// **① 我拒绝写的那条更强判据（X）长什么样**：README 里的安装命令必须与 `docs/17`
// 实测过的那几条一致——把真源从「另一份 README」换成「那份实测记录」。
// 那样连「两份一起写错」都会红。
//
// **② X 打不红的那一刀**：`docs/17` 本身也是散文。它里面的命令是**当时实际敲的那几条的
// 记录**，不是**推荐给用户的那几条**——§3.1 引的是
// `claude plugin marketplace add "<...>/m2d-probe-plugin" --scope local`（带探针路径与引号），
// §5.6 还讨论着一条**明确不推荐**的 `--scope project`。所以 X 必须先回答
// 「`docs/17` 里哪几条算推荐」，**而那个清单本身就是一次判断**——它会以「在 `docs/17` 里
// 标记哪几条」的形式变成**第三份拷贝**，只是换了个住处。
// 更直接的一刀：**同一次改动把 `docs/17` 和两份 README 一起改了**，X 全绿。
// 这就是 §3.9 记的那个形状——**把真源钉在一份没有机械形状保证的文档上**。
//
// **③ 什么会让答案改变**：如果仓库将来长出一份**机器可读的命令清单**——
// 比如一个装机脚本、或者一份两份 README 都从中生成（或都对它核）的命令 manifest——
// 那 X 的真源就落了地，**这一条就该从「两份互比」升级成「两份各自对那份 manifest 比」**。
// 在那之前，两份互比是**能拿到的最强的那一条**，不是**足够强的那一条**。
