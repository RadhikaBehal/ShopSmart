import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import request from 'supertest'
import { app } from '../src/app.js'
import { hashRefreshToken } from '../src/auth/tokens.js'
import { prisma } from '../src/db.js'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'

describe('PostgreSQL-backed API flows', { skip: !enabled }, () => {
  after(async () => prisma.$disconnect())

  it('checks readiness, catalog queries, registration, login, refresh, and logout', async () => {
    process.env.AUTH_ACCESS_SECRET ??= randomBytes(48).toString('base64url')

    const suffix = randomUUID()
    const email = `integration-${suffix}@example.test`
    const otherEmail = `integration-other-${suffix}@example.test`
    const sellerEmail = `integration-seller-${suffix}@example.test`
    const categorySlug = `integration-${suffix}`
    const productSlug = `integration-${suffix}`
    const password = 'integration test password'
    const updatedPassword = 'integration updated password'
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    let customerId: string | undefined
    let otherCustomerId: string | undefined
    let databaseAvailable = false
    const deliveredEmails: Array<{ from: string; to: string; subject: string; text: string }> = []
    const previousEmailUrl = process.env.AUTH_EMAIL_DELIVERY_URL
    const previousEmailKey = process.env.AUTH_EMAIL_DELIVERY_API_KEY
    const previousEmailFrom = process.env.AUTH_EMAIL_FROM_ADDRESS
    const emailServer = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        deliveredEmails.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          from: string
          to: string
          subject: string
          text: string
        })
        outgoing.writeHead(202).end()
      })
    })

    try {
      await prisma.$queryRaw`SELECT 1`
      databaseAvailable = true
      await new Promise<void>((resolve) => emailServer.listen(0, '127.0.0.1', resolve))
      const emailAddress = emailServer.address()
      assert.ok(emailAddress && typeof emailAddress !== 'string')
      process.env.AUTH_EMAIL_DELIVERY_URL = `http://127.0.0.1:${emailAddress.port}/deliver`
      process.env.AUTH_EMAIL_DELIVERY_API_KEY = 'integration-only-key'
      process.env.AUTH_EMAIL_FROM_ADDRESS = 'ShopSmart <onboarding@resend.dev>'

      const readiness = await request(app).get('/readyz')
      assert.equal(readiness.status, 200)
      assert.deepEqual(readiness.body, { status: 'ready', database: 'connected' })

      const sellerUser = await prisma.user.create({
        data: {
          email: sellerEmail,
          passwordHash: 'integration-fixture',
          displayName: 'Integration seller',
          role: 'SELLER',
        },
      })
      const seller = await prisma.seller.create({
        data: { userId: sellerUser.id, slug: `seller-${suffix}`, displayName: 'Integration seller', status: 'VERIFIED' },
      })
      const category = await prisma.category.create({
        data: { slug: categorySlug, name: 'Integration category' },
      })
      const product = await prisma.product.create({
        data: {
          slug: productSlug,
          name: 'Integration catalog product',
          description: 'Database integration fixture',
          basePriceMinor: 12500,
          status: 'PUBLISHED',
          moderationStatus: 'APPROVED',
          publishedAt: new Date(),
          sellerId: seller.id,
          categoryId: category.id,
          images: { create: [
            { url: 'https://images.example.test/integration-product.jpg', altText: 'Integration test primary image', sortOrder: 1, isPrimary: false },
            { url: 'https://images.example.test/integration-product-primary.jpg', altText: 'Integration test product image', sortOrder: 0, isPrimary: true },
          ] },
          specifications: { create: [{ name: 'Material', value: 'Recycled aluminium', sortOrder: 0 }] },
          variants: { create: { sku: `SKU-${suffix}`, name: 'Standard', stockOnHand: 3 } },
        },
      })

      const catalog = await request(app).get('/api/v1/products').query({ q: 'Integration catalog product' })
      assert.equal(catalog.status, 200)
      assert.equal(catalog.body.pagination.total, 1)
      assert.equal(catalog.body.items[0].id, product.id)
      assert.equal(catalog.body.items[0].basePriceMinor, 12500)
      assert.equal(catalog.body.items[0].currency, 'INR')
      assert.equal(catalog.body.items[0].images.length, 2)
      assert.equal(catalog.body.items[0].images[0].url, 'https://images.example.test/integration-product-primary.jpg')
      assert.equal(catalog.body.items[0].images[0].isPrimary, true)
      assert.deepEqual(catalog.body.items[0].specifications.map((specification: { name: string; value: string }) => ({
        name: specification.name,
        value: specification.value,
      })), [{ name: 'Material', value: 'Recycled aluminium' }])
      assert.equal(catalog.body.items[0].rating, null)
      assert.equal(catalog.body.items[0].reviewCount, 0)
      assert.equal(catalog.body.items[0].available, true)
      assert.equal(catalog.body.items[0].variants[0].stockOnHand, 3)

      const categories = await request(app).get('/api/v1/products/categories')
      assert.equal(categories.status, 200)
      assert.ok(categories.body.items.some((item: { slug: string }) => item.slug === categorySlug))

      const categoryCatalog = await request(app).get('/api/v1/products').query({ category: categorySlug, maxPriceMinor: 12500 })
      assert.equal(categoryCatalog.status, 200)
      assert.equal(categoryCatalog.body.pagination.total, 1)

      const overBudget = await request(app).get('/api/v1/products').query({ category: categorySlug, maxPriceMinor: 12499 })
      assert.equal(overBudget.body.pagination.total, 0)
      const availableProducts = await request(app).get('/api/v1/products').query({ category: categorySlug, available: 'true' })
      assert.equal(availableProducts.body.pagination.total, 1)
      const unavailableProducts = await request(app).get('/api/v1/products').query({ category: categorySlug, available: 'false' })
      assert.equal(unavailableProducts.body.pagination.total, 0)
      const specSearch = await request(app).get('/api/v1/products').query({ q: 'aluminium' })
      assert.equal(specSearch.body.pagination.total, 1)

      const detail = await request(app).get(`/api/v1/products/${productSlug}`)
      assert.equal(detail.status, 200)
      assert.equal(detail.body.item.id, product.id)
      assert.equal(detail.body.item.variants[0].name, 'Standard')

      const missingProduct = await request(app).get('/api/v1/products/not-a-published-product')
      assert.equal(missingProduct.status, 404)

      const browser = request.agent(app)
      const registration = await browser
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({ email, password, displayName: 'Integration customer', role: 'SUPER_ADMIN' })
      assert.equal(registration.status, 201)
      assert.equal(registration.body.user.email, email)
      assert.equal(registration.body.user.role, 'CUSTOMER')
      assert.equal(registration.body.user.emailVerified, false)
      assert.match(registration.headers['set-cookie'][0], /HttpOnly/i)
      customerId = registration.body.user.id
      const customerAccessToken = registration.body.accessToken

      const otherCustomer = await prisma.user.create({
        data: {
          email: otherEmail,
          passwordHash: 'integration-fixture',
          displayName: 'Other integration customer',
        },
      })
      otherCustomerId = otherCustomer.id
      const unauthenticatedProfile = await request(app).get('/api/v1/auth/me')
      assert.equal(unauthenticatedProfile.status, 401)
      const invalidCredentials = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password: 'incorrect password' })
      assert.equal(invalidCredentials.status, 401)
      const ownProfile = await request(app)
        .get(`/api/v1/auth/users/${customerId}`)
        .set('Authorization', `Bearer ${customerAccessToken}`)
      assert.equal(ownProfile.status, 200)
      const otherProfile = await request(app)
        .get(`/api/v1/auth/users/${otherCustomerId}`)
        .set('Authorization', `Bearer ${customerAccessToken}`)
      assert.equal(otherProfile.status, 403)
      const customerAdminList = await request(app)
        .get('/api/v1/auth/admin/users')
        .set('Authorization', `Bearer ${customerAccessToken}`)
      assert.equal(customerAdminList.status, 403)
      await prisma.user.update({ where: { id: customerId }, data: { role: 'ADMIN' } })
      const currentDbRoleAdminList = await request(app)
        .get('/api/v1/auth/admin/users')
        .set('Authorization', `Bearer ${customerAccessToken}`)
      assert.equal(currentDbRoleAdminList.status, 200)
      assert.ok(currentDbRoleAdminList.body.items.some((item: { id: string }) => item.id === customerId))
      await prisma.user.update({ where: { id: customerId }, data: { role: 'CUSTOMER' } })

      const profileUpdate = await request(app)
        .patch('/api/v1/auth/me')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${customerAccessToken}`)
        .send({ displayName: 'Updated integration customer' })
      assert.equal(profileUpdate.status, 200)
      assert.equal(profileUpdate.body.user.displayName, 'Updated integration customer')

      const missingOrigin = await request(app).post('/api/v1/auth/logout')
      assert.equal(missingOrigin.status, 403)

      const verificationRequest = await browser
        .post('/api/v1/auth/email/verification')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${customerAccessToken}`)
      assert.equal(verificationRequest.status, 202)
      assert.equal(deliveredEmails.length, 1)
      assert.equal(deliveredEmails[0].from, 'ShopSmart <onboarding@resend.dev>')
      const verificationLink = new URL(deliveredEmails[0].text.split('\n').at(-1)!)
      const verificationToken = verificationLink.searchParams.get('token')
      assert.ok(verificationToken)
      const verifiedEmail = await browser
        .post('/api/v1/auth/email/verify')
        .set('Origin', origin)
        .send({ token: verificationToken })
      assert.equal(verifiedEmail.status, 200)
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: customerId } })).emailVerifiedAt instanceof Date, true)
      await prisma.review.create({
        data: { productId: product.id, userId: customerId, rating: 5, body: 'Integration review' },
      })

      const topRated = await request(app).get('/api/v1/products').query({ category: categorySlug, sort: 'rating' })
      assert.equal(topRated.status, 200)
      assert.equal(topRated.body.items[0].rating, 5)
      assert.equal(topRated.body.items[0].reviewCount, 1)

      const profile = await browser
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${registration.body.accessToken}`)
      assert.equal(profile.status, 200)
      assert.equal(profile.body.user.id, customerId)

      const login = await browser
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: email.toUpperCase(), password })
      assert.equal(login.status, 200)
      assert.equal(login.body.user.id, customerId)

      const refreshSessionsBefore = await prisma.refreshSession.count({ where: { userId: customerId } })
      const refresh = await browser.post('/api/v1/auth/refresh').set('Origin', origin)
      assert.equal(refresh.status, 200)
      assert.equal(typeof refresh.body.accessToken, 'string')
      assert.equal(await prisma.refreshSession.count({ where: { userId: customerId } }), refreshSessionsBefore + 1)
      const rotatedAccess = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
      assert.equal(rotatedAccess.status, 401)

      const refreshCookie = refresh.headers['set-cookie'][0].match(/shopsmart_refresh=([^;]+)/)?.[1]
      assert.ok(refreshCookie)
      const currentRefreshToken = decodeURIComponent(refreshCookie)
      await prisma.refreshSession.update({
        where: { tokenHash: hashRefreshToken(currentRefreshToken) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const expiredRefresh = await browser.post('/api/v1/auth/refresh').set('Origin', origin)
      assert.equal(expiredRefresh.status, 401)
      const expiredSessionAccess = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refresh.body.accessToken}`)
      assert.equal(expiredSessionAccess.status, 401)

      const forgotPassword = await browser
        .post('/api/v1/auth/password/forgot')
        .set('Origin', origin)
        .send({ email })
      assert.equal(forgotPassword.status, 202)
      assert.equal(deliveredEmails.length, 2)
      assert.equal(deliveredEmails[1].from, 'ShopSmart <onboarding@resend.dev>')
      const resetLink = new URL(deliveredEmails[1].text.split('\n').at(-1)!)
      const resetToken = resetLink.searchParams.get('token')
      assert.ok(resetToken)
      const reset = await browser
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token: resetToken, password: updatedPassword })
      assert.equal(reset.status, 200)
      const reusedReset = await browser
        .post('/api/v1/auth/password/reset')
        .set('Origin', origin)
        .send({ token: resetToken, password })
      assert.equal(reusedReset.status, 400)
      const loginWithOldPassword = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password })
      assert.equal(loginWithOldPassword.status, 401)
      const loginWithNewPassword = await browser
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password: updatedPassword })
      assert.equal(loginWithNewPassword.status, 200)

      const logout = await browser.post('/api/v1/auth/logout').set('Origin', origin)
      assert.equal(logout.status, 204)
      const loggedOutAccess = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${loginWithNewPassword.body.accessToken}`)
      assert.equal(loggedOutAccess.status, 401)
      const refreshAfterLogout = await browser.post('/api/v1/auth/refresh').set('Origin', origin)
      assert.equal(refreshAfterLogout.status, 401)
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
      if (databaseAvailable) {
        await prisma.product.deleteMany({ where: { slug: productSlug } })
        await prisma.seller.deleteMany({ where: { slug: `seller-${suffix}` } })
        await prisma.user.deleteMany({ where: { email: sellerEmail } })
        await prisma.category.deleteMany({ where: { slug: categorySlug } })
        await prisma.auditLog.deleteMany({ where: { entityId: { in: [customerId, otherCustomerId].filter((id): id is string => Boolean(id)) } } })
        await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } })
      }
    }
  })
})
