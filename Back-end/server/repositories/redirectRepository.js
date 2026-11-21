import Redirect from '../models/Redirect.js';

/** Redirect table data access (models/Redirect.js). Bounded reads only. */
class RedirectRepository {
  /** Every row, for the edge redirect map. Capped: the table is small by design. */
  findAllForMap(limit = 50000) {
    return Redirect.find({}).select('fromPath toPath').limit(limit).lean();
  }

  findOneByPath(fromPath) {
    return Redirect.findOne({ fromPath }).select('toPath').lean();
  }

  /** Idempotent: one row per path, the target overwritten in place. */
  upsertMany(fromPaths, { toPath, source, note, createdBy }) {
    return Redirect.bulkWrite(fromPaths.map((fromPath) => ({
      updateOne: {
        filter: { fromPath },
        update: { $set: { toPath, source, note }, $setOnInsert: { createdBy } },
        upsert: true,
      },
    })), { ordered: false });
  }

  deleteByPaths(fromPaths, source) {
    return Redirect.deleteMany({ fromPath: { $in: fromPaths }, ...(source && { source }) });
  }
}

export default new RedirectRepository();
