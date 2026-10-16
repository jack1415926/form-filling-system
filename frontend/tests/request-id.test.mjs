import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'
import { ensureRandomUUID } from '../src/requestId.ts'

test('LAN HTTP supports UUID v4 without replacing the native implementation', () => {
  const provider = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }
  ensureRandomUUID(provider)
  const id = provider.randomUUID()
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(provider.randomUUID(), id)
  const native = provider.randomUUID
  ensureRandomUUID(provider)
  assert.equal(provider.randomUUID, native)
})
