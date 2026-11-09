import { API_BASE_URL } from './catalogApi'

export type AuthRole =
  | 'CUSTOMER'
  | 'SELLER'
  | 'SELLER_STAFF'
  | 'MODERATOR'
  | 'SUPPORT_AGENT'
  | 'ADMIN'
  | 'SUPER_ADMIN'

export type AuthUser = {
  id: string
  email: string
  displayName: string
  role: AuthRole
  emailVerified: boolean
}

export type AuthSession = {
  user: AuthUser
  accessToken: string
}

export class AuthApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseUser(value: unknown): AuthUser {
  const roles: AuthRole[] = ['CUSTOMER', 'SELLER', 'SELLER_STAFF', 'MODERATOR', 'SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN']
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.email !== 'string'
    || typeof value.displayName !== 'string'
    || !roles.includes(value.role as AuthRole)
    || typeof value.emailVerified !== 'boolean') {
    throw new AuthApiError('The account service returned an invalid user profile.')
  }
  return {
    id: value.id,
    email: value.email,
    displayName: value.displayName,
    role: value.role as AuthRole,
    emailVerified: value.emailVerified,
  }
}

async function requestJson(path: string, options: {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  accessToken?: string
} = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/auth${path}`, {
      method: options.method ?? 'POST',
      credentials: 'include',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new AuthApiError('Could not reach the account service. Please try again.')
  }

  const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'The account request could not be completed.'
    throw new AuthApiError(message, response.status)
  }
  return payload
}

function parseSession(value: unknown): AuthSession {
  if (!isRecord(value) || typeof value.accessToken !== 'string' || !value.accessToken || !('user' in value)) {
    throw new AuthApiError('The account service returned an invalid session.')
  }
  return { accessToken: value.accessToken, user: parseUser(value.user) }
}

export async function register(email: string, password: string, displayName: string): Promise<AuthSession> {
  return parseSession(await requestJson('/register', { body: { email, password, displayName } }))
}

export async function login(email: string, password: string): Promise<AuthSession> {
  return parseSession(await requestJson('/login', { body: { email, password } }))
}

export async function refreshSession(): Promise<string> {
  const response = await requestJson('/refresh')
  if (!isRecord(response) || typeof response.accessToken !== 'string' || !response.accessToken) {
    throw new AuthApiError('The account service returned an invalid refresh session.')
  }
  return response.accessToken
}

export async function getCurrentUser(accessToken: string): Promise<AuthUser> {
  const response = await requestJson('/me', { method: 'GET', accessToken })
  if (!isRecord(response)) throw new AuthApiError('The account service returned an invalid user profile.')
  return parseUser(response.user)
}

export async function getAdminUsers(accessToken: string): Promise<AuthUser[]> {
  const response = await requestJson('/admin/users', { method: 'GET', accessToken })
  if (!isRecord(response) || !Array.isArray(response.items)) {
    throw new AuthApiError('The account service returned an invalid directory.')
  }
  return response.items.map(parseUser)
}

export async function updateProfile(accessToken: string, displayName: string): Promise<AuthUser> {
  const response = await requestJson('/me', { method: 'PATCH', accessToken, body: { displayName } })
  if (!isRecord(response)) throw new AuthApiError('The account service returned an invalid user profile.')
  return parseUser(response.user)
}

export async function logout(): Promise<void> {
  await requestJson('/logout')
}

export async function requestEmailVerification(accessToken: string): Promise<void> {
  await requestJson('/email/verification', { accessToken })
}

export async function verifyEmail(token: string): Promise<void> {
  await requestJson('/email/verify', { body: { token } })
}

export async function requestPasswordReset(email: string): Promise<void> {
  await requestJson('/password/forgot', { body: { email } })
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await requestJson('/password/reset', { body: { token, password } })
}
