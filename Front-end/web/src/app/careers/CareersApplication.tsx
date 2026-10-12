'use client';

/*
 * Careers ("Roavion") standalone application page.
 *
 * Ported from the WordPress `roavion_careers` shortcode. The static shell (its
 * own minimal top bar, the hero, the "Why Roavion" pillars and the application
 * form) is rendered verbatim
 * (dangerouslySetInnerHTML) — it is author-controlled static HTML — and the
 * original imperative behaviour is re-attached in a client-only effect.
 *
 * The OPEN ROLES section and the apply-form role <select> are NO LONGER
 * hardcoded: they are generated from `postings` (fetched server-side from
 * /careers/postings and passed in), so a role is added/edited/withdrawn from the
 * admin without a code change. Dynamic values are HTML-escaped before injection.
 * Two placeholder tokens in the template mark where they go.
 *
 * Section order is deliberate: top bar → hero with its two CTAs → OPEN ROLES →
 * "Why Roavion" → the form. Someone on a careers page is looking for a job, so
 * the jobs come before the culture essay; the pillars still sell the company,
 * just to a reader who has already found a role worth applying for.
 *
 * Submission is IN-HOUSE (no Google): the browser fetches upload credentials
 * from our backend, uploads each video/PDF directly to storage, then POSTs only
 * the { publicId, provider } refs + form fields to /careers/applications. Files
 * never touch our server.
 *
 * Two storage backends are live at once during the Cloudinary → R2 migration,
 * and the credential response is a DISCRIMINATED UNION on `provider`:
 *   - cloudinary — one signature per FOLDER, reused for every file, POSTed as
 *     multipart to api.cloudinary.com with `authenticated` (private) delivery;
 *   - r2         — one presigned PUT per object key, into the PRIVATE bucket at
 *     <account>.r2.cloudflarestorage.com.
 * Both need their origin in the page CSP connect-src (see middleware.ts).
 *
 * Nothing the browser says about a file is trusted: the backend re-reads every
 * ref from the store it names and re-derives size and format there — by magic
 * number on the R2 path, since R2 (unlike Cloudinary) does not decode uploads
 * and does not even enforce the Content-Type its own presigned URL was signed
 * with.
 *
 * Fonts: the store's own — body text inherits the site font, headings use
 * var(--font-montserrat). Do not reintroduce the Google Fonts <link> (CSP font-src).
 */

import { useEffect, useMemo, useRef } from 'react';
import apiClient from '@/lib/api';
import './careers.css';

/** A public job posting as returned by GET /careers/postings. */
export interface CareerPosting {
  _id: string;
  department: string;
  category?: string;
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

// The store's own fonts (2026-10 restyle): body inherits DM Sans, headings Montserrat.
const INTER = 'inherit';
const BEBAS = 'var(--font-montserrat),sans-serif';

/** One "What you'll own" / "What we need" labelled bullet list (omitted if empty). */
function listBlock(label: string, items?: string[]) {
  const rows = (items || []).map((s) => s.trim()).filter(Boolean);
  if (rows.length === 0) return '';
  const lis = rows
    .map(
      (it) =>
        `<li style="font-size:14px;font-weight:400;line-height:1.65;color:#5f6363;font-family:${INTER};">${esc(it)}</li>`,
    )
    .join('');
  return (
    `<div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#0f1111;margin-bottom:0.75rem;font-family:${INTER};">${esc(label)}</div>` +
    `<ul style="margin:0 0 1.5rem 0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.5rem;">${lis}</ul>`
  );
}

/** One accordion role card, matching the original hardcoded markup exactly. */
function roleCardHtml(p: CareerPosting, i: number) {
  const id = `r${i + 1}`;
  const tagline = p.tagline
    ? `<div style="font-size:13px;font-weight:400;color:#5f6363;margin-top:2px;font-family:${INTER};">${esc(p.tagline)}</div>`
    : '';
  const tag = p.experience ? `<div class="rv-role-tag">${esc(p.experience)}</div>` : '';
  const intro = p.intro
    ? `<p style="font-size:14px;font-weight:400;line-height:1.75;color:#5f6363;margin:0 0 1.5rem 0;font-family:${INTER};">${esc(p.intro)}</p>`
    : '';
  const closer = p.closer
    ? `<div style="font-size:13px;font-weight:400;line-height:1.7;color:#0a5c33;border-left:2px solid #0a5c33;padding-left:1rem;font-family:${INTER};">${esc(p.closer)}</div>`
    : '';
  return `
      <div class="rv-role-card" data-role-id="${id}">
        <div class="rv-role-header"><div><div style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#0a5c33;margin-bottom:4px;font-family:${INTER};">${esc(p.department)}</div><div style="font-family:${BEBAS};font-size:21px;font-weight:700;letter-spacing:-0.01em;color:#0f1111;">${esc(p.title)}</div>${tagline}</div><span class="rv-role-arrow" id="arr-${id}">+</span></div>
        <div class="rv-role-body" id="body-${id}">
          ${tag}
          ${intro}
          ${listBlock("What you'll own", p.responsibilities)}
          ${listBlock('What we need', p.requirements)}
          ${closer}
          <a href="#rv-form" class="rv-apply-btn" data-role="${esc(p.title)}" style="display:inline-flex;align-items:center;gap:8px;margin-top:1.5rem;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#ffffff;text-decoration:none;background:#0a5c33;padding:10px 20px;border-radius:10px;font-family:${INTER};">Apply for this role &rarr;</a>
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
<div style="font-family:inherit;-webkit-font-smoothing:antialiased;overflow-x:hidden;background:#ffffff;color:#0f1111;margin:0;padding:0;">


<header class="rv-topbar">
  <a href="/" class="rv-topbar-logo" aria-label="Roavion home"><img src="/images/roavion-logo.png" alt="Roavion" width="960" height="255" /></a>
  <a href="/" class="rv-topbar-home"><span aria-hidden="true">&larr;</span> Home</a>
</header>

<section class="rv-hero">
  <div style="position:relative;max-width:900px;">
    <div style="display:inline-flex;align-items:center;gap:10px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0a5c33;margin-bottom:1.25rem;font-family:inherit;"><span style="display:block;width:28px;height:1px;background:#0a5c33;"></span>Careers at Roavion Automotive</div>
    <h1 class="rv-hero-h1" style="font-family:var(--font-montserrat),sans-serif;font-size:clamp(30px,5vw,58px);line-height:0.95;color:#0f1111;margin:0 0 1rem 0;padding:0;border:none;background:none;font-weight:700;letter-spacing:-0.01em;">WE DON'T HIRE<br>FOR TITLES.<br>WE HIRE FOR <span style="color:#0a5c33;">IMPACT.</span></h1>
    <p style="font-size:16px;font-weight:400;line-height:1.7;color:#5f6363;max-width:540px;margin:0 0 1.75rem 0;font-family:inherit;">Roavion isn't a place to fill a seat. It's a place to <strong style="color:#0f1111;font-weight:500;">own something.</strong> Browse the open roles below and apply in about 15 minutes.</p>
    <div class="rv-hero-cta">
      <a href="#rv-roles" class="rv-btn-primary">See open roles<!--ROLE_COUNT--></a>
      <a href="#rv-form" class="rv-btn-ghost rv-apply-btn" data-role="Other / Open Application">Apply now</a>
    </div>
  </div>
</section>

<section id="rv-roles" class="rv-section-pad rv-band" style="background:#ffffff;color:#0f1111;border-top:1px solid #dfe3e2;margin:0;">
  <div style="max-width:860px;margin:0 auto;">
    <div style="margin-bottom:1rem;"><span style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0a5c33;display:block;font-family:inherit;">Open Roles</span></div>
    <h2 style="font-family:var(--font-montserrat),sans-serif;font-size:clamp(26px,2.5vw,30px);line-height:1.05;color:#0f1111;margin:0 0 0.75rem 0;padding:0;border:none;background:none;font-weight:700;letter-spacing:-0.01em;">THE SEATS WE'RE FILLING NOW.</h2>
    <p style="font-size:15px;line-height:1.7;color:#5f6363;margin:0 0 2rem 0;max-width:520px;font-family:inherit;">Tap any role to read what it involves, then hit <strong style="color:#0f1111;font-weight:600;">Apply</strong> — it drops you straight into the form below with that role filled in.</p>
<!--ROLE_CARDS-->

    <div style="margin-top:3rem;padding:2rem;border:1px solid #dfe3e2;border-radius:10px;background:#f7f9f8;">
      <p style="font-size:14px;font-weight:400;line-height:1.75;color:#5f6363;margin:0 0 1rem 0;font-family:inherit;">Don't see your role above? If you believe you belong here, tell us anyway.</p>
      <a href="#rv-form" class="rv-apply-btn" data-role="Other / Open Application" style="display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#0a5c33;text-decoration:none;font-family:inherit;">Submit an open application &rarr;</a>
    </div>
  </div>
</section>

<section class="rv-section-pad rv-band" style="background:#eef1f0;color:#0f1111;margin:0;">
  <div style="max-width:860px;margin:0 auto;">
    <div style="margin-bottom:3rem;"><span style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0a5c33;display:block;font-family:inherit;">Why Roavion</span></div>
    <div class="rv-pillars-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #dfe3e2;">
      <div class="rv-pillar" style="padding:2rem;border-right:1px solid #dfe3e2;border-bottom:1px solid #dfe3e2;"><div style="font-family:var(--font-montserrat),sans-serif;font-size:13px;letter-spacing:0.12em;color:#0a5c33;margin-bottom:0.75rem;font-weight:700;letter-spacing:-0.01em;">01 — Ownership</div><div style="font-family:var(--font-montserrat),sans-serif;font-size:18px;color:#0f1111;margin-bottom:0.5rem;font-weight:700;letter-spacing:-0.01em;">YOU BUILD IT. YOU OWN IT.</div><p style="font-size:14px;font-weight:400;line-height:1.7;color:#4a4f4f;margin:0;font-family:inherit;">The people who treat this like it's theirs — who figure things out before anyone tells them to. We believe wealth should follow the people who create it.</p></div>
      <div class="rv-pillar" style="padding:2rem;border-bottom:1px solid #dfe3e2;"><div style="font-family:var(--font-montserrat),sans-serif;font-size:13px;letter-spacing:0.12em;color:#0a5c33;margin-bottom:0.75rem;font-weight:700;letter-spacing:-0.01em;">02 — Mission</div><div style="font-family:var(--font-montserrat),sans-serif;font-size:18px;color:#0f1111;margin-bottom:0.5rem;font-weight:700;letter-spacing:-0.01em;">THIS IS A ONCE-IN-A-DECADE SHIFT.</div><p style="font-size:14px;font-weight:400;line-height:1.7;color:#4a4f4f;margin:0;font-family:inherit;">Premium automotive culture in India is at an inflection point. You won't walk into a neatly packaged roadmap. You'll walk into a fast-moving, high-standards environment where the best people define the role as much as they fill it.</p></div>
      <div class="rv-pillar" style="padding:2rem;border-right:1px solid #dfe3e2;"><div style="font-family:var(--font-montserrat),sans-serif;font-size:13px;letter-spacing:0.12em;color:#0a5c33;margin-bottom:0.75rem;font-weight:700;letter-spacing:-0.01em;">03 — Growth</div><div style="font-family:var(--font-montserrat),sans-serif;font-size:18px;color:#0f1111;margin-bottom:0.5rem;font-weight:700;letter-spacing:-0.01em;">NO CEILING. NO HAND-HOLDING.</div><p style="font-size:14px;font-weight:400;line-height:1.7;color:#4a4f4f;margin:0;font-family:inherit;">Your background is a starting point — what matters more is how fast you learn, how clearly you think, and how much you care about doing things right. Roavion is in aggressive scale mode. The people here grow because the work demands it.</p></div>
      <div class="rv-pillar" style="padding:2rem;"><div style="font-family:var(--font-montserrat),sans-serif;font-size:13px;letter-spacing:0.12em;color:#0a5c33;margin-bottom:0.75rem;font-weight:700;letter-spacing:-0.01em;">04 — Culture</div><div style="font-family:var(--font-montserrat),sans-serif;font-size:18px;color:#0f1111;margin-bottom:0.5rem;font-weight:700;letter-spacing:-0.01em;">IF THAT SOUNDS LIKE PRESSURE — GOOD.</div><p style="font-size:14px;font-weight:400;line-height:1.7;color:#4a4f4f;margin:0;font-family:inherit;">We move fast, say what we mean, and hold each other to a high bar. No politics. No ego. Just people who care deeply about the work and the team around them. If it sounds like opportunity — you're our kind of person.</p></div>
    </div>
  </div>
</section>

<section id="rv-form" class="rv-form-section rv-band">
  <div class="rv-form-wrap">
    <div class="rv-form-intro">
      <span class="rv-eyebrow">Apply</span>
      <h2 class="rv-h2">Tell us who you are.</h2>
      <p class="rv-lead">No job title. No template. Just tell us what you bring and what you want to build. It takes about 15 minutes, and every submission is read personally.</p>
    </div>

    <form id="rv-appForm" class="rv-form-card" novalidate>

      <!-- Step 1 -->
      <div class="rv-step">
        <div class="rv-step-head"><span class="rv-step-num">1</span><div><h3 class="rv-step-title">Your details</h3><p class="rv-step-sub">Fields marked <span class="rv-req">*</span> are required.</p></div></div>

        <div class="rv-field">
          <label class="rv-label" for="rv-role-select">Role you're applying for <span class="rv-req">*</span></label>
          <div class="rv-select-wrap">
            <select id="rv-role-select" name="role" required class="rv-input rv-select">
              <option value="">Select a role…</option>
<!--ROLE_OPTIONS-->
              <option value="Other / Open Application">Other / Open Application</option>
            </select>
          </div>
        </div>

        <div class="rv-form-row">
          <div class="rv-field"><label class="rv-label" for="rv-fullName">Full name <span class="rv-req">*</span></label><input id="rv-fullName" class="rv-input" type="text" name="fullName" placeholder="Your full name" autocomplete="name" required></div>
          <div class="rv-field"><label class="rv-label" for="rv-city">Current city <span class="rv-req">*</span></label><input id="rv-city" class="rv-input" type="text" name="city" placeholder="City, State" autocomplete="address-level2" required></div>
        </div>

        <div class="rv-form-row">
          <div class="rv-field"><label class="rv-label" for="rv-email">Email <span class="rv-req">*</span></label><input id="rv-email" class="rv-input" type="email" name="email" placeholder="you@example.com" autocomplete="email" required></div>
          <div class="rv-field"><label class="rv-label" for="rv-phone">WhatsApp / phone <span class="rv-opt">(optional)</span></label><input id="rv-phone" class="rv-input" type="tel" name="phone" placeholder="10-digit mobile number" autocomplete="tel"></div>
        </div>

        <div class="rv-field">
          <label class="rv-label" for="rv-whatYouBring">What do you bring? <span class="rv-req">*</span></label>
          <p class="rv-hint">Tell us in your own words — no job title needed.</p>
          <textarea id="rv-whatYouBring" class="rv-input rv-textarea" name="whatYouBring" placeholder="What are you genuinely good at? What have you built, grown, or fixed that you are proud of? What kind of work do you want to be doing in three years?" required></textarea>
        </div>
      </div>

      <!-- Step 2 -->
      <div class="rv-step">
        <div class="rv-step-head"><span class="rv-step-num">2</span><div><h3 class="rv-step-title">Two short video answers</h3><p class="rv-step-sub">Answer honestly, not impressively. Record on your phone — there is no correct length. MP4, MOV or WEBM, up to 30MB each.</p></div></div>

        <!-- Video Q1 -->
        <div class="rv-question">
          <div class="rv-q-label">Question 1 <span class="rv-req">*</span></div>
          <p class="rv-q-text">Tell us about one system, process, or thing you built from scratch that still exists and works today — with or without you. It does not have to be related to work. Describe it in specific terms: what it was, what problem it solved, and what happened after you built it.</p>
          <div id="q1-video">
            <div class="rv-upload-zone" id="q1-zone" role="button" tabindex="0">
              <svg class="rv-zone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0a5c33" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              <p class="rv-zone-main"><strong>Click to upload your video</strong> or drag it here</p>
              <p class="rv-zone-sub">MP4, MOV, WEBM — max 30MB</p>
              <input type="file" id="q1-file" accept="video/*" style="display:none;">
            </div>
            <div class="rv-progress-wrap" id="q1-progress-wrap"><div class="rv-progress-bar" id="q1-progress-bar"></div></div>
            <div class="rv-upload-status" id="q1-status"></div>
            <div id="q1-chip" class="rv-chip" style="display:none;"><span id="q1-fname" class="rv-chip-name"></span><span id="q1-remove" class="rv-chip-remove" role="button" aria-label="Remove file">&times;</span></div>
          </div>
        </div>

        <!-- Video Q2 -->
        <div class="rv-question">
          <div class="rv-q-label">Question 2 <span class="rv-req">*</span></div>
          <p class="rv-q-text">What is the most important thing you have given up in the last two years in order to move forward on something you believed in? Tell us what it was, what you gave up, and whether it was worth it.</p>
          <div id="q2-video">
            <div class="rv-upload-zone" id="q2-zone" role="button" tabindex="0">
              <svg class="rv-zone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0a5c33" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              <p class="rv-zone-main"><strong>Click to upload your video</strong> or drag it here</p>
              <p class="rv-zone-sub">MP4, MOV, WEBM — max 30MB</p>
              <input type="file" id="q2-file" accept="video/*" style="display:none;">
            </div>
            <div class="rv-progress-wrap" id="q2-progress-wrap"><div class="rv-progress-bar" id="q2-progress-bar"></div></div>
            <div class="rv-upload-status" id="q2-status"></div>
            <div id="q2-chip" class="rv-chip" style="display:none;"><span id="q2-fname" class="rv-chip-name"></span><span id="q2-remove" class="rv-chip-remove" role="button" aria-label="Remove file">&times;</span></div>
          </div>
        </div>
      </div>

      <!-- Step 3 -->
      <div class="rv-step">
        <div class="rv-step-head"><span class="rv-step-num">3</span><div><h3 class="rv-step-title">Documents</h3><p class="rv-step-sub">PDF only, max 10MB per file. We need your resume — anything else is optional but welcome.</p></div></div>
        <div class="rv-docs-grid">
          <!-- Resume -->
          <div>
            <div class="rv-label">Resume / CV <span class="rv-req">*</span></div>
            <div class="rv-pdf-zone" id="resume-zone" role="button" tabindex="0">
              <svg class="rv-zone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0a5c33" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>
              <p class="rv-zone-main"><strong>Click to upload</strong> or drag here</p>
              <p class="rv-zone-sub">PDF — max 10MB</p>
              <input type="file" id="resume-file" accept="application/pdf,.pdf" style="display:none;">
            </div>
            <div class="rv-progress-wrap" id="resume-progress-wrap"><div class="rv-progress-bar" id="resume-progress-bar"></div></div>
            <div class="rv-upload-status" id="resume-status"></div>
            <div id="resume-chip" class="rv-chip" style="display:none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a5c33" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span id="resume-fname" class="rv-chip-name"></span>
              <span id="resume-remove" class="rv-chip-remove" role="button" aria-label="Remove file">&times;</span>
            </div>
          </div>
          <!-- Supporting doc -->
          <div>
            <div class="rv-label">Supporting document <span class="rv-opt">(optional)</span></div>
            <div class="rv-pdf-zone" id="support-zone" role="button" tabindex="0">
              <svg class="rv-zone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5b6561" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>
              <p class="rv-zone-main"><strong>Click to upload</strong> or drag here</p>
              <p class="rv-zone-sub">Portfolio, certificates, work samples — PDF, max 10MB</p>
              <input type="file" id="support-file" accept="application/pdf,.pdf" style="display:none;">
            </div>
            <div class="rv-progress-wrap" id="support-progress-wrap"><div class="rv-progress-bar" id="support-progress-bar"></div></div>
            <div class="rv-upload-status" id="support-status"></div>
            <div id="support-chip" class="rv-chip" style="display:none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a5c33" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span id="support-fname" class="rv-chip-name"></span>
              <span id="support-remove" class="rv-chip-remove" role="button" aria-label="Remove file">&times;</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 4 -->
      <div class="rv-step">
        <div class="rv-step-head"><span class="rv-step-num">4</span><div><h3 class="rv-step-title">How did you find us? <span class="rv-req">*</span></h3><p class="rv-step-sub">Pick one.</p></div></div>
        <div id="rv-how-found" class="rv-source-list">
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Through an Employee">Through an Employee</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="LinkedIn">LinkedIn</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Instagram">Instagram</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Twitter / X">Twitter / X</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="YouTube">YouTube</button>
          <button type="button" class="rv-fmt-btn rv-source-btn" data-value="Other">Other</button>
        </div>
        <div id="rv-other-source" style="display:none;margin-top:12px;"><input class="rv-input" type="text" id="rv-other-text" aria-label="Where did you hear about us?" placeholder="Tell us where you heard about us…"></div>
      </div>

      <!-- Submit -->
      <div class="rv-submit-block">
        <div class="rv-next-note"><strong>What happens next:</strong> our team reviews every submission personally within 5 business days. If there is a strong match, you will get a direct invitation to speak with the founder. No recruiters, no automated rejections.</div>
        <div id="rv-errMsg" class="rv-err" role="alert" style="display:none;"></div>
        <div id="rv-overall-wrap" style="display:none;margin-bottom:1.25rem;">
          <div class="rv-overall-label" id="rv-overall-label">Uploading files…</div>
          <div class="rv-overall-track"><div id="rv-overall-bar" class="rv-overall-bar"></div></div>
        </div>
        <button type="submit" id="rv-submitBtn" class="rv-btn-submit">Submit</button>
      </div>

    </form>
  </div>
</section>

<div id="rv-success" class="rv-success" style="display:none;">
  <div class="rv-success-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></div>
  <h2 class="rv-h2">Application received.</h2>
  <p class="rv-lead" style="margin:0 auto;">Thank you. We will read it carefully and be in touch within 5 business days if there is a strong fit.</p>
  <a href="/" class="rv-btn-ghost" style="margin-top:1.75rem;">Back to home</a>
</div>

</div>
`
;

const plural = (n: number) => (n === 1 ? '' : 's');

/**
 * The heading that introduces one department's roles.
 *
 * It replaces the old card → panel drill-down. That layout hid every job behind
 * two taps and a scroll, which was the whole reason the page looked empty: a
 * visitor saw eight grey boxes and no actual work.
 */
function categoryHeadHtml(name: string, count: number) {
  const label = name || 'More Roles';
  return `
      <div class="rv-cat-head">
        <h3 class="rv-cat-head-name">${esc(label)}</h3>
        <span class="rv-cat-head-count">${count} open role${plural(count)}</span>
      </div>`;
}

/**
 * Assemble the final markup: static template + data-driven roles + options.
 *
 * Every role is rendered up front, grouped under a department heading, with its
 * detail in a one-tap accordion. Category order follows the order roles arrive
 * in (the API pre-sorts by managed category order); the uncategorised bucket, if
 * any, comes last under "More Roles". Card ids (`r1`, `r2`, …) stay globally
 * unique so the accordion targeting never collides.
 */
function buildMarkup(postings: CareerPosting[]) {
  if (postings.length === 0) {
    const fallback =
      `<div style="border-top:1px solid #dfe3e2;"><div style="padding:2rem 0;color:#5f6363;font-size:14px;font-family:${INTER};">` +
      `New roles are being finalised — check back shortly, or submit an open application below.</div></div>`;
    return MARKUP_TEMPLATE
      .replace('<!--ROLE_COUNT-->', '')
      .replace('<!--ROLE_CARDS-->', fallback)
      .replace('<!--ROLE_OPTIONS-->', roleOptionsHtml(postings));
  }

  let idx = 0;
  const nextCard = (p: CareerPosting) => roleCardHtml(p, idx++);
  let cardsBlock: string;

  if (!postings.some((p) => (p.category || '').trim())) {
    // No categories anywhere → original flat list (no card layer).
    cardsBlock = `<div style="border-top:1px solid #dfe3e2;">${postings.map(nextCard).join('\n')}</div>`;
  } else {
    // Group preserving first-seen (sortOrder) order; empty category goes last.
    const groups = new Map<string, CareerPosting[]>();
    for (const p of postings) {
      const key = (p.category || '').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    const entries = [...groups.entries()].sort((a, b) => {
      if (a[0] === '' && b[0] !== '') return 1;
      if (b[0] === '' && a[0] !== '') return -1;
      return 0; // stable sort preserves insertion order
    });
    cardsBlock = entries
      .map(
        ([category, roles]) =>
          categoryHeadHtml(category, roles.length) +
          // nextCard is only invoked here, so ids stay globally unique.
          `<div class="rv-cat-roles">${roles.map(nextCard).join('\n')}</div>`,
      )
      .join('\n');
  }

  return MARKUP_TEMPLATE
    .replace('<!--ROLE_COUNT-->', ` (${postings.length})`)
    .replace('<!--ROLE_CARDS-->', cardsBlock)
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
        if (fname) fname.textContent = f.name;
        if (chip) chip.style.display = 'flex';
        zone!.style.display = 'none';
        if (statusEl) statusEl.textContent = '';
      }
      function detach() {
        delete store[key];
        if (chip) chip.style.display = 'none';
        zone!.style.display = '';
        input!.value = '';
        if (statusEl) statusEl.textContent = '';
      }

      zone.addEventListener('click', () => input.click(), { signal });
      // The zone is a role="button" with tabindex, so keyboard users can open the picker too.
      zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      }, { signal });
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

    // ── Signed direct upload of a single file ────────────────────────────────
    /*
      Our backend returns a DISCRIMINATED UNION on `provider`, because the two
      stores need structurally different credentials: Cloudinary signs a FOLDER
      once and every file in the batch reuses it, while R2 presigns ONE PUT per
      object key. So the R2 shape is a list of targets keyed by slot, and the
      client branches on `provider` rather than guessing from which fields exist.

      Both branches resolve to the same `{ publicId, provider }` ref, which is
      all we send back — the server re-derives size and format from the store
      itself, so nothing the browser reports about a file is trusted.
    */
    interface UploadSig {
      cloudName: string; apiKey: string; timestamp: number;
      folder: string; type: string; signature: string;
    }
    interface R2Target { slot: string; uploadUrl: string; key: string; contentType: string }
    type SignatureResponse =
      | ({ success: boolean; provider?: 'cloudinary' } & UploadSig)
      | { success: boolean; provider: 'r2'; folder: string; uploads: R2Target[] };
    interface UploadedRef { publicId: string; provider: 'cloudinary' | 'r2' }

    /*
      One presigned PUT. XHR rather than fetch() purely for upload progress —
      a 30 MB video answer on a phone needs a bar, and fetch() still has no
      request-progress event.

      The Content-Type header must match what the URL was signed with or the
      signature check fails. Note this is NOT a security control: R2 does not
      verify that the bytes match the declared type (verified against the live
      bucket), which is why the server re-reads the object's first bytes and
      identifies it by magic number before accepting the application.
    */
    function uploadFileToR2(
      file: File, target: R2Target,
      labelEl: HTMLElement | null, progressWrapEl: HTMLElement | null, progressBarEl: HTMLElement | null,
    ): Promise<UploadedRef> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', target.uploadUrl, true);
        xhr.setRequestHeader('Content-Type', target.contentType);

        if (progressWrapEl) progressWrapEl.style.display = 'block';
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && progressBarEl) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            progressBarEl.style.width = `${pct}%`;
            if (labelEl) labelEl.textContent = `Uploading… ${pct}%`;
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (labelEl) labelEl.textContent = 'Uploaded ✓';
            // The key was decided by the server when it signed the URL; we echo
            // it back rather than deriving anything client-side.
            resolve({ publicId: target.key, provider: 'r2' });
          } else {
            reject(new Error(`Upload failed: HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.send(file);
      });
    }
    function uploadFileToCloudinary(
      file: File, sig: UploadSig, resourceType: 'video' | 'raw',
      labelEl: HTMLElement | null, progressWrapEl: HTMLElement | null, progressBarEl: HTMLElement | null,
    ): Promise<UploadedRef> {
      return new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('api_key', sig.apiKey);
        fd.append('timestamp', String(sig.timestamp));
        fd.append('folder', sig.folder);
        fd.append('type', sig.type);
        fd.append('signature', sig.signature);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/${resourceType}/upload`, true);

        if (progressWrapEl) progressWrapEl.style.display = 'block';
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && progressBarEl) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            progressBarEl.style.width = `${pct}%`;
            if (labelEl) labelEl.textContent = `Uploading… ${pct}%`;
          }
        };
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            let resp: { public_id: string; secure_url: string };
            try { resp = JSON.parse(xhr.responseText); } catch { reject(new Error('Bad upload response.')); return; }
            if (!resp.public_id) { reject(new Error('Upload did not return a file id.')); return; }
            if (labelEl) labelEl.textContent = 'Uploaded ✓';
            resolve({ publicId: resp.public_id, provider: 'cloudinary' });
          } else {
            reject(new Error(`Upload failed: HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.send(fd);
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
        if (!field || !field.value.trim()) { allOk = false; if (field) field.style.borderColor = '#cc0c39'; }
        else field.style.borderColor = '';
      });
      if (!allOk) { showErr('Please fill in all required fields.'); return; }

      /*
        4. File formats — checked HERE, before anything uploads.

        The `accept` attribute on the inputs is only a file-picker hint: a user
        can switch the picker to "All Files", and drag-and-drop bypasses it
        entirely. So a .jpg would land in the resume slot, upload fine, and only
        then be rejected by the API's format check — after the applicant had
        already sent two ~29 MB videos. Their files were then stranded with no
        application row, and retrying produced a fresh folder and another copy.
        That is how 1.68 GB of unattributable uploads accumulated in production.

        These lists mirror FILE_SLOTS in jobApplicationController.js. The server
        still re-validates every asset (a client check is a courtesy, never a
        control) — the point here is to fail in the half-second BEFORE the upload
        rather than the minute after it.
      */
      const extOf = (f: File) => (f.name.split('.').pop() || '').toLowerCase();
      const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v', 'ogv', 'ogg', '3gp', '3gpp', 'avi', 'mkv', 'mpeg', 'mpg'];
      const isVideo = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.includes(extOf(f));
      const isPdf = (f: File) => f.type === 'application/pdf' || extOf(f) === 'pdf';

      // 4. Videos
      if (!files.q1 || !files.q2) { showErr('Please upload video answers for both Question One and Question Two.'); return; }
      if (files.q1.size > 30 * 1024 * 1024 || files.q2.size > 30 * 1024 * 1024) { showErr('Each video must be under 30MB.'); return; }
      if (!isVideo(files.q1) || !isVideo(files.q2)) { showErr('Both answers must be video files (MP4, MOV or WEBM).'); return; }

      // 5. Resume
      if (!docs.resume) { showErr('Please upload your resume (PDF) before submitting.'); return; }
      if (docs.resume.size > 10 * 1024 * 1024) { showErr('Resume must be under 10MB.'); return; }
      if (!isPdf(docs.resume)) { showErr('Your resume must be a PDF.'); return; }
      if (docs.support && docs.support.size > 10 * 1024 * 1024) { showErr('Supporting document must be under 10MB.'); return; }
      if (docs.support && !isPdf(docs.support)) { showErr('The supporting document must be a PDF.'); return; }

      // ── Lock UI ────────────────────────────────────────────────────────────
      const btn = byId<HTMLButtonElement>('rv-submitBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; btn.style.opacity = '0.6'; }
      const overallWrap = byId('rv-overall-wrap');
      if (overallWrap) overallWrap.style.display = 'block';
      setOverall(0, 'Just A Min…');

      const howFound = sourceVal === 'Other'
        ? (byId<HTMLInputElement>('rv-other-text')?.value.trim() || 'Other')
        : sourceVal;

      const resetBtn = () => {
        if (btn) { btn.disabled = false; btn.textContent = 'Submit'; btn.style.opacity = '1'; }
        if (overallWrap) overallWrap.style.display = 'none';
      };

      (async () => {
        /*
          Declared OUTSIDE the try: the catch below needs it to hand back any
          file that uploaded before the failure. A `const` inside the try block
          is not in scope in the catch, so referencing it there throws a
          ReferenceError that masks the real error the applicant should see.
        */
        const uploaded: Record<string, UploadedRef> = {};
        try {
          /*
            Step 1: the files we are about to send. This has to be decided BEFORE
            asking for credentials, because the R2 branch presigns one PUT per
            object and therefore needs the slot and content type of each file up
            front. The Cloudinary branch ignores the list entirely.
          */
          const toUpload: {
            file: File; key: 'videoOne' | 'videoTwo' | 'resume' | 'support';
            resourceType: 'video' | 'raw'; statusId: string; progressWrap: string; progressBar: string;
          }[] = [
            { file: files.q1, key: 'videoOne', resourceType: 'video', statusId: 'q1-status', progressWrap: 'q1-progress-wrap', progressBar: 'q1-progress-bar' },
            { file: files.q2, key: 'videoTwo', resourceType: 'video', statusId: 'q2-status', progressWrap: 'q2-progress-wrap', progressBar: 'q2-progress-bar' },
            { file: docs.resume, key: 'resume', resourceType: 'raw', statusId: 'resume-status', progressWrap: 'resume-progress-wrap', progressBar: 'resume-progress-bar' },
          ];
          if (docs.support) {
            toUpload.push({ file: docs.support, key: 'support', resourceType: 'raw', statusId: 'support-status', progressWrap: 'support-progress-wrap', progressBar: 'support-progress-bar' });
          }

          // Step 2: upload credentials from our backend (files never touch us).
          setOverall(3, 'Preparing secure upload…');
          const sig = await apiClient.post<SignatureResponse>(
            '/careers/applications/upload-signature',
            {
              files: toUpload.map((u) => ({
                slot: u.key,
                // A browser can report an empty type for an unfamiliar
                // extension; falling back keeps the server's allowlist as the
                // single place that decides, instead of failing here silently.
                contentType: u.file.type || (u.resourceType === 'raw' ? 'application/pdf' : 'video/mp4'),
              })),
            },
          );

          /*
            Targets are matched by SLOT, not by array position: relying on order
            would break the moment either side reorders or drops the optional
            supporting document.
          */
          const r2Targets = new Map<string, R2Target>(
            sig.provider === 'r2' ? sig.uploads.map((t) => [t.slot, t]) : [],
          );
          if (sig.provider === 'r2') {
            const missing = toUpload.find((u) => !r2Targets.has(u.key));
            if (missing) throw new Error('Upload could not be prepared. Please try again.');
          }

          // Step 3: upload every file straight to storage (parallel).
          setOverall(5, 'Uploading files…');

          let completed = 0;
          const total = toUpload.length;
          /*
            allSettled, not all. `Promise.all` rejects on the FIRST failure while
            its siblings keep uploading — so a batch where the resume failed but
            both videos succeeded left those videos in storage with nothing
            tracking them, and the in-flight ones landed after we had already
            given up. Settling every upload means `uploaded` is complete and
            accurate by the time we decide what to do, which is what makes the
            cleanup below able to remove everything.
          */
          const results = await Promise.allSettled(toUpload.map((item) => {
            const label = byId(item.statusId);
            const wrap = byId(item.progressWrap);
            const bar = byId(item.progressBar);
            const put = sig.provider === 'r2'
              ? uploadFileToR2(item.file, r2Targets.get(item.key)!, label, wrap, bar)
              : uploadFileToCloudinary(item.file, sig as UploadSig, item.resourceType, label, wrap, bar);
            return put.then((ref) => {
              uploaded[item.key] = ref;
              completed++;
              setOverall(5 + Math.round((completed / total) * 85), `Uploading files… (${completed}/${total} done)`);
            });
          }));
          const failedUpload = results.find((r) => r.status === 'rejected');
          if (failedUpload) {
            throw failedUpload.reason instanceof Error
              ? failedUpload.reason
              : new Error('One of your files failed to upload. Please try again.');
          }

          // Step 3: submit the application (refs + fields) to our API.
          setOverall(92, 'Saving your application…');
          if (btn) btn.textContent = 'Saving…';
          await apiClient.post('/careers/applications', {
            role,
            fullName: el('fullName')?.value || '',
            city: el('city')?.value || '',
            email: el('email')?.value || '',
            phone: el('phone')?.value || '',
            whatYouBring: el('whatYouBring')?.value || '',
            howFound,
            files: uploaded,
          });

          if (unmounted) return;
          setOverall(100, 'Done.');
          const formSection = byId('rv-form');
          if (formSection) formSection.style.display = 'none';
          all('section').forEach((s) => { if (s.id !== 'rv-success') s.style.display = 'none'; });
          const success = byId('rv-success');
          if (success) success.style.display = 'flex';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          /*
            Anything that fails AFTER a file has uploaded leaves that file in
            storage with no application row pointing at it — and because the
            folder nonce is minted before the applicant types a name or email,
            such a file cannot afterwards be attributed to anyone, contacted
            about, or covered by a data-subject request. Retrying mints a fresh
            folder, so each attempt used to leak another full set: 237 assets
            and 1.68 GB accumulated in production this way.

            So we hand back what we uploaded. Best-effort and deliberately
            silent: the applicant is already looking at an error, and a failure
            to tidy up must not replace their message with a worse one. The
            endpoint refuses any id that a real application references, so this
            can only ever remove genuinely unattached files.

            Note this runs for upload failures AND for a rejected submit — the
            latter being the common case, since the API re-validates every asset.
          */
          const strays = Object.values(uploaded).map((u) => u.publicId).filter(Boolean);
          if (strays.length) {
            apiClient.post('/careers/applications/cleanup', { publicIds: strays }).catch(() => {});
          }
          if (unmounted) return;
          showErr(err instanceof Error ? err.message : 'Something went wrong. Please check your connection and try again.');
          resetBtn();
        }
      })();
    }, { signal });

    return () => { unmounted = true; ac.abort(); };
  }, [markup]);

  return <div ref={rootRef} className="rv-careers-page" dangerouslySetInnerHTML={{ __html: markup }} />;
}
