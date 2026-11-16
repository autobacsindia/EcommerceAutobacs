import { body, query } from 'express-validator';
import { MAX_BULK_SHIPPING_CLASS, MAX_SHIPPING_CLASS_PAGE } from '../services/shippingClassService.js';
import { SHIPPING_CLASSES } from '../utils/shippingClass.js';

/** PATCH /products/shipping-class { productIds[], shippingClass: small|medium|large|xl|auto } */
export const validateSetShippingClass = [
  body('productIds').isArray({ min: 1, max: MAX_BULK_SHIPPING_CLASS })
    .withMessage(`Choose between 1 and ${MAX_BULK_SHIPPING_CLASS} products`),
  body('productIds.*').isMongoId().withMessage('Invalid product'),
  body('shippingClass').isIn([...SHIPPING_CLASSES, 'auto'])
    .withMessage('Choose Small, Medium, Large, XL or Automatic'),
];

/** GET /products/admin/shipping-class?class=small|medium|large|xl|none&cursor=&limit= */
export const validateListShippingClass = [
  query('class').isIn([...SHIPPING_CLASSES, 'none']).withMessage('Invalid size class'),
  query('cursor').optional().isMongoId().withMessage('Invalid cursor'),
  query('limit').optional().isInt({ min: 1, max: MAX_SHIPPING_CLASS_PAGE }).withMessage(`Limit must be 1 to ${MAX_SHIPPING_CLASS_PAGE}`),
];

/** PUT /products/admin/shipping-class-boxes { boxes: { small, medium, large } } — numbers checked in the service. */
export const validateClassBoxes = [
  body('boxes').isObject().withMessage('Send a box for Small, Medium and Large'),
];
