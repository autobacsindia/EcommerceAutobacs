/**
 * `messageId` / `fingerprint` unique-index regression test.
 *
 * THE BUG
 * -------
 * `SupportMessage.messageId`, `InboundEmail.messageId` and
 * `InboundEmail.fingerprint` were all declared `unique + sparse` while the
 * fields are `default: null`. Those two are incompatible: `default: null` means
 * the field is PRESENT holding null, and `sparse` skips only ABSENT fields — so
 * every null was indexed and collided under `unique`.
 *
 * Consequences, both silent:
 *   • supportmessages — 17 explicit nulls in production, so createIndex failed
 *     with E11000 and the index NEVER EXISTED. The idempotency guard that stops
 *     a replayed Postmark webhook appending the same reply twice was absent.
 *   • inboundemails — built cleanly only because the collection is empty. The
 *     SECOND inbound email with no Message-ID would have thrown E11000 and
 *     killed ingestion, at go-live, in production.
 *
 * The fix is `partialFilterExpression: { field: { $type: 'string' } }`. These
 * tests pin the behaviour that distinguishes it from `sparse`: MANY nulls must
 * coexist while real duplicate ids are still rejected.
 */

import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import SupportMessage from '../models/SupportMessage.js';
import InboundEmail from '../models/InboundEmail.js';
import supportMessageRepository, {
  messageIdFilter,
  messageIdInFilter,
} from '../repositories/supportMessageRepository.js';

const MSG_ID = '<abc123@mail.example.com>';

const message = (overrides = {}) => ({
  ticket: new mongoose.Types.ObjectId(),
  direction: 'inbound',
  body: 'hello',
  ...overrides,
});

function chosenIndex(explain) {
  const plan = JSON.stringify(explain.queryPlanner.winningPlan);
  if (plan.includes('COLLSCAN')) return 'COLLSCAN';
  return (plan.match(/"indexName":"([^"]+)"/) || [])[1] || 'UNKNOWN';
}

beforeAll(async () => {
  await dbHandler.connect();
  // The whole point: these must BUILD. Under the old sparse+default:null
  // declaration this call is what failed in production.
  await SupportMessage.syncIndexes();
  await InboundEmail.syncIndexes();
});

afterAll(async () => {
  await dbHandler.closeDatabase();
});

describe('SupportMessage.messageId', () => {
  it('allows MANY messages with no Message-ID (the sparse bug)', async () => {
    // In-app messages — web form, admin reply drafted in the UI — have none.
    // Under unique+sparse the second of these threw E11000.
    await SupportMessage.create(message());
    await SupportMessage.create(message());
    await SupportMessage.create(message({ messageId: null }));
    expect(await SupportMessage.countDocuments({ messageId: null })).toBe(3);
  });

  it('still rejects a duplicate REAL Message-ID (webhook replay)', async () => {
    await SupportMessage.create(message({ messageId: MSG_ID }));
    await expect(
      SupportMessage.create(message({ messageId: MSG_ID }))
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('messageIdFilter uses the index rather than scanning', async () => {
    await SupportMessage.create(message({ messageId: MSG_ID }));
    const explain = await SupportMessage.findOne(messageIdFilter(MSG_ID)).explain('executionStats');
    expect(chosenIndex(explain)).toBe('messageId_1');
  });

  it('messageIdInFilter matches real ids and never a null row', async () => {
    await SupportMessage.create(message({ messageId: MSG_ID }));
    await SupportMessage.create(message());
    const found = await SupportMessage.find(messageIdInFilter([MSG_ID, null]));
    expect(found).toHaveLength(1);
    expect(found[0].messageId).toBe(MSG_ID);
  });
});

// The repository methods are the real production entry points for these filters —
// the E11000 recovery path in ticketService and the inbound threading lookup both
// go through them. Testing only the filter builders would leave the wiring unproven.
describe('supportMessageRepository wiring', () => {
  it('existsByMessageId finds a stored real id', async () => {
    await SupportMessage.create(message({ messageId: MSG_ID }));
    expect(await supportMessageRepository.existsByMessageId(MSG_ID)).toBe(true);
  });

  it('existsByMessageId is false for an unseen id', async () => {
    expect(await supportMessageRepository.existsByMessageId('<nope@x>')).toBe(false);
  });

  // Guard against the filter accidentally matching null rows: a null messageId
  // must never be reported as "already stored", or a real inbound reply would be
  // silently dropped as a duplicate.
  it('existsByMessageId does not match null-messageId rows', async () => {
    await SupportMessage.create(message());
    expect(await supportMessageRepository.existsByMessageId(null)).toBe(false);
  });

  it('findByAnyMessageId threads a reply via In-Reply-To', async () => {
    const created = await SupportMessage.create(message({ messageId: MSG_ID }));
    const hit = await supportMessageRepository.findByAnyMessageId([MSG_ID]);
    expect(hit._id.toString()).toBe(created._id.toString());
  });

  it('findByAnyMessageId still threads via the references array', async () => {
    // The $or's second branch — must keep working now the first restates $type.
    const created = await SupportMessage.create(message({ references: [MSG_ID] }));
    const hit = await supportMessageRepository.findByAnyMessageId([MSG_ID]);
    expect(hit._id.toString()).toBe(created._id.toString());
  });

  it('findByAnyMessageId returns null when nothing matches', async () => {
    await SupportMessage.create(message());
    expect(await supportMessageRepository.findByAnyMessageId(['<unknown@x>'])).toBeNull();
  });
});

describe('InboundEmail replay safety', () => {
  const email = (overrides = {}) => ({ payload: {}, ...overrides });

  it('allows many payloads with no Message-ID and no fingerprint', async () => {
    // This is the case that would have broken ingestion on the SECOND email.
    await InboundEmail.create(email());
    await InboundEmail.create(email());
    expect(await InboundEmail.countDocuments({})).toBe(2);
  });

  it('still dedupes by Message-ID', async () => {
    await InboundEmail.create(email({ messageId: MSG_ID }));
    await expect(InboundEmail.create(email({ messageId: MSG_ID })))
      .rejects.toMatchObject({ code: 11000 });
  });

  it('still dedupes by fingerprint when there is no Message-ID', async () => {
    await InboundEmail.create(email({ fingerprint: 'sha-deadbeef' }));
    await expect(InboundEmail.create(email({ fingerprint: 'sha-deadbeef' })))
      .rejects.toMatchObject({ code: 11000 });
  });
});

describe('drift guard — sparse must never come back', () => {
  const MODELS = { SupportMessage, InboundEmail };

  it.each([
    ['SupportMessage', 'messageId'],
    ['InboundEmail', 'messageId'],
    ['InboundEmail', 'fingerprint'],
  ])('%s.%s is partial-on-$type, not sparse', (modelName, field) => {
    const entry = MODELS[modelName].schema.indexes().find(([key]) => key[field] === 1);
    expect(entry).toBeDefined();
    const [, opts] = entry;
    expect(opts.unique).toBe(true);
    expect(opts.sparse).toBeUndefined();
    expect(opts.partialFilterExpression).toEqual({ [field]: { $type: 'string' } });
  });
});
