// 从 agent markdown 的 tools: 行里提取 Agent(...) 的类型列表。
// 只做这一件事，不解析完整 YAML，因此不需要任何依赖。

export function parseAgentAllowlist(md) {
  const line = md.split(/\r?\n/).find((l) => /^tools:/.test(l.trim()))
  if (!line) return []
  const m = line.match(/Agent\(([^)]*)\)/)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
