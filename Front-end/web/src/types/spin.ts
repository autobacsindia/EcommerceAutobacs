/**
 * Spin-to-Win shared types — mirror of the backend models.
 *
 * Money is in PAISE wherever the field name says so (minOrderValuePaise). The rest of
 * the app deals in rupees, so anything rendered goes through the /100 conversion at the
 * edge of these screens — never silently.
 */

export type SpinStatus = 'draft' | 'live' | 'off';
export type PrizeKind = 'goodie' | 'coupon' | 'karma';

export interface SpinCampaign {
  _id: string;
  slug: string;
  name: string;
  status: SpinStatus;
  startsAt: string;
  endsAt: string;
  minOrderValuePaise: number;
  /** null = uncapped (every order earns its own spin). Defaults to 1 on the backend. */
  maxSpinsPerUserPerCampaign: number | null;
  /** The one number that prices the economy: % of spins that win a real goodie. */
  goodieWinRatePercent: number;
  segmentCount: number;
  reviewCta: {
    enabled: boolean;
    headline: string | null;
    body: string | null;
    url: string | null;
  };
  excludedStates: string[];
  terms: string | null;
  createdAt: string;
}

export interface SpinPrize {
  _id: string;
  campaign: string;
  kind: PrizeKind;
  name: string;
  sku: string | null;
  shortLabel: string | null;
  imageUrl: string | null;
  active: boolean;
  /** null on BOTH = unlimited. Only the floor prize may be unlimited. */
  stockTotal: number | null;
  stockRemaining: number | null;
  stockAwarded: number;
  weightMode: 'stock' | 'manual';
  manualWeight: number;
  weightFactor: number;
  minOrderValuePaise: number;
  maxWinsPerDay: number | null;
  isFloorPrize: boolean;
  /** Coupon prize spec — the engine mints ONE single-use code per winner from this. */
  couponPrefix: string;
  couponType: 'percentage' | 'fixed' | 'free_shipping';
  couponValue: number;
  couponMaxDiscount: number | null;
  couponMinCartValue: number;
  couponValidDays: number;
  karmaPoints: number;
  sortOrder: number;
}

/** One row of the live odds preview. `probability` is 0–1, not a percentage. */
export interface OddsRow {
  prizeId: string;
  name: string;
  stockRemaining: number | null;
  probability: number;
  expectedWinsPerDay: number;
  daysToExhaustion: number | null;
  cappedPerDay: number | null;
  isFloorPrize?: boolean;
}

export interface OddsPreview {
  campaign: { slug: string; goodieWinRatePercent: number };
  generatedForIstDate: string;
  paidOrdersPerDay: number;
  rows: OddsRow[];
}

export interface SpinWinner {
  _id: string;
  order: {
    _id: string;
    shippingAddress?: { fullName?: string; phone?: string; city?: string; state?: string };
    totalAmount?: number;
    status?: string;
    createdAt?: string;
  } | string;
  prizeSnapshot: { name: string; sku: string | null; kind: PrizeKind; imageUrl: string | null };
  status: 'granted' | 'void';
  fulfilledAt: string | null;
  spunAt: string;
}

/**
 * A single named failure from the publish gate.
 *
 * The backend deliberately never returns a bare "Validation Error" — every rule reports
 * which field is wrong, because an opaque validation failure is unfixable from a form.
 */
export interface PublishFieldError {
  field: string;
  message: string;
  value?: unknown;
}
