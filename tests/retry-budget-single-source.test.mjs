// 「平台对 `SubagentStop` 的重试顶多少下」这份知识，**只准写在一处**。
//
// 为什么需要这一份（M3g）：这份知识此前在**八句话、六个文件**里各写了一份——
// `hooks/gate.mjs` 的 H5a 告警正文、`hooks/lib/deliverable.mjs` 两处、
// `hooks/lib/deny.mjs`、`stages.README.md`、`tests/deliverable.test.mjs`、
// `tests/gate-deliverable.test.mjs`、`tests/gate-dispatch.test.mjs`。
// 上一轮实测（`docs/19` §11.5.2）订正这个数时点名了其中**两个文件**，
// 另外四个文件一个字没动：**五句写的是中文数字**（「九次」「约九次」「最多九次」），
// 按词形扫一遍只捞得到 ASCII 那三句。`docs/16` §3.4 说的正是这个上限，
// §3.6 说的正是「更正只作用到它逐字点名的那一句上」——这两条在同一份知识上同时兑现。
// 逐句、成因与那个数本身的裁定在 `docs/11` §5.29。
//
// **所以本判据钉的不是那个数对不对，是「它只剩一处」这个性质。**
// 单一真源是 `hooks/lib/retry-budget.mjs`；别处一律只准指向它，不准再写一遍计数。
//
// ⚠️ 本判据扫的是**散文**，而本仓库反复栽在「看起来能钉、其实钉的是注释」上。
// 这一条为什么不属于那一族：它要钉的性质**本身就是散文的性质**
// （「这句话里还有没有那个数」），不是「谁会不会照着散文做」。
// 变异（往任何一份在扫文件里写一句「平台约 9 次后静默放行」）**当场红**，实测过。
//
// 写法仿 `tests/twin-list-sync.test.mjs`（独立小文件 + 抽取器写成本文件内的具名函数，
// 主判据与自检锚共用同一份——`docs/16` §3.2：锚要钉在判据真正进入 assert 的那一层）
// 与 `tests/agents.test.mjs`（先钉遍历集合的**身份**，再让后面每条循环判据靠它兜底）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import { SUBAGENT_STOP_RETRY_NOTE } from '../hooks/lib/retry-budget.mjs'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

// 两个被排除的文件，各有各的理由，都写在这里而不是悄悄跳过：
//   · 单一真源本身当然写着这个数——那正是它存在的理由；
//   · 本文件自己：下面「自检」那条要拿**已知违规样本**去喂抽取器（中文数字一份、
//     ASCII 一份），样本必须长得跟真违规一模一样，否则它证明不了抽取器认得出真货。
//     同样的手法在 `tests/agents.test.mjs` 的 hasBoundary / statesPathsEscape 两条
//     自检里用过。⚠️ 代价说清楚：**本文件里真写第二份知识，这条判据不会红**——
//     它是判据自己的盲区，不是别处的。
const SOURCE = 'hooks/lib/retry-budget.mjs'
const SELF = 'tests/retry-budget-single-source.test.mjs'
const NOT_SCANNED = new Set([SOURCE, SELF])

// `docs/` 整体在外：那里全是**带日期的实测记录**，写的是「当时量到几次」，
// 不是「平台的上限是几」。改它们与 `docs/16` §3.6「原话不改」冲突，
// 而且它们正是本文件头部那份四次观测清单的出处。
// 其余几个是工作区目录，不是仓库内容。
const SKIP_DIRS = new Set(['.git', '.claude', '.superpowers', 'node_modules', 'scratchpad', 'docs'])
const TEXT_EXT = ['.mjs', '.js', '.json', '.md']

// 「一次」被排除：它在中文里是「一趟／一回」，表达不了「平台顶了 N 下」这个计数。
// 不排除它，仓库里每一句「一次通过」「一次派发」都会撞上来，判据会被噪音淹掉而
// 没人再看它——这与关掉它是同一个结果。
const COUNT_RE = /(?!一次)(?:[0-9]+|[一二三四五六七八九十]+)\s*次/g

// 话题词：**只认这一件事**，不认泛泛的「上限」。
// 「上限」单独拿来用会把 `tests/rework-guard.test.mjs` 里返工预算的硬上限
// （「history 里 S5 出现 4 次……已经在硬上限」）一并扫进来——那是另一件事，
// 判据把它报出来就是假阳性，而假阳性会让下一个人把整条判据放宽。
const TOPIC = [
  'SubagentStop',
  '静默放行',
  '顶回去',
  '顶回',
  '补救机会',
  '重试上限',
  '重试有上限',
  '重试预算',
]

// 次数表达与话题词之间的距离。太小会漏掉跨行的写法（六份原文里有三份的数字和
// 话题词分在两行注释上），太大会把不相干的段落黏进同一个窗口。
const WINDOW = 40

// 唯一一条豁免，按**原文字面量**豁免，不按文件豁免。
//
// `agents/at-architect.md` 那一句写的是「这是实测发生过的，一次派发被顶了八次」
// ——它记的是**某一次发生过的事**，不是**平台的上限是多少**。按 `docs/16` §3.5，
// 叙述性豁免覆盖「记录当时的事实」，覆盖不了「对未来的断言」，这一句属于前者：
// 它在它描述的那个时点上是真的，而且永远是真的。
// ⚠️ 它同时是本仓库对这件事的**第四个数据点**（8），记在 `docs/11` §5.29 那份
// 四次观测清单里——不是漏网的，是清点过之后留下的。
// ⚠️ 按字面量豁免而不按文件豁免：同一份角色正文里**再写一句**关于上限的话，
// 照样红。下面「豁免只命中一处」那条钉着这条豁免本身不会长胖。
const EXEMPT = [
  {
    text: '一次派发被顶了八次',
    why: 'agents/at-architect.md：记一次发生过的事，不是断言上限（docs/16 §3.5；docs/11 §5.29 的第四个数据点）',
  },
]

// ---------------------------------------------------------------------------
// 抽取器（主判据与下面每条自检锚共用同一份）
// ---------------------------------------------------------------------------

/** 仓库里要扫的那些文本文件，路径一律用 `/` 归一，便于在失败文案里直接抄。 */
function scannedFiles(root = REPO_ROOT) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (TEXT_EXT.some((e) => name.endsWith(e))) out.push(relative(root, abs).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/**
 * 一段文本里「次数表达挨着话题词」的全部出现。
 * 窗口内的空白一律压成单空格——本仓库的换行符是混的（`docs/11` §5.28），
 * 不压的话 CRLF 的那几份会算出不同的窗口内容。
 */
function retryCountMentions(text) {
  const hits = []
  for (const m of text.matchAll(COUNT_RE)) {
    const i = m.index
    const window = text.slice(Math.max(0, i - WINDOW), i + m[0].length + WINDOW).replace(/\s+/g, ' ')
    const topics = TOPIC.filter((w) => window.includes(w))
    if (topics.length) hits.push({ count: m[0], topics, window })
  }
  return hits
}

/**
 * 豁免只作用在**原文字面量**上。
 * ⚠️ 比之前先把两侧的空白全部去掉：被豁免的那一句在原文里**跨行**
 * （「……被顶了」换行「八次。」），窗口归一化之后中间留着一个空格，
 * 照字面量比会比不中——初稿就栽在这里，豁免整条形同虚设。
 */
const squash = (s) => s.replace(/\s+/g, '')
const isExempt = (hit) => EXEMPT.some((e) => squash(hit.window).includes(squash(e.text)))

// ---------------------------------------------------------------------------
// 一、锚：遍历的集合不是空的，而且**身份**对
// ---------------------------------------------------------------------------
//
// 没有这一条，把 SKIP_DIRS 写错、或者 TEXT_EXT 漏一个扩展名，下面的主判据会安静
// 地全绿——因为它从未真正读过该读的文件（`docs/11` §3.3 第 2 条）。
// 钉身份不只钉数量：这六个文件正是**此前各写了一份的那六个**。
const MUST_SCAN = [
  SOURCE,
  'hooks/gate.mjs',
  'hooks/lib/deliverable.mjs',
  'hooks/lib/deny.mjs',
  'stages.README.md',
  'tests/deliverable.test.mjs',
  'tests/gate-deliverable.test.mjs',
  'tests/gate-dispatch.test.mjs',
  'agents/at-architect.md',
]
test('锚：扫到的文件里确实有此前各写过一份的那几个——否则主判据在对空集合或半个集合空转', () => {
  const files = scannedFiles()
  for (const f of MUST_SCAN) {
    assert.ok(
      files.includes(f),
      `${f} 不在扫描集合里。\n` +
        '  这条红了不代表那份知识散开了，代表**主判据已经不知道自己在扫什么**：\n' +
        '  多半是 SKIP_DIRS / TEXT_EXT 改坏了，或者文件被改名了（改名的话连同\n' +
        '  MUST_SCAN 一起改）。实际扫到的前几个：' +
        files.slice(0, 8).join('、'),
    )
  }
})

// ---------------------------------------------------------------------------
// 二、锚：抽取器认得出这份知识，也认得出跟它无关的东西
// ---------------------------------------------------------------------------
//
// 正向那一半**直接拿单一真源导出的那个常量当样本**：它既证明抽取器不是恒为空，
// 也证明**单一真源确实还写着这份知识**——把那个常量掏空成一句不含计数的话，
// 这一条当场红（`docs/16` §3.2：锚要钉在判据真正进入 assert 的那一层）。
test('自检：抽取器在单一真源那句话上命中，在已知的三种反例上不命中', () => {
  const onSource = retryCountMentions(SUBAGENT_STOP_RETRY_NOTE)
  assert.ok(
    onSource.length > 0,
    'hooks/lib/retry-budget.mjs 导出的那句话里抽不出「次数 + 话题词」。\n' +
      '  要么抽取器坏了，要么**单一真源已经不写这份知识了**——后者更要紧：\n' +
      '  那意味着别处的「指向 retry-budget.mjs」全部指向了一个空壳，\n' +
      '  而下面的主判据照样全绿。',
  )

  // 中文数字与 ASCII 两种词形都要认得——本文件存在的直接原因就是上一轮只认了 ASCII。
  assert.ok(retryCountMentions('平台约 9 次后静默放行').length > 0, 'ASCII 数字那一形没认出来')
  assert.ok(retryCountMentions('最多九次，然后平台静默放行').length > 0, '中文数字那一形没认出来')
  assert.ok(retryCountMentions('被无故顶回去约九次').length > 0, '「顶回去」那一形没认出来')

  // 三种反例：没有计数、计数与话题词离得远、计数属于**另一件事**（返工硬上限）。
  assert.deepEqual(retryCountMentions('平台到点会静默放行，顶多少下见 retry-budget.mjs'), [])
  assert.deepEqual(retryCountMentions(`静默放行${'。'.repeat(WINDOW + 5)}九次`), [])
  assert.deepEqual(
    retryCountMentions('history 里 S5 出现 4 次、rework.S5 = 3，已经在硬上限'),
    [],
    '返工预算的硬上限被当成了重试上限——TOPIC 里混进了「上限」这种泛词',
  )
})

// ---------------------------------------------------------------------------
// 三、锚：豁免只命中它被写出来的那一处
// ---------------------------------------------------------------------------
//
// 一条命中不到任何东西的豁免是死条目（下次清理时没人敢删）；一条命中两处以上的
// 豁免是个洞（它替第二处也挡了枪）。两头都要钉。
test('锚：唯一那条豁免在全仓恰好命中一处', () => {
  // 只在**主判据真正看的那些文件**里数：本文件自己的 EXEMPT 数组里也写着这句原文，
  // 把它算进来这条恒为 2。
  const files = scannedFiles().filter((f) => !NOT_SCANNED.has(f))
  for (const e of EXEMPT) {
    // 同样先去空白——那一句在原文里是跨行的。
    const where = files.filter((f) => squash(readFileSync(join(REPO_ROOT, f), 'utf8')).includes(squash(e.text)))
    assert.deepEqual(
      where.length,
      1,
      `豁免原文「${e.text}」在 ${where.length} 个文件里出现（要求恰好 1）：${where.join('、')}。\n` +
        `  理由：${e.why}\n` +
        '  出现 0 次 = 那句话被改写或删了，豁免成了死条目，删掉它；\n' +
        '  出现 2 次以上 = 这条豁免正在替第二处挡枪，把它写得更窄。',
    )
  }
})

// ---------------------------------------------------------------------------
// 四、主判据：这份知识只剩一处
// ---------------------------------------------------------------------------
test('「平台重试顶多少下」这个计数只写在 hooks/lib/retry-budget.mjs 一处', () => {
  const found = []
  for (const f of scannedFiles()) {
    if (NOT_SCANNED.has(f)) continue
    for (const hit of retryCountMentions(readFileSync(join(REPO_ROOT, f), 'utf8'))) {
      if (!isExempt(hit)) found.push(`${f} :: ${hit.count} :: [${hit.topics.join(',')}] :: ${hit.window}`)
    }
  }
  assert.deepEqual(
    found,
    [],
    '这份知识又散出了第二处：\n' +
      found.map((s) => `    ${s}`).join('\n') +
      '\n' +
      `  单一真源是 ${SOURCE}，别处只指向它、不复写计数。\n` +
      '  ⚠️ **不要把这里的数字改对就算了**——它本来就不是一个常数（四次观测落在\n' +
      '  8/8/9/10，三种数法），完整裁定在 `docs/11` §5.29。要写的是一句指路的话。\n' +
      '  这条判据存在的理由：上一轮订正这个数时点名了两个文件，另外四个文件里\n' +
      '  中文数字那几句一个字没动，而没有任何东西因此变红（`docs/16` §3.4 / §3.6）。',
  )
})
