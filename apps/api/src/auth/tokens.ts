import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'

const scrypt = promisify(scryptCallback)
const ACCESS_TOKEN_TTL_SECONDS = 10 * 60
const REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type AccessClaims = {
  sub: string
  sid: string
  role: 'CUSTOMER' | 'SELLER' | 'SELLER_STAFF' | 'MODERATOR' | 'SUPPORT_AGENT' | 'ADMIN' | 'SUPER_ADMIN'
  email: string
}

function accessSecret(): Uint8Array {
  const secret = process.env.AUTH_ACCESS_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('AUTH_ACCESS_SECRET must be configured with at least 32 bytes')
  }
  return new TextEncoder().encode(secret)
}

export function authIsConfigured(): boolean {
  return Boolean(process.env.AUTH_ACCESS_SECRET && Buffer.byteLength(process.env.AUTH_ACCESS_SECRET, 'utf8') >= 32)
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function hashAuthActionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function newAuthActionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function authActionExpiry(purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'): Date {
  const duration = purpose === 'EMAIL_VERIFICATION' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
  return new Date(Date.now() + duration)
}

export function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_SESSION_TTL_MS)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltEncoded, hashEncoded, extra] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltEncoded || !hashEncoded || extra !== undefined) return false

  try {
    const salt = Buffer.from(saltEncoded, 'base64url')
    const expected = Buffer.from(hashEncoded, 'base64url')
    if (salt.length !== 16 || expected.length !== 64) return false
    const actual = await scrypt(password, salt, expected.length) as Buffer
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export async function createAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, role: claims.role, email: claims.email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer('shopsmart-api')
    .setAudience('shopsmart-web')
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessSecret())
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessSecret(), {
    algorithms: ['HS256'],
    issuer: 'shopsmart-api',
    audience: 'shopsmart-web',
  })
  if (
    typeof payload.sub !== 'string'
    || typeof payload.sid !== 'string'
    || !['CUSTOMER', 'SELLER', 'SELLER_STAFF', 'MODERATOR', 'SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'].includes(String(payload.role))
    || typeof payload.email !== 'string'
  ) {
    throw new Error('Invalid access token claims')
  }
  return {
    sub: payload.sub,
    sid: payload.sid,
    role: payload.role as AccessClaims['role'],
    email: payload.email,
  }
}
