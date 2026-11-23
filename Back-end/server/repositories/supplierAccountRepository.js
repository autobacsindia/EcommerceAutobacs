import SupplierAccount, { SUPPLIER_ACCOUNT_STATUS, emailKeyOf } from '../models/SupplierAccount.js';

/**
 * Autobacs Partner supplier logins (models/SupplierAccount.js). Data access only —
 * rules live in services/supplierPortal/*. Re-exports the status enum so services
 * never import the model directly (eslint no-restricted-imports).
 *
 * Secret fields (passwordHash, emailCode.*, failedLogins, lockedUntil,
 * bank.accountNumber) are `select: false`; only the methods that need them opt in.
 */
export { SUPPLIER_ACCOUNT_STATUS, emailKeyOf };

const AUTH_SECRETS = '+passwordHash +failedLogins +lockedUntil';
const CODE_FIELDS = '+emailCode.hash +emailCode.purpose +emailCode.expiresAt +emailCode.attempts +emailCode.sentAt';

const supplierAccountRepository = {
  create: (data) => SupplierAccount.create(data),

  findById: (id) => SupplierAccount.findById(id).lean(),

  findByEmailForLogin: (emailKey) => SupplierAccount.findOne({ emailKey }).select(AUTH_SECRETS).lean(),

  findByEmail: (emailKey) => SupplierAccount.findOne({ emailKey }).lean(),

  findByIdWithCode: (id) => SupplierAccount.findById(id).select(CODE_FIELDS).lean(),

  findByEmailWithCode: (emailKey) => SupplierAccount.findOne({ emailKey }).select(CODE_FIELDS).lean(),

  /**
   * Conditional update; returns the updated doc or null when `filter` no longer matches.
   * Field setters run on the update (bank.accountNumber is encrypted by its setter).
   */
  updateWhere: (filter, update) => SupplierAccount.findOneAndUpdate(filter, update, { new: true, runValidators: true }).lean(),

};

export default supplierAccountRepository;
