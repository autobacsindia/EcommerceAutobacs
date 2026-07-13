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

  /** Case-insensitive exact-name lookup, to warn on duplicate profile names. */
  async findByName(name) {
    return SalesRep.findOne({ name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') });
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default new SalesRepRepository();
