/**
 * Migrate hardcoded WordPress image URLs to Cloudinary.
 *
 * Uploads every wp-content image still referenced in the frontend,
 * then rewrites the four source files with the new Cloudinary URLs.
 *
 * Usage (from Autobacs/Back-end/server/):
 *   node scripts/migrate-wp-images-to-cloudinary.js
 *
 * Dry-run (upload only, no file writes):
 *   DRY_RUN=1 node scripts/migrate-wp-images-to-cloudinary.js
 */

import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.resolve(__dirname, '../../../Front-end/web/src');
const DRY_RUN = process.env.DRY_RUN === '1';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

// Every unique wp-content URL still in the frontend, grouped by Cloudinary folder.
const IMAGES = [
  // Brand logos  ─────────────────────────────────────────────────────────────
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp',   folder: 'autobacs/brand-logos' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp',         folder: 'autobacs/brand-logos' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp',            folder: 'autobacs/brand-logos' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp',    folder: 'autobacs/brand-logos' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp', folder: 'autobacs/brand-logos' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/10/option-logo-1.png.webp',     folder: 'autobacs/brand-logos' },

  // Banner  ───────────────────────────────────────────────────────────────────
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/12/liberty-walk-nissan-gt-r-r35.jpg', folder: 'autobacs/banners' },

  // Vehicle model images  ─────────────────────────────────────────────────────
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/Nova-Hilux-2021_1-scaled-1.jpg',                          folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/mahindra_thar_roxx_2024_5k-3840x2160-1-scaled.jpg',      folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/1778470-1920x1300-desktop-hd-isuzu-wallpaper-photo.jpg', folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/suzuki_jimny_2018_08.jpg',                               folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/181709-3000x1688-desktop-hd-jeep-background-photo-scaled.jpg', folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/toyota-fortuner-right-front-three-quarter0.jpeg',        folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/VW-Polo-7.jpg',                                         folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/Hyundai-i20-2-jpeg.jpg',                                folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/Carens_1920x1080_3.jpg',                                folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/Untitled-design-2024-01-04T133626.142.png',             folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/A240553_web_2880-scaled.jpg',                           folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/bmw-3-series.jpg',                                      folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/Ford-Ranger.jpg',                                       folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/land-rover-defender-1333693509.jpg',                    folder: 'autobacs/vehicles' },
  { url: 'https://autobacsindia.com/wp-content/uploads/2024/11/Mercedes-Benz-E-Class.jpg',                             folder: 'autobacs/vehicles' },
];

// Frontend files that contain wp-content URLs.
const FILES_TO_PATCH = [
  'app/page.tsx',
  'app/about-us/page.tsx',
  'components/layout/SuperCarsBanner.tsx',
  'lib/vehicleData.ts',
];

async function uploadImage({ url, folder }) {
  const filename = path.basename(new URL(url).pathname).replace(/\.[^.]+$/, ''); // strip ext
  const public_id = `${folder}/${filename}`;

  try {
    // Check if already uploaded to avoid duplicate uploads on re-runs.
    const existing = await cloudinary.api.resource(public_id).catch(() => null);
    if (existing) {
      console.log(`  ↩ already exists: ${public_id}`);
      return { oldUrl: url, newUrl: existing.secure_url };
    }

    const result = await cloudinary.uploader.upload(url, {
      public_id,
      overwrite: false,
      resource_type: 'image',
    });

    console.log(`  ✓ uploaded: ${public_id}`);
    return { oldUrl: url, newUrl: result.secure_url };
  } catch (err) {
    console.error(`  ✗ failed: ${url}\n    ${err.message}`);
    return null;
  }
}

function patchFile(filePath, urlMap) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = 0;

  for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
    if (content.includes(oldUrl)) {
      content = content.replaceAll(oldUrl, newUrl);
      changed++;
    }
  }

  if (changed > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  patched ${changed} URL(s) in ${path.relative(FRONTEND_SRC, filePath)}`);
  }
}

async function run() {
  console.log(`\nCloudinary migration — ${IMAGES.length} images\n`);

  if (DRY_RUN) console.log('DRY RUN — files will not be modified\n');

  // Upload all images (sequentially to avoid rate-limiting).
  const urlMap = {};
  for (const image of IMAGES) {
    process.stdout.write(`→ ${path.basename(new URL(image.url).pathname)}\n`);
    const result = await uploadImage(image);
    if (result) urlMap[result.oldUrl] = result.newUrl;
  }

  const succeeded = Object.keys(urlMap).length;
  const failed = IMAGES.length - succeeded;
  console.log(`\nUpload complete: ${succeeded} succeeded, ${failed} failed\n`);

  if (failed > 0) {
    console.log('Skipping file patches — fix failed uploads first.\n');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('URL mapping (dry run — no files written):');
    for (const [old, neu] of Object.entries(urlMap)) {
      console.log(`  ${old}\n    → ${neu}`);
    }
    return;
  }

  // Rewrite frontend source files.
  console.log('Patching frontend files...');
  for (const rel of FILES_TO_PATCH) {
    patchFile(path.join(FRONTEND_SRC, rel), urlMap);
  }

  console.log('\nDone. Next step: remove autobacsindia.com from img-src in src/middleware.ts\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
