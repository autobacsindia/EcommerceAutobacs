import express from 'express';
import { getCheckoutQuote } from '../controllers/checkoutController.js';
import { validateCheckoutQuote } from '../validators/coupon.validator.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = express.Router();

// optionalAuth is applied at mount (routes/index.js) so the quote can personalise
// coupon eligibility + karma balance for logged-in users while staying usable for guests.
router.post('/quote', validateCheckoutQuote, validateRequest, getCheckoutQuote);

export default router;
