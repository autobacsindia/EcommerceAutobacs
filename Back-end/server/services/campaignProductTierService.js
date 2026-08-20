/**
 * Product-tier authoring — preview a search query, review it, commit it.
 *
 * The bridge between how tiers are AUTHORED (an admin search query, because that is how
 * a human thinks about "all the Proman stuff") and how they are ENFORCED (materialized
 * CampaignProductTier rows, because a fuzzy relevance-ranked query is not a price).
 *
 * Nothing here prices a cart. It resolves membership and writes it down; pricingService
 * reads the result. See utils/productTiers.js for the resolution rules.
 */

import mongoose from 'mongoose';
import SearchService from './searchService.js';
import campaignRepository from '../repositories/campaignRepository.js';
import campaignProductTierRepository from '../repositories/campaignProductTierRepository.js';
import productRepository from '../repositories/productRepository.js';
import AppError from '../utils/AppError.js';
import { resolveAssignedTierCode, explicitTiers, validateProductTiers } from '../utils/productTiers.js';
import {
  PRODUCT_TIER_BULK_RATIO,
  PRODUCT_TIER_BULK_MIN_MATCHES,
  PRODUCT_TIER_MAX_MATCHES,
  PRODUCT_TIER_BULK_REFUSAL,
} from '../config/campaign.js';

const PAGE = 100;

/**
 * Does this match look like the `cbmcup` typo rather than a real tier?
 *
 * Requires BOTH an implausible share of the catalogue AND enough absolute matches for
 * the share to be meaningful — see PRODUCT_TIER_BULK_MIN_MATCHES. A truncated result is
 * suspicious on its own: hitting the ceiling means the query is unbounded in practice.
 *
 * One predicate, so the preview's warning and the commit's refusal can never disagree —
 * an operator warned about nothing and then blocked (or vice versa) stops trusting both.
 */
const looksLikeTypo = (matched, catalogueTotal, truncated) => {
  if (truncated) return true;
  if (matched < PRODUCT_TIER_BULK_MIN_MATCHES) return false;
  const ratio = catalogueTotal > 0 ? matched / catalogueTotal : 0;
  return ratio >= PRODUCT_TIER_BULK_RATIO;
};

/** True when the product is currently sold below its own MRP. Display only — pricing
 *  recomputes this live from effectivePrice at quote time (see the Phase 3 note). */
const isOnSale = (p) =>
  typeof p?.originalPrice === 'number' && p.originalPrice > p?.price;

class CampaignProductTierService {
  async _campaign(campaignId) {
    const campaign = await campaignRepository.findById(campaignId);
    if (!campaign) throw new AppError('Campaign not found', 404);
    return campaign;
  }

  /** The tier definition, refusing the default (its membership is "everything else"). */
  _tier(campaign, tierCode) {
    const tier = explicitTiers(campaign.productTiers).find(t => String(t.code) === String(tierCode));
    if (!tier) {
      const known = explicitTiers(campaign.productTiers).map(t => t.code).join(', ') || 'none configured';
      throw new AppError(
        `Unknown tier "${tierCode}" on this campaign (available: ${known}). ` +
        'The default tier has no membership — it is what a product gets when nothing else matches.',
        400
      );
    }
    return tier;
  }

  /**
   * Run one authoring query and return every product it matches.
   *
   * Goes through the SAME SearchService the storefront uses, deliberately: the operator
   * built this list by pasting a `/products/search?q=…` URL, so a preview resolved by a
   * different path would show them a different set than the one they reviewed. Bounded
   * by PRODUCT_TIER_MAX_MATCHES — a runaway query stops early and is reported, never
   * paged into memory.
   */
  async _matchesFor(query) {
    const term = String(query || '').trim();
    if (!term) throw new AppError('A search query is required', 400);

    const collected = new Map();
    let page = 1;
    let truncated = false;

    // Hard iteration bound as well as a size bound: a search backend that ignored our
    // paging (or kept returning the same page) must terminate, not spin.
    const maxPages = Math.ceil(PRODUCT_TIER_MAX_MATCHES / PAGE) + 1;
    while (page <= maxPages) {
      /*
        BOTH `q` and `search`, deliberately.

        SearchService has two backends with different parameter names: the Elasticsearch
        path reads `q`, and the MongoDB fallback's buildBaseQuery reads only `search`.
        Passing `q` alone means that the moment Elasticsearch is unavailable the term is
        silently DROPPED and the query degrades to "every active product" — which, on
        this path, would offer to put the entire catalogue into one discount tier. Caught
        exactly that way in test, where ES is disabled.

        A missing search backend must narrow to nothing or fail loudly; it must never
        widen a pricing rule.
      */
      const result = await SearchService.searchProducts({ q: term, search: term, page, limit: PAGE });
      const products = result?.products || [];
      if (products.length === 0) break;

      for (const p of products) {
        if (collected.size >= PRODUCT_TIER_MAX_MATCHES) { truncated = true; break; }
        collected.set(String(p._id), {
          id: String(p._id),
          name: p.name,
          slug: p.slug,
          brand: p.brand || null,
          price: p.price,
          originalPrice: p.originalPrice ?? null,
          onSale: isOnSale(p),
        });
      }
      if (truncated || products.length < PAGE) break;
      page += 1;
    }

    return { term, products: [...collected.values()], truncated };
  }

  /**
   * Preview what a query would assign, WITHOUT writing anything.
   *
   * Reports the share of the live catalogue the query sweeps up, because that ratio is
   * the typo detector: `comeup` matches 6 products, its typo `cbmcup` matches 928.
   */
  async preview(campaignId, { tierCode, query }) {
    const campaign = await this._campaign(campaignId);
    this._tier(campaign, tierCode);

    const { term, products, truncated } = await this._matchesFor(query);
    const catalogueTotal = await productRepository.count({ isActive: true });
    const ratio = catalogueTotal > 0 ? products.length / catalogueTotal : 0;

    // Which of these already sit in another tier, and where they would land. Shown up
    // front so overlap is a reviewed decision rather than a surprise after the fact.
    const existing = await campaignProductTierRepository.findForProducts(
      campaign._id, products.map(p => p.id)
    );
    const resolved = products.map(p => {
      const prior = existing.get(p.id);
      const matchedCodes = [...new Set([...(prior?.matchedCodes || []), String(tierCode)])];
      return {
        ...p,
        currentTier: prior?.tierCode || null,
        // Lowest-wins may keep the product where it is; say so before committing.
        resultingTier: resolveAssignedTierCode(campaign.productTiers, matchedCodes),
      };
    });

    const suspicious = looksLikeTypo(resolved.length, catalogueTotal, truncated);

    return {
      query: term,
      tierCode,
      matched: resolved.length,
      catalogueTotal,
      ratio: Number(ratio.toFixed(4)),
      truncated,
      // The commit will be REFUSED unless the operator confirms explicitly.
      requiresConfirmation: suspicious,
      warning: suspicious ? PRODUCT_TIER_BULK_REFUSAL : null,
      products: resolved,
      onSaleCount: resolved.filter(p => p.onSale).length,
      movedByOverlap: resolved.filter(p => p.resultingTier !== tierCode).length,
    };
  }

  /**
   * Commit an assignment.
   *
   * `productIds` is the operator's REVIEWED selection — the preview is advisory, the
   * selection is authoritative. Omitting it re-runs the query and takes the whole match,
   * which is what the drift-repair path wants.
   *
   * Overlap is resolved INCREMENTALLY and order-independently: each product accumulates
   * the set of tiers it has ever matched, and the winner is recomputed from that set. So
   * committing Thanos then Bronkz gives the same answer as Bronkz then Thanos — the
   * 6 Profender Thar/Jimny/Gypsy kits end up at 3% either way.
   */
  async commit(campaignId, { tierCode, query, productIds = null, confirm = false, assignedBy = null }) {
    const campaign = await this._campaign(campaignId);
    this._tier(campaign, tierCode);

    const ladderErrors = validateProductTiers(campaign.productTiers);
    if (ladderErrors.length) {
      throw new AppError(`This campaign's tier ladder is invalid: ${ladderErrors.join(' ')}`, 400);
    }

    let ids;
    let queries = [];
    if (Array.isArray(productIds) && productIds.length) {
      ids = [...new Set(productIds.map(String))].filter(id => mongoose.isValidObjectId(id));
      if (query) queries = [String(query).trim()];
    } else {
      const { term, products, truncated } = await this._matchesFor(query);
      ids = products.map(p => p.id);
      queries = [term];

      // The typo guard. Applied to a QUERY-DERIVED set only: an operator who hand-picked
      // 500 products from a preview has already looked at them, which is exactly the
      // review this guard exists to force.
      const catalogueTotal = await productRepository.count({ isActive: true });
      if (!confirm && looksLikeTypo(ids.length, catalogueTotal, truncated)) {
        throw new AppError(
          `${PRODUCT_TIER_BULK_REFUSAL} ("${term}" matches ${ids.length} of ${catalogueTotal} active products.)`,
          400
        );
      }
    }

    if (ids.length === 0) return { tierCode, assigned: 0, updated: 0, matched: 0, keptInLowerTier: 0 };

    const existing = await campaignProductTierRepository.findForProducts(campaign._id, ids);
    let keptInLowerTier = 0;

    const rows = ids.map(id => {
      const prior = existing.get(String(id));
      const matchedCodes = [...new Set([...(prior?.matchedCodes || []), String(tierCode)])];
      const winner = resolveAssignedTierCode(campaign.productTiers, matchedCodes);
      if (winner !== String(tierCode)) keptInLowerTier += 1;
      return {
        product: new mongoose.Types.ObjectId(String(id)),
        tierCode: winner,
        matchedCodes,
        matchedQueries: [...new Set([...(prior?.matchedQueries || []), ...queries])],
        source: 'query',
      };
    });

    const res = await campaignProductTierRepository.assign(campaign._id, rows, { assignedBy });
    return { tierCode, matched: ids.length, keptInLowerTier, ...res };
  }

  /**
   * Remove a tier's membership, recomputing the winner for products that also matched
   * another tier rather than blanket-deleting them. Dropping Thanos must not silently
   * strip a product of its Bronkz assignment.
   */
  async unassign(campaignId, tierCode) {
    const campaign = await this._campaign(campaignId);
    this._tier(campaign, tierCode);

    let cursor = null;
    let removed = 0;
    let demoted = 0;
    const rewrites = [];

    // Walk the tier's own rows plus any row whose matchedCodes still mention it.
    do {
      const { rows, nextCursor } = await campaignProductTierRepository.listPage(campaign._id, {
        cursor, limit: 100,
      });
      for (const row of rows) {
        const codes = (row.matchedCodes || []).map(String);
        if (!codes.includes(String(tierCode))) continue;
        const remaining = codes.filter(c => c !== String(tierCode));
        const winner = resolveAssignedTierCode(campaign.productTiers, remaining);
        const productId = row.product?._id || row.product;
        if (!winner) { removed += 1; rewrites.push({ productId, winner: null }); }
        else { demoted += 1; rewrites.push({ productId, winner, remaining }); }
      }
      cursor = nextCursor;
    } while (cursor);

    for (const r of rewrites) {
      if (r.winner === null) {
        await campaignProductTierRepository.removeProduct(campaign._id, r.productId);
      } else {
        await campaignProductTierRepository.assign(campaign._id, [{
          product: r.productId, tierCode: r.winner, matchedCodes: r.remaining, source: 'query',
        }], { preserveManual: false });
      }
    }

    return { tierCode, removed, demoted };
  }

  /** One keyset page of a campaign's assignments, for the admin roster. */
  async list(campaignId, { cursor, limit, tierCode } = {}) {
    const campaign = await this._campaign(campaignId);
    const page = await campaignProductTierRepository.listPage(campaign._id, { cursor, limit, tierCode });
    return {
      ...page,
      // Counts only on the first page — the same convention the member roster uses, so
      // paging does not re-aggregate the whole collection on every click.
      counts: cursor ? null : await campaignProductTierRepository.countsByTier(campaign._id),
      tiers: campaign.productTiers || [],
    };
  }

  /**
   * Products that MATCH a tier's saved authoring queries but carry no assignment.
   *
   * The price of materializing: the catalogue keeps growing, and a product added after
   * the assignment ran would sit silently in the default tier forever. This is the
   * report that makes that visible — without it a materialized scheme rots quietly,
   * which is strictly worse than the live-query approach it replaced.
   */
  async drift(campaignId) {
    const campaign = await this._campaign(campaignId);
    const out = [];

    for (const tier of explicitTiers(campaign.productTiers)) {
      for (const query of tier.matchQueries || []) {
        const { products, truncated } = await this._matchesFor(query);
        const existing = await campaignProductTierRepository.findForProducts(
          campaign._id, products.map(p => p.id)
        );
        const missing = products.filter(p => {
          const row = existing.get(p.id);
          return !row || !(row.matchedCodes || []).map(String).includes(String(tier.code));
        });
        if (missing.length) {
          out.push({ tierCode: tier.code, label: tier.label || tier.code, query, truncated, missing });
        }
      }
    }

    return { unassigned: out.reduce((s, r) => s + r.missing.length, 0), byTier: out };
  }
}

export default new CampaignProductTierService();
