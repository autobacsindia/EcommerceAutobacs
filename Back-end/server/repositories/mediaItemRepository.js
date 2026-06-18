import MediaItem from '../models/MediaItem.js';

/**
 * MediaItem data access. Passthrough to the model so existing query chaining is
 * preserved exactly, while keeping the model import isolated to the repository
 * layer.
 */
class MediaItemRepository {
  find(...args) { return MediaItem.find(...args); }
  findById(...args) { return MediaItem.findById(...args); }
  findByIdAndDelete(...args) { return MediaItem.findByIdAndDelete(...args); }
  countDocuments(...args) { return MediaItem.countDocuments(...args); }
  distinct(...args) { return MediaItem.distinct(...args); }
  create(...args) { return MediaItem.create(...args); }
}

export default new MediaItemRepository();
