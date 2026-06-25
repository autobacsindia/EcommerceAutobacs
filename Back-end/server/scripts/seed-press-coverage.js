/**
 * Seed Press Coverage cards (public /media page).
 *
 * Idempotent: upserts by (publication + headline), so re-running updates existing
 * rows instead of duplicating. Safe to run repeatedly.
 *
 * Usage:
 *   npm run seed-press
 *   # against Railway prod:  railway run npm run seed-press
 *
 * Requires MONGODB_URI (or MONGO_URI) in the environment.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PressCoverage from '../models/PressCoverage.js';
import cloudinary from '../config/cloudinary.js';

dotenv.config();

// Rehost a remote (WordPress) image onto Cloudinary so the public page never
// depends on the old WP host. Idempotent: a stable public_id derived from the
// filename means re-runs overwrite the same asset instead of duplicating.
// On failure we fall back to the original URL so the card still renders.
async function rehostImage(url) {
  if (!url) return '';
  if (url.includes('res.cloudinary.com')) return url; // already on Cloudinary
  const base = url.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  try {
    const res = await cloudinary.uploader.upload(url, {
      folder: 'press-coverage',
      public_id: base,
      overwrite: true,
      resource_type: 'image',
    });
    console.log(`[seed-press]   ↳ rehosted ${base} → Cloudinary`);
    return res.secure_url;
  } catch (err) {
    console.warn(`[seed-press]   ⚠ Cloudinary upload failed for ${base} (${err.message}); keeping WP URL`);
    return url;
  }
}

const CARDS = [
  {
    publication: 'USA News',
    date: 'MAR 2, 2026',
    headline: 'Autobacs India Revolutionizing the Automotives',
    excerpt: 'Within the landscape, Autobacs has positioned itself with a focus on structural organization and process alignment.',
    url: 'https://usanews.com/newsroom/how-autobacs-india-is-structuring-the-automotive-aftermarket',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/usa-news.png',
    tilt: -1.4, tape: 'left',
  },
  {
    publication: 'ANI News',
    date: 'MAR 13, 2026',
    headline: 'Vision is Clear Build A Network',
    excerpt: 'Our objective has been to bring structure and transparency to a fragmented segment of the automotive aftermarket.',
    url: 'https://www.aninews.in/news/business/bootstrapped-aftermarket-platform-autobacs-india-crosses-1m-revenue-targets-100-national-installation-network20260313150821/',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/ANI.jpg',
    tilt: -1.4, tape: 'left',
  },
  {
    publication: 'News 18',
    date: 'MAR 24, 2025',
    headline: 'DC Comics Inspired Ford Endeavour',
    excerpt: 'Autobacs showing modification work is not limited to wide tyres or Raptor inspired grille, but there’s a lot going beneath the bodywork too.',
    url: 'https://www.news18.com/news/auto/this-modified-ford-endeavour-monster-suv-is-inspired-from-a-dc-comics-supervillain-1893589.html',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/NEWS18.jpg',
    tilt: -1.4, tape: 'left',
  },
  {
    publication: 'Blunt Times',
    date: 'FEB 25, 2026',
    headline: 'Indias Largest Premium Importer Aftermarket Car Platforms',
    excerpt: 'Began as a modest garage in Kollam, Kerala, has today evolved into one of the most structured premium aftermarket automotive platforms.',
    url: 'https://theblunttimes.in/autobacs-india-emerges-as-a-structured-national-platform-in-indias-premium-aftermarket-automotive-sector/58886/',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/blunttimes.jpg',
    tilt: -1.4, tape: 'left',
  },
  {
    publication: 'Business Standard',
    date: 'MAR 24, 2025',
    headline: 'Autobacs India Crosses $1M Revenue, Targets a 100+ Installation Network',
    excerpt: 'The bootstrapped platform under Roavion Automotive Pvt. Ltd. hits a key milestone and sets out to grow its national install footprint to 100+ partner locations.',
    url: 'https://www.business-standard.com/content/press-releases-ani/bootstrapped-aftermarket-platform-autobacs-india-crosses-1m-revenue-targets-100-national-installation-network-126031300664_1.html',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/Businessstandard.jpg',
    tilt: -1.4, tape: 'left',
    featured: true,
  },
  {
    publication: 'ThePrint',
    date: 'MAR 13, 2026',
    headline: 'Bootstrapped Aftermarket Platform Autobacs India Crosses $1M Revenue',
    excerpt: 'Built on OEM-aligned imports, diversified global sourcing and standardized national pricing, the platform marks a key revenue milestone while staying profitable.',
    url: 'https://www.business-standard.com/content/press-releases-ani/bootstrapped-aftermarket-platform-autobacs-india-crosses-1m-revenue-targets-100-national-installation-network-126031300664_1.html',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/theprint.png',
    tilt: 1.1, tape: 'center',
  },
  {
    publication: 'Dailyhunt',
    date: '2026',
    headline: 'The Journey of Sachin Thankaraj & Autobacs India',
    excerpt: 'How a personal passion for automobiles became Roavion Automotive — building bridges between global automotive innovation and India’s growing enthusiast community.',
    url: 'https://m.dailyhunt.in/news/india/english/thebusinessstories-epaper-dh81e4e6e2104e4dbbb7f32ee26194cfb7/-newsid-dh81e4e6e2104e4dbbb7f32ee26194cfb7_ed856bc3b5434d2c8132a23e2f86cef3?sm=Y',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/dailyhunt.png',
    tilt: -0.8, tape: 'right',
  },
  {
    publication: 'BrandValley Times',
    date: 'APR 8, 2026',
    headline: 'Autobacs India Positions a Structured Import Model as the Premium Aftermarket Formalizes',
    excerpt: 'A structured import model aimed at bringing consistency, quality and global standards to car enthusiasts and workshops across the country.',
    url: 'https://www.sangritoday.com/brandvalley/marketing/autobcs-indi-positions-structured-import-model-s-indis-premium-aftermrket-formlizes',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/brandvalley.jpg',
    tilt: 1.3, tape: 'center',
  },
  {
    publication: 'The Indian Post',
    date: 'APR 8, 2026',
    headline: 'Structured Import Model as India’s Premium Aftermarket Formalizes',
    excerpt: 'With premium vehicle ownership rising, structured supply platforms are beginning to define the next stage of India’s automotive ecosystem.',
    url: 'https://theindianpost.co.in/autobacs-india-positions-structured-import-model-as-indias-premium-aftermarket-formalizes/',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/indianpost.jpg',
    tilt: -1.2, tape: 'left',
  },
  {
    publication: 'My Nation',
    date: 'APR 8, 2026',
    headline: 'India’s Premium Aftermarket Formalizes Around Structured Platforms',
    excerpt: 'Profitable and entirely bootstrapped, Autobacs India crosses the $1M revenue milestone as structured import platforms emerge across the sector.',
    url: 'https://www.mynation.com/business/autobacs-india-positions-structured-import-model-as-indias-premium-aftermarket-formalizes-articleshow-u4yglag',
    image: 'https://autobacsindia.com/wp-content/uploads/2026/06/my-nation.jpg',
    tilt: 0.9, tape: 'center',
  },
];

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[seed-press] connected');

  let created = 0;
  let updated = 0;
  for (let i = 0; i < CARDS.length; i++) {
    console.log(`[seed-press] (${i + 1}/${CARDS.length}) ${CARDS[i].publication} — ${CARDS[i].headline}`);
    const image = await rehostImage(CARDS[i].image);
    const card = { ...CARDS[i], image, order: i, status: 'published' };
    const res = await PressCoverage.updateOne(
      { publication: card.publication, headline: card.headline },
      { $set: card },
      { upsert: true }
    );
    if (res.upsertedCount) created++;
    else if (res.modifiedCount) updated++;
  }

  const total = await PressCoverage.countDocuments();
  console.log(`[seed-press] done — created ${created}, updated ${updated}, total now ${total}`);

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('[seed-press] failed:', err);
  process.exit(1);
});
