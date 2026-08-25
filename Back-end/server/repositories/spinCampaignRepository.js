import BaseRepository from './baseRepository.js';
import SpinCampaign from '../models/SpinCampaign.js';
import { SPIN_STATUS } from '../config/spin.js';

/**
 * SpinCampaign data access. Thin over BaseRepository — the only campaign-specific
 * query is "which campaign is live at instant T". The DECISION about whether a given
 * order may spin lives in services/spinService.js; this stays a pure data query.
 */
class SpinCampaignRepository extends BaseRepository {
  constructor() {
    super(SpinCampaign);
  }

  /**
   * The campaign running at `now`, or null.
   *
   * Only `live` qualifies: `draft` is still being configured and `off` is the kill
   * switch, and both must resolve to "no wheel" rather than to a differently-behaving
   * wheel. `.limit(1)` via findOne keeps this a single-document read regardless of how
   * many campaigns accumulate over the years.
   */
  async findLiveAt(now = new Date()) {
    return SpinCampaign.findOne({
      status: SPIN_STATUS.LIVE,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    })
      .sort({ startsAt: -1 })
      .lean();
  }

  async findBySlug(slug) {
    return SpinCampaign.findOne({ slug }).lean();
  }

  /** Admin list — keyset-paginated on createdAt. No skip/offset, per the house rule. */
  async findPage({ limit = 50, before = null } = {}) {
    const query = before ? { createdAt: { $lt: before } } : {};
    return SpinCampaign.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  }
}

export default new SpinCampaignRepository();
