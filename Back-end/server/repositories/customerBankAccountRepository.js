import BaseRepository from './baseRepository.js';
import CustomerBankAccount from '../models/CustomerBankAccount.js';

/**
 * Saved customer bank accounts (models/CustomerBankAccount.js), one per mobile.
 * Access rules and masking live in services/customerBankService.js.
 */
class CustomerBankAccountRepository extends BaseRepository {
  constructor() {
    super(CustomerBankAccount);
  }

  /** The account for this mobile; the encrypted number only when asked for. */
  async findByPhone(phone, { withNumber = false } = {}) {
    return CustomerBankAccount.findOne({ phone }).select(withNumber ? '+accountNumber' : '').lean();
  }

  /** Create or replace the account for this mobile (unique index customer_bank_phone). */
  async upsertByPhone(phone, set) {
    return CustomerBankAccount.findOneAndUpdate({ phone }, { $set: set }, { upsert: true, new: true, runValidators: true }).lean();
  }

  async deleteByPhone(phone) {
    return CustomerBankAccount.findOneAndDelete({ phone }).lean();
  }
}

export default new CustomerBankAccountRepository();
