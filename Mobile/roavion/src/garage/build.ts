/**
 * A customer's "build": the parts they have fitted on one car in the showroom.
 *
 * It is a wish list kept on the phone, NOT an order and NOT a cart. It stores no
 * price on purpose: prices are read fresh from the server whenever the build is
 * shown, and the cart (server) is the only place a total exists.
 *
 * Pure: runs under `node --test`.
 */
import { findSlot, type ShowroomCar } from './slots';

export interface BuildPart {
  productId: string;
  slug: string;
  name: string;
  image: string;
  /** A `variable` product needs an option chosen on its own page before it can be bought. */
  needsOption: boolean;
}

export interface Build {
  /** Paint colour key from the car's list. */
  paint: string;
  /** One product per slot, keyed by slot key. */
  parts: Record<string, BuildPart>;
}

export function emptyBuild(car: ShowroomCar): Build {
  return { paint: car.paints[0]?.key ?? '', parts: {} };
}

/** Fit a product in a slot. It replaces what was there and removes anything it cannot sit beside. */
export function fitPart(car: ShowroomCar, build: Build, slotKey: string, part: BuildPart): Build {
  const slot = findSlot(car, slotKey);
  if (!slot || !part.productId) return build;
  const parts: Record<string, BuildPart> = {};
  for (const [k, v] of Object.entries(build.parts)) {
    if (k !== slotKey && !slot.excludes.includes(k)) parts[k] = v;
  }
  parts[slotKey] = part;
  return { ...build, parts };
}

export function removePart(build: Build, slotKey: string): Build {
  if (!(slotKey in build.parts)) return build;
  const parts = { ...build.parts };
  delete parts[slotKey];
  return { ...build, parts };
}

export function setPaint(car: ShowroomCar, build: Build, paintKey: string): Build {
  return car.paints.some((p) => p.key === paintKey) ? { ...build, paint: paintKey } : build;
}

/** Slots another fit would push out — so the screen can say so before it happens. */
export function displacedBy(car: ShowroomCar, build: Build, slotKey: string): string[] {
  const slot = findSlot(car, slotKey);
  return slot ? slot.excludes.filter((k) => k in build.parts) : [];
}

/** Slot keys to draw on the car, in the car's own slot order. */
export function fittedSlotKeys(car: ShowroomCar, build: Build): string[] {
  return car.slots.filter((s) => s.key in build.parts).map((s) => s.key);
}

export function partCount(build: Build): number {
  return Object.keys(build.parts).length;
}

export function paintHex(car: ShowroomCar, build: Build): string {
  return (car.paints.find((p) => p.key === build.paint) ?? car.paints[0])?.hex ?? '#ffffff';
}

// ── saving on the phone ─────────────────────────────────────────────────────

export function serializeBuild(build: Build): string {
  return JSON.stringify(build);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Read a saved build back. Anything that is not a build this car understands is
 * dropped piece by piece: a corrupt value, a slot that no longer exists, or two
 * parts that cannot sit together must never crash the screen or reach the cart.
 */
export function parseBuild(car: ShowroomCar, raw: string | null | undefined): Build {
  let build = emptyBuild(car);
  if (!raw) return build;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return build;
  }
  if (!data || typeof data !== 'object') return build;
  const saved = data as { paint?: unknown; parts?: unknown };
  build = setPaint(car, build, str(saved.paint));
  if (!saved.parts || typeof saved.parts !== 'object') return build;
  for (const slot of car.slots) {
    const p = (saved.parts as Record<string, unknown>)[slot.key];
    if (!p || typeof p !== 'object') continue;
    const part = p as Record<string, unknown>;
    const productId = str(part.productId);
    const slug = str(part.slug);
    if (!productId || !slug) continue;
    // A later slot must not push out an earlier one on load; first saved wins.
    if (displacedBy(car, build, slot.key).length > 0) continue;
    build = fitPart(car, build, slot.key, {
      productId,
      slug,
      name: str(part.name),
      image: str(part.image),
      needsOption: part.needsOption === true,
    });
  }
  return build;
}

// ── sending the build to the cart ───────────────────────────────────────────

export interface CartPlan {
  /** Parts to add now. */
  add: BuildPart[];
  /** Already in the cart — adding again would double the quantity. */
  alreadyInCart: BuildPart[];
  /** Need an option (size, model…) chosen on the product page first. */
  needOption: BuildPart[];
}

/**
 * Decide what "Add to cart" does for a build. Parts already in the cart are
 * skipped, which is also what makes a second tap (or a retry after a failure
 * part-way through) safe.
 */
export function planCart(car: ShowroomCar, build: Build, productIdsInCart: readonly string[]): CartPlan {
  const inCart = new Set(productIdsInCart);
  const plan: CartPlan = { add: [], alreadyInCart: [], needOption: [] };
  for (const key of fittedSlotKeys(car, build)) {
    const part = build.parts[key];
    if (inCart.has(part.productId)) plan.alreadyInCart.push(part);
    else if (part.needsOption) plan.needOption.push(part);
    else plan.add.push(part);
  }
  return plan;
}
