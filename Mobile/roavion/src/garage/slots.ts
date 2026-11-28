/**
 * What the 3D showroom can fit on each car.
 *
 * A "slot" is one place on the car a part goes (front bumper, roof, bed…). Each
 * slot lists real products by an existing shop category, filtered to the car, so
 * the showroom never invents a catalogue of its own.
 *
 * Only cars listed here have a showroom. Adding a car = one entry below plus its
 * 3D drawing in `showroom/scene.src.js`.
 *
 * Pure: runs under `node --test`.
 */

export type SlotGroup = 'style' | 'protection' | 'utility';

export const SLOT_GROUPS: { key: SlotGroup; label: string }[] = [
  { key: 'style', label: 'Style' },
  { key: 'protection', label: 'Protection' },
  { key: 'utility', label: 'Utility' },
];

export interface Slot {
  /** Also the part's name inside the 3D scene and the shop category slug. */
  key: string;
  label: string;
  group: SlotGroup;
  /** Ionicons name for the slot chip. */
  icon: string;
  /** Slots that cannot be fitted together with this one (a canopy fills the bed). */
  excludes: string[];
}

export interface PaintColour {
  key: string;
  label: string;
  hex: string;
}

export interface ShowroomCar {
  /** Vehicle slug, as the API has it. */
  slug: string;
  make: string;
  model: string;
  slots: Slot[];
  paints: PaintColour[];
}

const HILUX: ShowroomCar = {
  slug: 'toyota-hilux',
  make: 'Toyota',
  model: 'Hilux',
  slots: [
    { key: 'roll-bar', label: 'Roll bar', group: 'style', icon: 'git-network-outline', excludes: ['canopy'] },
    { key: 'fender-flare', label: 'Fender flares', group: 'style', icon: 'ellipse-outline', excludes: [] },
    { key: 'bonnet-hood', label: 'Bonnet', group: 'style', icon: 'triangle-outline', excludes: [] },
    { key: 'bumper', label: 'Bumpers', group: 'protection', icon: 'shield-outline', excludes: [] },
    { key: 'side-step', label: 'Side steps', group: 'protection', icon: 'remove-outline', excludes: [] },
    { key: 'snorkel', label: 'Snorkel', group: 'protection', icon: 'water-outline', excludes: [] },
    { key: 'lift-kit', label: 'Lift kit', group: 'utility', icon: 'arrow-up-outline', excludes: [] },
    { key: 'roof-rack', label: 'Roof rack', group: 'utility', icon: 'grid-outline', excludes: [] },
    { key: 'roller-shutter', label: 'Roller shutter', group: 'utility', icon: 'reorder-four-outline', excludes: ['canopy'] },
    { key: 'canopy', label: 'Canopy', group: 'utility', icon: 'cube-outline', excludes: ['roll-bar', 'roller-shutter'] },
    { key: 'winch', label: 'Winch', group: 'utility', icon: 'sync-outline', excludes: [] },
  ],
  paints: [
    { key: 'white', label: 'White', hex: '#f4f4f2' },
    { key: 'silver', label: 'Silver', hex: '#b9bdbf' },
    { key: 'grey', label: 'Grey', hex: '#5b6064' },
    { key: 'black', label: 'Black', hex: '#17191a' },
    { key: 'red', label: 'Red', hex: '#a3151c' },
  ],
};

const CARS: ShowroomCar[] = [HILUX];

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function showroomCarBySlug(slug: string | null | undefined): ShowroomCar | null {
  return CARS.find((c) => c.slug === norm(slug)) ?? null;
}

/** The showroom for a saved garage car, if that car has one. */
export function showroomCarFor(make: string | null | undefined, model: string | null | undefined): ShowroomCar | null {
  return CARS.find((c) => norm(c.make) === norm(make) && norm(c.model) === norm(model)) ?? null;
}

/** The car a customer with no matching garage car is offered to try. */
export const DEFAULT_SHOWROOM_CAR = HILUX;

export function slotsInGroup(car: ShowroomCar, group: SlotGroup): Slot[] {
  return car.slots.filter((s) => s.group === group);
}

export function findSlot(car: ShowroomCar, key: string): Slot | null {
  return car.slots.find((s) => s.key === key) ?? null;
}
