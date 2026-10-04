// 审查第 18 条（M4c，docs/37）：H5b 认「冒泡」这个出口。
//
// 各角色正文叫它们「契约有问题、缺输入、被拒就冒泡，不要自己改了继续写」；H5b 的拒绝文案也许诺「把理由写进你的回报，由上级判断」。
// 可 H5b 从不读 SubagentStop 输入里的 stop_hook_active 与 last_assistant_message，照做的子代理每次停下都被 exit 2 顶回去，
// 直到平台的续跑上限——真实会话 066acaaa 里 at-qa 被顶了九回、约一百秒，父级拿到的是一次普通的完成（docs/35 §4、docs/37 §1）。
//
// 出口的形状（docs/37 §2.1）：已经被拦过一回（stop_hook_active 为真），而且最后一条回复的第一个非空行以「冒泡：」开头，就放行。
//   - 要 stop_hook_active：子代理第一回停下一定先看到「缺的是什么」——忘了写的会去写，真要冒泡的原样再停一回。
//   - 只认第一行：标记夹在正文中间不算，免得一段顺带提到「冒泡」的回报被当成冒泡。
//   - 放行是 exit 0、什么都不写：SubagentStop 上 stdout 或 additionalContext 都等于拦截（hooks/lib/fail-open.mjs）。
//   - 产物照旧算没交：冒泡不改「交没交」的语义——下一段的前置（H2）与收口照常判缺，【阶段】不说齐了；推进本身不核缺产物
//     （第 17 条，docs/37 §5），不在任何前置里的那几份冒泡之后照样能被推进过去，与原来顶到平台上限被静默放行是同一个洞。
// 输入照 CLI 2.1.286 实测的键（docs/37 §1）；这里只放 H5b 读得到的那几个。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { run, GATE } from './helpers/gate-runner.mjs'
import { makeRun } from './fixtures/make-run.mjs'
import { BUBBLE_MARK } from '../hooks/lib/deliverable.mjs'
import { sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const stop = (agent, { active, message } = {}) => ({
  hook_event_name: 'SubagentStop',
  agent_type: agent,
  agent_id: 'a0000000000000001',
  ...(active === undefined ? {} : { stop_hook_active: active }),
  ...(message === undefined ? {} : { last_assistant_message: message }),
})

const REASON = '契约第 3 条要求离线可用，第 5 条要求实时同步，两条互相冲突，要上级定先保哪一条。'
const BUBBLE = `${BUBBLE_MARK}${REASON}\n\n冲突的两条原文如下……`

function inRun(opts, body) {
  const dirs = makeRun({ runId: 'r1', ...opts })
  try {
    return body(dirs)
  } finally {
    rmSync(dirs.projectDir, { recursive: true, force: true })
    rmSync(dirs.pluginDir, { recursive: true, force: true })
  }
}

// S3：at-architect 该交 03-arch.md、03-alignment.md，两份都没写。
const S3 = { stage: 'S3' }
const ARCH = 'agent-team:at-architect'

test('M4c 前置：标记是一个非空的固定串，以全角冒号收尾', () => {
  assert.equal(typeof BUBBLE_MARK, 'string')
  assert.ok(BUBBLE_MARK.length > 1 && BUBBLE_MARK.endsWith('：'), BUBBLE_MARK)
})

test('M4c H5b：被拦过一回（stop_hook_active 为真）、最后一条回复第一行是「冒泡：」→ 放行，什么都不写', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { active: true, message: BUBBLE }), GATE, dirs.projectDir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '', '放行冒泡不留告警：SubagentStop 上留了也没人看得见，留了反倒像是门禁出了问题')
  })
})

test('M4c H5b：第一回停下（stop_hook_active 为假）带着标记 → 照拦，拒绝文案教的就是这个标记、并说原样再停一回', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { active: false, message: BUBBLE }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /03-arch\.md/, '先让它看到缺的是什么')
    assert.ok(r.stderr.includes(BUBBLE_MARK), r.stderr)
    assert.ok(r.stderr.includes('原样再发一遍'), r.stderr)
  })
})

test('M4c H5b：stop_hook_active 为真、回报里没有标记 → 照拦', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { active: true, message: '我觉得契约有问题，请上级判断。' }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
  })
})

test('M4c H5b：stop_hook_active 为真、没有 last_assistant_message 这个键（最后一块没有文字时 CLI 不带它）→ 照拦', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { active: true }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
  })
})

test('M4c H5b：标记不在第一个非空行（夹在正文里）→ 照拦', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { active: true, message: `我看了契约。\n${BUBBLE}` }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
  })
})

test('M4c H5b：没写 stop_hook_active（键缺失）带着标记 → 照拦（只认 true）', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { message: BUBBLE }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
  })
})

test('M4c H5b：标记前面带 Markdown 装饰（加粗、标题、引用、列表）、前面有空行、用半角冒号 → 都认', () => {
  const plain = BUBBLE_MARK.slice(0, -1)
  for (const message of [
    `**${BUBBLE_MARK}**${REASON}`,
    `**${BUBBLE_MARK.slice(0, -1)}**：${REASON}`,
    `${BUBBLE_MARK.slice(0, -1)} ：${REASON}`,
    `# ${BUBBLE_MARK}${REASON}`,
    `> ${BUBBLE_MARK}${REASON}`,
    `- ${BUBBLE_MARK}${REASON}`,
    `\n\n  ${BUBBLE_MARK}${REASON}`,
    `${plain}:${REASON}`,
  ]) {
    inRun(S3, (dirs) => {
      const r = run('stop-gate', stop(ARCH, { active: true, message }), GATE, dirs.projectDir)
      assert.equal(r.status, 0, `${JSON.stringify(message)} → ${r.stderr}`)
    })
  }
})

test('M4c H5b：只是以「冒泡」两个字开头、没有冒号（例：「冒泡排序」）→ 照拦', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { active: true, message: `${BUBBLE_MARK.slice(0, -1)}排序写完了` }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
  })
})

test('M4c H5b：last_assistant_message 不是字符串 → 照拦', () => {
  inRun(S3, (dirs) => {
    const r = run('stop-gate', stop(ARCH, { active: true, message: 42 }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
  })
})

test('M4c H5b：产物齐了时带不带标记都放行（冒泡只在要拦的时候才被读）', () => {
  inRun({ ...S3, artifacts: ['03-arch.md', '03-alignment.md'] }, (dirs) => {
    for (const s of [stop(ARCH, { active: true, message: BUBBLE }), stop(ARCH, { active: false, message: '写完了' })]) {
      const r = run('stop-gate', s, GATE, dirs.projectDir)
      assert.equal(r.status, 0, r.stderr)
      assert.equal(r.stderr, '')
    }
  })
})

// 返工轮：产物还是上一轮的（磁盘内容与 rework_base 记的 sha 相同）。这一支的拒绝文案原来也许诺「不要写，把理由写进你的回报」。
function staleRun(body) {
  return inRun({ stage: 'S6', roster: ['at-qa'] }, (dirs) => {
    const runDir = join(dirs.projectDir, '.agent-team', 'runs', 'r1')
    const text = 'test r1\n'
    mkdirSync(dirname(join(runDir, '06-test.md')), { recursive: true })
    writeFileSync(join(runDir, '06-test.md'), text, 'utf8')
    const stages = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S5', 'S6']
    writeFileSync(
      join(runDir, 'state.json'),
      JSON.stringify({
        run_id: '20261004-1200-fixture',
        stage: 'S6',
        contract_sha: 'PENDING',
        roster: ['at-qa'],
        artifacts: {},
        rework: { S5: 1, S6: 1 },
        never_invoked: [],
        escalations: [],
        history: stages.map((stage) => ({ stage, at: '2026-10-04T12:00:00Z' })),
        rework_base: { '06-test.md': sha256OfContract(text) },
      }),
      'utf8',
    )
    return body(dirs)
  })
}

test('M4c H5b 返工轮：产物还是上一轮的，冒泡（被拦过一回、第一行是标记）→ 放行', () => {
  staleRun((dirs) => {
    const r = run('stop-gate', stop('agent-team:at-qa', { active: true, message: `${BUBBLE_MARK}没开跑——S5 没交齐` }), GATE, dirs.projectDir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stderr, '')
  })
})

test('M4c H5b 返工轮：产物还是上一轮的，不带标记 → 照拦，文案同样教标记', () => {
  staleRun((dirs) => {
    const r = run('stop-gate', stop('agent-team:at-qa', { active: true, message: '核过了，不用改。' }), GATE, dirs.projectDir)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /06-test\.md 还是上一轮的/)
    assert.ok(r.stderr.includes(BUBBLE_MARK), r.stderr)
  })
})
