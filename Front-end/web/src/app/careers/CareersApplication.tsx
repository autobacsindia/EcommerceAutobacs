'use client';

/*
 * Careers ("Roavion") standalone application page.
 *
 * Ported from the WordPress `roavion_careers` shortcode. The static shell (hero,
 * "Why Roavion" pillars, application form) is rendered verbatim
 * (dangerouslySetInnerHTML) — it is author-controlled static HTML — and the
 * original imperative behaviour is re-attached in a client-only effect.
 *
 * The OPEN ROLES section and the apply-form role <select> are NO LONGER
 * hardcoded: they are generated from `postings` (fetched server-side from
 * /careers/postings and passed in), so a role is added/edited/withdrawn from the
 * admin without a code change. Dynamic values are HTML-escaped before injection.
 * Two placeholder tokens in the template mark where they go.
 *
 * Submission flow is UNCHANGED here (still the Google Apps Script → Drive upload
 * — that migration is Phase 4). The GAS URL is injected via
 * NEXT_PUBLIC_CAREERS_FORM_URL (no hardcoded deployment URL in source).
 *
 * Fonts: dynamic role markup references the next/font CSS variables
 * (var(--font-bebas) / var(--font-inter)) directly; the static template literals
 * ('Bebas Neue' / 'Inter') are rewritten to the same variables below. Do not
 * reintroduce the Google Fonts <link> (CSP font-src).
 */

import { useEffect, useMemo, useRef } from 'react';
import './careers.css';

const SCRIPT_URL = process.env.NEXT_PUBLIC_CAREERS_FORM_URL || '';

/** A public job posting as returned by GET /careers/postings. */
export interface CareerPosting {
  _id: string;
  department: string;
  title: string;
  slug: string;
  tagline?: string;
  experience?: string;
  intro?: string;
  responsibilities?: string[];
  requirements?: string[];
  closer?: string;
}

// Escape dynamic text/attribute values before injecting into the markup string.
const esc = (s: unknown) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const INTER = 'var(--font-inter),sans-serif';
const BEBAS = 'var(--font-bebas),sans-serif';

/** One "What you'll own" / "What we need" labelled bullet list (omitted if empty). */
function listBlock(label: string, items?: string[]) {
  const rows = (items || []).map((s) => s.trim()).filter(Boolean);
  if (rows.length === 0) return '';
  const lis = rows
    .map(
      (it) =>
        `<li style="font-size:14px;font-weight:300;line-height:1.65;color:#8A8880;font-family:${INTER};">${esc(it)}</li>`,
    )
    .join('');
  return (
    `<div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#F7F5F0;margin-bottom:0.75rem;font-family:${INTER};">${esc(label)}</div>` +
    `<ul style="margin:0 0 1.5rem 0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.5rem;">${lis}</ul>`
  );
}

/** One accordion role card, matching the original hardcoded markup exactly. */
function roleCardHtml(p: CareerPosting, i: number) {
  const id = `r${i + 1}`;
  const tagline = p.tagline
    ? `<div style="font-size:13px;font-weight:300;color:#8A8880;margin-top:2px;font-family:${INTER};">${esc(p.tagline)}</div>`
    : '';
  const tag = p.experience ? `<div class="rv-role-tag">${esc(p.experience)}</div>` : '';
  const intro = p.intro
    ? `<p style="font-size:14px;font-weight:300;line-height:1.75;color:#8A8880;margin:0 0 1.5rem 0;font-family:${INTER};">${esc(p.intro)}</p>`
    : '';
  const closer = p.closer
    ? `<div style="font-size:13px;font-weight:400;line-height:1.7;color:#C93F1A;border-left:2px solid #C93F1A;padding-left:1rem;font-family:${INTER};">${esc(p.closer)}</div>`
    : '';
  return `
      <div class="rv-role-card" data-role-id="${id}">
        <div class="rv-role-header"><div><div style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#C93F1A;margin-bottom:4px;font-family:${INTER};">${esc(p.department)}</div><div style="font-family:${BEBAS};font-size:26px;letter-spacing:0.04em;color:#F7F5F0;">${esc(p.title)}</div>${tagline}</div><span class="rv-role-arrow" id="arr-${id}">+</span></div>
        <div class="rv-role-body" id="body-${id}">
          ${tag}
          ${intro}
          ${listBlock("What you'll own", p.responsibilities)}
          ${listBlock('What we need', p.requirements)}
          ${closer}
          <a href="#rv-form" class="rv-apply-btn" data-role="${esc(p.title)}" style="display:inline-flex;align-items:center;gap:8px;margin-top:1.5rem;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#F7F5F0;text-decoration:none;background:#C93F1A;padding:10px 20px;border-radius:2px;font-family:${INTER};">Apply for this role &rarr;</a>
        </div>
      </div>`;
}

/** The middle <option>s of the role <select> (placeholder + "Other" live in the template). */
function roleOptionsHtml(postings: CareerPosting[]) {
  return postings
    .map((p) => `<option value="${esc(p.title)}">${esc(p.title)}</option>`)
    .join('');
}

const MARKUP_TEMPLATE = `
<div style="font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;background:#111210;color:#F7F5F0;margin:0;padding:0;">

<header style="position:sticky;top:0;z-index:999;background:#111210;border-bottom:1px solid #2E2D2B;padding:0 2.5rem;display:flex;align-items:center;justify-content:space-between;height:64px;">
  <a href="/" style="text-decoration:none;display:flex;align-items:center;"><img src="/images/autobacs-logo.png" alt="AutoBacs India" style="height:36px;width:auto;"></a>
  <nav class="rv-mini-nav" style="display:flex;align-items:center;gap:2rem;">
    <a href="/" style="font-family:'Inter',sans-serif;font-size:12px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:#8A8880;text-decoration:none;transition:color 0.2s;">Home</a>
    <a href="/products" style="font-family:'Inter',sans-serif;font-size:12px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:#8A8880;text-decoration:none;transition:color 0.2s;">Shop</a>
  </nav>
</header>

<section style="min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;padding:4rem 2.5rem 5rem;position:relative;background:#111210;overflow:hidden;margin:0;">
  <div aria-hidden="true" style="position:absolute;top:50%;left:-0.02em;transform:translateY(-54%);font-family:'Bebas Neue',sans-serif;font-size:clamp(180px,22vw,320px);line-height:0.85;color:transparent;-webkit-text-stroke:1px #2E2D2B;user-select:none;pointer-events:none;white-space:nowrap;opacity:0.6;">IMPACT</div>
  <div style="position:relative;max-width:900px;">
    <div style="display:inline-flex;align-items:center;gap:10px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#C93F1A;margin-bottom:2rem;font-family:'Inter',sans-serif;"><span style="display:block;width:28px;height:1px;background:#C93F1A;"></span>Roavion Automotive Pvt Ltd</div>
    <h1 class="rv-hero-h1" style="font-family:'Bebas Neue',sans-serif;font-size:clamp(64px,10vw,130px);line-height:0.92;letter-spacing:0.02em;color:#F7F5F0;margin:0 0 2rem 0;padding:0;border:none;background:none;font-weight:normal;">WE DON'T HIRE<br>FOR TITLES.<br>WE HIRE FOR <span style="color:#C93F1A;">IMPACT.</span></h1>
    <p style="font-size:17px;font-weight:300;line-height:1.75;color:#8A8880;max-width:560px;margin:0 0 2.5rem 0;font-family:'Inter',sans-serif;">Roavion isn't a place to fill a seat. It's a place to <strong style="color:#F7F5F0;font-weight:500;">own something.</strong> We're building a premium automotive ecosystem — and every role here demands more than execution.</p>
  </div>
  <div style="position:absolute;bottom:2rem;right:2.5rem;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#5C5A57;font-family:'Inter',sans-serif;"><div class="rv-scroll-line" style="width:1px;height:40px;background:#2E2D2B;position:relative;overflow:hidden;"></div><span>Scroll</span></div>
</section>

<section class="rv-section-pad" style="background:#F7F5F0;color:#111210;padding:6rem 2.5rem;margin:0;">
  <div style="max-width:860px;margin:0 auto;">
    <div style="margin-bottom:3rem;"><span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#C93F1A;display:block;font-family:'Inter',sans-serif;">Why Roavion</span></div>
    <div class="rv-pillars-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #E4E1DA;">
      <div class="rv-pillar" style="padding:2rem;border-right:1px solid #E4E1DA;border-bottom:1px solid #E4E1DA;"><div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:0.12em;color:#C93F1A;margin-bottom:0.75rem;">01 — Ownership</div><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:0.04em;color:#111210;margin-bottom:0.5rem;">YOU BUILD IT. YOU OWN IT.</div><p style="font-size:14px;font-weight:300;line-height:1.7;color:#5A5754;margin:0;font-family:'Inter',sans-serif;">The people who treat this like it's theirs — who figure things out before anyone tells them to. We believe wealth should follow the people who create it.</p></div>
      <div class="rv-pillar" style="padding:2rem;border-bottom:1px solid #E4E1DA;"><div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:0.12em;color:#C93F1A;margin-bottom:0.75rem;">02 — Mission</div><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:0.04em;color:#111210;margin-bottom:0.5rem;">THIS IS A ONCE-IN-A-DECADE SHIFT.</div><p style="font-size:14px;font-weight:300;line-height:1.7;color:#5A5754;margin:0;font-family:'Inter',sans-serif;">Premium automotive culture in India is at an inflection point. You won't walk into a neatly packaged roadmap. You'll walk into a fast-moving, high-standards environment where the best people define the role as much as they fill it.</p></div>
      <div class="rv-pillar" style="padding:2rem;border-right:1px solid #E4E1DA;"><div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:0.12em;color:#C93F1A;margin-bottom:0.75rem;">03 — Growth</div><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:0.04em;color:#111210;margin-bottom:0.5rem;">NO CEILING. NO HAND-HOLDING.</div><p style="font-size:14px;font-weight:300;line-height:1.7;color:#5A5754;margin:0;font-family:'Inter',sans-serif;">Your background is a starting point — what matters more is how fast you learn, how clearly you think, and how much you care about doing things right. Roavion is in aggressive scale mode. The people here grow because the work demands it.</p></div>
      <div class="rv-pillar" style="padding:2rem;"><div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:0.12em;color:#C93F1A;margin-bottom:0.75rem;">04 — Culture</div><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:0.04em;color:#111210;margin-bottom:0.5rem;">IF THAT SOUNDS LIKE PRESSURE — GOOD.</div><p style="font-size:14px;font-weight:300;line-height:1.7;color:#5A5754;margin:0;font-family:'Inter',sans-serif;">We move fast, say what we mean, and hold each other to a high bar. No politics. No ego. Just people who care deeply about the work and the team around them. If it sounds like opportunity — you're our kind of person.</p></div>
    </div>
  </div>
</section>

<section id="rv-roles" class="rv-section-pad" style="background:#111210;color:#F7F5F0;padding:6rem 2.5rem;border-top:1px solid #2E2D2B;margin:0;">
  <div style="max-width:860px;margin:0 auto;">
    <div style="margin-bottom:1rem;"><span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#C93F1A;display:block;font-family:'Inter',sans-serif;">Open Roles</span></div>
    <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(32px,5vw,52px);letter-spacing:0.03em;line-height:1.0;color:#F7F5F0;margin:0 0 3rem 0;padding:0;border:none;background:none;font-weight:normal;">THE SEATS<br>WE'RE FILLING NOW.</h2>
    <div style="border-top:1px solid #2E2D2B;">
<!--ROLE_CARDS-->
    </div>

    <div style="margin-top:3rem;padding:2rem;border:1px solid #2E2D2B;border-radius:2px;background:#1E1D1B;">
      <p style="font-size:14px;font-weight:300;line-height:1.75;color:#8A8880;margin:0 0 1rem 0;font-family:'Inter',sans-serif;">Don't see your role above? If you believe you belong here, tell us anyway.</p>
      <a href="#rv-form" class="rv-apply-btn" data-role="Other / Open Application" style="display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#C93F1A;text-decoration:none;font-family:'Inter',sans-serif;">Submit an open application &rarr;</a>
    </div>
  </div>
</section>

<div class="rv-section-pad" style="background:#111210;padding:0 2.5rem;">
  <div style="max-width:860px;margin:0 auto;padding:3rem 0 4rem;border-top:1px solid #2E2D2B;">
    <div class="rv-sweep-rule" style="height:2px;background:#C93F1A;width:100%;margin-bottom:2rem;"></div>
    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#5C5A57;font-family:'Inter',sans-serif;">Stage 1 of 2 &nbsp;&middot;&nbsp; Takes 15 minutes &nbsp;&middot;&nbsp; We read every submission personally</div>
  </div>
</div>

<section id="rv-form" class="rv-section-pad" style="background:#111210;padding:5rem 2.5rem 6rem;margin:0;">
  <div style="max-width:860px;margin:0 auto;">
    <div style="margin-bottom:3.5rem;">
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,6vw,64px);letter-spacing:0.03em;line-height:0.95;color:#F7F5F0;margin:0 0 1rem 0;padding:0;border:none;background:none;font-weight:normal;">TELL US<br>WHO YOU ARE.</h2>
      <p style="font-size:15px;font-weight:300;line-height:1.7;color:#8A8880;max-width:500px;margin:0;font-family:'Inter',sans-serif;">No job title. No template. Just tell us what you bring and what you want to build. We will read it carefully.</p>
    </div>

    <form id="rv-appForm" novalidate style="margin:0;">

      <div style="margin-bottom:1.25rem;">
        <label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">Role you're applying for <span style="color:#C93F1A;">*</span></label>
        <select id="rv-role-select" name="role" required style="width:100%;background:#1E1D1B;border:1px solid #2E2D2B;border-radius:2px;padding:13px 16px;font-family:'Inter',sans-serif;font-size:15px;font-weight:300;color:#F7F5F0;outline:none;box-sizing:border-box;appearance:none;-webkit-appearance:none;cursor:pointer;">
          <option value="">Select a role...</option>
<!--ROLE_OPTIONS-->
          <option value="Other / Open Application">Other / Open Application</option>
        </select>
      </div>

      <div class="rv-form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem;">
        <div><label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">Full name <span style="color:#C93F1A;">*</span></label><input class="rv-input" type="text" name="fullName" placeholder="Your full name" required style="width:100%;background:#1E1D1B;border:1px solid #2E2D2B;border-radius:2px;padding:13px 16px;font-family:'Inter',sans-serif;font-size:15px;font-weight:300;color:#F7F5F0;outline:none;box-sizing:border-box;"></div>
        <div><label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">Current city <span style="color:#C93F1A;">*</span></label><input class="rv-input" type="text" name="city" placeholder="City, State" required style="width:100%;background:#1E1D1B;border:1px solid #2E2D2B;border-radius:2px;padding:13px 16px;font-family:'Inter',sans-serif;font-size:15px;font-weight:300;color:#F7F5F0;outline:none;box-sizing:border-box;"></div>
      </div>

      <div class="rv-form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem;">
        <div><label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">Email <span style="color:#C93F1A;">*</span></label><input class="rv-input" type="email" name="email" placeholder="you@example.com" required style="width:100%;background:#1E1D1B;border:1px solid #2E2D2B;border-radius:2px;padding:13px 16px;font-family:'Inter',sans-serif;font-size:15px;font-weight:300;color:#F7F5F0;outline:none;box-sizing:border-box;"></div>
        <div><label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">WhatsApp / Phone</label><input class="rv-input" type="tel" name="phone" placeholder="+91 98000 00000" style="width:100%;background:#1E1D1B;border:1px solid #2E2D2B;border-radius:2px;padding:13px 16px;font-family:'Inter',sans-serif;font-size:15px;font-weight:300;color:#F7F5F0;outline:none;box-sizing:border-box;"></div>
      </div>

      <div style="margin-bottom:1.25rem;"><label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">What do you bring? Tell us in your own words — no job title needed. <span style="color:#C93F1A;">*</span></label><textarea class="rv-input" name="whatYouBring" placeholder="What are you genuinely good at? What have you built, grown, or fixed that you are proud of? What kind of work do you want to be doing in three years?" required style="width:100%;background:#1E1D1B;border:1px solid #2E2D2B;border-radius:2px;padding:13px 16px;font-family:'Inter',sans-serif;font-size:15px;font-weight:300;color:#F7F5F0;outline:none;box-sizing:border-box;resize:vertical;min-height:130px;line-height:1.65;"></textarea></div>

      <div style="display:flex;align-items:center;gap:1rem;margin:3rem 0 2.5rem;"><div style="flex:1;height:1px;background:#2E2D2B;"></div><div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;white-space:nowrap;font-family:'Inter',sans-serif;">Two questions — answer honestly, not impressively</div></div>
      <p style="font-size:14px;font-weight:300;color:#8A8880;line-height:1.75;margin:0 0 2.5rem 0;font-family:'Inter',sans-serif;">Record a short video answer for each question below. There is no correct length — specific and honest beats long and polished every time. MP4, MOV, or WEBM, up to 30MB each.</p>

      <!-- Video Q1 -->
      <div style="margin-bottom:2.5rem;">
        <div style="margin-bottom:1rem;"><div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#C93F1A;margin-bottom:6px;font-family:'Inter',sans-serif;">Question One<span style="color:#C93F1A;font-weight:bold;">*</span></div><p style="font-size:16px;font-weight:300;line-height:1.65;color:#F7F5F0;font-style:italic;border-left:2px solid #C93F1A;padding-left:1rem;margin:0;font-family:'Inter',sans-serif;">"Tell us about one system, process, or thing you built from scratch that still exists and works today — with or without you. It does not have to be related to work. Describe it in specific terms: what it was, what problem it solved, and what happened after you built it."</p></div>
        <div id="q1-video">
          <div class="rv-upload-zone" id="q1-zone" style="border:1px dashed #2E2D2B;border-radius:2px;padding:2rem 1.5rem;text-align:center;cursor:pointer;background:#1E1D1B;"><p style="font-size:13px;color:#8A8880;margin:6px 0 0 0;font-family:'Inter',sans-serif;"><strong style="color:#F7F5F0;">Click to upload your video answer</strong> or drag here &nbsp;&middot;&nbsp; MP4, MOV, WEBM — max 30MB</p><input type="file" id="q1-file" accept="video/*" style="display:none;"></div>
          <div class="rv-progress-wrap" id="q1-progress-wrap"><div class="rv-progress-bar" id="q1-progress-bar"></div></div>
          <div class="rv-upload-status" id="q1-status"></div>
          <div id="q1-chip" style="display:none;align-items:center;gap:8px;margin-top:10px;padding:10px 14px;background:rgba(201,63,26,0.12);border:1px solid rgba(201,63,26,0.3);border-radius:2px;font-size:13px;color:#C93F1A;font-family:'Inter',sans-serif;"><span id="q1-fname"></span><span id="q1-remove" style="margin-left:auto;cursor:pointer;color:#5C5A57;font-size:18px;line-height:1;">&times;</span></div>
        </div>
      </div>

      <!-- Video Q2 -->
      <div style="margin-bottom:2.5rem;">
        <div style="margin-bottom:1rem;"><div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#C93F1A;margin-bottom:6px;font-family:'Inter',sans-serif;">Question Two<span style="color:#C93F1A;font-weight:bold;">*</span></div><p style="font-size:16px;font-weight:300;line-height:1.65;color:#F7F5F0;font-style:italic;border-left:2px solid #C93F1A;padding-left:1rem;margin:0;font-family:'Inter',sans-serif;">"What is the most important thing you have given up in the last two years in order to move forward on something you believed in? Tell us what it was, what you gave up, and whether it was worth it."</p></div>
        <div id="q2-video">
          <div class="rv-upload-zone" id="q2-zone" style="border:1px dashed #2E2D2B;border-radius:2px;padding:2rem 1.5rem;text-align:center;cursor:pointer;background:#1E1D1B;"><p style="font-size:13px;color:#8A8880;margin:6px 0 0 0;font-family:'Inter',sans-serif;"><strong style="color:#F7F5F0;">Click to upload your video answer</strong> or drag here &nbsp;&middot;&nbsp; MP4, MOV, WEBM — max 30MB</p><input type="file" id="q2-file" accept="video/*" style="display:none;"></div>
          <div class="rv-progress-wrap" id="q2-progress-wrap"><div class="rv-progress-bar" id="q2-progress-bar"></div></div>
          <div class="rv-upload-status" id="q2-status"></div>
          <div id="q2-chip" style="display:none;align-items:center;gap:8px;margin-top:10px;padding:10px 14px;background:rgba(201,63,26,0.12);border:1px solid rgba(201,63,26,0.3);border-radius:2px;font-size:13px;color:#C93F1A;font-family:'Inter',sans-serif;"><span id="q2-fname"></span><span id="q2-remove" style="margin-left:auto;cursor:pointer;color:#5C5A57;font-size:18px;line-height:1;">&times;</span></div>
        </div>
      </div>

      <!-- Documents -->
      <div style="margin-top:3rem;padding-top:2.5rem;border-top:1px solid #2E2D2B;margin-bottom:2.5rem;">
        <div style="margin-bottom:0.5rem;">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#C93F1A;margin-bottom:6px;font-family:'Inter',sans-serif;">Documents</div>
          <p style="font-size:14px;font-weight:300;color:#8A8880;line-height:1.75;margin:0 0 1.75rem 0;font-family:'Inter',sans-serif;">PDF only. Max 10MB per file. We need your resume — everything else is optional but welcome.</p>
        </div>
        <div class="rv-docs-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;">
          <!-- Resume -->
          <div>
            <label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">Resume / CV &nbsp;<span style="color:#C93F1A;">*</span></label>
            <div class="rv-pdf-zone" id="resume-zone">
              <svg class="rv-pdf-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C93F1A" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>
              <p style="font-size:13px;color:#8A8880;margin:0;font-family:'Inter',sans-serif;"><strong style="color:#F7F5F0;">Click to upload</strong> or drag here</p>
              <p style="font-size:11px;color:#5C5A57;margin:4px 0 0;font-family:'Inter',sans-serif;">PDF — max 10MB</p>
              <input type="file" id="resume-file" accept="application/pdf,.pdf" style="display:none;">
            </div>
            <div class="rv-progress-wrap" id="resume-progress-wrap"><div class="rv-progress-bar" id="resume-progress-bar"></div></div>
            <div class="rv-upload-status" id="resume-status"></div>
            <div id="resume-chip" style="display:none;align-items:center;gap:8px;margin-top:10px;padding:10px 14px;background:rgba(201,63,26,0.12);border:1px solid rgba(201,63,26,0.3);border-radius:2px;font-size:13px;color:#C93F1A;font-family:'Inter',sans-serif;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C93F1A" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span id="resume-fname" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
              <span id="resume-remove" style="cursor:pointer;color:#5C5A57;font-size:18px;line-height:1;flex-shrink:0;">&times;</span>
            </div>
          </div>
          <!-- Supporting doc -->
          <div>
            <label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:8px;font-family:'Inter',sans-serif;">Supporting Document &nbsp;<span style="color:#5C5A57;font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>
            <div class="rv-pdf-zone" id="support-zone">
              <svg class="rv-pdf-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5A57" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>
              <p style="font-size:13px;color:#8A8880;margin:0;font-family:'Inter',sans-serif;"><strong style="color:#F7F5F0;">Click to upload</strong> or drag here</p>
              <p style="font-size:11px;color:#5C5A57;margin:4px 0 0;font-family:'Inter',sans-serif;">Portfolio · certificates · work samples — PDF, max 10MB</p>
              <input type="file" id="support-file" accept="application/pdf,.pdf" style="display:none;">
            </div>
            <div class="rv-progress-wrap" id="support-progress-wrap"><div class="rv-progress-bar" id="support-progress-bar"></div></div>
            <div class="rv-upload-status" id="support-status"></div>
            <div id="support-chip" style="display:none;align-items:center;gap:8px;margin-top:10px;padding:10px 14px;background:rgba(201,63,26,0.12);border:1px solid rgba(201,63,26,0.3);border-radius:2px;font-size:13px;color:#C93F1A;font-family:'Inter',sans-serif;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C93F1A" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span id="support-fname" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
              <span id="support-remove" style="cursor:pointer;color:#5C5A57;font-size:18px;line-height:1;flex-shrink:0;">&times;</span>
            </div>
          </div>
        </div>
      </div>

      <!-- How found -->
      <div style="margin-bottom:2rem;padding-top:2rem;border-top:1px solid #2E2D2B;">
        <label style="display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#8A8880;margin-bottom:1rem;font-family:'Inter',sans-serif;">How did you find us? <span style="color:#C93F1A;">*</span></label>
        <div id="rv-how-found" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:1rem;">
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Through an Employee" style="display:inline-flex;align-items:center;padding:8px 16px;border-radius:2px;border:1px solid #2E2D2B;background:transparent;font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:#8A8880;cursor:pointer;">Through an Employee</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="LinkedIn" style="display:inline-flex;align-items:center;padding:8px 16px;border-radius:2px;border:1px solid #2E2D2B;background:transparent;font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:#8A8880;cursor:pointer;">LinkedIn</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Instagram" style="display:inline-flex;align-items:center;padding:8px 16px;border-radius:2px;border:1px solid #2E2D2B;background:transparent;font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:#8A8880;cursor:pointer;">Instagram</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Twitter / X" style="display:inline-flex;align-items:center;padding:8px 16px;border-radius:2px;border:1px solid #2E2D2B;background:transparent;font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:#8A8880;cursor:pointer;">Twitter / X</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="YouTube" style="display:inline-flex;align-items:center;padding:8px 16px;border-radius:2px;border:1px solid #2E2D2B;background:transparent;font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:#8A8880;cursor:pointer;">YouTube</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Other" style="display:inline-flex;align-items:center;padding:8px 16px;border-radius:2px;border:1px solid #2E2D2B;background:transparent;font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:#8A8880;cursor:pointer;">Other</button>
        </div>
        <div id="rv-other-source" style="display:none;margin-top:8px;"><input class="rv-input" type="text" id="rv-other-text" placeholder="Tell us where you heard about us..." style="width:100%;background:#1E1D1B;border:1px solid #2E2D2B;border-radius:2px;padding:13px 16px;font-family:'Inter',sans-serif;font-size:15px;font-weight:300;color:#F7F5F0;outline:none;box-sizing:border-box;"></div>
      </div>

      <!-- Submit -->
      <div style="margin-top:3.5rem;padding-top:3rem;border-top:1px solid #2E2D2B;">
        <p style="font-size:13px;font-weight:300;color:#8A8880;line-height:1.7;margin:0 0 2rem 0;max-width:480px;font-family:'Inter',sans-serif;"><strong style="color:#F7F5F0;font-weight:500;">What happens next:</strong> Your submission is reviewed by our team personally within 5 business days. If there is a strong match, you will receive a direct invitation to speak with the founder. We do not use recruiters. We do not send automated rejections.</p>
        <div id="rv-errMsg" style="display:none;font-size:13px;color:#E0502A;margin-bottom:1rem;font-family:'Inter',sans-serif;"></div>
        <!-- Overall upload progress (shown during submission) -->
        <div id="rv-overall-wrap" style="display:none;margin-bottom:1.5rem;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8A8880;font-family:'Inter',sans-serif;margin-bottom:6px;" id="rv-overall-label">Uploading files…</div>
          <div style="background:#2E2D2B;border-radius:2px;height:4px;overflow:hidden;"><div id="rv-overall-bar" style="height:4px;background:#C93F1A;width:0%;transition:width 0.3s;"></div></div>
        </div>
        <button type="submit" id="rv-submitBtn" class="rv-btn-submit" style="display:inline-flex;align-items:center;gap:10px;background:#C93F1A;color:#F7F5F0;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;padding:16px 36px;border-radius:2px;border:none;cursor:pointer;">Submit</button>
      </div>

    </form>
  </div>
</section>

<div id="rv-success" style="display:none;min-height:40vh;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:4rem 2.5rem;background:#111210;">
  <div style="width:52px;height:52px;border:1px solid #C93F1A;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 2rem;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C93F1A" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg></div>
  <h2 style="font-family:'Bebas Neue',sans-serif;font-size:48px;letter-spacing:0.04em;color:#F7F5F0;margin:0 0 1rem 0;padding:0;border:none;background:none;font-weight:normal;">RECEIVED.</h2>
  <p style="font-size:15px;font-weight:300;color:#8A8880;max-width:400px;margin:0 auto;line-height:1.75;font-family:'Inter',sans-serif;">We have your submission. We will read it carefully and be in touch within 5 business days if there is a strong fit.</p>
</div>

<footer style="background:#111210;border-top:1px solid #2E2D2B;padding:1.75rem 2.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin:0;">
  <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:0.06em;color:#8A8880;">ROAVION<span style="color:#C93F1A;">.</span> AUTOMOTIVE PVT LTD</div>
  <div style="font-size:11px;letter-spacing:0.06em;color:#5C5A57;font-family:'Inter',sans-serif;">autobacsindia.com &nbsp;&middot;&nbsp; Confidential &nbsp;&middot;&nbsp; 2026</div>
</footer>

</div>
`
  .replaceAll("'Bebas Neue',sans-serif", 'var(--font-bebas),sans-serif')
  .replaceAll("'Inter',sans-serif", 'var(--font-inter),sans-serif');

/** Assemble the final markup: static template + data-driven roles + options. */
function buildMarkup(postings: CareerPosting[]) {
  const cards = postings.length
    ? postings.map(roleCardHtml).join('\n')
    : `<div style="padding:2rem 0;color:#8A8880;font-size:14px;font-family:${INTER};">New roles are being finalised — check back shortly, or submit an open application below.</div>`;
  return MARKUP_TEMPLATE
    .replace('<!--ROLE_CARDS-->', cards)
    .replace('<!--ROLE_OPTIONS-->', roleOptionsHtml(postings));
}

export default function CareersApplication({ postings = [] }: { postings?: CareerPosting[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markup = useMemo(() => buildMarkup(postings), [postings]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // One controller per effect run: `signal` auto-removes every listener on
    // cleanup, so React 18 strict-mode's double-mount never double-binds.
    const ac = new AbortController();
    const { signal } = ac;
    let unmounted = false;

    const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`#${id}`);
    const all = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

    // ── Local state (mirrors the original closure) ──────────────────────────
    const files: Record<string, File> = {};       // q1, q2
    const docs: Record<string, File> = {};         // resume, support
    const driveUrls: Record<string, string> = {};  // populated after upload
    let selectedSource = '';

    // ── Role card accordion ─────────────────────────────────────────────────
    all('.rv-role-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('a') || target.closest('button')) return;
        const id = card.getAttribute('data-role-id');
        const body = byId(`body-${id}`);
        const arr = byId(`arr-${id}`);
        if (!body || !arr) return;
        const isOpen = body.classList.contains('open');
        all('.rv-role-body').forEach((el) => el.classList.remove('open'));
        all('.rv-role-arrow').forEach((el) => el.classList.remove('open'));
        if (!isOpen) { body.classList.add('open'); arr.classList.add('open'); }
      }, { signal });
    });

    // ── Apply button → auto-fill role dropdown ───────────────────────────────
    all('.rv-apply-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const role = btn.getAttribute('data-role');
        const sel = byId<HTMLSelectElement>('rv-role-select');
        if (!sel || !role) return;
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === role || sel.options[i].text === role) {
            sel.selectedIndex = i; break;
          }
        }
      }, { signal });
    });

    // ── Source buttons ───────────────────────────────────────────────────────
    all('.rv-source-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        all('.rv-source-btn').forEach((b) => { b.classList.remove('active'); b.removeAttribute('data-selected'); });
        btn.classList.add('active'); btn.setAttribute('data-selected', '1');
        selectedSource = btn.getAttribute('data-value') || '';
        const other = byId('rv-other-source');
        if (other) other.style.display = selectedSource === 'Other' ? 'block' : 'none';
      }, { signal });
    });

    // ── Wire a file drop zone (local selection only — no upload yet) ──────────
    function wireZone(
      zoneId: string, inputId: string, chipId: string, fnameId: string,
      removeId: string, store: Record<string, File>, key: string, acceptPrefix: string,
    ) {
      const zone = byId(zoneId);
      const input = byId<HTMLInputElement>(inputId);
      const chip = byId(chipId);
      const fname = byId(fnameId);
      const rmBtn = byId(removeId);
      if (!zone || !input) return;

      const statusEl = byId(zoneId.replace('-zone', '-status'));

      function attach(f: File) {
        store[key] = f;
        delete driveUrls[key]; // clear any previous upload URL if user re-selects
        if (fname) fname.textContent = f.name;
        if (chip) chip.style.display = 'flex';
        zone!.style.display = 'none';
        if (statusEl) statusEl.textContent = '';
      }
      function detach() {
        delete store[key];
        delete driveUrls[key];
        if (chip) chip.style.display = 'none';
        zone!.style.display = '';
        input!.value = '';
        if (statusEl) statusEl.textContent = '';
      }

      zone.addEventListener('click', () => input.click(), { signal });
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); }, { signal });
      zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.classList.remove('drag'); }, { signal });
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drag');
        const f = (e as DragEvent).dataTransfer?.files[0];
        if (f && f.type.indexOf(acceptPrefix) === 0) attach(f);
      }, { signal });
      input.addEventListener('change', () => { if (input.files?.[0]) attach(input.files[0]); }, { signal });
      if (rmBtn) rmBtn.addEventListener('click', (e) => { e.stopPropagation(); detach(); }, { signal });
    }

    wireZone('q1-zone', 'q1-file', 'q1-chip', 'q1-fname', 'q1-remove', files, 'q1', 'video/');
    wireZone('q2-zone', 'q2-file', 'q2-chip', 'q2-fname', 'q2-remove', files, 'q2', 'video/');
    wireZone('resume-zone', 'resume-file', 'resume-chip', 'resume-fname', 'resume-remove', docs, 'resume', 'application/pdf');
    wireZone('support-zone', 'support-file', 'support-chip', 'support-fname', 'support-remove', docs, 'support', 'application/pdf');

    // ── Upload a single file directly to Google Drive (resumable) ─────────────
    function uploadFileToDrive(
      file: File, token: string, folderId: string,
      labelEl: HTMLElement | null, progressWrapEl: HTMLElement | null, progressBarEl: HTMLElement | null,
    ): Promise<string> {
      return new Promise((resolve, reject) => {
        const meta = JSON.stringify({ name: file.name, parents: [folderId] });
        const initXhr = new XMLHttpRequest();
        initXhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', true);
        initXhr.setRequestHeader('Authorization', `Bearer ${token}`);
        initXhr.setRequestHeader('Content-Type', 'application/json');
        initXhr.setRequestHeader('X-Upload-Content-Type', file.type || 'application/octet-stream');
        initXhr.setRequestHeader('X-Upload-Content-Length', String(file.size));

        initXhr.onload = () => {
          if (initXhr.status !== 200) { reject(new Error(`Drive session init failed: ${initXhr.status}`)); return; }
          const uploadUrl = initXhr.getResponseHeader('Location');
          if (!uploadUrl) { reject(new Error('No upload URL returned from Drive.')); return; }

          const uploadXhr = new XMLHttpRequest();
          uploadXhr.open('PUT', uploadUrl, true);
          uploadXhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

          if (progressWrapEl) progressWrapEl.style.display = 'block';
          uploadXhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable && progressBarEl) {
              const pct = Math.round((ev.loaded / ev.total) * 100);
              progressBarEl.style.width = `${pct}%`;
              if (labelEl) labelEl.textContent = `Uploading… ${pct}%`;
            }
          };

          uploadXhr.onload = () => {
            if (uploadXhr.status === 200 || uploadXhr.status === 201) {
              let resp: { id: string };
              try { resp = JSON.parse(uploadXhr.responseText); } catch { reject(new Error('Bad Drive response.')); return; }
              const fileId = resp.id;
              const shareXhr = new XMLHttpRequest();
              shareXhr.open('POST', `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, true);
              shareXhr.setRequestHeader('Authorization', `Bearer ${token}`);
              shareXhr.setRequestHeader('Content-Type', 'application/json');
              shareXhr.onload = () => {
                if (labelEl) labelEl.textContent = 'Uploaded ✓';
                resolve(`https://drive.google.com/file/d/${fileId}/view`);
              };
              shareXhr.onerror = () => reject(new Error('Failed to set file permissions.'));
              shareXhr.send(JSON.stringify({ role: 'reader', type: 'anyone' }));
            } else {
              reject(new Error(`Drive upload failed: HTTP ${uploadXhr.status}`));
            }
          };
          uploadXhr.onerror = () => reject(new Error('Network error during upload.'));
          uploadXhr.send(file);
        };
        initXhr.onerror = () => reject(new Error('Network error initiating upload.'));
        initXhr.send(meta);
      });
    }

    // ── Validation / progress helpers ────────────────────────────────────────
    function showErr(msg: string) {
      const errEl = byId('rv-errMsg');
      if (!errEl) return;
      errEl.textContent = msg; errEl.style.display = 'block';
      errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function hideErr() {
      const errEl = byId('rv-errMsg');
      if (!errEl) return;
      errEl.style.display = 'none'; errEl.textContent = '';
    }
    function setOverall(pct: number, label: string) {
      const bar = byId('rv-overall-bar');
      const lbl = byId('rv-overall-label');
      if (bar) bar.style.width = `${pct}%`;
      if (lbl) lbl.textContent = label;
    }

    // ── Form submit ──────────────────────────────────────────────────────────
    const form = byId<HTMLFormElement>('rv-appForm');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      hideErr();

      const el = (name: string) => form.elements.namedItem(name) as (HTMLInputElement | HTMLTextAreaElement | null);

      // 1. Role
      const role = byId<HTMLSelectElement>('rv-role-select')?.value || '';
      if (!role) { showErr('Please select the role you are applying for.'); return; }

      // 2. Source
      const selBtn = root.querySelector('.rv-source-btn[data-selected="1"]');
      const sourceVal = selBtn ? selBtn.getAttribute('data-value') || '' : '';
      if (!sourceVal) { showErr('Please let us know how you found us.'); return; }

      // 3. Required text fields
      let allOk = true;
      ['fullName', 'city', 'email', 'whatYouBring'].forEach((n) => {
        const field = el(n);
        if (!field || !field.value.trim()) { allOk = false; if (field) field.style.borderColor = '#C93F1A'; }
        else field.style.borderColor = '';
      });
      if (!allOk) { showErr('Please fill in all required fields.'); return; }

      // 4. Videos
      if (!files.q1 || !files.q2) { showErr('Please upload video answers for both Question One and Question Two.'); return; }
      if (files.q1.size > 30 * 1024 * 1024 || files.q2.size > 30 * 1024 * 1024) { showErr('Each video must be under 30MB.'); return; }

      // 5. Resume
      if (!docs.resume) { showErr('Please upload your resume (PDF) before submitting.'); return; }
      if (docs.resume.size > 10 * 1024 * 1024) { showErr('Resume must be under 10MB.'); return; }
      if (docs.support && docs.support.size > 10 * 1024 * 1024) { showErr('Supporting document must be under 10MB.'); return; }

      if (!SCRIPT_URL) { showErr('Applications are temporarily unavailable. Please email careers@autobacsindia.com.'); return; }

      // ── Lock UI ────────────────────────────────────────────────────────────
      const btn = byId<HTMLButtonElement>('rv-submitBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; btn.style.opacity = '0.6'; }
      const overallWrap = byId('rv-overall-wrap');
      if (overallWrap) overallWrap.style.display = 'block';
      setOverall(0, 'Just A Min…');

      const howFound = sourceVal === 'Other'
        ? (byId<HTMLInputElement>('rv-other-text')?.value.trim() || 'Other')
        : sourceVal;

      // ── Step 1: fetch OAuth token from GAS doGet ─────────────────────────────
      fetch(`${SCRIPT_URL}?action=token`, { redirect: 'follow' })
        .then((r) => r.json())
        .then((tokenData) => {
          if (!tokenData.ok) throw new Error(tokenData.error || 'Could not get upload token.');
          const token: string = tokenData.token;
          const folderId: string = tokenData.folderId;

          setOverall(5, 'Uploading files…');

          const toUpload = [
            { file: files.q1, key: 'q1', statusId: 'q1-status', progressWrap: 'q1-progress-wrap', progressBar: 'q1-progress-bar' },
            { file: files.q2, key: 'q2', statusId: 'q2-status', progressWrap: 'q2-progress-wrap', progressBar: 'q2-progress-bar' },
            { file: docs.resume, key: 'resume', statusId: 'resume-status', progressWrap: 'resume-progress-wrap', progressBar: 'resume-progress-bar' },
          ];
          if (docs.support) {
            toUpload.push({ file: docs.support, key: 'support', statusId: 'support-status', progressWrap: 'support-progress-wrap', progressBar: 'support-progress-bar' });
          }

          let completed = 0;
          const total = toUpload.length;

          return Promise.all(toUpload.map((item) => {
            const labelEl = byId(item.statusId);
            const wrapEl = byId(item.progressWrap);
            const barEl = byId(item.progressBar);
            return uploadFileToDrive(item.file, token, folderId, labelEl, wrapEl, barEl).then((url) => {
              driveUrls[item.key] = url;
              completed++;
              setOverall(5 + Math.round((completed / total) * 85), `Uploading files… (${completed}/${total} done)`);
            });
          }));
        })
        .then(() => {
          setOverall(92, 'Saving your application…');
          if (btn) btn.textContent = 'Saving…';

          const payload = {
            role,
            full_name: el('fullName')?.value || '',
            city: el('city')?.value || '',
            email: el('email')?.value || '',
            phone: el('phone')?.value || '',
            what_you_bring: el('whatYouBring')?.value || '',
            how_found: howFound,
            video_one_url: driveUrls.q1,
            video_two_url: driveUrls.q2,
            resume_url: driveUrls.resume,
            support_url: driveUrls.support || '',
          };

          // text/plain avoids a CORS preflight (GAS does not answer OPTIONS).
          return fetch(SCRIPT_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
          });
        })
        .then((r) => r.json())
        .then((data) => {
          if (unmounted) return;
          if (data.ok) {
            setOverall(100, 'Done.');
            const formSection = byId('rv-form');
            if (formSection) formSection.style.display = 'none';
            all('section').forEach((s) => { if (s.id !== 'rv-success') s.style.display = 'none'; });
            const success = byId('rv-success');
            if (success) success.style.display = 'flex';
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            throw new Error(data.error || 'Submission failed. Please try again.');
          }
        })
        .catch((err) => {
          if (unmounted) return;
          showErr(err.message || 'Something went wrong. Please check your connection and try again.');
          if (btn) { btn.disabled = false; btn.textContent = 'Submit'; btn.style.opacity = '1'; }
          if (overallWrap) overallWrap.style.display = 'none';
        });
    }, { signal });

    return () => { unmounted = true; ac.abort(); };
  }, [markup]);

  return <div ref={rootRef} className="rv-careers-page" dangerouslySetInnerHTML={{ __html: markup }} />;
}
