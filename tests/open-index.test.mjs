// 第 47 条（docs/48，M4m）：「还开着什么」有一份活的索引 docs/00-开放边界.md。原来要知道还开着什么，得读十几份带日期的记录、几千行。
// docs/20 起的每一份记录，凡是记「当时没关上的」小节——仍然开着的边界、没量到的、没能验证的项、没做的、不做的与仍然开着的、本轮新登记
// 的已知边界——都要在索引里被点到（写成 `docs/NN` §M）：新写一份记录忘了登进索引，这里红。索引里点到的每一节都要真的在：指针不悬空。
// 索引只管「点到」与「指得到」，不读每一条是不是真的还开着——那由写收口的人在关上一条时顺手从索引里删掉（HANDOFF 的长期决策）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const INDEX = 'docs/00-开放边界.md'
// docs/20 之前的是调研、里程碑结论与 docs/11 那本登记簿；docs/20 起的记录都按「当时没关上的」小节收尾。
const FROM = 20
const OPEN_HEADING = /^#{2,3} (\d+(?:\.\d+)?)\.? .*(仍然开着|没量到|没能验证|没做的|不做的|新登记的已知边界)/

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

test('自检：openSectionsOf() 认得出几种写法，不把别的小节算进来', () => {
  const sample = ['## 4. 仍然开着的边界', '## 5. 没量到的', '### 2.10 没做的', '## 7. 没能验证的项 —— 逐条', '## 4. 不做的与仍然开着的', '## 3. 实测', '### 5.1 夹具']
  assert.deepEqual(openSectionsOf(sample.join('\n')), ['4', '5', '2.10', '7', '4'])
})

test('第 47 条：docs/20 起每一份记录里记「当时没关上的」小节，都在 docs/00-开放边界.md 里被点到', () => {
  const index = read(INDEX)
  const all = datedRecords().flatMap(({ nn, rel }) => openSectionsOf(read(rel)).map((sec) => ({ nn, rel, sec })))
  assert.ok(all.length > 0 && all.some((s) => s.nn === '47'), '前置：一节都没认出来，或者最新一份记录没被扫到——这条判据空转了')
  const missing = all.filter(({ nn, sec }) => !index.includes(pointer(nn, sec))).map(({ nn, rel, sec }) => `${pointer(nn, sec)}（${rel}）`)
  assert.deepEqual(missing, [], '这几节没登进开放边界的索引：每一节写一行，开着的逐条列，全关上了也写一行说关在哪')
})

test('第 47 条：docs/00-开放边界.md 点到的每一节都真的在——`docs/NN` §M 指得到那一份记录里那个编号的标题', () => {
  const index = read(INDEX)
  const refs = [...index.matchAll(/`docs\/(\d{2})` §(\d+(?:\.\d+)*)/g)].map((m) => ({ nn: m[1], sec: m[2] }))
  assert.ok(refs.length > 0, '前置：索引里一个指针都没抽到')
  const dangling = []
  for (const { nn, sec } of refs) {
    const rel = recordOf(nn)
    const esc = sec.replace(/\./g, '\\.')
    if (!rel || !new RegExp(`^#{2,4} ${esc}(\\.|\\s)`, 'm').test(read(rel))) dangling.push(pointer(nn, sec))
  }
  assert.deepEqual([...new Set(dangling)], [])
})
