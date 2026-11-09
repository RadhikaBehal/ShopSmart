import type { UserRole } from '@prisma/client'
import { z } from 'zod'

const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase())

export type BootstrapUser = {
  id: string
  email: string
  role: UserRole
  emailVerifiedAt: Date | null
}

export type BootstrapTransaction = {
  lockBootstrap: () => Promise<void>
  countAdministrators: () => Promise<number>
  findUserByEmail: (email: string) => Promise<BootstrapUser | null>
  promoteCustomer: (userId: string) => Promise<boolean>
  recordBootstrapAudit: (userId: string) => Promise<void>
}

export type BootstrapStore = {
  transaction: <T>(work: (transaction: BootstrapTransaction) => Promise<T>) => Promise<T>
}

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BootstrapError'
  }
}

export function normalizeBootstrapEmail(value: string): string {
  const parsed = emailSchema.safeParse(value)
  if (!parsed.success) throw new BootstrapError('Provide a valid account email address.')
  return parsed.data
}

export async function bootstrapSuperAdmin(email: string, store: BootstrapStore): Promise<void> {
  const normalizedEmail = normalizeBootstrapEmail(email)
  await store.transaction(async (transaction) => {
    await transaction.lockBootstrap()
    if (await transaction.countAdministrators() > 0) {
      throw new BootstrapError('Bootstrap refused: an administrator already exists.')
    }

    const user = await transaction.findUserByEmail(normalizedEmail)
    if (!user) throw new BootstrapError('Bootstrap refused: no account exists for that email.')
    if (!user.emailVerifiedAt) throw new BootstrapError('Bootstrap refused: the account email is not verified.')
    if (user.role !== 'CUSTOMER') throw new BootstrapError('Bootstrap refused: the account is not a customer.')

    if (!await transaction.promoteCustomer(user.id)) {
      throw new BootstrapError('Bootstrap refused: the account changed during promotion. No changes were committed.')
    }
    await transaction.recordBootstrapAudit(user.id)
  })
}

export async function confirmAndBootstrapSuperAdmin(
  email: string,
  store: BootstrapStore,
  confirm: (normalizedEmail: string) => Promise<boolean>,
): Promise<boolean> {
  const normalizedEmail = normalizeBootstrapEmail(email)
  if (!await confirm(normalizedEmail)) return false
  await bootstrapSuperAdmin(normalizedEmail, store)
  return true
}
