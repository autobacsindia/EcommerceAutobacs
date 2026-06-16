/**
 * Brand registry curation — the single source of truth for brand presentation.
 *
 * WordPress's `brands` taxonomy is low quality: typos (benz, porche), car makes
 * mixed with parts manufacturers, and car *models* used as brands (Thar, GR).
 * This file is the governance layer applied on top of WP during sync, so the
 * stored data is cleaner than WP and stays clean across every re-sync.
 *
 * Each entry:
 *   slug      canonical slug (stable URL)
 *   name      canonical display name (fixes WP casing/typos)
 *   type      'make' | 'manufacturer' | 'house'
 *   wpSlugs   WP brand slug(s) that map here (sync pulls externalId/ids from these)
 *   aliases   lowercase strings matched as whole words against a product TITLE to
 *             resolve a brand when WP left the product untagged
 *   logo      optional logo URL (http → uploaded to Cloudinary by the sync). Empty
 *             = placeholder for now; fill in incrementally, re-run sync to publish.
 *
 * Resolution order in the sync: WP taxonomy → manufacturer aliases → make aliases
 * → HOUSE_FALLBACK. Manufacturers are tried before makes so "Toyota Hilux Brembo
 * Brake Kit" resolves to Brembo, not Toyota.
 */

// ── Car makes ────────────────────────────────────────────────────────────────
const MAKES = [
  { slug: 'toyota',        name: 'Toyota',        wpSlugs: ['toyota-brand'],     aliases: ['toyota', 'fortuner', 'hilux', 'innova', 'hycross', 'legender', 'glanza', 'land cruiser', 'urban cruiser'] },
  { slug: 'mahindra',      name: 'Mahindra',      wpSlugs: ['mahindra'],         aliases: ['mahindra', 'thar', 'thar roxx', 'thar rox', 'scorpio', 'bolero', 'xuv'] },
  { slug: 'bmw',           name: 'BMW',           wpSlugs: ['bmw'],              aliases: ['bmw'] },
  { slug: 'ford',          name: 'Ford',          wpSlugs: ['ford-brand'],       aliases: ['ford', 'endeavour', 'endeavor', 'ranger', 'everest'] },
  { slug: 'isuzu',         name: 'Isuzu',         wpSlugs: ['isuzu'],            aliases: ['isuzu', 'd-max', 'dmax', 'v-cross', 'vcross', 'mu-x', 'mux'] },
  { slug: 'land-rover',    name: 'Land Rover',    wpSlugs: ['land-rover-brand'], aliases: ['land rover', 'defender', 'range rover'] },
  { slug: 'suzuki',        name: 'Suzuki',        wpSlugs: ['suzuki'],           aliases: ['suzuki', 'maruti', 'jimny', 'fronx', 'baleno', 'brezza', 'swift'] },
  { slug: 'hyundai',       name: 'Hyundai',       wpSlugs: ['hyundai-brand'],    aliases: ['hyundai', 'creta', 'venue', 'verna', 'tucson'] },
  { slug: 'mercedes-benz', name: 'Mercedes-Benz', wpSlugs: ['benz'],             aliases: ['benz', 'mercedes', 'g-class', 'g class', 'g-wagon'] },
  { slug: 'volkswagen',    name: 'Volkswagen',    wpSlugs: ['volkswagen'],       aliases: ['volkswagen', 'polo', 'virtus', 'taigun'] },
  { slug: 'jeep',          name: 'Jeep',          wpSlugs: ['jeep'],             aliases: ['jeep', 'wrangler', 'compass', 'meridian'] },
  { slug: 'audi',          name: 'Audi',          wpSlugs: ['audi-brand'],       aliases: ['audi'] },
  { slug: 'honda',         name: 'Honda',         wpSlugs: ['honda-brand'],      aliases: ['honda', 'amaze', 'elevate'] },
  { slug: 'kia',           name: 'Kia',           wpSlugs: ['kia-brand'],        aliases: ['kia', 'seltos', 'sonet', 'carens'] },
  { slug: 'mitsubishi',    name: 'Mitsubishi',    wpSlugs: ['mitsubishi'],       aliases: ['mitsubishi', 'pajero', 'outlander'] },
  { slug: 'skoda',         name: 'Skoda',         wpSlugs: ['skoda'],            aliases: ['skoda', 'kushaq', 'slavia', 'kodiaq'] },
  { slug: 'porsche',       name: 'Porsche',       wpSlugs: ['porche'],           aliases: ['porche', 'porsche', 'cayenne'] },
  { slug: 'lexus',         name: 'Lexus',         wpSlugs: ['lexus-brand'],      aliases: ['lexus'] },
  { slug: 'mazda',         name: 'Mazda',         wpSlugs: ['mazda-brand'],      aliases: ['mazda'] },
  { slug: 'lamborghini',   name: 'Lamborghini',   wpSlugs: ['lamborghini'],      aliases: ['lamborghini', 'urus'] },
  { slug: 'lancia',        name: 'Lancia',        wpSlugs: ['lancia-brand'],     aliases: ['lancia'] },
  { slug: 'mini-cooper',   name: 'Mini Cooper',   wpSlugs: ['mini-cooper'],      aliases: ['mini cooper'] },
  { slug: 'volvo',         name: 'Volvo',         wpSlugs: [],                   aliases: ['volvo'] },
];

// ── Parts manufacturers ──────────────────────────────────────────────────────
const MANUFACTURERS = [
  { slug: 'auxbeam',     name: 'Auxbeam',     wpSlugs: ['auxbeam'],     aliases: ['auxbeam'] },
  { slug: 'ironman-4x4', name: 'Ironman 4x4', wpSlugs: ['ironman-4x4'], aliases: ['ironman', 'iron man', 'reco-trak', 'reco traks', 'saber-x'] },
  { slug: 'profender',   name: 'Profender',   wpSlugs: ['profender'],   aliases: ['profender'] },
  { slug: 'proman',      name: 'Proman',      wpSlugs: ['proman'],      aliases: ['proman'] },
  { slug: 'option-4wd',  name: 'Option 4WD',  wpSlugs: ['option-4wd'],  aliases: ['option 4wd', 'option4wd', 'option 4 wd'] },
  { slug: 'bullhorn',    name: 'Bullhorn',    wpSlugs: ['bullhorn'],    aliases: ['bullhorn'] },
  { slug: 'mark-sports', name: 'MARK Sports', wpSlugs: ['mark-sports'], aliases: ['mark sports', 'mark sport', 'm.a.r.k'] },
  { slug: 'dr-nano',     name: 'Dr. Nano',    wpSlugs: ['dr-nano'],     aliases: ['dr. nano', 'dr nano', 'dr.nano'] },
  { slug: 'lightforce',  name: 'Lightforce',  wpSlugs: ['lightforce'],  aliases: ['lightforce', 'light force'] },
  { slug: 'hella',       name: 'Hella',       wpSlugs: [],              aliases: ['hella'] },
  { slug: 'bushranger',  name: 'Bushranger',  wpSlugs: ['bushranger'],  aliases: ['bushranger'] },
  { slug: 'coasta',      name: 'Coasta',      wpSlugs: ['coasta'],      aliases: ['coasta'] },
  { slug: 'comeup',      name: 'Comeup',      wpSlugs: ['comeup'],      aliases: ['comeup'] },
  { slug: 'stedi',       name: 'STEDI',       wpSlugs: ['stedi'],       aliases: ['stedi'] },
  { slug: 'stellar',     name: 'Stellar',     wpSlugs: ['stellar'],     aliases: ['stellar'] },
  { slug: 'unicorn',     name: 'Unicorn',     wpSlugs: ['unicorn'],     aliases: ['unicorn'] },
  { slug: 'amg',         name: 'AMG',         wpSlugs: ['amg'],         aliases: ['amg'] },
  // Real manufacturers that previously lived only in Mongo (now governed here).
  { slug: 'borla',       name: 'Borla',       wpSlugs: [], aliases: ['borla'] },
  { slug: 'brembo',      name: 'Brembo',      wpSlugs: [], aliases: ['brembo'] },
  { slug: 'dobinsons',   name: 'Dobinsons',   wpSlugs: [], aliases: ['dobinsons'] },
  { slug: 'tough-dog',   name: 'Tough Dog',   wpSlugs: [], aliases: ['tough dog'] },
  { slug: 'tjm',         name: 'TJM',         wpSlugs: [], aliases: ['tjm'] },
  { slug: 'remus',       name: 'Remus',       wpSlugs: [], aliases: ['remus'] },
  { slug: 'warn',        name: 'Warn',        wpSlugs: [], aliases: ['warn'] },
  { slug: 'hamer',       name: 'Hamer',       wpSlugs: [], aliases: ['hamer'] },
  { slug: 'bmc',         name: 'BMC',         wpSlugs: [], aliases: ['bmc'] },
  { slug: 'aozoom',      name: 'AOZOOM',      wpSlugs: [], aliases: ['aozoom'] },
  { slug: 'bazard',      name: 'Bazard',      wpSlugs: [], aliases: ['bazard'] },
  { slug: 'pharaoh',     name: 'Pharaoh',     wpSlugs: [], aliases: ['pharaoh'] },
  { slug: 'bat',         name: 'BAT',         wpSlugs: [], aliases: ['bat'] },
  { slug: '70mai',       name: '70mai',       wpSlugs: [], aliases: ['70mai'] },
  { slug: 'brd',         name: 'BRD',         wpSlugs: [], aliases: ['brd'] },
  { slug: 'windbooster', name: 'Windbooster', wpSlugs: [], aliases: ['windbooster'] },
  { slug: 'gecko',       name: 'Gecko',       wpSlugs: [], aliases: ['gecko'] },
  { slug: 'afn',         name: 'AFN',         wpSlugs: [], aliases: ['afn'] },
  { slug: 'overland',    name: 'Overland',    wpSlugs: [], aliases: ['overland'] },
  { slug: 'jcbl',        name: 'JCBL',        wpSlugs: [], aliases: ['jcbl'] },
  { slug: 'sammitr',     name: 'Sammitr',     wpSlugs: [], aliases: ['sammitr'] },
  { slug: 'rhino-pro',   name: 'Rhino Pro',   wpSlugs: [], aliases: ['rhino pro'] },
  { slug: 'jmax',        name: 'Jmax',        wpSlugs: [], aliases: ['jmax'] },
  { slug: 'vland',       name: 'Vland',       wpSlugs: [], aliases: ['vland'] },
  { slug: 'niaoguichao', name: 'Niaoguichao', wpSlugs: [], aliases: ['niaoguichao'] },
  { slug: 'bita',        name: 'BITA',        wpSlugs: [], aliases: ['bita'] },
  { slug: 'kahn-design', name: 'Kahn Design', wpSlugs: [], aliases: ['kahn design', 'kahn'] },
  { slug: 'baseus',      name: 'Baseus',      wpSlugs: [], aliases: ['baseus'] },
  { slug: 'helix',       name: 'Helix',       wpSlugs: [], aliases: ['helix'] },
  { slug: 'lumma',       name: 'Lumma',       wpSlugs: [], aliases: ['lumma'] },
  { slug: 'ufo',         name: 'UFO',         wpSlugs: [], aliases: ['ufo'] },
  { slug: 'armoro',      name: 'Armoro',      wpSlugs: [], aliases: ['armoro'] },
  { slug: 'armado',      name: 'Armado',      wpSlugs: [], aliases: ['armado'] },
  { slug: 'thor',        name: 'Thor',        wpSlugs: [], aliases: ['thor'] },
  { slug: 'revolution',  name: 'Revolution',  wpSlugs: [], aliases: ['revolution'] },
  { slug: 'cpl-filter',  name: 'CPL Filter',  wpSlugs: [], aliases: ['cpl filter'] },
];

// ── In-house store brand ─────────────────────────────────────────────────────
const HOUSE = [
  { slug: 'autobacs-india', name: 'Autobacs India', type: 'house', wpSlugs: ['autobacs-india', 'autobacs'], aliases: ['autobacs'] },
];

// WP brand slugs that are NOT real brands (car models / trims / junk). Products
// tagged only with these fall through to alias resolution (e.g. Thar → Mahindra).
export const EXCLUDE_WP_SLUGS = ['thar', 'thar-rox', 'option'];

// When a product cannot be resolved at all, assign this brand slug — or null to
// leave it blank (honest for truly generic/universal items). Default: blank.
export const HOUSE_FALLBACK = null;

export const BRANDS = [
  ...MAKES.map(b => ({ ...b, type: 'make' })),
  ...MANUFACTURERS.map(b => ({ ...b, type: 'manufacturer' })),
  ...HOUSE,
];

export default BRANDS;
