import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthApiError,
  getAdminUsers,
  getCurrentUser,
  login,
  logout,
  refreshSession,
  register,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  updateProfile,
  verifyEmail,
} from './authApi'

const user = {
  id: 'user-1',
  email: 'customer@example.test',
  displayName: 'Customer Example',
  role: 'CUSTOMER',
  emailVerified: false,
}

afterEach(() => vi.unstubAllGlobals())

describe('authentication API client', () => {
  it('registers as a customer with credentialed cookies and never sends a role', async () => {
    let options: RequestInit | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      options = init
      return new Response(JSON.stringify({ user, accessToken: 'short-lived-token', expiresIn: 600 }), { status: 201 })
    }))

    const result = await register(user.email, 'a sufficiently long password', user.displayName)
    expect(result).toEqual({ user, accessToken: 'short-lived-token' })
    expect(options?.credentials).toBe('include')
    expect(JSON.parse(String(options?.body))).toEqual({
      email: user.email,
      password: 'a sufficiently long password',
      displayName: user.displayName,
    })
    expect(localStorage.getItem('accessToken')).toBeNull()
  })

  it('sends login, refresh, profile, and logout through the typed client', async () => {
    const calls: Array<{ path: string; options: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
      const path = new URL(String(input), window.location.origin).pathname
      calls.push({ path, options })
      if (path.endsWith('/login')) return new Response(JSON.stringify({ user, accessToken: 'access-1' }), { status: 200 })
      if (path.endsWith('/refresh')) return new Response(JSON.stringify({ accessToken: 'access-2' }), { status: 200 })
      if (path.endsWith('/me')) return new Response(JSON.stringify({ user: { ...user, displayName: 'New name' } }), { status: 200 })
      return new Response(null, { status: 204 })
    }))

    expect((await login(user.email, 'password')).accessToken).toBe('access-1')
    expect(await refreshSession()).toBe('access-2')
    expect((await getCurrentUser('access-2')).emailVerified).toBe(false)
    expect((await updateProfile('access-2', 'New name')).displayName).toBe('New name')
    await logout()
    expect(calls.map((call) => call.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/me',
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
    ])
    expect(calls[2].options.headers).toMatchObject({ Authorization: 'Bearer access-2' })
    expect(calls[3].options.method).toBe('PATCH')
    expect(calls.every(({ options }) => options.credentials === 'include')).toBe(true)
  })

  it('supports verification and recovery endpoints and surfaces API errors', async () => {
    const paths: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      paths.push(new URL(String(input), window.location.origin).pathname)
      return new Response(JSON.stringify({ message: 'accepted' }), { status: 202 })
    }))
    await requestEmailVerification('access-1')
    await verifyEmail('verification-token')
    await requestPasswordReset(user.email)
    await resetPassword('reset-token', 'a sufficiently long password')
    expect(paths).toEqual([
      '/api/v1/auth/email/verification',
      '/api/v1/auth/email/verify',
      '/api/v1/auth/password/forgot',
      '/api/v1/auth/password/reset',
    ])

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Email or password is incorrect' }), { status: 401 })))
    await expect(login(user.email, 'wrong')).rejects.toMatchObject({
      name: 'AuthApiError',
      status: 401,
      message: 'Email or password is incorrect',
    } satisfies Partial<AuthApiError>)
  })

  it('only exposes administrator directory data through the protected route client', async () => {
    let requestOptions: RequestInit | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      requestOptions = options
      return new Response(JSON.stringify({ items: [user] }), { status: 200 })
    }))
    expect(await getAdminUsers('admin-session')).toEqual([user])
    expect(requestOptions?.headers).toMatchObject({ Authorization: 'Bearer admin-session' })
  })
})
