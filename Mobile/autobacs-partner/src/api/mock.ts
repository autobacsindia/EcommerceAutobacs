/**
 * DEV-ONLY in-memory stand-in for the supplier API, so screens can be built
 * and reviewed before /api/v1/partner exists. Enabled by EXPO_PUBLIC_PARTNER_MOCK=1
 * in a development build only (see ./index.ts) — a release build can never use it.
 *
 * Mirrors the real contract (partner-supplier-api.md): sign-up returns a token
 * with status email_unverified; verify/resend are signed-in calls; reset signs
 * in. Email code is always 123456. Statuses move only by the same actions the real
 * API allows; `mockAdmin` stands in for procurement so every screen state can
 * be reached.
 */
import { ApiError, loadToken } from './client';
import type { AccountStatus, Listing, PartnerApi, SupplierAccount } from './types';

const CODE = '123456';
const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let seq = 100;
const nextId = () => `mock${(seq++).toString(36)}`;

type Row = SupplierAccount & { password: string };

const accounts = new Map<string, Row>();
const listings = new Map<string, Listing>();
let current: string | null = null; // email of the signed-in account

function seed() {
  const email = 'demo@partner.test';
  accounts.set(email, {
    id: 'acct-demo', email, emailVerified: true, password: 'demo1234',
    companyName: 'Kerala Auto Parts', contactName: 'Anu Joseph', phone: '9876543210', city: 'Kochi',
    address: '12 MG Road, Ernakulam, Kochi 682011', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F',
    hasGstCertificate: true, hasCancelledCheque: true,
    bank: { accountName: 'Kerala Auto Parts', accountLast4: '9012', ifsc: 'HDFC0001234', upiId: '' },
    status: 'approved', reviewNote: '', submittedAt: now(),
  });
  const base: Omit<Listing, 'id' | 'status' | 'title' | 'fits' | 'costPaise' | 'gstPct' | 'availability'> = { brand: '', partNumber: '', description: '', categoryHint: '', specs: [], images: [], availabilityAt: now(), dispatchDays: 2, reviewNote: '', submittedAt: null, liveAt: null, updatedAt: now(), rev: 1 };
  const demo: Listing[] = [
    { ...base, id: nextId(), status: 'live', title: 'LED headlamp bulb H4, 6000K (pair)', brand: 'Osram', partNumber: 'H4-LED-6K', fits: 'Swift 2018+, Baleno, Dzire', categoryHint: 'Lighting', costPaise: 180000, gstPct: 18, availability: 'in', liveAt: now(), specs: [{ label: 'Colour', value: '6000K white' }] },
    { ...base, id: nextId(), status: 'submitted', title: '3D floor mats, black', brand: 'Autofurnish', fits: 'Creta 2020+', categoryHint: 'Interior', costPaise: 245050, gstPct: 28, availability: 'low', submittedAt: now() },
    { ...base, id: nextId(), status: 'changes_requested', title: 'Ceramic brake pads, front', brand: 'Brembo', partNumber: 'P 30 056', fits: 'City 2017–2022', categoryHint: 'Brakes', costPaise: 320000, gstPct: 28, availability: 'in', reviewNote: 'Please add a clear photo of the box with the part number.' },
    { ...base, id: nextId(), status: 'draft', title: 'Roof rail cross bars', fits: 'XUV700', costPaise: 520000, gstPct: 18, availability: 'out' },
    { ...base, id: nextId(), status: 'rejected', title: 'Universal seat covers', fits: 'All cars', costPaise: 99900, gstPct: 12, availability: 'in', reviewNote: 'We already stock this exact item from another supplier.' },
  ];
  for (let i = 0; i < 18; i++) {
    demo.push({ ...base, id: nextId(), status: 'live', title: `Wiper blade set ${14 + i}"`, brand: 'Bosch', fits: 'Most hatchbacks', categoryHint: 'Exterior', costPaise: 35000 + i * 1250, gstPct: 18, availability: (['in', 'low', 'out'] as const)[i % 3], liveAt: now() });
  }
  demo.forEach((l, i) => listings.set(l.id, { ...l, updatedAt: new Date(Date.now() - i * 3600_000).toISOString() }));
}
seed();

const view = ({ password: _pw, ...a }: Row): SupplierAccount => ({ ...a });
const fail = (msg: string, status = 400, code?: string): never => {
  throw new ApiError(msg, status, code);
};
/** After an app reload the in-memory session is gone; resume from the stored mock token. */
async function resume() {
  if (current) return;
  const t = await loadToken();
  const a = [...accounts.values()].find((x) => t === `mock-${x.id}`);
  if (a) current = a.email;
}
function me(): Row {
  const a = current ? accounts.get(current) : undefined;
  if (!a) fail('Please sign in again', 401);
  return a!;
}
function own(id: string): Listing {
  const l = listings.get(id);
  if (!l) fail('Product not found', 404);
  return l!;
}
const EDITABLE: Listing['status'][] = ['draft', 'changes_requested', 'live', 'withdrawn', 'rejected'];

export const mockApi: PartnerApi = {
  async signUp(input) {
    await wait();
    const email = input.email.trim().toLowerCase();
    if (accounts.has(email)) fail('An account with this email already exists. Sign in instead.', 409, 'EMAIL_TAKEN');
    accounts.set(email, {
      id: nextId(), email, emailVerified: false, password: input.password, companyName: input.companyName,
      contactName: input.contactName, phone: input.phone, city: '', address: '', gstin: '', pan: '',
      hasGstCertificate: false, hasCancelledCheque: false, bank: { accountName: '', accountLast4: '', ifsc: '', upiId: '' },
      status: 'email_unverified', reviewNote: '', submittedAt: null,
    });
    const a = accounts.get(email)!;
    current = email;
    return { token: `mock-${a.id}`, account: view(a) };
  },
  async verifyEmail(code) {
    await wait();
    await resume();
    const a = me();
    if (code !== CODE) fail('That code is not right. Check the latest email from us.', 400, 'INVALID_CODE');
    a.emailVerified = true;
    if (a.status === 'email_unverified') a.status = 'draft';
    return view(a);
  },
  async resendCode() {
    await wait();
  },
  async signIn(email, password) {
    await wait();
    const a = accounts.get(email.trim().toLowerCase());
    if (!a || a.password !== password) fail('Email or password is wrong', 401, 'INVALID_LOGIN');
    current = a!.email;
    return { token: `mock-${a!.id}`, account: view(a!) };
  },
  async forgotPassword() {
    await wait();
  },
  async resetPassword(email, code, password) {
    await wait();
    const a = accounts.get(email.trim().toLowerCase());
    if (!a || code !== CODE) fail('That code is not right or has expired', 400, 'INVALID_CODE');
    a!.password = password;
    a!.emailVerified = true;
    if (a!.status === 'email_unverified') a!.status = 'draft';
    current = a!.email;
    return { token: `mock-${a!.id}`, account: view(a!) };
  },
  async signOutEverywhere() {
    await wait();
    current = null;
  },

  async me() {
    await wait(150);
    await resume();
    return view(me());
  },
  async updateMe(input) {
    await wait();
    const a = me();
    if (!['draft', 'changes_requested'].includes(a.status)) fail('Your details are with procurement and cannot change right now', 409, 'PROFILE_LOCKED');
    const { bank, ...rest } = input;
    Object.assign(a, rest, {
      bank: { accountName: bank.accountName, ifsc: bank.ifsc, upiId: bank.upiId, accountLast4: bank.accountNumber ? bank.accountNumber.slice(-4) : a.bank.accountLast4 },
    });
    return view(a);
  },
  async uploadDocument(kind) {
    await wait(700);
    const a = me();
    if (kind === 'gstCertificate') a.hasGstCertificate = true;
    else a.hasCancelledCheque = true;
    return view(a);
  },
  async submitForReview() {
    await wait();
    const a = me();
    if (!a.hasGstCertificate || !a.hasCancelledCheque) throw new ApiError('Some details are missing.', 400, 'INCOMPLETE', { missing: ['documents'] });
    a.status = 'in_review';
    a.submittedAt = now();
    a.reviewNote = '';
    return view(a);
  },

  async listListings({ status, cursor, limit = 20 }) {
    await wait();
    await resume();
    me();
    const all = [...listings.values()]
      .filter((l) => !status || l.status === status)
      .sort((x, y) => (y.updatedAt ?? '').localeCompare(x.updatedAt ?? '') || y.id.localeCompare(x.id));
    const start = cursor ? all.findIndex((l) => l.id === cursor) + 1 : 0;
    const items = all.slice(start, start + limit);
    return { items, nextCursor: start + limit < all.length ? items[items.length - 1].id : null };
  },
  async getListing(id) {
    await wait(200);
    return { ...own(id) };
  },
  async createListing(input) {
    await wait();
    if (me().status !== 'approved') fail('Your account cannot do this yet', 403, 'SUPPLIER_STATUS');
    const l: Listing = { ...input, id: nextId(), status: 'draft', rev: 1, images: [], reviewNote: '', submittedAt: null, liveAt: null, availabilityAt: now(), updatedAt: now() };
    listings.set(l.id, l);
    return { ...l };
  },
  async updateListing(id, rev, input) {
    await wait();
    const l = own(id);
    if (l.rev !== rev) throw new ApiError('This product changed on another device. Reload it and try again.', 409, 'STALE', { rev: l.rev });
    if (!EDITABLE.includes(l.status)) fail('This product is with procurement. Withdraw it to make changes.', 409, 'LISTING_LOCKED');
    Object.assign(l, input, { rev: l.rev + 1, updatedAt: now(), status: l.status === 'rejected' ? 'draft' : l.status });
    return { ...l };
  },
  async uploadListingPhoto(id, file) {
    await wait(600);
    const l = own(id);
    if (l.images.length >= 6) fail('Up to 6 photos per product', 400, 'TOO_MANY_PHOTOS');
    l.images = [...l.images, { key: `supplier-portal/listings/mock/${id}/photo-${nextId()}`, url: file.uri }];
    l.rev += 1;
    return { ...l };
  },
  async deleteListingPhoto(id, key) {
    await wait(300);
    const l = own(id);
    l.images = l.images.filter((i) => i.key !== key);
    l.rev += 1;
    return { ...l };
  },
  async submitListing(id) {
    await wait();
    const l = own(id);
    if (!l.images.length) throw new ApiError('Some details are missing.', 400, 'INCOMPLETE', { missing: ['photo'] });
    l.status = 'submitted';
    l.submittedAt = now();
    l.rev += 1;
    return { ...l };
  },
  async withdrawListing(id) {
    await wait();
    const l = own(id);
    l.status = 'withdrawn';
    l.rev += 1;
    return { ...l };
  },
  async setAvailability(id, availability) {
    await wait(800);
    const l = own(id);
    l.availability = availability;
    l.availabilityAt = now();
    return { ...l };
  },
};

/** Stand-in for procurement, used by the dev-only buttons on the status screens. */
export const mockAdmin = {
  setAccountStatus(status: AccountStatus, note = '') {
    const a = me();
    a.status = status;
    a.reviewNote = note;
  },
};
