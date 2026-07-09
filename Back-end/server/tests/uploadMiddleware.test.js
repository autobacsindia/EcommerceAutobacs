/**
 * Unit tests for validateUploadedFiles middleware
 *
 * Tests magic-byte verification, dimension guard, and duplicate detection
 * by directly calling the middleware with synthetic req/res/next objects.
 * No HTTP server, no DB.
 */

import { validateUploadedFiles, validatePdfUpload } from '../middleware/uploadMiddleware.js';
import { jest } from '@jest/globals';

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Build a synthetic multer file object.
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} [originalname]
 */
const makeFile = (buffer, mimetype, originalname = 'test.img') => ({
  buffer,
  mimetype,
  originalname,
  size: buffer.length,
});

/** Synthetic req with req.files array */
const makeReq = (files) => ({ files, file: undefined });

/** Synthetic res — records status + json calls */
const makeRes = () => {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body = body; return res; };
  return res;
};

const makeNext = () => {
  const fn = jest.fn();
  return fn;
};

// ── Image buffer factories ────────────────────────────────────────────────────

/** Minimal valid JPEG: FF D8 FF + padding */
const makeJpegBuffer = (extraBytes = 20) => {
  const buf = Buffer.alloc(3 + extraBytes);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF;
  return buf;
};

/** Minimal valid PNG: 8-byte signature */
const makePngBuffer = (extraBytes = 20) => {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([sig, Buffer.alloc(extraBytes)]);
};

/**
 * Minimal valid WebP VP8 (lossy) buffer encoding a specific width×height.
 * Layout: RIFF(4) + size(4) + WEBP(4) + VP8 (4) + chunk_size(4) +
 *         bitstream_tag(3) + w_bits(2) + h_bits(2)
 */
const makeWebpBuffer = (width = 100, height = 100) => {
  const buf = Buffer.alloc(34);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(26, 4);      // file size - 8
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt32LE(10, 16);     // chunk size
  // bitstream_tag (3 bytes, ignored for our parser)
  buf[20] = 0x9D; buf[21] = 0x01; buf[22] = 0x2A;
  // width: 14-bit little-endian (w-1), height: 14-bit little-endian (h-1)
  buf.writeUInt16LE(width - 1, 26);
  buf.writeUInt16LE(height - 1, 28);
  return buf;
};

/**
 * PNG buffer with specified width/height encoded in the IHDR chunk.
 * Full minimal PNG: signature(8) + IHDR chunk(4+4+13+4) bytes.
 */
const makePngWithDimensions = (width, height) => {
  const buf = Buffer.alloc(33);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf, 0);
  // IHDR chunk length (4 bytes) = 13
  buf.writeUInt32BE(13, 8);
  // IHDR type
  buf.write('IHDR', 12, 'ascii');
  // width + height (4 bytes each, big-endian, at offsets 16 and 20)
  buf.writeUInt32BE(width,  16);
  buf.writeUInt32BE(height, 20);
  return buf;
};

/**
 * JPEG buffer with a SOF0 marker encoding specific dimensions.
 * Layout: SOI(2) + APP0(2+2+...) + SOF0 marker
 * Simplified: just enough bytes to be JPEG magic + a synthetic SOF0.
 */
const makeJpegWithDimensions = (width, height) => {
  // We embed a minimal SOF0 segment directly after the JPEG SOI marker.
  // Real JPEG: FF D8 [segments] FF C0 [len(2)] [precision(1)] [height(2)] [width(2)]
  const buf = Buffer.alloc(12);
  buf[0] = 0xFF; buf[1] = 0xD8;           // SOI
  buf[2] = 0xFF; buf[3] = 0xC0;           // SOF0 marker
  buf.writeUInt16BE(11, 4);               // segment length (arbitrary)
  buf[6] = 0x08;                          // precision
  buf.writeUInt16BE(height, 7);           // height
  buf.writeUInt16BE(width,  9);           // width
  return buf;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('validateUploadedFiles — empty / no files', () => {
  test('req.files is empty array → calls next immediately', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([]), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._body).toBeNull();
  });

  test('req.files is undefined and req.file is undefined → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles({ files: undefined, file: undefined }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('validateUploadedFiles — empty file rejection', () => {
  test('0-byte buffer → 400 with "empty" in message', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([makeFile(Buffer.alloc(0), 'image/jpeg')]), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.message).toMatch(/empty/i);
  });
});

describe('validateUploadedFiles — magic-byte verification', () => {
  test('valid JPEG buffer + image/jpeg → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([makeFile(makeJpegBuffer(), 'image/jpeg')]), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._body).toBeNull();
  });

  test('valid JPEG buffer + image/jpg (alias) → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([makeFile(makeJpegBuffer(), 'image/jpg')]), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('JPEG magic bytes but mimetype=image/png → 400 mismatch', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([makeFile(makeJpegBuffer(), 'image/png')]), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.message).toMatch(/content does not match/i);
  });

  test('valid PNG buffer + image/png → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([makeFile(makePngBuffer(), 'image/png')]), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('PNG magic bytes but mimetype=image/jpeg → 400 mismatch', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([makeFile(makePngBuffer(), 'image/jpeg')]), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
  });

  test('valid WebP VP8 buffer + image/webp → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(makeReq([makeFile(makeWebpBuffer(), 'image/webp')]), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('random bytes with no valid magic → 400 mismatch', () => {
    const next = makeNext();
    const res  = makeRes();
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    validateUploadedFiles(makeReq([makeFile(garbage, 'image/jpeg')]), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
  });
});

describe('validateUploadedFiles — dimension guard (MAX 4000px)', () => {
  test('PNG 100×100 → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      makeReq([makeFile(makePngWithDimensions(100, 100), 'image/png')]),
      res, next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('PNG 4000×4000 (at limit) → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      makeReq([makeFile(makePngWithDimensions(4000, 4000), 'image/png')]),
      res, next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('PNG 4001×100 (width over limit) → 400 dimension error', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      makeReq([makeFile(makePngWithDimensions(4001, 100), 'image/png')]),
      res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.message).toMatch(/too large/i);
  });

  test('PNG 100×5000 (height over limit) → 400 dimension error', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      makeReq([makeFile(makePngWithDimensions(100, 5000), 'image/png')]),
      res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
  });

  test('JPEG 5000×3000 → 400 dimension error', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      makeReq([makeFile(makeJpegWithDimensions(5000, 3000), 'image/jpeg')]),
      res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.message).toMatch(/5000/);
  });

  test('WebP 200×200 → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      makeReq([makeFile(makeWebpBuffer(200, 200), 'image/webp')]),
      res, next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('validateUploadedFiles — duplicate detection (SHA-256)', () => {
  test('two identical JPEG buffers in one request → 400 duplicate', () => {
    const next = makeNext();
    const res  = makeRes();
    const jpeg = makeJpegBuffer(50);
    validateUploadedFiles(
      makeReq([
        makeFile(jpeg, 'image/jpeg', 'a.jpg'),
        makeFile(Buffer.from(jpeg), 'image/jpeg', 'b.jpg'), // same bytes, different name
      ]),
      res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.message).toMatch(/Duplicate/i);
  });

  test('two different JPEG buffers → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    const a = makeJpegBuffer(10);
    const b = makeJpegBuffer(20); // different length → different hash
    validateUploadedFiles(
      makeReq([
        makeFile(a, 'image/jpeg', 'a.jpg'),
        makeFile(b, 'image/jpeg', 'b.jpg'),
      ]),
      res, next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('JPEG + PNG (different content) → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      makeReq([
        makeFile(makeJpegBuffer(), 'image/jpeg', 'img.jpg'),
        makeFile(makePngBuffer(),  'image/png',  'img.png'),
      ]),
      res, next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('validateUploadedFiles — req.file (single-upload path)', () => {
  test('valid single file via req.file → calls next', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      { files: undefined, file: makeFile(makeJpegBuffer(), 'image/jpeg') },
      res, next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('invalid single file via req.file → 400', () => {
    const next = makeNext();
    const res  = makeRes();
    validateUploadedFiles(
      { files: undefined, file: makeFile(Buffer.alloc(0), 'image/jpeg') },
      res, next
    );
    expect(res._status).toBe(400);
  });
});

// ── validatePdfUpload (shipping slips) ─────────────────────────────────────────

describe('validatePdfUpload', () => {
  /** Minimal PDF: %PDF-1.4 header + padding */
  const makePdfBuffer = () => Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(16)]);

  test('no file → passes through (slip is optional)', () => {
    const next = makeNext();
    const res = makeRes();
    validatePdfUpload({ file: undefined }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(200);
  });

  test('valid PDF header → calls next', () => {
    const next = makeNext();
    const res = makeRes();
    validatePdfUpload({ file: makeFile(makePdfBuffer(), 'application/pdf', 'slip.pdf') }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('empty file → 400', () => {
    const next = makeNext();
    const res = makeRes();
    validatePdfUpload({ file: makeFile(Buffer.alloc(0), 'application/pdf', 'slip.pdf') }, res, next);
    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('non-PDF content (spoofed extension) → 400', () => {
    const next = makeNext();
    const res = makeRes();
    // JPEG bytes claiming to be a PDF
    validatePdfUpload({ file: makeFile(makeJpegBuffer(), 'application/pdf', 'slip.pdf') }, res, next);
    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
