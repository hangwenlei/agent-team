// 单个微调。纯函数，I/O 由 gate.mjs、runctx.mjs 注入。
//
// 微调是一趟 state.json 里 mode 为 tweak 的 run（/agent-team:at-tweak 起）：门禁按插件根的 stages.tweak.json 判（S1 记原话 → S4 派发 → S5 来回改 →
// S6 跑测试 → S8 交付；段号与产物名沿用正常链），项目经理在这一趟里直接派实现段的产者（派发白名单只换项目经理两行，由短链现算），用户点「可以了，收尾」
// 才推得出实现段（批准记录器记进 approvals.jsonl，绑在那一刻的契约 sha 上）。没有 mode 或 mode 为 full 的一趟一切照旧。
// 键名叫 mode 不叫 kind：state.json 的已知键两两至少差四步（拼错时只指向一个），kind 与 run_id 太像。
import { PLUGIN_PREFIX } from './decide.mjs'
import { isPlainObject, isStageChain, isRolePatternStage, stageRoles } from './stages.mjs'

export const TWEAK_MODE = 'tweak'
export const FULL_MODE = 'full'
export const TWEAK_STAGES_FILE = 'stages.tweak.json'
export const STAGES_FILE = 'stages.json'
// 规范标签：用户看过这一轮、满意了。
export const DONE_LABEL = '可以了，收尾'
// approvals.jsonl 里那一行的 kind。
export const DONE_KIND = 'tweak-done'
export const TWEAK_COMMAND = `${PLUGIN_PREFIX}at-tweak`

const PM_ROWS = ['__main__', 'at-pm']

/** 这一趟是哪种：mode 恰好是 tweak 才是微调；缺、full、坏值一律按完整的一趟（坏值由 validateState 报）。 */
export function modeOf(state) {
  return isPlainObject(state) && state.mode === TWEAK_MODE ? TWEAK_MODE : FULL_MODE
}

/** 这一趟按哪份阶段链判（插件根下的文件名）。 */
export function stagesFileFor(state) {
  return modeOf(state) === TWEAK_MODE ? TWEAK_STAGES_FILE : STAGES_FILE
}

/**
 * 微调这一趟的派发白名单：只把项目经理两行（__main__、at-pm）的 can_delegate_to 换成短链里不归项目经理的那几段的参与者，别的行原样。
 * 返回新对象，入参不变。短链读不出来时原样返回（按正常花名册判，更严）。
 */
export function tweakRoster(roster, tweakStages) {
  if (!isPlainObject(roster) || !isStageChain(tweakStages)) return roster
  const roles = []
  for (const stage of Object.values(tweakStages)) {
    if (stage.role === 'at-pm') continue
    for (const r of stageRoles(stage)) if (!roles.includes(r)) roles.push(r)
  }
  const out = { ...roster }
  for (const row of PM_ROWS) {
    if (Object.hasOwn(roster, row) && isPlainObject(roster[row])) out[row] = { ...roster[row], can_delegate_to: [...roles] }
  }
  return out
}

/** 实现段：第一个按产者展开产物的段（正常链与短链都是 S5）。 */
export function implStageOf(stages) {
  if (!isStageChain(stages)) return null
  return Object.keys(stages).find((id) => isRolePatternStage(stages[id])) ?? null
}
