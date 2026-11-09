import '../src/config/env.js'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import {
  BootstrapError,
  confirmAndBootstrapSuperAdmin,
  type BootstrapStore,
} from '../src/auth/superAdminBootstrap.js'

function createStore(client: PrismaClient): BootstrapStore {
  return {
    transaction: (work) => client.$transaction(
      async (transaction) => work({
        lockBootstrap: async () => {
          await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(198745621, 1)`)
        },
        countAdministrators: () => transaction.user.count({
          where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        }),
        findUserByEmail: (email) => transaction.user.findUnique({
          where: { email },
          select: { id: true, email: true, role: true, emailVerifiedAt: true },
        }),
        promoteCustomer: async (userId) => {
          const result = await transaction.user.updateMany({
            where: { id: userId, role: 'CUSTOMER', emailVerifiedAt: { not: null } },
            data: { role: 'SUPER_ADMIN' },
          })
          return result.count === 1
        },
        recordBootstrapAudit: async (userId) => {
          await transaction.auditLog.create({
            data: {
              actorId: null,
              action: 'SUPER_ADMIN_BOOTSTRAPPED',
              entityType: 'User',
              entityId: userId,
              metadata: { role: 'SUPER_ADMIN', source: 'one-time-cli' },
            },
          })
        },
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    ),
  }
}

function parseEmailArgument(args: string[]): string {
  if (args.length !== 2 || args[0] !== '--email' || !args[1]) {
    throw new BootstrapError('Usage: npm run admin:bootstrap -- --email <verified-customer-email>')
  }
  return args[1]
}

async function main(): Promise<void> {
  const email = parseEmailArgument(process.argv.slice(2))
  const { prisma } = await import('../src/db.js')
  const readline = createInterface({ input: stdin, output: stdout })
  try {
    const confirmed = await confirmAndBootstrapSuperAdmin(email, createStore(prisma), async (normalizedEmail) => {
      const answer = await readline.question(
        `Promote ${normalizedEmail} to SUPER_ADMIN? Type the email address exactly to confirm: `,
      )
      return answer.trim() === normalizedEmail
    })
    if (!confirmed) {
      console.log('Bootstrap cancelled. No changes were made.')
      return
    }
    console.log('The verified customer was promoted to SUPER_ADMIN.')
  } finally {
    readline.close()
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  if (error instanceof BootstrapError) {
    console.error(error.message)
  } else {
    console.error('Bootstrap failed without exposing database details. Check the account and audit log before retrying.')
  }
  process.exitCode = 1
})
