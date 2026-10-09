import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_VEHICLE_PHOTOS, VEHICLE_IMAGE_MAP, getVehicleImageUrl } from './vehicleService';

const DIR = path.join(__dirname, '../../public/images/vehicles');
const onDisk = new Set(fs.readdirSync(DIR));

describe('vehicle photos — only ever point at files that exist', () => {
  it('every listed slug has its <slug>.jpg on disk', () => {
    for (const slug of LOCAL_VEHICLE_PHOTOS) expect(onDisk.has(`${slug}.jpg`)).toBe(true);
  });

  it('every mapped photo exists on disk', () => {
    for (const p of Object.values(VEHICLE_IMAGE_MAP)) expect(onDisk.has(path.basename(p))).toBe(true);
  });

  // The bug: 49 of 80 vehicles had no admin photo, so the page guessed
  // /images/vehicles/<slug>.jpg and showed a broken image for every one.
  it('returns undefined — not a guessed path — for a vehicle with no photo', () => {
    expect(getVehicleImageUrl('audi-a4')).toBeUndefined();
    expect(getVehicleImageUrl('honda-city')).toBeUndefined();
  });

  it('returns the real file for a vehicle that has one', () => {
    expect(getVehicleImageUrl('audi-q7')).toBe('/images/vehicles/audi-q7.jpg');
    expect(getVehicleImageUrl('toyota-hilux')).toBe(VEHICLE_IMAGE_MAP['toyota-hilux']);
  });
});
