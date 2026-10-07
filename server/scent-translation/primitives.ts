import { createHash } from 'node:crypto'
import { TranslationError } from './types.ts'

export const sha256 = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex')
// JS rounding of score * 10000 fails on decimal half boundaries. Round the decimal
// representation, as Decimal(str(float(score))).quantize(ROUND_HALF_UP) does.
export function quantizeToUnits(score: number): number {
  const [mantissa, exponent = '0'] = Math.abs(score).toString().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const digits = BigInt(whole + fraction)
  const shift = Number(exponent) - fraction.length + 4
  const units = shift >= 0 ? digits * 10n ** BigInt(shift) : (() => {
    const divisor = 10n ** BigInt(-shift)
    return (digits + divisor / 2n) / divisor
  })()
  return Number(units) * (score < 0 ? -1 : 1)
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface ParsedJson { value: Json; floatPaths: Set<string> }
const pathKey = (path: string[]) => JSON.stringify(path)

// Parse before duplicate keys (including escaped aliases) are lost. The number
// lexemes also retain Python's int/float distinction for frozen config hashing.
export function parseJsonWithNumbers(text: string): ParsedJson {
  let offset = 0
  const floatPaths = new Set<string>()
  const fail = (): never => { throw new TranslationError('INVALID_INPUT', `Invalid or duplicate JSON near offset ${offset}`) }
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '\0')) offset++ }
  const string = (): string => {
    const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/.exec(text.slice(offset))
    if (!match) return fail()
    offset += match[0].length
    return JSON.parse(match[0]) as string
  }
  const value = (path: string[], depth: number): Json => {
    if (depth > 64) return fail()
    whitespace()
    if (text[offset] === '"') return string()
    if (text[offset] === '{') {
      offset++; whitespace()
      const out: Record<string, Json> = Object.create(null)
      if (text[offset] === '}') { offset++; return out }
      while (offset < text.length) {
        whitespace(); const key = string(); whitespace()
        if (Object.hasOwn(out, key) || text[offset++] !== ':') return fail()
        out[key] = value([...path, key], depth + 1); whitespace()
        const delimiter = text[offset++]
        if (delimiter === '}') return out
        if (delimiter !== ',') return fail()
      }
      return fail()
    }
    if (text[offset] === '[') {
      offset++; whitespace()
      const out: Json[] = []
      if (text[offset] === ']') { offset++; return out }
      while (offset < text.length) {
        out.push(value([...path, String(out.length)], depth + 1)); whitespace()
        const delimiter = text[offset++]
        if (delimiter === ']') return out
        if (delimiter !== ',') return fail()
      }
      return fail()
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, offset)) { offset += token.length; return result }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset))
    if (!match) return fail()
    offset += match[0].length
    const number = Number(match[0])
    if (!Number.isFinite(number)) return fail()
    if (/[.eE]/.test(match[0])) floatPaths.add(pathKey(path))
    else if (!Number.isSafeInteger(number)) return fail()
    return number
  }
  const parsed = value([], 0); whitespace()
  if (offset !== text.length) fail()
  return { value: parsed, floatPaths }
}
export function parseJsonStrict(text: string): unknown { return parseJsonWithNumbers(text).value }

function pythonFloat(value: number): string {
  if (Object.is(value, -0)) return '-0.0'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e16)) {
    const [mantissa, exponent] = value.toExponential().split('e')
    const n = Number(exponent)
    return `${mantissa}e${n >= 0 ? '+' : '-'}${String(Math.abs(n)).padStart(2, '0')}`
  }
  return Number.isInteger(value) ? `${value}.0` : value.toString()
}
// Python sorts Unicode code points, not locale order or JS UTF-16 code units.
export function compareIds(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!), right = Array.from(b, c => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i]
  return left.length - right.length
}
export function canonicalJson(input: unknown, floatPaths = new Set<string>()): string {
  const visit = (value: unknown, path: string[]): string => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TranslationError('INVALID_INPUT', 'Non-finite canonical number')
      return floatPaths.has(pathKey(path)) || !Number.isInteger(value) ? pythonFloat(value) : String(value)
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map((v, i) => visit(v, [...path, String(i)])).join(',')}]`
    if (value && typeof value === 'object') return `{${Object.keys(value).sort(compareIds).map(k => `${JSON.stringify(k)}:${visit((value as Record<string, unknown>)[k], [...path, k])}`).join(',')}}`
    throw new TranslationError('INVALID_INPUT', 'Non-JSON canonical value')
  }
  return visit(input, [])
}
export function labeledUniform(seedKey: string, label: string): number {
  return Number.parseInt(sha256(`${seedKey}|${label}`).slice(0, 13), 16) / 2 ** 52
}
export function weightedPick<T extends { id: string; weight?: number }>(seed: string, label: string, candidates: T[]): T {
  const ordered = [...candidates].sort((a, b) => compareIds(a.id, b.id))
  const total = ordered.reduce((sum, c) => sum + (c.weight ?? 1), 0)
  if (total <= 0) throw new TranslationError('INVALID_CONFIG', `No positive candidates: ${label}`)
  const target = labeledUniform(seed, label) * total
  let cumulative = 0
  for (const candidate of ordered) { cumulative += candidate.weight ?? 1; if (cumulative > target) return candidate }
  return ordered[ordered.length - 1]
}
