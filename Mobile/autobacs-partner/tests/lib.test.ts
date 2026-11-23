/// <reference types="node" />
// Run: npm test   (Node's built-in runner; Node strips the TS types itself)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rupeesToPaise, formatPaise, paiseToInput, gstOnPaise, supplierPayout, MAX_COST_PAISE } from '../src/lib/money.ts';
import { gstinChecksumOk, checkOnboarding, normalizePhone, passwordProblem, type OnboardingFields } from '../src/lib/validate.ts';

const paise = (s: string) => {
  const r = rupeesToPaise(s);
  return r.ok ? r.paise : r.error;
};

test('rupees → paise by digits, never float', () => {
  assert.equal(paise('1800'), 180000);
  assert.equal(paise('1,800.5'), 180050);
  assert.equal(paise('₹ 0.29'), 29); // 0.29*100 = 28.999… as a float
  assert.equal(paise('1.10'), 110);
  assert.equal(paise('1.'), 100);
  assert.equal(paise('1000000.01'), 'Cost can be at most ₹10,00,000 per unit');
  assert.equal(paise('1000000'), MAX_COST_PAISE);
});

test('rupees → paise rejects junk', () => {
  for (const bad of ['', '-5', 'abc', '1e3', '0', '0.00', '12.345', '.5', '1.2.3']) {
    assert.equal(typeof paise(bad), 'string', bad);
  }
  assert.equal(paise('12.345'), 'Use at most 2 digits after the point');
});

test('format + round trip', () => {
  assert.equal(formatPaise(180050), '₹1,800.50');
  assert.equal(formatPaise(12345678900), '₹12,34,56,789');
  assert.equal(formatPaise(5), '₹0.05');
  assert.equal(paiseToInput(180050), '1800.50');
  assert.equal(paiseToInput(180000), '1800');
  for (const p of [1, 99, 100, 180050, MAX_COST_PAISE]) assert.equal(paise(paiseToInput(p)), p);
});

test('GST on cost rounds half-up to the paisa', () => {
  assert.equal(gstOnPaise(180000, 18), 32400);
  assert.equal(gstOnPaise(1, 18), 0); // 0.18 paise
  assert.equal(gstOnPaise(3, 18), 1); // 0.54 → 1
  assert.equal(gstOnPaise(MAX_COST_PAISE, 28), 28_000_000);
  assert.deepEqual(supplierPayout(180000, 18), { cost: 180000, gst: 32400, total: 212400 });
});

test('GSTIN check digit', () => {
  assert.equal(gstinChecksumOk('27AAPFU0939F1ZV'), true);
  assert.equal(gstinChecksumOk('27AAPFU0939F1ZW'), false);
  assert.equal(gstinChecksumOk('27aapfu0939f1zv'), false);
});

test('onboarding checks', () => {
  const good: OnboardingFields = {
    companyName: 'Kerala Auto Parts', contactName: 'Anu', phone: '+91 98765 43210', city: 'Kochi',
    address: '12 MG Road, Kochi 682011', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', accountName: 'Kerala Auto Parts',
    accountNumber: '123456789012', accountNumberAgain: '123456789012', ifsc: 'HDFC0001234', upiId: '',
  };
  assert.deepEqual(checkOnboarding(good, { hasSavedAccount: false }), {});
  assert.ok(checkOnboarding({ ...good, pan: 'ABCDE1234F' }, { hasSavedAccount: false }).pan);
  assert.ok(checkOnboarding({ ...good, accountNumberAgain: '1' }, { hasSavedAccount: false }).accountNumberAgain);
  // Saved account on the server: blank is fine, we only hold its last 4.
  assert.deepEqual(checkOnboarding({ ...good, accountNumber: '', accountNumberAgain: '' }, { hasSavedAccount: true }), {});
  assert.ok(checkOnboarding({ ...good, accountNumber: '', accountNumberAgain: '' }, { hasSavedAccount: false }).accountNumber);
  assert.equal(normalizePhone('09876543210'), '9876543210');
  assert.equal(passwordProblem('short1'), 'Use at least 8 characters');
  assert.equal(passwordProblem('longenough1'), null);
});
