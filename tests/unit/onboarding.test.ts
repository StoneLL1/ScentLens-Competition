import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('browsing entry', () => {
  it('remembers explicitly entering the home screen', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) })
    const onboarding = await import('../../src/app/onboarding')
    expect(onboarding.hasEntered()).toBe(false)
    onboarding.markEntered()
    vi.resetModules()
    expect((await import('../../src/app/onboarding')).hasEntered()).toBe(true)
  })
  it('keeps navigation available when persistence is denied', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    const onboarding = await import('../../src/app/onboarding')
    expect(onboarding.hasEntered()).toBe(false)
    expect(() => onboarding.markEntered()).not.toThrow()
    expect(onboarding.hasEntered()).toBe(true)
  })
})
