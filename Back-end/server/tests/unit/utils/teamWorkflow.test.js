/**
 * utils/teamWorkflow.js — a line's stage is derived from the team's decision AND what
 * physically happened (parcels, cancellations), with the physical facts winning.
 */

import mongoose from 'mongoose';
import { lineStage, workflowView, initialWorkflow, unshippedQuantity, STAGE } from '../../../utils/teamWorkflow.js';

const oid = () => new mongoose.Types.ObjectId();

function orderWith({ qty = 2, stock = 'pending', shipments = [], cancellations = [], status = 'processing', extra = {} } = {}) {
  const itemId = oid();
  return {
    status,
    items: [{ _id: itemId, name: 'Mat', quantity: qty, price: 100 }],
    shipments,
    cancellations,
    workflow: { enteredAt: new Date(), open: true, lines: [{ itemId, stock, ...extra }], history: [] },
    itemId,
  };
}

describe('lineStage', () => {
  it('follows the stock decision while units are still owed', () => {
    for (const [stock, stage] of [
      ['pending', STAGE.STOCK_CHECK], ['in_stock', STAGE.TO_SHIP],
      ['ordered', STAGE.WITH_SUPPLIER], ['out_of_stock', STAGE.CUSTOMER_DECISION],
    ]) {
      const o = orderWith({ stock });
      expect(lineStage(o, o.workflow.lines[0])).toBe(stage);
    }
  });

  it('puts a refund request with accounts', () => {
    const o = orderWith({ stock: 'out_of_stock', extra: { refundRequestedAt: new Date() } });
    expect(lineStage(o, o.workflow.lines[0])).toBe(STAGE.ACCOUNTS_APPROVAL);
  });

  it('lets what physically happened win over the stock decision', () => {
    const shipped = orderWith({ stock: 'pending' });
    shipped.shipments = [{ status: 'shipped', lines: [{ itemId: shipped.itemId, quantity: 2 }] }];
    expect(lineStage(shipped, shipped.workflow.lines[0])).toBe(STAGE.SHIPPED);

    const delivered = orderWith({ stock: 'out_of_stock' });
    delivered.shipments = [{ status: 'delivered', lines: [{ itemId: delivered.itemId, quantity: 2 }] }];
    expect(lineStage(delivered, delivered.workflow.lines[0])).toBe(STAGE.DELIVERED);

    const cancelled = orderWith({ stock: 'in_stock' });
    cancelled.cancellations = [{ lines: [{ itemId: cancelled.itemId, quantity: 2 }] }];
    expect(lineStage(cancelled, cancelled.workflow.lines[0])).toBe(STAGE.CANCELLED);
  });

  it('keeps a partly shipped line open for the rest', () => {
    const o = orderWith({ qty: 3, stock: 'in_stock' });
    o.shipments = [{ status: 'shipped', lines: [{ itemId: o.itemId, quantity: 1 }] }];
    expect(lineStage(o, o.workflow.lines[0])).toBe(STAGE.TO_SHIP);
    expect(unshippedQuantity(o, o.itemId)).toBe(2);
  });

  it('treats a cancelled remainder as done: 1 shipped + 1 cancelled of 2 is shipped', () => {
    const o = orderWith({ qty: 2, stock: 'in_stock' });
    o.shipments = [{ status: 'shipped', lines: [{ itemId: o.itemId, quantity: 1 }] }];
    o.cancellations = [{ lines: [{ itemId: o.itemId, quantity: 1 }] }];
    expect(lineStage(o, o.workflow.lines[0])).toBe(STAGE.SHIPPED);
  });

  it('returns a lost parcel\'s units to the team', () => {
    const o = orderWith({ stock: 'in_stock' });
    o.shipments = [{ status: 'lost', lines: [{ itemId: o.itemId, quantity: 2 }] }];
    expect(lineStage(o, o.workflow.lines[0])).toBe(STAGE.TO_SHIP);
  });
});

describe('workflowView', () => {
  it('is null for an order that never entered the workflow', () => {
    expect(workflowView({ status: 'processing', items: [] })).toBeNull();
  });

  it('lists the teams with work, including operations for a parcel in transit', () => {
    const o = orderWith({ stock: 'pending' });
    expect(workflowView(o).needs).toEqual(['procurement']);
    o.shipments = [{ _id: oid(), status: 'shipped', lines: [{ itemId: o.itemId, quantity: 2 }] }];
    expect(workflowView(o).needs).toEqual(['operations']);
    o.shipments[0].status = 'delivered';
    const view = workflowView(o);
    expect(view.needs).toEqual([]);
    expect(view.open).toBe(false);
  });

  it('closes a finished order whatever the lines say', () => {
    const cancelled = orderWith({ stock: 'pending', status: 'cancelled' });
    expect(workflowView(cancelled)).toMatchObject({ open: false, needs: [] });
    expect(workflowView(cancelled).lines[0].stage).toBe(STAGE.CANCELLED);

    // Legacy: marked delivered with no parcels.
    const delivered = orderWith({ stock: 'pending', status: 'delivered' });
    expect(workflowView(delivered).lines[0].stage).toBe(STAGE.DELIVERED);
    expect(workflowView(delivered).open).toBe(false);
  });

  it('summarises the most urgent stage, with a count for multi-line orders', () => {
    const o = orderWith({ stock: 'in_stock' });
    o.items.push({ _id: oid(), name: 'Cover', quantity: 1 });
    o.workflow.lines.push({ itemId: o.items[1]._id, stock: 'pending' });
    expect(workflowView(o).summary).toBe('Needs stock check (1 of 2)');
  });
});

describe('initialWorkflow', () => {
  it('opens one pending line per order item and records the entry', () => {
    const items = [{ _id: oid() }, { _id: oid() }];
    const wf = initialWorkflow({ items });
    expect(wf.open).toBe(true);
    expect(wf.lines.map((l) => [String(l.itemId), l.stock])).toEqual(items.map((i) => [String(i._id), 'pending']));
    expect(wf.history[0].action).toBe('entered');
  });
});
