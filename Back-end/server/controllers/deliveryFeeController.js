/**
 * Delivery fees — public display read + admin rate card and remote-PIN list.
 * All maths and validation live in services/deliveryFeeService.js.
 */
import { deliveryEstimates } from '../services/deliveryEstimateService.js';
import deliveryFeeService, {
  resolvePublicDeliveryFeeConfig,
} from '../services/deliveryFeeService.js';

// @route GET /delivery-fees/public  (shared cache; display only — never prices anything)
export const getPublicDeliveryFees = async (_req, res) => {
  res.json({ success: true, deliveryFees: await resolvePublicDeliveryFeeConfig() });
};

// @route GET /delivery-fees/card-waivers?ids=a,b,c  (display only: the product cards'
// "Save ₹X+" badge and ₹0 receipt; checkout re-prices from the PIN)
export const getCardFeeWaivers = async (req, res) => {
  const ids = String(req.query.ids || '').split(',');
  res.json({ success: true, waivers: await deliveryFeeService.cardFeeWaivers(ids) });
};

// @route GET /delivery-fees/estimates?ids=a,b,c  (product page + cards: "7–10 days")
export const getDeliveryEstimates = async (req, res) => {
  const ids = String(req.query.ids || '').split(',');
  res.json({ success: true, estimates: await deliveryEstimates(ids) });
};

// @route GET /delivery-fees/admin
export const getDeliveryFeeAdmin = async (_req, res) => {
  res.json({ success: true, config: await deliveryFeeService.getAdminDeliveryFeeConfig() });
};

// @route PUT /delivery-fees/admin
export const updateDeliveryFeeAdmin = async (req, res) => {
  res.json({ success: true, config: await deliveryFeeService.updateRateCard(req, req.body) });
};

// @route GET /delivery-fees/admin/remote-pins?cursor=&limit=&prefix=
export const listRemotePins = async (req, res) => {
  const { cursor, limit, prefix } = req.query;
  res.json({ success: true, ...(await deliveryFeeService.listRemotePins({ cursor, limit, prefix })) });
};

// @route POST /delivery-fees/admin/remote-pins  { text, note? }
export const addRemotePins = async (req, res) => {
  res.json({ success: true, ...(await deliveryFeeService.addRemotePins(req, req.body || {})) });
};

// @route POST /delivery-fees/admin/remote-pins/remove  { text }
export const removeRemotePins = async (req, res) => {
  res.json({ success: true, ...(await deliveryFeeService.removeRemotePins(req, req.body || {})) });
};
