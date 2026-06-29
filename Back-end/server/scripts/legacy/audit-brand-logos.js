/**
 * One-off diagnostic: audit brand logo / visibility coverage.
 *
 * For every Brand it reports: active flag, whether a logo URL is set, and the
 * count of active products mapped by name — the same conditions that decide
 * whether a brand surfaces (with its logo) on /brands and the admin dashboard.
 *
 * Run: node audit-brand-logos.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Brand from '../../models/Brand.js';
import Product from '../../models/Product.js';

dotenv.config();

const logoUrl = (logo) => {
  if (typeof logo === 'string') return logo || null;
  if (logo && typeof logo === 'object') return logo.url || null;
  return null;
};

await mongoose.connect(process.env.MONGO_URI);

const brands = await Brand.find({}, { name: 1, slug: 1, logo: 1, isActive: 1 }).sort({ name: 1 }).lean();

const rows = await Promise.all(
  brands.map(async (b) => {
    const productCount = await Product.countDocuments({
      brand: { $regex: new RegExp(`^${b.name}$`, 'i') },
      isActive: true,
    });
    return {
      name: b.name,
      slug: b.slug,
      active: !!b.isActive,
      logo: !!logoUrl(b.logo),
      products: productCount,
    };
  })
);

const showsOnBrands = (r) => r.active && r.products > 0 && r.logo;

const withLogo = rows.filter((r) => r.logo);
const missingLogo = rows.filter((r) => !r.logo);
const visible = rows.filter(showsOnBrands);
const activeNoLogo = rows.filter((r) => r.active && !r.logo);
const logoButHidden = rows.filter((r) => r.logo && !showsOnBrands(r));

console.log(`\n=== BRAND LOGO AUDIT (${rows.length} brands) ===\n`);
console.log(`With logo:            ${withLogo.length}`);
console.log(`Missing logo:         ${missingLogo.length}`);
console.log(`Active w/o logo:      ${activeNoLogo.length}`);
console.log(`Visible on /brands:   ${visible.length}  (active + products>0 + logo)`);

console.log(`\n--- Brands WITH a logo ---`);
withLogo.forEach((r) =>
  console.log(
    `  ${r.name.padEnd(20)} active=${r.active} products=${String(r.products).padStart(3)} ` +
    `${showsOnBrands(r) ? '✓ shows on /brands' : '✗ hidden'}`
  )
);

if (logoButHidden.length) {
  console.log(`\n--- Has logo but HIDDEN from /brands (fix products/active) ---`);
  logoButHidden.forEach((r) =>
    console.log(`  ${r.name.padEnd(20)} active=${r.active} products=${r.products}`)
  );
}

console.log(`\n--- Active brands MISSING a logo (need a logo asset) ---`);
activeNoLogo.forEach((r) =>
  console.log(`  ${r.slug.padEnd(22)} products=${String(r.products).padStart(3)}`)
);

await mongoose.connection.close();
