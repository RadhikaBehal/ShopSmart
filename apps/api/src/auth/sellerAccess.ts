import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../db.js'

export async function requireActiveSeller(request: Request, response: Response, next: NextFunction) {
  if (!request.auth) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }
  if (request.auth.role !== 'SELLER') {
    response.status(403).json({ error: 'An approved seller account is required' })
    return
  }

  try {
    const seller = await prisma.seller.findUnique({
      where: { userId: request.auth.sub },
      select: {
        id: true,
        status: true,
        user: { select: { sellerApplication: { select: { status: true } } } },
      },
    })
    if (!seller || seller.status !== 'VERIFIED' || seller.user.sellerApplication?.status !== 'APPROVED') {
      response.status(403).json({ error: 'An active, approved seller account is required' })
      return
    }
    next()
  } catch (error) {
    next(error)
  }
}
