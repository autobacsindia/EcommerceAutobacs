/**
 * Base Repository — common database operations.
 *
 * Every mutating method accepts an optional `session` (mongoose.ClientSession).
 * When provided, the operation participates in the caller's transaction.
 * When omitted, it runs as a standalone operation (backwards-compatible).
 *
 * Requires a MongoDB replica set for transactions (Atlas always qualifies;
 * local dev needs `--replSet rs0` or mongo-memory-server replicaSet mode).
 */

class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async find(query, options = {}) {
    const {
      limit = 0,
      skip = 0,
      sort = { createdAt: -1 },
      populate = [],
      select = null,
      session = null
    } = options;

    let q = this.model.find(query).lean();

    if (session) q = q.session(session);
    if (select)  q = q.select(select);

    populate.forEach(pop => {
      q = q.populate(pop.path, pop.select);
    });

    return q.sort(sort).skip(skip).limit(limit);
  }

  async findById(id, populate = [], session = null) {
    let q = this.model.findById(id);

    if (session) q = q.session(session);

    populate.forEach(pop => {
      q = q.populate(pop.path, pop.select);
    });

    return q;
  }

  async findOne(query, populate = [], session = null) {
    let q = this.model.findOne(query);

    if (session) q = q.session(session);

    populate.forEach(pop => {
      q = q.populate(pop.path, pop.select);
    });

    return q;
  }

  async count(query = {}, session = null) {
    let q = this.model.countDocuments(query);
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Create a single document, optionally inside a session.
   * Model.create([data], { session }) returns an array; we unwrap it.
   */
  async create(data, session = null) {
    if (session) {
      const [doc] = await this.model.create([data], { session });
      return doc;
    }
    return this.model.create(data);
  }

  async update(id, updateData, options = {}) {
    const { session, ...rest } = options;
    return this.model.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      ...rest,
      ...(session && { session })
    });
  }

  async delete(id, session = null) {
    return this.model.findByIdAndDelete(id, session ? { session } : {});
  }

  /**
   * Batched writes in a single round-trip. `operations` is a standard Mongo
   * bulkWrite array (updateOne/insertOne/…). No-op on an empty array so callers
   * don't have to guard. Unordered by default — one failing op doesn't abort the
   * rest — override via `options.ordered`.
   */
  async bulkWrite(operations, options = {}) {
    if (!operations || operations.length === 0) return null;
    return this.model.bulkWrite(operations, { ordered: false, ...options });
  }

  async exists(id, session = null) {
    let q = this.model.countDocuments({ _id: id });
    if (session) q = q.session(session);
    const count = await q;
    return count > 0;
  }

  async aggregate(pipeline, session = null) {
    const q = this.model.aggregate(pipeline);
    if (session) q.session(session);
    return q;
  }
}

export default BaseRepository;
