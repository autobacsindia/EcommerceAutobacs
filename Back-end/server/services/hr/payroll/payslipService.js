/**
 * Payslip reads + PDF. An employee sees only their OWN payslips, and only once the
 * run is approved (`releasedAt`). HR/admin see every payslip of a run. A payslip
 * the caller may not see is the same 404 as one that doesn't exist.
 *
 * Everything shown comes from the payslip snapshot, never from the live employee
 * or salary rows (a payslip is a financial record, like an order).
 */
import PDFDocument from 'pdfkit';
import mongoose from 'mongoose';
import AppError from '../../../utils/AppError.js';
import payrollRepository from '../../../repositories/hr/payrollRepository.js';
import { companyInfo } from '../../../config/company.js';
import { loadLogo, pdfFonts } from '../../invoiceService.js';
import { MONTH_RE } from '../../../config/hr.js';
import { shapePayslipRow } from './runService.js';
import { payslipNumber } from './payouts.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const notFound = () => fail('Payslip not found', 404);

export const shapePayslip = (p) => ({
  ...shapePayslipRow(p),
  snapshot: { ...p.snapshot, salaryStructure: p.snapshot?.salaryStructure ? String(p.snapshot.salaryStructure) : null },
  attendance: p.attendance,
  lines: (p.lines || []).map(({ code, label, kind, amountPaise, calc, basis }) => ({ code, label, kind, amountPaise, calc, basis })),
  employerPaise: p.employerPaise || 0,
  releasedAt: p.releasedAt,
});

const parseCursor = (c) => {
  const [month, id] = String(c || '').split('|');
  return /^\d{4}-\d{2}$/.test(month) && mongoose.isValidObjectId(id) ? { month, id: new mongoose.Types.ObjectId(id) } : undefined;
};

/** Newest first. `releasedOnly` for the employee's own view. */
export async function listPayslips(employeeId, { releasedOnly, cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const rows = await payrollRepository.listEmployeePayslips(employeeId, { releasedOnly, after: parseCursor(cursor), limit: lim + 1 });
  const items = rows.slice(0, lim).map(shapePayslipRow);
  const last = rows[lim - 1];
  return { items, nextCursor: rows.length > lim ? `${last.month}|${last._id}` : null };
}

/** By id, or by month ('YYYY-MM' → that month's monthly payslip, as the ADR's /:month/pdf). */
export async function getPayslip(employeeId, id, { releasedOnly }) {
  const byMonth = MONTH_RE.test(String(id));
  if (!byMonth && !mongoose.isValidObjectId(id)) throw notFound();
  const p = byMonth
    ? await payrollRepository.findEmployeePayslipByMonth(String(id), employeeId, { releasedOnly })
    : await payrollRepository.findEmployeePayslip(id, employeeId, { releasedOnly });
  if (!p) throw notFound();
  return p;
}

// ── PDF ──────────────────────────────────────────────────────────────────────
const { HAS_UNICODE, FONT, FONT_BOLD, CURRENCY, unicodeFonts } = pdfFonts;
const C = { ink: '#111a16', body: '#3b4641', muted: '#6b7671', line: '#dfe5e2', zebra: '#f5f8f6', band: '#0d1612', brand: '#0a5c33' };
const money = (paise) => `${CURRENCY} ${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthText = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// PDFKit's built-in fonts have no ₹ / ½ glyphs: keep the calc text printable either way.
const printable = (s) => (HAS_UNICODE ? s : String(s).replace(/₹/g, 'Rs ').replace(/½/g, '.5'));

export async function renderPayslipPdf(p) {
  const logo = await loadLogo();
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Payslip ${payslipNumber(p)}` } });
      if (HAS_UNICODE) {
        doc.registerFont('body', unicodeFonts.regular);
        doc.registerFont('bold', unicodeFonts.bold);
      }
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28; const L = 42; const R = W - 42; const BOTTOM = 841.89 - 60;
      doc.rect(0, 0, W, 96).fill(C.band);
      if (logo) {
        try {
          const img = doc.openImage(logo);
          const s = Math.min(140 / img.width, 42 / img.height);
          doc.image(logo, L, 24, { width: img.width * s, height: img.height * s });
        } catch { /* the company name below still identifies it */ }
      }
      doc.font(FONT).fontSize(8.5).fillColor('#a9b8b0').text(companyInfo.name, L, 72);
      doc.font(FONT_BOLD).fontSize(20).fillColor('#fff').text(p.kind === 'final_settlement' ? 'FINAL SETTLEMENT' : 'PAYSLIP', 260, 26, { width: R - 260, align: 'right' });
      doc.font(FONT).fontSize(9).fillColor('#cfd9d4')
        .text(`${monthText(p.month)} · ${payslipNumber(p)}`, 260, 54, { width: R - 260, align: 'right' });

      let y = 116;
      const s = p.snapshot || {};
      const a = p.attendance || {};
      const facts = [
        ['Name', s.name], ['Employee code', s.employeeCode], ['Designation', s.designation || '—'], ['Team', s.team || '—'],
        ['PAN', s.panLast4 ? `•••• ${s.panLast4}` : '—'], ['UAN', s.uan || '—'], ['Bank account', s.bankLast4 ? `•••• ${s.bankLast4}` : '—'],
        ['Paid days', `${a.paidDays ?? '—'} of ${a.dayDivisor ?? a.daysInMonth ?? '—'}`],
        ['LOP days', `${a.lopDays ?? 0}`], ['Late / early marks', `${a.marks ?? 0} (late ${a.lateCount ?? 0}, early ${a.earlyCount ?? 0})`],
        ['Overtime (approved)', `${a.overtimeMinutes ?? 0} min`], ['Unapproved absences', `${a.absentUnapproved ?? 0}`],
      ];
      doc.fontSize(9);
      facts.forEach(([k, v], i) => {
        const col = i % 2; const row = Math.floor(i / 2);
        const x = col ? 310 : L; const yy = y + row * 16;
        doc.font(FONT).fillColor(C.muted).text(k, x, yy, { width: 110 });
        doc.font(FONT_BOLD).fillColor(C.ink).text(printable(String(v ?? '—')), x + 112, yy, { width: 150 });
      });
      y += Math.ceil(facts.length / 2) * 16 + 14;

      const section = (title, kind) => {
        const rows = (p.lines || []).filter((l) => l.kind === kind);
        if (!rows.length) return;
        if (y > BOTTOM - 60) { doc.addPage(); y = 50; }
        doc.rect(L, y, R - L, 20).fill(C.zebra);
        doc.font(FONT_BOLD).fontSize(9).fillColor(C.ink).text(title, L + 8, y + 6);
        y += 24;
        for (const l of rows) {
          if (y > BOTTOM - 30) { doc.addPage(); y = 50; }
          doc.font(FONT_BOLD).fontSize(9).fillColor(C.ink).text(printable(l.label), L + 8, y, { width: 330 });
          doc.text(money(l.amountPaise), R - 130, y, { width: 122, align: 'right' });
          const top = y;
          y = Math.max(doc.y, top + 11) + 1;
          if (l.calc) {
            doc.font(FONT).fontSize(7.5).fillColor(C.muted).text(printable(l.calc), L + 8, y, { width: 360 });
            y = doc.y + 2;
          }
          doc.moveTo(L, y + 2).lineTo(R, y + 2).strokeColor(C.line).lineWidth(0.5).stroke();
          y += 6;
        }
        y += 6;
      };
      section('EARNINGS', 'earning');
      section('DEDUCTIONS', 'deduction');

      if (y > BOTTOM - 80) { doc.addPage(); y = 50; }
      const total = (label, v, big = false) => {
        doc.font(big ? FONT_BOLD : FONT).fontSize(big ? 12 : 9.5).fillColor(big ? C.brand : C.body).text(label, L + 8, y);
        doc.text(money(v), R - 160, y, { width: 152, align: 'right' });
        y += big ? 22 : 16;
      };
      total('Gross earnings', p.grossPaise);
      total('Total deductions', p.deductionsPaise);
      total('Net pay', p.netPaise, true);
      section('PAID BY THE COMPANY (not deducted from you)', 'employer');

      doc.font(FONT).fontSize(7.5).fillColor(C.muted)
        .text('Computer-generated payslip; no signature needed. Every figure shows how it was worked out. Questions: please ask HR.', L, BOTTOM + 10, { width: R - L });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export { notFound as payslipNotFound };
