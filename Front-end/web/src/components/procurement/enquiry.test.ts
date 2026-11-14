import { enquiryMessage, unitLabel, waNumber, whatsappLink, type Enquiry } from './enquiry';

const E: Pick<Enquiry, 'ref' | 'createdAt' | 'neededBy' | 'deliverTo' | 'notes' | 'showTargetPrice' | 'contactName' | 'items'> = {
  ref: 'ENQ-2611-0007',
  createdAt: '2026-11-13T06:00:00.000Z',
  neededBy: '2026-11-19T18:30:00.000Z', // 20 Nov in India
  deliverTo: 'Kochi, Kerala',
  notes: 'Quote GST separately',
  showTargetPrice: false,
  contactName: 'Anil',
  items: [
    { id: 'a', productId: null, name: '3M Car Wax Polish 500 ml', brand: '3M', partNo: '39030', fitment: 'Hyundai Creta 2020+', qty: 10, unit: 'pcs', targetPaise: 45000, note: '' },
    { id: 'b', productId: null, name: 'Rear parking sensor kit', brand: '', partNo: '', fitment: '', qty: 1, unit: 'sets', targetPaise: null, note: 'black finish preferred' },
  ],
};

describe('the WhatsApp enquiry message', () => {
  it('reads like the agreed mock: REQUIREMENT / REMARKS / PLEASE QUOTE', () => {
    const m = enquiryMessage(E, 'Ravi Motors');
    expect(m.startsWith('*AUTOBACS INDIA*\n_Price & availability enquiry_\n')).toBe(true);
    expect(m).toContain('Ref: *ENQ-2611-0007*');
    expect(m).toContain('Date: 13 Nov 2026');
    expect(m).toContain('Dear Ravi Motors,');
    expect(m).toContain('*REQUIREMENT*\n*1. 3M Car Wax Polish 500 ml*\n   Brand: 3M · Part no: 39030\n   Fits: Hyundai Creta 2020+\n   Qty: *10 pcs*');
    expect(m).toContain('*2. Rear parking sensor kit*\n   Qty: *1 set*\n   Specs: black finish preferred');
    expect(m).toContain('Needed by: *20 Nov 2026*\nDeliver to: Kochi, Kerala');
    expect(m).toContain('*REMARKS*\nQuote GST separately');
    expect(m).toContain('*PLEASE QUOTE* (for each item)\n• Unit price (₹)\n• GST % — included or extra\n• Stock availability\n• Delivery / dispatch time');
    // Sections in order.
    expect(m.indexOf('*REQUIREMENT*')).toBeLessThan(m.indexOf('*REMARKS*'));
    expect(m.indexOf('*REMARKS*')).toBeLessThan(m.indexOf('*PLEASE QUOTE*'));
    expect(m).toContain('Anil · Procurement, Autobacs India');
    expect(m).toContain('🌐 autobacsindia.com');
  });

  it('photos: a catalogue photo is a link; uploaded photos are mentioned; nothing when none', () => {
    const m = enquiryMessage({ ...E, items: [
      { ...E.items[0], image: 'https://res.cloudinary.com/x/wax.jpg', photos: [{ id: 'p1', name: 'a.jpg', contentType: 'image/jpeg' }, { id: 'p2', name: 'b.jpg', contentType: 'image/jpeg' }] },
      { ...E.items[1], image: '/relative/only.jpg', photos: [{ id: 'p3', name: 'c.jpg', contentType: 'image/jpeg' }] },
    ] });
    expect(m).toContain('   Qty: *10 pcs*\n   Photo: https://res.cloudinary.com/x/wax.jpg\n   📷 2 photos sent with this message');
    expect(m).toContain('📷 1 photo sent with this message');
    expect(m).not.toContain('/relative/only.jpg');
    expect(enquiryMessage(E)).not.toMatch(/Photo|📷/);
  });

  it('keeps our target price private unless asked', () => {
    expect(enquiryMessage(E)).not.toContain('Target');
    expect(enquiryMessage({ ...E, showTargetPrice: true })).toContain('Target price: ₹450 + GST per pc');
  });

  it('no supplier name → a polite generic greeting; no optional lines when empty', () => {
    const m = enquiryMessage({ ...E, neededBy: null, deliverTo: '', notes: '', contactName: '' });
    expect(m).toContain('Dear Sir/Madam,');
    expect(m).not.toContain('Needed by');
    expect(m).not.toContain('Deliver to');
    expect(m).not.toContain('REMARKS');
    expect(m).toContain('Procurement, Autobacs India');
  });

  it('typed * _ ~ cannot turn the rest of the message bold or struck through', () => {
    const m = enquiryMessage({ ...E, items: [{ ...E.items[0], name: 'Wax *large* _x_ ~y~' }] }, 'A*B');
    expect(m).toContain('*1. Wax ∗large∗ ‗x‗ ∼y∼*');
    expect(m).toContain('Dear A∗B,');
  });

  it('units: singular for one', () => {
    expect(unitLabel(1, 'boxes')).toBe('box');
    expect(unitLabel(2, 'boxes')).toBe('boxes');
    expect(unitLabel(1, 'kg')).toBe('kg');
    expect(unitLabel(1, 'litres')).toBe('litre');
  });
});

describe('wa.me numbers and links', () => {
  it('normalises how numbers are typed', () => {
    expect(waNumber('98000 00001')).toBe('919800000001');
    expect(waNumber('098000-00001')).toBe('919800000001');
    expect(waNumber('+91 98000 00001')).toBe('919800000001');
    expect(waNumber('+66 81 000 0000')).toBe('66810000000');
    expect(waNumber('12345')).toBe('');
    expect(waNumber('')).toBe('');
  });

  it('links carry the message encoded; no number, no link', () => {
    const l = whatsappLink('9800000001', 'Hi & bye\n*x*');
    expect(l).toBe('https://wa.me/919800000001?text=Hi%20%26%20bye%0A*x*');
    expect(whatsappLink('', 'Hi')).toBe('');
  });
});
