import DeliveryFeeConfig from '../models/DeliveryFeeConfig.js';
import RemotePin from '../models/RemotePin.js';
import PinLocation from '../models/PinLocation.js';

/** Rate-card singleton + the remote (ODA) PIN list. */
class DeliveryFeeRepository {
  /** The rate card, or null when nobody has saved one (callers use the defaults). */
  async findConfig(session = null) {
    const q = DeliveryFeeConfig.findOne({ key: 'default' }).lean();
    if (session) q.session(session);
    return q;
  }

  async saveConfig(set) {
    return DeliveryFeeConfig.findOneAndUpdate(
      { key: 'default' },
      { $set: set },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, lean: true },
    );
  }

  async isRemotePin(pin, session = null) {
    const q = RemotePin.exists({ pin });
    if (session) q.session(session);
    return Boolean(await q);
  }

  /** Lat/long + place for a PIN, or null when the PIN is not in the table. */
  async findPinLocation(pin, session = null) {
    const q = PinLocation.findOne({ pin }).select('pin lat lng district state -_id').lean();
    if (session) q.session(session);
    return q;
  }

  async countPinLocations() {
    return PinLocation.estimatedDocumentCount();
  }

  /** Keyset page by pin (unique, indexed). */
  async listRemotePins({ afterPin = null, limit = 100, prefix = null } = {}) {
    const filter = {};
    if (afterPin) filter.pin = { $gt: afterPin };
    if (prefix) filter.pin = { ...(filter.pin || {}), $regex: `^${prefix}` };
    return RemotePin.find(filter).sort({ pin: 1 }).limit(limit).select('pin note createdAt').lean();
  }

  async countRemotePins() {
    return RemotePin.estimatedDocumentCount();
  }

  /** Insert many; existing PINs are left alone (idempotent re-upload). */
  async addRemotePins(pins, note, userId) {
    if (!pins.length) return 0;
    const res = await RemotePin.bulkWrite(
      pins.map((pin) => ({
        updateOne: {
          filter: { pin },
          update: { $setOnInsert: { pin, note, addedBy: userId ?? null } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    return res.upsertedCount || 0;
  }

  async removeRemotePins(pins) {
    const res = await RemotePin.deleteMany({ pin: { $in: pins } });
    return res.deletedCount || 0;
  }
}

export default new DeliveryFeeRepository();
