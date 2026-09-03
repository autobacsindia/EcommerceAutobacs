/**
 * Frontend half of the legal-version drift guard.
 *
 * The backend stamps `Order.legalAcceptance.termsVersion` from its OWN copy of
 * these versions. The checkout screen tells the buyer which version they are
 * accepting from THIS copy. If the two disagree, the screen makes a written
 * misstatement about the contract being formed — on the one page where an
 * Enterprise buyer agrees to arbitration seated in Ernakulam.
 *
 * The mirrored guard lives at
 * Back-end/server/tests/unit/config/legalDocuments.test.js. Both are needed:
 * ci-frontend.yml triggers only on `Front-end/web/**` and ci.yml only on
 * `Back-end/server/**`, so a guard on one side alone never runs when the other
 * side is what changed.
 */

import fs from 'fs'
import path from 'path'
import { LEGAL_DOCUMENTS, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from './legalVersions'

const REPO = path.join(process.cwd(), '..', '..')
const BACKEND_CONFIG = path.join(REPO, 'Back-end', 'server', 'config', 'legalDocuments.js')

/** Pull `version: '…'` out of a named entry in the backend config. */
function backendVersion(key: string): string {
  const src = fs.readFileSync(BACKEND_CONFIG, 'utf8')
  const entry = new RegExp(`${key}:\\s*Object\\.freeze\\(\\{[\\s\\S]*?version:\\s*'([^']+)'`)
  const match = src.match(entry)
  if (!match) throw new Error(`no version found for "${key}" in ${BACKEND_CONFIG}`)
  return match[1]
}

describe('legal document versions', () => {
  it('match the backend, which is the source of truth', () => {
    expect(CURRENT_TERMS_VERSION).toBe(backendVersion('terms'))
    expect(CURRENT_PRIVACY_VERSION).toBe(backendVersion('privacy'))
  })

  it('are ISO dates, so they sort and cannot be ambiguous', () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      expect(doc.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(doc.version))).toBe(false)
    }
  })

  it('every version has a committed snapshot of the text it refers to', () => {
    // A version string with no archived document is a promise we cannot keep:
    // the whole point of recording a version on an order is being able to
    // produce the text that version names.
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      const snapshot = path.join(REPO, 'docs', 'legal', `${doc.key}-${doc.version}.md`)
      expect({ doc: doc.key, exists: fs.existsSync(snapshot) })
        .toEqual({ doc: doc.key, exists: true })
    }
  })

  it('the terms snapshot contains both governing-law tracks', () => {
    // 17A must survive every future edit: it is what preserves the consumer's
    // statutory route to the CDRC. 17B is the arbitration clause it is carved
    // out from. A snapshot missing either is not the document we think it is.
    const snapshot = fs.readFileSync(
      path.join(REPO, 'docs', 'legal', `terms-${CURRENT_TERMS_VERSION}.md`), 'utf8'
    )
    expect(snapshot).toContain('Consumer Disputes Redressal Commission')
    expect(snapshot).toContain('We do not require a consumer to submit a dispute to arbitration')
    expect(snapshot).toContain('Arbitration and Conciliation Act, 1996')
    expect(snapshot).toContain('Ernakulam, Kerala')
    // The enterprise track must stay explicitly scoped to enterprise buyers.
    expect(snapshot).toContain('Section 17B, including the arbitration provision, applies only to Enterprise Transactions')
  })
})
