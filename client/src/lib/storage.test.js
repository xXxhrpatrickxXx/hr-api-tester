import { afterEach, describe, expect, it } from 'vitest'
import { readStored, storedNumber, writeStored } from './storage.js'

const original = globalThis.localStorage
afterEach(() => {
  globalThis.localStorage = original
})

function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

const throwing = {
  getItem() {
    throw new Error('SecurityError')
  },
  setItem() {
    throw new Error('QuotaExceededError')
  },
  removeItem() {
    throw new Error('SecurityError')
  },
}

describe('readStored / writeStored', () => {
  it('round-trips and removes on null', () => {
    globalThis.localStorage = memoryStorage()
    writeStored('k', 'v')
    expect(readStored('k')).toBe('v')
    writeStored('k', null)
    expect(readStored('k')).toBeNull()
  })

  it('never throws when storage is blocked', () => {
    globalThis.localStorage = throwing
    expect(readStored('k')).toBeNull()
    expect(() => writeStored('k', 'v')).not.toThrow()
    expect(() => writeStored('k', null)).not.toThrow()
  })

  it('never throws when storage is missing', () => {
    globalThis.localStorage = undefined
    expect(readStored('k')).toBeNull()
    expect(() => writeStored('k', 'v')).not.toThrow()
  })
})

describe('storedNumber', () => {
  it('accepts numbers in range', () => {
    expect(storedNumber('500', 280, 1400, 420)).toBe(500)
  })

  it('falls back on missing, junk or out-of-range values', () => {
    expect(storedNumber(null, 280, 1400, 420)).toBe(420)
    expect(storedNumber('', 280, 1400, 420)).toBe(420)
    expect(storedNumber('abc', 280, 1400, 420)).toBe(420)
    expect(storedNumber('10', 280, 1400, 420)).toBe(420)
    expect(storedNumber('99999', 280, 1400, 420)).toBe(420)
  })
})
