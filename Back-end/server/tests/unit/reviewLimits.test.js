import { ADMIN_COMMENT_MAX, CUSTOMER_COMMENT_MAX } from '../../config/reviewLimits.js';
import Review from '../../models/Review.js';
import mongoose from 'mongoose';

describe('review comment limits', () => {
  it('lets staff enter more than a customer may submit', () => {
    // The point of the split: importing a customer's existing Google review
    // means pasting their full text, and those run past the customer cap.
    expect(ADMIN_COMMENT_MAX).toBeGreaterThan(CUSTOMER_COMMENT_MAX);
  });

  it('sizes the schema to the HIGHER limit, since it cannot tell who is writing', () => {
    const maxlength = Review.schema.path('comment').options.maxlength;
    expect(maxlength).toBe(ADMIN_COMMENT_MAX);
  });

  it('accepts a comment at the admin limit', () => {
    const doc = new Review({
      product: new mongoose.Types.ObjectId(),
      guestName: 'KP',
      rating: 5,
      comment: 'x'.repeat(ADMIN_COMMENT_MAX),
    });
    expect(doc.validateSync()?.errors?.comment).toBeUndefined();
  });

  it('still rejects a comment past the admin limit', () => {
    // Without this the ceiling is theoretical and an unbounded paste lands in
    // the database.
    const doc = new Review({
      product: new mongoose.Types.ObjectId(),
      guestName: 'KP',
      rating: 5,
      comment: 'x'.repeat(ADMIN_COMMENT_MAX + 1),
    });
    expect(doc.validateSync()?.errors?.comment).toBeDefined();
  });
});
