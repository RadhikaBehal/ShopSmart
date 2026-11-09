import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SignJWT } from 'jose'
import {
  createAccessToken,
  authActionExpiry,
  hashAuthActionToken,
  hashPassword,
  hashRefreshToken,
  newAuthActionToken,
  newRefreshToken,
  verifyAccessToken,
  verifyPassword,
} from '../src/auth/tokens.js'

describe('authentication primitives', () => {
  it('hashes passwords with unique salts and verifies without plaintext storage', async () => {
    const first = await hashPassword('a long test passphrase')
    const second = await hashPassword('a long test passphrase')
    assert.notEqual(first, second)
    assert.match(first, /^scrypt\$/)
    assert.equal(await verifyPassword('a long test passphrase', first), true)
    assert.equal(await verifyPassword('incorrect passphrase', first), false)
  })

  it('stores refresh-token hashes, not the bearer token', () => {
    const token = newRefreshToken()
    assert.equal(token.length, 43)
    assert.notEqual(hashRefreshToken(token), token)
    assert.equal(hashRefreshToken(token), hashRefreshToken(token))
  })

  it('creates opaque single-use action tokens with purpose-specific expiration windows', () => {
    const now = Date.now()
    const token = newAuthActionToken()
    assert.equal(token.length, 43)
    assert.notEqual(hashAuthActionToken(token), token)
    assert.equal(hashAuthActionToken(token), hashAuthActionToken(token))
    assert.ok(authActionExpiry('EMAIL_VERIFICATION').getTime() - now >= 24 * 60 * 60 * 1000 - 20)
    assert.ok(authActionExpiry('PASSWORD_RESET').getTime() - now >= 60 * 60 * 1000 - 20)
  })

  it('signs short-lived tokens with bounded identity claims', async () => {
    const previous = process.env.AUTH_ACCESS_SECRET
    process.env.AUTH_ACCESS_SECRET = 'test-secret-with-at-least-thirty-two-bytes'
    try {
      const token = await createAccessToken({ sub: 'user-123', sid: 'session-123', email: 'person@example.test', role: 'SELLER_STAFF' })
      assert.deepEqual(await verifyAccessToken(token), {
        sub: 'user-123',
        sid: 'session-123',
        email: 'person@example.test',
        role: 'SELLER_STAFF',
      })
      await assert.rejects(verifyAccessToken(`${token}tampered`))

      const secret = new TextEncoder().encode(process.env.AUTH_ACCESS_SECRET)
      const expiredToken = await new SignJWT({ sid: 'session-123', role: 'CUSTOMER', email: 'person@example.test' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-123')
        .setIssuer('shopsmart-api')
        .setAudience('shopsmart-web')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
        .sign(secret)
      await assert.rejects(verifyAccessToken(expiredToken))
    } finally {
      if (previous === undefined) delete process.env.AUTH_ACCESS_SECRET
      else process.env.AUTH_ACCESS_SECRET = previous
    }
  })
})
