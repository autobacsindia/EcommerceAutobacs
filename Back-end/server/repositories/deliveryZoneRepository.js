import DeliveryZone from '../models/DeliveryZone.js';

/**
 * DeliveryZone data access. Passthrough to the model so query chaining, the
 * pin-code / summary / bulk static helpers, and instance save() on a freshly
 * built zone all work unchanged, while keeping the model import isolated to the
 * repository layer.
 */
class DeliveryZoneRepository {
  find(...args) { return DeliveryZone.find(...args); }
  findById(...args) { return DeliveryZone.findById(...args); }
  findOne(...args) { return DeliveryZone.findOne(...args); }
  findByIdAndUpdate(...args) { return DeliveryZone.findByIdAndUpdate(...args); }
  findByIdAndDelete(...args) { return DeliveryZone.findByIdAndDelete(...args); }
  findByPinCode(...args) { return DeliveryZone.findByPinCode(...args); }
  getZonesSummary(...args) { return DeliveryZone.getZonesSummary(...args); }
  bulkAddPinCodes(...args) { return DeliveryZone.bulkAddPinCodes(...args); }
  /** Build an unsaved zone; caller mutates then save()s it. */
  build(data) { return new DeliveryZone(data); }
}

export default new DeliveryZoneRepository();
