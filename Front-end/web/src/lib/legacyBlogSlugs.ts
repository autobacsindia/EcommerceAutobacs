/**
 * Every blog post that was ever served at the site root (`/<slug>`), the old
 * WordPress permalink. Since 2026-11 posts live at `/blog/<slug>`; middleware
 * answers each of these old root URLs with ONE 301 straight to the new one.
 *
 * The list is FIXED on purpose and must never grow: new posts are born under
 * /blog, so no new root URL can ever exist. Generated once from the live
 * GET /api/v1/media/articles/sitemap (published, type=blog, indexable) on
 * 2026-11-13 — 64 posts. Slugs are stored exactly as the database holds them
 * (lowercase; the WordPress emoji slug keeps its percent-encoding as text).
 *
 * A post renamed later is still covered: the slug-history map is consulted
 * first, so an old root URL goes straight to the CURRENT /blog URL.
 */
export const LEGACY_ROOT_BLOG_SLUGS: ReadonlySet<string> = new Set([
  "%f0%9f%9a%97-how-to-create-a-virtual-wide-body-kit-render-using-chatgpt",
  "10-urgent-signs-your-car-needs-servicing-now",
  "14659-2",
  "14710-2",
  "5-signs-your-car-needs-an-exhaust-upgrade-and-the-best-systems-to-choose",
  "a-complete-guide-to-car-headlights",
  "a-comprehensive-guide-to-profenders-king-and-queen-series-suspension-systems-for-ford-endeavour",
  "autobacs-india-car-accessories-a-trusted-destination-for-vehicle-upgrades",
  "autobacs-india-your-ultimate-destination-for-car-accessories",
  "automotive-performance-upgrade-elevating-speed-handling-and-efficiency",
  "awning-vs-rooftop-tent-the-complete-guide-for-car-campers-overlanders",
  "best-lighting-upgrades-for-night-time-off-roading-in-india",
  "beyond-the-lens-how-dash-cams-are-revolutionizing-driving-experiences",
  "body-kit-vs-conversion-kit-whats-the-difference-and-which-should-you-choose",
  "budget-vs-premium-car-accessories-whats-right-for-you",
  "car-aftermarket-trends-in-india-2026-6-upgrades-owners-are-actually-buying",
  "car-spoilers-demystified-the-science-and-style-behind-the-aerodynamics",
  "decoding-car-exhaust-systems-function-components-and-maintenance",
  "discover-autobacs-india-redefining-vehicle-customization-in-india",
  "elevate-your-suv-experience-the-top-benefits-of-installing-electric-side-steps",
  "enhance-your-off-road-adventures-with-iron-man-4x4-accessories",
  "enhance-your-vehicles-braking-performance-with-disc-brake-conversion",
  "essential-off-road-accessories-to-elevate-your-adventure-game",
  "from-sedans-to-supercars-key-accessories-for-every-driver",
  "guarding-your-vehicle-everything-you-need-to-know-about-bull-bars",
  "how-often-should-you-really-service-your-car-mechanics-reveal-the-truth",
  "how-to-keep-your-road-ahead-safe-essential-tips-for-vehicle-headlight-maintenance",
  "how-vehicle-modifications-and-performance-upgrades-impact-your-warranty-what-you-need-to-know",
  "illuminate-the-road-choosing-the-right-auxiliary-lighting-for-your-vehicle",
  "mahindra-thar-roxx-accessories-your-complete-upgrade-checklist",
  "mastering-3dtuning-a-step-by-step-guide-to-designing-your-dream-car",
  "mitsubishis-return-to-india-a-strategic-collaboration-with-tvs-mobility",
  "oem-and-oum-parts-explained-choosing-the-best-option-for-your-car",
  "oem-vs-aftermarket-accessories-whats-best-for-your-car",
  "premium-off-road-gear-india-why-autobacs-india-is-the-best-place-for-overlanding-gear",
  "revamp-your-drive-must-have-car-mods-for-power-and-style",
  "revamp-your-ride-stunning-exterior-lighting-upgrades-for-a-sleek-modern-look",
  "revolutionize-your-ride-the-ultimate-upgrade-with-a-premium-instrument-cluster",
  "roof-racks-and-roof-rails-expanding-your-vehicles-cargo-capacity",
  "roof-rails-vs-roof-cross-bars-everything-you-need-to-know",
  "scorpio-n-off-road-accessories-that-transform-your-suvs-performance",
  "smooth-rides-ahead-the-magic-of-differential-drop-kits",
  "step-up-your-ride-a-comprehensive-guide-to-side-steps",
  "the-art-of-car-modifications-enhancing-performance-and-aesthetics",
  "the-complete-guide-to-snorkels-elevating-your-off-roading-experience",
  "the-importance-of-a-strong-suspension-system-a-guide-for-car-enthusiasts-and-drivers",
  "the-ultimate-engine-fault-survival-guide-from-diagnosis-to-repair",
  "top-10-essential-recovery-accessories-every-off-roader-needs",
  "top-10-must-have-accessories-to-transform-your-toyota-fortuner-into-a-luxury-powerhouse",
  "top-10-must-have-proman-accessories-for-your-off-road-vehicle",
  "top-10-reasons-to-upgrade-to-alloy-wheels-for-your-vehicle",
  "top-5-must-have-accessories-for-your-suzuki-jimny-in-india-2025-guide",
  "top-car-exterior-accessories-to-enhance-style-protection-and-performance",
  "top-styling-upgrades-for-your-isuzu-v-cross-from-grilles-to-fender-flares",
  "toyota-hilux-performance-upgrades-in-india-2025-guide",
  "transform-your-ride-a-comprehensive-guide-to-car-interior-parts-and-accessories",
  "transform-your-ride-the-ultimate-guide-to-suspension-upgrades-for-indian-suvs",
  "unleash-the-sound-of-supercars-discover-the-thor-electronic-exhaust-experience",
  "unleashing-the-full-potential-of-your-toyota-hilux-essential-accessories-to-enhance-utility-comfort-and-off-road-adventures",
  "unveiling-the-2024-toyota-hilux-gr-sport-a-masterpiece-in-pickup-truck-innovation",
  "upgrade-your-driving-experience-choosing-the-best-steering-wheel-for-your-car",
  "upgrade-your-ride-a-comprehensive-guide-to-choosing-the-best-automotive-accessories",
  "what-are-car-body-kits-a-comprehensive-guide-and-their-advantages",
  "why-ironman-4x4-accessories-are-a-game-changer-for-off-road-enthusiasts",
]);
