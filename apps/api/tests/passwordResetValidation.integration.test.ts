import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import request from 'supertest'
import { app } from '../src/app.js'
import { hashAuthActionToken, hashPassword, newAuthActionToken, verifyPassword } from '../src/auth/tokens.js'
import { prisma } from '../src/db.js'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'

describe('PostgreSQL-backed password reset token validation', { skip: !enabled }, () => {
  after(async () => prisma.$disconnect())

  it('rejects tampered, expired, weak-password, and reused reset tokens', async () => {
    process.env.AUTH_ACCESS_SECRET ??= randomBytes(48).toString('base64url')

    const suffix = randomUUID()
    const email = `password-reset-validation-${suffix}@example.test`
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const newPassword = 'strong replacement password'
    const currentToken = newAuthActionToken()
    const expiredToken = newAuthActionToken()
    const consumedToken = newAuthActionToken()
    let userId: string | undefined
    let databaseAvailable = false

    try {
      await prisma.$queryRaw`SELECT 1`
      databaseAvailable = true
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword('initial integration password'),
          displayName: 'Password reset validation',
          role: 'CUSTOMER',
        },
        select: { id: true },
      })
      userId = user.id

      const expiredRow = await prisma.authActionToken.create({
        data: {
          userId: user.id,
          tokenHash: hashAuthActionToken(expiredToken),
          purpose: 'PASSWORD_RESET',
          expiresAt: new Date(Date.now() - 60_000),
        },
      })
      const consumedRow = await prisma.authActionToken.create({
        data: {
          userId: user.id,
          tokenHash: hashAuthActionToken(consumedToken),
          purpose: 'PASSWORD_RESET',
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
        },
      })
      const currentRow = await prisma.authActionToken.create({
        data: {
          userId: user.id,
          tokenHash: hashAuthActionToken(currentToken),
          purpose: 'PASSWORD_RESET',
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      })

      const tamperedToken = `${currentToken[0] === 'a' ? 'b' : 'a'}${currentToken.slice(1)}`
      const tampered = await request(app)
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token: tamperedToken, password: newPassword })
      assert.equal(tampered.status, 400)

      const expired = await request(app)
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token: expiredToken, password: newPassword })
      assert.equal(expired.status, 400)

      const weakPassword = await request(app)
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token: currentToken, password: 'short' })
      assert.equal(weakPassword.status, 400)
      assert.equal((await prisma.authActionToken.findUniqueOrThrow({ where: { id: currentRow.id } })).consumedAt, null)

      const reset = await request(app)
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token: currentToken, password: newPassword })
      assert.equal(reset.status, 200)
      assert.ok(await prisma.authActionToken.findUniqueOrThrow({ where: { id: currentRow.id } }).then((row) => row.consumedAt))

      const reused = await request(app)
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token: currentToken, password: newPassword })
      assert.equal(reused.status, 400)

      const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      assert.equal(await verifyPassword(newPassword, currentUser.passwordHash), true)
      assert.equal((await prisma.authActionToken.findUniqueOrThrow({ where: { id: expiredRow.id } })).consumedAt, null)
      assert.ok((await prisma.authActionToken.findUniqueOrThrow({ where: { id: consumedRow.id } })).consumedAt)
    } finally {
      if (databaseAvailable && userId) {
        await prisma.auditLog.deleteMany({ where: { entityId: userId } })
        await prisma.user.deleteMany({ where: { id: userId } })
      }
    }
  })
})
