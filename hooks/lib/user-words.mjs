// M4o（docs/50，审查第 20 条修法 A）：门禁记下用户在 /agent-team:at 后面写的那段话，契约第 1 节对着它核。
//
// 契约第 1 节要逐字照抄 $ARGUMENTS（commands/at.md 第 2 节），此前没有任何旁证：项目经理首记时转写偏了，门禁照样把偏了的那一份记成基线
// （contract-base.mjs 只核推进出第一段之后第 1 节变没变）。平台在斜杠命令展开时发 UserPromptExpansion，输入带 command_name（插件命令是
// 「插件名:命令名」）与 command_args（CLI 去掉了首尾空白，就是换进 $ARGUMENTS 的那一份）——2.1.278、2.1.286 上实测，-p 与 --bg 一样
// （docs/50 §1）。
//
// 两份门禁专属文件，名字都是 USER_WORDS_FILE（control-files.mjs 登记，任何人的 Edit/Write 都拒）：
//   - 项目一级 .agent-team/user-words.json：记录器（gate.mjs 的 user-words 检查项）每次带参数展开都整份重写——原话、会话 id、那一刻 runs/
//     下已有的 run（runs_before）。这一刻这一趟的 run 还没建，只能先记在项目一级。不带参数的那一次，清掉这个会话还挂着的那份（blankAtSession）。
//   - run 一级 runs/<id>/user-words.json：绑定之后的那一份。之后这一趟只认它。
// 绑不绑（bindDecision）：同一个会话、还没绑也没作废的记录——这个会话用 Write 建出一趟新 run（不在 runs_before 里）的 state.json、停在第一段的
// 那一次（H6 里写之前文件还不在，creating）绑。记下之前就有的那一趟被写了、它又没收口（续跑了它——这条命令的需求被搁下了，commands/at.md
// 第 1 节「用户选续跑」那一支），作废：之后另起的一趟抄的是用户的消息，不是这条命令的参数。替它收口的那一次不作废（收口之后照常建新的一趟）。
// 复核（docs/50 §9）：原来不是建它的那一次也绑（账本在第一段里写 state.json、契约时）——别的会话在命令之后建的一趟被这个会话续跑时会绑错，
// 别的会话推进出第一段之后回退到第一段时晚绑，与契约基线互相卡死（第 1 节照哪一份都过不去）。
// 绑分两步（docs/58 §8）：bindDecision 说绑时 H6 只记 binding（这一刻 run 目录还不在、这次写入还可能被用户拒掉）；同一次 Write 落盘之后账本问
// finishBinding，才标 bound、写 run 一级那份。
// 核（section1Mismatch）：第 1 节标题之后（跳过空行）逐行就是原话，之后到下一个编号节标题之间只有空行。行尾空白、BOM、CRLF 不计；整段写成
// 引用块（每行一个「>」或「> 」）也认——真实会话里两种写法都有（docs/50 §1）。按原话的行数往下认，原话里自带的「## 2. …」不会把它切断。
// 复核（docs/50 §9）：比之前两边都把空白变体（不换行空格、全角空格、制表符这类）折成一个普通空格、连续空白算一个，去掉零宽与格式字符——
// 实测 sonnet 照抄时把不换行空格换成了普通空格，拒绝理由里两段肉眼一样、改不出来，这一趟就推进不出第一段。
import { PLUGIN_PREFIX } from './decide.mjs'
import { contractLines, numberedHeading } from './contract-base.mjs'
import { isPlainObject } from './stages.mjs'
import { USER_WORDS_FILE } from './control-files.mjs'
import { quote } from './trusted.mjs'

export { USER_WORDS_FILE }

// 认的命令：本插件的 at（插件名从 PLUGIN_PREFIX 取，与 settings.json 的 agent 同一个真源）。
export const AT_COMMAND = `${PLUGIN_PREFIX}at`
const BOM = String.fromCharCode(0xfeff)
const BS = String.fromCharCode(92)
const TAB = String.fromCharCode(9)
// 格式字符（零宽空格与连接符、双向控制、软连字符、BOM……）：看不见，模型照抄时留不留没准。
const FORMAT_RE = new RegExp(BS + 'p{Cf}', 'gu')
// 空白：制表符与 Unicode 的空格分隔符（不换行空格、全角空格、窄空格……），连续几个算一个。
const SPACES_RE = new RegExp('[' + TAB + BS + 'p{Zs}]+', 'gu')

function isAt(input) {
  return isPlainObject(input) && input.hook_event_name === 'UserPromptExpansion' && input.expansion_type === 'slash_command' && input.command_name === AT_COMMAND
}

/** UserPromptExpansion 的输入是不是 /agent-team:at 带着非空参数展开、带会话 id 的那一次：是就给 { args, sessionId }，否则 null。 */
export function wordsOf(input) {
  if (!isAt(input)) return null
  const args = input.command_args
  if (typeof args !== 'string' || args.trim() === '') return null
  const sid = input.session_id
  if (typeof sid !== 'string' || sid === '') return null
  return { args, sessionId: sid }
}

/** /agent-team:at 不带参数展开的那一次：给会话 id（调用方清掉这个会话还挂着的那份），否则 null。 */
export function blankAtSession(input) {
  if (!isAt(input)) return null
  const args = input.command_args
  if (typeof args === 'string' && args.trim() !== '') return null
  const sid = input.session_id
  return typeof sid === 'string' && sid !== '' ? sid : null
}

/** 项目一级那份记录的样子。 */
export function pendingRecord({ at, sessionId, args, runsBefore }) {
  return { at, session_id: sessionId, args, runs_before: Array.isArray(runsBefore) ? runsBefore.filter((n) => typeof n === 'string') : [], binding: null, bound: null, dropped: null }
}

/** 读一份记录（两级同一个形状，run 一级多一个 bound_at 也照读）；读不出、形状不对回 null。 */
export function readWords(bytes) {
  if (bytes === null || bytes === undefined) return null
  let text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes)
  if (text.startsWith(BOM)) text = text.slice(1)
  let v
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlainObject(v)) return null
  if (typeof v.args !== 'string' || v.args.trim() === '') return null
  if (typeof v.session_id !== 'string' || v.session_id === '') return null
  return {
    at: typeof v.at === 'string' ? v.at : null,
    session_id: v.session_id,
    args: v.args,
    runs_before: Array.isArray(v.runs_before) ? v.runs_before.filter((n) => typeof n === 'string') : [],
    binding: typeof v.binding === 'string' ? v.binding : null,
    bound: typeof v.bound === 'string' ? v.bound : null,
    dropped: typeof v.dropped === 'string' ? v.dropped : null,
  }
}

/**
 * 项目经理写了 runId 那一趟的 state.json 或契约之后，项目一级的记录怎么办：'bind'（绑进这一趟）、'drop'（作废）、null（不动）。
 * sameRun(a, b)：两个 run id 是不是同一个目录（调用方按规范化之后的路径比，Windows 上不分大小写）。creating：这一次是这个会话用 Write
 * 建出它的 state.json（H6 里写之前文件还不在）；firstStage：这一趟停在第一段；closed：写完之后这一趟已经收口。
 */
export function bindDecision(pending, { sessionId, runId, sameRun = (a, b) => a === b, creating = false, firstStage, closed }) {
  if (!pending || pending.bound !== null || pending.dropped !== null) return null
  if (typeof sessionId !== 'string' || pending.session_id !== sessionId) return null
  if (typeof runId !== 'string' || runId === '') return null
  if (pending.runs_before.some((n) => sameRun(n, runId))) return closed === true ? null : 'drop'
  return creating === true && firstStage === true ? 'bind' : null
}

/**
 * 实测（docs/58，§8 是复核）：绑分两步。H6（PreToolUse）判了 'bind' 只在项目一级记下 binding（打算绑到哪一趟）——那一刻 run 目录还不在，这次写入
 * 也还可能被用户的权限确认拒掉；同一次写入落盘之后（PostToolUse，账本），binding 指着的正是这一趟、同一个会话、还没绑也没作废，才标 bound、写 run 目录
 * 那一份。这一步回 true 表示该完成。被拒的写入没有 PostToolUse，binding 留着、下一次建 run 时照常改指新的那一趟。
 */
export function finishBinding(pending, { sessionId, runId, sameRun = (a, b) => a === b }) {
  if (!pending || pending.bound !== null || pending.dropped !== null || pending.binding === null) return false
  if (typeof sessionId !== 'string' || pending.session_id !== sessionId) return false
  if (typeof runId !== 'string' || runId === '') return false
  return sameRun(pending.binding, runId)
}

// 比之前的样子：去掉格式字符，空白折成一个普通空格，去掉行尾空白。
function canon(line) {
  return line.replace(FORMAT_RE, '').replace(SPACES_RE, ' ').replace(/ +$/, '')
}

function wordLines(args) {
  const lines = contractLines(args)
  while (lines.length && canon(lines[0]) === '') lines.shift()
  while (lines.length && canon(lines[lines.length - 1]) === '') lines.pop()
  return lines
}

// 两行（比之前的样子）从第几个字起不一样：都还有字时回 { col（从 1 数）、两边那个字的码位 }，一边是另一边的开头回 null。
function firstDiff(a, b) {
  const x = [...a]
  const y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) {
      const code = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
      return { col: i + 1, wantCode: code(x[i]), gotCode: code(y[i]) }
    }
  }
  return null
}

// 从 i 起按一种写法逐行认原话；认上了回 null，否则回 { kind, line, want, got, at, diff }（at：认上了几行，挑报哪一种用）。
function matchFrom(lines, i, want, quoted) {
  const body = (raw) => {
    const c = canon(raw)
    if (!quoted) return c
    if (c === '' || c === '>') return ''
    if (c.startsWith('> ')) return c.slice(2)
    if (c.startsWith('>')) return c.slice(1)
    return null
  }
  for (let k = 0; k < want.length; k++) {
    const raw = lines[i + k]
    if (raw === undefined) return { kind: 'short', line: k + 1, want: want[k], got: null, at: k, diff: null }
    const w = canon(want[k])
    const g = body(raw)
    if (g === w || (quoted && g !== null && w.startsWith(' ') && g === w.slice(1))) continue
    return { kind: 'line', line: k + 1, want: want[k], got: raw, at: k, diff: firstDiff(w, g ?? canon(raw)) }
  }
  let j = i + want.length
  while (j < lines.length && (canon(lines[j]) === '' || (quoted && canon(lines[j]) === '>'))) j++
  if (j < lines.length && numberedHeading(lines[j]) === null) return { kind: 'extra', line: j - i + 1, want: null, got: lines[j], at: want.length, diff: null }
  return null
}

/**
 * 契约第 1 节对不对得上原话：对得上回 null；对不上回 { kind, line, want, got }——kind 是 'line'（第 line 行不一样，另带 col、wantCode、gotCode：
 * 从第几个字起不一样、两边那个字的码位；一边是另一边的开头时 col 为 null）、'short'（契约在原话第 line 行之前就完了）、'extra'（原话之后、
 * 下一个编号节标题之前还有别的）、'no-section'（切不出第 1 节）。两种写法都对不上时，报认得更远的那一种（一样远报直接写的那一种）。
 */
export function section1Mismatch(contractText, args) {
  const none = { kind: 'no-section', line: null, want: null, got: null }
  if (typeof contractText !== 'string') return none
  const lines = contractLines(contractText)
  const start = lines.findIndex((l) => numberedHeading(l) === 1)
  if (start < 0) return none
  let i = start + 1
  while (i < lines.length && canon(lines[i]) === '') i++
  const want = wordLines(typeof args === 'string' ? args : '')
  const plain = matchFrom(lines, i, want, false)
  if (!plain) return null
  const quoted = matchFrom(lines, i, want, true)
  if (!quoted) return null
  const best = quoted.at > plain.at ? quoted : plain
  const out = { kind: best.kind, line: best.line, want: best.want, got: best.got }
  if (best.kind === 'line') {
    out.col = best.diff ? best.diff.col : null
    out.wantCode = best.diff ? best.diff.wantCode : null
    out.gotCode = best.diff ? best.diff.gotCode : null
  }
  return out
}

/** 对不上的那一句（H6 的拒绝理由、写契约时的【契约】、【阶段】的补句共用）。原话与契约里的行都是磁盘上的值，过 quote。 */
export function wordsMismatchText(m) {
  const head =
    '契约第 1 节对不上用户在 /agent-team:at 后面写的原话（门禁在用户发出那条命令时记下了它，原样在这一趟 run 目录的 ' +
    `${USER_WORDS_FILE} 里，args 那一项）：`
  if (!m || m.kind === 'no-section') return head + '契约里切不出第 1 节（「## 1. 用户原话」那一行）'
  if (m.kind === 'short') return head + `第 1 节到第 ${m.line} 行就没了，原话从这一行起还有 ${quote(m.want)} 等`
  if (m.kind === 'extra') return head + `原话之后、下一个编号节标题之前还多出一行 ${quote(m.got)}`
  const where = typeof m.col === 'number' ? `（从第 ${m.col} 个字起不一样：原话是 ${m.wantCode}，这里是 ${m.gotCode}）` : ''
  return head + `第 1 节第 ${m.line} 行应是 ${quote(m.want)}，现在是 ${quote(m.got)}${where}`
}

export const WORDS_FIX =
  '照那段话逐字抄进第 1 节（行尾空白不计，空白的写法不计，整段写成引用块也认），你的理解写第 2 节；用户在那条命令之后改了需求的，修订写进第 4 节' +
  '「修订记录」，第 1 节照原话留着'
