/**
 * What a project's "Details" box holds, per kind of work, and the slips that can
 * be printed from it (services/staffProjectDetailsService.js,
 * services/projectSlipService.js).
 *
 * A template is a list of fields. Adding a team's form is adding an entry here:
 * the panel draws the editor from this list (GET /staff/tasks/projects/templates)
 * and the server validates against it, so the two never disagree.
 *
 * No field is required to SAVE — a job's details arrive over days (the vehicle
 * comes in Monday, the price is agreed Wednesday). A slip instead lists the
 * fields it needs: a missing one prints as a blank line to fill in by hand, and
 * the panel warns before printing.
 *
 * Field types:
 *   text      one line            textarea  several lines
 *   phone     digits, + - spaces  date      'YYYY-MM-DD'
 *   number    a plain number      money     rupees, 2 decimals, never negative
 */

import { STAFF_LONG_TEXT_MAX } from './staffTextLimits.js';

export const FIELD_TYPES = Object.freeze(['text', 'textarea', 'phone', 'date', 'number', 'money']);

/**
 * Longest value per type, in characters. A one-line field may say otherwise
 * (`max`); a several-lines field always takes the staff safety cap
 * (config/staffTextLimits.js) — job notes are never cut short.
 */
export const FIELD_MAX = Object.freeze({ text: 120, textarea: STAFF_LONG_TEXT_MAX, phone: 20 });

/** Extra "label: value" rows any project may add beyond its template. */
export const CUSTOM_FIELDS_MAX = 20;
export const CUSTOM_LABEL_MAX = 40;
export const CUSTOM_VALUE_MAX = STAFF_LONG_TEXT_MAX;

const f = (key, label, type, group, extra = {}) => Object.freeze({ key, label, type, group, ...extra });

export const PROJECT_TEMPLATES = Object.freeze({
  general: Object.freeze({
    label: 'General',
    hint: 'No set fields — add your own below.',
    groups: Object.freeze({}),
    fields: Object.freeze([]),
  }),
  sales: Object.freeze({
    label: 'Sales job (customer + vehicle)',
    hint: 'A customer’s vehicle job: who, which vehicle, what is being done, and the price.',
    groups: Object.freeze({ customer: 'Customer', vehicle: 'Vehicle', job: 'The job', money: 'Amounts' }),
    fields: Object.freeze([
      f('customerName', 'Customer name', 'text', 'customer', { max: 80 }),
      f('customerPhone', 'Phone', 'phone', 'customer'),
      f('customerAddress', 'Address', 'textarea', 'customer'),
      f('vehicleModel', 'Vehicle model', 'text', 'vehicle', { max: 80, placeholder: 'Toyota Hilux 2024' }),
      f('vehicleReg', 'Registration no.', 'text', 'vehicle', { max: 20, upper: true, placeholder: 'KL 07 AB 1234' }),
      f('vehicleReceivedOn', 'Date vehicle received', 'date', 'vehicle'),
      f('odometerKm', 'Odometer (km)', 'number', 'vehicle'),
      f('workToDo', 'Work being done', 'textarea', 'job'),
      f('conditionNotes', 'Condition when received', 'textarea', 'job', { placeholder: 'Scratch on rear bumper, spare tyre present' }),
      f('deliveryOn', 'Delivery date', 'date', 'job'),
      f('amountQuoted', 'Amount quoted (₹)', 'money', 'money'),
      f('advancePaid', 'Advance paid (₹)', 'money', 'money'),
    ]),
  }),
});

export const TEMPLATE_KEYS = Object.freeze(Object.keys(PROJECT_TEMPLATES));

/**
 * Slips are STORED templates (models/SlipTemplate.js), managed by the admin at
 * Admin → Slip templates, so a new slip needs no code release. These are the
 * defaults written once into an empty collection (services/slipTemplateService.js
 * ensureDefaults) — after that the stored copy is the truth and an admin edit is
 * never overwritten. "Reset to default" copies the entry below back.
 *
 * A template:
 *   key        slug, unique, used in the slip's link
 *   label      the menu name ("Delivery slip"); title: the printed heading
 *   forms      the project forms it is offered on; [] = every project
 *   fields     the slip's OWN boxes, asked when it is made and kept on the
 *              project (a driver's licence number is not a project fact)
 *   blocks     what prints, top to bottom:
 *                section    a titled list of label/value rows (`keys`)
 *                paragraph  text; {{key}} fills a value (blank line if empty)
 *                items      an item list's table with amounts and its total
 *   needs      the keys the panel warns about when empty (they print blank)
 *   declaration, signatures  the closing line and the signature boxes
 *
 * Keys a template may use: its own fields, the fields of its forms, and
 * COMPUTED_KEYS (worked out on the server).
 */
export const SLIP_FIELD_TYPES = Object.freeze([...FIELD_TYPES, 'items']);

/** Worked out when a slip is made — never typed, never sent by the panel. */
export const COMPUTED_KEYS = Object.freeze({
  balance: Object.freeze({ label: 'Balance due (₹)', type: 'money' }),
  today: Object.freeze({ label: 'Date', type: 'date' }),
  projectName: Object.freeze({ label: 'Project', type: 'text' }),
  owner: Object.freeze({ label: 'Project owner', type: 'text' }),
  company: Object.freeze({ label: 'Company', type: 'text' }),
});

/** The built-in slip every project offers: whatever the project holds. Not stored, not editable. */
export const SUMMARY_SLIP = Object.freeze({ key: 'summary', label: 'Project summary', title: 'PROJECT SUMMARY' });

export const SLIP_LIMITS = Object.freeze({
  fields: 30, blocks: 30, keysPerSection: 20, paragraph: 2000, signatures: 4,
  label: 60, title: 40, declaration: 400, signature: 40, sectionTitle: 60,
  items: 50, itemName: 80, templates: 50,
});

const sec = (title, keys) => ({ type: 'section', title, keys });
const para = (text, bold = false) => ({ type: 'paragraph', text, bold });
const own = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

export const DEFAULT_SLIPS = Object.freeze([
  {
    key: 'delivery',
    label: 'Delivery slip',
    title: 'DELIVERY SLIP',
    forms: ['sales'],
    fields: [],
    blocks: [
      sec('Customer', ['customerName', 'customerPhone', 'customerAddress']),
      sec('Vehicle', ['vehicleModel', 'vehicleReg', 'vehicleReceivedOn', 'deliveryOn']),
      sec('Work done', ['workToDo']),
      sec('Amounts', ['amountQuoted', 'advancePaid', 'balance']),
    ],
    needs: ['customerName', 'customerPhone', 'vehicleModel', 'vehicleReg', 'workToDo', 'amountQuoted'],
    declaration: 'I have received my vehicle with the work above completed, in good condition.',
    signatures: ['Delivered by (Autobacs)', 'Received by (customer)'],
  },
  {
    key: 'job_card',
    label: 'Job card',
    title: 'JOB CARD',
    forms: ['sales'],
    fields: [],
    blocks: [
      sec('Customer', ['customerName', 'customerPhone', 'customerAddress']),
      sec('Vehicle', ['vehicleModel', 'vehicleReg', 'vehicleReceivedOn', 'odometerKm']),
      sec('Work to do', ['workToDo', 'deliveryOn']),
      sec('Condition when received', ['conditionNotes']),
      sec('Amounts', ['amountQuoted', 'advancePaid', 'balance']),
    ],
    needs: ['customerName', 'customerPhone', 'vehicleModel', 'vehicleReg', 'vehicleReceivedOn', 'workToDo'],
    declaration: 'I have handed over my vehicle for the work above and agree to the condition noted.',
    signatures: ['Received by (Autobacs)', 'Customer'],
  },
  {
    key: 'vehicle_authorisation',
    label: 'Vehicle / driver authorisation',
    title: 'AUTHORISATION',
    forms: ['sales'],
    fields: [
      own('driverName', 'Driver name', 'text', { max: 80 }),
      own('driverLicence', 'Driving licence no.', 'text', { max: 30, upper: true, placeholder: 'KL07 20190012345' }),
      own('driverPhone', 'Driver phone', 'phone'),
      own('purpose', 'Purpose', 'textarea', { max: 300, placeholder: 'Collect the vehicle from the customer and bring it to our workshop' }),
      own('validFrom', 'Valid from', 'date'),
      own('validTo', 'Valid until', 'date', { notBefore: 'validFrom' }),
    ],
    blocks: [
      para('To whom it may concern'),
      para('This is to certify that {{driverName}} (driving licence {{driverLicence}}, phone {{driverPhone}}), our operations driver, is authorised by {{company}} to drive and take charge of the vehicle below for the purpose stated.'),
      sec('Vehicle', ['vehicleModel', 'vehicleReg', 'customerName']),
      sec('Purpose and validity', ['purpose', 'validFrom', 'validTo']),
      para('Kindly extend your cooperation.'),
    ],
    needs: ['driverName', 'driverLicence', 'purpose', 'validFrom', 'validTo', 'vehicleModel', 'vehicleReg'],
    declaration: '',
    signatures: ['Authorised signatory (Autobacs)', 'Driver'],
  },
  {
    key: 'rto_letter',
    label: 'Letter to RTO',
    title: 'LETTER',
    forms: ['sales'],
    fields: [
      own('rtoOffice', 'RTO office', 'textarea', { max: 200, placeholder: 'Regional Transport Office, Ernakulam' }),
      own('subject', 'Subject', 'text', { max: 160 }),
      own('chassisNo', 'Chassis no.', 'text', { max: 30, upper: true }),
      own('engineNo', 'Engine no.', 'text', { max: 30, upper: true }),
      own('message', 'Message', 'textarea', { max: 2000 }),
    ],
    blocks: [
      para('To,\nThe Regional Transport Officer,\n{{rtoOffice}}'),
      para('Subject: {{subject}}', true),
      sec('Vehicle details', ['customerName', 'vehicleModel', 'vehicleReg', 'chassisNo', 'engineNo']),
      para('Respected Sir/Madam,'),
      para('{{message}}'),
      para('Thanking you,\nYours faithfully,\nfor {{company}}'),
    ],
    needs: ['rtoOffice', 'subject', 'message', 'vehicleReg', 'chassisNo'],
    declaration: '',
    signatures: ['Authorised signatory'],
  },
  {
    key: 'office_supplies',
    label: 'Monthly office supply purchase',
    title: 'OFFICE SUPPLY PURCHASE',
    forms: [],
    fields: [
      own('month', 'Month', 'text', { max: 40, placeholder: 'November 2026' }),
      own('items', 'Items', 'items'),
      own('notes', 'Notes', 'textarea', { max: 600 }),
    ],
    blocks: [
      sec('Purchase', ['month']),
      { type: 'items', key: 'items' },
      sec('Notes', ['notes']),
    ],
    needs: ['month', 'items'],
    declaration: '',
    signatures: ['Requested by', 'Approved by'],
  },
]);

/** Daily project reminder: shown from this IST time on (09:30 by default). */
export const REMINDER_HOUR_IST = Number(process.env.PROJECT_REMINDER_HOUR || 9);
export const REMINDER_MINUTE_IST = Number(process.env.PROJECT_REMINDER_MINUTE || 30);

/**
 * Days with no daily reminder besides Sundays, as IST "YYYY-MM-DD", comma-
 * separated in STAFF_HOLIDAYS (Railway dashboard, no deploy). Until that is
 * set, the support desk's SUPPORT_HOLIDAYS list is used. Malformed entries are
 * dropped: a typo must never stop the server.
 */
export const staffHolidays = (env = process.env) => new Set(
  String(env.STAFF_HOLIDAYS ?? env.SUPPORT_HOLIDAYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
);
