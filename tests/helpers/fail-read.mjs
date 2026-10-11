// 让门禁子进程读某个文件时失败——复用已有的两份预加载，不另造一套（docs/84 §8）：
//   project.json：tests/helpers/project-reads.cjs（按次数抛 EBUSY，模拟杀毒软件、索引器的短暂占用）；
//   别的文件：tests/helpers/inject-throw.cjs 的 read:<后缀>（一直抛）。
// 返回 run 的第五、六个参数：run(check, input, gate, cwd, env, opts)。times 是失败几次，不给就一直失败（project.json 之外只能一直失败）。
import { fileURLToPath } from 'node:url'
import { hermeticEnv } from './gate-runner.mjs'

const PROJECT_READS = fileURLToPath(new URL('./project-reads.cjs', import.meta.url))
const INJECT = fileURLToPath(new URL('./inject-throw.cjs', import.meta.url))

export function failRead(name, times = Infinity) {
  if (name === 'project.json') {
    // 一直失败：读运行上下文、readProjectConfig、各条缝里的重读加起来远不到这个数。
    const n = Number.isFinite(times) ? times : 99
    return { env: { ...hermeticEnv(), AGENT_TEAM_TEST_PROJECT_READS: `busy*${n}` }, opts: { nodeArgs: ['-r', PROJECT_READS] } }
  }
  if (Number.isFinite(times)) throw new Error('failRead：project.json 之外的文件只能一直读不出（inject-throw.cjs 的 read:）')
  return { env: { ...hermeticEnv(), AGENT_TEAM_TEST_THROW: `read:${name}` }, opts: { nodeArgs: ['-r', INJECT] } }
}
