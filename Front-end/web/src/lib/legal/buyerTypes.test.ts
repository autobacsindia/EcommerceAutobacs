/**
 * Client-side GSTIN feedback.
 *
 * This is UX only — services/buyerService.js re-validates everything and is the
 * authority. What these tests protect is the property that makes the client
 * check worth having: it must never DISAGREE with the server on the same input.
 * A field that says "looks fine" followed by a server 400 saying otherwise is
 * worse than no client check at all, because the buyer has no idea what to fix.
 *
 * Fixtures are computed via the real check-digit function for the same reason as
 * the backend suite: a hand-typed 15-character string almost certainly has the
 * wrong check digit and would pass for the wrong reason.
 */

import fs from 'fs'
import path from 'path'
import {
  checkGstin, gstinCheckDigit, normalizeGstin, BUYER_TYPES,
  GSTIN_PATTERN, GST_STATE_BY_CODE, statesMatch,
} from './buyerTypes'

const REPO = path.join(process.cwd(), '..', '..')
const readBackend = (rel: string) => fs.readFileSync(path.join(REPO, 'Back-end', 'server', rel), 'utf8')

const CANONICAL = '27AAPFU0939F1ZV'
const withCheckDigit = (prefix14: string) => prefix14 + gstinCheckDigit(prefix14)

describe('BUYER_TYPES', () => {
  it('matches the values the backend enum accepts', () => {
    // Drift here means the checkout posts a type the server rejects outright.
    expect(Object.values(BUYER_TYPES)).toEqual(['individual', 'enterprise'])
  })
})

describe('gstinCheckDigit', () => {
  it('reproduces the canonical published GSTIN check digit', () => {
    expect(gstinCheckDigit(CANONICAL.slice(0, 14))).toBe('V')
  })

  it('returns null for characters outside the alphabet rather than a wrong digit', () => {
    expect(gstinCheckDigit('27AAPFU0939F1-')).toBeNull()
  })
})

describe('normalizeGstin', () => {
  it('upper-cases and strips pasted spacing', () => {
    expect(normalizeGstin(' 27 aapfu-0939 f1zv ')).toBe(CANONICAL)
  })
})

describe('checkGstin', () => {
  it('accepts the canonical GSTIN and names its state', () => {
    expect(checkGstin(CANONICAL)).toEqual({ valid: true, state: 'Maharashtra', stateCode: '27' })
  })

  it('stays quiet on an empty field instead of shouting at an untouched form', () => {
    const result = checkGstin('')
    expect(result.valid).toBe(false)
    expect(result.message).toBeUndefined()
  })

  it('reports a length problem while the buyer is still typing', () => {
    expect(checkGstin('27AAPFU').message).toMatch(/15 characters/)
  })

  it('reports a check-digit failure as the typo it is', () => {
    const typo = `${CANONICAL.slice(0, 14)}${CANONICAL[14] === 'A' ? 'B' : 'A'}`
    expect(checkGstin(typo).message).toMatch(/typo/i)
  })

  it('rejects an unissued state code even with a valid check digit', () => {
    expect(checkGstin(withCheckDigit('00AAPFU0939F1Z')).message).toMatch(/not a GST state code/)
  })

  it('accepts legacy state codes still live on real registrations', () => {
    // 28 (undivided AP) and 25 (pre-merger Daman & Diu) are no longer issued but
    // existing registrations remain valid — rejecting one blocks a real customer.
    expect(checkGstin(withCheckDigit('28AAPFU0939F1Z')).valid).toBe(true)
    expect(checkGstin(withCheckDigit('25AAPFU0939F1Z')).valid).toBe(true)
  })

  it('accepts a lower-case paste, because the field normalizes first', () => {
    expect(checkGstin(CANONICAL.toLowerCase()).valid).toBe(true)
  })
})

describe('parity with the server, which is the authority', () => {
  // These are duplicated implementations (a per-keystroke round-trip to compute
  // a fixed checksum would be absurd), so the risk is DRIFT: a client that
  // accepts what the server rejects strands the buyer on a 400 with a field
  // that looks fine, and one that rejects what the server accepts blocks a
  // legitimate sale outright.

  it('uses the same GSTIN pattern as utils/gstin.js', () => {
    const backend = readBackend('utils/gstin.js')
    const match = backend.match(/GSTIN_PATTERN = (\/.*\/);/)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(GSTIN_PATTERN.toString())
  })

  it('knows exactly the state codes config/gstStates.js knows', () => {
    const backend = readBackend('config/gstStates.js')
    const codes = [...backend.matchAll(/^\s*'(\d{2})':/gm)].map((m) => m[1])
    expect(codes.length).toBeGreaterThan(0)
    expect(Object.keys(GST_STATE_BY_CODE).sort()).toEqual(codes.sort())
  })

  it('maps every code to the same state name', () => {
    const backend = readBackend('config/gstStates.js')
    const pairs = [...backend.matchAll(/^\s*'(\d{2})':\s*'([^']+)'/gm)]
    const mismatches = pairs
      .filter(([, code, state]) => GST_STATE_BY_CODE[code] !== state)
      .map(([, code, state]) => `${code}: server "${state}" vs client "${GST_STATE_BY_CODE[code]}"`)
    expect(mismatches).toEqual([])
  })

  it('uses the same state-alias table as config/gstStates.js', () => {
    // Drift here means the client asks for a billing address the server would
    // have accepted, or stays quiet where the server prints a delivery block.
    const backend = readBackend('config/gstStates.js')
    const pairs = [...backend.matchAll(/(\w+): '([^']+)',/g)]
      .filter(([, k]) => k.length <= 9 && /^[a-z]+$/.test(k))
    expect(pairs.length).toBeGreaterThan(30)
    const mismatches = pairs
      .filter(([, alias, state]) => !statesMatch(alias, state))
      .map(([, alias, state]) => `${alias} -> ${state}`)
    expect(mismatches).toEqual([])
  })

  it('agrees with the buyer-type enum in config/buyer.js', () => {
    const backend = readBackend('config/buyer.js')
    for (const value of Object.values(BUYER_TYPES)) {
      expect(backend).toContain(`'${value}'`)
    }
  })
})
