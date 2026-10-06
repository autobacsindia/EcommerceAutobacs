import BaseRepository from './baseRepository.js';
import SalesRep from '../models/SalesRep.js';

/**
 * SalesRep data access. Thin over BaseRepository — the only CRM-specific query
 * is "active reps for the assign dropdown".
 */
class SalesRepRepository extends BaseRepository {
  constructor() {
    super(SalesRep);
  }

  /** Active profiles, name-sorted — drives the assign dropdown + rep filter. */
  async findActive() {
    return SalesRep.find({ isActive: true }).sort({ name: 1 }).lean();
  }

  /**
   * The CRM profile for a staff login, created on first use. If a name-only
   * profile with the same name already exists and is unclaimed, it is claimed
   * (so leads already assigned to "Rahul" keep crediting Rahul). A name taken by
   * a DIFFERENT login gets the email appended to stay unique.
   */
  async findOrCreateForUser(user) {
    const existing = await SalesRep.findOne({ user: user._id });
    if (existing) return existing;

    const byName = await this.findByName(user.name);
    if (byName && !byName.user) {
      byName.user = user._id;
      byName.isActive = true;
      return byName.save();
    }
    const name = byName ? `${user.name} (${user.email})` : user.name;
    try {
      return await SalesRep.create({ name, user: user._id, createdBy: user._id });
    } catch (err) {
      // A concurrent first order from the same rep created it first.
      if (err?.code === 11000) {
        const raced = await SalesRep.findOne({ user: user._id });
        if (raced) return raced;
      }
      throw err;
    }
  }

  /** Case-insensitive exact-name lookup, to warn on duplicate profile names. */
  async findByName(name) {
    return SalesRep.findOne({ name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') });
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default new SalesRepRepository();
