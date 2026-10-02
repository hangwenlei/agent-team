// 文本的统一归一化：剥掉开头的 UTF-8 BOM、把 CRLF 折成 LF，别的一个字节都不碰（孤立的 \r、
// 前后空格都保留——那是正文里的真实内容）。
//
// 这份口径原先只在 contract-hash.mjs 里（契约哈希要跨平台一致）。M3r（docs/26）把它抽出来，
// 因为另外两处要的是同一件事，而不是「差不多的」另一份：
//   - runctx.mjs 读 state.json / project.json：带 BOM 的文件（Windows PowerShell 5.1 的
//     Out-File -Encoding utf8 就会写）此前 JSON.parse 直接失败，整趟 run 被判 unreadable；
//   - rework-guard.mjs 重放 Edit：平台的 Edit 匹配之前先剥 BOM、折 CRLF，H6 不照做就匹配不上，
//     算不出新内容。
// 三处各写一份的话，哪天只改了一份，H6 眼里合法的文件在 runctx 眼里就是坏的（反之亦然）。
export function normalizeText(buf) {
  let s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  return s.replace(/\r\n/g, '\n')
}

// M4a 复核二（docs/35）：「空文件」——归一化之后去掉空白什么都不剩（0 字节、只有 BOM、只有换行或空格）。收口、交付快照与「交过」
// 用同一个谓词：空文件不算交了，补交的出路要处处走得通。
export function isBlankText(buf) {
  return normalizeText(buf).trim() === ''
}
