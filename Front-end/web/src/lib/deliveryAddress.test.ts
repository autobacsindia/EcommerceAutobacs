import cases from '../../../../shared/delivery-address-cases.json';
import { deliveryAddressProblems, isAddressComplete, streetLines, savedAddressStreet, ADDRESS_MESSAGES } from './deliveryAddress';

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

describe('savedAddressStreet — old saved addresses at checkout', () => {
  it('an old two-line address: line 1 is the house, line 2 the street — and it passes the rule', () => {
    const old = { addressLine1: 'C64, 9th Floor', addressLine2: 'Jomer Symphony, Ponnurunni North' };
    expect(savedAddressStreet(old)).toEqual({ houseNumber: 'C64, 9th Floor', addressLine1: 'Jomer Symphony, Ponnurunni North', landmark: '' });
    expect(isAddressComplete(savedAddressStreet(old))).toBe(true);
  });
  it('an old one-line address still has no house no. (customer is asked)', () => {
    const old = { addressLine1: 'MG Road, Edappally' };
    expect(savedAddressStreet(old)).toEqual({ houseNumber: '', addressLine1: 'MG Road, Edappally', landmark: '' });
    expect(isAddressComplete(savedAddressStreet(old))).toBe(false);
  });
  it('a new address keeps its fields; a line 2 is appended, never dropped', () => {
    expect(savedAddressStreet({ houseNumber: 'Flat 4B', addressLine1: 'MG Road, Edappally', landmark: 'Opp. Lulu Mall' }))
      .toEqual({ houseNumber: 'Flat 4B', addressLine1: 'MG Road, Edappally', landmark: 'Opp. Lulu Mall' });
    expect(savedAddressStreet({ houseNumber: 'Flat 4B', addressLine1: 'MG Road', addressLine2: 'Edappally' }).addressLine1)
      .toBe('MG Road, Edappally');
  });
  it('copes with missing / blank input', () => {
    expect(savedAddressStreet(undefined)).toEqual({ houseNumber: '', addressLine1: '', landmark: '' });
    expect(savedAddressStreet({ addressLine1: '  ', addressLine2: '  ' })).toEqual({ houseNumber: '', addressLine1: '', landmark: '' });
  });
});
