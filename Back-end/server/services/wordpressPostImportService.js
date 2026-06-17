/**
 * WordPress blog posts → Mongo `Article` (ADR-005, residual WP migration).
 *
 * Pulls the public `wp/v2/posts` feed (the WooCommerce keys only auth `wc/v3`; posts are
 * read publicly). Pages are intentionally skipped — they are page-builder leftovers.
 *
 * Contract mirrors the other WP importers:
 *   • assumes mongoose is ALREADY connected; never opens/closes a connection or exits.
 *   • idempotent + non-destructive: upsert keyed on `wpId`; never deletes.
 *   • returns structured stats; throws only on fatal error.
 *
 * `publishedAt`/`createdAt` are preserved (raw write) so the blog keeps its real history.
 * NOTE: inline <img> and cover images still point at the WordPress CDN — fine while WP is
 * alive; rehosting post-body media to Cloudinary is a follow-up before full decommission.
 */
import axios from 'axios';
import mongoose from 'mongoose';
import { load as loadHtml } from 'cheerio';

import Article from '../models/Article.js';
import ImportJob from '../models/ImportJob.js';

function getBase() {
  const base = (process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('WordPress post import misconfigured: set WORDPRESS_SITE_URL');
  return base;
}

const decode = (s) => {
  if (s == null) return '';
  const str = String(s);
  if (!str.includes('&') && !str.includes('<')) return str.trim();
  return loadHtml(`<root>${str}</root>`)('root').text().replace(/\s+/g, ' ').trim();
};

/**
 * @param {object}  opts
 * @param {boolean} opts.dryRun  compute counts, write nothing (default true)
 * @param {object}  opts.logger  { log, warn, error } (default console)
 */
export async function runPostImport({ dryRun = true, logger = console } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('runPostImport requires an active mongoose connection');
  }
  const base = getBase();
  const log = (...a) => logger.log?.(...a);
  const warn = (...a) => logger.warn?.(...a);
  const errlog = (...a) => logger.error?.(...a);

  const wp = axios.create({ baseURL: `${base}/wp-json/wp/v2`, timeout: 60000 });

  const stats = { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  const t0 = Date.now();
  log(`WP posts → Mongo ${dryRun ? '(DRY RUN — no writes)' : ''} — source ${base}`);

  let job = null;
  if (!dryRun) {
    try {
      job = await ImportJob.create({
        jobId: `wp-posts-${Date.now()}`, source: 'wordpress-posts',
        status: 'running', startedAt: new Date(),
      });
    } catch (e) { warn(`ImportJob create failed (continuing): ${e.message}`); }
  }

  try {
    const posts = [];
    let page = 1;
    while (true) {
      const res = await wp.get('/posts', { params: { per_page: 100, page, status: 'publish', _embed: 1, orderby: 'date', order: 'asc' } });
      posts.push(...res.data);
      if (res.data.length < 100) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    }
    stats.fetched = posts.length;
    log(`Fetched ${stats.fetched} WordPress posts`);

    for (const p of posts) {
      try {
        const slug = p.slug;
        const title = decode(p.title?.rendered) || slug;
        const content = p.content?.rendered || '';
        if (!slug || !content) { stats.skipped++; continue; }

        const embedded = p._embedded || {};
        const coverImage = embedded['wp:featuredmedia']?.[0]?.source_url || '';
        const terms = (embedded['wp:term'] || []).flat();
        const category = terms.find(t => t.taxonomy === 'category')?.name || 'General';
        const tags = terms.filter(t => t.taxonomy === 'post_tag').map(t => decode(t.name)).filter(Boolean);
        const published = new Date(p.date_gmt ? `${p.date_gmt}Z` : p.date);

        const data = {
          wpId: p.id,
          wpUrl: p.link,
          title,
          slug,
          type: 'blog',
          coverImage,
          excerpt: decode(p.excerpt?.rendered).slice(0, 500),
          content,
          category: decode(category) || 'General',
          tags,
          author: decode(embedded.author?.[0]?.name) || 'Autobacs Team',
          status: 'published',
          publishedAt: published,
        };

        const doc = new Article(data);
        await doc.validate();

        if (dryRun) {
          const exists = await Article.exists({ wpId: p.id });
          exists ? stats.updated++ : stats.created++;
          continue;
        }

        const plain = doc.toObject({ depopulate: true });
        // Match on wpId first; fall back to slug so a pre-existing same-slug Article
        // (e.g. a manual draft) is CLAIMED and updated rather than colliding on the
        // unique slug index. The published WordPress post is the source of truth.
        const existing = await Article.collection.findOne(
          { $or: [{ wpId: p.id }, { slug }] },
          { projection: { _id: 1, createdAt: 1, views: 1 } }
        );
        if (existing) {
          plain._id = existing._id;
          plain.createdAt = existing.createdAt || published;
          plain.views = existing.views || 0; // don't reset accumulated views on re-import
          await Article.collection.replaceOne({ _id: existing._id }, plain);
          stats.updated++;
        } else {
          plain.createdAt = published;
          await Article.collection.insertOne(plain);
          stats.created++;
        }
      } catch (err) {
        errlog(`  ✗ Post [${p.id}] "${p.slug}": ${err.message}`);
        stats.failed++;
      }
    }

    log(`Posts — created ${stats.created}, updated ${stats.updated}, skipped ${stats.skipped}, failed ${stats.failed}`);
    if (job) {
      job.status = 'completed'; job.completedAt = new Date(); job.progress = 100;
      job.totalProducts = stats.fetched;
      job.importedProducts = stats.created + stats.updated;
      job.failedProducts = stats.failed; job.skippedProducts = stats.skipped;
      await job.save().catch(() => {});
    }
    const durationMs = Date.now() - t0;
    log(`WP post import done in ${(durationMs / 1000).toFixed(1)}s`);
    return { ok: stats.failed === 0, stats, durationMs };
  } catch (err) {
    if (job) { job.status = 'failed'; job.failedAt = new Date(); job.errorMessage = err.message; await job.save().catch(() => {}); }
    throw err;
  }
}

export default runPostImport;
