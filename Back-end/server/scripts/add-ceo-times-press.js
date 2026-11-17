/**
 * Add the CEO Times feature (Nov 2026) as a FEATURED press card.
 *
 * Shows on the public /media page and in the home page "As featured in" strip.
 * The card links OUT to CEO Times — we never copy their article text; the excerpt
 * below is our own summary.
 *
 * Insert-only and idempotent: keyed on the article URL. If a card with that URL
 * already exists (re-run, or someone added it in /admin/media), nothing is
 * changed — so this can never overwrite an admin's edits. Use /admin/media to
 * edit the card afterwards.
 *
 * ORDER OF OPERATIONS: deploy the frontend first. The photo is served from the
 * website itself (Front-end/web/public/images/press/), so running this before
 * the deploy would show a broken image until it lands.
 *
 * Usage (dry run by default):
 *   railway run node scripts/add-ceo-times-press.js           # show what would happen
 *   railway run node scripts/add-ceo-times-press.js --apply   # insert it
 *
 * Rollback: delete the card in /admin/media, or
 *   db.presscoverages.deleteOne({ url: "<CARD.url below>" })
 */

import mongoose from 'mongoose';
import PressCoverage from '../models/PressCoverage.js';
import cacheService from '../services/cacheService.js';
import { revalidateFrontendTags } from '../services/frontendRevalidator.js';
import { pressTags } from '../utils/nextTags.js';

const APPLY = process.argv.includes('--apply');

const CARD = {
  publication: 'CEO Times',
  date: 'NOV 11, 2026',
  headline: 'From a Kerala Garage to a National Platform: How Autobacs India Is Engineering India’s Automotive Aftermarket',
  excerpt:
    'CEO Times looks at how Autobacs India grew from a Bangkok trading desk and a single Kerala workshop in 2015 into a platform '
    + 'supplying imported aftermarket parts across 24 states. The feature covers our move from running workshops to a systems-led '
    + 'model, the technology we build in-house, and the sourcing work that cut shipment lead times from 8–10 weeks to 3–4.',
  url: 'https://ceotimes.com/from-a-kerala-garage-to-a-national-platform-how-autobacs-india-is-engineering-indias-automotive-aftermarket/',
  image: '/images/press/ceo-times-autobacs-team.webp',
  featured: true,
  order: -1, // ahead of the seeded cards (0…n)
  status: 'published',
};

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ceo-times] MONGODB_URI (or MONGO_URI) not set');
    process.exit(1);
  }
  // autoIndex:false — merely connecting must never build indexes on prod.
  await mongoose.connect(uri, { autoIndex: false });

  const existing = await PressCoverage.findOne({ url: CARD.url }).select('_id headline featured status').lean();
  if (existing) {
    console.log(`[ceo-times] already present (${existing._id}, ${existing.status}, featured=${existing.featured}) — nothing to do.`);
  } else if (!APPLY) {
    console.log('[ceo-times] DRY RUN — would insert:\n', CARD, '\nRe-run with --apply to insert.');
  } else {
    const doc = await PressCoverage.create(CARD);
    console.log(`[ceo-times] inserted ${doc._id}`);
    // Same purge the admin routes do: backend response cache + storefront strip.
    await cacheService.invalidateTags('media:press');
    await cacheService.invalidatePattern('media:press');
    await revalidateFrontendTags(pressTags());
    console.log('[ceo-times] caches purged. Rollback: delete it in /admin/media, or');
    console.log(`  db.presscoverages.deleteOne({ _id: ObjectId("${doc._id}") })`);
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('[ceo-times] failed:', err);
  process.exit(1);
});
