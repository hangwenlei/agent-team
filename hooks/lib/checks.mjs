// hooks.json 注册的检查名与 gate.mjs 认得的检查名之间的唯一真源。
// 单独成文件是为了让测试能 import 它而不必 import gate.mjs——
// 后者是可执行入口，一旦被 import 就需要「我是不是被直接执行」的守卫，
// 而那种守卫在 symlink/junction 挂载下会判错，使门禁静默失效。
export const KNOWN_CHECKS = new Set(['delegation'])
