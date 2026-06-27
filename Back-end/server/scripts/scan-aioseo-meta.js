/**
 * DIAGNOSTIC (read-only). Quantifies how much per-product SEO customization the
 * store actually has, using the _aioseo_* meta the WC REST API exposes.
 *
 * The CORE fields (SEO title / meta description) live in AIOSEO's private table
 * and are NOT counted here — but the OG/Twitter/keywords overrides ARE a strong
 * proxy: a store that customizes SEO per product tends to fill these too. If they
 * are ~all empty, the store relies on AIOSEO templates and our computed defaults
 * already cover it.
 *
 * Writes nothing. Paginates all published products.
 *
 *   railway run node --import=dotenv/config scripts/scan-aioseo-meta.js
 */
import axios from 'axios';

function cfg() {
  const base = (process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').replace(/\/$/, '');
  const key = process.env.WORDPRESS_API_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!base || !key || !secret) throw new Error('Set WORDPRESS_SITE_URL + WC key/secret');
  return { base, key, secret };
}

// Non-empty = a real override. AIOSEO stores empty strings / "[]" for unset.
function nonEmpty(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  const s = String(v).trim();
  return s !== '' && s !== '[]' && s !== 'null';
}

async function main() {
  const c = cfg();
  const wc = axios.create({
    baseURL: `${c.base}/wp-json`,
    auth: { username: c.key, password: c.secret },
    timeout: 60000,
    validateStatus: () => true,
  });

  const counts = {};            // key -> # products with a non-empty value
  let total = 0, anyOverride = 0;
  const examples = [];          // products that DO have a non-empty override
  let page = 1;

  while (true) {
    const res = await wc.get('/wc/v3/products', { params: { per_page: 100, page, status: 'publish' } });
    if (res.status !== 200) { console.log(`HTTP ${res.status} on page ${page}`); break; }
    if (!res.data.length) break;

    for (const p of res.data) {
      total++;
      let productHasOne = false;
      for (const m of p.meta_data || []) {
        if (!/^_aioseo_/.test(m.key)) continue;
        if (nonEmpty(m.value)) {
          counts[m.key] = (counts[m.key] || 0) + 1;
          productHasOne = true;
        }
      }
      if (productHasOne) {
        anyOverride++;
        if (examples.length < 10) examples.push(`#${p.id} /${p.slug}`);
      }
    }

    if (res.data.length < 100) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log('\n--- AIOSEO per-product override scan ---');
  console.log(`products scanned            : ${total}`);
  console.log(`products with ANY override  : ${anyOverride}  (${total ? ((anyOverride / total) * 100).toFixed(1) : 0}%)`);
  console.log('per-field non-empty counts  :');
  const keys = Object.keys(counts).sort();
  if (keys.length === 0) console.log('   (none — every reachable _aioseo_* field is empty)');
  for (const k of keys) console.log(`   ${k.padEnd(34)}: ${counts[k]}`);

  if (examples.length) {
    console.log('\nexamples with overrides:');
    examples.forEach((e) => console.log('   ' + e));
  }

  console.log('\nNOTE: core SEO title/description live in AIOSEO\'s private table and are NOT');
  console.log('counted here. This measures only the OG/Twitter/keywords overrides WC exposes.');
  process.exit(0);
}

main().catch((e) => { console.error('[scan] failed:', e.message); process.exit(1); });
