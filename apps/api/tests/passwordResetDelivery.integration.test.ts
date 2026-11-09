import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import request from 'supertest'
import { app } from '../src/app.js'
import { hashAuthActionToken, hashPassword, verifyPassword } from '../src/auth/tokens.js'
import { prisma } from '../src/db.js'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'

describe('PostgreSQL-backed password reset delivery', { skip: !enabled }, () => {
  after(async () => prisma.$disconnect())

  it('keeps request responses private, cleans failed deliveries, and resets the test account securely', async () => {
    process.env.AUTH_ACCESS_SECRET ??= randomBytes(48).toString('base64url')

    const suffix = randomUUID()
    const email = `password-reset-${suffix}@example.test`
    const unknownEmail = `missing-${suffix}@example.test`
    const oldPassword = 'integration old password'
    const newPassword = 'integration new password'
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const previousEmailUrl = process.env.AUTH_EMAIL_DELIVERY_URL
    const previousEmailKey = process.env.AUTH_EMAIL_DELIVERY_API_KEY
    const previousEmailFrom = process.env.AUTH_EMAIL_FROM_ADDRESS
    const deliveredRequests: Array<{
      authorization: string | undefined
      contentType: string | undefined
      body: { from: string; to: string; subject: string; text: string }
    }> = []
    let responseStatus = 202
    let userId: string | undefined
    let databaseAvailable = false
    const emailServer = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        deliveredRequests.push({
          authorization: incoming.headers.authorization,
          contentType: incoming.headers['content-type'],
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            from: string
            to: string
            subject: string
            text: string
          },
        })
        outgoing.writeHead(responseStatus, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ message: 'provider response details must not be forwarded' }))
      })
    })

    try {
      await prisma.$queryRaw`SELECT 1`
      databaseAvailable = true
      await new Promise<void>((resolve) => emailServer.listen(0, '127.0.0.1', resolve))
      const address = emailServer.address()
      assert.ok(address && typeof address !== 'string')
      process.env.AUTH_EMAIL_DELIVERY_URL = `http://127.0.0.1:${address.port}/emails`
      process.env.AUTH_EMAIL_DELIVERY_API_KEY = 'integration-only-key'
      process.env.AUTH_EMAIL_FROM_ADDRESS = 'ShopSmart <onboarding@resend.dev>'

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(oldPassword),
          displayName: 'Password reset integration',
          role: 'CUSTOMER',
        },
        select: { id: true },
      })
      userId = user.id

      const unknownRequest = await request(app)
        .post('/api/v1/auth/password/forgot')
        .set('Origin', origin)
        .send({ email: unknownEmail })
      assert.equal(unknownRequest.status, 202)
      assert.deepEqual(unknownRequest.body, {
        message: 'If an account exists for that address, password reset instructions have been sent.',
      })
      assert.equal(deliveredRequests.length, 0)

      responseStatus = 401
      const providerFailure = await request(app)
        .post('/api/v1/auth/password/forgot')
        .set('Origin', origin)
        .send({ email })
      assert.equal(providerFailure.status, 503)
      assert.deepEqual(providerFailure.body, {
        error: 'Authentication email delivery is unavailable. Please try again later.',
      })
      assert.equal(providerFailure.text.includes('provider response details'), false)
      assert.equal(await prisma.authActionToken.count({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
      }), 0)

      responseStatus = 202
      const resetRequest = await request(app)
        .post('/api/v1/auth/password/forgot')
        .set('Origin', origin)
        .send({ email })
      assert.equal(resetRequest.status, 202)
      assert.deepEqual(resetRequest.body, unknownRequest.body)
      assert.equal(deliveredRequests.length, 2)

      const providerRequest = deliveredRequests[1]
      assert.equal(providerRequest.authorization, 'Bearer integration-only-key')
      assert.equal(providerRequest.contentType, 'application/json')
      assert.deepEqual(Object.keys(providerRequest.body).sort(), ['from', 'subject', 'text', 'to'])
      assert.equal(providerRequest.body.from, 'ShopSmart <onboarding@resend.dev>')
      assert.equal(providerRequest.body.to, email)
      assert.equal(providerRequest.body.subject, 'Reset your ShopSmart password')
      assert.match(providerRequest.body.text, /one-time link within 1 hour/)
      const resetLink = new URL(providerRequest.body.text.split('\n').at(-1)!)
      assert.equal(resetLink.searchParams.get('authAction'), 'reset')
      const token = resetLink.searchParams.get('token')
      assert.ok(token)

      const storedToken = await prisma.authActionToken.findFirstOrThrow({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
      })
      assert.equal(storedToken.tokenHash, hashAuthActionToken(token))
      assert.notEqual(storedToken.tokenHash, token)
      assert.ok(storedToken.expiresAt.getTime() > Date.now())

      const login = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password: oldPassword })
      assert.equal(login.status, 200)
      const oldAccessToken = login.body.accessToken as string
      assert.ok(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } }) > 0)

      const reset = await request(app)
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token, password: newPassword })
      assert.equal(reset.status, 200)
      assert.equal((await prisma.authActionToken.findUniqueOrThrow({ where: { id: storedToken.id } })).consumedAt instanceof Date, true)
      assert.equal(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } }), 0)

      const oldSessionProfile = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${oldAccessToken}`)
      assert.equal(oldSessionProfile.status, 401)

      const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      assert.notEqual(updatedUser.passwordHash, oldPassword)
      assert.equal(await verifyPassword(newPassword, updatedUser.passwordHash), true)
      assert.equal(await verifyPassword(oldPassword, updatedUser.passwordHash), false)

      const oldPasswordLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password: oldPassword })
      assert.equal(oldPasswordLogin.status, 401)
      const newPasswordLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password: newPassword })
      assert.equal(newPasswordLogin.status, 200)
    } finally {
      if (emailServer.listening) await new Promise<void>((resolve, reject) => {
        emailServer.close((error) => error ? reject(error) : resolve())
      })
      if (previousEmailUrl === undefined) delete process.env.AUTH_EMAIL_DELIVERY_URL
      else process.env.AUTH_EMAIL_DELIVERY_URL = previousEmailUrl
      if (previousEmailKey === undefined) delete process.env.AUTH_EMAIL_DELIVERY_API_KEY
      else process.env.AUTH_EMAIL_DELIVERY_API_KEY = previousEmailKey
      if (previousEmailFrom === undefined) delete process.env.AUTH_EMAIL_FROM_ADDRESS
      else process.env.AUTH_EMAIL_FROM_ADDRESS = previousEmailFrom
      if (databaseAvailable && userId) {
        await prisma.auditLog.deleteMany({ where: { entityId: userId } })
        await prisma.user.deleteMany({ where: { id: userId } })
      }
    }
  })
})
