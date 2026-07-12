import mongoose from "mongoose";

/**
 * Generic named atomic counter.
 *
 * Used for monotonic sequences that must never collide under concurrency — the
 * invoice number series is the first consumer. `next()` is a single atomic
 * `findByIdAndUpdate($inc)`, so parallel callers each get a distinct value with
 * no read-modify-write race.
 *
 * Seeding: set `seq` to the LAST issued value; the next `next()` returns seq+1.
 * See scripts/seed-invoice-counter.js.
 */
const CounterSchema = new mongoose.Schema(
  {
    _id: { type: String }, // counter name, e.g. "invoice"
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

/**
 * Atomically increment and return the next value for a named counter.
 * Creates the counter (starting the series at 1) if it does not yet exist.
 * @param {string} name - counter name
 * @returns {Promise<number>} the next sequence value
 */
CounterSchema.statics.next = async function next(name) {
  const doc = await this.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
};

export default mongoose.models.Counter || mongoose.model("Counter", CounterSchema);
