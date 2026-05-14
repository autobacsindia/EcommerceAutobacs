import BaseRepository from './baseRepository.js';
import Payment from '../models/Payment.js';

class PaymentRepository extends BaseRepository {
  constructor() {
    super(Payment);
  }

  /**
   * Create a payment record, optionally inside a transaction session.
   * Uses create([data], { session }) array form so the session is honoured.
   */
  async createPayment(data, session = null) {
    if (session) {
      const [payment] = await Payment.create([data], { session });
      return payment;
    }
    const payment = new Payment(data);
    return payment.save();
  }

  async findByOrderAndGatewayId(orderId, gatewayPaymentId, session = null) {
    let q = Payment.findOne({ order: orderId, gatewayPaymentId });
    if (session) q = q.session(session);
    return q;
  }

  async findByGatewayPaymentId(gatewayPaymentId, session = null) {
    let q = Payment.findOne({ gatewayPaymentId });
    if (session) q = q.session(session);
    return q;
  }

  async save(payment, session = null) {
    if (session) return payment.save({ session });
    return payment.save();
  }
}

export default new PaymentRepository();
