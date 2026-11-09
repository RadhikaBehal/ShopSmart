export type StorageReader = Pick<Storage, 'getItem'>
export type StorageWriter = Pick<Storage, 'setItem'>

export type StoredValue<T> = {
  value: T
  notice?: string
}

export function getDemoStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readDemoValue<T>(
  storage: StorageReader | undefined,
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): StoredValue<T> {
  try {
    if (!storage) return { value: fallback, notice: 'Browser storage is unavailable; demo changes will not persist.' }
    const raw = storage.getItem(key)
    if (raw === null) return { value: fallback }
    const parsed: unknown = JSON.parse(raw)
    if (!isValid(parsed)) return { value: fallback, notice: 'Saved demo data was invalid and has been reset.' }
    return { value: parsed }
  } catch {
    return { value: fallback, notice: 'Saved demo data could not be read from this browser.' }
  }
}

export function writeDemoValue(storage: StorageWriter | undefined, key: string, value: unknown): string | undefined {
  try {
    if (!storage) return 'Browser storage is unavailable; demo changes will not persist.'
    storage.setItem(key, JSON.stringify(value))
    return undefined
  } catch {
    return 'Your browser could not save demo data. Changes may not survive a refresh.'
  }
}

export function isDemoCart(value: unknown): value is Record<string, number> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.entries(value).every(([id, quantity]) => id.length > 0 && Number.isInteger(quantity) && quantity > 0)
}

export function isDemoWishlist(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string' && id.length > 0)
}
