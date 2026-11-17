/**
 * Every project slip — delivery slip, job card, a letter to the RTO, an office
 * purchase list — in ONE layout: letterhead band, the template's blocks
 * (label/value sections, paragraphs, an item table), a closing line and
 * signature boxes. Templates are stored (services/slipTemplateService.js), so a
 * new slip is an admin's form, never a new drawing.
 *
 * An empty field prints as a blank line to fill in by hand: a slip is never
 * refused for a missing phone number when the customer is standing at the desk.
 */
import PDFDocument from 'pdfkit';
import { companyInfo, companyAddressLine } from '../config/company.js';
import { loadLogo, pdfFonts } from './invoiceService.js';
import { formatLongDateIST } from '../utils/datetime.js';
import { rupeesInWords } from '../utils/amountInWords.js';

const { HAS_UNICODE, FONT, FONT_BOLD, CURRENCY, unicodeFonts } = pdfFonts;
const C = { ink: '#111a16', body: '#3b4641', muted: '#6b7671', line: '#c9d1cd', zebra: '#f5f8f6', brand: '#0a5c33', band: '#0d1612' };

const money = (n) => `${CURRENCY} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A row's printed value ('' = leave a blank line). Exported for tests. */
export function printed(row) {
  const v = row.value;
  if (v === '' || v == null) return '';
  if (row.type === 'money') return money(v);
  if (row.type === 'date') return dayText(v);
  if (row.type === 'number') return Number(v).toLocaleString('en-IN');
  return String(v);
}

const BLANK = '____________________';

/** A paragraph's text: each {{value}} filled, or a line to write on. Exported for tests. */
export function paragraphText(block) {
  return block.pieces.map((x) => (x.placeholder ? (printed(x) || BLANK) : x.text)).join('');
}

/** Labels end in "(₹)" on screen; on paper the amount already says Rs/₹. */
const paperLabel = (label) => label.replace(/\s*\(₹\)$/, '');

export async function renderProjectSlip(s, now = new Date()) {
  const logo = await loadLogo();
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${s.label} ${s.ref} — ${s.projectName}` } });
      if (HAS_UNICODE) {
        doc.registerFont('body', unicodeFonts.regular);
        doc.registerFont('bold', unicodeFonts.bold);
      }
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28; const H = 841.89; const L = 42; const R = W - 42; const BOTTOM = H - 60;
      const LABEL_W = 150;

      // Letterhead
      doc.rect(0, 0, W, 104).fill(C.band);
      doc.rect(0, 104, W, 4).fill(C.brand);
      if (logo) {
        try {
          const img = doc.openImage(logo);
          const k = Math.min(150 / img.width, 46 / img.height);
          doc.image(logo, L, 26, { width: img.width * k, height: img.height * k });
        } catch { /* the name below still identifies the company */ }
      }
      doc.font(FONT).fontSize(8).fillColor('#a9b8b0').text([companyInfo.name, companyAddressLine(), companyInfo.phone].filter(Boolean).join(' · '), L, 80, { width: 300, lineBreak: false, ellipsis: true });
      // One line, always: an admin's heading may be up to 40 characters, so it shrinks to fit the band.
      const titleWidth = R - 260;
      let titleSize = 22;
      doc.font(FONT_BOLD);
      while (titleSize > 12 && doc.fontSize(titleSize).widthOfString(s.title, { characterSpacing: 1.5 }) > titleWidth) titleSize -= 1;
      doc.fontSize(titleSize).fillColor('#fff')
        .text(s.title, 260, 26 + (22 - titleSize) / 2, { width: titleWidth, align: 'right', characterSpacing: 1.5, lineBreak: false, ellipsis: true });
      doc.font(FONT).fontSize(9).fillColor('#cfd9d4')
        .text(`${s.ref} · ${formatLongDateIST(now)}`, 260, 58, { width: R - 260, align: 'right' });
      if (s.order) doc.text(`Order ${s.order}`, 260, doc.y + 2, { width: R - 260, align: 'right' });

      let y = 126;
      // A letter (it opens with a paragraph) goes straight to its text; a slip names its project first.
      if (s.showProject !== false) {
        doc.font(FONT_BOLD).fontSize(13).fillColor(C.ink).text(s.projectName, L, y, { width: R - L });
        y = doc.y + 2;
        if (s.owner) {
          doc.font(FONT).fontSize(8.6).fillColor(C.muted).text(`Project owner: ${s.owner}`, L, y);
          y = doc.y;
        }
        y += 12;
      } else {
        y += 6;
      }

      const ensure = (need) => { if (y + need > BOTTOM) { doc.addPage(); y = 50; } };

      const sectionTitle = (title) => {
        if (!title) return;
        ensure(40);
        doc.font(FONT_BOLD).fontSize(7.8).fillColor(C.brand).text(title.toUpperCase(), L, y, { characterSpacing: 1.2 });
        y = doc.y + 5;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(C.line).stroke();
        y += 6;
      };

      const drawSection = (block) => {
        sectionTitle(block.title);
        if (!block.title) ensure(30);
        for (const row of block.rows) {
          const value = printed(row);
          const valueW = R - L - LABEL_W;
          doc.font(row.strong ? FONT_BOLD : FONT).fontSize(9.4);
          const h = value ? Math.max(14, doc.heightOfString(value, { width: valueW })) : 16;
          ensure(h + 6);
          doc.font(FONT).fontSize(8.6).fillColor(C.muted).text(paperLabel(row.label), L, y + 1, { width: LABEL_W - 8 });
          if (value) {
            doc.font(row.strong ? FONT_BOLD : FONT).fontSize(9.4).fillColor(C.ink).text(value, L + LABEL_W, y, { width: valueW });
            if (row.strong && row.type === 'money' && Number(row.value) > 0) {
              doc.font(FONT).fontSize(7.6).fillColor(C.muted).text(rupeesInWords(row.value), L + LABEL_W, doc.y + 1, { width: valueW });
            }
            y = Math.max(doc.y, y + 14) + 5;
          } else {
            // Blank: a line to write on.
            doc.moveTo(L + LABEL_W, y + 13).lineTo(R, y + 13).lineWidth(0.5).dash(2, { space: 2 }).strokeColor(C.muted).stroke().undash();
            y += 21;
          }
        }
        y += 10;
      };

      const drawParagraph = (block) => {
        const content = paragraphText(block);
        doc.font(block.bold ? FONT_BOLD : FONT).fontSize(10);
        const h = doc.heightOfString(content, { width: R - L, lineGap: 3 });
        ensure(Math.min(h, BOTTOM - 60) + 10);
        doc.fillColor(C.ink).text(content, L, y, { width: R - L, lineGap: 3 });
        y = doc.y + 12;
      };

      const drawItems = (block) => {
        sectionTitle(block.title);
        const cols = [
          { label: '#', x: L, w: 22, align: 'left' },
          { label: 'Item', x: L + 24, w: R - L - 24 - 250, align: 'left' },
          { label: 'Qty', x: R - 226, w: 60, align: 'right' },
          { label: 'Rate', x: R - 160, w: 75, align: 'right' },
          { label: 'Amount', x: R - 80, w: 80, align: 'right' },
        ];
        ensure(40);
        doc.font(FONT_BOLD).fontSize(8).fillColor(C.muted);
        cols.forEach((c) => doc.text(c.label, c.x, y, { width: c.w, align: c.align, lineBreak: false }));
        y += 14;
        // No items yet: ruled lines to fill by hand.
        const rows = block.rows.length ? block.rows : Array.from({ length: 6 }, () => null);
        rows.forEach((r, i) => {
          doc.font(FONT).fontSize(9);
          const h = r ? Math.max(16, doc.heightOfString(r.name, { width: cols[1].w }) + 4) : 18;
          ensure(h + 4);
          if (i % 2 === 0) doc.rect(L, y - 3, R - L, h).fill(C.zebra);
          if (r) {
            doc.fillColor(C.muted).text(String(i + 1), cols[0].x, y, { width: cols[0].w });
            doc.fillColor(C.ink).text(r.name, cols[1].x, y, { width: cols[1].w });
            doc.text(Number(r.qty).toLocaleString('en-IN'), cols[2].x, y, { width: cols[2].w, align: 'right' });
            doc.text(money(r.rate), cols[3].x, y, { width: cols[3].w, align: 'right' });
            doc.text(money(r.amount), cols[4].x, y, { width: cols[4].w, align: 'right' });
          } else {
            doc.moveTo(L, y + h - 4).lineTo(R, y + h - 4).lineWidth(0.4).dash(2, { space: 2 }).strokeColor(C.line).stroke().undash();
          }
          y += h;
        });
        ensure(36);
        doc.moveTo(L, y + 2).lineTo(R, y + 2).lineWidth(0.7).strokeColor(C.ink).stroke();
        y += 7;
        doc.font(FONT_BOLD).fontSize(9.6).fillColor(C.ink).text('Total', cols[3].x - 60, y, { width: 135, align: 'right' });
        doc.text(block.rows.length ? money(block.total) : '', cols[4].x, y, { width: cols[4].w, align: 'right' });
        y = doc.y + 2;
        if (block.rows.length && block.total > 0) {
          doc.font(FONT).fontSize(7.6).fillColor(C.muted).text(rupeesInWords(block.total), L, y, { width: R - L, align: 'right' });
          y = doc.y;
        }
        y += 14;
      };

      for (const block of s.blocks) {
        if (block.type === 'section') drawSection(block);
        else if (block.type === 'paragraph') drawParagraph(block);
        else if (block.type === 'items') drawItems(block);
      }

      if (s.declaration) {
        ensure(40);
        doc.roundedRect(L, y, R - L, 34, 6).fill(C.zebra);
        doc.font(FONT).fontSize(8.8).fillColor(C.body).text(s.declaration, L + 12, y + 11, { width: R - L - 24 });
        y += 48;
      }

      // Signatures: boxes side by side, name and date lines under each.
      const n = s.signatures.length || 1;
      const gap = 24;
      const boxW = (R - L - gap * (n - 1)) / n;
      ensure(96);
      y += 8;
      s.signatures.forEach((who, i) => {
        const x = L + i * (boxW + gap);
        doc.moveTo(x, y + 44).lineTo(x + boxW, y + 44).lineWidth(0.7).strokeColor(C.ink).stroke();
        doc.font(FONT_BOLD).fontSize(8.4).fillColor(C.ink).text(who, x, y + 50, { width: boxW });
        doc.font(FONT).fontSize(8).fillColor(C.muted).text('Name: ______________________', x, y + 66, { width: boxW, lineBreak: false })
          .text('Date: ______________________', x, y + 80, { width: boxW, lineBreak: false });
      });

      // Footer on every page
      const range = doc.bufferedPageRange();
      for (let p = range.start; p < range.start + range.count; p += 1) {
        doc.switchToPage(p);
        doc.rect(0, H - 36, W, 36).fill(C.band);
        doc.font(FONT).fontSize(7.5).fillColor('#a9b8b0').text(
          `${companyInfo.name} · ${s.label} · ${s.ref} · page ${p - range.start + 1} of ${range.count}`,
          L, H - 22, { width: R - L, align: 'center', lineBreak: false },
        );
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
