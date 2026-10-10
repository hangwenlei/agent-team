// 判据用的假 GitHub API（docs/52 §8）：经 node --import 预载，替换 globalThis.fetch。路由表从 FAKE_GITHUB_ROUTES 读（JSON：{ "方法 路径": [状态, JSON] }），
// 每一次调用记成一行 JSON 追加到 FAKE_GITHUB_LOG；表里没有的回 404。只给 tests/github-release.test.mjs 起 scripts/github-release.mjs 用，不碰网络。
import { appendFileSync } from 'node:fs'

const API = 'https://api.github.com'
const routes = JSON.parse(process.env.FAKE_GITHUB_ROUTES || '{}')

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET'
  const path = String(url).startsWith(API) ? String(url).slice(API.length) : String(url)
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  appendFileSync(process.env.FAKE_GITHUB_LOG, JSON.stringify({ method, path, headers: init.headers ?? {}, body }) + '\n')
  const [status, json] = routes[`${method} ${path}`] ?? [404, { message: 'Not Found' }]
  return { status, ok: status >= 200 && status < 300, json: async () => json }
}
