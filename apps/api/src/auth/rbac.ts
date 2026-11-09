import type { NextFunction, Request, Response } from 'express'
import type { AccessClaims } from './tokens.js'

type UserRole = AccessClaims['role']

export function requireRoles(...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.auth) {
      response.status(401).json({ error: 'Authentication required' })
      return
    }
    if (!roles.includes(request.auth.role)) {
      response.status(403).json({ error: 'You do not have permission to access this resource' })
      return
    }
    next()
  }
}

export function requireSelfOrRoles(parameterName: string, ...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.auth) {
      response.status(401).json({ error: 'Authentication required' })
      return
    }
    if (request.auth.sub !== request.params[parameterName] && !roles.includes(request.auth.role)) {
      response.status(403).json({ error: 'You do not have permission to access this resource' })
      return
    }
    next()
  }
}
