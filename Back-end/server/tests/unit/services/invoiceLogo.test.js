/**
 * Invoice header logo: the CURRENT brand logo, bundled with the server.
 *
 * It used to be fetched from a hard-coded Cloudinary URL, which still pointed at
 * the Onam-season artwork long after the storefront moved on. The logo is now the
 * navbar's file shipped in assets/brand/, read from disk — no network involved.
 * This renders a real PDF (real pdfkit) and checks the embedded image is that file.
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../config/cloudinary.js', () => ({ default: { uploader: {} } }));
jest.unstable_mockModule('../../../repositories/counterRepository.js', () => ({
  default: { next: jest.fn().mockResolvedValue(60) },
}));

const { generateInvoicePdf, loadLogo } = await import('../../../services/invoiceService.js');

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLED = join(here, '..', '..', '..', 'assets', 'brand', 'roavion-logo.png');
const NAVBAR = join(here, '..', '..', '..', '..', '..', 'Front-end', 'web', 'public', 'images', 'roavion-logo.png');

const originalFetch = global.fetch;
const fetchSpy = jest.fn().mockRejectedValue(new Error('network disabled in tests'));
beforeAll(() => { global.fetch = fetchSpy; });
afterAll(() => { global.fetch = originalFetch; });

const order = {
  _id: 'abcdef1234567890',
  status: 'confirmed',
  createdAt: new Date('2026-10-07T10:00:00Z'),
  items: [{ name: 'Snorkel', quantity: 1, price: 30000 }],
  shippingAddress: { fullName: 'Asha Rao', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001', phone: '9000000000' },
  subtotal: 30000,
  totalAmount: 30000,
};

/** PNG width/height straight from the IHDR chunk. */
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

describe('invoice logo', () => {
  it('is the same file as the storefront navbar logo', () => {
    // Fails the moment the navbar logo changes without the invoice copy following it.
    expect(Buffer.compare(readFileSync(BUNDLED), readFileSync(NAVBAR))).toBe(0);
  });

  it('is read from disk, not fetched', async () => {
    const logo = await loadLogo();
    expect(Buffer.isBuffer(logo)).toBe(true);
    expect(Buffer.compare(logo, readFileSync(BUNDLED))).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is embedded in the generated PDF at its real size', async () => {
    const pdf = await generateInvoicePdf(order, null);
    const text = Buffer.isBuffer(pdf) ? pdf.toString('latin1') : String(pdf);
    const { width, height } = pngSize(readFileSync(BUNDLED));
    expect(text).toMatch(/\/Subtype \/Image/);
    expect(text).toContain(`/Width ${width}`);
    expect(text).toContain(`/Height ${height}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
