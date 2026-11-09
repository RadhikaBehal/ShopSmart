import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import request from 'supertest'
import { app } from '../src/app.js'
import { prisma } from '../src/db.js'

describe('ShopSmart API foundation', () => {
  after(async () => prisma.$disconnect())

  it('serves a liveness response without requiring PostgreSQL', async () => {
    const response = await request(app).get('/healthz')
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { status: 'ok' })
  })

  it('rejects invalid catalog query parameters before accessing PostgreSQL', async () => {
    const response = await request(app).get('/api/v1/products?pageSize=51')
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'Invalid query parameters')
    assert.equal(response.body.details[0].path[0], 'pageSize')
  })

  it('rejects conflicting price-range filters before accessing PostgreSQL', async () => {
    const response = await request(app)
      .get('/api/v1/products?minPriceMinor=1000&maxPriceMinor=999')
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'Invalid query parameters')
    assert.equal(response.body.details[0].path[0], 'minPriceMinor')
  })

  it('requires a bearer token before returning a private profile', async () => {
    const response = await request(app).get('/api/v1/auth/me')
    assert.equal(response.status, 401)
    assert.equal(response.body.error, 'Authentication required')
  })

  it('rejects weak registration input without touching the database', async () => {
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        email: 'not-an-email',
        password: 'short',
        displayName: 'A',
      })
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'Invalid registration details')
  })

  it('keeps auth disabled when the signing secret is not configured', async () => {
    delete process.env.AUTH_ACCESS_SECRET
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        email: 'customer@example.test',
        password: 'a sufficiently long password',
        displayName: 'Customer Example',
      })
    assert.equal(response.status, 503)
    assert.equal(response.body.error, 'Authentication is not configured on this server')
  })

  it('rejects auth mutations from an untrusted browser origin', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://untrusted.example')
    assert.equal(response.status, 403)
    assert.equal(response.body.error, 'Request origin is not allowed')
  })

  it('rejects cookie-based auth mutations without an Origin header', async () => {
    const response = await request(app).post('/api/v1/auth/logout')
    assert.equal(response.status, 403)
    assert.equal(response.body.error, 'Request origin is not allowed')
  })

  it('does not claim to send password recovery when email delivery is unconfigured', async () => {
    const previousUrl = process.env.AUTH_EMAIL_DELIVERY_URL
    const previousKey = process.env.AUTH_EMAIL_DELIVERY_API_KEY
    delete process.env.AUTH_EMAIL_DELIVERY_URL
    delete process.env.AUTH_EMAIL_DELIVERY_API_KEY
    try {
      const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
      const response = await request(app)
        .post('/api/v1/auth/password/forgot')
        .set('Origin', origin)
        .send({ email: 'customer@example.test' })
      assert.equal(response.status, 503)
      assert.equal(response.body.error, 'Email delivery is not configured on this server')
    } finally {
      if (previousUrl === undefined) delete process.env.AUTH_EMAIL_DELIVERY_URL
      else process.env.AUTH_EMAIL_DELIVERY_URL = previousUrl
      if (previousKey === undefined) delete process.env.AUTH_EMAIL_DELIVERY_API_KEY
      else process.env.AUTH_EMAIL_DELIVERY_API_KEY = previousKey
    }
  })

  it('allows credentialed browser requests from the configured storefront origin', async () => {
    const origin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173'
    const response = await request(app)
      .options('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
    assert.equal(response.status, 204)
    assert.equal(response.headers['access-control-allow-origin'], origin)
    assert.equal(response.headers['access-control-allow-credentials'], 'true')
  })
})
