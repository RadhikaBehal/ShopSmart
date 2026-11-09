import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bootstrapSuperAdmin,
  confirmAndBootstrapSuperAdmin,
  type BootstrapStore,
  type BootstrapTransaction,
  type BootstrapUser,
} from '../src/auth/superAdminBootstrap.js'

type TestUser = BootstrapUser

class MemoryBootstrapStore implements BootstrapStore {
  users: TestUser[]
  audits: string[] = []
  failAudit = false
  transactionCount = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(users: TestUser[]) {
    this.users = users
  }

  async transaction<T>(work: (transaction: BootstrapTransaction) => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await previous
    const usersBefore = this.users.map((user) => ({ ...user }))
    const auditsBefore = [...this.audits]
    this.transactionCount += 1
    try {
      return await work({
        lockBootstrap: async () => {},
        countAdministrators: async () => this.users.filter(
          (user) => user.role === 'ADMIN' || user.role === 'SUPER_ADMIN',
        ).length,
        findUserByEmail: async (email) => this.users.find((user) => user.email === email) ?? null,
        promoteCustomer: async (userId) => {
          const user = this.users.find((candidate) => candidate.id === userId)
          if (!user || user.role !== 'CUSTOMER' || !user.emailVerifiedAt) return false
          user.role = 'SUPER_ADMIN'
          return true
        },
        recordBootstrapAudit: async (userId) => {
          if (this.failAudit) throw new Error('test audit failure')
          this.audits.push(userId)
        },
      })
    } catch (error) {
      this.users = usersBefore
      this.audits = auditsBefore
      throw error
    } finally {
      release()
    }
  }
}

function customer(id = 'customer-1', overrides: Partial<TestUser> = {}): TestUser {
  return {
    id,
    email: `${id}@example.test`,
    role: 'CUSTOMER',
    emailVerifiedAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('one-time Super Admin bootstrap', () => {
  it('promotes only the explicitly selected verified customer and records the action', async () => {
    const target = customer()
    const unrelated = customer('unrelated')
    const store = new MemoryBootstrapStore([target, unrelated])

    await bootstrapSuperAdmin(`  ${target.email.toUpperCase()} `, store)

    assert.equal(store.users[0].role, 'SUPER_ADMIN')
    assert.equal(store.users[1].role, 'CUSTOMER')
    assert.deepEqual(store.audits, [target.id])
  })

  it('refuses when an administrator already exists', async () => {
    const store = new MemoryBootstrapStore([customer(), customer('admin', { role: 'ADMIN' })])
    await assert.rejects(bootstrapSuperAdmin('customer-1@example.test', store), /administrator already exists/)
    assert.equal(store.users[0].role, 'CUSTOMER')
  })

  it('refuses an unverified account', async () => {
    const store = new MemoryBootstrapStore([customer('customer-1', { emailVerifiedAt: null })])
    await assert.rejects(bootstrapSuperAdmin('customer-1@example.test', store), /email is not verified/)
    assert.equal(store.users[0].role, 'CUSTOMER')
  })

  it('refuses a nonexistent account', async () => {
    const store = new MemoryBootstrapStore([])
    await assert.rejects(bootstrapSuperAdmin('missing@example.test', store), /no account exists/)
  })

  it('rejects invalid email input before opening a transaction', async () => {
    const store = new MemoryBootstrapStore([customer()])
    await assert.rejects(bootstrapSuperAdmin('not-an-email', store), /valid account email/)
    assert.equal(store.transactionCount, 0)
  })

  it('refuses an account that is not a customer', async () => {
    const store = new MemoryBootstrapStore([customer('customer-1', { role: 'SELLER' })])
    await assert.rejects(bootstrapSuperAdmin('customer-1@example.test', store), /not a customer/)
    assert.equal(store.users[0].role, 'SELLER')
  })

  it('serializes concurrent attempts so exactly one promotion commits', async () => {
    const store = new MemoryBootstrapStore([customer()])
    const outcomes = await Promise.allSettled([
      bootstrapSuperAdmin('customer-1@example.test', store),
      bootstrapSuperAdmin('customer-1@example.test', store),
    ])

    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1)
    assert.equal(store.users[0].role, 'SUPER_ADMIN')
    assert.deepEqual(store.audits, ['customer-1'])
  })

  it('rolls back the role change if audit insertion fails', async () => {
    const store = new MemoryBootstrapStore([customer()])
    store.failAudit = true

    await assert.rejects(bootstrapSuperAdmin('customer-1@example.test', store), /test audit failure/)
    assert.equal(store.users[0].role, 'CUSTOMER')
    assert.deepEqual(store.audits, [])
  })

  it('does not open a transaction when confirmation is cancelled', async () => {
    const store = new MemoryBootstrapStore([customer()])
    const promoted = await confirmAndBootstrapSuperAdmin(
      'customer-1@example.test',
      store,
      async () => false,
    )

    assert.equal(promoted, false)
    assert.equal(store.transactionCount, 0)
    assert.equal(store.users[0].role, 'CUSTOMER')
    assert.deepEqual(store.audits, [])
  })
})
