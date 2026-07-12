# Bundled fonts

`DejaVuSans.ttf` / `DejaVuSans-Bold.ttf` — [DejaVu Fonts](https://dejavu-fonts.github.io/) v2.37.

Bundled because pdfkit's built-in Helvetica is WinAnsi-only and lacks the Indian
Rupee sign (₹, U+20B9). `services/invoiceService.js` embeds these for invoice PDFs;
pdfkit subsets on embed, so only the glyphs actually used ship in each PDF.

License: permissive (Bitstream Vera + DejaVu changes) — free to use, embed, and
redistribute, including in the deployed Docker image. See the DejaVu project for
the full license text.
