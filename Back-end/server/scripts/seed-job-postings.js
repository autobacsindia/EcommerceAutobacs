/**
 * Seed the 8 careers roles that used to be hardcoded in the frontend MARKUP
 * (Front-end/web/src/app/careers/CareersApplication.tsx) into the JobPosting
 * collection, so the API-driven /careers page is populated the moment Phase 2
 * ships. Content is copied verbatim from the old cards.
 *
 * Idempotent — upserts by slug, so re-running only refreshes copy and never
 * duplicates. Existing status/sortOrder are preserved on re-run (we only $set
 * on insert for those) so an admin's later edits/reordering survive a re-seed.
 *
 * Usage:
 *   node scripts/seed-job-postings.js            # dry run (prints plan, no writes)
 *   node scripts/seed-job-postings.js --apply    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import JobPosting from '../models/JobPosting.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const ROLES = [
  {
    slug: 'marketing-manager',
    department: 'Marketing',
    title: 'Marketing Manager',
    tagline: 'Own the story. Own the growth.',
    experience: '3-5 years exp',
    intro: "We didn't build a brand. We're building a category. Someone needs to own how India hears about it.",
    responsibilities: [
      'The entire marketing engine — strategy, calendar, budget, results. No committee. Your call, your numbers.',
      'Every campaign from Meta to ground activations — built, launched, measured, fixed.',
      "The SOPs that don't exist yet. If there's no process, you write one.",
      'The line between "looks good" and "drives revenue." You live on the revenue side.',
    ],
    requirements: [
      '3-5 years running marketing that moved a P&L, not just a feed.',
      "Someone who's built a system before — a funnel, a content engine, a launch playbook — and can prove it still runs.",
      'Sharp instincts for premium, automotive-adjacent, or D2C audiences.',
      "You don't wait for a brief. You write the brief.",
    ],
    closer: 'We are the first mover in a category nobody has packaged for India yet. How we tell that story decides how fast we scale.',
  },
  {
    slug: 'business-development-executive',
    department: 'Business Development',
    title: 'Business Development Executive',
    tagline: 'Hunt the deals. Build the pipeline. Close the gap.',
    experience: '2-4 years exp',
    intro: 'Global brands. Indian customers. Someone has to go get the partnerships that make that bridge real.',
    responsibilities: [
      'New brand and supplier relationships — sourced, pitched, signed, by you.',
      'Your own pipeline, your own targets, your own follow-through. No hand-holding, no hand-offs.',
      'Installation partner and dealer network expansion across new cities.',
      'The negotiation room. You walk in, you walk out with terms that work for us.',
    ],
    requirements: [
      '2-4 years in B2B sales, partnerships, or business development — automotive, retail, or D2C preferred.',
      "Comfortable cold-opening a conversation with someone who's never heard of us.",
      'Numbers-driven. You know your conversion rate without checking.',
      'Thrives without a script. Builds one instead.',
    ],
    closer: 'Every brand we bring in, every partner we sign, is one more piece of "the moment" we\'re building. You\'re the one closing it.',
  },
  {
    slug: 'operations-executive',
    department: 'Operations',
    title: 'Operations Executive',
    tagline: 'Make the chaos run on time.',
    experience: '2-4 years exp',
    intro: 'Products from Thailand, Japan, Italy, USA. Customers across every pin code in India. Someone has to make that machine run without dropping a single order.',
    responsibilities: [
      'End-to-end order flow — sourcing to delivery to installation.',
      'The SOPs for fulfillment, logistics, and installation scheduling.',
      'Vendor and installation-partner coordination across India.',
      "The fire-drills. When something goes wrong at 9pm, you're already solving it.",
    ],
    requirements: [
      '2-4 years in operations, logistics, or supply chain — e-commerce or automotive a strong plus.',
      'High tolerance for ambiguity, low tolerance for excuses.',
      'Process-obsessed. You see a recurring problem and build a system so it never recurs again.',
      "Calm under pressure. We move fast — you make sure fast doesn't mean broken.",
    ],
    closer: '"Delivered like it was next door" is our promise. You\'re the one who keeps it.',
  },
  {
    slug: 'jr-accounts-finance-executive',
    department: 'Finance',
    title: 'Jr. Accounts & Finance Executive',
    tagline: 'Keep the numbers honest. Keep the company fundable.',
    experience: '1-3 years exp',
    intro: "We're scaling toward an IPO. That starts with books that are clean from day one — not cleaned up later.",
    responsibilities: [
      'Day-to-day bookkeeping, invoicing, reconciliations, and vendor payments.',
      'GST, TDS, and compliance filings, coordinated with our CA.',
      'The financial SOPs that scale with us — not the ones that fall apart at 2x volume.',
      'Early visibility into cash flow and costs, flagged before they become problems.',
    ],
    requirements: [
      '1-3 years in accounts/finance — Tally or Zoho Books experience preferred.',
      'Commerce graduate (CA-Inter or pursuing is a plus, not a requirement).',
      'Detail-obsessive. A mismatched entry bothers you more than it should.',
      'Trustworthy with numbers nobody else is watching.',
    ],
    closer: 'Every funding conversation, every audit, every investor question comes back to the books. You\'re building the foundation for all of it.',
  },
  {
    slug: 'content-strategist',
    department: 'Content',
    title: 'Content Strategist',
    tagline: 'Build the world people fall in love with.',
    experience: '2-4 years exp',
    intro: "We're not running ads. We're building a universe — Instagram, comics, campaigns, culture. Someone needs to own where that goes next.",
    responsibilities: [
      'The content calendar and creative direction across Instagram, Meta ads, and emerging formats.',
      'Original IP — like our comic series — from concept to publish, on schedule, every time.',
      'The brand voice. You decide what sounds like us and what doesn\'t.',
      "Performance, not just aesthetics. If it doesn't move the needle, you fix it or kill it.",
    ],
    requirements: [
      '2-4 years creating content that built an audience, not just posted to one.',
      'A portfolio that shows range — copy, concept, campaign thinking, not just captions.',
      'Strong instinct for automotive, gearhead, or premium lifestyle culture.',
      "You pitch ideas nobody asked for, because you already know they'll work.",
    ],
    closer: "We're educating a market from scratch. The content you build is often the first real exposure someone has to this category. That's not small.",
  },
  {
    slug: 'procurement-executive',
    department: 'Procurement',
    title: 'Procurement Executive',
    tagline: 'Source it right. Source it real.',
    experience: '2-4 years exp',
    intro: 'Verified authentic. Globally sourced. Locally delivered. That promise lives or dies in procurement.',
    responsibilities: [
      'Supplier sourcing and vetting across Thailand, Japan, Italy, USA, and beyond.',
      'Pricing negotiations, purchase orders, and import logistics — start to finish.',
      "The authenticity standard. Nothing ships that you haven't verified.",
      'Supplier relationships built for the next five years, not the next one.',
    ],
    requirements: [
      '2-4 years in procurement, sourcing, or import/export — automotive parts or international trade a strong plus.',
      'Comfortable navigating customs, documentation, and cross-border vendor relationships.',
      'Negotiates hard, but builds trust that lasts.',
      "Treats every sourcing decision like it's their own money on the line.",
    ],
    closer: '"Verified authentic" is the entire reason customers trust us over a workshop guess. You\'re the one who makes that true.',
  },
  {
    slug: 'talent-acquisition-people-generalist',
    department: 'People & Talent',
    title: 'Talent Acquisition & People Generalist',
    tagline: "Hire people who don't need to be managed.",
    experience: '2-4 years exp',
    intro: "We don't hire for titles — and we don't build a culture that needs constant oversight either. This role exists to find people who own their work, and to build the systems that let them keep owning it.",
    responsibilities: [
      'The full hiring pipeline — sourcing, screening, founder-round coordination, offer, close.',
      "The bar at the door. You're the first filter for ownership over execution.",
      'People operations end-to-end — onboarding, policies, documentation, compliance — built lean, not bureaucratic.',
      'Hiring and people SOPs that scale with us — written once, improved every cycle, never frozen in place.',
    ],
    requirements: [
      '2-4 years across talent acquisition and HR generalist work — startup or high-growth environment strongly preferred.',
      "A track record of closing candidates other companies couldn't, not just filling reqs.",
      'Sharp judgment for substance over polish.',
      'Fast and decisive. A slow pipeline costs us the best people.',
    ],
    closer: 'Every other role on this page runs through you first. The kind of company we become in five years is decided by who you let in today.',
  },
  {
    slug: 'ui-ux-designer',
    department: 'Design',
    title: 'UI/UX Designer',
    tagline: 'Design an experience worthy of the customer we serve.',
    experience: '2-4 years exp',
    intro: "Our customer isn't browsing. They already own something premium and expect everything around it — including how they buy — to match.",
    responsibilities: [
      'The end-to-end experience across our site, app, and checkout — researched, designed, shipped, measured.',
      'Every screen between "curious" and "ordered," held to a premium standard.',
      'Design systems and component libraries — built once, built right, reused everywhere.',
      'The handoff to engineering — clean, documented, no guesswork left for someone else to fill in.',
    ],
    requirements: [
      '2-4 years designing for premium, luxury, or high-consideration e-commerce.',
      'Fluent in Figma, prototyping, and design systems.',
      "An eye for restraint. Premium isn't more — it's deliberate.",
      'Data-informed, not just opinion-driven.',
    ],
    closer: "We're building the digital front door for India's premium automotive culture. It has to look like where it belongs.",
  },
];

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[seed-job-postings] connected');
}

async function run() {
  await connect();

  const ops = ROLES.map((role, i) => ({
    updateOne: {
      filter: { slug: role.slug },
      update: {
        // Copy fields refresh on every run.
        $set: {
          department: role.department,
          title: role.title,
          tagline: role.tagline,
          experience: role.experience,
          intro: role.intro,
          responsibilities: role.responsibilities,
          requirements: role.requirements,
          closer: role.closer,
        },
        // Set once on insert; an admin's later status/order/seo edits survive re-seed.
        $setOnInsert: {
          slug: role.slug,
          status: 'open',
          sortOrder: i + 1,
          employmentType: 'FULL_TIME',
          publishedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  if (!APPLY) {
    const existing = await JobPosting.countDocuments({ slug: { $in: ROLES.map((r) => r.slug) } });
    console.log(`[seed-job-postings] DRY RUN — ${ROLES.length} roles, ${existing} already present.`);
    console.log('  Re-run with --apply to write. Copy fields refresh; status/order/seo preserved on existing rows.');
    await mongoose.disconnect();
    return;
  }

  const res = await JobPosting.bulkWrite(ops, { ordered: false });
  console.log(`[seed-job-postings] upserted=${res.upsertedCount} modified=${res.modifiedCount} matched=${res.matchedCount}`);
  await mongoose.disconnect();
  console.log('[seed-job-postings] done');
}

run().catch((err) => {
  console.error('[seed-job-postings] failed:', err);
  process.exit(1);
});
