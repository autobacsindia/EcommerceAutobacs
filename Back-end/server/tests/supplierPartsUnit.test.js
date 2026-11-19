/**
 * utils/supplierParts.js — the pure rules for one order line bought from several
 * suppliers, and for changing a supplier with a reason. No I/O.
 */
import mongoose from 'mongoose';
import {
  partsOf, materialize, addPart, replacePart, removePart, editPart, partsState, partForRequest,
  partPaymentRaised, partPaymentPaid, partPaymentCleared, requestPartReplaced, waitingText, reasonText,
  cleanReason, PartError, IMPLICIT_PART_ID, MAX_ACTIVE_PARTS, partsView,
} from '../utils/supplierParts.js';
import { lineStage, workflowView, STAGE } from '../utils/teamWorkflow.js';

const newId = () => new mongoose.Types.ObjectId();
const actor = { _id: newId(), name: 'Aromal S' };
const now = new Date('2026-11-19T10:00:00Z');
const reason = { reasonCode: 'supplier_refunded', reasonNote: 'out of stock' };

describe('supplierParts — reading a line', () => {
  it('a line never split reads as one implicit part from its own supplier fields', () => {
    expect(partsOf({ stock: 'pending' })).toEqual([]);
    expect(partsOf({ stock: 'own_stock', supplierName: 'X' })).toEqual([]);
    const [p] = partsOf({ stock: 'ordered', supplierName: 'G S Enterprises', stockAt: now });
    expect(p).toMatchObject({ _id: IMPLICIT_PART_ID, supplierName: 'G S Enterprises', status: 'active', orderedAt: now, paymentAt: null });
    const [q] = partsOf({ stock: 'in_stock', supplierName: 'G S', supplierPaymentAt: now, supplierPaymentRef: 'PR-0088' });
    expect(q).toMatchObject({ paymentAt: now, paymentRef: 'PR-0088', orderedAt: null });
  });

  it('materialize writes the implicit part out with a real id, keeping its payment state', () => {
    const parts = materialize({ stock: 'in_stock', supplierName: 'G S', supplierPaymentAt: now, supplierPaymentRef: 'PR-0088' }, { newId, now });
    expect(parts).toHaveLength(1);
    expect(mongoose.isValidObjectId(parts[0]._id)).toBe(true);
    expect(parts[0]).toMatchObject({ supplierName: 'G S', paymentRef: 'PR-0088' });
    expect(materialize({ stock: 'pending' }, { newId })).toEqual([]);
  });

  it('a payment request without a part belongs to the first part (raised before the split)', () => {
    const a = { _id: newId() }; const b = { _id: newId() };
    expect(partForRequest([a, b], {})).toBe(a);
    expect(partForRequest([a, b], { partId: b._id })).toBe(b);
    expect(partForRequest([], {})).toBeNull();
  });
});

describe('supplierParts — splitting and changing', () => {
  it('adds parts, each with its own supplier and an optional "what"', () => {
    let { parts } = addPart([], { supplierName: '  Trek N Trade ', what: 'Jerry can' }, actor, { newId, now });
    ({ parts } = addPart(parts, { supplierName: 'Mount Co', what: '' }, actor, { newId, now }));
    expect(parts.map((p) => [p.supplierName, p.what, p.status, p.createdByName])).toEqual([
      ['Trek N Trade', 'Jerry can', 'active', 'Aromal S'], ['Mount Co', '', 'active', 'Aromal S'],
    ]);
    expect(() => addPart(parts, { supplierName: '  ' }, actor, { newId })).toThrow(PartError);
    let many = [];
    for (let i = 0; i < MAX_ACTIVE_PARTS; i += 1) ({ parts: many } = addPart(many, { supplierName: `S${i}` }, actor, { newId }));
    expect(() => addPart(many, { supplierName: 'one more' }, actor, { newId })).toThrow(/at most/);
  });

  it('change keeps the old supplier as "replaced" with who / when / why, and links old → new', () => {
    const [old] = addPart([], { supplierName: 'G S Enterprises', what: 'Jerry can' }, actor, { newId }).parts;
    const { parts, part } = replacePart([old], String(old._id), { supplierName: 'Trek N Trade', ...reason }, actor, { newId, now });
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ status: 'replaced', replacedAt: now, replacedByName: 'Aromal S', replacedWith: part._id, reasonCode: 'supplier_refunded', reasonNote: 'out of stock' });
    expect(part).toMatchObject({ status: 'active', supplierName: 'Trek N Trade', what: 'Jerry can', replaces: old._id });
    expect(reasonText(parts[0])).toBe('Supplier refunded — out of stock');
    // Changing it again: the same part cannot be changed twice; the new one can.
    expect(() => replacePart(parts, String(old._id), { supplierName: 'X', ...reason }, actor, { newId })).toThrow(/already been changed/);
    const twice = replacePart(parts, String(part._id), { supplierName: 'Third Co', reasonCode: 'late' }, actor, { newId });
    expect(twice.parts.map((p) => p.status)).toEqual(['replaced', 'replaced', 'active']);
  });

  it('refuses a change with no reason, "other" with no words, the same supplier, or an open payment', () => {
    const [p] = addPart([], { supplierName: 'G S' }, actor, { newId }).parts;
    expect(() => replacePart([p], String(p._id), { supplierName: 'New' }, actor, { newId })).toThrow(/why/);
    expect(() => replacePart([p], String(p._id), { supplierName: 'New', reasonCode: 'other', reasonNote: '' }, actor, { newId })).toThrow(/Say why/);
    expect(() => replacePart([p], String(p._id), { supplierName: ' g s ', ...reason }, actor, { newId })).toThrow(/same supplier/);
    const pending = [{ ...p, paymentAt: now, paymentRef: 'PR-0001' }];
    expect(() => replacePart(pending, String(p._id), { supplierName: 'New', ...reason }, actor, { newId })).toThrow(/PR-0001 is still open/);
    expect(cleanReason('other', 'Supplier closed')).toEqual({ reasonCode: 'other', reasonNote: 'Supplier closed' });
  });

  it('remove only a never-paid part, never the last one; edit the supplier only before any payment', () => {
    let { parts } = addPart([], { supplierName: 'A' }, actor, { newId });
    expect(() => removePart(parts, String(parts[0]._id), { hasPayments: false }, actor)).toThrow(/at least one/);
    ({ parts } = addPart(parts, { supplierName: 'B' }, actor, { newId }));
    expect(() => removePart(parts, String(parts[1]._id), { hasPayments: true }, actor)).toThrow(/Change supplier/);
    const removed = removePart(parts, String(parts[1]._id), { hasPayments: false, note: 'typo' }, actor, { now });
    expect(removed.parts[1]).toMatchObject({ status: 'removed', reasonNote: 'typo' });

    expect(editPart(parts, String(parts[0]._id), { what: 'Can' }, { hasPayments: true }).changes).toEqual({ what: 'Can' });
    expect(() => editPart(parts, String(parts[0]._id), { supplierName: 'Z' }, { hasPayments: true })).toThrow(/Change supplier/);
    expect(editPart(parts, String(parts[0]._id), { supplierName: 'Z' }, { hasPayments: false }).changes).toEqual({ supplierName: 'Z' });
  });
});

describe('supplierParts — payments move each part on its own', () => {
  const two = () => {
    let { parts } = addPart([], { supplierName: 'A', what: 'Can' }, actor, { newId });
    ({ parts } = addPart(parts, { supplierName: 'B', what: 'Mount' }, actor, { newId }));
    return parts;
  };

  it('raised → pending; paid → ordered (keeps the PR number); cancelled → to order again', () => {
    const parts = two();
    const [a, b] = parts;
    const raised = partPaymentRaised(parts, { partId: b._id, ref: 'PR-0091' }, now);
    expect(raised[1]).toMatchObject({ paymentAt: now, paymentRef: 'PR-0091' });
    expect(partsState(raised)).toMatchObject({ paymentPending: true, allOrdered: false });
    expect(waitingText(raised)).toBe('Can from A (not paid yet); Mount from B (PR-0091 not paid yet)');
    // The paid event finds the part by its PR number when no id is given.
    const paid = partPaymentPaid(raised, { ref: 'PR-0091' }, now);
    expect(paid[1]).toMatchObject({ paymentAt: null, orderedAt: now, orderedRef: 'PR-0091' });
    expect(partPaymentPaid(paid, { ref: 'PR-0091' })).toBeNull(); // twice → no change
    const cleared = partPaymentCleared(partPaymentRaised(parts, { partId: a._id, ref: 'PR-0090' }), { partId: a._id });
    expect(cleared[0].paymentAt).toBeNull();
    const both = partPaymentPaid(partPaymentRaised(paid, { partId: a._id, ref: 'PR-0090' }), { partId: a._id });
    expect(partsState(both)).toMatchObject({ allOrdered: true, waiting: [] });
  });

  it('a payment raised for a replaced part does not land', () => {
    const [p] = addPart([], { supplierName: 'A' }, actor, { newId }).parts;
    const { parts } = replacePart([p], String(p._id), { supplierName: 'B', ...reason }, actor, { newId });
    expect(partPaymentRaised(parts, { partId: p._id, ref: 'PR-1' })).toBeNull();
  });

  it('a paid PR whose part was replaced is owed back by the supplier', () => {
    const itemId = newId();
    const [p] = addPart([], { supplierName: 'G S' }, actor, { newId }).parts;
    const { parts } = replacePart([p], String(p._id), { supplierName: 'Trek', ...reason }, actor, { newId });
    const order = { workflow: { lines: [{ itemId, parts }] } };
    expect(requestPartReplaced(order, { itemIds: [itemId] })).toBe(true); // a PR from before the split: first part
    expect(requestPartReplaced(order, { itemIds: [itemId], partId: parts[1]._id })).toBe(false);
    expect(requestPartReplaced({ workflow: { lines: [{ itemId }] } }, { itemIds: [itemId] })).toBe(false); // never split
  });
});

describe('teamWorkflow — a split line follows its parts', () => {
  const itemId = newId();
  const order = (parts, stock = 'in_stock') => ({
    status: 'processing', items: [{ _id: itemId, quantity: 1 }], shipments: [], cancellations: [],
    workflow: { enteredAt: now, lines: [{ itemId, stock, parts }] },
  });
  const two = () => {
    let { parts } = addPart([], { supplierName: 'A', what: 'Can' }, actor, { newId });
    ({ parts } = addPart(parts, { supplierName: 'B', what: 'Mount' }, actor, { newId }));
    return parts;
  };

  it('to order → payment pending → ordered only when EVERY active part is paid', () => {
    const parts = two();
    const o = order(parts);
    expect(lineStage(o, o.workflow.lines[0])).toBe(STAGE.TO_SHIP);
    const oneRaised = partPaymentRaised(parts, { partId: parts[0]._id, ref: 'PR-1' });
    expect(lineStage(order(oneRaised), { itemId, stock: 'in_stock', parts: oneRaised })).toBe(STAGE.PAYMENT_PENDING);
    const onePaid = partPaymentPaid(oneRaised, { partId: parts[0]._id });
    const v = workflowView(order(onePaid)).lines[0];
    expect(v).toMatchObject({ stage: STAGE.TO_SHIP, stageLabel: 'In Stock (1 of 2 parts ordered)', split: true });
    expect(v.partsWaiting).toBe('Mount from B (not paid yet)');
    const allPaid = partPaymentPaid(partPaymentRaised(onePaid, { partId: parts[1]._id, ref: 'PR-2' }), { partId: parts[1]._id });
    const done = workflowView(order(allPaid)).lines[0];
    expect(done).toMatchObject({ stage: STAGE.WITH_SUPPLIER, partsWaiting: '' });
    expect(done.supplierParts.map((p) => p.state)).toEqual(['ordered', 'ordered']);
  });

  it('a replaced part no longer counts — the new one must be paid', () => {
    let parts = partPaymentPaid(partPaymentRaised(addPart([], { supplierName: 'G S' }, actor, { newId }).parts, { ref: 'PR-0088' }), { ref: 'PR-0088' });
    expect(lineStage(order(parts), { itemId, stock: 'in_stock', parts })).toBe(STAGE.WITH_SUPPLIER);
    ({ parts } = replacePart(parts, String(parts[0]._id), { supplierName: 'Trek', ...reason }, actor, { newId }));
    const v = workflowView(order(parts)).lines[0];
    expect(v.stage).toBe(STAGE.TO_SHIP);
    expect(partsView({ parts }).map((p) => [p.supplierName, p.state, p.reason])).toEqual([
      ['G S', 'replaced', 'Supplier refunded — out of stock'], ['Trek', 'to_order', ''],
    ]);
  });

  it('our warehouse / out of stock override the parts, which stay as history', () => {
    const parts = two();
    expect(lineStage(order(parts, 'out_of_stock'), { itemId, stock: 'out_of_stock', parts })).toBe(STAGE.CUSTOMER_DECISION);
    expect(lineStage(order(parts, 'own_stock'), { itemId, stock: 'own_stock', parts })).toBe(STAGE.OWN_STOCK);
  });

  it('a line never split behaves exactly as before', () => {
    const o = order(undefined, 'ordered');
    o.workflow.lines[0].supplierName = 'G S';
    const v = workflowView(o).lines[0];
    expect(v).toMatchObject({ stage: STAGE.WITH_SUPPLIER, stageLabel: 'Ordered From Supplier', split: false, partsWaiting: '' });
    expect(v.supplierParts).toEqual([expect.objectContaining({ id: 'main', supplierName: 'G S', state: 'ordered' })]);
  });
});
