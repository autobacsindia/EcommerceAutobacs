import {
  setProductsShippingClass,
  listProductsByShippingClass,
  getClassBoxes,
  updateClassBoxes,
} from '../services/shippingClassService.js';

// @route PATCH /products/shipping-class  (admin, marketing)
export const setShippingClass = async (req, res) => {
  const { productIds, shippingClass } = req.body;
  res.json({ success: true, ...(await setProductsShippingClass(req, { productIds, shippingClass })) });
};

// @route GET /products/admin/shipping-class  (admin, marketing)
export const listShippingClass = async (req, res) => {
  const { class: shippingClass, cursor, limit } = req.query;
  res.json({ success: true, ...(await listProductsByShippingClass({ shippingClass, cursor: cursor || null, limit })) });
};

// @route GET /products/admin/shipping-class-boxes  (admin, marketing)
export const getShippingClassBoxes = async (_req, res) => {
  res.json({ success: true, ...(await getClassBoxes()) });
};

// @route PUT /products/admin/shipping-class-boxes  (admin)
export const putShippingClassBoxes = async (req, res) => {
  res.json({ success: true, ...(await updateClassBoxes(req, req.body.boxes)) });
};
