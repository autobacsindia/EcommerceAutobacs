/**
 * The panel badge: how much is waiting. Three countDocuments on an equality on
 * the leading field of an existing index (status), so each is an index-only count.
 */
import repo, { SUPPLIER_ACCOUNT_STATUS as A, LISTING_STATUS as L, PRICE_REVIEW_STATUS as P } from '../../repositories/supplierPartnerAdminRepository.js';
import { guard } from './shared.js';

export async function counts(actor) {
  guard(actor);
  const [accounts, listings, priceReviews] = await Promise.all([
    repo.countAccounts(A.IN_REVIEW),
    repo.countListings(L.SUBMITTED),
    repo.countReviews(P.PENDING),
  ]);
  return { accounts, listings, priceReviews, total: accounts + listings + priceReviews };
}

export default { counts };
