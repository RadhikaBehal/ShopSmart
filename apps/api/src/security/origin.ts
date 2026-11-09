import type { NextFunction, Request, Response } from 'express'

export function getAllowedOrigins(): string[] {
  return (process.env.WEB_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function isAllowedOrigin(origin: string): boolean {
  return getAllowedOrigins().includes(origin)
}

export function requireAllowedOrigin(request: Request, response: Response, next: NextFunction) {
  const origin = request.get('origin')
  if (!origin || !isAllowedOrigin(origin)) {
    response.status(403).json({ error: 'Request origin is not allowed' })
    return
  }
  next()
}
