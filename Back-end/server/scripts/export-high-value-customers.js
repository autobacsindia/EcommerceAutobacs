/**
 * READ-ONLY export: customers whose NET spend >= a threshold (default ₹50,000),
 * with email, phone and delivery address.
 *
 * WHY NOT User.totalSpentPaise / Order.purchaseCounted
 * ----------------------------------------------------
 * Both are CRM denorms introduced late: only 17 of 1530 prod orders carry
 * `purchaseCounted`, so filtering on it drops ~96% of real revenue. The
 * authoritative "money actually reached us" signal is `Order.paymentStatus`.
 *
 * NET SPEND
 * ---------
 *   counted   : paymentStatus === 'paid'   (delivered | processing | shipped)
 *               'refunded' / 'cancelled' / 'failed' / 'expired' / 'pending'
 *               orders never contribute — the money was returned or never taken.
 *   refunded  : subtracted per order, mirroring services/refundMathService
 *               .remainingRefundable — Σ committed ReturnRequest.refund.finalAmount
 *               + order.refundDetails.amount when committed and not return-sourced,
 *               floored by Payment.refundAmount. (As of 2026-08 prod has no partial
 *               refunds; this limb keeps the figure correct once it does.)
 *   net       : max(0, gross − refunded)
 *
 * IDENTITY
 * --------
 * Orders attach a customer three ways: a `user` ref (native), `guestEmail`
 * (WooCommerce imports / guest checkout), or neither (a handful of legacy rows).
 * Rows are keyed by normalized email where one exists so a person's native and
 * imported orders fold into ONE customer; otherwise by user id, else by
 * phone+name from the shipping address. The key used is reported per row.
 *
 * ADDRESS
 * -------
 * shippingAddress of the most recent counted order — where goods actually went —
 * falling back to the user's default/first saved address.
 *
 * Usage:
 *   node --import=dotenv/config scripts/export-high-value-customers.js [--min 50000] [--out path.csv]
 */

import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MIN_NET_RUPEES = Number(argValue('--min', '50000'));
const OUT = argValue('--out', path.join(process.env.HOME, 'Downloads', 'high-value-customers.csv'));
const COMMITTED = ['processing', 'completed'];

const R = (n) => Math.round((Number(n) || 0) * 100); // rupees -> integer paise
const rupees = (paise) => (paise / 100).toFixed(2);
const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function joinAddress(a) {
  if (!a) return '';
  return [a.addressLine1, a.addressLine2, a.city, a.state, a.postalCode, a.country]
    .filter((p) => p && String(p).trim())
    .join(', ');
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set');
    process.exit(1);
  }
  if (!Number.isFinite(MIN_NET_RUPEES) || MIN_NET_RUPEES < 0) {
    console.error('[ERROR] --min must be a non-negative number');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`[export] connected to "${db.databaseName}" — READ ONLY. min net = ₹${MIN_NET_RUPEES}\n`);

  // 1. Every order where money was captured and not returned.
  const orders = await db
    .collection('orders')
    .find(
      { paymentStatus: 'paid' },
      {
        projection: {
          user: 1, guestEmail: 1, totalAmount: 1, createdAt: 1, status: 1,
          shippingAddress: 1, refundDetails: 1, source: 1,
        },
      }
    )
    .toArray();

  console.log(`[export] paid orders: ${orders.length}`);
  const orderIds = orders.map((o) => o._id);

  // 2. Refund limbs (kept for correctness under future partial refunds).
  const returns = await db
    .collection('returnrequests')
    .find(
      { order: { $in: orderIds }, 'refund.status': { $in: COMMITTED } },
      { projection: { order: 1, 'refund.finalAmount': 1 } }
    )
    .toArray();
  const returnRefundPaise = new Map();
  for (const rr of returns) {
    const k = String(rr.order);
    returnRefundPaise.set(k, (returnRefundPaise.get(k) || 0) + R(rr?.refund?.finalAmount));
  }

  const payments = await db
    .collection('payments')
    .find(
      { order: { $in: orderIds }, refundAmount: { $gt: 0 } },
      { projection: { order: 1, refundAmount: 1 } }
    )
    .toArray();
  const paymentRefundPaise = new Map();
  for (const p of payments) {
    const k = String(p.order);
    paymentRefundPaise.set(k, Math.max(paymentRefundPaise.get(k) || 0, R(p.refundAmount)));
  }

  // 3. Resolve the user docs referenced by these orders, so we can key on email.
  const userIds = [...new Set(orders.filter((o) => o.user).map((o) => String(o.user)))];
  const userDocs = await db
    .collection('users')
    .find(
      { _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { projection: { name: 1, email: 1, phone: 1, addresses: 1, role: 1 } }
    )
    .toArray();
  const userById = new Map(userDocs.map((u) => [String(u._id), u]));

  // A guest order's email may belong to a real account — fold those together.
  const guestEmails = [...new Set(orders.filter((o) => !o.user).map((o) => normEmail(o.guestEmail)).filter(Boolean))];
  const guestMatchedUsers = await db
    .collection('users')
    .find(
      { email: { $in: guestEmails } },
      { projection: { name: 1, email: 1, phone: 1, addresses: 1, role: 1 } }
    )
    .toArray();
  const userByEmail = new Map([...userDocs, ...guestMatchedUsers].map((u) => [normEmail(u.email), u]));

  // 4. Fold orders into customers.
  const byCustomer = new Map();
  let totalRefundedPaise = 0;
  const keyKinds = { email: 0, userId: 0, phoneName: 0, unidentified: 0 };

  for (const o of orders) {
    const oid = String(o._id);
    const grossPaise = R(o.totalAmount);

    let refundPaise = returnRefundPaise.get(oid) || 0;
    const rd = o.refundDetails;
    const fromReturn = typeof rd?.notes === 'string' && rd.notes.startsWith('Return ');
    if (rd && COMMITTED.includes(rd.status) && !fromReturn) refundPaise += R(rd.amount);
    refundPaise = Math.max(refundPaise, paymentRefundPaise.get(oid) || 0);
    refundPaise = Math.min(refundPaise, grossPaise); // never refund more than captured
    totalRefundedPaise += refundPaise;

    const user = o.user ? userById.get(String(o.user)) : null;
    const email = normEmail(user?.email) || normEmail(o.guestEmail);

    let key;
    let keyKind;
    if (email) {
      key = `email:${email}`;
      keyKind = 'email';
    } else if (o.user) {
      key = `user:${String(o.user)}`;
      keyKind = 'userId';
    } else {
      const phone = o.shippingAddress?.phone || '';
      const name = o.shippingAddress?.fullName || '';
      if (phone || name) {
        key = `anon:${phone}|${name.toLowerCase()}`;
        keyKind = 'phoneName';
      } else {
        key = `order:${oid}`;
        keyKind = 'unidentified';
      }
    }

    let agg = byCustomer.get(key);
    if (!agg) {
      agg = { key, keyKind, email, grossPaise: 0, refundPaise: 0, orders: 0, latest: null, user: null };
      byCustomer.set(key, agg);
      keyKinds[keyKind] += 1;
    }
    agg.grossPaise += grossPaise;
    agg.refundPaise += refundPaise;
    agg.orders += 1;
    if (!agg.email && email) agg.email = email;
    if (!agg.user) agg.user = user || (email ? userByEmail.get(email) : null) || null;
    if (!agg.latest || new Date(o.createdAt) > new Date(agg.latest.createdAt)) agg.latest = o;
  }

  // 5. Threshold + sort.
  const minPaise = Math.round(MIN_NET_RUPEES * 100);
  const qualifying = [];
  for (const agg of byCustomer.values()) {
    const netPaise = Math.max(0, agg.grossPaise - agg.refundPaise);
    if (netPaise >= minPaise) qualifying.push({ ...agg, netPaise });
  }
  qualifying.sort((a, b) => b.netPaise - a.netPaise);

  const header = [
    'Name', 'Email', 'Phone', 'Net Spent (INR)', 'Gross Spent (INR)', 'Refunded (INR)',
    'Paid Orders', 'Last Order Date (IST)', 'Delivery Address', 'City', 'State',
    'Postal Code', 'Country', 'Address Source', 'Has Account', 'Match Key',
  ];
  const rows = [header.map(csvCell).join(',')];

  let missingEmail = 0;
  let missingPhone = 0;
  let missingAddress = 0;

  for (const q of qualifying) {
    const u = q.user;
    const ship = q.latest?.shippingAddress;
    const saved = (u?.addresses || []).find((a) => a.isDefault) || (u?.addresses || [])[0];

    const shipUsable = ship && (ship.addressLine1 || ship.city);
    const addr = shipUsable ? ship : saved;
    const addressSource = shipUsable ? 'last order' : addr ? 'saved account address' : 'none';

    const phone = u?.phone || ship?.phone || saved?.phone || '';
    const email = q.email || '';

    if (!email) missingEmail += 1;
    if (!phone) missingPhone += 1;
    if (!addr) missingAddress += 1;

    rows.push([
      u?.name || ship?.fullName || '',
      email,
      phone,
      rupees(q.netPaise),
      rupees(q.grossPaise),
      rupees(q.refundPaise),
      q.orders,
      q.latest?.createdAt
        ? new Date(q.latest.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : '',
      joinAddress(addr),
      addr?.city || '',
      addr?.state || '',
      addr?.postalCode || '',
      addr?.country || '',
      addressSource,
      u ? 'yes' : 'no (guest/imported)',
      q.key,
    ].map(csvCell).join(','));
  }

  fs.writeFileSync(OUT, `﻿${rows.join('\n')}\n`, 'utf8');

  const netTotal = qualifying.reduce((s, q) => s + q.netPaise, 0);
  const allNet = [...byCustomer.values()].reduce((s, a) => s + Math.max(0, a.grossPaise - a.refundPaise), 0);
  console.log(`[export] distinct paying customers: ${byCustomer.size}`);
  console.log(`[export]   keyed by email ${keyKinds.email}, by user id ${keyKinds.userId}, by phone+name ${keyKinds.phoneName}, unidentified ${keyKinds.unidentified}`);
  console.log(`[export] refunds netted out of paid orders: ₹${rupees(totalRefundedPaise)}`);
  console.log(`[export] total net revenue (all paying customers): ₹${rupees(allNet)}`);
  console.log(`\n[export] customers with net spend >= ₹${MIN_NET_RUPEES}: ${qualifying.length}`);
  console.log(`[export] their combined net spend: ₹${rupees(netTotal)}`);
  console.log(`[export] gaps -> no email: ${missingEmail}, no phone: ${missingPhone}, no address: ${missingAddress}`);
  console.log(`[export] wrote ${OUT}`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
