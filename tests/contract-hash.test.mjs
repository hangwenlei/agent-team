import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { compareContractSha, normalizeContract, sha256OfContract } from '../hooks/lib/contract-hash.mjs'

const LF = '# 契约\n\n用户原话。\n'

test('哈希形状是 sha256:<64 位小写十六进制>', () => {
  assert.match(sha256OfContract(LF), /^sha256:[0-9a-f]{64}$/)
})

test('哈希值与直接算 sha256 一致——没有自创算法', () => {
  const want = 'sha256:' + createHash('sha256').update(LF, 'utf8').digest('hex')
  assert.equal(sha256OfContract(LF), want)
})

test('CRLF 与 LF 哈希相同——git autocrlf 不该制造假漂移', () => {
  assert.equal(sha256OfContract(LF.replace(/\n/g, '\r\n')), sha256OfContract(LF))
})

test('带 BOM 与不带 BOM 哈希相同', () => {
  assert.equal(sha256OfContract('﻿' + LF), sha256OfContract(LF))
})

test('Buffer 与字符串给出同一个哈希', () => {
  assert.equal(sha256OfContract(Buffer.from(LF, 'utf8')), sha256OfContract(LF))
})

test('内容真的改了，哈希就变——归一化没有把语义差异也抹掉', () => {
  assert.notEqual(sha256OfContract(LF), sha256OfContract(LF + '追加一行\n'))
  assert.notEqual(sha256OfContract('a\nb\n'), sha256OfContract('a\n\nb\n'))
})

test('normalizeContract 只动 BOM 与行尾，别的不碰', () => {
  assert.equal(normalizeContract('﻿a\r\nb'), 'a\nb')
  assert.equal(normalizeContract('  前后空格保留  '), '  前后空格保留  ')
  assert.equal(normalizeContract('孤立的\r回车保留'), '孤立的\r回车保留')
})

test('compareContractSha：相等就 ok', () => {
  const h = sha256OfContract(LF)
  assert.deepEqual(compareContractSha({ recorded: h, actual: h }), { ok: true })
})

test('compareContractSha：PENDING 是「还没记」，不是漂移', () => {
  const r = compareContractSha({ recorded: 'PENDING', actual: sha256OfContract(LF) })
  assert.equal(r.ok, false)
  assert.match(r.problem, /还没有记/)
  assert.doesNotMatch(r.problem, /漂移/)
})

test('compareContractSha：不相等报漂移，并把两个值都带出来', () => {
  const actual = sha256OfContract(LF)
  const recorded = sha256OfContract(LF + 'x')
  const r = compareContractSha({ recorded, actual })
  assert.equal(r.ok, false)
  assert.match(r.problem, /漂移/)
  assert.ok(r.problem.includes(actual))
  assert.ok(r.problem.includes(recorded))
  // 规格 §5.3：契约的合法改动必须同时留一条 escalations 记录。
  assert.match(r.problem, /escalations/)
})

test('compareContractSha：actual 为 null（契约还没写出来）不报漂移', () => {
  assert.deepEqual(compareContractSha({ recorded: 'PENDING', actual: null }), { ok: true })
  const r = compareContractSha({ recorded: sha256OfContract(LF), actual: null })
  assert.equal(r.ok, false)
  assert.match(r.problem, /磁盘上没有/)
})
