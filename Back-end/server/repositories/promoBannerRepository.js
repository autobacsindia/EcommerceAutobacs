import BaseRepository from './baseRepository.js';
import PromoBanner from '../models/PromoBanner.js';

/**
 * PromoBanner data access. Thin over BaseRepository — the only banner-specific
 * query is "which banner is live at instant T", and even that stays a pure data
 * query: the *decision* about what "live" means belongs to
 * services/promoBannerService.js, which is the sole caller.
 */
class PromoBannerRepository extends BaseRepository {
  constructor() {
    super(PromoBanner);
  }

  /**
   * The highest-priority banner active at `now`, or null.
   *
   * A null bound means "no bound" on that side, so the window test has to accept
   * a missing field as well as a missing value — a banner saved before the
   * scheduling fields existed has neither, and must still count as always-on.
   *
   * Sorted priority desc, then createdAt desc, so the newest of two equally
   * ranked banners wins rather than an arbitrary one. `.limit(1)` keeps this a
   * single-document read no matter how many banners accumulate over the years.
   */
  async findActiveAt(now = new Date()) {
    return PromoBanner.findOne({
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }] },
      ],
    })
      .sort({ priority: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Admin list, newest first and bounded.
   *
   * Keyset-paginated on createdAt rather than skip/offset: banners are a slowly
   * growing collection, but the house rule admits no exceptions and a cursor
   * costs nothing to write here.
   */
  async findPage({ limit = 50, before = null } = {}) {
    const query = before ? { createdAt: { $lt: before } } : {};
    return PromoBanner.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  }
}

export default new PromoBannerRepository();
