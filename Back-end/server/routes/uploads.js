/**
 * Upload signature + cleanup routes.
 *
 * Issues short-lived signatures so the admin browser can upload image bytes
 * DIRECTLY to Cloudinary (bypassing our API + the ~4.5 MB proxy request-body
 * limit) and then send back only the resulting { url, public_id }.
 *
 * The API secret never leaves the server. The target folder is constrained to a
 * server-side allowlist so a client can't write into arbitrary Cloudinary paths.
 */
import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { generateUploadSignature, deleteManyFromCloudinary } from "../utils/cloudinaryHelpers.js";

const router = express.Router();

// Short client-facing keys → the only base folders admins may upload into.
// Must match the folders that already exist in Cloudinary.
const ALLOWED_FOLDERS = {
  products:   "autobacs/products",
  brands:     "autobacs/brands",
  vehicles:   "autobacs/vehicle and makes",
  categories: "autobacs/categories",
  articles:   "autobacs/articles",
  media:      "autobacs/media",
};

/** A 24-char hex Mongo ObjectId — the only per-entity subfolder we accept. */
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// @route   POST /uploads/signature
// @desc    Issue a signed params set for a direct browser→Cloudinary upload
// @access  Private/Admin
router.post(
  "/signature",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const key = typeof req.body?.folder === "string" ? req.body.folder : "products";
    let folder = ALLOWED_FOLDERS[key] || ALLOWED_FOLDERS.products;

    // Optional per-entity subfolder (e.g. autobacs/products/<productId>) so
    // assets stay grouped for bulk-delete/debugging. Only a valid ObjectId is
    // accepted — never a client-supplied arbitrary path.
    const subId = req.body?.subId;
    if (subId && OBJECT_ID.test(String(subId))) {
      folder = `${folder}/${subId}`;
    }

    res.json({ success: true, ...generateUploadSignature({ folder }) });
  })
);

// @route   POST /uploads/cleanup
// @desc    Best-effort delete of assets a client uploaded directly but couldn't
//          attach to a record (e.g. a mid-batch failure aborted the save).
// @access  Private/Admin
router.post(
  "/cleanup",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const raw = Array.isArray(req.body?.publicIds) ? req.body.publicIds : [];
    // Only our own folders, capped — never let a client delete an arbitrary asset.
    const ids = raw
      .filter((id) => typeof id === "string" && id.startsWith("autobacs/"))
      .slice(0, 20);
    if (ids.length) await deleteManyFromCloudinary(ids);
    res.json({ success: true, deleted: ids.length });
  })
);

export default router;
