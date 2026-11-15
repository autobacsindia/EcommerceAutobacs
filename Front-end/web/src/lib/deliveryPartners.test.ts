import { appendPartner, partnerFromParcel, partnerProblem, safeHttpUrl, type DeliveryPartnerOption } from './deliveryPartners';

jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn() } }));

const OPTIONS: DeliveryPartnerOption[] = [
  { code: 'VRL', name: 'VRL', deliveryPartner: true },
  { code: 'DELHIVERY', name: 'Delhivery', deliveryPartner: true },
  { code: 'OTHER', name: 'Other courier', custom: true, deliveryPartner: true },
];

describe('safeHttpUrl', () => {
  it('keeps http and https', () => {
    expect(safeHttpUrl(' https://a.in/t ')).toBe('https://a.in/t');
    expect(safeHttpUrl('http://a.in')).toBe('http://a.in/');
  });
  it.each(['', null, undefined, 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:x', 'ftp://a.in', '//a.in', 'a.in/t', 'https://u:p@a.in'])(
    'drops %p', (v) => { expect(safeHttpUrl(v as string)).toBeNull(); },
  );
});

describe('partnerProblem', () => {
  it('a listed partner is fine; none is fine unless required', () => {
    expect(partnerProblem({ code: 'VRL', name: '', url: '' })).toBe('');
    expect(partnerProblem({ code: '', name: '', url: '' })).toBe('');
    expect(partnerProblem({ code: '', name: '', url: '' }, { required: true })).toMatch(/Choose the delivery partner/);
  });
  it('Other needs a name, and only an http(s) page', () => {
    expect(partnerProblem({ code: 'OTHER', name: ' ', url: '' })).toMatch(/name/);
    expect(partnerProblem({ code: 'OTHER', name: 'Ram', url: '' })).toBe('');
    expect(partnerProblem({ code: 'OTHER', name: 'Ram', url: 'https://ram.in' })).toBe('');
    expect(partnerProblem({ code: 'OTHER', name: 'Ram', url: 'javascript:alert(1)' })).toMatch(/http:\/\/ or https:\/\//);
  });
});

describe('appendPartner', () => {
  const fields = (fd: FormData) => Object.fromEntries(Array.from(fd.entries()));
  it('a listed partner sends its code and its own name, no page', () => {
    const fd = new FormData();
    appendPartner(fd, { code: 'DELHIVERY', name: 'stale', url: 'https://x.in' }, OPTIONS);
    expect(fields(fd)).toEqual({ courierCode: 'DELHIVERY', courierName: 'Delhivery' });
  });
  it('Other sends the typed name and page', () => {
    const fd = new FormData();
    appendPartner(fd, { code: 'OTHER', name: ' Ram ', url: ' https://ram.in/t ' }, OPTIONS);
    expect(fields(fd)).toEqual({ courierCode: 'OTHER', courierName: 'Ram', courierUrl: 'https://ram.in/t' });
  });
  it('nothing chosen sends nothing', () => {
    const fd = new FormData();
    appendPartner(fd, { code: '', name: '', url: '' }, OPTIONS);
    expect(fields(fd)).toEqual({});
  });
});

describe('partnerFromParcel — starting the edit form', () => {
  it('by code', () => {
    expect(partnerFromParcel({ courier: 'VRL', courierCode: 'VRL' }, OPTIONS)).toEqual({ code: 'VRL', name: 'VRL', url: '' });
  });
  it('a courier typed before the dropdown: by matching name, else as Other', () => {
    expect(partnerFromParcel({ courier: 'delhivery', courierCode: '' }, OPTIONS)).toEqual({ code: 'DELHIVERY', name: 'Delhivery', url: '' });
    expect(partnerFromParcel({ courier: 'Ram Transport', courierCode: '' }, OPTIONS)).toEqual({ code: 'OTHER', name: 'Ram Transport', url: '' });
  });
  it('a saved Other keeps its page', () => {
    expect(partnerFromParcel({ courier: 'Ram', courierCode: 'OTHER', courierUrl: 'https://ram.in' }, OPTIONS))
      .toEqual({ code: 'OTHER', name: 'Ram', url: 'https://ram.in' });
  });
  it('no courier at all → nothing chosen', () => {
    expect(partnerFromParcel({ courier: '' }, OPTIONS)).toEqual({ code: '', name: '', url: '' });
  });
});
