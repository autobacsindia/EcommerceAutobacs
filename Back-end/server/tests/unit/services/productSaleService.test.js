import { jest } from '@jest/globals';

/**
 * DB-free unit tests for the sale-expiry sweep. The product repository and cache
 * invalidation are mocked so the revert logic (price ← originalPrice, clear
 * markers) and the cache-invalidate-once behaviour are exercised deterministically.
 */

const mockProductRepo = {
  findExpiredSales: jest.fn(),
  revertExpiredSale: jest.fn(),
};
const mockInvalidateCache = jest.fn();

jest.unstable_mockModule('../../../repositories/productRepository.js', () => ({ default: mockProductRepo }));
jest.unstable_mockModule('../../../middleware/cacheMiddleware.js', () => ({ invalidateCache: mockInvalidateCache }));

const { expireEndedSales } = await import('../../../services/productSaleService.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockProductRepo.revertExpiredSale.mockResolvedValue({});
});

test('no expired sales: no writes, no cache invalidation', async () => {
  mockProductRepo.findExpiredSales.mockResolvedValue([]);
  const res = await expireEndedSales();
  expect(res).toEqual({ reverted: 0, failed: 0 });
  expect(mockProductRepo.revertExpiredSale).not.toHaveBeenCalled();
  expect(mockInvalidateCache).not.toHaveBeenCalled();
});

test('reverts each expired sale UP to its originalPrice and invalidates cache once', async () => {
  mockProductRepo.findExpiredSales.mockResolvedValue([
    { _id: 'p1', price: 800, originalPrice: 1000 },
    { _id: 'p2', price: 450, originalPrice: 600 },
  ]);

  const res = await expireEndedSales();

  expect(res).toEqual({ reverted: 2, failed: 0 });
  expect(mockProductRepo.revertExpiredSale).toHaveBeenCalledWith('p1', 1000);
  expect(mockProductRepo.revertExpiredSale).toHaveBeenCalledWith('p2', 600);
  expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
  expect(mockInvalidateCache).toHaveBeenCalledWith('products');
});

test('malformed sale (no higher originalPrice) reverts to current price, no surprise jump', async () => {
  mockProductRepo.findExpiredSales.mockResolvedValue([
    { _id: 'p1', price: 800, originalPrice: 700 }, // original not higher
    { _id: 'p2', price: 500 },                     // missing original
  ]);
  await expireEndedSales();
  expect(mockProductRepo.revertExpiredSale).toHaveBeenCalledWith('p1', 800);
  expect(mockProductRepo.revertExpiredSale).toHaveBeenCalledWith('p2', 500);
});

test('a failing revert is counted, does not abort the rest, still invalidates cache', async () => {
  mockProductRepo.findExpiredSales.mockResolvedValue([
    { _id: 'bad', price: 800, originalPrice: 1000 },
    { _id: 'ok', price: 450, originalPrice: 600 },
  ]);
  mockProductRepo.revertExpiredSale.mockImplementation((id) =>
    id === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve({})
  );

  const res = await expireEndedSales();

  expect(res).toEqual({ reverted: 1, failed: 1 });
  expect(mockProductRepo.revertExpiredSale).toHaveBeenCalledWith('ok', 600);
  expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
});
