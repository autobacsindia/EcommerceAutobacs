import { buildPurchasePayload, itemCatalogId, itemName } from './purchase';

const SEND_TO = 'AW-11434499615/cC2kCO7WhNccEJ-8sswq';

describe('buildPurchasePayload', () => {
  it('reports the catalogue id as item_id so Google can match the Merchant Center offer', () => {
    const payload = buildPurchasePayload(
      {
        _id: 'order1',
        totalAmount: 4999,
        items: [
          {
            product: { _id: '69aec44d981d9f26abdfb44b', name: 'Roof Rack' },
            metaContentId: '11466',
            price: 4999,
            quantity: 1,
          },
        ],
      },
      SEND_TO
    );

    expect(payload.items[0].item_id).toBe('11466');
    expect(payload.send_to).toBe(SEND_TO);
    // Rupees pass through untouched — the Order model stores rupees, not paise.
    expect(payload.value).toBe(4999);
    expect(payload.currency).toBe('INR');
  });

  it('falls back to the product id for orders serialized before catalogue ids existed', () => {
    expect(itemCatalogId({ product: { _id: 'abc' } })).toBe('abc');
    expect(itemCatalogId({ product: 'abc' })).toBe('abc');
    expect(itemCatalogId({})).toBe('');
  });

  it('omits send_to when the conversion label is not configured', () => {
    const payload = buildPurchasePayload({ _id: 'order1', totalAmount: 100, items: [] }, '');
    expect(payload.send_to).toBeUndefined();
  });

  it('guards against malformed money and missing quantities', () => {
    const payload = buildPurchasePayload(
      {
        _id: 'order1',
        totalAmount: undefined,
        items: [{ product: null, name: 'Mystery', price: undefined }],
      },
      SEND_TO
    );

    expect(payload.value).toBe(0);
    expect(payload.items[0]).toMatchObject({ price: 0, quantity: 1, item_name: 'Mystery' });
  });

  it('names items from the populated product, then the snapshot name', () => {
    expect(itemName({ product: { _id: 'a', name: 'From product' }, name: 'Snapshot' })).toBe('From product');
    expect(itemName({ product: null, name: 'Snapshot' })).toBe('Snapshot');
    expect(itemName({})).toBe('Item');
  });
});
