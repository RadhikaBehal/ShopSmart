import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import { requireRoles, requireSelfOrRoles } from '../auth/rbac.js'
import {
  authActionExpiry,
  authIsConfigured,
  createAccessToken,
  hashAuthActionToken,
  hashPassword,
  hashRefreshToken,
  newAuthActionToken,
  newRefreshToken,
  refreshExpiry,
  verifyPassword,
} from '../auth/tokens.js'
import { emailDeliveryConfigurationIssue, sendAuthEmail } from '../auth/email.js'
import { prisma } from '../db.js'
import { getAllowedOrigins, requireAllowedOrigin } from '../security/origin.js'

export const authRouter = Router()
const REFRESH_COOKIE = 'shopsmart_refresh'
const registerRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})
const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})
const recoveryRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})
const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'))

const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(2).max(80),
})

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128),
})

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
})

const recoveryRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
})

const tokenSchema = z.object({ token: z.string().min(32).max(256) })
const resetPasswordSchema = tokenSchema.extend({ password: z.string().min(12).max(128) })

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' as const : 'strict' as const,
    path: '/api/v1/auth',
  }
}

function readCookie(request: { headers: { cookie?: string } }, name: string): string | undefined {
  const prefix = `${name}=`
  const pair = request.headers.cookie?.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix))
  if (!pair) return undefined
  try {
    return decodeURIComponent(pair.slice(prefix.length))
  } catch {
    return undefined
  }
}

function userResponse(user: {
  id: string
  email: string
  displayName: string
  role: string
  emailVerifiedAt?: Date | null
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    emailVerified: Boolean(user.emailVerifiedAt),
  }
}

async function issueSession(user: { id: string; email: string; role: 'CUSTOMER' | 'SELLER' | 'SELLER_STAFF' | 'MODERATOR' | 'SUPPORT_AGENT' | 'ADMIN' | 'SUPER_ADMIN' }) {
  const refreshToken = newRefreshToken()
  const sessionId = await prisma.$transaction(async (transaction) => {
    const session = await transaction.refreshSession.create({
      data: { userId: user.id, tokenHash: hashRefreshToken(refreshToken), expiresAt: refreshExpiry() },
    })
    await transaction.auditLog.create({
      data: { actorId: user.id, action: 'AUTH_SESSION_ISSUED', entityType: 'User', entityId: user.id },
    })
    return session.id
  })
  const accessToken = await createAccessToken({ sub: user.id, sid: sessionId, email: user.email, role: user.role })
  return { accessToken, refreshToken }
}

async function createActionToken(userId: string, purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
  const token = newAuthActionToken()
  const tokenHash = hashAuthActionToken(token)
  await prisma.$transaction(async (transaction) => {
    await transaction.authActionToken.deleteMany({ where: { userId, purpose, consumedAt: null } })
    await transaction.authActionToken.create({
      data: { userId, purpose, tokenHash, expiresAt: authActionExpiry(purpose) },
    })
  })
  return token
}

async function deliverActionEmail(
  user: { email: string },
  token: string,
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
) {
  const action = purpose === 'EMAIL_VERIFICATION' ? 'verify' : 'reset'
  const link = new URL('/', getAllowedOrigins()[0] ?? 'http://localhost:5173')
  link.searchParams.set('authAction', action)
  link.searchParams.set('token', token)
  await sendAuthEmail({
    to: user.email,
    subject: purpose === 'EMAIL_VERIFICATION' ? 'Verify your ShopSmart email' : 'Reset your ShopSmart password',
    text: `Use this one-time link within ${purpose === 'EMAIL_VERIFICATION' ? '24 hours' : '1 hour'}:\n${link.toString()}`,
  })
}

authRouter.post('/register', requireAllowedOrigin, registerRateLimit, async (request, response, next) => {
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid registration details', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }
  if (!authIsConfigured()) {
    response.status(503).json({ error: 'Authentication is not configured on this server' })
    return
  }
  try {
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        displayName: parsed.data.displayName,
        role: 'CUSTOMER',
      },
      select: { id: true, email: true, displayName: true, role: true, emailVerifiedAt: true },
    })
    const session = await issueSession({ ...user, role: 'CUSTOMER' })
    response.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions(), expires: refreshExpiry() })
    response.status(201).json({ user: userResponse(user), accessToken: session.accessToken, expiresIn: 600 })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/login', requireAllowedOrigin, loginRateLimit, async (request, response, next) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid sign-in details', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }
  if (!authIsConfigured()) {
    response.status(503).json({ error: 'Authentication is not configured on this server' })
    return
  }
  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
    const passwordMatches = await verifyPassword(parsed.data.password, user?.passwordHash ?? await dummyPasswordHash)
    if (!user || !passwordMatches) {
      request.log.warn({ event: 'AUTH_LOGIN_REJECTED' }, 'Authentication credentials rejected')
      response.status(401).json({ error: 'Email or password is incorrect' })
      return
    }
    const session = await issueSession({ id: user.id, email: user.email, role: user.role })
    response.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions(), expires: refreshExpiry() })
    response.json({
      user: userResponse(user),
      accessToken: session.accessToken,
      expiresIn: 600,
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/refresh', requireAllowedOrigin, refreshRateLimit, async (request, response, next) => {
  const oldToken = readCookie(request, REFRESH_COOKIE)
  if (!oldToken) {
    response.status(401).json({ error: 'Refresh session required' })
    return
  }
  if (!authIsConfigured()) {
    response.status(503).json({ error: 'Authentication is not configured on this server' })
    return
  }

  try {
    const oldHash = hashRefreshToken(oldToken)
    const replacement = newRefreshToken()
    const replacementHash = hashRefreshToken(replacement)
    const expiresAt = refreshExpiry()
    const session = await prisma.$transaction(async (transaction) => {
      const current = await transaction.refreshSession.findUnique({
        where: { tokenHash: oldHash },
        include: { user: { select: { id: true, email: true, role: true } } },
      })
      if (!current || current.revokedAt || current.expiresAt <= new Date()) return null

      const revoked = await transaction.refreshSession.updateMany({
        where: { id: current.id, tokenHash: oldHash, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      })
      if (revoked.count !== 1) return null

      const replacementSession = await transaction.refreshSession.create({
        data: { userId: current.user.id, tokenHash: replacementHash, expiresAt },
      })
      await transaction.auditLog.create({
        data: { actorId: current.user.id, action: 'AUTH_SESSION_REFRESHED', entityType: 'User', entityId: current.user.id },
      })
      return { user: current.user, sessionId: replacementSession.id }
    }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 10_000 })

    if (!session) {
      response.clearCookie(REFRESH_COOKIE, cookieOptions())
      response.status(401).json({ error: 'Refresh session is invalid or expired' })
      return
    }
    const accessToken = await createAccessToken({
      sub: session.user.id,
      sid: session.sessionId,
      email: session.user.email,
      role: session.user.role,
    })
    response.cookie(REFRESH_COOKIE, replacement, { ...cookieOptions(), expires: expiresAt })
    response.json({ accessToken, expiresIn: 600 })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', requireAllowedOrigin, async (request, response, next) => {
  const token = readCookie(request, REFRESH_COOKIE)
  try {
    if (token) {
      const tokenHash = hashRefreshToken(token)
      const session = await prisma.refreshSession.findUnique({ where: { tokenHash }, select: { userId: true, revokedAt: true } })
      if (session && !session.revokedAt) {
        await prisma.$transaction(async (transaction) => {
          await transaction.refreshSession.updateMany({
            where: { tokenHash, revokedAt: null },
            data: { revokedAt: new Date() },
          })
          await transaction.auditLog.create({
            data: { actorId: session.userId, action: 'AUTH_SESSION_REVOKED', entityType: 'User', entityId: session.userId },
          })
        })
      }
    }
    response.clearCookie(REFRESH_COOKIE, cookieOptions())
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me', requireAuth, async (request, response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.auth!.sub },
      select: { id: true, email: true, displayName: true, role: true, emailVerifiedAt: true },
    })
    if (!user) {
      response.status(401).json({ error: 'Account no longer exists' })
      return
    }
    response.json({ user: userResponse(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.patch('/me', requireAuth, requireAllowedOrigin, async (request, response, next) => {
  const parsed = profileSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid profile details', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }
  try {
    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: request.auth!.sub },
        data: { displayName: parsed.data.displayName },
        select: { id: true, email: true, displayName: true, role: true, emailVerifiedAt: true },
      })
      await transaction.auditLog.create({
        data: { actorId: updated.id, action: 'AUTH_PROFILE_UPDATED', entityType: 'User', entityId: updated.id },
      })
      return updated
    })
    response.json({ user: userResponse(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.get('/users/:userId', requireAuth, requireSelfOrRoles('userId', 'ADMIN', 'SUPER_ADMIN'), async (request, response, next) => {
  try {
    const userId = request.params.userId
    if (typeof userId !== 'string') {
      response.status(400).json({ error: 'Invalid account identifier' })
      return
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, role: true, emailVerifiedAt: true },
    })
    if (!user) {
      response.status(404).json({ error: 'Account not found' })
      return
    }
    response.json({ user: userResponse(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.get('/admin/users', requireAuth, requireRoles('ADMIN', 'SUPER_ADMIN'), async (_request, response, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, email: true, displayName: true, role: true, emailVerifiedAt: true },
    })
    response.json({ items: users.map(userResponse) })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/email/verification', requireAuth, requireAllowedOrigin, recoveryRateLimit, async (request, response, next) => {
  const configurationIssue = emailDeliveryConfigurationIssue()
  if (configurationIssue) {
    request.log.warn({
      event: 'AUTH_EMAIL_DELIVERY_CONFIGURATION_INVALID',
      category: configurationIssue.category,
      ...('missingVariables' in configurationIssue ? { missingVariables: configurationIssue.missingVariables } : {}),
    }, 'Authentication email delivery is not configured')
    response.status(503).json({ error: 'Email delivery is not configured on this server' })
    return
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.auth!.sub },
      select: { id: true, email: true, emailVerifiedAt: true },
    })
    if (!user) {
      response.status(401).json({ error: 'Account no longer exists' })
      return
    }
    if (user.emailVerifiedAt) {
      response.status(409).json({ error: 'This email address is already verified' })
      return
    }
    const token = await createActionToken(user.id, 'EMAIL_VERIFICATION')
    try {
      await deliverActionEmail(user, token, 'EMAIL_VERIFICATION')
    } catch (error) {
      await prisma.authActionToken.deleteMany({ where: { tokenHash: hashAuthActionToken(token) } })
      throw error
    }
    response.status(202).json({ message: 'Verification instructions have been sent.' })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/email/verify', requireAllowedOrigin, recoveryRateLimit, async (request, response, next) => {
  const parsed = tokenSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'A valid verification token is required' })
    return
  }
  try {
    const tokenHash = hashAuthActionToken(parsed.data.token)
    const result = await prisma.$transaction(async (transaction) => {
      const token = await transaction.authActionToken.findUnique({
        where: { tokenHash },
        include: { user: { select: { id: true } } },
      })
      if (!token || token.purpose !== 'EMAIL_VERIFICATION' || token.consumedAt || token.expiresAt <= new Date()) return false
      const consumed = await transaction.authActionToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      })
      if (consumed.count !== 1) return false
      await transaction.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } })
      await transaction.auditLog.create({
        data: { actorId: token.userId, action: 'AUTH_EMAIL_VERIFIED', entityType: 'User', entityId: token.userId },
      })
      return true
    })
    if (!result) {
      response.status(400).json({ error: 'Verification link is invalid or expired' })
      return
    }
    response.json({ message: 'Your email address is verified.' })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/password/forgot', requireAllowedOrigin, recoveryRateLimit, async (request, response, next) => {
  const parsed = recoveryRequestSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'A valid email address is required' })
    return
  }
  const configurationIssue = emailDeliveryConfigurationIssue()
  if (configurationIssue) {
    request.log.warn({
      event: 'AUTH_EMAIL_DELIVERY_CONFIGURATION_INVALID',
      category: configurationIssue.category,
      ...('missingVariables' in configurationIssue ? { missingVariables: configurationIssue.missingVariables } : {}),
    }, 'Authentication email delivery is not configured')
    response.status(503).json({ error: 'Email delivery is not configured on this server' })
    return
  }
  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true },
    })
    if (user) {
      const token = await createActionToken(user.id, 'PASSWORD_RESET')
      try {
        await deliverActionEmail(user, token, 'PASSWORD_RESET')
      } catch (error) {
        await prisma.authActionToken.deleteMany({ where: { tokenHash: hashAuthActionToken(token) } })
        throw error
      }
    }
    response.status(202).json({ message: 'If an account exists for that address, password reset instructions have been sent.' })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/password/reset', requireAllowedOrigin, recoveryRateLimit, async (request, response, next) => {
  const parsed = resetPasswordSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid password reset details', details: parsed.error.issues.map(({ path, message }) => ({ path, message })) })
    return
  }
  if (!authIsConfigured()) {
    response.status(503).json({ error: 'Authentication is not configured on this server' })
    return
  }
  try {
    const tokenHash = hashAuthActionToken(parsed.data.token)
    const passwordHash = await hashPassword(parsed.data.password)
    const reset = await prisma.$transaction(async (transaction) => {
      const token = await transaction.authActionToken.findUnique({ where: { tokenHash } })
      if (!token || token.purpose !== 'PASSWORD_RESET' || token.consumedAt || token.expiresAt <= new Date()) return false
      const consumed = await transaction.authActionToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      })
      if (consumed.count !== 1) return false
      await transaction.user.update({ where: { id: token.userId }, data: { passwordHash } })
      await transaction.refreshSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await transaction.authActionToken.deleteMany({
        where: { userId: token.userId, purpose: 'PASSWORD_RESET', id: { not: token.id }, consumedAt: null },
      })
      await transaction.auditLog.create({
        data: { actorId: token.userId, action: 'AUTH_PASSWORD_RESET', entityType: 'User', entityId: token.userId },
      })
      return true
    })
    if (!reset) {
      response.status(400).json({ error: 'Password reset link is invalid or expired' })
      return
    }
    response.clearCookie(REFRESH_COOKIE, cookieOptions())
    response.json({ message: 'Your password has been updated. Sign in with your new password.' })
  } catch (error) {
    next(error)
  }
})
