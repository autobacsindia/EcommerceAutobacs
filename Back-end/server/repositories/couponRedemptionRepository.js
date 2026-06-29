import BaseRepository from './baseRepository.js';
import CouponRedemption from '../models/CouponRedemption.js';

class CouponRedemptionRepository extends BaseRepository {
  constructor() {
    super(CouponRedemption);
  }

  async findByOrder(orderId, session = null) {
    let q = CouponRedemption.findOne({ order: orderId });
    if (session) q = q.session(session);
    return q;
  }

  async deleteByIdSession(id, session = null) {
    return CouponRedemption.deleteOne({ _id: id }, session ? { session } : {});
  }
}

export default new CouponRedemptionRepository();
