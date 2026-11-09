type AuthEmail = {
  to: string
  subject: string
  text: string
}

export type AuthEmailDeliveryFailureCategory =
  | 'network_failure'
  | 'provider_http_rejection'
  | 'timeout'
  | 'missing_configuration'
  | 'invalid_configuration'

type AuthEmailDeliveryDiagnostics = {
  providerStatus?: number
  missingVariables?: string[]
}

export class AuthEmailDeliveryError extends Error {
  readonly category: AuthEmailDeliveryFailureCategory
  readonly providerStatus?: number
  readonly missingVariables?: string[]

  constructor(category: AuthEmailDeliveryFailureCategory, diagnostics: AuthEmailDeliveryDiagnostics = {}) {
    super('Authentication email delivery is unavailable')
    this.name = 'AuthEmailDeliveryError'
    this.category = category
    if (diagnostics.providerStatus !== undefined) this.providerStatus = diagnostics.providerStatus
    if (diagnostics.missingVariables !== undefined) this.missingVariables = diagnostics.missingVariables
  }
}

export function emailDeliveryConfigurationIssue():
  | { category: 'missing_configuration'; missingVariables: string[] }
  | { category: 'invalid_configuration' }
  | null {
  const requiredVariables: Array<[string, string | undefined]> = [
    ['AUTH_EMAIL_DELIVERY_URL', process.env.AUTH_EMAIL_DELIVERY_URL],
    ['AUTH_EMAIL_DELIVERY_API_KEY', process.env.AUTH_EMAIL_DELIVERY_API_KEY],
    ['AUTH_EMAIL_FROM_ADDRESS', process.env.AUTH_EMAIL_FROM_ADDRESS],
  ]
  const missingVariables = requiredVariables.filter(([, value]) => !value?.trim()).map(([name]) => name)
  if (missingVariables.length > 0) return { category: 'missing_configuration', missingVariables }

  const endpoint = process.env.AUTH_EMAIL_DELIVERY_URL
  try {
    const url = new URL(endpoint!)
    return !url.username
      && !url.password
      && (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)))
      ? null
      : { category: 'invalid_configuration' }
  } catch {
    return { category: 'invalid_configuration' }
  }
}

export function authEmailIsConfigured(): boolean {
  return emailDeliveryConfigurationIssue() === null
}

function isTimeoutError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'TimeoutError'
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const endpoint = process.env.AUTH_EMAIL_DELIVERY_URL
  const apiKey = process.env.AUTH_EMAIL_DELIVERY_API_KEY?.trim()
  const from = process.env.AUTH_EMAIL_FROM_ADDRESS?.trim()
  const configurationIssue = emailDeliveryConfigurationIssue()
  if (configurationIssue) {
    throw new AuthEmailDeliveryError(configurationIssue.category, {
      ...('missingVariables' in configurationIssue ? { missingVariables: configurationIssue.missingVariables } : {}),
    })
  }

  let response: Response
  try {
    response = await fetch(endpoint!, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, ...email }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new AuthEmailDeliveryError(isTimeoutError(error) ? 'timeout' : 'network_failure')
  }

  if (!response.ok) {
    throw new AuthEmailDeliveryError('provider_http_rejection', { providerStatus: response.status })
  }
}
