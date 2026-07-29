/**
 * Seed / refresh the Roavion careers roles into the JobPosting collection so the
 * API-driven /careers page is populated. Content is authored here; the admin
 * (/admin/careers) is the day-to-day editor.
 *
 * Idempotent — upserts by slug. On a re-run:
 *   - copy fields, `category`, and `sortOrder` are REFRESHED ($set), so this file
 *     stays the source of truth for the page's grouping + order. (An admin who
 *     manually reorders/re-categorises should therefore not expect a re-run to
 *     preserve those tweaks — re-running re-applies this layout.)
 *   - `status`, `seo`, and `publishedAt` are set only on first insert
 *     ($setOnInsert), so publish/close state + SEO overrides survive a re-run.
 *
 * Roles are listed in display order; array position drives sortOrder, and the
 * /careers page groups by `category` with section order following each
 * category's lowest sortOrder — i.e. the order below.
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
  // ── Leadership / Executive ─────────────────────────────────────────────────
  {
    slug: 'cmo',
    category: 'Leadership / Executive',
    department: 'Executive',
    title: 'CMO',
    tagline: 'Own how India sees us. Own the category narrative. Own the growth that starts with brand.',
    experience: '5-8 years exp',
    intro: "We didn't build a brand. We're building a category. That requires someone who thinks like a founder, not a marketer — someone who can stitch together strategy, content, paid, partnerships, and PR into one coherent narrative that cuts through noise and builds moats.",
    responsibilities: [
      'The entire brand and marketing architecture — from category positioning to channel strategy to measurement frameworks.',
      'Own the entire marketing pod — brand positioning, channel strategy, creative direction, and the measurement frameworks.',
      'Campaign strategy and execution at scale — integrated campaigns across paid, organic, ground, partnerships, and PR that compound over time.',
      "Team and agency leadership — building a marketing function that doesn't require the CMO to execute, but does require their vision in every decision.",
      'Brand narrative for fundraising and investor conversations — making the "why now, why us, why premium automotive" story investor-grade and compelling.',
    ],
    requirements: [
      "5-8 years leading marketing at a high-growth D2C or consumer brand — preferably someone who's scaled from $1M to $50M+ in revenue.",
      'Proven track record of building category narratives, not just running campaigns.',
      'Comfort with both strategy and execution — you can write the positioning document and know whether the Reel nails it.',
      "Builder mindset. You don't inherit playbooks; you write them. And you improve them every cycle.",
    ],
    closer: 'Why this matters: How we position ourselves now decides the market we own in 5 years. The CMO writes that story, then lives it across every touchpoint.',
  },
  {
    slug: 'coo',
    category: 'Leadership / Executive',
    department: 'Executive',
    title: 'COO',
    tagline: 'Make a category scale. Make it profitable. Make it predictable.',
    experience: '6-10 years exp',
    intro: "We have the brand, the supply chain, and the momentum. What we need is someone who can orchestrate all three at speed — one leader who owns how we go from good operations to operations that multiply. The COO isn't optimizing process; they're building the machine that scales without breaking.",
    responsibilities: [
      'The operational architecture across supply, fulfillment, installation, and customer delivery — from unit economics to network expansion.',
      'Scaling operations across India — new geographies, new partners, new complexity — without sacrificing the quality standard that defines us.',
      'Vendor and partner ecosystems — building the web of relationships that lets us move faster than anyone else in the market.',
      'The cross-functional glue — connecting supply to sales to finance to fulfillment — so nothing falls between the cracks when we accelerate.',
    ],
    requirements: [
      '6-10 years scaling operations at a high-growth startup or scaling business — e-commerce, logistics, automotive, or retail preferred.',
      'Track record of building systems that worked at 10M and still work at 100M+ in revenue.',
      'Comfort with ambiguity, impatience with mediocrity. You see inefficiency and eliminate it before anyone asks.',
      'Relationship builder. Partners trust you. Your team executes at your standard, not the minimum.',
    ],
    closer: "The opportunity: We're at the moment where operational excellence becomes competitive advantage. You're the one who builds that moat.",
  },
  {
    slug: 'cfo',
    category: 'Leadership / Executive',
    department: 'Finance',
    title: 'CFO',
    tagline: 'Own the growth. Own the books. Own the IPO.',
    experience: '5-8 years exp',
    intro: "We're building a ₹100+ crore business from a bootstrapped base. The money side can't be reactive — it has to be the fuel that keeps the machine scaling. Someone needs to own that with the clarity and pace our founders expect.",
    responsibilities: [
      'End-to-end financial strategy — fundraising roadmap, cap table, investor relations, and funding rounds scaled to our growth arc.',
      'The books that investors trust and regulators rely on — systems built for IPO-readiness, not cleaned up later.',
      "Cash flow architecture for scale — inventory financing, working capital optimization, vendor payment terms that don't strangle growth.",
      'The financial narratives in the room — board decks, investor meetings, founder insights — you translate numbers into decisions.',
    ],
    requirements: [
      '5-8 years in financial leadership — CFO role or finance director at a D2C/retail/automotive venture preferred.',
      'Deep experience with growth equity raises, Series A/B fundraising, and cap table management.',
      'Comfort building financial SOPs and systems from first principles — not just inheriting a messy spreadsheet.',
      'You see financial risk before it becomes a crisis. You build buffers into systems that scale.',
    ],
    closer: "The stakes are simple: We're on track for IPO within 5 years. The financial foundation you build today is the one investors will audit. That starts now.",
  },

  // ── Growth ─────────────────────────────────────────────────────────────────
  {
    slug: 'marketing-manager',
    category: 'Growth',
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
    slug: 'seo-digital-marketing-specialist',
    category: 'Growth',
    department: 'Digital Marketing',
    title: 'SEO & Digital Marketing Specialist',
    tagline: 'Own the funnel. Own the data. Own growth that compounds.',
    experience: '3-5 years exp',
    intro: "We're building a D2C brand in a category nobody has educated yet. That means every customer discovery moment counts — and most of them happen through search. Someone needs to own the SEO strategy, paid playbooks, and the data infrastructure that tells us what's working.",
    responsibilities: [
      'SEO strategy and execution — keyword research, on-page optimization, technical SEO, content pillars — built to rank for the terms customers actually search.',
      'Paid performance marketing — Google Ads, Meta Ads, Pinterest — with clear ROAS targets and a testing framework that never stops iterating.',
      'Analytics and data storytelling — dashboards, conversion funnel analysis, attribution — translating clicks into decisions and decisions into scaling.',
      'The optimization engine — A/B tests running, performance reports, monthly cycles of "what worked, what didn\'t, what we try next."',
    ],
    requirements: [
      '3-5 years in performance marketing and/or SEO for D2C, e-commerce, or consumer brands — automotive experience is a strong plus.',
      'Deep hands-on experience with Google Analytics, GSC, paid platforms, and spreadsheets that tell the story.',
      'You know your LTV:CAC ratio by heart. You know why it matters. You know how to improve it.',
      "Growth mindset. You're not running reports — you're hunting for the next 20% improvement, and the one after that.",
    ],
    closer: "The opportunity: We're in the most efficient part of the growth curve for a premium category in India. Nail acquisition economics now and we scale at half the cost competitors think is possible.",
  },
  {
    slug: 'business-development-executive',
    category: 'Growth',
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
    slug: 'jr-accounts-finance-executive',
    category: 'Growth',
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

  // ── Content & Design ───────────────────────────────────────────────────────
  {
    slug: 'content-strategist',
    category: 'Content & Design',
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
    slug: 'content-creator',
    category: 'Content & Design',
    department: 'Content & Digital',
    title: 'Content Creator',
    tagline: 'Build the moments people talk about. Build the community around it.',
    experience: '2-4 years exp',
    intro: 'We\'re not just selling accessories. We\'re educating a market from scratch on what premium automotive culture looks like in India. Every Reel, every post, every story is often someone\'s first exposure to "Build Not Bolt." That story matters. A lot.',
    responsibilities: [
      'Turning campaign briefs into content that moves — Instagram Reels, carousels, community posts, behind-the-scenes, culture moments.',
      'The production pipeline — concept, shoot, edit, publish — keeping the content calendar alive and moving every single day.',
      'Comfortable on and behind camera.',
      'Audience conversation — comments, DMs, community engagement — turning followers into people who care about what we\'re building.',
      'Finding moments in operations and turning them into IP — finding the story in the customer, the build, the install, the result.',
    ],
    requirements: [
      '2-4 years creating content that built engagement, not just posted to feeds — Instagram, TikTok, YouTube, or similar platforms.',
      'Portfolio that shows range — from short-form to long-form, from educational to entertainment, from strategy to execution.',
      'Strong instinct for automotive, gearhead, or lifestyle culture — you get why people care about this category.',
      "You move fast. You don't wait for feedback to iterate. You see what's working and do more of it tomorrow.",
    ],
    closer: 'Why this matters: The first impression someone has of Roavion often comes from your work. Building that first moment right changes everything.',
  },
  {
    slug: 'ui-ux-designer',
    category: 'Content & Design',
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

  // ── Supply & Operations ────────────────────────────────────────────────────
  {
    slug: 'operations-executive',
    category: 'Supply & Operations',
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
    slug: 'procurement-executive',
    category: 'Supply & Operations',
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

  // ── People ─────────────────────────────────────────────────────────────────
  {
    slug: 'talent-acquisition-people-generalist',
    category: 'People',
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
        // Copy + grouping + order refresh on every run (this file owns the layout).
        $set: {
          department: role.department,
          category: role.category,
          title: role.title,
          tagline: role.tagline,
          experience: role.experience,
          intro: role.intro,
          responsibilities: role.responsibilities,
          requirements: role.requirements,
          closer: role.closer,
          sortOrder: i + 1,
        },
        // Set once on insert; an admin's later status/SEO edits survive re-seed.
        $setOnInsert: {
          slug: role.slug,
          status: 'open',
          employmentType: 'FULL_TIME',
          publishedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  if (!APPLY) {
    const existing = await JobPosting.countDocuments({ slug: { $in: ROLES.map((r) => r.slug) } });
    const byCategory = ROLES.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {});
    console.log(`[seed-job-postings] DRY RUN — ${ROLES.length} roles across ${Object.keys(byCategory).length} categories, ${existing} already present.`);
    Object.entries(byCategory).forEach(([c, n]) => console.log(`  ${c} (${n})`));
    console.log('  Re-run with --apply to write. Copy/category/order refresh; status/SEO preserved on existing rows.');
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
