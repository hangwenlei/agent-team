// 以 `node -r <本文件> hooks/boot.mjs <检查项>` 预加载：把 process.versions.node 改成环境变量
// AGENT_TEAM_FAKE_NODE 的值、把 process.execPath 改成 AGENT_TEAM_FAKE_EXECPATH 的值——只改字符串，
// 不改运行时（M3t，docs/28）。测 boot.mjs 的版本检查
// 用：真旧的 Node 只在 CI 上有（tests/boot-old-node.test.mjs）。写成 -r 的 .cjs 而不是 --import 的
// .mjs：--import 要 Node 18.18 起才有。
if (process.env.AGENT_TEAM_FAKE_NODE) {
  Object.defineProperty(process.versions, 'node', {
    value: process.env.AGENT_TEAM_FAKE_NODE,
    enumerable: true,
    configurable: true,
  })
}
if (process.env.AGENT_TEAM_FAKE_EXECPATH) process.execPath = process.env.AGENT_TEAM_FAKE_EXECPATH
