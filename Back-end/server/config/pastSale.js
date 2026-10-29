/**
 * Past (offline) sales — the closed lists shared by the model (models/PastSale.js)
 * and the input rules (services/pastSaleInput.js).
 */
export const PAST_SALE_CHANNELS = Object.freeze(['store', 'phone', 'whatsapp', 'home_visit', 'event', 'other']);
export const PAST_SALE_PAYMENT_METHODS = Object.freeze(['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other']);
export const PAST_SALE_HISTORY_CAP = 100;
