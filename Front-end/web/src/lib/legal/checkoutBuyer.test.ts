/**
 * The checkout-side enterprise gate.
 *
 * The case that matters most is the LAST one: an individual buyer must never be
 * blocked by enterprise rules, because the overwhelming majority of orders are
 * individual and a gate that misfires there stops the whole storefront selling.
 */

import { enterpriseBlockError, type EnterpriseBlockInput } from './checkoutBuyer'

const shipping = { line1: '1 Test St', city: 'Kochi', postalCode: '682011' }
const billing = { line1: '12 Marine Drive', city: 'Kochi', postalCode: '682011' }

const input = (overrides: Partial<EnterpriseBlockInput> = {}): EnterpriseBlockInput => ({
  isEnterprise: true,
  legalName: 'Roavion Motors Private Limited',
  gstin: '27AAPFU0939F1ZV',
  billingSameAsShipping: false,
  billing,
  shipping,
  ...overrides,
})

describe('enterpriseBlockError', () => {
  it('passes a complete enterprise block', () => {
    expect(enterpriseBlockError(input())).toBeNull()
  })

  it('never blocks an individual buyer, whatever else is empty', () => {
    // The high-traffic path. A gate that misfires here stops every consumer sale.
    expect(enterpriseBlockError({
      ...input(), isEnterprise: false, legalName: '', gstin: '',
      billing: { line1: '', city: '', postalCode: '' },
    })).toBeNull()
  })

  it('asks for the legal name first, before the GSTIN', () => {
    // Ordering is deliberate: complaining about a GSTIN the buyer has not
    // reached yet reads as a broken form.
    expect(enterpriseBlockError(input({ legalName: '   ', gstin: '' })))
      .toMatch(/legal name/)
  })

  it('gives usable copy for an untouched GSTIN field', () => {
    // checkGstin returns no message for empty input — falling through to
    // `null` here would leave the buyer pressing Continue with nothing happening.
    expect(enterpriseBlockError(input({ gstin: '' }))).toBe('Enter a valid GSTIN')
  })

  it('surfaces the check-digit message for a typo', () => {
    expect(enterpriseBlockError(input({ gstin: '27AAPFU0939F1ZW' }))).toMatch(/typo/i)
  })

  it.each([['line1'], ['city'], ['postalCode']] as const)(
    'requires billing %s when billing is entered separately',
    (field) => {
      expect(enterpriseBlockError(input({ billing: { ...billing, [field]: '  ' } })))
        .toMatch(/billing address/i)
    }
  )

  it('validates the SHIPPING address when billing mirrors it', () => {
    // The same-as-shipping path must not silently accept an incomplete address
    // just because the (unused) billing fields happen to be filled.
    expect(enterpriseBlockError(input({
      billingSameAsShipping: true,
      shipping: { ...shipping, city: '' },
    }))).toMatch(/billing address/i)
  })

  it('ignores incomplete billing fields when billing mirrors shipping', () => {
    // The mirror of the above: hidden, unused fields must not block a valid order.
    expect(enterpriseBlockError(input({
      billingSameAsShipping: true,
      billing: { line1: '', city: '', postalCode: '' },
    }))).toBeNull()
  })
})
