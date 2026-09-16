import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideContractGuard } from '../hooks/lib/contract-guard.mjs'

const RUN = '/proj/.agent-team/runs/r1'
const CONTRACT = `${RUN}/00-contract.md`

test('subagent 写契约一律拒绝', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: CONTRACT, runDir: RUN })
  assert.equal(r.decision, 'deny')
})

test('拒绝理由说明契约的唯一写者是用户', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: CONTRACT, runDir: RUN })
  assert.match(r.reason, /用户|PM/)
})

test('主线程（无 agent_type）写契约放行——那是 PM 代用户转写', () => {
  const r = decideContractGuard({ agentType: undefined, filePath: CONTRACT, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('subagent 写别的产物放行', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: `${RUN}/01-prd.md`, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('绕路径写契约也拒绝', () => {
  const r = decideContractGuard({
    agentType: 'agent-team:at-product',
    filePath: `${RUN}/05-impl/../00-contract.md`,
    runDir: RUN,
  })
  assert.equal(r.decision, 'deny')
})

test('runDir 为空时不表态——无法判定哪个是契约', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: CONTRACT, runDir: null })
  assert.equal(r.decision, 'allow')
})

// 以下是简报 6 条之外补的覆盖。任务说明点名的四类历史问题（恒真断言、
// 退化路径输入、大小写/分隔符、注释与代码不一致）逐条对应到下面的分组。

// ── PM/主线程判定不是简单的 "!agentType" ──────────────────────────────
//
// 本仓库自己的 settings.json 就是 {"agent": "at-pm"}——M0 实测「次要事实」
// （docs/05-M0-结论.md 第 193 行）：被钉住的主会话，自己的工具调用会带裸
// 的 agent_type: 'at-pm'，不是 undefined。如果 H4 只认"没有 agent_type"，
// 在这个仓库的真实配置下契约会永远写不出来——这不是要不要测的问题，是
// 这个仓库能不能自举的问题。H3 已经认了同一个事实（tests/gate-writepath.
// test.mjs「被 settings.json 钉成主线程的 at-pm...写...00-contract.md
// 不受阻」），H4 不能不认。

test('agent_type 是空字符串——不当作主线程，按 subagent 处理（口径与 callerOf 一致）', () => {
  const r = decideContractGuard({ agentType: '', filePath: CONTRACT, runDir: RUN })
  assert.equal(r.decision, 'deny')
})

test('被 settings.json 钉成主线程的 at-pm（裸 agent_type "at-pm"）写契约放行', () => {
  const r = decideContractGuard({ agentType: 'at-pm', filePath: CONTRACT, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('agent_type 带插件前缀 "agent-team:at-pm" 同样按 at-pm 处理——剥前缀口径与 H1/H3 一致', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-pm', filePath: CONTRACT, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

// ── 拒绝理由要说明"为什么"，不能只说"不许" ──────────────────────────

test('拒绝理由要说明后果（查不出来/制造假象），不能只是一句禁止', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: CONTRACT, runDir: RUN })
  assert.match(r.reason, /查不出|验收|假象/)
})

// ── filePath 退化输入：没有可判定的目标路径就不表态 ──────────────────

test('filePath 缺失（undefined）时放行——没有可判定的目标路径', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: undefined, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('filePath 不是字符串（数字）时放行——没有可判定的目标路径', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: 42, runDir: RUN })
  assert.equal(r.decision, 'allow')
})

test('filePath 是空字符串时放行——没有可判定的目标路径', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: '', runDir: RUN })
  assert.equal(r.decision, 'allow')
})

// ── Windows 路径退化：大小写、分隔符、相对路径 ────────────────────────
// 本机就是 Windows（Global Constraints），不能只靠 POSIX 字符串心理暗示
// "大小写/分隔符处理应该也对"——hooks/lib/writepath.mjs 的 norm() 曾经
// 因为漏了 .toLowerCase() 被评审当场实测抓到（Task 4 评审 Important 1），
// H4 比对契约路径时是同一类风险，这里真的在 Windows 上验证。

test('Windows 路径段/文件名大小写不同仍判定为同一份契约文件——不能被大小写绕过 fail closed', () => {
  if (process.platform !== 'win32') return
  const r = decideContractGuard({
    agentType: 'agent-team:at-product',
    filePath: `${RUN.toUpperCase()}/00-CONTRACT.MD`,
    runDir: RUN,
  })
  assert.equal(r.decision, 'deny')
})

// resolve() 保留调用方给的原始大小写，而 runDir 走 resolve('/proj/...') 时
// 盘符大小写来自 process.cwd()——两者不同源，不能假设两次 resolve() 出来的
// 盘符大小写碰巧一致。
test('Windows 盘符大小写不同（与 runDir 解析出的盘符不同源）仍判定为同一份契约文件', () => {
  if (process.platform !== 'win32') return
  const r = decideContractGuard({
    agentType: 'agent-team:at-product',
    filePath: 'c:\\proj\\.agent-team\\runs\\r1\\00-contract.md',
    runDir: RUN,
  })
  assert.equal(r.decision, 'deny')
})

test('反斜杠路径与正斜杠 runDir 等价——分隔符差异不能造成误判', () => {
  const r = decideContractGuard({
    agentType: 'agent-team:at-product',
    filePath: `${RUN.replace(/\//g, '\\')}\\00-contract.md`,
    runDir: RUN,
  })
  assert.equal(r.decision, 'deny')
})

// 相对路径按 process.cwd()（测试进程自己的 cwd，跟 RUN 这个虚构前缀无关）
// 解析，不能被字符串上"看起来像"契约文件名就误判成契约本身——这条专门
// 排除"用 filePath.endsWith(CONTRACT) 之类的字符串比较代替真实路径解析"
// 这一类实现。
test('相对路径按 cwd 解析，不会因为文件名"看起来像"契约就被误判', () => {
  const r = decideContractGuard({ agentType: 'agent-team:at-product', filePath: '00-contract.md', runDir: RUN })
  assert.equal(r.decision, 'allow')
})
