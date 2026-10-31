/**
 * What each team may claim an expense for, and in which currencies — the ONE
 * list. services/paymentRequestService.js enforces it, and the team panel's
 * form is drawn from it (GET /payment-requests/expense-options), so the
 * dropdown can never offer something the server would refuse.
 *
 * `noteRequired`: the "Details" box must say what it was (at least 3 letters).
 * Elsewhere it is optional.
 *
 * ── OLD RECORDS ─────────────────────────────────────────────────────────────────
 * Until 2026-10 every team shared one list: fuel | travel | food | purchase |
 * other. Those values stay on the records raised with them — nothing is
 * rewritten — and LEGACY_LABELS keeps them readable. A team's list is checked
 * only when an expense is raised, or when an edit CHANGES its category: an old
 * procurement "fuel" expense can still be corrected as it is.
 *
 * ── CURRENCY ────────────────────────────────────────────────────────────────────
 * `amount` on a request is ALWAYS rupees: what accounts approves, what the admin
 * pays, what every total adds up. A foreign-currency expense also keeps what was
 * billed (`currency`, `foreignAmount`) and the rate from the bank's / forex
 * agent's quote (`fxRate`), entered by the person raising it. The rupee amount
 * is worked out here from those two — never from a live rate, never from the
 * client's own sum.
 */

export const OTHER = 'other';

const c = (value, label, noteRequired = false) => Object.freeze({ value, label, noteRequired });
const others = c(OTHER, 'Others', true);

/** Team (config/staff.js STAFF_TEAMS value) → the options it may choose, in order. */
export const TEAM_EXPENSE_CATEGORIES = Object.freeze({
  procurement: Object.freeze([
    c('import_purchase', 'Import purchase'),
    c('forwarder_cha', 'Freight forwarder / CHA (customs agent)'),
    others,
  ]),
  accounts: Object.freeze([
    c('gst', 'GST', true),
    c('salary', 'Salary', true),
    c('epf', 'EPF', true),
    others,
  ]),
  operations: Object.freeze([
    c('fuel', 'Fuel'),
    c('food', 'Food'),
    c('travel', 'Travel'),
    others,
  ]),
  marketing: Object.freeze([
    c('meta_ads', 'Meta ads'),
    c('google_ads', 'Google ads'),
    c('claude', 'Claude'),
    c('tools', 'Tools', true),
    others,
  ]),
  developer: Object.freeze([
    c('hosting', 'Servers & hosting'),
    c('domains', 'Domains'),
    c('software', 'Software subscriptions'),
    c('ai_tools', 'AI tools'),
    others,
  ]),
  // GTM (stored as 'sales').
  sales: Object.freeze([
    c('customer_travel', 'Travel to customers (fuel, cab, train)'),
    c('customer_food', 'Food with customers'),
    c('samples', 'Samples / demo items'),
    c('courier', 'Courier'),
    others,
  ]),
});

/** A team added to config/staff.js before it has a list here can still claim — as "Others", with details. */
const FALLBACK = Object.freeze([others]);

/** The shared list every team used before per-team lists (still on old records). */
export const LEGACY_LABELS = Object.freeze({
  fuel: 'Fuel',
  travel: 'Travel',
  food: 'Food',
  purchase: 'Purchase for the company',
  other: 'Others',
});

/** Codes the requester may pick, in the order shown. INR first: it is the default. */
export const EXPENSE_CURRENCIES = Object.freeze([
  Object.freeze({ code: 'INR', label: 'Indian rupee (₹)' }),
  Object.freeze({ code: 'USD', label: 'US dollar' }),
  Object.freeze({ code: 'EUR', label: 'Euro' }),
  Object.freeze({ code: 'GBP', label: 'UK pound' }),
  Object.freeze({ code: 'JPY', label: 'Japanese yen' }),
  Object.freeze({ code: 'CNY', label: 'Chinese yuan' }),
  Object.freeze({ code: 'THB', label: 'Thai baht' }),
  Object.freeze({ code: 'AED', label: 'UAE dirham' }),
  Object.freeze({ code: 'SGD', label: 'Singapore dollar' }),
  Object.freeze({ code: 'HKD', label: 'Hong Kong dollar' }),
  Object.freeze({ code: 'MYR', label: 'Malaysian ringgit' }),
  Object.freeze({ code: 'KRW', label: 'Korean won' }),
  Object.freeze({ code: 'TWD', label: 'Taiwan dollar' }),
]);
export const BASE_CURRENCY = 'INR';

/** Teams that pay in foreign currency (imports). Everyone else claims in rupees. */
const FOREIGN_CURRENCY_TEAMS = Object.freeze(['procurement']);

/** Rate guard: rupees for ONE unit. A won is ~₹0.06, a pound ~₹110; outside this is a typo. */
export const MIN_FX_RATE = 0.0001;
export const MAX_FX_RATE = 1000;

export const categoriesFor = (team) => TEAM_EXPENSE_CATEGORIES[team] || FALLBACK;

export const findCategory = (team, value) => categoriesFor(team).find((x) => x.value === value) || null;

/**
 * Must the details be filled for this category? A team option says so itself.
 * A value no longer on the team's list (an old record) was raised when details
 * were required on every expense, so it keeps that rule — which no old record
 * breaks, because each was saved with them.
 */
export const noteRequiredFor = (team, value) => findCategory(team, value)?.noteRequired ?? true;

const ALL_LABELS = Object.freeze(Object.assign(
  {},
  LEGACY_LABELS,
  ...Object.values(TEAM_EXPENSE_CATEGORIES).map((list) => Object.fromEntries(list.map((x) => [x.value, x.label]))),
  { supplier: 'Supplier payment' },
));

/** The readable name of any category ever stored — new, old, or 'supplier'. Unknown values show as stored. */
export const categoryLabel = (value) => ALL_LABELS[value] || String(value || '');

export const currenciesFor = (team) => (FOREIGN_CURRENCY_TEAMS.includes(team)
  ? EXPENSE_CURRENCIES
  : EXPENSE_CURRENCIES.filter((x) => x.code === BASE_CURRENCY));

export const isCurrencyAllowed = (team, code) => currenciesFor(team).some((x) => x.code === code);

/** What the form needs for one team. */
export const expenseOptionsFor = (team) => ({
  team,
  categories: categoriesFor(team).map((x) => ({ ...x })),
  currencies: currenciesFor(team).map((x) => ({ ...x })),
  baseCurrency: BASE_CURRENCY,
});
