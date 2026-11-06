import FestivalTheme from '../models/FestivalTheme.js';

class FestivalThemeRepository {
  async getSingleton() {
    return FestivalTheme.getSingleton();
  }

  async update(set) {
    return FestivalTheme.findOneAndUpdate(
      { key: 'default' },
      { $set: set },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, lean: true },
    );
  }
}

export default new FestivalThemeRepository();
