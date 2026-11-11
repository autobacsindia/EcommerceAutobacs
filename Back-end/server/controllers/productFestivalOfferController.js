import {
  setProductsFestivalOffer,
  setProductFestivalOfferFull,
  listFestivalOfferExceptions as listExceptions,
} from '../services/productFestivalOfferService.js';

// @route PATCH /products/festival-offer-setting  (admin, marketing)
export const setFestivalOfferSetting = async (req, res) => {
  const { productIds, mode, percent } = req.body;
  const result = await setProductsFestivalOffer(req, { productIds, mode, percent });
  res.json({ success: true, ...result });
};

// @route GET /products/admin/festival-offer-exceptions  (admin, marketing)
export const listFestivalOfferExceptions = async (req, res) => {
  const { mode, cursor, limit } = req.query;
  const page = await listExceptions({
    mode: mode || null,
    cursor: cursor || null,
    limit: limit ? Number(limit) : undefined,
  });
  res.json({ success: true, ...page });
};

// @route PUT /products/:id/festival-offer  (admin, marketing)
// { mode, percent?, variants?: [{ variantId, mode: inherit|auto|none|custom, percent? }] }
export const setProductFestivalOffer = async (req, res) => {
  const { mode, percent, variants } = req.body;
  const result = await setProductFestivalOfferFull(req, req.params.id, { mode, percent, variants: variants || [] });
  res.json({ success: true, ...result });
};
