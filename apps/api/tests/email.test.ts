import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  authEmailIsConfigured,
  AuthEmailDeliveryError,
  sendAuthEmail,
} from '../src/auth/email.js'

const emailInput = {
  to: 'customer@example.test',
  subject: 'Verify your ShopSmart email',
  text: 'Use this one-time link.',
}

async function withEmailConfiguration(run: () => Promise<void>): Promise<void> {
  const previous = {
    url: process.env.AUTH_EMAIL_DELIVERY_URL,
    key: process.env.AUTH_EMAIL_DELIVERY_API_KEY,
    from: process.env.AUTH_EMAIL_FROM_ADDRESS,
    nodeEnv: process.env.NODE_ENV,
  }
  process.env.AUTH_EMAIL_DELIVERY_URL = 'https://api.resend.com/emails'
  process.env.AUTH_EMAIL_DELIVERY_API_KEY = 'test-resend-api-key'
  process.env.AUTH_EMAIL_FROM_ADDRESS = 'ShopSmart <onboarding@resend.dev>'
  process.env.NODE_ENV = 'test'
  try {
    await run()
  } finally {
    if (previous.url === undefined) delete process.env.AUTH_EMAIL_DELIVERY_URL
    else process.env.AUTH_EMAIL_DELIVERY_URL = previous.url
    if (previous.key === undefined) delete process.env.AUTH_EMAIL_DELIVERY_API_KEY
    else process.env.AUTH_EMAIL_DELIVERY_API_KEY = previous.key
    if (previous.from === undefined) delete process.env.AUTH_EMAIL_FROM_ADDRESS
    else process.env.AUTH_EMAIL_FROM_ADDRESS = previous.from
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.nodeEnv
  }
}

describe('Resend authentication email adapter', () => {
  it('sends the configured sender and message using the Resend API request format', async () => {
    await withEmailConfiguration(async () => {
      const originalFetch = globalThis.fetch
      let requestUrl = ''
      let requestOptions: RequestInit | undefined
      globalThis.fetch = async (input, init) => {
        requestUrl = String(input)
        requestOptions = init
        return new Response(null, { status: 200 })
      }

      try {
        await sendAuthEmail(emailInput)
        assert.equal(requestUrl, 'https://api.resend.com/emails')
        assert.equal(requestOptions?.method, 'POST')
        assert.equal(requestOptions?.redirect, 'error')
        const headers = new Headers(requestOptions?.headers)
        assert.equal(headers.get('Authorization'), 'Bearer test-resend-api-key')
        assert.equal(headers.get('Content-Type'), 'application/json')
        assert.deepEqual(JSON.parse(String(requestOptions?.body)), {
          from: 'ShopSmart <onboarding@resend.dev>',
          ...emailInput,
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  it('reports an invalid API key without exposing provider response details', async () => {
    await withEmailConfiguration(async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => new Response(
        JSON.stringify({ message: 'invalid test-resend-api-key; provider diagnostic' }),
        { status: 401 },
      )

      try {
        await assert.rejects(sendAuthEmail(emailInput), (error: unknown) => {
          assert.ok(error instanceof AuthEmailDeliveryError)
          assert.equal(error.category, 'provider_http_rejection')
          assert.equal(error.providerStatus, 401)
          assert.equal(error.message, 'Authentication email delivery is unavailable')
          assert.equal(error.message.includes('test-resend-api-key'), false)
          assert.equal(error.message.includes('provider diagnostic'), false)
          assert.equal(JSON.stringify(error).includes('test-resend-api-key'), false)
          return true
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  it('reports other provider failures without exposing their response body', async () => {
    await withEmailConfiguration(async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => new Response(
        'private-provider-error-details',
        { status: 503 },
      )

      try {
        await assert.rejects(sendAuthEmail(emailInput), (error: unknown) => {
          assert.ok(error instanceof AuthEmailDeliveryError)
          assert.equal(error.category, 'provider_http_rejection')
          assert.equal(error.providerStatus, 503)
          assert.equal(error.message.includes('private-provider-error-details'), false)
          return true
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  it('requires all email environment settings and refuses delivery when any are missing', async () => {
    await withEmailConfiguration(async () => {
      const originalFetch = globalThis.fetch
      let fetchCalled = false
      globalThis.fetch = async () => {
        fetchCalled = true
        return new Response(null, { status: 200 })
      }

      try {
        for (const variable of [
          'AUTH_EMAIL_DELIVERY_URL',
          'AUTH_EMAIL_DELIVERY_API_KEY',
          'AUTH_EMAIL_FROM_ADDRESS',
        ]) {
          const value = process.env[variable]
          delete process.env[variable]
          assert.equal(authEmailIsConfigured(), false)
          await assert.rejects(sendAuthEmail(emailInput), (error: unknown) => {
            assert.ok(error instanceof AuthEmailDeliveryError)
            assert.equal(error.category, 'missing_configuration')
            assert.deepEqual(error.missingVariables, [variable])
            return true
          })
          if (value !== undefined) process.env[variable] = value
        }
        assert.equal(fetchCalled, false)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  it('converts network errors to a generic delivery error', async () => {
    await withEmailConfiguration(async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => {
        throw new Error('network error containing test-resend-api-key')
      }

      try {
        await assert.rejects(sendAuthEmail(emailInput), (error: unknown) => {
          assert.ok(error instanceof AuthEmailDeliveryError)
          assert.equal(error.category, 'network_failure')
          assert.equal(error.providerStatus, undefined)
          assert.equal(error.message.includes('test-resend-api-key'), false)
          assert.equal(JSON.stringify(error).includes('test-resend-api-key'), false)
          return true
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  it('distinguishes request timeout from other network failures', async () => {
    await withEmailConfiguration(async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => {
        const error = new Error('timeout details containing test-resend-api-key')
        error.name = 'TimeoutError'
        throw error
      }

      try {
        await assert.rejects(sendAuthEmail(emailInput), (error: unknown) => {
          assert.ok(error instanceof AuthEmailDeliveryError)
          assert.equal(error.category, 'timeout')
          assert.equal(error.providerStatus, undefined)
          assert.equal(error.message.includes('timeout details'), false)
          assert.equal(error.message.includes('test-resend-api-key'), false)
          return true
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  it('classifies invalid endpoint configuration without returning the endpoint', async () => {
    await withEmailConfiguration(async () => {
      const originalFetch = globalThis.fetch
      process.env.AUTH_EMAIL_DELIVERY_URL = 'not-a-provider-url'
      let fetchCalled = false
      globalThis.fetch = async () => {
        fetchCalled = true
        return new Response(null, { status: 200 })
      }

      try {
        assert.equal(authEmailIsConfigured(), false)
        await assert.rejects(sendAuthEmail(emailInput), (error: unknown) => {
          assert.ok(error instanceof AuthEmailDeliveryError)
          assert.equal(error.category, 'invalid_configuration')
          assert.equal(error.message.includes('not-a-provider-url'), false)
          assert.equal(error.missingVariables, undefined)
          return true
        })
        assert.equal(fetchCalled, false)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
