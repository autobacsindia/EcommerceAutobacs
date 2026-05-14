import BaseRepository from './baseRepository.js';
import User from '../models/User.js';

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  async findByEmail(email, session = null) {
    let q = User.findOne({ email: email.toLowerCase() });
    if (session) q = q.session(session);
    return q;
  }

  async findByPhone(phone, session = null) {
    let q = User.findOne({ phone });
    if (session) q = q.session(session);
    return q;
  }

  async save(user, session = null) {
    if (session) return user.save({ session });
    return user.save();
  }
}

export default new UserRepository();
