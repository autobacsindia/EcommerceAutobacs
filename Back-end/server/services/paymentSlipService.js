/**
 * The PDF for a payment request: "PAYMENT REQUEST" while it moves through
 * approval, "PAYMENT RECEIPT" once accounts has paid it. One document, so every
 * stage downloads the same record with its status stamped on it — and its full
 * history (who raised, approved, held, paid, when).
 *
 * The bank account number is masked to its last four digits on paper: the slip
 * is for records and sharing, and the full number is only ever shown on screen
 * to the people who pay it.
 */
import PDFDocument from 'pdfkit';
import { companyInfo } from '../config/company.js';
import { loadLogo, pdfFonts } from './invoiceService.js';
import { formatLongDateIST, formatDateTimeIST } from '../utils/datetime.js';
import { rupeesInWords } from '../utils/amountInWords.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import { BASE_CURRENCY, categoryLabel } from '../config/expenseCategories.js';
import { STATUS_LABELS, maskAccount } from './paymentRequestService.js';

const { HAS_UNICODE, FONT, FONT_BOLD, CURRENCY, unicodeFonts } = pdfFonts;
const C = { ink: '#111a16', body: '#3b4641', muted: '#6b7671', line: '#dfe5e2', zebra: '#f5f8f6', brand: '#0a5c33', band: '#0d1612', red: '#b42318', amber: '#b54708' };
const money = (n) => `${CURRENCY} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_COLOUR = { paid: C.brand, declined: C.red, cancelled: C.muted, on_hold: C.amber, approved: C.brand, submitted: C.amber };
const ACTION_LABELS = {
  submitted: 'Raised', approved: 'Approved by admin', declined: 'Declined by admin',
  on_hold: 'Put on hold by accounts', paid: 'Paid by accounts', cancelled: 'Cancelled',
};
const METHOD_LABELS = { razorpay: 'Razorpay', bank: 'Bank transfer', upi: 'UPI', other: 'Other' };
const dateTime = (d) => formatDateTimeIST(d);
/** A foreign bill: "THB 10,000.00 at Rs 2.45 per THB = Rs 24,500.00"; '' for rupees (and every older record). */
const billLine = (r) => (r.currency && r.currency !== BASE_CURRENCY && r.foreignAmount != null
  ? `${r.currency} ${Number(r.foreignAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at ${CURRENCY} ${r.fxRate} per ${r.currency} = ${money(r.amount)}`
  : '');

export async function renderPaymentSlip(r) {
  const logo = await loadLogo();
  const paid = r.status === 'paid';
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${paid ? 'Payment receipt' : 'Payment request'} ${r.number}` } });
      if (HAS_UNICODE) {
        doc.registerFont('body', unicodeFonts.regular);
        doc.registerFont('bold', unicodeFonts.bold);
      }
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28; const H = 841.89; const L = 42; const R = W - 42; const BOTTOM = H - 70;

      // Header
      doc.rect(0, 0, W, 108).fill(C.band);
      doc.rect(0, 108, W, 4).fill(STATUS_COLOUR[r.status] || C.brand);
      if (logo) {
        try {
          const img = doc.openImage(logo);
          const s = Math.min(150 / img.width, 48 / img.height);
          doc.image(logo, L, 28, { width: img.width * s, height: img.height * s });
        } catch { /* text below still identifies the company */ }
      }
      doc.font(FONT).fontSize(8.5).fillColor('#a9b8b0').text(companyInfo.name, L, 84);
      doc.font(FONT_BOLD).fontSize(22).fillColor('#fff')
        .text(paid ? 'PAYMENT RECEIPT' : 'PAYMENT REQUEST', 260, 28, { width: R - 260, align: 'right', characterSpacing: 1.5 });
      doc.font(FONT).fontSize(9).fillColor('#cfd9d4')
        .text(r.number, 260, 60, { width: R - 260, align: 'right' })
        .text(`Raised ${formatLongDateIST(r.createdAt)}`, 260, doc.y + 2, { width: R - 260, align: 'right' });

      let y = 132;
      // Status pill
      const status = (STATUS_LABELS[r.status] || r.status).toUpperCase();
      doc.font(FONT_BOLD).fontSize(9);
      const pw = doc.widthOfString(status) + 24;
      doc.roundedRect(L, y, pw, 22, 11).fill(STATUS_COLOUR[r.status] || C.brand);
      doc.fillColor('#fff').text(status, L + 12, y + 6.5, { lineBreak: false });
      y += 38;

      // Amount block
      doc.roundedRect(L, y, R - L, 64, 8).fill(C.zebra);
      doc.font(FONT).fontSize(9).fillColor(C.muted).text(r.kind === 'supplier' ? 'SUPPLIER PAYMENT' : `${categoryLabel(r.category).toUpperCase()} EXPENSE`, L + 16, y + 12, { characterSpacing: 1 });
      doc.font(FONT_BOLD).fontSize(22).fillColor(C.ink).text(money(r.amount), L + 16, y + 26, { lineBreak: false });
      doc.font(FONT).fontSize(8.6).fillColor(C.body).text(rupeesInWords(r.amount), L + 200, y + 34, { width: R - L - 216, align: 'right' });
      y += 80;

      // Two columns: request / payee
      const colW = (R - L - 24) / 2;
      const block = (x, title, rows) => {
        let yy = y;
        doc.font(FONT_BOLD).fontSize(7.5).fillColor(C.brand).text(title, x, yy, { characterSpacing: 1.2 });
        yy = doc.y + 4;
        rows.filter(([, v]) => v).forEach(([k, v]) => {
          doc.font(FONT).fontSize(8.2).fillColor(C.muted).text(k, x, yy, { width: 92 });
          doc.font(FONT).fontSize(9).fillColor(C.ink).text(String(v), x + 94, yy, { width: colW - 94 });
          yy = Math.max(doc.y, yy + 12) + 3;
        });
        return yy;
      };
      const payee = r.payee || {};
      const leftEnd = block(L, 'REQUEST', [
        ['Team', STAFF_TEAM_LABELS[r.team] || r.team],
        ['Raised by', r.requestedByName],
        ['For', r.kind === 'supplier' ? (r.itemNames || []).join(', ') : categoryLabel(r.category)],
        ['Bill', billLine(r)],
        ['Order', r.orderNumber],
        ['Customer', r.customer?.name ? [r.customer.name, r.customer.phone, r.customer.city].filter(Boolean).join(' · ') : ''],
        ['Sale closed by', r.closedBy],
        ['Details', r.description],
      ]);
      const rightEnd = block(L + colW + 24, 'PAY TO', [
        ['Name', payee.name],
        ['Method', payee.method === 'upi' ? 'UPI' : 'Bank transfer'],
        ['UPI ID', payee.upiId],
        ['Account name', payee.accountName],
        ['Account no.', maskAccount(payee.accountNumber)],
        ['IFSC', payee.ifsc],
        ['Bank', payee.bankName],
        ['Phone', payee.phone],
      ]);
      y = Math.max(leftEnd, rightEnd) + 14;

      // Payment (when paid)
      if (paid && r.payment) {
        doc.roundedRect(L, y, R - L, 72, 8).lineWidth(1).strokeColor(C.brand).stroke();
        doc.font(FONT_BOLD).fontSize(10).fillColor(C.brand).text('PAID', L + 16, y + 12);
        doc.font(FONT).fontSize(9).fillColor(C.body)
          .text(`${METHOD_LABELS[r.payment.method] || r.payment.method}${r.payment.reference ? ` · Reference ${r.payment.reference}` : ''}`, L + 16, y + 28, { width: R - L - 32 })
          // When the money moved, and (separately) when it was recorded here — they
          // differ whenever a transfer is recorded later.
          .text(`Transaction: ${dateTime(r.payment.transactionAt || r.payment.paidAt)}`, L + 16, doc.y + 2, { width: R - L - 32 })
          .text(`Recorded: ${dateTime(r.payment.paidAt)} · by ${r.payment.paidByName || 'Admin'}`, L + 16, doc.y + 2, { width: R - L - 32 });
        y += 86;
      } else if (r.decisionNote && ['declined', 'on_hold'].includes(r.status)) {
        doc.font(FONT_BOLD).fontSize(8).fillColor(STATUS_COLOUR[r.status]).text(r.status === 'declined' ? 'REASON' : 'ON HOLD BECAUSE', L, y, { characterSpacing: 1 });
        doc.font(FONT).fontSize(9).fillColor(C.body).text(r.decisionNote, L, doc.y + 3, { width: R - L });
        y = doc.y + 14;
      }

      // History
      doc.font(FONT_BOLD).fontSize(7.5).fillColor(C.brand).text('HISTORY', L, y, { characterSpacing: 1.2 });
      y = doc.y + 6;
      (r.history || []).forEach((h, i) => {
        if (y > BOTTOM - 30) { doc.addPage(); y = 50; }
        if (i % 2 === 0) doc.rect(L, y - 3, R - L, 20).fill(C.zebra);
        doc.font(FONT).fontSize(8.6).fillColor(C.muted).text(dateTime(h.at), L + 8, y + 2, { width: 120, lineBreak: false });
        doc.fillColor(C.ink).font(FONT_BOLD).text(ACTION_LABELS[h.action] || h.action, L + 132, y + 2, { width: 150, lineBreak: false });
        doc.font(FONT).fillColor(C.body)
          .text([h.byName, h.note ? `“${String(h.note).slice(0, 90)}”` : ''].filter(Boolean).join(' · '), L + 286, y + 2, { width: R - L - 294, lineBreak: false, ellipsis: true });
        y += 20;
      });

      // Footer on every page
      const range = doc.bufferedPageRange();
      for (let p = range.start; p < range.start + range.count; p += 1) {
        doc.switchToPage(p);
        doc.rect(0, H - 40, W, 40).fill(C.band);
        doc.font(FONT).fontSize(7.5).fillColor('#a9b8b0').text(
          `${companyInfo.name} · internal payment record · ${r.number} · page ${p - range.start + 1} of ${range.count}`,
          L, H - 25, { width: R - L, align: 'center', lineBreak: false },
        );
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
