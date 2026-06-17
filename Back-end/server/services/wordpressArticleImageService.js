/**
 * Rehost WordPress blog-post images → Cloudinary (ADR-005, pre-decommission).
 *
 * Imported `Article`s (type:'blog', wpId) keep their cover image and inline <img>s on the
 * WordPress CDN (autobacsindia.com/wp-content). Those break the moment WP is switched off.
 * This downloads each WP-hosted image, uploads it to Cloudinary, and rewrites the URLs in
 * both `coverImage` and the `content` HTML.
 *
 * Contract mirrors the other WP services:
 *   • assumes mongoose is ALREADY connected; never opens/closes a connection or exits.
 *   • idempotent + non-destructive: images already on Cloudinary are skipped; re-runnable.
 *   • returns structured stats; throws only on misconfiguration / fatal error.
 */
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';

import Article from '../models/Article.js';

function getConfig() {
  const hasCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  if (!hasCloudinary) throw new Error('Article image rehost requires CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET');
  let wpHost = '';
  try { wpHost = new URL(process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').host; } catch { /* optional */ }
  return { wpHost };
}

const isWpImage = (url, wpHost) => {
  if (!url || !/^https?:\/\//.test(url)) return false;
  if (url.includes('res.cloudinary.com')) return false;
  return url.includes('/wp-content/') || (wpHost && url.includes(wpHost));
};

const downloadBuffer = (url) => new Promise((resolve, reject) => {
  if (!url?.startsWith('http')) return reject(new Error(`Not a valid URL: "${url}"`));
  const lib = url.startsWith('https') ? https : http;
  lib.get(url, { timeout: 20000 }, (res) => {
    if ([301, 302].includes(res.statusCode) && res.headers.location) return downloadBuffer(res.headers.location).then(resolve).catch(reject);
    if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
});

const uploadBuffer = (buffer, publicId) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    {
      public_id: publicId, overwrite: true, invalidate: true,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'],
      transformation: [{ fetch_format: 'auto', quality: 'auto' }],
    },
    (err, result) => err ? reject(err) : resolve(result.secure_url)
  );
  stream.end(buffer);
});

/**
 * @param {object}  opts
 * @param {boolean} opts.dryRun  count WP-hosted images, write/upload nothing (default true)
 * @param {object}  opts.logger  { log, warn, error } (default console)
 */
export async function runArticleImageRehost({ dryRun = true, logger = console } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('runArticleImageRehost requires an active mongoose connection');
  }
  const { wpHost } = getConfig();
  const log = (...a) => logger.log?.(...a);
  const errlog = (...a) => logger.error?.(...a);

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  const stats = { articles: 0, articlesChanged: 0, coverRehosted: 0, inlineRehosted: 0, skipped: 0, failed: 0 };
  const t0 = Date.now();
  log(`Article image rehost → Cloudinary ${dryRun ? '(DRY RUN — no upload/write)' : ''}`);

  // Rehost one WP image; returns the new URL (or the original on failure/dry-run).
  const rehost = async (url, publicId) => {
    if (dryRun) return url;
    const buf = await downloadBuffer(url);
    return uploadBuffer(buf, publicId);
  };

  const articles = await Article.find(
    { wpId: { $exists: true } },
    { _id: 1, coverImage: 1, content: 1 }
  );
  stats.articles = articles.length;

  for (const article of articles) {
    let changed = false;
    const id = article._id;

    // ── Cover image ────────────────────────────────────────────────────────────
    if (isWpImage(article.coverImage, wpHost)) {
      try {
        const newUrl = await rehost(article.coverImage, `autobacs/articles/${id}/cover`);
        if (!dryRun) article.coverImage = newUrl;
        stats.coverRehosted++; changed = true;
      } catch (err) { errlog(`  ✗ cover [${id}]: ${err.message}`); stats.failed++; }
    }

    // ── Inline content images ────────────────────────────────────────────────────
    // Sweep the whole HTML string (not just <img src>) so we also catch <a href> lightbox
    // links, data-* attributes and inline styles. srcset variants are dropped first so we
    // don't rehost every resized copy of the same image; the canonical URL is rehosted below.
    if (article.content && article.content.includes('/wp-content/')) {
      let html = article.content.replace(/\s+srcset=("|')[^"']*\1/gi, '').replace(/\s+data-src=("|')[^"']*\1/gi, '');
      const urls = [...new Set(
        (html.match(/https?:\/\/[^\s"'<>()]+\/wp-content\/uploads\/[^\s"'<>()]+?\.(?:jpe?g|png|webp|gif|avif)(?:\?[^\s"'<>()]*)?/gi) || [])
          .filter(u => isWpImage(u, wpHost))
      )];
      for (const url of urls) {
        try {
          // Stable public_id from the source URL → idempotent across re-runs.
          const pid = `autobacs/articles/${id}/${crypto.createHash('md5').update(url).digest('hex').slice(0, 16)}`;
          const newUrl = await rehost(url, pid);
          if (!dryRun) html = html.split(url).join(newUrl);
          stats.inlineRehosted++; changed = true;
        } catch (err) { errlog(`  ✗ inline [${id}] ${url}: ${err.message}`); stats.failed++; }
      }
      if (!dryRun && html !== article.content) article.content = html;
    }

    if (changed) {
      stats.articlesChanged++;
      if (!dryRun) await Article.updateOne({ _id: id }, { $set: { coverImage: article.coverImage, content: article.content } });
    } else {
      stats.skipped++;
    }
  }

  log(`Articles ${stats.articles}, changed ${stats.articlesChanged}, covers ${stats.coverRehosted}, inline ${stats.inlineRehosted}, no-wp-images ${stats.skipped}, failed ${stats.failed}`);
  const durationMs = Date.now() - t0;
  log(`Article image rehost done in ${(durationMs / 1000).toFixed(1)}s`);
  return { ok: stats.failed === 0, stats, durationMs };
}

export default runArticleImageRehost;
