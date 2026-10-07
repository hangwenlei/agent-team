// 第 47 条（docs/48，M4m）：「还开着什么」有一份活的索引 docs/00-开放边界.md。原来要知道还开着什么，得读十几份带日期的记录、几千行。
// docs/15 起的每一份记录，凡是记「当时没关上的」小节——仍然开着的边界、没量到的、没能验证的项、没做的、不做的与仍然开着的、新登记的已知边界——
// 都要在索引里被点到（写成 `docs/NN` §M）：新写一份记录忘了登进索引，这里红。索引里点到的每一节都要真的在：指针不悬空。
// 索引只管「点到」与「指得到」，不读每一条是不是真的还开着——那由写收口的人在关上一条时顺手从索引里删掉（HANDOFF 的长期决策）。
// 复核（docs/48 §8）：起点从 docs/20 挪到 docs/15（之前几份也有没量到的）；指针按边界认（§5.1 不算点到 §5，§10 不算点到 §1）；最新一份从目录里读；
// 标题认到四级、多层编号。认不出的写法（不在标题里、换了说法）照旧认不出——写在修法小节里的「没做的」就是这样漏过三轮的（docs/48 §4）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const INDEX = 'docs/00-开放边界.md'
// docs/15 之前的是调研、里程碑结论与 docs/11 那本登记簿（docs/11 里还开着的在索引 §4 单列，靠人登）。
const FROM = 15
const OPEN_HEADING = /^#{2,4} (\d+(?:\.\d+)*)\.? .*(仍然开着|还开着的边界|没量到|没量的|没能验证|没做的|不做的|已知边界)/

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// 编号 → 那一份记录（docs/24 有一份附录，指针指的是正文那份）。
function recordOf(nn) {
  const hits = readdirSync(DOCS).filter((f) => f.startsWith(`${nn}-`) && f.endsWith('.md') && !f.includes('附录'))
  return hits.length === 1 ? `docs/${hits[0]}` : null
}

function datedRecords() {
  return readdirSync(DOCS)
    .filter((f) => /^\d{2}-.*\.md$/.test(f) && !f.includes('附录') && Number(f.slice(0, 2)) >= FROM)
    .map((f) => ({ nn: f.slice(0, 2), rel: `docs/${f}` }))
}

function openSectionsOf(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = OPEN_HEADING.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

const pointer = (nn, sec) => `\`docs/${nn}\` §${sec}`
// 点到：指针后面不能紧跟着「数字」或「. 数字」——否则 §5.1 会顶替 §5、§10 会顶替 §1。
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
const pointsAt = (index, nn, sec) => new RegExp(escapeRe(pointer(nn, sec)) + '(?!\\.?\\d)').test(index)

test('自检：openSectionsOf() 认得出几种写法，不把别的小节算进来', () => {
  const sample = ['## 4. 仍然开着的边界', '## 5. 没量到的', '### 2.10 没做的', '## 7. 没能验证的项 —— 逐条', '## 4. 不做的与仍然开着的',
    '#### 7.1.1 还开着的边界', '## 4. 本轮新登记的已知边界', '## 3. 实测', '### 5.1 夹具', '### 1.2 第 47 条：还开着什么、活的事实放哪']
  assert.deepEqual(openSectionsOf(sample.join('\n')), ['4', '5', '2.10', '7', '4', '7.1.1', '4'])
})

test('自检：pointsAt() 按边界认——§5.1 不算点到 §5，§10 不算点到 §1，句末的句号不碍事', () => {
  assert.equal(pointsAt('见 `docs/20` §5.1 那一条', '20', '5'), false)
  assert.equal(pointsAt('见 `docs/20` §10（没量到的）', '20', '1'), false)
  assert.equal(pointsAt('见 `docs/20` §5。', '20', '5'), true)
  assert.equal(pointsAt('- `docs/20` §5（没量到的）：', '20', '5'), true)
})

test('第 47 条：docs/15 起每一份记录里记「当时没关上的」小节，都在 docs/00-开放边界.md 里被点到', () => {
  const index = read(INDEX)
  const records = datedRecords()
  const latest = records.map((r) => r.nn).sort().at(-1)
  const all = records.flatMap(({ nn, rel }) => openSectionsOf(read(rel)).map((sec) => ({ nn, rel, sec })))
  assert.ok(all.length > 0 && all.some((s) => s.nn === latest), `前置：一节都没认出来，或者最新一份记录（docs/${latest}）没被扫到——这条判据空转了`)
  const missing = all.filter(({ nn, sec }) => !pointsAt(index, nn, sec)).map(({ nn, rel, sec }) => `${pointer(nn, sec)}（${rel}）`)
  assert.deepEqual(missing, [], '这几节没登进开放边界的索引：每一节写一行，开着的逐条列，全关上了也写一行说关在哪')
})

test('第 47 条：docs/00-开放边界.md 点到的每一节都真的在——`docs/NN` §M 指得到那一份记录里那个编号的标题', () => {
  const index = read(INDEX)
  const refs = [...index.matchAll(/`docs\/(\d{2})` §(\d+(?:\.\d+)*)/g)].map((m) => ({ nn: m[1], sec: m[2] }))
  assert.ok(refs.length > 0, '前置：索引里一个指针都没抽到')
  const dangling = []
  for (const { nn, sec } of refs) {
    const rel = recordOf(nn)
    if (!rel || !new RegExp(`^#{2,4} ${escapeRe(sec)}(\\.|\\s)`, 'm').test(read(rel))) dangling.push(pointer(nn, sec))
  }
  assert.deepEqual([...new Set(dangling)], [])
})
