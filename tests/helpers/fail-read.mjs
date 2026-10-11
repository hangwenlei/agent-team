// 让门禁子进程读某个文件时失败（预加载 tests/fixtures/fail-read.cjs）。返回 run 的第五、六个参数：
//   run(check, input, gate, cwd, env, opts)，env 与 opts 从这里来。times 是失败几次，不给就一直失败。
import { fileURLToPath } from 'node:url'
import { hermeticEnv } from './gate-runner.mjs'

const PRELOAD = fileURLToPath(new URL('../fixtures/fail-read.cjs', import.meta.url))

export function failRead(name, times = Infinity) {
  const env = { ...hermeticEnv(), AGENT_TEAM_TEST_FAIL_READ_NAME: name }
  if (Number.isFinite(times)) env.AGENT_TEAM_TEST_FAIL_READS = String(times)
  return { env, opts: { nodeArgs: ['-r', PRELOAD] } }
}
