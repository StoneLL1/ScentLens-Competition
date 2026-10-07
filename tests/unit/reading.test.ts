import { describe, expect, it } from 'vitest'
import { createReading, fromHardware, parseScores, toConfidences } from '../../src/domain/reading'

describe('canonical score boundary', () => {
  it('preserves the protocol mapping, decimals, raw values and explicit scales', () => {
    const raw = [.01, .02, .03, .04, .05, .06, .07, .08]
    const reading = createReading({ captureSessionId: 'one', source: 'mock', rawScores: raw, rawScale: '0-1', resultValid: true, preview: false, quality: 'unknown' }, new Date('2026-10-02T03:04:05Z'))
    expect(reading.scores100).toEqual({ lemon: 4, rose: 6, lavender: 5, grass: 8, peach: 2, clove: 3, cedarwood: 7.000000000000001, vanilla: 1 })
    expect(toConfidences(reading.scores100)).toMatchObject({ lemon: .04, grass: .08, vanilla: .01 })
    expect(reading.rawScores).toEqual(raw)
    raw[0] = 1
    expect(reading.rawScores[0]).toBe(.01)
    expect(reading.capturedAt).toBe('2026-10-02T03:04:05.000Z')
    expect(reading.capturedAtSource).toBe('phone-received')
    expect(fromHardware([.125, 0, 0, 0, 0, 0, 0, 0]).vanilla).toBe(12.5)
  })
  it('accepts a complete all-zero result without normalizing', () => {
    expect(Object.values(fromHardware(Array(8).fill(0)))).toEqual(Array(8).fill(0))
    expect(Object.values(fromHardware(Array(8).fill(1)))).toEqual(Array(8).fill(100))
  })
  it.each([[], Array(7).fill(0), Array(9).fill(0), Array(8), [null,0,0,0,0,0,0,0], ['0',0,0,0,0,0,0,0], [false,0,0,0,0,0,0,0], [NaN,0,0,0,0,0,0,0], [Infinity,0,0,0,0,0,0,0], [-.1,0,0,0,0,0,0,0], [1.01,0,0,0,0,0,0,0]])('rejects missing, sparse, wrong-type or out-of-range arrays: %j', input => {
    expect(() => fromHardware(input)).toThrow()
  })
  it('does not fill absent named dimensions or infer a scale', () => {
    expect(() => parseScores({ lemon: 1 }, '0-1')).toThrow()
    expect(() => parseScores(Object.create(fromHardware(Array(8).fill(0))), '0-100')).toThrow()
    expect(parseScores(fromHardware(Array(8).fill(.01)), '0-100').lemon).toBe(1)
  })
})
