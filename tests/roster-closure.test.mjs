import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const roster = JSON.parse(
  readFileSync(new URL('../roster.json', import.meta.url), 'utf8'),
)

const stages = JSON.parse(
  readFileSync(new URL('../stages.json', import.meta.url), 'utf8'),
)

test('每个条目都有 can_delegate_to 数组', () => {
  for (const [caller, entry] of Object.entries(roster)) {
    assert.ok(
      Array.isArray(entry.can_delegate_to),
      `${caller} 的 can_delegate_to 不是数组`,
    )
  }
})

test('can_delegate_to 里出现的每个名字本身也是花名册的键', () => {
  for (const [caller, entry] of Object.entries(roster)) {
    for (const target of entry.can_delegate_to) {
      assert.ok(
        Object.hasOwn(roster, target),
        `${caller} 可派发 ${target}，但 ${target} 不在花名册里——` +
          `受管辖角色能派出不受管辖的 agent，级联逃逸链条就此打开`,
      )
    }
  }
})

// stages.json 是第二个引用角色名的文件（第一个是 roster.json 自己），引入时
// 没有被这张网罩住——它第一天就把 S5 的 role 写成了 roster.json 里根本不
// 存在的 at-backend，直到有真实派发撞上 H1 才会被发现（Task 2 评审 I1）。
// 把「stages.json 引用的角色都在 roster.json 花名册里」也变成跟上面两条
// 一样的闭包不变量，防止同类角色名漂移再来一次。
test('stages.json 里每个阶段的 role 都必须是 roster.json 的键', () => {
  for (const [stageId, entry] of Object.entries(stages)) {
    assert.ok(
      Object.hasOwn(roster, entry.role),
      `${stageId} 声明执行角色 ${entry.role}，但 ${entry.role} 不在 roster.json 里——` +
        `H1 派发门禁会拒掉任何派向它的派发，这个阶段永远跑不到`,
    )
  }
})

// H4 契约保护（hooks/lib/contract-guard.mjs）把"被 settings.json 钉成主线程
// 的 at-pm"和 MAIN 同等对待、一并豁免——hook 输入本身分不清"被钉成主线程
// 的 at-pm"和"被派发出来的 at-pm 子代理"，两者的 agent_type 都是裸的
// 'at-pm'。这条豁免的安全性不是自己成立的，靠的是这里守住的结构性不变量：
// 当前花名册里没有任何角色能把 at-pm 当作派发目标，所以"at-pm 作为被派发
// 出来的子代理出现"这条路径根本不存在（Task 5 评审顾虑 1）。这条测试一旦
// 变红，说明有人往某个角色的 can_delegate_to 里加了 at-pm——H4 的 at-pm
// 豁免必须同步重新评估，不能继续假设 at-pm 只可能是被钉住的主线程。
test('没有任何角色能把 at-pm 当作派发目标——H4 的 at-pm 豁免依赖这条', () => {
  for (const [caller, entry] of Object.entries(roster)) {
    assert.ok(
      !entry.can_delegate_to.includes('at-pm'),
      `${caller} 的 can_delegate_to 包含 at-pm——H4 契约保护` +
        `（hooks/lib/contract-guard.mjs）把 at-pm 当作 PM 豁免，前提是没有` +
        `角色能派发给它；这个前提被打破了，需要重新评估那条豁免是否还安全`,
    )
  }
})

// ---- `__main__` 与 `at-pm` 必须镜像（M2b Task 3 修复轮 1，评审发现 6）----
//
// M2b Task 3 的裁定 B 给 `at-pm` 加 at-qa / at-acceptance 两条边时，**同时**给
// `__main__` 加了一模一样的两条。评审指出：改完之后确实有三条测试会在 `__main__`
// 被改回旧值时变红（静默表 S6/S7 两行 + tests/reach.test.mjs 的拓扑锚），**但那三条
// 守的是当前的具体值，不是「这两个键必须一致」这条规则本身**。下一次改花名册时拓扑锚
// 会红，有人照着新值更新完期望值之后，两个键悄悄分叉就再没有东西说话了。
//
// 这正是 docs/11 §5.13 刚立的那条教训：「一个不变量从来没被写下来」和「一个不变量被
// 写错了」在套件里长得一模一样——都是全绿。所以把规则本身写下来。
//
// 为什么必须镜像（docs/05-M0-结论.md 的实测结论）：**主会话就是 PM**。被 settings.json
// 的 `agent` 键钉住的主会话带 agent_type: at-pm，**未钉住的主会话按 `__main__` 处理**
// ——钉没钉住只影响它报哪个名字，不该影响它能派谁。两个键都要保留（不能合并），但内容
// 必须一致。让它们分叉的后果是 **H1 是 fail closed 的**：钉丢了的那种会话（本仓库已记录
// `claude --resume` 不继承 `--plugin-dir`、会丢掉工具面，见 docs/11 §5.5）里派 at-qa /
// at-acceptance 会被直接拒，而拒绝理由指向花名册，排查的人要翻到 docs/05 才知道是
// 「钉没钉住」的问题。
const MIRROR_KEYS = ['__main__', 'at-pm']

// ⭐ 正向自检锚：下面那条是 deepEqual，而 `assert.deepEqual(undefined, undefined)` 是
// **通过**的——两个键一起从 roster.json 里消失（或被改成没有 can_delegate_to 的形状）时，
// 它会在两个 undefined 上空转着变绿。锚钉的正是那条不变量真正读的那两个键。
test('锚：roster.json 里 __main__ 与 at-pm 两个键都在，且各自的 can_delegate_to 非空——否则下面那条在两个 undefined 上空转', () => {
  assert.ok(
    MIRROR_KEYS.every((k) => Array.isArray(roster[k]?.can_delegate_to) && roster[k].can_delegate_to.length > 0),
    `roster.json 里 ${JSON.stringify(MIRROR_KEYS)} 至少有一个不存在、或它的 can_delegate_to ` +
      '不是非空数组——下面那条「两个键必须逐字相同」是 deepEqual，两边同时取到 undefined 时' +
      '它照样通过，等于没有检查任何东西',
  )
})

test('roster.json 的 __main__ 与 at-pm 的 can_delegate_to 必须逐字相同——主会话就是 PM，钉没钉住不该影响它能派谁', () => {
  assert.deepEqual(
    roster.__main__?.can_delegate_to,
    roster['at-pm']?.can_delegate_to,
    '__main__ 与 at-pm 的 can_delegate_to 分叉了。主会话就是 PM：被 settings.json 的 agent ' +
      '键钉住的主会话带 agent_type: at-pm，未钉住的按 __main__ 处理（docs/05-M0-结论.md 的' +
      '实测结论），**钉没钉住只影响它报哪个名字，不该影响它能派谁**。两个键都要保留、不能' +
      '合并，但内容必须一致。分叉的后果是 H1 fail closed：钉丢了的那种会话里派那几个只写进' +
      '一侧的角色会被直接拒，而拒绝理由指向花名册，排查的人要翻到 docs/05 才知道根因是' +
      '「钉没钉住」。⚠️ 这条与 tests/reach.test.mjs 的拓扑锚**不是一回事**：那条说的是' +
      '「拓扑变了，回来确认触达有没有被放大」，改边时它本来就该红、更新期望值是正常动作；' +
      '这条说的是「这两个键彼此不一致」，任何时候都不该红。',
  )
})
