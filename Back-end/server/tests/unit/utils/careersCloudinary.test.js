/**
 * careersCloudinary — the REAL signature signing (not the controller mock).
 *
 * Regression guard for the "every careers upload 401s" bug: the signature must
 * be computed over EXACTLY the params Cloudinary recognises as signable
 * ({ folder, timestamp, type }). `max_file_size` is not a Cloudinary upload
 * parameter — Cloudinary drops it from its string-to-sign, so signing it makes
 * the browser's direct upload fail with "Invalid Signature". This asserts the
 * returned signature reproduces the correct string-to-sign and carries no
 * phantom size param.
 */
import { jest } from '@jest/globals';

process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
process.env.CLOUDINARY_API_KEY = 'demo-key';
process.env.CLOUDINARY_API_SECRET = 'demo-secret';

const { v2: cloudinary } = await import('cloudinary');
const { generateCareersUploadSignature, CAREERS_FOLDER_BASE } = await import(
  '../../../utils/careersCloudinary.js'
);

describe('generateCareersUploadSignature', () => {
  test('signs exactly { folder, timestamp, type } and matches Cloudinary', () => {
    const folder = `${CAREERS_FOLDER_BASE}/abc123`;
    const sig = generateCareersUploadSignature({ folder });

    expect(sig.type).toBe('authenticated');
    expect(sig.folder).toBe(folder);
    expect(sig.cloudName).toBe('demo-cloud');
    expect(sig.apiKey).toBe('demo-key');

    // The signature Cloudinary will verify against is derived from these three
    // params only. Recompute with the returned timestamp and assert equality.
    const expected = cloudinary.utils.api_sign_request(
      { folder, timestamp: sig.timestamp, type: 'authenticated' },
      'demo-secret',
    );
    expect(sig.signature).toBe(expected);
  });

  test('does NOT sign max_file_size (would break the signature)', () => {
    const folder = `${CAREERS_FOLDER_BASE}/abc123`;
    const sig = generateCareersUploadSignature({ folder });

    // No phantom size param leaks into the response…
    expect(sig).not.toHaveProperty('maxFileSize');
    expect(sig).not.toHaveProperty('max_file_size');

    // …and the signature must differ from the buggy variant that signed it, so a
    // future re-introduction of max_file_size can't silently pass this suite.
    const buggy = cloudinary.utils.api_sign_request(
      { folder, max_file_size: 30 * 1024 * 1024, timestamp: sig.timestamp, type: 'authenticated' },
      'demo-secret',
    );
    expect(sig.signature).not.toBe(buggy);
  });
});
