import './config/env.js'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { ZodError } from 'zod'
import { prisma } from './db.js'
import { AuthEmailDeliveryError } from './auth/email.js'
import { getAllowedOrigins } from './security/origin.js'
import { authRouter } from './routes/auth.js'
import { adminProductRouter } from './routes/adminProducts.js'
import { productRouter } from './routes/products.js'
import { sellerProductRouter } from './routes/sellerProducts.js'
import { sellerRouter, sellerStoreRouter } from './routes/sellers.js'

export const app = express()

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: getAllowedOrigins(), credentials: true }))
app.use(express.json({ limit: '32kb' }))
app.use(pinoHttp({
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers.set-cookie',
    'res.headers.authorization',
  ],
  serializers: {
    req: (request) => ({
      id: request.id,
      method: request.method,
      path: request.url?.split('?')[0],
    }),
  },
}))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))

app.get('/healthz', (_request, response) => response.json({ status: 'ok' }))
app.get('/readyz', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    response.json({ status: 'ready', database: 'connected' })
  } catch {
    response.status(503).json({ status: 'not_ready', database: 'unavailable' })
  }
})

app.use('/api/v1/products', productRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/admin/products', adminProductRouter)
app.use('/api/v1/seller', sellerRouter)
app.use('/api/v1/seller/products', sellerProductRouter)
app.use('/api/v1/stores', sellerStoreRouter)

const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof AuthEmailDeliveryError) {
    request.log.error({
      event: 'AUTH_EMAIL_DELIVERY_FAILED',
      category: error.category,
      ...(error.providerStatus === undefined ? {} : { providerStatus: error.providerStatus }),
      ...(error.missingVariables === undefined ? {} : { missingVariables: error.missingVariables }),
    }, 'Authentication email delivery failed')
    response.status(503).json({ error: 'Authentication email delivery is unavailable. Please try again later.' })
    return
  }
  request.log.error({ err: error }, 'Request failed')
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    response.status(409).json({ error: 'An account with these details already exists' })
    return
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Invalid request', details: error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }
  response.status(500).json({ error: 'Internal server error' })
}

app.use(errorHandler)
