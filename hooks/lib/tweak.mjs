// 单个微调。纯函数，I/O 由 gate.mjs、runctx.mjs 注入。
//
// 微调是一趟 state.json 里 mode 为 tweak 的 run（/agent-team:at-tweak 起）：门禁按插件根的 stages.tweak.json 判（S1 记原话 → S4 派发 → S5 来回改 →
// S6 跑测试 → S8 交付；段号与产物名沿用正常链），项目经理在这一趟里直接派实现段的产者（派发白名单只换项目经理两行，由短链现算），用户点「可以了，收尾」
// 才推得出实现段（批准记录器记进 approvals.jsonl，绑在那一刻的契约 sha 上）。没有 mode 或 mode 为 full 的一趟一切照旧。
// 键名叫 mode 不叫 kind：state.json 的已知键两两至少差四步（拼错时只指向一个），kind 与 run_id 太像。
import { PLUGIN_PREFIX } from './decide.mjs'
import { isPlainObject, isStageChain, isRolePatternStage, stageRoles } from './stages.mjs'
import { normalizeLabel } from './budget.mjs'
import { SHA_RE } from './contract-hash.mjs'

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

// ---------------------------------------------------------------------------------------------------------------------------------
// 「可以了，收尾」：用户看过这一轮、满意了。两个批准记录器认它（AskUserQuestion 里干净地单选，或者对话里单独发这一句），记进 approvals.jsonl，绑在那一刻的
// 契约 sha 上；H6 在微调推进出实现段时核——之后又改了契约（用户又提了一轮），那条记录就不算了，要重新问。

/**
 * PostToolUse:AskUserQuestion 的 tool_response 里有没有选「可以了，收尾」：一个像样的都没有回 null；认上了回 { ok: true }；像是、却不记回 { why }。
 * 不记的形状与接手、需求稿批准同一套。
 */
export function doneAnswer(toolResponse) {
  if (!isPlainObject(toolResponse) || !isPlainObject(toolResponse.answers)) return null
  const tr = toolResponse
  const questions = Array.isArray(tr.questions) ? tr.questions : []
  // 用到时才归一化：加载这个模块时不调任何会被注入异常的内建。
  const key = normalizeLabel(DONE_LABEL)
  const like = (a) => typeof a === 'string' && normalizeLabel(a).startsWith(key)
  const hits = []
  for (const [text, answer] of Object.entries(tr.answers)) {
    if (Array.isArray(answer)) {
      if (answer.some(like)) hits.push({ why: 'array' })
      continue
    }
    if (!like(answer)) continue
    const q = questions.find((x) => isPlainObject(x) && x.question === text)
    if (!q) hits.push({ why: 'unmatched' })
    else if (normalizeLabel(answer) !== key) hits.push({ why: 'malformed' })
    else if (q.multiSelect === true) hits.push({ why: 'multi' })
    else if (isPlainObject(tr.annotations) && isPlainObject(tr.annotations[text]) && typeof tr.annotations[text].notes === 'string' && tr.annotations[text].notes.trim() !== '')
      hits.push({ why: 'notes' })
    else hits.push({ ok: true })
  }
  if (!hits.length) return null
  if (tr.afkTimeoutMs !== undefined) return { why: 'afk' }
  if (tr.followUp === true) return { why: 'follow-up' }
  if (typeof tr.response === 'string' && tr.response.trim() !== '') return { why: 'response' }
  if (Math.max(questions.length, Object.keys(tr.answers).length) > 1) return { why: 'not-alone' }
  return hits[0]
}

/** 对话里单独发的一条消息是不是就是「可以了，收尾」（归一化之后整条相等）。 */
export function promptDone(prompt) {
  return typeof prompt === 'string' && normalizeLabel(prompt.trim()) === normalizeLabel(DONE_LABEL)
}

/** approvals.jsonl 里那一行。contract：门禁按磁盘算的契约 sha。 */
export function doneLine({ at, source, contract }) {
  return JSON.stringify({ kind: DONE_KIND, at, source: source === 'prompt' ? 'prompt' : 'ask', contract })
}

/** approvals.jsonl 的原文 → 记过「可以了，收尾」的契约 sha。只认 kind 是 tweak-done、contract 是合法 sha 的行；坏行跳过。 */
export function readDoneShas(text) {
  if (typeof text !== 'string') return []
  const out = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let v
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (isPlainObject(v) && v.kind === DONE_KIND && typeof v.contract === 'string' && SHA_RE.test(v.contract)) out.push(v.contract)
  }
  return out
}

/**
 * H6：微调从实现段推进出去（写入之前停在实现段、写入之后在它之后）时，doneShas 里要有一条等于现在契约 sha 的记录，没有就拒。别的写入、正常的一趟不核；
 * 写入之前读不出来的不核（那时别的判据先管）。
 */
export function decideTweakDone({ before, after, stages, contractSha, doneShas = [] }) {
  if (!isPlainObject(before) || !isPlainObject(after) || modeOf(after) !== TWEAK_MODE || !isStageChain(stages)) return { ok: true }
  const impl = implStageOf(stages)
  const ids = Object.keys(stages)
  if (!impl || before.stage !== impl || ids.indexOf(after.stage) <= ids.indexOf(impl)) return { ok: true }
  if (typeof contractSha === 'string' && Array.isArray(doneShas) && doneShas.includes(contractSha)) return { ok: true }
  return {
    ok: false,
    reason:
      `agent-team H6 微调：推出 ${impl} 要用户先说满意——门禁没有记到用户对现在这份契约说过「${DONE_LABEL}」（没问过，或者之后又改了契约、又提了一轮）。` +
      `照 /agent-team:at-tweak 第 3 节：这一轮改完，用 AskUserQuestion 单独问一道单选题，标签逐字写「${DONE_LABEL}」与「再改」；用户选了它，门禁记下，再推进。` +
      `问不了用户的（工具面里没有 AskUserQuestion），请用户在对话里单独发一条只写「${DONE_LABEL}」的消息。`,
  }
}

const DONE_WHY = {
  'no-run': '读不出 current-run 指着的那一趟',
  'not-tweak': '那一趟不是微调',
  'not-impl': '那一趟没有停在实现那一段（这句话只在来回改的那一段里算数）',
  'other-session': '那一趟归另一个会话',
  'no-contract': '读不出那一趟的契约',
  'write-failed': '门禁写不进批准记录（run 目录里的 approvals.jsonl）',
  afk: '用户离开了键盘，对话框自动提交了',
  'follow-up': '用户要先追问',
  response: '用户另写了一段话（以那段话为准，它可能是下一轮要改的）',
  notes: '用户在选项旁写了备注（以备注为准，它可能是下一轮要改的）',
  multi: '那道题是多选',
  array: '回答是好几项',
  malformed: `标签后面夹了别的话（要逐字是「${DONE_LABEL}」；夹着的话多半是下一轮要改的）`,
  unmatched: '回答对不上任何一道显示过的题',
  'not-alone': '这一次问里还有别的题',
}

/** 「可以了，收尾」记录器的回传。why 为 null 是记下了。 */
export function doneNotice({ why = null }) {
  if (why === null) {
    return `【微调】已记下：用户对现在这份契约说了「${DONE_LABEL}」。照 /agent-team:at-tweak 第 3 节推进出实现那一段、去跑测试；之后要是又改了契约（用户又提了一轮），这条就不算了，要重新问。`
  }
  const reason = Object.hasOwn(DONE_WHY, why) ? DONE_WHY[why] : '门禁认不出原因'
  return `【微调】这次的回答没有记成「${DONE_LABEL}」：${reason}。照 /agent-team:at-tweak 第 3 节办：用户还有要改的就照改；要收尾时单独再问一次这一道单选题（标签逐字）。`
}
