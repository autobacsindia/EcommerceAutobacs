import { errorMessage, parseApiResponse, type ApiResponseBody } from './multipartResponse';

/**
 * The admin's only feedback on a failed save is what `errorMessage` builds.
 *
 * The backend whitelists the top-level `message` down to the bare string
 * "Validation Error" and puts the actual field detail in `errors`. This helper
 * used to read only `message`, so a product that could not be saved because
 * `seo.canonical` breached its schema cap produced `alert("Validation Error")` —
 * naming no field, with no way for the admin to know what to fix.
 */

const resWith = (status: number) => ({ status } as Response);

describe('errorMessage', () => {
  it('appends the per-field detail the backend sent', () => {
    const data: ApiResponseBody = {
      message: 'Validation Error',
      errors: { 'seo.canonical': 'Path `canonical` (…, length 614) is longer than the maximum allowed length (500).' },
    };

    const msg = errorMessage(resWith(400), data, 'Failed to update product');

    expect(msg).toContain('Validation Error');
    expect(msg).toContain('seo.canonical');
    expect(msg).toContain('maximum allowed length (500)');
  });

  it('lists every failing field', () => {
    const msg = errorMessage(
      resWith(400),
      { message: 'Validation Error', errors: { 'seo.canonical': 'too long', price: 'required' } },
      'Failed',
    );

    expect(msg).toContain('seo.canonical: too long');
    expect(msg).toContain('price: required');
  });

  it('caps the list so one bad payload cannot produce a wall of text', () => {
    const errors = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`field${i}`, 'bad']),
    );

    const msg = errorMessage(resWith(400), { message: 'Validation Error', errors }, 'Failed');

    expect(msg).toContain('field0: bad');
    expect(msg).toContain('and 7 more fields');
    expect(msg).not.toContain('field11');
  });

  it('is unchanged when the response carries no field map', () => {
    expect(errorMessage(resWith(404), { message: 'Product not found' }, 'Failed'))
      .toBe('Product not found');
  });

  it('ignores an empty or malformed field map', () => {
    expect(errorMessage(resWith(400), { message: 'Validation Error', errors: {} }, 'Failed'))
      .toBe('Validation Error');
    expect(
      errorMessage(
        resWith(400),
        { message: 'Validation Error', errors: { a: '', b: '   ' } as Record<string, string> },
        'Failed',
      ),
    ).toBe('Validation Error');
  });

  it('falls back to the caller message with the status code', () => {
    expect(errorMessage(resWith(500), {}, 'Failed to update product'))
      .toBe('Failed to update product (HTTP 500).');
  });

  it('keeps the special-cased 413 upload message', () => {
    const msg = errorMessage(resWith(413), { message: 'Validation Error', errors: { a: 'b' } }, 'Failed');

    expect(msg).toContain('Upload too large');
    expect(msg).not.toContain('a: b');
  });
});

describe('parseApiResponse', () => {
  const jsonRes = (body: string) => ({ text: async () => body } as Response);

  it('parses a JSON body', async () => {
    await expect(parseApiResponse(jsonRes('{"message":"ok"}'))).resolves.toEqual({ message: 'ok' });
  });

  it('keeps a non-JSON body as a trimmed message', async () => {
    await expect(parseApiResponse(jsonRes('Request Entity Too Large')))
      .resolves.toEqual({ message: 'Request Entity Too Large' });
  });

  it('returns an empty object for an empty body', async () => {
    await expect(parseApiResponse(jsonRes(''))).resolves.toEqual({});
  });
});
