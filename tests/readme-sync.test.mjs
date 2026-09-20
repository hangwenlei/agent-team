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
// 只钉端点，不钉中间：README 是对外表面，不该抄一份阶段链（那会是第二份真源，
// `docs/11` §5.18 C1 就是为这个判的「不补 S6–S8 的逐段正文」）。所以判据取的是
// 抠出来的阶段编号的**首尾**，中间多提几个阶段不算违规。
function stageIdsIn(text) {
  return [...new Set([...text.matchAll(/`(S\d+)`/g)].map((m) => m[1]))]
}

// ⭐ 正向自检锚：钉抽取器本身。顺带钉住「去重之后仍保持出现顺序」——这条如果失效，
// 首尾两个就不是文中写的那两个了。
test('自检：stageIdsIn() 按出现顺序抠出去重后的阶段编号', () => {
  assert.deepEqual(stageIdsIn('从 `S1` 走到 `S8`，中途经过 `S4`，再提一次 `S1`；没有反引号的 S9 不算'), [
    'S1',
    'S8',
    'S4',
  ])
})

for (const f of [README_EN, README_ZH]) {
  test(`${f} 写的阶段链端点与 stages.json 的首尾两个键一致`, () => {
    const named = stageIdsIn(read(f))
    assert.deepEqual(
      [named[0] ?? null, named.at(-1) ?? null],
      [STAGE_IDS[0], STAGE_IDS.at(-1)],
      `${f} 写的阶段链端点与 stages.json 对不上——阶段链在 M2a 从 S5 接到了 S8，` +
        '这句话是随那一次改动过期的那一族之一',
    )
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
  // `node --test tests/` 的收集行为，而是 Node 的递归保护，恒绿且毫无意义。
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
