/**
 * Stored slip templates (services/slipTemplateService.js): the admin's
 * Slip templates screen, the defaults, each slip's own boxes on a project,
 * item lists, and what prints. Mongo is real.
 *
 * What must hold:
 *   - the defaults are written into an empty collection, and an admin edit is
 *     never overwritten by them
 *   - a template is checked in full before it is saved — no unknown key, no
 *     stray placeholder, bounded sizes — so a broken one never reaches a menu
 *   - only the admin manages templates; two admins never overwrite each other
 *   - hidden or deleted templates leave every project's menu; a slip is only
 *     offered on the forms it names
 *   - a slip's own boxes are checked (types, dates in order) and kept per project
 *   - item amounts and totals are worked out in paise on the server
 *   - every default prints, filled and empty
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const { default: SlipTemplate } = await import('../models/SlipTemplate.js');
const projects = await import('../services/staffProjectService.js');
const details = await import('../services/staffProjectDetailsService.js');
const slips = await import('../services/slipTemplateService.js');
const { renderProjectSlip, paragraphText } = await import('../services/projectSlipService.js');
const { DEFAULT_SLIPS } = await import('../config/projectTemplates.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `st${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = (u) => User.findById(u._id);
const status = (code, promise, msg) => expect(promise).rejects.toMatchObject({ statusCode: code, ...(msg && { message: expect.stringMatching(msg) }) });
const rev = async (p) => (await StaffProject.findById(p.id).lean()).rev;
const byKey = async (key) => SlipTemplate.findOne({ key }).lean();
const def = (over = {}) => ({
  key: 'warranty_card', label: 'Warranty card', title: 'WARRANTY CARD', forms: ['sales'],
  fields: [{ key: 'warrantyMonths', label: 'Warranty (months)', type: 'number' }],
  blocks: [
    { type: 'paragraph', text: '{{company}} warrants the work on {{vehicleReg}} for {{warrantyMonths}} months.' },
    { type: 'section', title: 'Customer', keys: ['customerName', 'customerPhone'] },
  ],
  needs: ['warrantyMonths', 'vehicleReg'],
  declaration: 'Keep this card safe.',
  signatures: ['Authorised signatory'],
  ...over,
});

let admin, nevin, ravi, outsider, project;
beforeAll(async () => { await SlipTemplate.init(); await StaffProject.init(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Vyshnav');
  nevin = await person('staff', { team: 'operations', isHead: true }, 'Nevin');
  ravi = await person('staff', { team: 'operations' }, 'Ravi');
  outsider = await person('staff', { team: 'sales' }, 'Out');
  project = (await projects.createProject(await as(admin), { name: 'Vicky’s Hilux', ownerId: String(nevin._id), memberIds: [String(ravi._id)] }, req)).project;
});
const fillSales = async (values = { customerName: 'Vicky', vehicleModel: 'Toyota Hilux', vehicleReg: 'KL 07 CX 4521' }) => details.updateDetails(await as(ravi), project.id, { rev: await rev(project), template: 'sales', values }, req);
const saveBoxes = async (key, values, who = ravi) => slips.saveSlipValues(await as(who), project.id, key, { rev: await rev(project), values }, req);
const menu = async (who = nevin) => (await projects.getProject(await as(who), project.id)).slips;

describe('defaults', () => {
  it('an empty collection gets every default, once, in order', async () => {
    const { templates } = await slips.adminList(await as(admin));
    expect(templates.map((t) => t.key)).toEqual(DEFAULT_SLIPS.map((d) => d.key));
    expect(templates.every((t) => t.isDefault && t.active && t.rev === 1)).toBe(true);
    await Promise.all([slips.seedDefaults(), slips.seedDefaults(), slips.ensureDefaults()]);
    expect(await SlipTemplate.countDocuments()).toBe(DEFAULT_SLIPS.length);
  });

  it('an admin’s edit is never overwritten by the defaults', async () => {
    const { templates } = await slips.adminList(await as(admin));
    const d = templates.find((t) => t.key === 'delivery');
    await slips.adminUpdate(await as(admin), d.id, { ...d, rev: d.rev, title: 'HANDOVER NOTE' }, req);
    await slips.seedDefaults();
    expect((await byKey('delivery')).title).toBe('HANDOVER NOTE');
    // …until the admin resets it.
    const edited = await byKey('delivery');
    await slips.adminReset(await as(admin), String(edited._id), { rev: edited.rev }, req);
    expect((await byKey('delivery')).title).toBe('DELIVERY SLIP');
  });
});

describe('checking a template', () => {
  const bad = (over, msg) => expect(() => slips.cleanDefinition(def(over))).toThrow(msg);
  it('accepts a good one', () => {
    expect(slips.cleanDefinition(def())).toMatchObject({ key: 'warranty_card', forms: ['sales'] });
  });
  it('refuses a broken one, naming what is wrong', () => {
    bad({ key: 'Bad Key' }, /lowercase letters/);
    bad({ key: 'summary' }, /built-in project summary/);
    bad({ label: '  ' }, /Menu name: fill this in/);
    bad({ title: 'x'.repeat(41) }, /under 40/);
    bad({ forms: ['spaceship'] }, /Pick forms/);
    bad({ blocks: [] }, /at least one block/);
    bad({ blocks: [{ type: 'section', title: 'X', keys: ['chasisNo'] }] }, /Block 1 prints “chasisNo”/);
    bad({ blocks: [{ type: 'paragraph', text: 'Hello {{nobody}}' }] }, /Block 1 prints “nobody”/);
    bad({ blocks: [{ type: 'paragraph', text: 'Hello {{customerName' }] }, /not closed/);
    bad({ blocks: [{ type: 'table' }] }, /section, a paragraph or an item table/);
    bad({ blocks: [{ type: 'section', title: 'X', keys: [] }] }, /at least one detail/);
    bad({ fields: [{ key: 'list', label: 'List', type: 'items' }], blocks: [{ type: 'section', keys: ['list'] }] }, /own table/);
    bad({ blocks: [{ type: 'items', key: 'warrantyMonths' }] }, /item-list box/);
    bad({ fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }] }, /same code/);
    bad({ fields: [{ key: 'customerName', label: 'Name', type: 'text' }] }, /already a project detail/);
    bad({ fields: [{ key: 'balance', label: 'B', type: 'money' }] }, /already a project detail/);
    bad({ fields: [{ key: '9x', label: 'X', type: 'text' }] }, /letters and digits/);
    bad({ fields: [{ key: 'x', label: 'X', type: 'colour' }] }, /box types/);
    bad({ fields: [{ key: 'x', label: 'X', type: 'date', notBefore: 'y' }] }, /another date box/);
    bad({ needs: ['balance'] }, /warn-if-empty/);
    bad({ needs: ['nothing'] }, /warn-if-empty/);
    bad({ signatures: ['a', 'b', 'c', 'd', 'e'] }, /at most 4/);
    bad({ signatures: [''] }, /Signature box 1: fill this in/);
    bad({ order: 5000 }, /0 to 1000/);
  });
  it('a slip on every form may only print its own boxes and computed values beyond every form’s fields', () => {
    expect(slips.cleanDefinition(def({ forms: [], needs: [] }))).toMatchObject({ forms: [] });
  });
  it('every default passes its own checks', () => {
    for (const d of DEFAULT_SLIPS) expect(() => slips.cleanDefinition(d)).not.toThrow();
  });
});

describe('the admin screen', () => {
  it('only the admin manages templates', async () => {
    await status(403, slips.adminList(await as(nevin)), /Only the admin/);
    await status(403, slips.adminCreate(await as(nevin), def(), req));
    expect(() => slips.previewSlip(nevin, def())).toThrow(/Only the admin/);
  });

  it('a new slip shows in the menu of the forms it names, and prints', async () => {
    const t = await slips.adminCreate(await as(admin), def(), req);
    expect(t).toMatchObject({ key: 'warranty_card', isDefault: false, rev: 1, updatedByName: 'Vyshnav' });
    await status(409, slips.adminCreate(await as(admin), def(), req), /already exists/);
    expect((await menu()).map((s) => s.key)).not.toContain('warranty_card'); // no sales details yet
    await fillSales();
    expect((await menu()).map((s) => s.key)).toContain('warranty_card');
    await saveBoxes('warranty_card', { warrantyMonths: '12' });
    const s = await slips.loadSlip(await as(nevin), project.id, 'warranty_card');
    expect(paragraphText(s.blocks[0])).toBe('Autobacs India warrants the work on KL 07 CX 4521 for 12 months.');
    expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('two admins at once: the second is refused; the code never changes', async () => {
    const t = await slips.adminCreate(await as(admin), def(), req);
    await slips.adminUpdate(await as(admin), t.id, { ...def({ label: 'Warranty' }), rev: 1 }, req);
    await status(409, slips.adminUpdate(await as(admin), t.id, { ...def({ label: 'Guarantee' }), rev: 1 }, req), /changed this template/);
    await status(400, slips.adminUpdate(await as(admin), t.id, { ...def({ key: 'other' }), rev: 2 }, req), /code cannot change/);
    await status(400, slips.adminUpdate(await as(admin), t.id, { ...def({ blocks: [] }), rev: 2 }, req), /at least one block/);
    expect((await byKey('warranty_card')).label).toBe('Warranty');
  });

  it('hiding or deleting takes a slip off every menu; restoring brings it and its saved boxes back', async () => {
    await fillSales();
    await saveBoxes('vehicle_authorisation', { driverName: 'Joby' });
    const t = await byKey('vehicle_authorisation');
    await slips.adminUpdate(await as(admin), String(t._id), { ...slips.shapeTemplate(t), rev: t.rev, active: false }, req);
    expect((await menu()).map((s) => s.key)).not.toContain('vehicle_authorisation');
    await status(404, slips.loadSlip(await as(nevin), project.id, 'vehicle_authorisation'));
    const hidden = await byKey('vehicle_authorisation');
    await slips.adminUpdate(await as(admin), String(t._id), { ...slips.shapeTemplate(hidden), rev: hidden.rev, active: true }, req);
    const live = await byKey('vehicle_authorisation');
    await slips.adminUpdate(await as(admin), String(t._id), { rev: live.rev, archived: true }, req);
    expect((await menu()).map((s) => s.key)).not.toContain('vehicle_authorisation');
    const gone = await byKey('vehicle_authorisation');
    await status(409, slips.adminUpdate(await as(admin), String(t._id), { ...slips.shapeTemplate(gone), rev: gone.rev }, req), /Restore it first/);
    await slips.adminUpdate(await as(admin), String(t._id), { rev: gone.rev, archived: false }, req);
    const back = (await menu()).find((s) => s.key === 'vehicle_authorisation');
    expect(back.values).toEqual({ driverName: 'Joby' });
  });

  it('only a built-in slip can be reset', async () => {
    const t = await slips.adminCreate(await as(admin), def(), req);
    await status(400, slips.adminReset(await as(admin), t.id, { rev: 1 }, req), /built-in/);
  });

  it('preview fills every empty value with its [Label] and prints', async () => {
    const s = slips.previewSlip(admin, def());
    expect(paragraphText(s.blocks[0])).toBe('Autobacs India warrants the work on [Registration no.] for [Warranty (months)] months.');
    expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
    expect(() => slips.previewSlip(admin, def({ blocks: [{ type: 'paragraph', text: '{{x}}' }] }))).toThrow(/prints “x”/);
  });
});

describe('a project’s slips', () => {
  it('a project with no details is offered only the slips for every form, and the summary', async () => {
    expect((await menu()).map((s) => s.key)).toEqual(['office_supplies', 'summary']);
    await status(409, slips.loadSlip(await as(nevin), project.id, 'rto_letter'), /Fill in the project’s details on the Sales job/);
    await details.updateDetails(await as(ravi), project.id, { rev: await rev(project), template: 'general', values: {} }, req);
    await status(409, slips.loadSlip(await as(nevin), project.id, 'rto_letter'), /needs the Sales job/);
  });

  it('vehicle authorisation: the driver’s boxes are checked, kept, and printed in the letter', async () => {
    await fillSales();
    await status(400, saveBoxes('vehicle_authorisation', { validFrom: '2026-11-20', validTo: '2026-11-18' }), /Valid until can’t be before Valid from/);
    await status(400, saveBoxes('vehicle_authorisation', { driverPhone: 'call me' }), /phone number/);
    await status(400, saveBoxes('vehicle_authorisation', { customerName: 'X' }), /not a box of the Vehicle/);
    // Someone outside the project does not even see it.
    await status(404, saveBoxes('vehicle_authorisation', { driverName: 'X' }, outsider));
    await saveBoxes('vehicle_authorisation', {
      driverName: 'Joby Thomas', driverLicence: 'kl07 20190012345', driverPhone: '9847000001',
      purpose: 'Collect the vehicle from the customer', validFrom: '2026-11-18', validTo: '2026-11-20',
    });
    const item = (await menu()).find((s) => s.key === 'vehicle_authorisation');
    expect(item.missing).toEqual([]);
    expect(item.values.driverLicence).toBe('KL07 20190012345');
    const s = await slips.loadSlip(await as(ravi), project.id, 'vehicle_authorisation');
    expect(paragraphText(s.blocks[1])).toBe('This is to certify that Joby Thomas (driving licence KL07 20190012345, phone 9847000001), our operations driver, is authorised by Autobacs India to drive and take charge of the vehicle below for the purpose stated.');
    expect(s.showProject).toBe(false);
    expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a stale project rev is refused for slip boxes too', async () => {
    await fillSales();
    const r = await rev(project);
    await slips.saveSlipValues(await as(ravi), project.id, 'rto_letter', { rev: r, values: { subject: 'A' } }, req);
    await status(409, slips.saveSlipValues(await as(nevin), project.id, 'rto_letter', { rev: r, values: { subject: 'B' } }, req));
  });

  it('a letter with empty boxes prints blank lines and lists them', async () => {
    await fillSales({ customerName: 'Vicky' });
    const s = await slips.loadSlip(await as(ravi), project.id, 'rto_letter');
    expect(s.missing).toEqual(['RTO office', 'Subject', 'Message', 'Registration no.', 'Chassis no.']);
    expect(paragraphText(s.blocks[1])).toBe('Subject: ____________________');
    expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('office supplies: amounts and the total are worked out in paise; empty lines are dropped', async () => {
    await saveBoxes('office_supplies', {
      month: 'November 2026',
      items: [
        { name: 'A4 paper (ream)', qty: '3', rate: '33.33' },
        { name: 'Pens', qty: 10, rate: 0.1 },
        { name: '', qty: '', rate: '' },
        { name: 'Stapler', qty: '1.5', rate: '0.07' },
      ],
    });
    const s = await slips.loadSlip(await as(ravi), project.id, 'office_supplies');
    const table = s.blocks.find((b) => b.type === 'items');
    expect(table.rows.map((r) => r.amount)).toEqual([99.99, 1, 0.11]);
    expect(table.total).toBe(101.1);
    expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
    await status(400, saveBoxes('office_supplies', { items: [{ name: 'Pens', qty: 0, rate: 5 }] }), /more than 0/);
    await status(400, saveBoxes('office_supplies', { items: [{ name: '', qty: 2, rate: 5 }] }), /give the item a name/);
    await status(400, saveBoxes('office_supplies', { items: 'pens' }), /list of items/);
    await status(400, saveBoxes('office_supplies', { items: Array.from({ length: 51 }, () => ({ name: 'x', qty: 1 })) }), /at most 50/);
  });

  it('every default prints on a filled project and on an empty one', async () => {
    for (const d of DEFAULT_SLIPS.filter((x) => !x.forms.length)) {
      const s = await slips.loadSlip(await as(nevin), project.id, d.key);
      expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
    }
    await fillSales();
    for (const d of DEFAULT_SLIPS) {
      const s = await slips.loadSlip(await as(nevin), project.id, d.key);
      expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('item amounts never come from floating-point drift', () => {
    expect(slips.itemsWithAmounts([{ name: 'a', qty: 0.1, rate: 0.2 }, { name: 'b', qty: 3, rate: 0.1 }])).toEqual({
      rows: [{ name: 'a', qty: 0.1, rate: 0.2, amount: 0.02 }, { name: 'b', qty: 3, rate: 0.1, amount: 0.3 }],
      total: 0.32,
    });
  });
});
