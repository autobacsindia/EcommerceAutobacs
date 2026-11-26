/**
 * Order moments (app): the words, the play-once signature, reading the server's
 * `moment`, and the scene page. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { momentCopy, momentSignature, momentDay, momentDayOf, momentDayShort } from '../momentCopy.ts';
import { parseMoment, memoryKey, MOMENT_KEYS } from '../momentParse.ts';
import { momentHtml } from '../momentHtml.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../../..');

test('every server key has words and a picture', () => {
  assert.equal(MOMENT_KEYS.length, 16);
  for (const key of MOMENT_KEYS) {
    const c = momentCopy({ key });
    assert.ok(c.chip && c.title && c.body, key);
    const html = momentHtml({ key }, { still: false });
    assert.match(html, /<svg [^>]*viewBox="0 0 320 180"/, key);
    assert.ok(html.length > 1500, `${key} scene drawn`);
  }
});

test('words match the website exactly', () => {
  assert.equal(momentCopy({ key: 'placed' }).title, 'Order placed. Thank you!');
  assert.equal(momentCopy({ key: 'delivered' }).title, 'Delivered. We hope you love it.');
  assert.equal(momentCopy({ key: 'refunded', refund: { amount: 1499.5 } }).body,
    'We have refunded ₹1,499.50. It can take a few working days to show in your account.');
  assert.equal(momentCopy({ key: 'refunded', refund: { amount: 0 } }).body,
    'We have refunded your payment. It can take a few working days to show in your account.');
  assert.match(momentCopy({ key: 'cancelled', refundDue: true }).body, /refund has started/);
  assert.equal(momentCopy({ key: 'cancelled' }).body, 'No payment was taken for this order.');
});

test('late: promise day, and courier vs still-with-us wording', () => {
  const m = { key: 'late', late: { dueDay: '2026-11-30' } };
  assert.match(momentCopy(m, { shipped: true }).body, /^We expected to deliver by Mon 30 Nov\. Your parcel is still with the courier/);
  assert.match(momentCopy(m).body, /Your order is still with us/);
  assert.doesNotMatch(momentCopy({ key: 'late', late: { dueDay: 'garbage' } }).body, /expected/);
});

test('delivery updates: note as plain text, "Updated <day>" in India time, new date', () => {
  const c = momentCopy({ key: 'delivery_failed', note: '  Customer not home  ', at: '2026-12-02T20:00:00Z' });
  assert.equal(c.note, 'Customer not home');
  assert.equal(c.updated, 'Updated Thu 3 Dec'); // 20:00 UTC = 01:30 next day in India
  assert.equal(momentCopy({ key: 'in_transit', note: '   ' }).note, undefined);
  assert.equal(momentCopy({ key: 'date_moved', newDay: '2026-12-04' }).body, 'New expected date: Fri 4 Dec. We’re sorry for the wait.');
  assert.equal(momentCopy({ key: 'date_moved', note: 'x' }).note, undefined); // date_moved shows no note
});

test('returns: step clamped, four labels', () => {
  assert.deepEqual(momentCopy({ key: 'returning', returnStep: 9 }).steps, { labels: ['Requested', 'Pickup', 'Received', 'Refund'], at: 2 });
  assert.equal(momentCopy({ key: 'returning', returnStep: -3 }).steps.at, 0);
});

test('dates', () => {
  assert.equal(momentDay('2026-11-30'), 'Mon 30 Nov');
  assert.equal(momentDayShort('2026-11-30'), 'Mon 30');
  assert.equal(momentDay('30/11/2026'), null);
  assert.equal(momentDayOf('nope'), null);
});

test('signature: same update = same; a new step or a newer delivery update plays again', () => {
  assert.equal(momentSignature({ key: 'packed' }), 'packed');
  assert.notEqual(momentSignature({ key: 'returning', returnStep: 0 }), momentSignature({ key: 'returning', returnStep: 1 }));
  const a = momentSignature({ key: 'delivery_failed', at: '2026-12-01T10:00:00Z' });
  const b = momentSignature({ key: 'delivery_failed', at: '2026-12-02T10:00:00Z' });
  assert.notEqual(a, b);
  assert.equal(a, momentSignature({ key: 'delivery_failed', at: '2026-12-01T10:00:00Z', note: 'changed note' }));
  // The note never decides play-once and is never part of the stored value.
  assert.doesNotMatch(a, /note/);
});

test('parseMoment accepts only what the server documents', () => {
  assert.equal(parseMoment(null), null);
  assert.equal(parseMoment({}), null);
  assert.equal(parseMoment({ key: 'teleported' }), null); // newer server key → no card, not a wrong one
  assert.deepEqual(parseMoment({ key: 'refunded', refund: { amount: 'lots' } }), { key: 'refunded' });
  assert.deepEqual(
    parseMoment({ key: 'out_for_delivery', note: 'Hi', at: '2026-12-01T10:00:00Z', staff: 'Ravi', extra: 1 }),
    { key: 'out_for_delivery', note: 'Hi', at: '2026-12-01T10:00:00Z' },
  ); // unknown fields (e.g. a name) are dropped
  assert.equal(parseMoment({ key: 'in_transit', note: 'x'.repeat(2000) }).note.length, 500);
});

test('scene page: still flag, no script, no remote loads, team note never inside the drawing', () => {
  const m = { key: 'delivery_failed', note: '<img src=x onerror=alert(1)>Gate closed' };
  const played = momentHtml(m, { still: false });
  const still = momentHtml(m, { still: true });
  assert.match(played, /class="om-scene"/);
  assert.match(still, /class="om-scene om-still"/);
  for (const h of [played, still]) {
    assert.doesNotMatch(h, /<script/i);
    assert.doesNotMatch(h, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    assert.doesNotMatch(h, /Gate closed|onerror/);
  }
  assert.match(played, /@keyframes om-pop/);
  assert.match(played, /prefers-reduced-motion/);
});

test('late date on the calendar is escaped', () => {
  // Only validated "Mon 30" strings reach the drawing; a bad day draws no date at all.
  const h = momentHtml({ key: 'late', late: { dueDay: '<b>' } }, { still: true });
  assert.doesNotMatch(h, /<b>/);
  assert.match(momentHtml({ key: 'late', late: { dueDay: '2026-11-30' } }, { still: true }), />Mon 30</);
});

test('memory key is storage-safe', () => {
  assert.equal(memoryKey('65a1b2c3d4e5f6a7b8c9d0e1'), 'autobacs.moment.65a1b2c3d4e5f6a7b8c9d0e1');
  assert.equal(memoryKey('a/b c'), 'autobacs.moment.a_b_c');
});

/*
 * Drift guard: the app's copies must match the website's sources. Skipped while the
 * website on this checkout predates the Boxy scenes (PR "order-moments-boxy"); once
 * that is merged it runs everywhere and fails the moment either side changes alone.
 */
// MOMENT_WEB_SRC: point at another checkout's Front-end/web/src (e.g. before the website PR lands).
const web = process.env.MOMENT_WEB_SRC || join(repo, 'Front-end/web/src');
const webCopy = join(web, 'components/orders/orderMomentCopy.ts');
const boxyLanded = existsSync(webCopy) && readFileSync(webCopy, 'utf8').includes('delivery_failed');

test('app copies match the website files', { skip: !boxyLanded && 'website copy predates Boxy' }, () => {
  const body = (s, from, to) => s.slice(s.indexOf(from), to ? s.indexOf(to) : undefined).trim();
  const mine = (f) => readFileSync(join(here, '..', f), 'utf8');
  const theirs = (f) => readFileSync(join(web, f), 'utf8');

  assert.equal(
    body(mine('momentCopy.ts'), 'export type MomentKey'),
    body(theirs('components/orders/orderMomentCopy.ts'), 'export type MomentKey', 'const storageKey'),
    'momentCopy.ts drifted from orderMomentCopy.ts',
  );
  assert.equal(
    body(mine('momentScenes.ts'), "const K = '"),
    body(theirs('components/orders/orderMomentScenes.ts'), "const K = '"),
    'momentScenes.ts drifted from orderMomentScenes.ts',
  );
  const css = theirs('app/globals.css');
  assert.ok(
    mine('momentCss.ts').includes(css.slice(css.indexOf('/* ───────── Order moments')).trim().replaceAll('`', '\\`')),
    'momentCss.ts drifted from globals.css',
  );
});
