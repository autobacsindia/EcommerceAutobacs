/**
 * "My profile" — what a signed-in person may change about themselves, as a pure function.
 *
 * Allow-list, not deny-list: only the keys below are read from the payload, so
 * role, staff (team / head), email, sessionVersion, isVerified, wallet, karma or
 * any key added to the schema later can never be written through this page, even
 * when a client sends them. Email and password have their own verified flows.
 *
 *   Everyone:          name, phone, addresses (kept for checkout's address save)
 *   Staff and admins:  profile.jobTitle, profile.dateOfBirth, profile.emergencyContact, profile.bio
 *
 * A customer sending staff fields has them dropped, not rejected — the same
 * treatment as any other unknown key.
 *
 * Returns a Mongo `$set` / `$unset` pair. Absent keys are left alone, so a form
 * that sends only `name` cannot clear the phone.
 */
import { AddressBookError, normaliseAddressBook, normalisePhone } from './addressBook.js';

export const LIMITS = Object.freeze({ name: 80, jobTitle: 60, contactName: 60, bio: 200 });
const OLDEST_BIRTH_YEAR = 1900;

/** Thrown for any input the profile will not accept. Carries a 400. */
export class ProfileUpdateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileUpdateError';
    this.statusCode = 400;
    this.isOperational = true;
  }
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function text(value, label, max, { required = false } = {}) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') throw new ProfileUpdateError(`${label} must be text.`);
  const clean = value.replace(/\s+/g, ' ').trim();
  if (required && !clean) throw new ProfileUpdateError(`${label} is required.`);
  if (clean.length > max) throw new ProfileUpdateError(`${label} can be at most ${max} characters.`);
  return clean;
}

/** '' / null clears; otherwise an Indian mobile, stored as 10 digits. */
function phone(value, label) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new ProfileUpdateError(`${label} must be text.`);
  const clean = normalisePhone(value);
  if (!clean) throw new ProfileUpdateError(`${label} must be a 10-digit mobile number.`);
  return clean;
}

/** 'YYYY-MM-DD' (a real calendar day, in the past) → Date at UTC midnight; '' / null clears. */
function birthDate(value, now) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ProfileUpdateError('Date of birth must be a date like 1995-08-21.');
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  // Round-trip check: 2026-02-31 parses to 3 March, which is not what was typed.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new ProfileUpdateError('Date of birth is not a real date.');
  }
  if (d.getUTCFullYear() < OLDEST_BIRTH_YEAR || d > now) {
    throw new ProfileUpdateError('Date of birth must be in the past.');
  }
  return d;
}

/**
 * @param {unknown} body       the request body
 * @param {{ role?: string }} user  the signed-in account (decides whether staff fields apply)
 * @param {{ now?: Date }} [opts]
 * @returns {{ set: Record<string, unknown>, unset: Record<string, ''>, phone: string | undefined }}
 * @throws {ProfileUpdateError}
 */
export function normaliseProfileUpdate(body, user, { now = new Date() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProfileUpdateError('Nothing to save.');
  }
  const set = {};
  const unset = {};

  if (has(body, 'name')) set.name = text(body.name, 'Name', LIMITS.name, { required: true });
  if (has(body, 'phone')) {
    const p = phone(body.phone, 'Phone');
    if (p) set.phone = p;
    else unset.phone = '';
  }
  if (has(body, 'addresses')) {
    try {
      set.addresses = normaliseAddressBook(body.addresses);
    } catch (err) {
      if (err instanceof AddressBookError) throw new ProfileUpdateError(err.message);
      throw err;
    }
  }

  const isPanelUser = user?.role === 'staff' || user?.role === 'admin';
  const p = body.profile;
  if (isPanelUser && p && typeof p === 'object' && !Array.isArray(p)) {
    if (has(p, 'jobTitle')) set['profile.jobTitle'] = text(p.jobTitle, 'Job title', LIMITS.jobTitle);
    if (has(p, 'bio')) set['profile.bio'] = text(p.bio, 'Bio', LIMITS.bio);
    if (has(p, 'dateOfBirth')) {
      const d = birthDate(p.dateOfBirth, now);
      if (d) set['profile.dateOfBirth'] = d;
      else unset['profile.dateOfBirth'] = '';
    }
    if (has(p, 'emergencyContact')) {
      const ec = p.emergencyContact;
      if (ec !== null && ec !== undefined && (typeof ec !== 'object' || Array.isArray(ec))) {
        throw new ProfileUpdateError('Emergency contact is not valid.');
      }
      const ecName = text(ec?.name, 'Emergency contact name', LIMITS.contactName);
      const ecPhone = phone(ec?.phone, 'Emergency contact phone');
      if (!ecName && !ecPhone) unset['profile.emergencyContact'] = '';
      else if (!ecName || !ecPhone) throw new ProfileUpdateError('Emergency contact needs both a name and a phone number.');
      else set['profile.emergencyContact'] = { name: ecName, phone: ecPhone };
    }
  }

  if (!Object.keys(set).length && !Object.keys(unset).length) throw new ProfileUpdateError('Nothing to save.');
  return { set, unset, phone: set.phone };
}

/** The other spellings a 10-digit number is stored under (orders and guest checkout look up by exact string). */
export const phoneVariants = (tenDigits) => [tenDigits, `+91${tenDigits}`, `91${tenDigits}`, `0${tenDigits}`, `+91 ${tenDigits}`];
