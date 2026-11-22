/**
 * Employee profiles (models/hr/EmployeeProfile.js) — the HR record beside a
 * staff login. Access is decided by middleware/hrAuth.js before these run;
 * functions here assume the caller is allowed and only validate the input.
 *
 * Sensitive identifiers are encrypted on write and never returned: callers get
 * `panLast4`, `bank.accountLast4` and `bank.hasUpi`, nothing more.
 */
import mongoose from 'mongoose';
import employeeRepository from '../../repositories/hr/employeeRepository.js';
import userRepository from '../../repositories/userRepository.js';
import counterRepository from '../../repositories/counterRepository.js';
import AppError from '../../utils/AppError.js';
import { encryptField } from '../../utils/fieldEncryption.js';
import {
  EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, TAX_REGIMES, DATE_RE,
} from '../../config/hr.js';
import { STAFF_TEAM_VALUES } from '../../config/staff.js';
import {
  encodeCursor, decodeCursor, afterClause, sortSpec, escapeRegex,
} from '../../utils/listQuery.js';
import { recordHrAudit, diffFields } from './audit.js';
import { getHrSettings } from './settings.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const PAGE_MAX = 50;
const MAX_ONBOARDING_ITEMS = 30;
const LIST_SORT = Object.freeze({ field: 'name', dir: 1, type: 'string' });
const CURRENT = ['onboarding', 'active', 'notice'];

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;
const PHONE_RE = /^\+?\d{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What every caller (HR, admin, the employee themself) sees. No ciphertext, ever. */
export function shapeEmployee(p) {
  if (!p) return null;
  const id = (v) => (v ? String(v) : null);
  return {
    id: String(p._id),
    user: id(p.user),
    employeeCode: p.employeeCode,
    status: p.status,
    name: p.name,
    workEmail: p.workEmail || '',
    personalEmail: p.personalEmail || '',
    phone: p.phone || '',
    designation: p.designation || '',
    team: p.team || '',
    manager: id(p.manager),
    employmentType: p.employmentType,
    joinDate: p.joinDate || null,
    exitDate: p.exitDate || null,
    dob: p.dob || null,
    gender: p.gender || '',
    address: p.address || '',
    emergencyContact: {
      name: p.emergencyContact?.name || '',
      relation: p.emergencyContact?.relation || '',
      phone: p.emergencyContact?.phone || '',
    },
    shift: id(p.shift),
    workSites: (p.workSites || []).map(String),
    anywhereAllowed: !!p.anywhereAllowed,
    manualAttendance: !!p.manualAttendance,
    panLast4: p.panLast4 || '',
    aadhaarLast4: p.aadhaarLast4 || '',
    uan: p.uan || '',
    esicNumber: p.esicNumber || '',
    taxRegime: p.taxRegime,
    bank: {
      holderName: p.bank?.holderName || '',
      accountLast4: p.bank?.accountLast4 || '',
      ifsc: p.bank?.ifsc || '',
      hasUpi: !!p.bank?.hasUpi,
    },
    onboarding: (p.onboarding || []).map((i) => ({ key: i.key, label: i.label, done: !!i.done, doneAt: i.doneAt || null })),
    rev: p.rev || 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const LIST_FIELDS = 'employeeCode status name designation team joinDate user phone';
const shapeListRow = (p) => ({
  id: String(p._id), employeeCode: p.employeeCode, status: p.status, name: p.name,
  designation: p.designation || '', team: p.team || '', joinDate: p.joinDate || null,
  user: p.user ? String(p.user) : null, phone: p.phone || '',
});

/** HR/admin list: keyset by name, bounded, lean + projected. */
export async function listEmployees({ status = 'current', team, q, cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 25, 1), PAGE_MAX);
  const filter = {};
  if (status === 'current') filter.status = { $in: CURRENT };
  else if (status === 'all') { /* no status filter */ } else if (EMPLOYEE_STATUSES.includes(status)) filter.status = status;
  else throw fail('Unknown status filter', 400);
  if (team) {
    if (!STAFF_TEAM_VALUES.includes(team)) throw fail('Unknown team', 400);
    filter.team = team;
  }
  const words = String(q || '').trim().slice(0, 60);
  if (words) filter.$or = [{ name: new RegExp(escapeRegex(words), 'i') }, { employeeCode: new RegExp(`^${escapeRegex(words)}`, 'i') }];
  const after = cursor ? decodeCursor('name', LIST_SORT, cursor) : null;
  const ac = afterClause(LIST_SORT, after);
  const query = ac ? { $and: [filter, ac] } : filter;

  const rows = await employeeRepository.list(query, { select: LIST_FIELDS, sort: sortSpec(LIST_SORT), limit: lim + 1 });
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  return {
    items: page.map(shapeListRow),
    nextCursor: hasMore ? encodeCursor('name', LIST_SORT, page[page.length - 1]) : null,
  };
}

const str = (v, max) => (v === undefined ? undefined : String(v ?? '').trim().slice(0, max));
const optDate = (v, label) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!DATE_RE.test(String(v))) throw fail(`${label} must be a date like 2026-12-01`, 400);
  return String(v);
};
const objId = (v, label) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!mongoose.isValidObjectId(v)) throw fail(`${label} is not valid`, 400);
  return new mongoose.Types.ObjectId(String(v));
};

/**
 * Turn client input into a `$set` for the profile. Unknown keys are ignored;
 * every known key is validated. Sensitive values are encrypted and only their
 * last four characters are stored in clear.
 */
export function buildProfileSet(input = {}) {
  const set = {};
  const put = (k, v) => { if (v !== undefined) set[k] = v; };

  if (input.name !== undefined) {
    const name = str(input.name, 120);
    if (!name) throw fail('Name is required', 400);
    set.name = name;
  }
  for (const k of ['workEmail', 'personalEmail']) {
    const v = str(input[k], 200);
    if (v !== undefined && v !== '' && !EMAIL_RE.test(v)) throw fail(`${k === 'workEmail' ? 'Work' : 'Personal'} email is not valid`, 400);
    put(k, v === undefined ? undefined : v.toLowerCase());
  }
  if (input.phone !== undefined) {
    const v = str(input.phone, 20).replace(/[\s-]/g, '');
    if (v && !PHONE_RE.test(v)) throw fail('Phone number is not valid', 400);
    set.phone = v;
  }
  put('designation', str(input.designation, 120));
  put('address', str(input.address, 500));
  put('joinDate', optDate(input.joinDate, 'Joining date'));
  put('dob', optDate(input.dob, 'Date of birth'));
  put('manager', objId(input.manager, 'Manager'));
  put('shift', objId(input.shift, 'Shift'));
  if (input.workSites !== undefined) {
    if (!Array.isArray(input.workSites) || input.workSites.length > 20) throw fail('Work sites must be a list (at most 20)', 400);
    set.workSites = input.workSites.map((s) => objId(s, 'Work site'));
  }
  if (input.anywhereAllowed !== undefined) set.anywhereAllowed = input.anywhereAllowed === true;
  if (input.manualAttendance !== undefined) set.manualAttendance = input.manualAttendance === true;
  if (input.employmentType !== undefined) {
    if (!EMPLOYMENT_TYPES.includes(input.employmentType)) throw fail('Unknown employment type', 400);
    set.employmentType = input.employmentType;
  }
  if (input.gender !== undefined) {
    if (!['male', 'female', 'other', ''].includes(input.gender)) throw fail('Unknown gender value', 400);
    set.gender = input.gender;
  }
  if (input.taxRegime !== undefined) {
    if (!TAX_REGIMES.includes(input.taxRegime)) throw fail('Tax regime must be new or old', 400);
    set.taxRegime = input.taxRegime;
  }
  if (input.status !== undefined) {
    // 'notice' and 'exited' are reached only through the exit flow.
    if (!['onboarding', 'active'].includes(input.status)) throw fail('Status can only be set to onboarding or active here', 400);
    set.status = input.status;
  }
  if (input.emergencyContact !== undefined) {
    const e = input.emergencyContact || {};
    set.emergencyContact = { name: str(e.name, 120) || '', relation: str(e.relation, 40) || '', phone: (str(e.phone, 20) || '').replace(/[\s-]/g, '') };
  }
  if (input.uan !== undefined) {
    const v = str(input.uan, 12).replace(/\s/g, '');
    if (v && !/^\d{12}$/.test(v)) throw fail('UAN must be 12 digits', 400);
    set.uan = v;
  }
  if (input.esicNumber !== undefined) {
    const v = str(input.esicNumber, 17).replace(/\s/g, '');
    if (v && !/^\d{10,17}$/.test(v)) throw fail('ESIC number must be 10–17 digits', 400);
    set.esicNumber = v;
  }
  if (input.aadhaar !== undefined) {
    // Only the last four digits are ever stored.
    const v = String(input.aadhaar ?? '').replace(/\s/g, '');
    if (v && !/^(\d{4}|\d{12})$/.test(v)) throw fail('Aadhaar must be 12 digits', 400);
    set.aadhaarLast4 = v.slice(-4);
  }
  if (input.pan !== undefined) {
    const v = String(input.pan ?? '').trim().toUpperCase();
    if (v && !PAN_RE.test(v)) throw fail('PAN must look like ABCDE1234F', 400);
    set.panEnc = v ? encryptField(v) : '';
    set.panLast4 = v.slice(-4);
  }
  if (input.bank !== undefined) {
    const b = input.bank || {};
    if (b.holderName !== undefined) set['bank.holderName'] = str(b.holderName, 120);
    if (b.ifsc !== undefined) {
      const v = String(b.ifsc ?? '').trim().toUpperCase();
      if (v && !IFSC_RE.test(v)) throw fail('IFSC must look like HDFC0001234', 400);
      set['bank.ifsc'] = v;
    }
    if (b.accountNumber !== undefined) {
      const v = String(b.accountNumber ?? '').replace(/\s/g, '');
      if (v && !/^\d{9,18}$/.test(v)) throw fail('Bank account number must be 9–18 digits', 400);
      set['bank.accountEnc'] = v ? encryptField(v) : '';
      set['bank.accountLast4'] = v.slice(-4);
    }
    if (b.upi !== undefined) {
      const v = String(b.upi ?? '').trim();
      if (v && !UPI_RE.test(v)) throw fail('UPI id must look like name@bank', 400);
      set['bank.upiEnc'] = v ? encryptField(v) : '';
      set['bank.hasUpi'] = !!v;
    }
  }
  return set;
}

/** Audit-friendly view of a $set: sensitive values replaced by their field name only. */
const auditView = (set) => {
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (k === 'panEnc') out.pan = v ? 'set' : '';
    else if (k === 'bank.accountEnc') out.bankAccount = v ? 'set' : '';
    else if (k === 'bank.upiEnc') out.upi = v ? 'set' : '';
    else out[k] = v;
  }
  return out;
};

async function nextEmployeeCode() {
  const n = await counterRepository.next('employee_code');
  return `EMP-${String(n).padStart(4, '0')}`;
}

/** HR/admin: a new employee. `user` (optional) links an existing staff login. */
export async function createEmployee(actor, input = {}, req = null) {
  const set = buildProfileSet(input);
  if (!set.name) throw fail('Name is required', 400);
  if (set.status === undefined) set.status = 'onboarding';

  let team = '';
  let userId = null;
  if (input.user) {
    if (!mongoose.isValidObjectId(input.user)) throw fail('Login is not valid', 400);
    const u = await userRepository.findStaffPrincipal(input.user);
    if (!u || !(u.role === 'admin' || (u.role === 'staff' && u.staff?.active))) {
      throw fail('That login is not an active staff account', 400);
    }
    userId = u._id;
    team = u.staff?.team || '';
  }

  const settings = await getHrSettings();
  const onboarding = settings.onboardingItems.slice(0, MAX_ONBOARDING_ITEMS)
    .map((i) => ({ key: i.key, label: i.label, done: false }));

  // `bank.x` dotted keys from buildProfileSet → nested object for create().
  const doc = { onboarding, team, user: userId, createdBy: actor._id, employeeCode: await nextEmployeeCode() };
  for (const [k, v] of Object.entries(set)) {
    if (k.startsWith('bank.')) (doc.bank ||= {})[k.slice(5)] = v;
    else doc[k] = v;
  }

  let created;
  try {
    created = await employeeRepository.create(doc);
  } catch (err) {
    if (err?.code === 11000 && err.keyPattern?.user) throw fail('This login already has an HR profile', 409);
    throw err;
  }
  await recordHrAudit({
    action: 'employee.created', entity: 'EmployeeProfile', entityId: created._id, subject: created._id, actor, req,
    changes: diffFields({}, auditView({ name: created.name, status: created.status, ...set })),
  });
  return shapeEmployee(created.toObject());
}

/** HR/admin: partial update with CAS on `rev`. Every change is audit-logged. */
export async function updateEmployee(actor, employeeId, input = {}, { rev, reason = '', req = null } = {}) {
  if (rev === undefined || rev === null || !Number.isInteger(Number(rev))) throw fail('rev is required', 400);
  const set = buildProfileSet(input);
  if (!Object.keys(set).length) throw fail('Nothing to change', 400);

  const before = await employeeRepository.findById(employeeId);
  if (!before) throw fail('Employee not found', 404);
  if (before.status === 'exited') throw fail('This employee has left; their record is read-only', 409);

  const updated = await employeeRepository.updateIfRev(employeeId, Number(rev), set, actor._id);
  if (!updated) throw fail('This profile was changed by someone else since you opened it. Reload and try again.', 409);

  // Encrypted fields aren't selected; their presence is known from the clear last-4 / flag.
  const flatBefore = {
    ...before,
    panEnc: before.panLast4 ? 'set' : '',
    'bank.holderName': before.bank?.holderName,
    'bank.ifsc': before.bank?.ifsc,
    'bank.accountEnc': before.bank?.accountLast4 ? 'set' : '',
    'bank.accountLast4': before.bank?.accountLast4,
    'bank.upiEnc': before.bank?.hasUpi ? 'set' : '',
    'bank.hasUpi': !!before.bank?.hasUpi,
  };
  await recordHrAudit({
    action: 'employee.updated', entity: 'EmployeeProfile', entityId: updated._id, subject: updated._id, actor, reason, req,
    changes: diffFields(auditView(flatBefore), auditView(set)),
  });
  return shapeEmployee(updated);
}

/** HR/admin: tick or untick one onboarding checklist item. */
export async function setOnboardingItem(actor, employeeId, key, done, req = null) {
  const updated = await employeeRepository.setOnboardingItem(employeeId, String(key), !!done, actor._id, new Date());
  if (!updated) throw fail('Checklist item not found', 404);
  await recordHrAudit({
    action: done ? 'onboarding.done' : 'onboarding.undone', entity: 'EmployeeProfile', entityId: updated._id,
    subject: updated._id, actor, req, changes: [{ field: `onboarding.${key}`, from: !done, to: !!done }],
  });
  return shapeEmployee(updated);
}
