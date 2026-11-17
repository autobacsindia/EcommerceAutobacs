/**
 * Delivery fees — public display read + admin rate card and remote-PIN list.
 * All maths and validation live in services/deliveryFeeService.js.
 */
import deliveryFeeService, {
  resolvePublicDeliveryFeeConfig,
} from '../services/deliveryFeeService.js';

// @route GET /delivery-fees/public  (shared cache; display only — never prices anything)
export const getPublicDeliveryFees = async (_req, res) => {
  res.json({ success: true, deliveryFees: await resolvePublicDeliveryFeeConfig() });
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
