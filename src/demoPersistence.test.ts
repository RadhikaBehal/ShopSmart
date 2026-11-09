import { describe, expect, it } from 'vitest'
import { isDemoCart, isDemoWishlist, readDemoValue, writeDemoValue } from './demoPersistence'

function storageWith(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('demo browser persistence', () => {
  it('round-trips the shopping bag and wishlist in local storage', () => {
    const storage = storageWith()
    expect(writeDemoValue(storage, 'bag', { speaker: 2 })).toBeUndefined()
    expect(readDemoValue(storage, 'bag', {}, isDemoCart)).toEqual({ value: { speaker: 2 } })
    expect(isDemoWishlist(['lamp', 'speaker'])).toBe(true)
  })

  it('rejects malformed or unsafe persisted values with a visible notice', () => {
    const storage = storageWith({ bag: '{"speaker":0}' })
    expect(readDemoValue(storage, 'bag', {}, isDemoCart)).toEqual({
      value: {},
      notice: 'Saved demo data was invalid and has been reset.',
    })
    expect(isDemoCart({ speaker: -1 })).toBe(false)
    expect(isDemoWishlist(['lamp', 4])).toBe(false)
  })

  it('discloses unavailable storage rather than silently pretending to persist', () => {
    expect(readDemoValue(undefined, 'bag', {}, isDemoCart).notice).toContain('Browser storage is unavailable')
    expect(writeDemoValue(undefined, 'bag', {})).toContain('Browser storage is unavailable')
  })
})
