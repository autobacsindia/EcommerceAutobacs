/**
 * JobApplication controller — public submission (files already on Cloudinary)
 * + admin review inbox. Replaces the Google Apps Script → Drive → Sheet flow.
 *
 * Trust boundary: the two public endpoints are unauthenticated, so they are
 * rate-limited (route layer) and — critically — the submit handler
 * RE-VALIDATES every file server-side against the Cloudinary Admin API: each
 * publicId must actually exist, live under the careers folder, be within the
 * per-slot size cap, and match the expected format (PDF / video). A client
 * cannot attach a spoofed, oversized, wrong-type, or foreign asset by lying in
 * the JSON payload.
 *
 * (Bot protection via Cloudflare Turnstile was intentionally NOT shipped: it
 * needs a rendered widget + CSP entries to work, which aren't in place. Add it
 * as a complete unit — widget + CSP + a SINGLE front-door verify on the
 * signature endpoint — if abuse volume warrants it.)
 */

import crypto from 'crypto';
import jobApplicationRepository from '../repositories/jobApplicationRepository.js';
import jobPostingRepository from '../repositories/jobPostingRepository.js';
import {
  CAREERS_FOLDER_BASE,
  deleteCareersAsset,
  generateCareersUploadSignature,
  getCareersResource,
  signedCareersAssetUrl,
} from '../utils/careersCloudinary.js';
import { enqueueNotification } from '../queue/queues.js';

const MB = 1024 * 1024;
const VIDEO_MAX_BYTES = 30 * MB;
const PDF_MAX_BYTES = 10 * MB;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

const STATUSES = ['new', 'reviewing', 'shortlisted', 'rejected', 'hired'];

// Accepted Cloudinary `format` values per slot. Raw (PDF) slots are the real
// risk — /raw/upload stores arbitrary bytes without decoding — so they are
// pinned to 'pdf'. Video slots are already constrained by resource_type=video
// (Cloudinary fails to ingest a non-media file there), but we still allowlist
// common container formats as defence in depth.
const PDF_FORMATS = ['pdf'];
const VIDEO_FORMATS = ['mp4', 'mov', 'webm', 'm4v', 'ogv', 'ogg', '3gp', '3gpp', 'avi', 'mkv', 'quicktime', 'x-matroska', 'mpeg', 'mpg'];

// The four file slots and how each is validated. Order matters for the response.
const FILE_SLOTS = [
  { key: 'videoOne', label: 'Video answer 1', resourceType: 'video', max: VIDEO_MAX_BYTES, formats: VIDEO_FORMATS, required: true },
  { key: 'videoTwo', label: 'Video answer 2', resourceType: 'video', max: VIDEO_MAX_BYTES, formats: VIDEO_FORMATS, required: true },
  { key: 'resume', label: 'Resume', resourceType: 'raw', max: PDF_MAX_BYTES, formats: PDF_FORMATS, required: true },
  { key: 'support', label: 'Supporting document', resourceType: 'raw', max: PDF_MAX_BYTES, formats: PDF_FORMATS, required: false },
];

const str = (v, cap) => (typeof v === 'string' ? v.trim().slice(0, cap) : '');
const clientIp = (req) => (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '').slice(0, 60);

// ── Public ──────────────────────────────────────────────────────────────────

// @desc    Issue a signed params set for direct browser→Cloudinary careers uploads
// @route   POST /careers/applications/upload-signature
// @access  Public (rate-limited)
export const getUploadSignature = async (_req, res) => {
  // Server-chosen per-applicant subfolder (unguessable) — the client never picks
  // the folder, so it can only ever write inside autobacs/careers/<nonce>.
  const nonce = crypto.randomBytes(12).toString('hex');
  const folder = `${CAREERS_FOLDER_BASE}/${nonce}`;
  res.json({ success: true, ...generateCareersUploadSignature({ folder }) });
};

/**
 * Extract the ONLY client-supplied file value we trust enough to look up: the
 * publicId. Everything else the client sends about a file (url, bytes, type) is
 * ignored — those are derived server-side from Cloudinary. Returns '' when absent.
 */
const pickPublicId = (raw) => {
  if (!raw || typeof raw !== 'object') return '';
  return typeof raw.publicId === 'string' ? raw.publicId.trim() : '';
};

/**
 * Effective format for a Cloudinary resource. Cloudinary populates `format` for
 * DECODED media (video/image) but leaves it undefined for `raw` resources —
 * there the extension is carried in the public_id instead (…/abc.pdf). Fall back
 * to the public_id suffix so raw (PDF) slots validate instead of always failing
 * the format check. NOTE: for raw this is an extension check (the bytes are not
 * decoded); it is one layer alongside the folder scope, size cap, and private
 * `authenticated` storage — not a content-sniff.
 */
const resourceFormat = (resource, publicId) => {
  if (resource.format) return String(resource.format).toLowerCase();
  const m = String(publicId).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
};

// @desc    Delete careers uploads that never became an application
// @route   POST /careers/applications/cleanup
// @access  Public (rate-limited)
//
// The careers form uploads files to Cloudinary BEFORE this API validates the
// submission, so any failure after the upload — a rejected submission, a dropped
// connection, one file of the batch failing — used to strand those files
// permanently. They carried no identity either: the folder nonce is minted at
// signature time, before the applicant has supplied a name or email, so nothing
// could attribute, contact, or honour a data-subject request for them. 237 such
// assets (1.68 GB) accumulated in production before this endpoint existed.
//
// This is the careers equivalent of the admin flow's POST /uploads/cleanup.
//
// ── Why this is safe to expose publicly ────────────────────────────────────
// The careers form is unauthenticated, so this endpoint is too, which means an
// attacker can call it with any publicId they like. Two guards make that
// harmless:
//
//   1. the id must live under autobacs/careers/ — nothing else is reachable;
//   2. the asset must NOT be referenced by any JobApplication.
//
// (2) is the load-bearing one. An asset becomes referenced the instant its
// application is created, so a submitted applicant's video can never be deleted
// through here — only genuinely unattached uploads can. The remaining window is
// an in-flight submission, and reaching that needs the server-minted random
// folder nonce, which is not guessable and never leaves that applicant's browser.
export const cleanupOrphanedUploads = async (req, res) => {
  const raw = Array.isArray(req.body?.publicIds) ? req.body.publicIds : [];

  // At most one submission's worth of files (4 slots) — with headroom, not a
  // bulk-delete channel.
  const candidates = raw
    .filter((id) => typeof id === 'string' && id.startsWith(`${CAREERS_FOLDER_BASE}/`))
    .slice(0, 8);

  if (!candidates.length) return res.json({ success: true, deleted: 0 });

  // Guard 2: refuse anything a real application points at.
  const referenced = await jobApplicationRepository.findReferencingFiles(
    candidates,
    FILE_SLOTS.map((s) => s.key),
  );

  const protectedIds = new Set();
  for (const app of referenced) {
    for (const slot of FILE_SLOTS) {
      const pid = app.files?.[slot.key]?.publicId;
      if (pid) protectedIds.add(pid);
    }
  }

  const deletable = candidates.filter((id) => !protectedIds.has(id));
  if (protectedIds.size) {
    console.warn(`[Careers] cleanup refused ${protectedIds.size} id(s) attached to a real application`);
  }

  let deleted = 0;
  for (const publicId of deletable) {
    // resource_type is unknown to the client, so try the two we ever write.
    // Best-effort throughout: a failed cleanup must never surface as an error to
    // an applicant who is already looking at a failure message.
    for (const resourceType of ['video', 'raw']) {
      const ok = await deleteCareersAsset(publicId, resourceType).catch(() => false);
      if (ok) { deleted += 1; break; }
    }
  }

  return res.json({ success: true, deleted });
};

// @desc    Submit a careers application (files already uploaded to Cloudinary)
// @route   POST /careers/applications
// @access  Public (rate-limited)
export const submitApplication = async (req, res) => {
  const b = req.body || {};

  // ── Metadata validation ────────────────────────────────────────────────────
  const roleTitle = str(b.role, 200);
  const fullName = str(b.fullName, 160);
  const city = str(b.city, 160);
  const email = str(b.email, 200).toLowerCase();
  const whatYouBring = str(b.whatYouBring, 5000);
  const phone = str(b.phone, 40);
  const howFound = str(b.howFound, 200);

  if (!roleTitle) return res.status(400).json({ success: false, message: 'Please select the role you are applying for.' });
  if (!fullName || !city || !email || !whatYouBring) {
    return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  // Resolve the role to a posting when the title matches an open one (snapshot
  // title is kept regardless, so open applications and later edits are safe).
  const match = await jobPostingRepository.findOpenIdByTitle(roleTitle);
  const posting = match ? match._id : null;

  // ── File validation (server-side, against Cloudinary) ──────────────────────
  const files = {};
  for (const slot of FILE_SLOTS) {
    const publicId = pickPublicId(b.files?.[slot.key]);
    if (!publicId) {
      if (slot.required) {
        return res.status(400).json({ success: false, message: `${slot.label} is required.` });
      }
      continue;
    }

    // The publicId MUST live under our careers folder — blocks attaching a
    // foreign/other-tenant asset by pasting its id.
    if (!publicId.startsWith(`${CAREERS_FOLDER_BASE}/`)) {
      return res.status(400).json({ success: false, message: `${slot.label}: invalid upload reference.` });
    }

    const resource = await getCareersResource(publicId, slot.resourceType);
    if (!resource) {
      return res.status(400).json({ success: false, message: `${slot.label}: upload could not be verified. Please re-upload.` });
    }
    if (resource.bytes > slot.max) {
      const cap = slot.max === VIDEO_MAX_BYTES ? '30MB' : '10MB';
      return res.status(400).json({ success: false, message: `${slot.label} exceeds the ${cap} limit.` });
    }
    // Reject a mismatched asset type (e.g. an HTML/exe smuggled into a raw PDF
    // slot) — the byte cap alone would let it through.
    const format = resourceFormat(resource, publicId);
    if (slot.formats && !slot.formats.includes(format)) {
      const want = slot.resourceType === 'raw' ? 'a PDF' : 'a video (MP4/MOV/WEBM)';
      return res.status(400).json({ success: false, message: `${slot.label} must be ${want}.` });
    }

    // Persist only server-derived values. The client's `url`/`bytes`/`type` are
    // never trusted or stored — admins view files via a URL we re-sign from the
    // publicId, so no attacker-controlled string ever lands in our data.
    files[slot.key] = {
      publicId,
      resourceType: slot.resourceType,
      bytes: resource.bytes,
    };
  }

  const application = await jobApplicationRepository.create({
    posting,
    roleTitle,
    fullName,
    city,
    email,
    phone,
    whatYouBring,
    howFound,
    files,
    meta: { ip: clientIp(req), userAgent: str(req.headers['user-agent'], 400) },
  });

  // Notify the support inbox + acknowledge to the candidate — best-effort, async
  // (mirrors consultation flow). Never block the submit response on email.
  const applicationId = application._id.toString();
  enqueueNotification('send-admin-careers-alert', { applicationId });
  enqueueNotification('send-careers-acknowledgement', { applicationId });

  res.status(201).json({ success: true, message: 'Application received.' });
};

// ── Admin ───────────────────────────────────────────────────────────────────

// @desc    List applications (paginated, filterable)
// @route   GET /careers/admin/applications
// @access  Private/Admin
export const listApplications = async (req, res) => {
  const filter = {};
  if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (typeof req.query.role === 'string' && req.query.role.trim()) {
    filter.roleTitle = req.query.role.trim();
  }
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);

  const { items, total, pages } = await jobApplicationRepository.listPaged({ filter, page, limit });
  res.json({ success: true, applications: items, pagination: { page, pages, total } });
};

/** Replace stored file refs with freshly-signed, viewable delivery URLs. */
// Async because signing an R2 asset is a presign call, not a local HMAC as it
// is for Cloudinary. The slots are signed in parallel: one application has at
// most four, and doing them in series would add a round-trip each.
const withSignedFiles = async (app) => {
  const present = FILE_SLOTS
    .map((slot) => ({ slot, f: app.files?.[slot.key] }))
    .filter(({ f }) => f?.publicId);

  const urls = await Promise.all(present.map(({ slot, f }) =>
    // `f` is passed whole so the minter can read its `provider`.
    signedCareersAssetUrl(f.publicId, f.resourceType || slot.resourceType, f)));

  const signed = {};
  present.forEach(({ slot, f }, i) => {
    signed[slot.key] = { url: urls[i], bytes: f.bytes || 0 };
  });
  return { ...app, files: signed };
};

// @desc    Single application with signed file URLs
// @route   GET /careers/admin/applications/:id
// @access  Private/Admin
export const getApplication = async (req, res) => {
  const app = await jobApplicationRepository.findByIdPopulated(req.params.id);
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, application: await withSignedFiles(app) });
};

// @desc    Update status / admin notes
// @route   PATCH /careers/admin/applications/:id
// @access  Private/Admin
export const updateApplication = async (req, res) => {
  const app = await jobApplicationRepository.findById(req.params.id);
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const previousStatus = app.status;
    app.status = req.body.status;

    /*
      Maintain the retention clock on the transition, not in the sweep. Entering
      `rejected` starts the window; leaving it clears the stamp so an applicant
      who is reconsidered is no longer queued for media deletion.

      Only stamp on an ACTUAL transition — re-saving an already-rejected
      application (an admin editing notes) must not restart the window, which is
      the whole reason this is not derived from `updatedAt`.
    */
    if (app.status === 'rejected' && previousStatus !== 'rejected') {
      app.rejectedAt = new Date();
    } else if (app.status !== 'rejected' && previousStatus === 'rejected') {
      app.rejectedAt = null;
    }
  }
  if (req.body.adminNotes !== undefined) {
    app.adminNotes = str(req.body.adminNotes, 5000);
  }
  await app.save();

  // Mail the candidate the rejection notice whenever the application is rejected
  // and hasn't been emailed yet — async + idempotent. Keying on rejectionEmailedAt
  // (rather than only the status transition) means a backlog of applications that
  // were rejected BEFORE this feature shipped also gets the email on their next
  // save, and the service's status + rejectionEmailedAt guards make a repeat
  // enqueue a no-op, so the candidate is never mailed twice.
  if (app.status === 'rejected' && !app.rejectionEmailedAt) {
    console.log(`[CareersEmail] rejection: enqueuing for application ${app._id} (${app.email})`);
    enqueueNotification('send-careers-rejection', { applicationId: app._id.toString() });
  }

  res.json({ success: true, application: app });
};
