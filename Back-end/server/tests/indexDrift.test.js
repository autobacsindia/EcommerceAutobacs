import mongoose from 'mongoose';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import * as dbHandler from './db-handler.js';

/**
 * Drift guard.
 *
 * `autoIndex` is off in production (config/db.js), so schema index changes are
 * never applied automatically and nothing was verifying the result. Production
 * drifted for months and it cost a live bug: two TTL indexes on
 * `carts.recentChanges` (300s) existed in the database but in no schema, and a
 * TTL index over an array of dates deletes the WHOLE document — so shoppers'
 * carts were being erased five minutes after a stock adjustment.
 *
 * These tests can't see production. What they CAN do is catch the two classes of
 * mistake that made that bug possible, at authoring time:
 *   1. a TTL index declared over a subdocument-array path (never works as
 *      intended, always deletes the parent document),
 *   2. a TTL index with no partial filter on a collection holding records we
 *      must never auto-delete.
 *
 * Reconciling against a real cluster is scripts/audit-index-drift.js.
 */

const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');

/** Collections whose documents must never be deleted by a blanket TTL. */
const NEVER_BLANKET_TTL = new Set(['Cart', 'Order', 'User', 'Payment', 'ReturnRequest']);

beforeAll(async () => {
  const entries = readdirSync(MODELS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    await import(pathToFileURL(path.join(MODELS_DIR, entry.name)).href);
  }
});

describe('schema index hygiene', () => {
  const eachModel = () => Object.entries(mongoose.models);

  it('loads the models', () => {
    expect(eachModel().length).toBeGreaterThan(20);
  });

  it('declares no TTL index over a subdocument-array path', () => {
    const offenders = [];

    for (const [name, model] of eachModel()) {
      for (const [key, opts] of model.schema.indexes()) {
        if (opts?.expireAfterSeconds == null) continue;

        for (const field of Object.keys(key)) {
          // A dotted path means we're indexing inside a nested structure. If the
          // first segment is an array in the schema, the TTL monitor uses the
          // MINIMUM date in that array and deletes the parent document.
          if (!field.includes('.')) continue;
          const [head] = field.split('.');
          const schemaPath = model.schema.path(head);
          const isArray = schemaPath?.instance === 'Array' || Array.isArray(schemaPath?.options?.type);
          if (isArray) {
            offenders.push(`${name}: TTL on "${field}" (inside array "${head}") deletes the whole document`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('gives every TTL index on a business collection a partial filter', () => {
    const offenders = [];

    for (const [name, model] of eachModel()) {
      if (!NEVER_BLANKET_TTL.has(name)) continue;

      for (const [key, opts] of model.schema.indexes()) {
        if (opts?.expireAfterSeconds == null) continue;
        if (!opts.partialFilterExpression) {
          offenders.push(`${name}: TTL on ${JSON.stringify(key)} has no partialFilterExpression`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('scopes the Cart TTL to guest carts so a user cart can never expire', () => {
    const ttls = mongoose.models.Cart.schema
      .indexes()
      .filter(([, opts]) => opts?.expireAfterSeconds != null);

    expect(ttls).toHaveLength(1);
    const [key, opts] = ttls[0];
    expect(key).toEqual({ updatedAt: 1 });
    // `$type`, not `$ne: null` — MongoDB rejects `$ne` in a partial filter, which
    // is how the Cart indexes silently failed to build in the first place.
    expect(opts.partialFilterExpression).toEqual({ sessionId: { $type: 'string' } });
  });

  // `sparse` skips only ABSENT fields, but `default: null` guarantees the field is
  // PRESENT holding null — so under `unique` every "no value" row collides. This
  // shipped on SupportMessage.messageId (index never built, so the Postmark
  // webhook-replay guard did not exist) and on InboundEmail.messageId/fingerprint
  // (built only because the collection was empty; the SECOND header-less email
  // would have thrown E11000 and stopped ticket ingestion). Static check, because
  // both failure modes are silent until real data arrives.
  it('never pairs a sparse UNIQUE index with a `default: null` field', () => {
    // Scoped to `unique` deliberately. Without it, `sparse` on a `default: null`
    // field is merely INEFFECTIVE — every row is indexed anyway, costing a little
    // space but breaking nothing (11 such indexes exist today, all harmless).
    // Add `unique` and it becomes a defect: every null collides.
    const offenders = [];

    for (const [name, model] of Object.entries(mongoose.models)) {
      for (const [key, opts] of model.schema.indexes()) {
        if (!opts?.sparse || !opts?.unique) continue;
        for (const field of Object.keys(key)) {
          if (model.schema.path(field)?.options?.default === null) {
            offenders.push(
              `${name}.${field} — sparse+unique index on a \`default: null\` field. ` +
              `sparse skips only ABSENT fields, so every null row is indexed and ` +
              `collides. Use partialFilterExpression: { ${field}: { $type: ... } }.`
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps RateLimitEvent lean — telemetry must not out-index the catalogue', () => {
    // This collection reached 13 indexes / 334 MB, 95% of the database's entire
    // index footprint, serving aggregations that never ran. Every index here is
    // maintained on every insert, so adding one is a measured decision.
    const indexes = mongoose.models.RateLimitEvent.schema.indexes();
    expect(indexes.length).toBeLessThanOrEqual(2);
  });
});

describe('declared indexes are buildable', () => {
  // Catches a malformed spec (bad option, illegal key) that would only surface
  // the first time someone ran the migration against a real cluster.
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => { await dbHandler.closeDatabase(); });

  it('builds every schema index against a real MongoDB', async () => {
    const failures = [];

    for (const [name, model] of Object.entries(mongoose.models)) {
      try {
        await model.createCollection();
        await model.syncIndexes();
      } catch (err) {
        failures.push(`${name}: ${err.message}`);
      }
    }

    expect(failures).toEqual([]);
  }, 120000);
});
