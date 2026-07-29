import mongoose from "mongoose";
import productRepository from "../repositories/productRepository.js";
import stockNotificationRequestRepository from "../repositories/stockNotificationRequestRepository.js";
import leadRepository from "../repositories/leadRepository.js";
import leadSyncService from "../services/leadSyncService.js";
import { STOCK_STATUS } from "../utils/stockStatus.js";

/**
 * Controllers for the back-in-stock ("Notify me") feature.
 *
 * Customer-facing endpoints are auth-only (email is taken from the account, never
 * the request body — no enumeration/spam surface). Admin endpoints expose the
 * aggregated demand signal for the catalog "Stock Requests" screen.
 */

// Resolve the availability of the exact target (a variant for variable products,
// the parent otherwise) and validate the variantId against the product.
// Returns { ok, status, variantId } or { ok:false, error:{ status, message } }.
function resolveTarget(product, rawVariantId) {
  if (product.productType === 'variable') {
    if (!rawVariantId || !mongoose.Types.ObjectId.isValid(rawVariantId)) {
      return { ok: false, error: { status: 400, message: 'variantId is required for this product' } };
    }
    const variant = (product.variants || []).find(v => v._id.toString() === String(rawVariantId));
    if (!variant) {
      return { ok: false, error: { status: 400, message: 'Invalid variant for this product' } };
    }
    return { ok: true, status: variant.stock, variantId: variant._id };
  }
  return { ok: true, status: product.stock, variantId: null };
}

/**
 * Shared idempotent-signup path for both PDP interest buttons. Validates the
 * target's availability against `requiredStatus`, upserts a pending request of
 * `kind` on the partial-unique (product, variant, user, kind, pending) key, and
 * hands the created/existing request + product back to the caller's `afterUpsert`
 * hook (used by the waitlist path to seed a CRM lead). Returns nothing — it owns
 * the HTTP response.
 */
async function createInterestRequest(req, res, { kind, requiredStatus, notEligible, afterUpsert }) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid product id' });
  }

  const product = await productRepository.findStockView(id);
  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  const target = resolveTarget(product, req.body?.variantId);
  if (!target.ok) {
    return res.status(target.error.status).json({ success: false, message: target.error.message });
  }

  if (target.status !== requiredStatus) {
    return res.status(409).json({ success: false, code: notEligible.code, message: notEligible.message });
  }

  // Idempotent upsert on the partial-unique key: creates a pending request or
  // returns the existing one. `created` comes from the write metadata (no extra
  // pre-read). The 11000 catch closes the concurrent-insert race, and still
  // returns the winning request's id so the client can manage it.
  const filter = { product: id, variantId: target.variantId, user: req.user._id, kind, status: 'pending' };
  let request, created;
  try {
    ({ request, created } = await stockNotificationRequestRepository.upsertPending(filter, req.user.email));
  } catch (err) {
    if (err.code === 11000) {
      const existing = await stockNotificationRequestRepository.findPending(filter);
      return res.status(200).json({
        success: true,
        alreadyRequested: true,
        request: existing ? { _id: existing._id, variantId: target.variantId, status: 'pending' } : undefined,
      });
    }
    throw err;
  }

  // Post-signup side effects (e.g. seed a lead). Best-effort — never fail the
  // signup because a downstream sync hiccuped; the hook owns its own guard.
  if (afterUpsert) await afterUpsert({ request, created, product, variantId: target.variantId });

  return res.status(created ? 201 : 200).json({
    success: true,
    alreadyRequested: !created,
    request: { _id: request._id, variantId: request.variantId, status: request.status },
  });
}

// @route   POST /products/:id/notify-me
// @desc    Register the logged-in customer for a back-in-stock alert (idempotent)
// @access  Private
export async function createNotifyRequest(req, res) {
  // Only out-of-stock items are notifiable. Backorder has its own waiting list,
  // and in/low items are already purchasable.
  return createInterestRequest(req, res, {
    kind: 'restock',
    requiredStatus: STOCK_STATUS.OUT,
    notEligible: { code: 'NOT_OUT_OF_STOCK', message: 'This item is not out of stock.' },
  });
}

// @route   POST /products/:id/join-waitlist
// @desc    Add the logged-in customer to an on-backorder product's waiting list
//          (idempotent) and surface them in the Sales CRM as a warm lead.
// @access  Private
export async function createWaitlistRequest(req, res) {
  return createInterestRequest(req, res, {
    kind: 'backorder',
    requiredStatus: STOCK_STATUS.BACKORDER,
    notEligible: { code: 'NOT_ON_BACKORDER', message: 'This item is not on backorder.' },
    afterUpsert: async ({ request, product, variantId }) => {
      const variantLabel = variantId
        ? (product.variants || []).find(v => v._id.toString() === variantId.toString())?.label || null
        : null;
      // Best-effort CRM seed — a sync failure must not break the signup.
      await leadSyncService.safeSync(() =>
        leadSyncService.upsertFromWaitlist({ request, user: req.user, product, variantLabel })
      );
    },
  });
}

// @route   GET /stock-notifications/mine?productId=
// @desc    The caller's own pending requests (optionally scoped to one product,
//          used by the PDP to show which variants they're already waiting on)
// @access  Private
export async function listMyRequests(req, res) {
  const productId = req.query.productId && mongoose.Types.ObjectId.isValid(req.query.productId)
    ? req.query.productId
    : null;
  const kind = req.query.kind === 'backorder' ? 'backorder' : 'restock';

  const requests = await stockNotificationRequestRepository.findMinePending(req.user._id, productId, kind);
  res.json({ success: true, requests });
}

// @route   DELETE /stock-notifications/:id
// @desc    Cancel one of the caller's own pending requests
// @access  Private
export async function cancelMyRequest(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid request id' });
  }

  const request = await stockNotificationRequestRepository.cancelMine(id, req.user._id);
  if (!request) {
    return res.status(404).json({ success: false, message: 'Request not found' });
  }

  res.json({ success: true });
}

// @route   GET /stock-notifications/admin?status=pending&page=1&limit=25
// @desc    Demand signal for the catalog: pending requests grouped per product +
//          variant, highest demand first. Powers the admin "Stock Requests" screen.
// @access  Private/Admin
export async function adminListRequests(req, res) {
  const status = ['pending', 'notified', 'cancelled'].includes(req.query.status)
    ? req.query.status
    : 'pending';
  const kind = req.query.kind === 'backorder' ? 'backorder' : 'restock';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

  const { rows, total } = await stockNotificationRequestRepository.groupedByTarget(status, page, limit, kind);

  // Attach product name/slug/current-stock + the variant label/stock for the page's rows.
  const productIds = [...new Set(rows.map(r => r._id.product.toString()))];
  const products = await productRepository.findStockViewByIds(productIds);
  const byId = new Map(products.map(p => [p._id.toString(), p]));

  const items = rows.map((r) => {
    const product = byId.get(r._id.product.toString());
    const variant = r._id.variantId && product
      ? (product.variants || []).find(v => v._id.toString() === r._id.variantId.toString())
      : null;
    return {
      product: product
        ? {
            _id: product._id,
            name: product.name,
            slug: product.slug,
            stock: product.stock,
            image: product.images?.find(i => i.isPrimary)?.url || product.images?.[0]?.url || '',
          }
        : { _id: r._id.product, name: '(deleted product)', slug: null, stock: null, image: '' },
      variantId: r._id.variantId,
      variantLabel: variant?.label || null,
      variantStock: variant?.stock ?? null,
      count: r.count,
      firstRequestedAt: r.firstRequestedAt,
      lastRequestedAt: r.lastRequestedAt,
    };
  });

  res.json({
    success: true,
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

// @route   GET /stock-notifications/admin/requesters?productId=&variantId=&status=pending
// @desc    Drill-down: the individual customers waiting on one product/variant
// @access  Private/Admin
export async function adminListRequesters(req, res) {
  const { productId, variantId } = req.query;
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({ success: false, message: 'Valid productId is required' });
  }
  const status = ['pending', 'notified', 'cancelled'].includes(req.query.status)
    ? req.query.status
    : 'pending';
  const kind = req.query.kind === 'backorder' ? 'backorder' : 'restock';

  const query = {
    product: productId,
    kind,
    status,
    variantId: variantId && mongoose.Types.ObjectId.isValid(variantId) ? variantId : null,
  };

  const requesters = await stockNotificationRequestRepository.findRequesters(query);

  // For the backorder waiting list, pair each requester with its CRM lead so the
  // Stock Requests screen can show the lead's status and drive the one-way "Mark
  // contacted" action (mirrored to Leads — single source of truth). Restock rows
  // don't seed leads, so this join is skipped for them.
  if (kind === 'backorder' && requesters.length) {
    const reqIds = requesters.map(r => r._id);
    const leads = await leadRepository.findBySourceRefs(reqIds);
    // Map each request ref → its lead (id + status).
    const leadByRef = new Map();
    for (const lead of leads) {
      for (const src of lead.sources || []) {
        if (src.ref) leadByRef.set(src.ref.toString(), { leadId: lead._id, leadStatus: lead.status });
      }
    }
    const enriched = requesters.map(r => ({ ...r, ...(leadByRef.get(r._id.toString()) || { leadId: null, leadStatus: null }) }));
    return res.json({ success: true, requesters: enriched });
  }

  res.json({ success: true, requesters });
}
