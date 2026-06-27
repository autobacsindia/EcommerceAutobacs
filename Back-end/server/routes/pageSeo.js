import express from "express";
import pageSeoRepository from "../repositories/pageSeoRepository.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { normalizeSeo } from "../utils/seo.js";
import { STATIC_PAGES, STATIC_PAGE_BY_PATH } from "../config/staticPages.js";

const router = express.Router();

/** Normalize a route path to the stored form: lowercase, leading slash, no trailing slash (except root). */
function normalizePath(raw) {
  if (typeof raw !== "string") return null;
  let p = raw.trim().toLowerCase();
  if (!p.startsWith("/")) return null;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (p.length > 200) return null;
  return p;
}

// ─── PUBLIC: resolve SEO overrides for one route ─────────────────────────────
// GET /page-seo?path=/careers  → { success, data: { path, seo } | null }
// Read at SSR/ISR time by the page's generateMetadata; blank fields fall back to
// the page's computed defaults on the frontend.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const path = normalizePath(req.query.path);
    if (!path) {
      return res.status(400).json({ success: false, message: "A valid 'path' query param is required" });
    }
    const doc = await pageSeoRepository.findOne({ path }).lean();
    res.json({ success: true, data: doc ? { path: doc.path, seo: doc.seo || {} } : null });
  })
);

// ─── ADMIN: list every manageable page (config ⨝ stored overrides) ───────────
// GET /page-seo/admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (_req, res) => {
    const stored = await pageSeoRepository.find({}).lean();
    const byPath = new Map(stored.map((d) => [d.path, d]));

    // Start from the known catalogue so the admin always sees the full list,
    // even for pages never edited yet.
    const rows = STATIC_PAGES.map((cfg) => {
      const doc = byPath.get(cfg.path);
      return {
        path: cfg.path,
        label: cfg.label,
        group: cfg.group,
        defaultTitle: cfg.defaultTitle,
        defaultDescription: cfg.defaultDescription,
        seo: doc?.seo || {},
        updatedAt: doc?.updatedAt || null,
      };
    });

    // Surface any stored rows for paths no longer in the catalogue (renamed /
    // removed routes) so they're visible and can be cleaned up.
    for (const doc of stored) {
      if (!STATIC_PAGE_BY_PATH.has(doc.path)) {
        rows.push({
          path: doc.path,
          label: doc.path,
          group: "Other",
          defaultTitle: "",
          defaultDescription: "",
          seo: doc.seo || {},
          updatedAt: doc.updatedAt || null,
        });
      }
    }

    res.json({ success: true, data: rows });
  })
);

// ─── ADMIN: upsert SEO overrides for one page ────────────────────────────────
// PUT /page-seo/admin   body: { path, seo }
router.put(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const path = normalizePath(req.body.path);
    if (!path) {
      return res.status(400).json({ success: false, message: "A valid 'path' is required" });
    }

    const seo = normalizeSeo(req.body.seo);
    const doc = await pageSeoRepository.findOneAndUpdate(
      { path },
      { $set: { seo, updatedBy: req.user?._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();

    res.json({ success: true, data: { path: doc.path, seo: doc.seo || {}, updatedAt: doc.updatedAt } });
  })
);

export default router;
