import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken, type AccessClaims } from './tokens.js'
import { prisma } from '../db.js'

declare global {
  namespace Express {
    interface Request {
      auth?: AccessClaims
    }
  }
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const authorization = request.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }

  let claims: AccessClaims
  try {
    claims = await verifyAccessToken(authorization.slice('Bearer '.length))
  } catch {
    response.status(401).json({ error: 'Invalid or expired access token' })
    return
  }

  try {
    const session = await prisma.refreshSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: { id: true, email: true, role: true } } },
    })
    if (!session) {
      response.status(401).json({ error: 'Session is invalid or expired' })
      return
    }
    request.auth = { sub: session.user.id, sid: session.id, email: session.user.email, role: session.user.role }
    next()
  } catch (error) {
    next(error)
  }
}
