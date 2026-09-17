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

test('project.json 模板带齐 /at-init 要填的四类信息', () => {
  const p = readJson('templates/project.json')
  for (const k of ['paths', 'stack', 'build', 'test']) {
    assert.ok(Object.hasOwn(p, k), `模板缺 ${k}（规格 §7.1：路径归属、技术栈、构建与测试命令）`)
  }
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
