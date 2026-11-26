import cases from '../../../../shared/delivery-address-cases.json';
import { deliveryAddressProblems, isAddressComplete, streetLines, ADDRESS_MESSAGES } from './deliveryAddress';

describe('delivery-address rule (website copy) — shared case table', () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const p = deliveryAddressProblems(c.address);
    if (c.ok) expect(p).toEqual({});
    else expect(Object.keys(p)).toContain(c.field);
  });

  it('old saved address (no house no.) is incomplete but still renders', () => {
    const old = { addressLine1: '12 MG Road' };
    expect(isAddressComplete(old)).toBe(false);
    expect(streetLines(old)).toEqual(['12 MG Road']);
  });

  it('house first, landmark labelled', () => {
    expect(streetLines({ houseNumber: 'Flat 4B', addressLine1: 'MG Road, Edappally', landmark: 'Opp. Lulu Mall' }))
      .toEqual(['Flat 4B', 'MG Road, Edappally', 'Landmark: Opp. Lulu Mall']);
  });

  it('messages match the server word for word', () => {
    expect(ADDRESS_MESSAGES.houseRequired).toBe('Enter your house / flat / building number, e.g. "Flat 4B, Jomer Symphony".');
  });
});
