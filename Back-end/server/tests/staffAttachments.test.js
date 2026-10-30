/**
 * Staff attachment limits (config/attachments.js): the pre-multer size guard,
 * the upload-slot guard on a dropped connection, the multer error wording, and
 * the byte-level check every payment / parcel service runs before storing.
 * No HTTP server, no DB — the routes are covered in bankTransferRoutes,
 * paymentRequests and teamWorkflowRoutes tests.
 */
import { EventEmitter } from 'events';
import multer from 'multer';
import { jest } from '@jest/globals';
import { attachmentSizeGuard, concurrentUploadGuard, handleAttachmentError } from '../middleware/uploadMiddleware.js';
import { checkAttachments } from '../services/storage/attachmentCheck.js';
import { MAX_ATTACHMENTS, MAX_ATTACHMENTS_PER_RECORD } from '../config/attachments.js';

const MB = 1024 * 1024;
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(100, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(100, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(100, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 32)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100, 1)]);
const f = (buffer, originalname = 'x', mimetype = 'image/jpeg') => ({ buffer, originalname, mimetype });

const makeRes = () => {
  const res = new EventEmitter();
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
};
const multipart = (headers) => ({
  headers: { 'content-type': 'multipart/form-data; boundary=x', ...headers },
  is: (t) => (t === 'multipart/form-data' ? 'multipart/form-data' : false),
});

describe('attachmentSizeGuard', () => {
  it('lets a request within 40 MB (+ form overhead) through', () => {
    const next = jest.fn();
    attachmentSizeGuard(multipart({ 'content-length': String(40 * MB) }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('refuses a request declared over the limit with 413, before multer reads it', () => {
    const res = makeRes();
    const next = jest.fn();
    attachmentSizeGuard(multipart({ 'content-length': String(42 * MB) }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(413);
    expect(res._body.message).toBe('These files add up to more than 40 MB. Send fewer at a time.');
  });

  it('refuses a multipart body with no declared length (chunked) — it could stream without end', () => {
    const res = makeRes();
    attachmentSizeGuard(multipart({ 'transfer-encoding': 'chunked' }), res, jest.fn());
    expect(res._status).toBe(411);
  });

  it('ignores a request that is not an upload', () => {
    const next = jest.fn();
    attachmentSizeGuard({ headers: {}, is: () => false }, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('concurrentUploadGuard', () => {
  it('frees the slot when the client drops mid-upload, and only once', () => {
    // Five dropped uploads used to leak all five slots ('finish' never fires on a drop).
    for (let i = 0; i < 6; i += 1) {
      const res = makeRes();
      const next = jest.fn();
      concurrentUploadGuard({}, res, next);
      expect(next).toHaveBeenCalled();
      res.emit('close');
      res.emit('finish');
      res.emit('close');
    }
    // A sixth-plus request still gets a slot; and five held slots still block the next.
    const held = Array.from({ length: 5 }, () => { const r = makeRes(); concurrentUploadGuard({}, r, jest.fn()); return r; });
    const blocked = makeRes();
    concurrentUploadGuard({}, blocked, jest.fn());
    expect(blocked._status).toBe(429);
    held.forEach((r) => r.emit('finish'));
  });
});

describe('handleAttachmentError', () => {
  const run = (err) => { const res = makeRes(); handleAttachmentError(err, {}, res, jest.fn()); return res; };
  it('words each multer refusal for staff', () => {
    expect(run(new multer.MulterError('LIMIT_FILE_SIZE', 'proof'))._body.message).toBe('A file is too large (10 MB maximum).');
    expect(run(new multer.MulterError('LIMIT_FILE_COUNT'))._body.message).toBe('You can attach up to 20 files at a time.');
    expect(run(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'proof'))._body.message).toBe('You can attach up to 20 files at a time.');
    expect(run(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'qr'))._body.message).toBe('Attach one QR code picture.');
    expect(run(new multer.MulterError('LIMIT_UNEXPECTED_FILE', '"a.exe" is not a photo (JPG, PNG, WebP) or a PDF.'))._body.message)
      .toBe('"a.exe" is not a photo (JPG, PNG, WebP) or a PDF.');
    expect(run(new multer.MulterError('LIMIT_FILE_SIZE'))._status).toBe(400);
  });
  it('passes anything else on', () => {
    const next = jest.fn();
    const err = new Error('boom');
    handleAttachmentError(err, {}, makeRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('checkAttachments', () => {
  it('takes photos and PDFs; the stored type comes from the bytes, not the label', () => {
    const out = checkAttachments([f(JPEG, 'a.png', 'image/png'), f(PNG, 'b.jpg'), f(WEBP, 'c.webp'), f(PDF, 'd.pdf', 'application/pdf')]);
    expect(out.map((x) => [x.contentType, x.ext, x.name])).toEqual([
      ['image/jpeg', 'jpg', 'a.png'], ['image/png', 'png', 'b.jpg'], ['image/webp', 'webp', 'c.webp'], ['application/pdf', 'pdf', 'd.pdf'],
    ]);
  });

  it('refuses a renamed executable or web page, and a GIF, with the file name', () => {
    expect(() => checkAttachments([f(Buffer.from('MZ\x90\x00 program'), 'bill.pdf')])).toThrow('"bill.pdf" is not a photo (JPG, PNG, WebP) or a PDF.');
    expect(() => checkAttachments([f(Buffer.from('<html><script>x</script>'), 'shot.png')])).toThrow(/is not a photo/);
    expect(() => checkAttachments([f(GIF, 'anim.gif')])).toThrow(/is not a photo/);
  });

  it('photos only where a PDF makes no sense (a QR code)', () => {
    expect(() => checkAttachments([f(PDF, 'qr.pdf')], { allowPdf: false })).toThrow('"qr.pdf" is not a photo (JPG, PNG or WebP).');
    expect(checkAttachments([f(PNG, 'qr.png')], { allowPdf: false })).toHaveLength(1);
  });

  it('20 per save, 10 MB each, 40 MB together', () => {
    expect(checkAttachments(Array.from({ length: MAX_ATTACHMENTS }, () => f(JPEG)))).toHaveLength(20);
    expect(() => checkAttachments(Array.from({ length: 21 }, () => f(JPEG)), { noun: 'screenshot' })).toThrow('You can attach up to 20 screenshots at a time.');
    expect(() => checkAttachments([f(Buffer.concat([PDF, Buffer.alloc(10 * MB)]), 'scan.pdf')])).toThrow('"scan.pdf" is too large (10 MB maximum).');
    const nine = f(Buffer.concat([PDF, Buffer.alloc(9 * MB)]));
    expect(checkAttachments([nine, nine, nine, nine])).toHaveLength(4);
    expect(() => checkAttachments([nine, nine, nine, nine, nine])).toThrow('These files add up to more than 40 MB. Send fewer at a time.');
  });

  it('a record holds at most 50 files over its life, and says how many more fit', () => {
    expect(checkAttachments([f(JPEG), f(JPEG)], { existing: 48 })).toHaveLength(2);
    expect(() => checkAttachments([f(JPEG), f(JPEG), f(JPEG)], { existing: 48 })).toThrow('This record can hold 50 files in all — you can add 2 more.');
    expect(() => checkAttachments([f(JPEG)], { existing: MAX_ATTACHMENTS_PER_RECORD })).toThrow('This record already has 50 files, the most it can hold.');
  });

  it('ignores empty entries; an error carries status 400 and is shown to the user', () => {
    expect(checkAttachments([null, f(Buffer.alloc(0)), undefined])).toEqual([]);
    try { checkAttachments([f(GIF)]); } catch (err) { expect(err.statusCode).toBe(400); }
  });
});
